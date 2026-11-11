import { describe, expect, it } from "vitest";
import {
  compileTable,
  detect,
  DISPLAY_FLOOR,
  noisyOr,
  validateTable,
} from "@/lib/scanner/inventory/engine";
import { buildInventoryInput } from "@/lib/scanner/inventory/input";
import type { Fingerprint } from "@/lib/scanner/inventory/types";

// A small table in the shape the data modules use. The weights are the ones in
// the research for the products these stand in for.
const TABLE: Fingerprint[] = [
  {
    name: "Laravel",
    category: "framework",
    implies: [{ name: "PHP", category: "language" }],
    rules: [
      {
        in: "cookie",
        name: /[-_]session$/,
        valueMatch: /^eyJpdiI6/,
        weight: 95,
        provenance: "fixture",
      },
      { in: "cookie", name: "XSRF-TOKEN", weight: 40, provenance: "fixture" },
      {
        in: "attr",
        tag: "input",
        name: "name",
        match: /^_token$/,
        weight: 30,
        provenance: "fixture",
      },
      {
        in: "asset",
        match: /\/build\/assets\/app-[\w-]{8}\.(?:js|css)$/,
        weight: 20,
        provenance: "fixture",
      },
    ],
  },
  {
    name: "Livewire",
    category: "framework",
    implies: [{ name: "Laravel", category: "framework" }],
    rules: [
      {
        in: "asset",
        match: /\/livewire(?:-[0-9a-f]{8})?\/livewire(?:\.min)?\.js/,
        weight: 98,
        provenance: "fixture",
      },
      { in: "attr", name: /^wire:/, weight: 90, provenance: "wappalyzer" },
    ],
  },
  {
    name: "WordPress",
    category: "cms",
    implies: [{ name: "PHP", category: "language" }],
    rules: [
      {
        in: "meta",
        name: "generator",
        match: /^WordPress(?:\s+(\d+\.\d+(?:\.\d+)?))?/i,
        version: { group: 1, minComponents: 2 },
        weight: 99,
        provenance: "fixture",
      },
      {
        in: "asset",
        match: /wp-emoji-release\.min\.js\?ver=(\d+\.\d+(?:\.\d+)?)/,
        version: { group: 1, minComponents: 2 },
        weight: 90,
        provenance: "fixture",
      },
    ],
  },
  {
    name: "Drupal",
    category: "cms",
    rules: [
      {
        in: "meta",
        name: "generator",
        match: /^Drupal\s+(\d+(?:\.\d+){0,2})/i,
        version: { group: 1 },
        weight: 97,
        provenance: "fixture",
      },
    ],
  },
  {
    name: "PHP",
    category: "language",
    rules: [
      {
        in: "header",
        name: "x-powered-by",
        match: /(?:^|,\s*)PHP\/?([\d.]+)?/i,
        version: { group: 1 },
        weight: 98,
        provenance: "fixture",
      },
      { in: "cookie", name: "PHPSESSID", weight: 85, provenance: "wappalyzer" },
    ],
  },
  {
    name: "nginx",
    category: "server",
    rules: [
      {
        in: "header",
        name: "Server",
        match: /^nginx(?:\/([\d.]+))?/i,
        version: { group: 1 },
        weight: 99,
        provenance: "fixture",
      },
    ],
  },
  {
    name: "Apache HTTP Server",
    category: "server",
    rules: [
      {
        in: "header",
        name: "server",
        match: /^Apache(?:\/([\d.]+))?/i,
        version: { group: 1 },
        weight: 99,
        provenance: "fixture",
      },
    ],
  },
  {
    name: "Cloudflare",
    category: "cdn",
    rules: [
      { in: "header", name: "cf-ray", weight: 99, provenance: "fixture" },
    ],
  },
];

function run(
  body: string,
  headers: [string, string][] = [],
  table: readonly Fingerprint[] = TABLE,
  url = "https://example.test/login",
) {
  const h = new Headers();
  for (const [name, value] of headers) h.append(name, value);
  return detect(buildInventoryInput(h, body, url), table);
}

const byName = (found: ReturnType<typeof run>, name: string) =>
  found.find((d) => d.name === name);

