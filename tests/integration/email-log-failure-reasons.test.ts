import { it, expect, beforeEach } from "vitest";
import pool from "@/lib/database/db";
import { getRecentFailureReasons } from "@/lib/email/failure-reasons";
import { describeIntegration, unique } from "./_db";

/**
 * The Email Logs failure summary against the real schema.
 *
 * It is one GROUP BY over a CASE with array_agg(DISTINCT ...) FILTER, ordered
 * by an alias and an aggregate together, and the unit tier fakes pool.query,
 * so it answers that statement the same whether PostgreSQL would accept it or
 * not, and says nothing about which rows land in which group.
 */
describeIntegration("Email Logs failure summary", () => {
  beforeEach(async () => {
    await pool.query("DELETE FROM email_logs");
  });

  async function logFailure(fields: {
    template?: string | null;
    smtpCode?: number | null;
    smtpCommand?: string | null;
    errorCode?: string | null;
    message: string;
    ageHours?: number;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO email_logs
         (recipient, subject, status, error_message, template, smtp_code,
          smtp_command, error_code, created_at)
       VALUES ($1, 's', 'failed', $2, $3, $4, $5, $6,
               NOW() - ($7 || ' hours')::interval)`,
      [
        `${unique("rcpt")}@example.test`,
        fields.message,
        fields.template ?? null,
        fields.smtpCode ?? null,
        fields.smtpCommand ?? null,
        fields.errorCode ?? null,
        String(fields.ageHours ?? 0),
      ],
    );
  }

  it("puts a burst of one rejection on one line, with its count and the templates it hit", async () => {
    const spam = {
      smtpCode: 550,
      smtpCommand: "DATA",
      errorCode: "EMESSAGE",
      message: "Message failed: 550 5.7.0 Blocked by SpamAssassin",
    };
    await logFailure({ ...spam, template: "broadcast" });
    await logFailure({ ...spam, template: "broadcast" });
    await logFailure({ ...spam, template: "contactConfirmation" });

    const reasons = await getRecentFailureReasons();

    expect(reasons).toHaveLength(1);
    expect(reasons[0].count).toBe(3);
    expect(reasons[0].smtpCode).toBe(550);
    expect(reasons[0].smtpCommand).toBe("DATA");
    expect(reasons[0].sample).toContain("Blocked by SpamAssassin");
    expect([...reasons[0].templates].sort()).toEqual([
      "broadcast",
      "contactConfirmation",
    ]);
  });

  it("keeps a 550 at DATA apart from a 550 at RCPT TO", async () => {
    await logFailure({
      smtpCode: 550,
      smtpCommand: "DATA",
      errorCode: "EMESSAGE",
      message: "Message failed: 550 5.7.0 Blocked by SpamAssassin",
    });
    await logFailure({
      smtpCode: 550,
      smtpCommand: "RCPT TO",
      errorCode: "EENVELOPE",
      message: "Can not send mail - all recipients were rejected",
    });

    const reasons = await getRecentFailureReasons();

    expect(reasons.map((r) => r.smtpCommand).sort()).toEqual([
      "DATA",
      "RCPT TO",
    ]);
  });

  it("groups rows that never reached a relay on the start of their message", async () => {
    await logFailure({ message: "connect ETIMEDOUT 203.0.113.9:587" });
    await logFailure({ message: "connect ETIMEDOUT 203.0.113.9:587" });
    await logFailure({ message: "getaddrinfo ENOTFOUND smtp.example.test" });

    const reasons = await getRecentFailureReasons();

    expect(reasons.map((r) => r.count)).toEqual([2, 1]);
    expect(reasons[0].sample).toContain("ETIMEDOUT");
    expect(reasons[0].smtpCode).toBeNull();
  });

  it("counts only failures from the last day, and only failures", async () => {
    await logFailure({
      message: "Message failed: 550 5.7.0 old",
      smtpCode: 550,
      ageHours: 30,
    });
    await pool.query(
      `INSERT INTO email_logs (recipient, subject, status, smtp_code)
       VALUES ('ok@example.test', 's', 'sent', 250)`,
    );

    expect(await getRecentFailureReasons()).toEqual([]);
  });

  it("shows only the five biggest groups, most frequent first", async () => {
    for (let code = 1; code <= 7; code += 1) {
      for (let i = 0; i < code; i += 1) {
        await logFailure({
          smtpCode: 500 + code,
          smtpCommand: "DATA",
          message: `refused ${code}`,
        });
      }
    }

    const reasons = await getRecentFailureReasons();

    expect(reasons).toHaveLength(5);
    expect(reasons.map((r) => r.count)).toEqual([7, 6, 5, 4, 3]);
  });
});
