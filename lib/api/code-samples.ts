/**
 * Copy-pasteable request snippets for the API playground, generated from the
 * exact (method, url, headers, body) a live "Send" would use, in the most
 * common languages. Pure and dependency-free so it unit-tests without a
 * network or a DOM.
 *
 * The body is always embedded as a single-line JSON string (compacted from
 * whatever the user typed) and sent as the raw request body with a
 * Content-Type of application/json -- exactly what the browser fetch does -- so
 * the snippets never have to translate JSON into each language's object syntax.
 */

export interface CodeLanguage {
  id: string;
  label: string;
  /** Highlighter hint for the code block. */
  highlight: string;
}

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: "curl", label: "cURL", highlight: "bash" },
  { id: "javascript", label: "JavaScript", highlight: "javascript" },
  { id: "python", label: "Python", highlight: "python" },
  { id: "go", label: "Go", highlight: "go" },
  { id: "php", label: "PHP", highlight: "php" },
  { id: "java", label: "Java", highlight: "java" },
  { id: "ruby", label: "Ruby", highlight: "ruby" },
  { id: "csharp", label: "C#", highlight: "csharp" },
];

export interface RequestShape {
  method: string;
  /** Fully built request URL, query string included. */
  url: string;
  /** Raw JSON body the user would send, or undefined/empty for none. */
  body?: string;
  /** The pasted key, or undefined to render a placeholder instead. */
  apiKey?: string;
}

const KEY_PLACEHOLDER = "YOUR_API_KEY";

function keyValue(apiKey?: string): string {
  const trimmed = apiKey?.trim();
  return trimmed ? trimmed : KEY_PLACEHOLDER;
}

/** Compact the body to one line; fall back to the trimmed raw text if it is
 *  not valid JSON (the user is mid-edit), so a snippet is always producible. */
function compactBody(body: string | undefined): string | null {
  if (!body || !body.trim()) return null;
  try {
    return JSON.stringify(JSON.parse(body));
  } catch {
    return body.trim().replace(/\s+/g, " ");
  }
}