describe("noisyOr", () => {
  it("is zero with no evidence and the weight with one signal", () => {
    expect(noisyOr([])).toBe(0);
    expect(noisyOr([50])).toBe(50);
  });

  it("combines independent signals", () => {
    expect(noisyOr([50, 50])).toBe(75);
    expect(noisyOr([60, 40])).toBe(76);
    expect(noisyOr([20, 20, 20])).toBe(49);
  });

  it("reproduces the worked example from the design: five signals reach 99.97", () => {
    const unrounded = 100 * (1 - 0.05 * 0.6 * 0.7 * 0.8 * 0.02);
    expect(unrounded).toBeCloseTo(99.97, 2);
    expect(noisyOr([95, 40, 30, 20, 98])).toBe(100);
  });

  it("clamps weights outside 0..100", () => {
    expect(noisyOr([150])).toBe(100);
    expect(noisyOr([-20, 30])).toBe(30);
  });
});

describe("detect: a renamed Laravel app behind Cloudflare", () => {
  const page = [
    '<script src="/livewire-3f8a23f8/livewire.min.js?id=abc"></script>',
    '<form><input type="hidden" name="_token" value="abc"></form>',
    '<script src="/build/assets/app-a1b2c3d4.js"></script>',
  ].join("");
  const headers: [string, string][] = [
    ["server", "cloudflare"],
    ["cf-ray", "a535745249969435-MCI"],
    ["set-cookie", "XSRF-TOKEN=eyJpdiI6xxxxxxxx; path=/"],
    ["set-cookie", "wslatl-llc-session=eyJpdiI6yyyyyyyy; path=/; httponly"],
  ];

  it("finds Laravel through a cookie name the old exact match missed", () => {
    const laravel = byName(run(page, headers), "Laravel");
    expect(laravel?.confidence).toBe(100);
    expect(laravel?.evidence).toContain("cookie wslatl-llc-session");
  });

  it("finds Livewire and implies PHP", () => {
    const found = run(page, headers);
    expect(byName(found, "Livewire")?.confidence).toBe(98);
    const php = byName(found, "PHP");
    expect(php?.confidence).toBe(100);
    expect(php?.evidence).toEqual(["implied by Laravel"]);
    expect(php?.version).toBeUndefined();
  });

  it("matches the hyphenated and the underscored session name alike", () => {
    for (const name of ["app-session", "app_session"]) {
      const found = run("", [["set-cookie", `${name}=eyJpdiI6zzzz`]]);
      expect(byName(found, "Laravel")?.confidence).toBe(95);
    }
  });

  it("does not take a session cookie without the Laravel envelope for Laravel", () => {
    expect(
      byName(run("", [["set-cookie", "app_session=abc123"]]), "Laravel"),
    ).toBeUndefined();
  });

  it("keeps an XSRF-TOKEN cookie alone below the display floor", () => {
    const found = run("", [["set-cookie", "XSRF-TOKEN=abc"]]);
    expect(byName(found, "Laravel")).toBeUndefined();
    const all = detect(
      buildInventoryInput(
        new Headers([["set-cookie", "XSRF-TOKEN=abc"]]),
        "",
        "https://example.test/",
      ),
      TABLE,
      { floor: 0 },
    );
    expect(byName(all, "Laravel")?.confidence).toBe(40);
    expect(40).toBeLessThan(DISPLAY_FLOOR);
  });
});

