import { it, expect, beforeEach, afterAll } from "vitest";
import pool from "@/lib/database/db";
import {
  loadAiTagCandidates,
  MAX_CANDIDATES,
  MAX_FINDINGS_SAMPLE,
} from "@/lib/tags/ai-tag-candidates";
import { describeIntegration, createUser } from "./_db";
import {
  addAiTaggedScan,
  cleanupTracked,
  clearAiTags,
  insertPromotedRule,
  track,
  trackedTag,
} from "./_auto-tag-fixtures";

/**
 * The AI tag candidates list against a real PostgreSQL.
 *
 * Every claim that matters here is a claim about the SQL. The unit suites fake
 * `pool.query`, so they can show the loader sends three queries and reads the
 * rows back; they cannot show that jsonb_array_elements unnests a findings
 * array, that a window function keeps the newest 50 scans and not the oldest,
 * or that a NOT EXISTS inside a HAVING clause is valid at all. A faked pool
 * answers a query with a syntax error exactly as it answers a correct one.
 */
describeIntegration("AI tag candidates", () => {
  beforeEach(clearAiTags);
  afterAll(cleanupTracked);

  it("lists a recurring tag with its counts, newest examples and a suggested rule", async () => {
    const tag = trackedTag("recurring");
    const alice = await createUser();
    const bob = await createUser();
    const findings = [
      { cwe: "CWE-350", category: "dns", severity: "high" },
      { cwe: "CWE-350", category: "email", severity: "medium" },
      { cwe: "CWE-79", category: "dns", severity: "high" },
      // Values the promote form would refuse, and elements that are not
      // findings at all: none of them may reach a suggestion or abort the query.
      { cwe: "not-a-cwe", category: "no-such-category", severity: "extreme" },
      "a string where a finding should be",
      null,
      {},
    ];
    await addAiTaggedScan(alice.id, [tag], findings);
    await addAiTaggedScan(alice.id, [tag], findings);
    const third = await addAiTaggedScan(bob.id, [tag], findings);
    const fourth = await addAiTaggedScan(bob.id, [tag], findings);
    // A findings value that is not an array counts as no findings.
    const fifth = await addAiTaggedScan(bob.id, [tag], { oops: true });

    const candidate = (await loadAiTagCandidates()).find((c) => c.tag === tag);

    expect(candidate).toBeDefined();
    expect(candidate!.scanCount).toBe(5);
    expect(candidate!.userCount).toBe(2);
    // Three examples, the newest scan first.
    expect(candidate!.examples.map((e) => e.scanId)).toEqual([
      fifth,
      fourth,
      third,
    ]);
    expect(candidate!.examples[0].url).toMatch(
      /^https:\/\/.+\.example\.test\/$/,
    );
    expect(Number.isNaN(Date.parse(candidate!.examples[0].scannedAt!))).toBe(
      false,
    );
    expect(candidate!.suggested).toEqual({
      cwes: ["CWE-350", "CWE-79"],
      categories: ["dns", "email"],
      minSeverity: "high",
    });
  });

  it("does not list a tag that has not recurred enough, or one that is not an AI tag", async () => {
    const twice = trackedTag("twice");
    const userTag = trackedTag("user-typed");
    const user = await createUser();
    await addAiTaggedScan(user.id, [twice]);
    await addAiTaggedScan(user.id, [twice]);

    for (let i = 0; i < 3; i++) {
      const scanId = await addAiTaggedScan(user.id, []);
      await pool.query(
        `INSERT INTO scan_tags (scan_id, user_id, tag, source) VALUES ($1, $2, $3, 'user')`,
        [scanId, user.id, userTag],
      );
    }

    const tags = (await loadAiTagCandidates()).map((c) => c.tag);

    expect(tags).not.toContain(twice);
    expect(tags).not.toContain(userTag);
  });

  it("suggests nothing when the scans carry no findings, and still lists the tag", async () => {
    const tag = trackedTag("bare");
    const user = await createUser();
    for (let i = 0; i < 3; i++) await addAiTaggedScan(user.id, [tag]);

    const candidate = (await loadAiTagCandidates()).find((c) => c.tag === tag);

    expect(candidate).toBeDefined();
    expect(candidate!.suggested).toEqual({
      cwes: [],
      categories: [],
      minSeverity: "medium",
    });
  });

  it("counts findings from only the newest scans, not the whole history", async () => {
    const tag = trackedTag("sampled");
    const user = await createUser();
    const olderScans = 5;
    // The oldest scans carry a CWE that would rank second if they were counted.
    for (let i = 0; i < olderScans; i++) {
      await addAiTaggedScan(
        user.id,
        [tag],
        [
          { cwe: "CWE-111", category: "dns", severity: "low" },
          { cwe: "CWE-111", category: "dns", severity: "low" },
          { cwe: "CWE-111", category: "dns", severity: "low" },
        ],
      );
    }
    for (let i = 0; i < MAX_FINDINGS_SAMPLE; i++) {
      await addAiTaggedScan(
        user.id,
        [tag],
        [{ cwe: "CWE-222", category: "email", severity: "high" }],
      );
    }

    const candidate = (await loadAiTagCandidates()).find((c) => c.tag === tag);

    expect(candidate!.scanCount).toBe(olderScans + MAX_FINDINGS_SAMPLE);
    expect(candidate!.suggested.cwes).toEqual(["CWE-222"]);
    expect(candidate!.suggested.categories).toEqual(["email"]);
    expect(candidate!.suggested.minSeverity).toBe("high");
  });

  it("returns the busiest MAX_CANDIDATES tags, busiest first", async () => {
    const prefix = trackedTag("many");
    const user = await createUser();
    // 27 tags that each sit on the same three scans: a tie on scan count, so
    // the order among them is the tag name.
    const names = Array.from(
      { length: 27 },
      (_, i) => `${prefix}-${String(i).padStart(2, "0")}`,
    );
    track(...names);
    for (let i = 0; i < 3; i++) await addAiTaggedScan(user.id, names);
    // The last name alphabetically is also the busiest, so only the ordering
    // by count can put it first.
    const busiest = names[26];
    await addAiTaggedScan(user.id, [busiest]);

    const candidates = await loadAiTagCandidates();

    expect(candidates).toHaveLength(MAX_CANDIDATES);
    expect(candidates[0].tag).toBe(busiest);
    expect(candidates[0].scanCount).toBe(4);
    expect(candidates.slice(1).map((c) => c.tag)).toEqual(
      names.slice(0, MAX_CANDIDATES - 1),
    );
  });

  it("drops a tag once it has a rule, by its own name or by the AI tag it came from", async () => {
    const promoted = trackedTag("promoted");
    const renamed = trackedTag("renamed-source");
    const user = await createUser();
    for (let i = 0; i < 3; i++) {
      await addAiTaggedScan(user.id, [promoted, renamed]);
    }

    expect((await loadAiTagCandidates()).map((c) => c.tag)).toEqual(
      expect.arrayContaining([promoted, renamed]),
    );

    const ruleId = await insertPromotedRule(promoted);
    // A rule saved under another name still retires the AI tag it came from.
    const renamedRuleId = await insertPromotedRule(trackedTag("renamed-rule"), {
      sourceAiTag: renamed,
    });

    const after = (await loadAiTagCandidates()).map((c) => c.tag);
    expect(after).not.toContain(promoted);
    expect(after).not.toContain(renamed);

    await pool.query("DELETE FROM promoted_auto_tag_rules WHERE id = ANY($1)", [
      [ruleId, renamedRuleId],
    ]);

    const back = (await loadAiTagCandidates()).map((c) => c.tag);
    expect(back).toContain(promoted);
    expect(back).toContain(renamed);
  });
});