/** Escape for embedding inside a double-quoted Java/C# string literal. */
function dquote(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function curl(r: RequestShape, body: string | null): string {
  const lines = [`curl -X ${r.method.toUpperCase()} '${r.url}' \\`];
  lines.push(
    `  -H 'Authorization: Bearer ${keyValue(r.apiKey)}'${body ? " \\" : ""}`,
  );
  if (body) {
    lines.push(`  -H 'Content-Type: application/json' \\`);
    lines.push(`  -d '${body}'`);
  }
  return lines.join("\n");
}

function javascript(r: RequestShape, body: string | null): string {
  const headers = [`    Authorization: "Bearer ${keyValue(r.apiKey)}",`];
  if (body) headers.push(`    "Content-Type": "application/json",`);
  const opts = [
    `  method: "${r.method.toUpperCase()}",`,
    `  headers: {`,
    ...headers,
    `  },`,
  ];
  if (body) opts.push(`  body: JSON.stringify(${body}),`);
  return [
    `const res = await fetch("${r.url}", {`,
    ...opts,
    `});`,
    `const data = await res.json();`,
    `console.log(data);`,
  ].join("\n");
}

function python(r: RequestShape, body: string | null): string {
  const method = r.method.toLowerCase();
  const headers = body
    ? `{"Authorization": "Bearer ${keyValue(r.apiKey)}", "Content-Type": "application/json"}`
    : `{"Authorization": "Bearer ${keyValue(r.apiKey)}"}`;
  const args = [`    "${r.url}",`, `    headers=${headers},`];
  if (body) args.push(`    data='${body}',`);
  return [
    `import requests`,
    ``,
    `resp = requests.${method}(`,
    ...args,
    `)`,
    `print(resp.status_code, resp.json())`,
  ].join("\n");
}

function go(r: RequestShape, body: string | null): string {
  const imports = [`\t"fmt"`, `\t"io"`, `\t"net/http"`];
  if (body) imports.push(`\t"strings"`);
  const bodyExpr = body ? "body" : "nil";
  const lines = [
    `package main`,
    ``,
    `import (`,
    ...imports,
    `)`,
    ``,
    `func main() {`,
  ];
  if (body) lines.push(`\tbody := strings.NewReader(\`${body}\`)`);
  lines.push(
    `\treq, _ := http.NewRequest("${r.method.toUpperCase()}", "${r.url}", ${bodyExpr})`,
    `\treq.Header.Set("Authorization", "Bearer ${keyValue(r.apiKey)}")`,
  );
  if (body) lines.push(`\treq.Header.Set("Content-Type", "application/json")`);
  lines.push(
    `\tresp, err := http.DefaultClient.Do(req)`,
    `\tif err != nil {`,
    `\t\tpanic(err)`,
    `\t}`,
    `\tdefer resp.Body.Close()`,
    `\tout, _ := io.ReadAll(resp.Body)`,
    `\tfmt.Println(string(out))`,
    `}`,
  );
  return lines.join("\n");
}

function php(r: RequestShape, body: string | null): string {
  const headers = [`    "Authorization: Bearer ${keyValue(r.apiKey)}",`];
  if (body) headers.push(`    "Content-Type: application/json",`);
  const lines = [
    `<?php`,
    `$ch = curl_init("${r.url}");`,
    `curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "${r.method.toUpperCase()}");`,
    `curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);`,
    `curl_setopt($ch, CURLOPT_HTTPHEADER, [`,
    ...headers,
    `]);`,
  ];
  if (body) lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, '${body}');`);
  lines.push(
    `$response = curl_exec($ch);`,
    `curl_close($ch);`,
    `echo $response;`,
  );
  return lines.join("\n");
}

function java(r: RequestShape, body: string | null): string {
  const lines = [
    `import java.net.URI;`,
    `import java.net.http.*;`,
    ``,
    `HttpClient client = HttpClient.newHttpClient();`,
    `HttpRequest request = HttpRequest.newBuilder()`,
    `    .uri(URI.create("${r.url}"))`,
    `    .header("Authorization", "Bearer ${keyValue(r.apiKey)}")`,
  ];
  if (body) lines.push(`    .header("Content-Type", "application/json")`);
  const publisher = body
    ? `HttpRequest.BodyPublishers.ofString("${dquote(body)}")`
    : `HttpRequest.BodyPublishers.noBody()`;
  lines.push(
    `    .method("${r.method.toUpperCase()}", ${publisher})`,
    `    .build();`,
    `HttpResponse<String> response =`,
    `    client.send(request, HttpResponse.BodyHandlers.ofString());`,
    `System.out.println(response.body());`,
  );
  return lines.join("\n");
}

function ruby(r: RequestShape, body: string | null): string {
  const methodCap =
    r.method.charAt(0).toUpperCase() + r.method.slice(1).toLowerCase();
  const lines = [
    `require "net/http"`,
    `require "uri"`,
    ``,
    `uri = URI("${r.url}")`,
    `http = Net::HTTP.new(uri.host, uri.port)`,
    `http.use_ssl = uri.scheme == "https"`,
    `request = Net::HTTP::${methodCap}.new(uri)`,
    `request["Authorization"] = "Bearer ${keyValue(r.apiKey)}"`,
  ];
  if (body) {
    lines.push(`request["Content-Type"] = "application/json"`);
    lines.push(`request.body = '${body}'`);
  }
  lines.push(`response = http.request(request)`, `puts response.body`);
  return lines.join("\n");
}

function csharp(r: RequestShape, body: string | null): string {
  const lines = [`using System;`, `using System.Net.Http;`];
  if (body) lines.push(`using System.Text;`);
  lines.push(
    ``,
    `var client = new HttpClient();`,
    `var request = new HttpRequestMessage(`,
    `    new HttpMethod("${r.method.toUpperCase()}"), "${r.url}");`,
    `request.Headers.Add("Authorization", "Bearer ${keyValue(r.apiKey)}");`,
  );
  if (body) {
    lines.push(
      `request.Content = new StringContent(`,
      `    "${dquote(body)}", Encoding.UTF8, "application/json");`,
    );
  }
  lines.push(
    `var response = await client.SendAsync(request);`,
    `Console.WriteLine(await response.Content.ReadAsStringAsync());`,
  );
  return lines.join("\n");
}

const GENERATORS: Record<
  string,
  (r: RequestShape, body: string | null) => string
> = {
  curl,
  javascript,
  python,
  go,
  php,
  java,
  ruby,
  csharp,
};

/** Build the snippet for one language. Unknown language ids fall back to cURL. */
export function buildCodeSample(langId: string, req: RequestShape): string {
  const body =
    req.method.toUpperCase() === "GET" ? null : compactBody(req.body);
  const gen = GENERATORS[langId] ?? curl;
  return gen(req, body);
}