describe("detect: implication", () => {
  it("lets a strong detection found late lift what a weak one implied early", () => {
    // Laravel alone: XSRF 40 + _token 30 + asset 20 = 66, so PHP is implied at
    // 66. Livewire (98) is another rule in the table that implies Laravel at
    // 98; once that lands Laravel reads 99 and PHP has to follow.
    const weakOnly = run(
      '<input name="_token"><script src="/build/assets/app-a1b2c3d4.js"></script>',
      [["set-cookie", "XSRF-TOKEN=a"]],
    );
    expect(byName(weakOnly, "PHP")?.confidence).toBe(66);

    const withLivewire = run(
      '<input name="_token"><script src="/build/assets/app-a1b2c3d4.js"></script><script src="/livewire/livewire.js"></script>',
      [["set-cookie", "XSRF-TOKEN=a"]],
    );
    expect(byName(withLivewire, "Laravel")?.confidence).toBeGreaterThanOrEqual(
      99,
    );
    expect(byName(withLivewire, "PHP")?.confidence).toBeGreaterThanOrEqual(99);
  });

  it("does not let a dropped detection imply anything", () => {
    const found = run("", [["set-cookie", "XSRF-TOKEN=a"]]);
    expect(byName(found, "PHP")).toBeUndefined();
  });

  it("scales an implication by its weight", () => {
    const table: Fingerprint[] = [
      {
        name: "A",
        category: "framework",
        implies: [{ name: "B", category: "language", weight: 70 }],
        rules: [
          { in: "header", name: "x-a", weight: 90, provenance: "fixture" },
        ],
      },
    ];
    expect(byName(run("", [["x-a", "1"]], table), "B")?.confidence).toBe(63);
  });

  it("takes the category of an implied product from the implication when the table has no entry", () => {
    const table: Fingerprint[] = [
      {
        name: "A",
        category: "framework",
        implies: [{ name: "Python", category: "runtime" }],
        rules: [
          { in: "header", name: "x-a", weight: 90, provenance: "fixture" },
        ],
      },
    ];
    expect(byName(run("", [["x-a", "1"]], table), "Python")?.category).toBe(
      "runtime",
    );
  });

  it("does not raise two products that imply each other to certainty", () => {
    const table: Fingerprint[] = [
      {
        name: "A",
        category: "framework",
        implies: [{ name: "B", category: "framework" }],
        rules: [
          { in: "header", name: "x-a", weight: 62, provenance: "fixture" },
        ],
      },
      {
        name: "B",
        category: "framework",
        implies: [{ name: "A", category: "framework" }],
        rules: [
          { in: "header", name: "x-b", weight: 10, provenance: "fixture" },
        ],
      },
    ];
    const found = run("", [["x-a", "1"]], table);
    expect(byName(found, "A")?.confidence).toBe(62);
    expect(byName(found, "B")?.confidence).toBe(62);
  });

  it("terminates on a cycle of three", () => {
    const rule = (h: string) => ({
      in: "header" as const,
      name: h,
      weight: 70,
      provenance: "fixture" as const,
    });
    const table: Fingerprint[] = [
      {
        name: "A",
        category: "framework",
        implies: [{ name: "B", category: "framework" }],
        rules: [rule("x-a")],
      },
      {
        name: "B",
        category: "framework",
        implies: [{ name: "C", category: "framework" }],
        rules: [rule("x-b")],
      },
      {
        name: "C",
        category: "framework",
        implies: [{ name: "A", category: "framework" }],
        rules: [rule("x-c")],
      },
    ];
    const found = run("", [["x-a", "1"]], table);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((d) => d.confidence <= 100)).toBe(true);
  });
});

describe("detect: requires", () => {
  const table: Fingerprint[] = [
    {
      name: "Laravel",
      category: "framework",
      rules: [
        {
          in: "cookie",
          name: "laravel_session",
          weight: 95,
          provenance: "fixture",
        },
      ],
    },
    {
      name: "Inertia",
      category: "framework",
      requires: ["Laravel"],
      rules: [
        { in: "attr", name: "data-page", weight: 80, provenance: "fixture" },
      ],
    },
  ];

  it("runs a product's rules only when what it requires was found", () => {
    const withBase = run(
      '<div data-page="{}"></div>',
      [["set-cookie", "laravel_session=x"]],
      table,
    );
    expect(byName(withBase, "Inertia")?.confidence).toBe(80);
    expect(
      byName(run('<div data-page="{}"></div>', [], table), "Inertia"),
    ).toBeUndefined();
  });

  it("counts a requirement that is itself only implied", () => {
    const chain: Fingerprint[] = [
      {
        name: "Livewire",
        category: "framework",
        implies: [{ name: "Laravel", category: "framework" }],
        rules: [
          {
            in: "asset",
            match: /livewire\.js/,
            weight: 98,
            provenance: "fixture",
          },
        ],
      },
      table[1],
    ];
    const found = run(
      '<script src="/livewire.js"></script><div data-page="{}"></div>',
      [],
      chain,
    );
    expect(byName(found, "Inertia")?.confidence).toBe(80);
  });

  it("does not run a required rule when the requirement is below the floor", () => {
    const weak: Fingerprint[] = [
      {
        ...table[0],
        rules: [
          {
            in: "cookie",
            name: "laravel_session",
            weight: 40,
            provenance: "fixture",
          },
        ],
      },
      table[1],
    ];
    const found = run(
      '<div data-page="{}"></div>',
      [["set-cookie", "laravel_session=x"]],
      weak,
    );
    expect(byName(found, "Inertia")).toBeUndefined();
  });
});

describe("detect: versions", () => {
  it("reads the WordPress generator as exact with two components", () => {
    const found = run('<meta name="generator" content="WordPress 6.4">');
    expect(byName(found, "WordPress")).toMatchObject({
      version: "6.4",
      versionKind: "exact",
    });
  });

  it("marks Drupal's major-only generator as major so no lookup runs on it", () => {
    const found = run(
      '<meta name="generator" content="Drupal 10 (https://www.drupal.org)">',
    );
    expect(byName(found, "Drupal")).toMatchObject({
      version: "10",
      versionKind: "major",
    });
  });

  it("marks a version partial when two strong rules disagree", () => {
    const found = run(
      '<meta name="generator" content="WordPress 6.4.2"><script src="/wp-includes/js/wp-emoji-release.min.js?ver=6.2.1"></script>',
    );
    expect(byName(found, "WordPress")).toMatchObject({
      version: "6.4.2",
      versionKind: "partial",
    });
  });

  it("keeps the version when two strong rules agree", () => {
    const found = run(
      '<meta name="generator" content="WordPress 6.4.2"><script src="/wp-includes/js/wp-emoji-release.min.js?ver=6.4.2"></script>',
    );
    expect(byName(found, "WordPress")).toMatchObject({
      version: "6.4.2",
      versionKind: "exact",
    });
  });

  it("reports a prerelease", () => {
    const table: Fingerprint[] = [
      {
        name: "PHP",
        category: "language",
        rules: [
          {
            in: "header",
            name: "x-powered-by",
            match: /^PHP\/([\w.+~-]+)/,
            version: { group: 1 },
            weight: 98,
            provenance: "fixture",
          },
        ],
      },
    ];
    const found = run("", [["x-powered-by", "PHP/8.4.0-rc1"]], table);
    expect(byName(found, "PHP")).toMatchObject({
      version: "8.4.0",
      versionKind: "prerelease",
    });
  });

  it("reads a version-bearing header and finds no version when the header has none", () => {
    expect(
      byName(run("", [["server", "nginx/1.18.0"]]), "nginx"),
    ).toMatchObject({
      version: "1.18.0",
      versionKind: "exact",
    });
    const bare = byName(run("", [["server", "nginx"]]), "nginx");
    expect(bare?.version).toBeUndefined();
    expect(bare?.versionKind).toBeUndefined();
  });

  it("takes the distro from the Server header parentheses", () => {
    const found = run("", [["server", "Apache/2.4.41 (Ubuntu)"]]);
    expect(byName(found, "Apache HTTP Server")).toMatchObject({
      version: "2.4.41",
      versionKind: "exact",
      patchedBy: "Ubuntu",
    });
  });

  it("does not call an OS name a distro patch", () => {
    const found = run("", [["server", "Apache/2.4.58 (Win64) OpenSSL/3.1.3"]]);
    expect(byName(found, "Apache HTTP Server")?.patchedBy).toBeUndefined();
    const unix = run("", [["server", "Apache/2.4.58 (Unix)"]]);
    expect(byName(unix, "Apache HTTP Server")?.patchedBy).toBeUndefined();
  });

  it("only reports patchedBy for a version that came from the Server header", () => {
    const found = run("", [
      ["server", "Apache (Debian)"],
      ["x-powered-by", "PHP/8.2.7"],
    ]);
    expect(byName(found, "PHP")?.patchedBy).toBeUndefined();
    expect(byName(found, "Apache HTTP Server")?.version).toBeUndefined();
    expect(byName(found, "Apache HTTP Server")?.patchedBy).toBeUndefined();
  });
});

describe("detect: output", () => {
  it("never carries a cookie value, a query string or a token in the output", () => {
    const secret = "S3cr3tValue".repeat(6).slice(0, 64);
    expect(secret).toHaveLength(64);
    const found = run(
      `<script src="/livewire/livewire.min.js?id=${secret}"></script><input name="_token" value="${secret}">`,
      [
        ["set-cookie", `my-session=eyJpdiI6${secret}; path=/`],
        ["set-cookie", `XSRF-TOKEN=${secret}`],
        ["set-cookie", `PHPSESSID=${secret}`],
      ],
    );
    expect(found.map((d) => d.name).sort()).toEqual([
      "Laravel",
      "Livewire",
      "PHP",
    ]);
    const dump = JSON.stringify(found);
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain("eyJpdiI6");
    expect(dump).not.toContain("?id=");
  });

  it("labels evidence by path only, whatever the origin", () => {
    const found = run(
      '<script src="https://cdn.other.test/livewire/livewire.min.js?v=1#frag"></script>',
    );
    expect(byName(found, "Livewire")?.evidence).toEqual([
      "asset /livewire/livewire.min.js",
    ]);
  });

  it("lists evidence strongest first without repeating a label", () => {
    const found = run(
      '<script src="/livewire/livewire.js"></script><div wire:click="x"></div><div wire:model="y"></div>',
    );
    const evidence = byName(found, "Livewire")?.evidence ?? [];
    expect(evidence[0]).toBe("asset /livewire/livewire.js");
    expect(new Set(evidence).size).toBe(evidence.length);
  });

  it("sorts by category priority then confidence", () => {
    const found = run('<meta name="generator" content="WordPress 6.4.2">', [
      ["server", "nginx/1.18.0"],
      ["cf-ray", "x"],
    ]);
    expect(found.map((d) => d.category)).toEqual([
      "cms",
      "server",
      "language",
      "cdn",
    ]);
  });

  it("returns nothing for a response with no signal", () => {
    expect(run("<html><body>hello</body></html>")).toEqual([]);
  });
});

describe("detect: robustness", () => {
  it("skips a rule that throws and still runs the rest of the table", () => {
    const boom = {
      exec() {
        throw new Error("boom");
      },
    } as unknown as RegExp;
    const table: Fingerprint[] = [
      {
        name: "Broken",
        category: "framework",
        rules: [{ in: "html", match: boom, weight: 90, provenance: "fixture" }],
      },
      TABLE[5],
    ];
    const found = run("<p>x</p>", [["server", "nginx/1.18.0"]], table);
    expect(found.map((d) => d.name)).toEqual(["nginx"]);
  });

  it("returns an empty list rather than throwing on a broken table", () => {
    expect(
      detect(
        buildInventoryInput(new Headers(), "", "https://example.test/"),
        null as unknown as Fingerprint[],
      ),
    ).toEqual([]);
  });

  it("gives the same answer twice for a rule written with the global flag", () => {
    const table: Fingerprint[] = [
      {
        name: "G",
        category: "framework",
        rules: [
          { in: "html", match: /marker/g, weight: 90, provenance: "fixture" },
        ],
      },
    ];
    const input = buildInventoryInput(
      new Headers(),
      "<p>marker</p>",
      "https://example.test/",
    );
    expect(detect(input, table)).toHaveLength(1);
    expect(detect(input, table)).toHaveLength(1);
  });

  it("matches header, meta and attribute names whatever case the table spells them", () => {
    const table: Fingerprint[] = [
      {
        name: "X",
        category: "framework",
        rules: [
          { in: "header", name: "X-Thing", weight: 50, provenance: "fixture" },
          { in: "meta", name: "Thing-Meta", weight: 50, provenance: "fixture" },
          {
            in: "attr",
            tag: "DIV",
            name: "Data-Thing",
            weight: 50,
            provenance: "fixture",
          },
        ],
      },
    ];
    const found = run(
      '<meta name="thing-meta" content="1"><div data-thing="1"></div>',
      [["x-thing", "1"]],
      table,
    );
    expect(byName(found, "X")?.confidence).toBe(88);
  });

  it("runs title and comment rules", () => {
    const table: Fingerprint[] = [
      {
        name: "phpMyAdmin",
        category: "panel",
        rules: [
          {
            in: "title",
            match: /\| phpMyAdmin ([\d.]+)/,
            version: { group: 1 },
            weight: 98,
            provenance: "wappalyzer",
          },
          {
            in: "comment",
            match: /<!-- cPanel/,
            weight: 90,
            provenance: "wappalyzer",
          },
        ],
      },
    ];
    const found = run(
      "<title>Login | phpMyAdmin 5.2.1</title><!-- cPanel -->",
      [],
      table,
    );
    expect(byName(found, "phpMyAdmin")).toMatchObject({
      version: "5.2.1",
      confidence: 100,
    });
  });
});

describe("a rule's source", () => {
  const source = { upstream: "webappanalyzer", technology: "Laravel" } as const;
  const table: Fingerprint[] = [
    {
      name: "Laravel",
      category: "framework",
      rules: [
        {
          in: "cookie",
          name: "laravel_session",
          weight: 95,
          provenance: "wappalyzer",
          source,
        },
        { in: "cookie", name: "XSRF-TOKEN", weight: 40, provenance: "fixture" },
      ],
    },
  ];

  it("survives into the compiled rule table", () => {
    const compiled = compileTable(table);
    const rules = compiled.byName.get("Laravel")?.rules ?? [];
    expect(rules[0].source).toEqual(source);
    expect(rules[1].source).toBeUndefined();
  });

  it("is never read for matching", () => {
    const without = table.map((f) => ({
      ...f,
      rules: f.rules.map(
        ({ source: _source, ...rule }) => rule as (typeof f.rules)[number],
      ),
    }));
    const headers = [["set-cookie", "laravel_session=abc"]] as [
      string,
      string,
    ][];
    expect(run("", headers, table)).toEqual(run("", headers, without));
  });

  it("is accepted by validation and rejected when it names no technology", () => {
    expect(validateTable(table)).toEqual([]);
    const blank: Fingerprint[] = [
      {
        ...table[0],
        rules: [
          {
            ...table[0].rules[0],
            source: { upstream: "webappanalyzer", technology: " " },
          },
        ],
      },
    ];
    expect(validateTable(blank).join("\n")).toContain("names no technology");
  });
});

describe("validateTable", () => {
  it("accepts a sound table", () => {
    expect(validateTable(TABLE)).toEqual([]);
  });

  it("reports duplicate names, empty rules, bad weights and unproven weights", () => {
    const table: Fingerprint[] = [
      {
        name: "A",
        category: "cms",
        rules: [
          { in: "header", name: "x", weight: 100, provenance: "fixture" },
        ],
      },
      { name: "A", category: "cms", rules: [] },
      {
        name: "B",
        category: "cms",
        rules: [
          { in: "header", name: "x", weight: 90, provenance: "vendor-docs" },
        ],
      },
      {
        name: "C",
        category: "cms",
        requires: ["Nope"],
        rules: [
          { in: "header", name: "x", weight: 10.5, provenance: "fixture" },
        ],
      },
      {
        name: "D",
        category: "cms",
        rules: [
          {
            in: "html",
            match: /x(.)/,
            version: { group: 0 },
            weight: 10,
            provenance: "fixture",
          },
        ],
      },
    ];
    const text = validateTable(table).join("\n");
    expect(text).toContain("A: name is not unique");
    expect(text).toContain("A: no rules");
    expect(text).toContain("weight 100 is outside");
    expect(text).toContain("vendor-docs rule is capped at 80");
    expect(text).toContain("weight 10.5 is outside");
    expect(text).toContain("requires Nope");
    expect(text).toContain("version group");
  });

  it("allows a requirement that an implication provides", () => {
    const table: Fingerprint[] = [
      {
        name: "A",
        category: "cms",
        implies: [{ name: "PHP", category: "language" }],
        rules: [{ in: "header", name: "x", weight: 10, provenance: "fixture" }],
      },
      {
        name: "B",
        category: "cms",
        requires: ["PHP"],
        rules: [{ in: "header", name: "y", weight: 10, provenance: "fixture" }],
      },
    ];
    expect(validateTable(table)).toEqual([]);
  });
});
