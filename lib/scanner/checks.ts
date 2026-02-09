import type { Vulnerability } from "./types"

type CheckFn = (url: string, headers: Headers, body: string) => Vulnerability | null

function generateId(): string {
  return Math.random().toString(36).substring(2, 10)
}

const checkStrictTransportSecurity: CheckFn = (url, headers) => {
  const hsts = headers.get("strict-transport-security")
  if (url.startsWith("https://") && !hsts) {
    return {
      id: generateId(),
      title: "Missing HTTP Strict Transport Security (HSTS)",
      severity: "high",
      category: "headers",
      description:
        "The server does not send the Strict-Transport-Security header, which tells browsers to only connect via HTTPS.",
      evidence: "Header 'Strict-Transport-Security' is not present in the response.",
      riskImpact:
        "Attackers could intercept traffic via man-in-the-middle attacks by downgrading the connection from HTTPS to HTTP.",
      explanation:
        "HSTS instructs browsers to only access the site over HTTPS for a specified duration. Without it, users who type the URL without 'https://' or follow an HTTP link are vulnerable to SSL-stripping attacks. Once a browser sees the HSTS header, it will refuse to connect over plain HTTP for the specified max-age period.",
      fixSteps: [
        "Add the Strict-Transport-Security header to all HTTPS responses.",
        "Set a max-age of at least 31536000 (1 year).",
        "Consider adding includeSubDomains and preload directives.",
        "Ensure your entire site works over HTTPS before enabling.",
      ],
      codeExamples: [
        {
          label: "Next.js (next.config.mjs)",
          language: "javascript",
          code: `// next.config.mjs
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;`,
        },
        {
          label: "Nginx",
          language: "nginx",
          code: `# Add to your server block
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;`,
        },
      ],
    }
  }
  return null
}

const checkContentSecurityPolicy: CheckFn = (_url, headers) => {
  const csp = headers.get("content-security-policy")
  if (!csp) {
    return {
      id: generateId(),
      title: "Missing Content Security Policy (CSP)",
      severity: "high",
      category: "headers",
      description:
        "No Content-Security-Policy header was found. CSP helps prevent cross-site scripting (XSS) and data injection attacks.",
      evidence: "Header 'Content-Security-Policy' is not present in the response.",
      riskImpact:
        "Without CSP, the site is more vulnerable to XSS attacks because browsers have no policy to restrict which scripts and resources can execute.",
      explanation:
        "Content Security Policy is a defense-in-depth mechanism that restricts which resources (scripts, styles, images, etc.) the browser is allowed to load. By defining a strict policy, you prevent attackers from injecting malicious scripts even if they find an injection point in your application.",
      fixSteps: [
        "Define a Content-Security-Policy header with restrictive defaults.",
        "Start with a report-only policy to identify issues: Content-Security-Policy-Report-Only.",
        "Use 'self' as the default-src and explicitly allow trusted origins.",
        "Avoid 'unsafe-inline' and 'unsafe-eval' where possible; use nonces or hashes instead.",
      ],
      codeExamples: [
        {
          label: "Next.js (next.config.mjs)",
          language: "javascript",
          code: `// next.config.mjs
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';",
          },
        ],
      },
    ];
  },
};

export default nextConfig;`,
        },
        {
          label: "HTML Meta Tag",
          language: "html",
          code: `<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';">`,
        },
      ],
    }
  }
  return null
}

const checkXFrameOptions: CheckFn = (_url, headers) => {
  const xfo = headers.get("x-frame-options")
  const csp = headers.get("content-security-policy")
  const hasFrameAncestors = csp?.includes("frame-ancestors")

  if (!xfo && !hasFrameAncestors) {
    return {
      id: generateId(),
      title: "Missing Clickjacking Protection",
      severity: "medium",
      category: "headers",
      description:
        "Neither X-Frame-Options nor CSP frame-ancestors directive is set, leaving the site vulnerable to clickjacking.",
      evidence:
        "Header 'X-Frame-Options' is not present and 'frame-ancestors' directive was not found in CSP.",
      riskImpact:
        "Attackers can embed your site in a hidden iframe and trick users into clicking on elements they don't intend to, potentially performing unauthorized actions.",
      explanation:
        "Clickjacking is an attack where a malicious site embeds your site in a transparent iframe. Users think they're interacting with the visible page but are actually clicking on your site. X-Frame-Options and CSP frame-ancestors both prevent your page from being framed by unauthorized origins.",
      fixSteps: [
        "Add X-Frame-Options: DENY or SAMEORIGIN to your responses.",
        "Alternatively, use the CSP frame-ancestors directive for more granular control.",
        "DENY prevents all framing; SAMEORIGIN allows framing only from the same origin.",
      ],
      codeExamples: [
        {
          label: "Next.js (next.config.mjs)",
          language: "javascript",
          code: `// next.config.mjs
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
        ],
      },
    ];
  },
};

export default nextConfig;`,
        },
        {
          label: "Apache (.htaccess)",
          language: "apache",
          code: `Header always set X-Frame-Options "DENY"`,
        },
      ],
    }
  }
  return null
}

const checkXContentTypeOptions: CheckFn = (_url, headers) => {
  const xcto = headers.get("x-content-type-options")
  if (!xcto) {
    return {
      id: generateId(),
      title: "Missing X-Content-Type-Options Header",
      severity: "medium",
      category: "headers",
      description:
        "The X-Content-Type-Options header is not set. This header prevents MIME-type sniffing.",
      evidence: "Header 'X-Content-Type-Options' is not present in the response.",
      riskImpact:
        "Browsers may interpret files as a different MIME type than declared, which can lead to XSS attacks if, for example, a plaintext file is sniffed as HTML.",
      explanation:
        "MIME sniffing is when browsers try to determine the content type by examining the content rather than trusting the Content-Type header. Setting X-Content-Type-Options to 'nosniff' tells the browser to strictly follow the declared Content-Type and not attempt to sniff the content type.",
      fixSteps: [
        "Add the header X-Content-Type-Options: nosniff to all responses.",
        "Ensure all resources are served with the correct Content-Type header.",
      ],
      codeExamples: [
        {
          label: "Next.js (next.config.mjs)",
          language: "javascript",
          code: `// next.config.mjs
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ];
  },
};

export default nextConfig;`,
        },
        {
          label: "Nginx",
          language: "nginx",
          code: `add_header X-Content-Type-Options "nosniff" always;`,
        },
      ],
    }
  }
  return null
}

const checkReferrerPolicy: CheckFn = (_url, headers) => {
  const rp = headers.get("referrer-policy")
  if (!rp) {
    return {
      id: generateId(),
      title: "Missing Referrer-Policy Header",
      severity: "low",
      category: "headers",
      description:
        "The Referrer-Policy header is not set. This controls how much referrer information is sent with requests.",
      evidence: "Header 'Referrer-Policy' is not present in the response.",
      riskImpact:
        "Sensitive information in URLs (tokens, IDs) may be leaked to third-party sites through the Referer header when users navigate away.",
      explanation:
        "By default, browsers send the full URL in the Referer header when navigating between pages. If your URLs contain sensitive data (session tokens, user IDs, search queries), this data leaks to any external site the user visits next. Setting a Referrer-Policy limits this disclosure.",
      fixSteps: [
        "Add Referrer-Policy: strict-origin-when-cross-origin (recommended default).",
        "For maximum privacy, use no-referrer or same-origin.",
        "Avoid using unsafe-url which sends the full URL to all origins.",
      ],
      codeExamples: [
        {
          label: "Next.js (next.config.mjs)",
          language: "javascript",
          code: `// next.config.mjs
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;`,
        },
        {
          label: "HTML Meta Tag",
          language: "html",
          code: `<meta name="referrer" content="strict-origin-when-cross-origin">`,
        },
      ],
    }
  }
  return null
}

const checkPermissionsPolicy: CheckFn = (_url, headers) => {
  const pp =
    headers.get("permissions-policy") || headers.get("feature-policy")
  if (!pp) {
    return {
      id: generateId(),
      title: "Missing Permissions-Policy Header",
      severity: "low",
      category: "headers",
      description:
        "The Permissions-Policy (formerly Feature-Policy) header is not set. This header controls which browser features and APIs can be used.",
      evidence:
        "Neither 'Permissions-Policy' nor 'Feature-Policy' headers are present in the response.",
      riskImpact:
        "Third-party scripts or iframes could access powerful browser APIs like camera, microphone, or geolocation without explicit permission from your site.",
      explanation:
        "Permissions-Policy allows you to selectively enable or disable browser features for your page and any embedded iframes. This limits the attack surface by preventing unauthorized access to sensitive device APIs like camera, microphone, geolocation, and payment requests.",
      fixSteps: [
        "Add a Permissions-Policy header that disables features you don't use.",
        "Common features to restrict: camera, microphone, geolocation, payment, usb.",
        "Set features to () (empty) to disable, or self to allow only same-origin.",
      ],
      codeExamples: [
        {
          label: "Next.js (next.config.mjs)",
          language: "javascript",
          code: `// next.config.mjs
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;`,
        },
        {
          label: "Nginx",
          language: "nginx",
          code: `add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;`,
        },
      ],
    }
  }
  return null
}

const checkServerHeader: CheckFn = (_url, headers) => {
  const server = headers.get("server")
  const poweredBy = headers.get("x-powered-by")

  if (server || poweredBy) {
    const disclosed: string[] = []
    if (server) disclosed.push(`Server: ${server}`)
    if (poweredBy) disclosed.push(`X-Powered-By: ${poweredBy}`)

    return {
      id: generateId(),
      title: "Server Technology Information Disclosure",
      severity: "info",
      category: "information-disclosure",
      description:
        "The server reveals technology information through response headers, which can help attackers target known vulnerabilities.",
      evidence: `Disclosed headers: ${disclosed.join(", ")}`,
      riskImpact:
        "Knowing the exact server software and version allows attackers to search for and exploit known vulnerabilities specific to that technology stack.",
      explanation:
        "HTTP response headers like Server and X-Powered-By reveal the technology stack running on the server. While this information alone isn't a vulnerability, it aids attackers in reconnaissance by narrowing down which exploits to try. Removing or obscuring these headers follows the principle of security through obscurity as a defense layer.",
      fixSteps: [
        "Remove or obscure the Server header in your web server configuration.",
        "Remove the X-Powered-By header entirely.",
        "In Express.js, use helmet or app.disable('x-powered-by').",
      ],
      codeExamples: [
        {
          label: "Next.js (next.config.mjs)",
          language: "javascript",
          code: `// next.config.mjs
const nextConfig = {
  poweredByHeader: false,
};

export default nextConfig;`,
        },
        {
          label: "Nginx",
          language: "nginx",
          code: `# In the http block
server_tokens off;`,
        },
      ],
    }
  }
  return null
}

const checkMixedContent: CheckFn = (url, _headers, body) => {
  if (!url.startsWith("https://")) return null

  const httpPatterns = [
    /src=["']http:\/\//gi,
    /href=["']http:\/\//gi,
    /url\(["']?http:\/\//gi,
  ]

  const matches: string[] = []
  for (const pattern of httpPatterns) {
    const found = body.match(pattern)
    if (found) matches.push(...found.slice(0, 3))
  }

  if (matches.length > 0) {
    return {
      id: generateId(),
      title: "Mixed Content Detected",
      severity: "medium",
      category: "content",
      description:
        "The HTTPS page loads resources over insecure HTTP connections, which can be intercepted or tampered with.",
      evidence: `Found ${matches.length} HTTP resource reference(s): ${matches.slice(0, 3).join(", ")}${matches.length > 3 ? "..." : ""}`,
      riskImpact:
        "Resources loaded over HTTP on an HTTPS page can be intercepted by attackers, potentially injecting malicious scripts or altering content.",
      explanation:
        "Mixed content occurs when an HTTPS page includes resources fetched over HTTP. Browsers may block some types (active mixed content like scripts) and warn about others (passive mixed content like images). All resources on HTTPS pages should also be loaded via HTTPS.",
      fixSteps: [
        "Update all resource URLs to use HTTPS or protocol-relative URLs (//).",
        "Use the CSP directive upgrade-insecure-requests to automatically upgrade HTTP to HTTPS.",
        "Audit all external resource references in your HTML, CSS, and JavaScript.",
      ],
      codeExamples: [
        {
          label: "CSP Auto-Upgrade",
          language: "html",
          code: `<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">`,
        },
        {
          label: "Next.js (next.config.mjs)",
          language: "javascript",
          code: `// next.config.mjs
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "upgrade-insecure-requests",
          },
        ],
      },
    ];
  },
};

export default nextConfig;`,
        },
      ],
    }
  }
  return null
}

const checkOpenRedirectHints: CheckFn = (_url, _headers, body) => {
  const patterns = [
    /\?redirect=/gi,
    /\?next=/gi,
    /\?url=/gi,
    /\?return_to=/gi,
    /\?returnUrl=/gi,
    /\?goto=/gi,
  ]

  const matches: string[] = []
  for (const pattern of patterns) {
    const found = body.match(pattern)
    if (found) matches.push(...found.slice(0, 2))
  }

  if (matches.length > 0) {
    return {
      id: generateId(),
      title: "Potential Open Redirect Parameters",
      severity: "medium",
      category: "content",
      description:
        "The page contains URL parameters commonly associated with open redirect vulnerabilities.",
      evidence: `Found redirect-related parameters: ${matches.join(", ")}`,
      riskImpact:
        "Open redirects can be used in phishing attacks by making malicious URLs appear to originate from your trusted domain.",
      explanation:
        "Open redirect vulnerabilities occur when a web application takes a user-supplied URL parameter and redirects to it without validation. Attackers craft links that appear to be on your domain but redirect users to malicious sites, making phishing attacks more convincing.",
      fixSteps: [
        "Validate all redirect URLs against an allowlist of permitted domains.",
        "Use relative URLs for redirects instead of absolute URLs.",
        "Reject any redirect URL that points to an external domain.",
        "Implement server-side URL validation before performing redirects.",
      ],
      codeExamples: [
        {
          label: "Next.js (Route Handler)",
          language: "typescript",
          code: `// app/api/redirect/route.ts
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOSTS = ["yourdomain.com", "app.yourdomain.com"];

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("url") || "/";

  // Only allow relative URLs or URLs to allowed hosts
  try {
    const url = new URL(target, request.url);
    if (!ALLOWED_HOSTS.includes(url.hostname)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(new URL("/", request.url));
  }
}`,
        },
        {
          label: "Generic Validation",
          language: "javascript",
          code: `function isSafeRedirect(url) {
  // Only allow relative URLs
  if (url.startsWith("/") && !url.startsWith("//")) {
    return true;
  }
  // Or URLs to your own domain
  try {
    const parsed = new URL(url);
    return parsed.hostname === "yourdomain.com";
  } catch {
    return false;
  }
}`,
        },
      ],
    }
  }
  return null
}

const checkCookieSecurity: CheckFn = (_url, headers) => {
  const setCookieHeaders: string[] = []
  // Headers.getSetCookie is available in modern runtimes
  const raw = headers.get("set-cookie")
  if (raw) setCookieHeaders.push(raw)

  const insecureCookies: string[] = []

  for (const cookie of setCookieHeaders) {
    const parts = cookie.toLowerCase()
    const issues: string[] = []
    if (!parts.includes("httponly")) issues.push("missing HttpOnly")
    if (!parts.includes("secure")) issues.push("missing Secure")
    if (!parts.includes("samesite")) issues.push("missing SameSite")
    if (issues.length > 0) {
      const name = cookie.split("=")[0].trim()
      insecureCookies.push(`${name} (${issues.join(", ")})`)
    }
  }

  if (insecureCookies.length > 0) {
    return {
      id: generateId(),
      title: "Insecure Cookie Configuration",
      severity: "medium",
      category: "cookies",
      description:
        "One or more cookies are missing important security flags that protect against common attacks.",
      evidence: `Insecure cookies: ${insecureCookies.join("; ")}`,
      riskImpact:
        "Cookies without proper security flags can be stolen via XSS attacks (missing HttpOnly), sent over insecure connections (missing Secure), or exploited in CSRF attacks (missing SameSite).",
      explanation:
        "Cookie security flags provide essential protection: HttpOnly prevents JavaScript from accessing the cookie (mitigating XSS-based session theft), Secure ensures cookies are only sent over HTTPS, and SameSite prevents the cookie from being sent in cross-site requests (mitigating CSRF attacks).",
      fixSteps: [
        "Add HttpOnly flag to all session and authentication cookies.",
        "Add Secure flag to ensure cookies are only sent over HTTPS.",
        "Add SameSite=Lax or SameSite=Strict to prevent CSRF.",
      ],
      codeExamples: [
        {
          label: "Next.js (Route Handler)",
          language: "typescript",
          code: `// app/api/login/route.ts
import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set("session", "token-value", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
  return response;
}`,
        },
        {
          label: "Express.js",
          language: "javascript",
          code: `app.use(session({
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));`,
        },
      ],
    }
  }
  return null
}

const checkDeprecatedTLS: CheckFn = (url) => {
  // We can only check if the site supports HTTPS by whether it redirects or is accessible
  if (url.startsWith("http://")) {
    return {
      id: generateId(),
      title: "Site Accessible Over Unencrypted HTTP",
      severity: "high",
      category: "ssl",
      description:
        "The site was scanned over plain HTTP. All traffic including credentials and sensitive data is transmitted without encryption.",
      evidence: `URL scheme: ${url.split("://")[0]}://`,
      riskImpact:
        "All data transmitted between the user and server can be intercepted, read, and modified by anyone on the network path (man-in-the-middle attacks).",
      explanation:
        "HTTP transmits data in plaintext, making it trivial for attackers on the same network to intercept login credentials, session tokens, personal data, and any other information exchanged. HTTPS encrypts all traffic using TLS, preventing eavesdropping and tampering.",
      fixSteps: [
        "Obtain and install an SSL/TLS certificate (e.g., from Let's Encrypt).",
        "Configure your server to redirect all HTTP traffic to HTTPS.",
        "Update all internal links and resources to use HTTPS.",
        "Enable HSTS to ensure browsers always use HTTPS.",
      ],
      codeExamples: [
        {
          label: "Nginx HTTPS Redirect",
          language: "nginx",
          code: `server {
  listen 80;
  server_name yourdomain.com;
  return 301 https://$host$request_uri;
}`,
        },
        {
          label: "Vercel (vercel.json)",
          language: "json",
          code: `{
  "redirects": [
    {
      "source": "/(.*)",
      "has": [{ "type": "header", "key": "x-forwarded-proto", "value": "http" }],
      "destination": "https://yourdomain.com/$1",
      "permanent": true
    }
  ]
}`,
        },
      ],
    }
  }
  return null
}

const checkCORSMisconfiguration: CheckFn = (_url, headers) => {
  const acao = headers.get("access-control-allow-origin")
  if (acao === "*") {
    return {
      id: generateId(),
      title: "Wildcard CORS Policy",
      severity: "medium",
      category: "headers",
      description:
        "The Access-Control-Allow-Origin header is set to '*', allowing any origin to make cross-origin requests.",
      evidence: `Access-Control-Allow-Origin: ${acao}`,
      riskImpact:
        "Any website can make authenticated requests to your API, potentially stealing sensitive data or performing unauthorized actions on behalf of users.",
      explanation:
        "CORS (Cross-Origin Resource Sharing) controls which external domains can access your API. A wildcard '*' means any website in the world can make requests. While sometimes acceptable for public APIs, it's dangerous for any endpoint that handles authentication or private data.",
      fixSteps: [
        "Replace the wildcard '*' with specific trusted origins.",
        "Validate the Origin header against an allowlist before reflecting it.",
        "Never combine 'Access-Control-Allow-Origin: *' with 'Access-Control-Allow-Credentials: true'.",
        "Use environment variables to manage allowed origins across environments.",
      ],
      codeExamples: [
        {
          label: "Next.js (Route Handler)",
          language: "typescript",
          code: `// app/api/data/route.ts
const ALLOWED_ORIGINS = [
  "https://yourdomain.com",
  "https://app.yourdomain.com",
];

export async function GET(request: Request) {
  const origin = request.headers.get("origin") || "";
  const headers: Record<string, string> = {};
  
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  
  return Response.json({ data: "value" }, { headers });
}`,
        },
        {
          label: "Nginx",
          language: "nginx",
          code: `# Only allow specific origins
map $http_origin $cors_origin {
  default "";
  "https://yourdomain.com" $http_origin;
  "https://app.yourdomain.com" $http_origin;
}
add_header Access-Control-Allow-Origin $cors_origin always;`,
        },
      ],
    }
  }
  return null
}

const checkSubresourceIntegrity: CheckFn = (_url, _headers, body) => {
  // Check for external scripts without integrity attributes
  const externalScripts = body.match(/<script[^>]+src=["']https?:\/\/[^"']+["'][^>]*>/gi) || []
  const withoutIntegrity = externalScripts.filter(
    (tag) => !tag.toLowerCase().includes("integrity="),
  )

  if (withoutIntegrity.length > 0) {
    return {
      id: generateId(),
      title: "Missing Subresource Integrity (SRI)",
      severity: "medium",
      category: "content",
      description:
        "External scripts are loaded without Subresource Integrity hashes, which cannot verify the integrity of fetched resources.",
      evidence: `Found ${withoutIntegrity.length} external script(s) without integrity attribute: ${withoutIntegrity.slice(0, 2).join(", ")}${withoutIntegrity.length > 2 ? "..." : ""}`,
      riskImpact:
        "If a CDN or third-party host is compromised, attackers could serve malicious scripts to your users. Without SRI, browsers have no way to detect the modification.",
      explanation:
        "Subresource Integrity (SRI) allows browsers to verify that files fetched from CDNs or third-party origins haven't been tampered with. By adding a cryptographic hash to script and link tags, the browser will refuse to execute the file if its content doesn't match the expected hash.",
      fixSteps: [
        "Generate SRI hashes for all external scripts and stylesheets.",
        "Add the 'integrity' and 'crossorigin' attributes to external resource tags.",
        "Use tools like srihash.org to generate hashes.",
        "Update hashes whenever you update the external resource version.",
      ],
      codeExamples: [
        {
          label: "HTML",
          language: "html",
          code: `<!-- With SRI -->
<script 
  src="https://cdn.example.com/lib.js"
  integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"
  crossorigin="anonymous">
</script>

<!-- For stylesheets too -->
<link 
  rel="stylesheet"
  href="https://cdn.example.com/styles.css"
  integrity="sha384-..."
  crossorigin="anonymous">`,
        },
        {
          label: "Generate Hash (CLI)",
          language: "bash",
          code: `# Generate SRI hash for a remote file
curl -s https://cdn.example.com/lib.js | \\
  openssl dgst -sha384 -binary | \\
  openssl base64 -A

# Or use shasum
cat lib.js | shasum -b -a 384 | awk '{ print $1 }' | xxd -r -p | base64`,
        },
      ],
    }
  }
  return null
}

const checkFormAction: CheckFn = (_url, _headers, body) => {
  // Check for forms submitting over HTTP
  const httpForms = body.match(/<form[^>]+action=["']http:\/\/[^"']+["'][^>]*>/gi) || []

  if (httpForms.length > 0) {
    return {
      id: generateId(),
      title: "Form Submitting Over HTTP",
      severity: "high",
      category: "content",
      description:
        "One or more forms submit data over unencrypted HTTP, exposing submitted data to interception.",
      evidence: `Found ${httpForms.length} form(s) with HTTP action: ${httpForms.slice(0, 2).join(", ")}`,
      riskImpact:
        "Form data including passwords, personal information, and other sensitive inputs are transmitted in plaintext and can be intercepted by attackers on the network.",
      explanation:
        "When a form's action URL uses HTTP instead of HTTPS, all data submitted through that form (including passwords, credit cards, personal info) is sent in plaintext. Anyone monitoring the network can read this data. All forms should submit to HTTPS endpoints.",
      fixSteps: [
        "Update all form action URLs to use HTTPS.",
        "Use relative URLs for form actions to inherit the page's protocol.",
        "Add the upgrade-insecure-requests CSP directive as a safety net.",
      ],
      codeExamples: [
        {
          label: "HTML Fix",
          language: "html",
          code: `<!-- Bad: HTTP form action -->
<form action="http://example.com/submit">

<!-- Good: HTTPS form action -->
<form action="https://example.com/submit">

<!-- Best: Relative URL (inherits protocol) -->
<form action="/submit">`,
        },
      ],
    }
  }
  return null
}

const checkCacheControlHeaders: CheckFn = (_url, headers) => {
  const cacheControl = headers.get("cache-control")
  const pragma = headers.get("pragma")

  // Only flag if no cache directives are set at all
  if (!cacheControl && !pragma) {
    return {
      id: generateId(),
      title: "Missing Cache-Control Headers",
      severity: "low",
      category: "headers",
      description:
        "No Cache-Control or Pragma headers are set. Sensitive responses may be cached by browsers or intermediate proxies.",
      evidence: "Neither 'Cache-Control' nor 'Pragma' headers are present in the response.",
      riskImpact:
        "Without cache control directives, sensitive data might be stored in browser caches or shared proxy caches, where it could be accessed by other users or remain after logout.",
      explanation:
        "Cache-Control headers instruct browsers and CDNs on how to cache responses. For pages that contain sensitive or personalized data, you should explicitly set no-store to prevent caching. For public static assets, proper cache headers improve performance while maintaining security.",
      fixSteps: [
        "Set 'Cache-Control: no-store' for sensitive/authenticated responses.",
        "Use 'Cache-Control: public, max-age=31536000, immutable' for versioned static assets.",
        "Add 'Pragma: no-cache' as a fallback for older HTTP/1.0 clients.",
      ],
      codeExamples: [
        {
          label: "Next.js (Route Handler)",
          language: "typescript",
          code: `// For sensitive API responses
export async function GET() {
  return Response.json(
    { data: "sensitive" },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
      },
    }
  );
}`,
        },
        {
          label: "Nginx",
          language: "nginx",
          code: `# For sensitive pages
location /dashboard {
  add_header Cache-Control "no-store, no-cache, must-revalidate" always;
  add_header Pragma "no-cache" always;
}

# For static assets
location /static/ {
  add_header Cache-Control "public, max-age=31536000, immutable";
}`,
        },
      ],
    }
  }
  return null
}

const checkXXSSProtection: CheckFn = (_url, headers) => {
  const xss = headers.get("x-xss-protection")
  // Modern best practice: the header should be set to "0" to disable the buggy XSS auditor,
  // or rely on CSP instead. But having "1; mode=block" is also acceptable.
  // Flag if absent and no CSP
  const csp = headers.get("content-security-policy")
  if (!xss && !csp) {
    return {
      id: generateId(),
      title: "Missing X-XSS-Protection Header",
      severity: "low",
      category: "headers",
      description:
        "The X-XSS-Protection header is not set and no Content-Security-Policy is present. While the XSS auditor is deprecated in modern browsers, having protection headers is still recommended.",
      evidence: "Header 'X-XSS-Protection' is not present and no CSP fallback exists.",
      riskImpact:
        "Older browsers that still support the XSS auditor won't have it activated, providing no built-in XSS protection for users on legacy browsers.",
      explanation:
        "X-XSS-Protection was designed to enable the browser's built-in XSS filtering. While modern browsers have deprecated the XSS auditor (it can be exploited itself), setting this header to '0' or using CSP instead is best practice. If you have CSP, this header is unnecessary.",
      fixSteps: [
        "Implement a strong Content-Security-Policy (preferred approach).",
        "If CSP is not feasible, set X-XSS-Protection: 0 (to avoid the buggy auditor).",
        "Focus on input validation and output encoding as primary XSS defenses.",
      ],
      codeExamples: [
        {
          label: "Next.js (next.config.mjs)",
          language: "javascript",
          code: `// next.config.mjs - prefer CSP but can add as defense-in-depth
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-XSS-Protection",
            value: "0",
          },
          // Prefer CSP instead:
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;`,
        },
      ],
    }
  }
  return null
}

const checkEmailExposure: CheckFn = (_url, _headers, body) => {
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  const emails = body.match(emailPattern) || []
  // Filter out common false positives
  const filtered = emails.filter(
    (e) =>
      !e.includes("example.com") &&
      !e.includes("schema.org") &&
      !e.includes("w3.org") &&
      !e.includes("sentry.io") &&
      !e.endsWith(".png") &&
      !e.endsWith(".jpg"),
  )

  if (filtered.length > 0) {
    const unique = [...new Set(filtered)].slice(0, 5)
    return {
      id: generateId(),
      title: "Email Address Exposure",
      severity: "info",
      category: "information-disclosure",
      description:
        "Email addresses were found in the page source, which can be harvested by spammers and used in targeted phishing attacks.",
      evidence: `Found email(s): ${unique.join(", ")}${filtered.length > 5 ? ` and ${filtered.length - 5} more` : ""}`,
      riskImpact:
        "Exposed email addresses can be harvested by bots for spam, or used in targeted spear-phishing attacks against your organization.",
      explanation:
        "Bots constantly crawl websites looking for email addresses in the HTML source. Once harvested, these addresses receive spam and can be used in social engineering attacks. Consider using contact forms, email obfuscation, or JavaScript-based rendering to protect addresses.",
      fixSteps: [
        "Replace plaintext emails with contact forms.",
        "Use JavaScript to dynamically render email addresses.",
        "Encode email addresses using HTML entities or other obfuscation.",
        "Consider using services like Cloudflare email obfuscation.",
      ],
      codeExamples: [
        {
          label: "React Component",
          language: "tsx",
          code: `// Obfuscated email component
function ObfuscatedEmail({ user, domain }: { user: string; domain: string }) {
  function handleClick() {
    window.location.href = \`mailto:\${user}@\${domain}\`;
  }
  
  return (
    <button onClick={handleClick} className="text-primary underline">
      {user} [at] {domain}
    </button>
  );
}

// Usage: <ObfuscatedEmail user="contact" domain="yoursite.com" />`,
        },
      ],
    }
  }
  return null
}

const checkDirectoryListingHints: CheckFn = (_url, _headers, body) => {
  const patterns = [
    /Index of \//i,
    /<title>Index of/i,
    /Directory listing for/i,
    /Parent Directory/gi,
  ]

  const matches = patterns.filter((p) => p.test(body))

  if (matches.length >= 2) {
    return {
      id: generateId(),
      title: "Directory Listing Appears Enabled",
      severity: "high",
      category: "configuration",
      description:
        "The response contains patterns indicating directory listing is enabled, exposing file and folder structures to visitors.",
      evidence: "Response contains directory listing indicators (e.g., 'Index of', 'Parent Directory').",
      riskImpact:
        "Attackers can browse your server's file structure, discovering backup files, configuration files, source code, and other sensitive resources that should not be publicly accessible.",
      explanation:
        "Directory listing allows anyone to see all files in a directory when no index file (like index.html) is present. This can expose sensitive files such as backups (.bak, .sql), configuration files (.env, .config), source maps, and other resources the developer didn't intend to be public.",
      fixSteps: [
        "Disable directory listing in your web server configuration.",
        "Ensure every directory has an index file.",
        "Review exposed directories for sensitive files.",
      ],
      codeExamples: [
        {
          label: "Nginx",
          language: "nginx",
          code: `# Disable directory listing
autoindex off;`,
        },
        {
          label: "Apache (.htaccess)",
          language: "apache",
          code: `# Disable directory listing
Options -Indexes`,
        },
      ],
    }
  }
  return null
}

const checkSensitiveFileReferences: CheckFn = (_url, _headers, body) => {
  const sensitivePatterns: { pattern: RegExp; name: string }[] = [
    { pattern: /\.env/gi, name: ".env" },
    { pattern: /wp-config\.php/gi, name: "wp-config.php" },
    { pattern: /\.git\//gi, name: ".git/" },
    { pattern: /\.DS_Store/gi, name: ".DS_Store" },
    { pattern: /phpinfo\(\)/gi, name: "phpinfo()" },
    { pattern: /\/server-status/gi, name: "/server-status" },
    { pattern: /\.sql/gi, name: ".sql files" },
  ]

  const found: string[] = []
  for (const { pattern, name } of sensitivePatterns) {
    if (pattern.test(body)) {
      found.push(name)
    }
  }

  if (found.length > 0) {
    return {
      id: generateId(),
      title: "Sensitive File References Detected",
      severity: "medium",
      category: "information-disclosure",
      description:
        "The page references files commonly associated with sensitive configuration or development artifacts.",
      evidence: `References to: ${found.join(", ")}`,
      riskImpact:
        "References to sensitive files may indicate they are accessible, potentially exposing database credentials, API keys, source code, or server configuration.",
      explanation:
        "Sensitive files like .env (environment variables), .git/ (version control), and configuration files should never be referenced in or accessible from public-facing pages. Their presence in the HTML source suggests they may be accessible to attackers.",
      fixSteps: [
        "Remove all references to sensitive files from public HTML.",
        "Block access to sensitive files in your web server configuration.",
        "Ensure .env, .git, and other config files are in your .gitignore.",
        "Use server-side environment variables instead of client-side references.",
      ],
      codeExamples: [
        {
          label: "Nginx - Block Sensitive Files",
          language: "nginx",
          code: `# Block access to sensitive files and directories
location ~ /\\. {
  deny all;
  return 404;
}

location ~ \\.(env|sql|bak|config|log)$ {
  deny all;
  return 404;
}`,
        },
        {
          label: ".gitignore",
          language: "text",
          code: `.env
.env.local
.env.production
*.sql
*.bak
.DS_Store`,
        },
      ],
    }
  }
  return null
}

// ── New checks: outdated libraries, robots.txt, CMS fingerprinting, SPF/DMARC ──

const checkOutdatedJsLibraries: CheckFn = (_url, _headers, body) => {
  const knownVulnerable: { pattern: RegExp; lib: string; note: string }[] = [
    { pattern: /jquery[\/.-](?:1\.\d|2\.[0-2])/i, lib: "jQuery 1.x/2.0-2.2", note: "Known XSS vulnerabilities in older jQuery versions" },
    { pattern: /angular[\/.-]1\.[0-5]/i, lib: "AngularJS 1.0-1.5", note: "Multiple XSS and sandbox escape vulnerabilities" },
    { pattern: /bootstrap[\/.-](?:2\.|3\.[0-3])/i, lib: "Bootstrap 2.x/3.0-3.3", note: "Known XSS vulnerabilities in tooltip/popover" },
    { pattern: /lodash[\/.-](?:3\.|4\.[0-9]\.|4\.1[0-6])/i, lib: "Lodash < 4.17", note: "Prototype pollution vulnerabilities" },
    { pattern: /moment[\/.-](?:1\.|2\.[0-9]\.)/i, lib: "Moment.js < 2.10", note: "ReDoS vulnerabilities in date parsing" },
    { pattern: /vue[\/.-](?:1\.|2\.[0-5])/i, lib: "Vue.js 1.x/2.0-2.5", note: "Template injection and XSS vulnerabilities" },
  ]

  const found: string[] = []
  for (const { pattern, lib, note } of knownVulnerable) {
    if (pattern.test(body)) found.push(`${lib} - ${note}`)
  }

  if (found.length > 0) {
    return {
      id: generateId(),
      title: "Potentially Outdated JavaScript Libraries",
      severity: "high",
      category: "content",
      description: "The page references JavaScript libraries with known security vulnerabilities.",
      evidence: `Detected: ${found.join("; ")}`,
      riskImpact: "Outdated libraries contain publicly known vulnerabilities that attackers can exploit to perform XSS, prototype pollution, or other attacks.",
      explanation: "Using outdated client-side libraries exposes your application to known attack vectors. Attackers can find CVE databases listing exact exploit techniques for each version. Keeping dependencies updated is a fundamental security practice.",
      fixSteps: [
        "Update all JavaScript libraries to their latest stable versions.",
        "Use a dependency management tool like npm audit or Snyk to track vulnerabilities.",
        "Set up automated dependency update tools like Dependabot or Renovate.",
        "Remove any unused libraries to reduce the attack surface.",
      ],
      codeExamples: [
        { label: "npm audit", language: "bash", code: `# Check for known vulnerabilities\nnpm audit\n\n# Auto-fix where possible\nnpm audit fix\n\n# Force major version updates if needed\nnpm audit fix --force` },
        { label: "Package.json overrides", language: "json", code: `{\n  "overrides": {\n    "lodash": "^4.17.21",\n    "minimist": "^1.2.6"\n  }\n}` },
      ],
    }
  }
  return null
}

const checkRobotsTxtExposure: CheckFn = (_url, _headers, body) => {
  // Check if the page itself references sensitive paths via robots.txt-like patterns
  const sensitiveDisallows = body.match(/Disallow:\s*\/[^\s\n]+/gi)
  if (sensitiveDisallows && sensitiveDisallows.length > 0) {
    const paths = sensitiveDisallows.slice(0, 5).map((d) => d.replace(/Disallow:\s*/i, "").trim())
    const sensitivePaths = paths.filter((p) =>
      /admin|login|dashboard|api|internal|private|secret|backup|config|\.env/i.test(p)
    )
    if (sensitivePaths.length > 0) {
      return {
        id: generateId(),
        title: "Sensitive Paths Exposed in Robots.txt",
        severity: "info",
        category: "information-disclosure",
        description: "The robots.txt file reveals potentially sensitive directory paths that attackers could target.",
        evidence: `Sensitive disallowed paths found: ${sensitivePaths.join(", ")}`,
        riskImpact: "While robots.txt is meant to guide search engines, it effectively creates a map of sensitive areas for attackers to probe.",
        explanation: "Robots.txt files are publicly accessible and listing sensitive paths in them tells attackers exactly where to look. Instead of hiding paths via robots.txt, ensure they are properly authenticated and secured.",
        fixSteps: [
          "Remove sensitive paths from robots.txt. Security should not depend on obscurity.",
          "Ensure all sensitive endpoints require proper authentication.",
          "Use authentication and authorization rather than relying on path hiding.",
        ],
        codeExamples: [
          { label: "Secure robots.txt", language: "text", code: `# Only list public crawl directives\nUser-agent: *\nDisallow: /api/\nSitemap: https://yourdomain.com/sitemap.xml\n\n# Do NOT list admin paths. Secure them with auth instead` },
        ],
      }
    }
  }
  return null
}

const checkCMSFingerprinting: CheckFn = (_url, headers, body) => {
  const findings: string[] = []

  // WordPress
  if (/wp-content|wp-includes|wp-json/i.test(body)) findings.push("WordPress detected (wp-content/wp-includes paths)")
  if (/meta\s+name=["']generator["']\s+content=["']WordPress\s*([\d.]*)/i.test(body)) {
    const match = body.match(/content=["']WordPress\s*([\d.]*)/i)
    findings.push(`WordPress version exposed: ${match?.[1] || "unknown"}`)
  }

  // Drupal
  if (/Drupal|drupal\.js|sites\/default/i.test(body)) findings.push("Drupal CMS detected")

  // Joomla
  if (/Joomla|\/media\/jui|\/components\/com_/i.test(body)) findings.push("Joomla CMS detected")

  // PHP version in headers
  const phpHeader = headers.get("x-powered-by")
  if (phpHeader && /php/i.test(phpHeader)) findings.push(`PHP version exposed: ${phpHeader}`)

  // Generator meta tag
  const generatorMatch = body.match(/meta\s+name=["']generator["']\s+content=["']([^"']+)/i)
  if (generatorMatch && !/WordPress/i.test(generatorMatch[1])) {
    findings.push(`Generator tag: ${generatorMatch[1]}`)
  }

  if (findings.length > 0) {
    return {
      id: generateId(),
      title: "CMS / Technology Fingerprinting",
      severity: "info",
      category: "information-disclosure",
      description: "The site exposes CMS or technology stack details that aid attacker reconnaissance.",
      evidence: findings.join("; "),
      riskImpact: "Knowing the CMS type and version allows attackers to search for specific exploits and known vulnerabilities for that platform.",
      explanation: "CMS fingerprinting reveals the underlying technology, version, and sometimes plugin information. Attackers use this to narrow down their attack vectors, find known CVEs, and exploit version-specific vulnerabilities.",
      fixSteps: [
        "Remove or obscure the generator meta tag.",
        "Hide version numbers from public-facing pages and headers.",
        "Keep your CMS and all plugins updated to the latest versions.",
        "Remove default installation files and readme.txt / license.txt files.",
      ],
      codeExamples: [
        { label: "WordPress (functions.php)", language: "php", code: `<?php\n// Remove WordPress version from head\nremove_action('wp_head', 'wp_generator');\n\n// Remove version from RSS feeds\nadd_filter('the_generator', '__return_empty_string');\n\n// Remove version from scripts and styles\nfunction remove_version_strings(\$src) {\n  return remove_query_arg('ver', \$src);\n}\nadd_filter('script_loader_src', 'remove_version_strings');\nadd_filter('style_loader_src', 'remove_version_strings');` },
      ],
    }
  }
  return null
}

const checkSecurityTxt: CheckFn = (_url, _headers, body) => {
  // This check is specifically for when scanning /.well-known/security.txt content
  // or looking for security.txt references in the page
  const hasSecurityTxtLink = /\.well-known\/security\.txt|security\.txt/i.test(body)
  if (!hasSecurityTxtLink) {
    return {
      id: generateId(),
      title: "Missing security.txt File",
      severity: "info",
      category: "configuration",
      description: "No reference to a security.txt file was found. This file helps security researchers report vulnerabilities responsibly.",
      evidence: "No reference to /.well-known/security.txt found in the page.",
      riskImpact: "Without a security.txt file, security researchers may not know how to responsibly report vulnerabilities they discover on your site.",
      explanation: "The security.txt file (RFC 9116) provides a standardized way for security researchers to find contact information for reporting vulnerabilities. It should be placed at /.well-known/security.txt and include a contact method, preferred languages, and an encryption key.",
      fixSteps: [
        "Create a /.well-known/security.txt file with contact information.",
        "Include fields: Contact, Preferred-Languages, Expires, and optionally Encryption.",
        "Sign the file with PGP if possible for authenticity.",
      ],
      codeExamples: [
        { label: "security.txt example", language: "text", code: `Contact: mailto:security@yourdomain.com\nExpires: 2026-12-31T23:59:00.000Z\nPreferred-Languages: en\nCanonical: https://yourdomain.com/.well-known/security.txt` },
        { label: "Next.js (public file)", language: "text", code: `# Place this file at:\n# public/.well-known/security.txt\n\nContact: mailto:security@yourdomain.com\nExpires: 2026-12-31T23:59:00.000Z\nPreferred-Languages: en` },
      ],
    }
  }
  return null
}

const checkInlineJavaScript: CheckFn = (_url, _headers, body) => {
  const inlineScripts = body.match(/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/gi)
  if (inlineScripts && inlineScripts.length > 3) {
    const dangerousPatterns = inlineScripts.filter(
      (s) => /eval\s*\(|document\.write|innerHTML\s*=|\.createElement\s*\(\s*["']script/i.test(s)
    )
    if (dangerousPatterns.length > 0) {
      return {
        id: generateId(),
        title: "Potentially Dangerous Inline JavaScript",
        severity: "medium",
        category: "content",
        description: "The page contains inline JavaScript with potentially dangerous patterns like eval(), document.write(), or dynamic script creation.",
        evidence: `Found ${dangerousPatterns.length} inline script block(s) with dangerous patterns (eval, document.write, innerHTML assignment, or dynamic script creation).`,
        riskImpact: "Dangerous JavaScript patterns can be exploited via XSS to execute arbitrary code in users' browsers.",
        explanation: "Patterns like eval(), document.write(), and direct innerHTML assignment with user input are common XSS vectors. They execute strings as code, which means any attacker-controlled input that reaches these functions can execute arbitrary JavaScript.",
        fixSteps: [
          "Replace eval() with JSON.parse() or other safe alternatives.",
          "Use textContent instead of innerHTML when inserting user-generated content.",
          "Move inline scripts to external files to enable CSP nonce/hash protection.",
          "Use DOMPurify to sanitize HTML before inserting into the DOM.",
        ],
        codeExamples: [
          { label: "Safe alternatives", language: "javascript", code: `// Instead of eval()\nconst data = JSON.parse(jsonString);\n\n// Instead of innerHTML\nelement.textContent = userInput;\n\n// If HTML is needed, sanitize first\nimport DOMPurify from 'dompurify';\nelement.innerHTML = DOMPurify.sanitize(htmlContent);` },
        ],
      }
    }
  }
  return null
}

const checkAccessControlHeaders: CheckFn = (_url, headers) => {
  const acao = headers.get("access-control-allow-origin")
  const acac = headers.get("access-control-allow-credentials")

  if (acao === "*" && acac === "true") {
    return {
      id: generateId(),
      title: "Dangerous CORS Configuration",
      severity: "critical",
      category: "headers",
      description: "The server allows credentials with a wildcard origin, which is a severe CORS misconfiguration.",
      evidence: "Access-Control-Allow-Origin: * combined with Access-Control-Allow-Credentials: true",
      riskImpact: "Any website can make authenticated cross-origin requests to your API, potentially stealing user data or performing actions on behalf of authenticated users.",
      explanation: "When Access-Control-Allow-Origin is set to * with credentials allowed, any website on the internet can make authenticated requests to your API. This completely bypasses the Same-Origin Policy, one of the browser's most important security mechanisms.",
      fixSteps: [
        "Never combine wildcard (*) origin with Allow-Credentials: true.",
        "Explicitly list allowed origins instead of using wildcard.",
        "Validate the Origin header against an allowlist before reflecting it.",
      ],
      codeExamples: [
        { label: "Secure CORS setup", language: "typescript", code: `const ALLOWED_ORIGINS = ["https://yourdomain.com", "https://app.yourdomain.com"];\n\nfunction getCorsHeaders(origin: string) {\n  if (ALLOWED_ORIGINS.includes(origin)) {\n    return {\n      "Access-Control-Allow-Origin": origin,\n      "Access-Control-Allow-Credentials": "true",\n    };\n  }\n  return {};\n}` },
      ],
    }
  }
  return null
}

// ── Cross-Origin-Opener-Policy ──

const checkCrossOriginOpenerPolicy: CheckFn = (_url, headers) => {
  const coop = headers.get("cross-origin-opener-policy")
  if (!coop) {
    return {
      id: generateId(),
      title: "Missing Cross-Origin-Opener-Policy (COOP)",
      severity: "low",
      category: "headers",
      description: "The server does not set the Cross-Origin-Opener-Policy header, leaving the site vulnerable to cross-origin attacks like Spectre.",
      evidence: "Header 'Cross-Origin-Opener-Policy' is not present.",
      riskImpact: "Without COOP, other origins that open your site in a popup retain a reference to your window object, potentially enabling side-channel attacks.",
      explanation: "COOP ensures your top-level document does not share a browsing context group with cross-origin documents. This is a key defense against Spectre-class CPU vulnerability attacks that can read cross-origin data from shared processes.",
      fixSteps: [
        "Add 'Cross-Origin-Opener-Policy: same-origin' to isolate your browsing context.",
        "Use 'same-origin-allow-popups' if your site needs to open cross-origin popups (e.g., OAuth).",
        "Test thoroughly as COOP can break integrations with third-party popups.",
      ],
      codeExamples: [
        { label: "Next.js", language: "javascript", code: `// next.config.mjs\nconst nextConfig = {\n  async headers() {\n    return [{\n      source: "/(.*)",\n      headers: [\n        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },\n      ],\n    }];\n  },\n};` },
        { label: "Nginx", language: "nginx", code: `add_header Cross-Origin-Opener-Policy "same-origin" always;` },
      ],
    }
  }
  return null
}

// ── Cross-Origin-Resource-Policy ──

const checkCrossOriginResourcePolicy: CheckFn = (_url, headers) => {
  const corp = headers.get("cross-origin-resource-policy")
  if (!corp) {
    return {
      id: generateId(),
      title: "Missing Cross-Origin-Resource-Policy (CORP)",
      severity: "info",
      category: "headers",
      description: "No Cross-Origin-Resource-Policy header is set. This header controls which origins can load your resources.",
      evidence: "Header 'Cross-Origin-Resource-Policy' is not present.",
      riskImpact: "Without CORP, your resources (images, scripts, etc.) can be embedded by any origin, which can be exploited in Spectre-class attacks or data exfiltration.",
      explanation: "CORP complements COOP and COEP to enable cross-origin isolation. It tells the browser which sites are allowed to embed your resources, protecting against speculative execution attacks and unauthorized hotlinking.",
      fixSteps: [
        "Add 'Cross-Origin-Resource-Policy: same-origin' for maximum protection.",
        "Use 'same-site' if resources need to be shared across subdomains.",
        "Use 'cross-origin' only for public CDN assets meant to be loaded by any site.",
      ],
      codeExamples: [
        { label: "Next.js", language: "javascript", code: `// next.config.mjs\nconst nextConfig = {\n  async headers() {\n    return [{\n      source: "/(.*)",\n      headers: [\n        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },\n      ],\n    }];\n  },\n};` },
      ],
    }
  }
  return null
}

// ── Reverse Tabnabbing (target="_blank" without rel="noopener") ──

const checkReverseTabnabbing: CheckFn = (_url, _headers, body) => {
  const unsafeLinks = body.match(/<a[^>]*target\s*=\s*["']_blank["'][^>]*>/gi) || []
  const vulnerable = unsafeLinks.filter((link) => !/rel\s*=\s*["'][^"']*noopener/i.test(link))

  if (vulnerable.length > 0) {
    return {
      id: generateId(),
      title: "Reverse Tabnabbing Vulnerability",
      severity: "medium",
      category: "content",
      description: `Found ${vulnerable.length} link(s) with target="_blank" that are missing rel="noopener", enabling reverse tabnabbing attacks.`,
      evidence: `${vulnerable.length} anchor tag(s) use target="_blank" without rel="noopener" or rel="noreferrer".`,
      riskImpact: "The opened page gains access to window.opener, allowing it to redirect your page to a phishing site while the user's attention is on the new tab.",
      explanation: "When a link opens a new tab with target='_blank', the new page receives a reference to window.opener. A malicious or compromised linked page can use window.opener.location to silently redirect the original page to a fake login or phishing page.",
      fixSteps: [
        "Add rel=\"noopener noreferrer\" to all links with target=\"_blank\".",
        "Modern browsers default to noopener for target=\"_blank\", but explicit is safer for older browser support.",
        "Consider using rel=\"noopener\" at minimum on all external links.",
      ],
      codeExamples: [
        { label: "Safe link", language: "html", code: `<a href="https://example.com" target="_blank" rel="noopener noreferrer">\n  Visit Example\n</a>` },
        { label: "React component", language: "tsx", code: `function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {\n  return (\n    <a href={href} target="_blank" rel="noopener noreferrer">\n      {children}\n    </a>\n  );\n}` },
      ],
    }
  }
  return null
}

// ── JavaScript Source Map Exposure ──

const checkSourceMapExposure: CheckFn = (_url, _headers, body) => {
  const mapRefs = body.match(/\/\/[#@]\s*sourceMappingURL\s*=\s*\S+\.map/gi) || []
  const externalMaps = body.match(/['"]\S+\.js\.map['"]/gi) || []
  const total = mapRefs.length + externalMaps.length

  if (total > 0) {
    return {
      id: generateId(),
      title: "JavaScript Source Maps Exposed",
      severity: "low",
      category: "information-disclosure",
      description: `Found ${total} source map reference(s) in the page. Source maps expose your original, unminified source code to anyone.`,
      evidence: `Detected ${mapRefs.length} inline sourceMappingURL directive(s) and ${externalMaps.length} .js.map file reference(s).`,
      riskImpact: "Source maps reveal original variable names, function logic, comments, and application structure, making it significantly easier for attackers to find vulnerabilities.",
      explanation: "Source maps are generated during the build process to aid debugging. In production, they expose your entire unminified source code, including business logic, internal comments, and potentially hardcoded secrets. Attackers use source maps to understand application architecture and find exploit opportunities.",
      fixSteps: [
        "Disable source map generation in production builds.",
        "If source maps are needed for error monitoring, upload them privately to your error tracking service (e.g., Sentry).",
        "Configure your bundler to strip sourceMappingURL comments in production.",
      ],
      codeExamples: [
        { label: "Next.js", language: "javascript", code: `// next.config.mjs\nconst nextConfig = {\n  productionBrowserSourceMaps: false, // default is already false\n};` },
        { label: "Webpack", language: "javascript", code: `// webpack.config.js\nmodule.exports = {\n  devtool: process.env.NODE_ENV === 'production'\n    ? false // No source maps in production\n    : 'eval-source-map',\n};` },
      ],
    }
  }
  return null
}

// ── Sensitive Data in HTML Comments ──

const checkSensitiveComments: CheckFn = (_url, _headers, body) => {
  const comments = body.match(/<!--[\s\S]*?-->/g) || []
  const sensitivePatterns = [
    { pattern: /password\s*[:=]/i, label: "password" },
    { pattern: /api[_-]?key\s*[:=]/i, label: "API key" },
    { pattern: /secret\s*[:=]/i, label: "secret" },
    { pattern: /TODO\s*:.*(?:fix|hack|temp|vuln|security|auth)/i, label: "security-related TODO" },
    { pattern: /FIXME\s*:.*(?:fix|hack|temp|vuln|security|auth)/i, label: "security-related FIXME" },
    { pattern: /HACK\s*:/i, label: "HACK comment" },
    { pattern: /BEGIN\s+(?:RSA|DSA|EC)\s+PRIVATE\s+KEY/i, label: "private key" },
    { pattern: /jdbc:|mysql:|postgres:|mongodb\+srv:|redis:\/\//i, label: "database connection string" },
  ]

  const found: string[] = []
  for (const comment of comments) {
    for (const { pattern, label } of sensitivePatterns) {
      if (pattern.test(comment)) {
        found.push(label)
        break
      }
    }
  }

  if (found.length > 0) {
    return {
      id: generateId(),
      title: "Sensitive Information in HTML Comments",
      severity: "medium",
      category: "information-disclosure",
      description: `Found ${found.length} HTML comment(s) containing potentially sensitive information.`,
      evidence: `Detected comments with: ${[...new Set(found)].join(", ")}.`,
      riskImpact: "HTML comments are visible to anyone viewing page source. Sensitive data in comments can reveal credentials, internal infrastructure details, or security weaknesses.",
      explanation: "Developers often leave TODO notes, debug information, or temporary credentials in HTML comments. While invisible to normal users, these are trivially accessible through 'View Source' and are indexed by security scanners and search engines.",
      fixSteps: [
        "Remove all HTML comments containing sensitive information before deploying to production.",
        "Use a build process that strips comments (e.g., HTML minification).",
        "Move debug notes to internal documentation or issue trackers.",
        "Never put credentials or secrets in HTML, even temporarily.",
      ],
      codeExamples: [
        { label: "HTML Minification (PostHTML)", language: "javascript", code: `// postcss or posthtml config\nconst htmlnano = require('htmlnano');\n\nhtmlnano.process(html, {\n  removeComments: 'all',\n});` },
      ],
    }
  }
  return null
}

// ── Hardcoded API Keys and Secrets ──

const checkHardcodedSecrets: CheckFn = (_url, _headers, body) => {
  const secretPatterns = [
    { pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/g, label: "AWS Access Key" },
    { pattern: /ghp_[A-Za-z0-9]{36}/g, label: "GitHub Personal Access Token" },
    { pattern: /gho_[A-Za-z0-9]{36}/g, label: "GitHub OAuth Token" },
    { pattern: /sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/g, label: "OpenAI API Key" },
    { pattern: /sk_live_[A-Za-z0-9]{24,}/g, label: "Stripe Live Secret Key" },
    { pattern: /rk_live_[A-Za-z0-9]{24,}/g, label: "Stripe Restricted Key" },
    { pattern: /sq0csp-[A-Za-z0-9_-]{43}/g, label: "Square Access Token" },
    { pattern: /xox[bprs]-[A-Za-z0-9-]{10,}/g, label: "Slack Token" },
    { pattern: /ya29\.[A-Za-z0-9_-]{50,}/g, label: "Google OAuth Token" },
    { pattern: /AIza[A-Za-z0-9_-]{35}/g, label: "Google API Key" },
    { pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g, label: "SendGrid API Key" },
    { pattern: /key-[A-Za-z0-9]{32}/g, label: "Mailgun API Key" },
    { pattern: /sk_[A-Za-z0-9]{32,}/g, label: "Generic Secret Key (sk_)" },
  ]

  const found: string[] = []
  for (const { pattern, label } of secretPatterns) {
    if (pattern.test(body)) found.push(label)
    pattern.lastIndex = 0
  }

  if (found.length > 0) {
    return {
      id: generateId(),
      title: "Hardcoded API Keys or Secrets Detected",
      severity: "critical",
      category: "information-disclosure",
      description: `Found ${found.length} potential API key(s) or secret(s) exposed in the page source.`,
      evidence: `Detected: ${found.join(", ")}.`,
      riskImpact: "Exposed API keys allow attackers to access your third-party services, incur charges on your accounts, steal data, or impersonate your application.",
      explanation: "Hardcoded secrets in HTML, JavaScript, or page source are accessible to anyone. Automated bots continuously scan the internet for exposed API keys. Once found, keys are typically exploited within minutes for cryptocurrency mining, data theft, or spam.",
      fixSteps: [
        "Immediately rotate all exposed keys and secrets.",
        "Move secrets to server-side environment variables. Never expose them client-side.",
        "Use a secrets manager (e.g., Vercel Environment Variables, AWS Secrets Manager, Vault).",
        "Add pre-commit hooks like git-secrets or gitleaks to prevent future leaks.",
        "For client-side APIs (like Google Maps), restrict keys by domain/IP in the provider's dashboard.",
      ],
      codeExamples: [
        { label: "Server-side only", language: "typescript", code: `// app/api/data/route.ts (server-side only)\nconst apiKey = process.env.STRIPE_SECRET_KEY;\n\n// NEVER do this in client components:\n// const apiKey = "sk_live_abc123..." // Exposed!` },
        { label: ".env.local", language: "bash", code: `# .env.local (never committed to git)\nSTRIPE_SECRET_KEY=sk_live_...\nDATABASE_URL=postgres://...\n\n# Only NEXT_PUBLIC_ vars are exposed client-side\nNEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...` },
      ],
    }
  }
  return null
}

// ── Private/Internal IP Address Exposure ──

const checkPrivateIPExposure: CheckFn = (_url, _headers, body) => {
  const privateIPs = body.match(/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})/g) || []
  const localhostRefs = body.match(/(?:127\.0\.0\.\d{1,3}|localhost:\d{2,5})/g) || []
  const allRefs = [...new Set([...privateIPs, ...localhostRefs])]

  if (allRefs.length > 0) {
    return {
      id: generateId(),
      title: "Internal/Private IP Addresses Exposed",
      severity: "low",
      category: "information-disclosure",
      description: `Found ${allRefs.length} internal or private IP address(es) in the page source.`,
      evidence: `Detected: ${allRefs.slice(0, 5).join(", ")}${allRefs.length > 5 ? ` and ${allRefs.length - 5} more` : ""}.`,
      riskImpact: "Internal IP addresses reveal your network topology, helping attackers map internal infrastructure for targeted attacks.",
      explanation: "Private IP addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x) and localhost references in public-facing pages leak information about your internal network structure. Attackers use this to understand server layout, identify internal services, and craft SSRF or lateral movement attacks.",
      fixSteps: [
        "Remove hardcoded internal IP addresses from client-facing code.",
        "Use environment-specific configuration to prevent internal URLs from leaking to production.",
        "Review reverse proxy and load balancer configurations that might forward internal headers.",
        "Audit server error pages that may expose internal stack traces with IPs.",
      ],
      codeExamples: [
        { label: "Environment config", language: "typescript", code: `// Use environment variables instead of hardcoded IPs\nconst API_URL = process.env.NODE_ENV === 'production'\n  ? 'https://api.yourdomain.com'\n  : 'http://localhost:3001';` },
      ],
    }
  }
  return null
}

// ── Debug Mode / Stack Trace Indicators ──

const checkDebugIndicators: CheckFn = (_url, headers, body) => {
  const indicators: string[] = []

  // Check headers
  if (headers.get("x-debug") || headers.get("x-debug-token") || headers.get("x-debug-token-link"))
    indicators.push("Debug headers present (X-Debug/X-Debug-Token)")
  if (headers.get("x-powered-by")?.toLowerCase().includes("express"))
    indicators.push("Express X-Powered-By header exposed")

  // Check body for stack traces and debug output
  if (/at\s+\S+\s+\((?:\/[^\s)]+|node_modules\/)/m.test(body))
    indicators.push("Node.js/JavaScript stack trace detected")
  if (/Traceback\s+\(most recent call last\)/i.test(body))
    indicators.push("Python stack trace detected")
  if (/(?:Fatal error|Warning|Notice|Parse error):\s+.*\s+in\s+\/\S+\.php\s+on\s+line\s+\d+/i.test(body))
    indicators.push("PHP error with file path exposed")
  if (/java\.\w+\.[\w.]+Exception/i.test(body))
    indicators.push("Java exception/stack trace detected")
  if (/DEBUG\s*=\s*True|DJANGO_DEBUG|debug_toolbar/i.test(body))
    indicators.push("Debug mode enabled (Django/framework)")
  if (/phpinfo\(\)|<title>phpinfo\(\)/i.test(body))
    indicators.push("phpinfo() output detected")
  if (/SQLSTATE\[|mysql_/i.test(body))
    indicators.push("Database error message exposed")

  if (indicators.length > 0) {
    return {
      id: generateId(),
      title: "Debug Mode or Error Information Exposed",
      severity: "high",
      category: "information-disclosure",
      description: `Found ${indicators.length} debug/error indicator(s) that reveal internal application details.`,
      evidence: indicators.join("; "),
      riskImpact: "Debug output and stack traces expose internal file paths, framework versions, database types, and application logic that attackers use to craft targeted exploits.",
      explanation: "Debug mode and verbose error messages are invaluable during development but catastrophic in production. They reveal the exact technology stack, internal file structure, database queries, and sometimes even variable values. This information dramatically reduces the effort required to find and exploit vulnerabilities.",
      fixSteps: [
        "Disable debug mode in production (DEBUG=False, NODE_ENV=production).",
        "Configure custom error pages that don't expose internal details.",
        "Remove X-Powered-By and other fingerprinting headers.",
        "Use structured logging that writes to files/services, not to response bodies.",
        "Set up error monitoring (Sentry, LogRocket) instead of displaying errors to users.",
      ],
      codeExamples: [
        { label: "Express.js", language: "javascript", code: `// Disable X-Powered-By\napp.disable('x-powered-by');\n\n// Custom error handler (no stack in production)\napp.use((err, req, res, next) => {\n  res.status(500).json({\n    error: process.env.NODE_ENV === 'production'\n      ? 'Internal Server Error'\n      : err.message,\n  });\n});` },
        { label: "Next.js", language: "javascript", code: `// next.config.mjs\nconst nextConfig = {\n  poweredByHeader: false, // Remove X-Powered-By\n};` },
      ],
    }
  }
  return null
}

// ── DOM XSS Sink Patterns ──

const checkDOMXSSSinks: CheckFn = (_url, _headers, body) => {
  const sinkPatterns = [
    { pattern: /\.innerHTML\s*=\s*(?:location|document\.URL|document\.referrer|window\.name)/gi, label: "innerHTML assigned from URL/referrer" },
    { pattern: /document\.write\s*\(\s*(?:location|document\.URL|document\.referrer|unescape)/gi, label: "document.write with URL input" },
    { pattern: /\.outerHTML\s*=\s*(?:location|document\.URL|document\.referrer)/gi, label: "outerHTML assigned from URL" },
    { pattern: /location\s*=\s*(?:location\.hash|location\.search|document\.referrer)/gi, label: "location assigned from unvalidated source" },
    { pattern: /\.insertAdjacentHTML\s*\([^)]*(?:location|document\.URL|document\.referrer)/gi, label: "insertAdjacentHTML with URL input" },
    { pattern: /\$\s*\(\s*(?:location\.hash|location\.search|window\.location)/gi, label: "jQuery selector with URL input" },
  ]

  const found: string[] = []
  for (const { pattern, label } of sinkPatterns) {
    if (pattern.test(body)) found.push(label)
    pattern.lastIndex = 0
  }

  if (found.length > 0) {
    return {
      id: generateId(),
      title: "Potential DOM-Based XSS Sinks",
      severity: "high",
      category: "content",
      description: `Found ${found.length} pattern(s) where user-controlled input flows into dangerous DOM sinks.`,
      evidence: `Detected: ${found.join("; ")}.`,
      riskImpact: "DOM-based XSS allows attackers to execute arbitrary JavaScript in the user's browser by crafting malicious URLs, stealing session tokens, performing actions as the user, or redirecting to phishing pages.",
      explanation: "DOM XSS occurs when JavaScript takes data from an attacker-controllable source (URL, referrer, window.name) and passes it to a dangerous sink (innerHTML, document.write, eval). Unlike reflected XSS, the payload never touches the server, making it harder to detect with server-side WAFs.",
      fixSteps: [
        "Never assign URL parameters, location.hash, or document.referrer directly to innerHTML or document.write.",
        "Use textContent instead of innerHTML when inserting user-controlled data.",
        "Sanitize any HTML input with a library like DOMPurify before DOM insertion.",
        "Use parameterized DOM APIs (createElement + appendChild) instead of HTML string insertion.",
      ],
      codeExamples: [
        { label: "Safe DOM manipulation", language: "javascript", code: `// UNSAFE:\nelement.innerHTML = location.hash.slice(1);\n\n// SAFE - use textContent:\nelement.textContent = location.hash.slice(1);\n\n// SAFE - sanitize if HTML is needed:\nimport DOMPurify from 'dompurify';\nelement.innerHTML = DOMPurify.sanitize(userInput);` },
      ],
    }
  }
  return null
}

// ── Insecure Iframes ──

const checkInsecureIframes: CheckFn = (url, _headers, body) => {
  if (!url.startsWith("https://")) return null
  const iframes = body.match(/<iframe[^>]*src\s*=\s*["']http:\/\/[^"']+["'][^>]*>/gi) || []

  if (iframes.length > 0) {
    return {
      id: generateId(),
      title: "Insecure Iframe Sources on HTTPS Page",
      severity: "medium",
      category: "content",
      description: `Found ${iframes.length} iframe(s) loading content over HTTP on an HTTPS page.`,
      evidence: `${iframes.length} iframe(s) use http:// src on an HTTPS page.`,
      riskImpact: "HTTP iframes on HTTPS pages create mixed content, allowing man-in-the-middle attackers to modify the iframe content and potentially inject malicious scripts into your secure page.",
      explanation: "Browsers display your page as 'secure' (HTTPS) but an HTTP iframe within it can be intercepted and modified by network attackers. The iframe content runs in the same visual context as your page, enabling phishing, credential theft, or malicious downloads that appear to come from your trusted domain.",
      fixSteps: [
        "Change all iframe src attributes to use HTTPS URLs.",
        "If the embedded content doesn't support HTTPS, find an alternative provider.",
        "Use Content-Security-Policy to block HTTP resources: frame-src https:.",
        "Consider using the sandbox attribute on iframes for additional isolation.",
      ],
      codeExamples: [
        { label: "CSP frame-src", language: "text", code: `Content-Security-Policy: frame-src https: 'self';` },
        { label: "Sandboxed iframe", language: "html", code: `<iframe\n  src="https://trusted-embed.com/widget"\n  sandbox="allow-scripts allow-same-origin"\n  loading="lazy"\n></iframe>` },
      ],
    }
  }
  return null
}

// ── JWT/Token Exposure in HTML ──

const checkTokenExposure: CheckFn = (_url, _headers, body) => {
  const findings: string[] = []

  // JWT pattern (header.payload.signature)
  const jwtPattern = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
  const jwts = body.match(jwtPattern) || []
  if (jwts.length > 0) findings.push(`${jwts.length} JWT token(s)`)

  // Bearer tokens in visible HTML (not in script context)
  const bearerPattern = /Bearer\s+[A-Za-z0-9_-]{20,}/gi
  const bearers = body.match(bearerPattern) || []
  if (bearers.length > 0) findings.push(`${bearers.length} Bearer token reference(s)`)

  // Session IDs in URLs
  const sessionInUrl = body.match(/[?&](?:session_?id|sid|token|auth_token|access_token)\s*=\s*[A-Za-z0-9_-]{16,}/gi) || []
  if (sessionInUrl.length > 0) findings.push(`${sessionInUrl.length} session/token in URL parameter(s)`)

  if (findings.length > 0) {
    return {
      id: generateId(),
      title: "Authentication Tokens Exposed in Page Source",
      severity: "high",
      category: "information-disclosure",
      description: `Found token(s) or session identifiers exposed in the HTML source: ${findings.join(", ")}.`,
      evidence: findings.join("; "),
      riskImpact: "Exposed tokens allow session hijacking. An attacker who obtains these tokens can fully impersonate the user without needing their password.",
      explanation: "Authentication tokens (JWTs, session IDs, bearer tokens) should never appear in HTML source. They can be captured by browser extensions, cached by CDNs, logged by proxies, or found by anyone viewing page source. Tokens in URL parameters are especially dangerous as they get logged in browser history, server logs, and referrer headers.",
      fixSteps: [
        "Store tokens in HTTP-only, Secure cookies. Never place them in HTML, localStorage visible in source, or URLs.",
        "If tokens must be passed to JavaScript, inject them via a secure API call rather than embedding in HTML.",
        "Never pass authentication tokens in URL query parameters.",
        "Implement short token lifetimes and token rotation.",
      ],
      codeExamples: [
        { label: "Secure cookie", language: "typescript", code: `// Set token as HTTP-only cookie (inaccessible to JS)\nconst response = NextResponse.json({ success: true });\nresponse.cookies.set('session', token, {\n  httpOnly: true,\n  secure: true,\n  sameSite: 'lax',\n  maxAge: 86400,\n  path: '/',\n});` },
      ],
    }
  }
  return null
}

// ── Autocomplete on Sensitive Fields ──

const checkAutocompleteOnSensitiveFields: CheckFn = (_url, _headers, body) => {
  // Find password inputs without proper autocomplete attributes
  const passwordInputs = body.match(/<input[^>]*type\s*=\s*["']password["'][^>]*>/gi) || []
  const unsafeInputs = passwordInputs.filter((input) => {
    return !/autocomplete\s*=\s*["'](?:off|new-password|current-password)["']/i.test(input)
  })

  // Also check for credit card fields without autocomplete guidance
  const ccInputs = body.match(/<input[^>]*(?:name|id)\s*=\s*["'][^"']*(?:card|credit|cc[_-]?num)[^"']*["'][^>]*>/gi) || []
  const unsafeCC = ccInputs.filter((input) => {
    return !/autocomplete\s*=\s*["']/i.test(input)
  })

  const total = unsafeInputs.length + unsafeCC.length
  if (total > 0) {
    const details: string[] = []
    if (unsafeInputs.length) details.push(`${unsafeInputs.length} password field(s)`)
    if (unsafeCC.length) details.push(`${unsafeCC.length} credit card field(s)`)

    return {
      id: generateId(),
      title: "Missing Autocomplete Attributes on Sensitive Fields",
      severity: "low",
      category: "content",
      description: `Found ${total} sensitive input field(s) without proper autocomplete attributes: ${details.join(", ")}.`,
      evidence: `${details.join(" and ")} missing autocomplete directives.`,
      riskImpact: "Browsers may cache sensitive form data, and on shared or compromised devices, autocomplete suggestions could expose passwords or payment information to other users.",
      explanation: "The autocomplete attribute tells browsers how to handle form autofill. Without explicit guidance on sensitive fields, browsers use their own heuristics which may save passwords or card numbers. Setting appropriate values helps prevent unintended data caching on shared devices.",
      fixSteps: [
        "Add autocomplete=\"new-password\" for registration password fields.",
        "Add autocomplete=\"current-password\" for login password fields.",
        "Add appropriate autocomplete values for payment fields (cc-number, cc-exp, etc.).",
        "Use autocomplete=\"off\" only as a last resort, as browsers may ignore it.",
      ],
      codeExamples: [
        { label: "Proper autocomplete", language: "html", code: `<!-- Login form -->\n<input type="password" autocomplete="current-password" />\n\n<!-- Registration form -->\n<input type="password" autocomplete="new-password" />\n\n<!-- Payment form -->\n<input name="card-number" autocomplete="cc-number" />\n<input name="card-exp" autocomplete="cc-exp" />` },
      ],
    }
  }
  return null
}

// ── Content-Security-Policy Report-Only without enforcement ──

const checkCSPReportOnly: CheckFn = (_url, headers) => {
  const cspRO = headers.get("content-security-policy-report-only")
  const csp = headers.get("content-security-policy")
  if (cspRO && !csp) {
    return {
      id: generateId(),
      title: "CSP Report-Only Without Enforcement",
      severity: "medium",
      category: "headers",
      description: "Content-Security-Policy-Report-Only is set but no enforcing Content-Security-Policy header exists. Reports are collected but no protection is active.",
      evidence: "Header 'Content-Security-Policy-Report-Only' present, but 'Content-Security-Policy' is absent.",
      riskImpact: "The site is logging CSP violations but not actually blocking them, providing zero protection against XSS or injection attacks.",
      explanation: "CSP-Report-Only is meant for testing before deployment. Running it without an enforcing CSP means you have visibility into potential attacks but no defense. Attackers are not blocked, only observed.",
      fixSteps: [
        "Deploy an enforcing Content-Security-Policy header alongside the report-only version.",
        "Start with a restrictive policy and relax it based on report-only findings.",
        "Keep report-only for monitoring while the enforcing policy provides actual protection.",
      ],
      codeExamples: [
        { label: "Both headers", language: "text", code: `Content-Security-Policy: default-src 'self'; script-src 'self'\nContent-Security-Policy-Report-Only: default-src 'self'; report-uri /csp-report` },
      ],
    }
  }
  return null
}

// ── Clickjacking via form targets ──

const checkFormTargetBlank: CheckFn = (_url, _headers, body) => {
  const forms = body.match(/<form[^>]*target\s*=\s*["']_blank["'][^>]*>/gi) || []
  if (forms.length > 0) {
    return {
      id: generateId(),
      title: "Forms Targeting New Windows",
      severity: "low",
      category: "content",
      description: `Found ${forms.length} form(s) with target="_blank" which can be abused for phishing via reverse tabnabbing.`,
      evidence: `${forms.length} form element(s) submit to a new window/tab.`,
      riskImpact: "Form submissions opening new windows can confuse users and be exploited to redirect the original page to a phishing site while the user focuses on the form result.",
      explanation: "Forms that open results in new tabs create the same reverse tabnabbing risk as anchor links. The new tab gains a window.opener reference and can redirect the original page.",
      fixSteps: [
        "Remove target=\"_blank\" from forms unless absolutely necessary.",
        "If needed, add rel=\"noopener\" behavior by setting window.opener = null in the target page.",
        "Consider handling form submission via AJAX/fetch instead of opening new tabs.",
      ],
      codeExamples: [
        { label: "AJAX submission", language: "javascript", code: `form.addEventListener('submit', async (e) => {\n  e.preventDefault();\n  const data = new FormData(form);\n  await fetch(form.action, { method: 'POST', body: data });\n});` },
      ],
    }
  }
  return null
}

// ── Meta Refresh Redirect ──

const checkMetaRefresh: CheckFn = (_url, _headers, body) => {
  const metaRefresh = body.match(/<meta[^>]*http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'][^"']*url\s*=/gi) || []
  if (metaRefresh.length > 0) {
    return {
      id: generateId(),
      title: "Meta Refresh Redirect Detected",
      severity: "low",
      category: "content",
      description: `Found ${metaRefresh.length} meta refresh redirect(s). These can be abused for open redirect attacks and phishing.`,
      evidence: `${metaRefresh.length} <meta http-equiv="refresh"> tag(s) with URL redirects.`,
      riskImpact: "Meta refresh redirects bypass standard navigation controls and can be manipulated for phishing. Users may not notice the redirect URL before being sent to a malicious site.",
      explanation: "Meta refresh tags automatically redirect users after a delay. Unlike server-side 301/302 redirects, they execute in the browser and can be harder to audit. If the redirect URL is dynamically generated, it may be exploitable as an open redirect.",
      fixSteps: [
        "Replace meta refresh redirects with server-side 301/302 redirects.",
        "If client-side redirect is needed, use JavaScript with proper URL validation.",
        "Never allow user-controlled input in meta refresh URLs.",
      ],
      codeExamples: [
        { label: "Server redirect", language: "typescript", code: `// Next.js redirect\nimport { redirect } from 'next/navigation';\nredirect('/new-page'); // 307 redirect` },
      ],
    }
  }
  return null
}

// ── Insecure base tag ──

const checkBaseTag: CheckFn = (_url, _headers, body) => {
  const baseTags = body.match(/<base[^>]*href\s*=\s*["']http:\/\/[^"']+["'][^>]*>/gi) || []
  const externalBase = body.match(/<base[^>]*href\s*=\s*["']https?:\/\/(?!localhost)[^"']+["'][^>]*>/gi) || []

  if (baseTags.length > 0) {
    return {
      id: generateId(),
      title: "Insecure Base Tag Detected",
      severity: "high",
      category: "content",
      description: "The page uses a <base> tag with an HTTP URL, making all relative URLs resolve insecurely.",
      evidence: `Found <base> tag(s) pointing to insecure HTTP origin.`,
      riskImpact: "All relative links, scripts, images, and form actions on the page will resolve against the insecure base URL, enabling man-in-the-middle injection of malicious resources.",
      explanation: "The HTML <base> tag sets the base URL for all relative URLs in the document. If it points to HTTP, every relative resource becomes a mixed content vulnerability. Attackers who can modify the base tag (via HTML injection) can redirect all relative URLs to their server.",
      fixSteps: [
        "Change the <base> tag to use HTTPS.",
        "Remove the <base> tag entirely if not needed. Relative URLs resolve against the page URL by default.",
        "Implement CSP base-uri directive to restrict allowed base URLs.",
      ],
      codeExamples: [
        { label: "CSP restriction", language: "text", code: `Content-Security-Policy: base-uri 'self'` },
      ],
    }
  }
  if (externalBase.length > 0) {
    return {
      id: generateId(),
      title: "External Base Tag Detected",
      severity: "medium",
      category: "content",
      description: "The page uses a <base> tag pointing to an external origin. All relative URLs resolve against this external domain.",
      evidence: `Found <base> tag(s) pointing to external origin.`,
      riskImpact: "If the external domain is compromised, all relative resources on this page will be served from the attacker-controlled domain.",
      explanation: "An external <base> tag means every relative link, script src, and image path resolves against a different origin. This is unusual and risky unless intentional for CDN purposes.",
      fixSteps: [
        "Use 'self' base URI or remove the <base> tag.",
        "Add CSP: base-uri 'self' to prevent base tag injection.",
      ],
      codeExamples: [
        { label: "CSP restriction", language: "text", code: `Content-Security-Policy: base-uri 'self'` },
      ],
    }
  }
  return null
}

// ── Excessive Permissions Policy ──

const checkExcessivePermissions: CheckFn = (_url, headers) => {
  const pp = headers.get("permissions-policy")
  if (pp && pp.includes("*")) {
    return {
      id: generateId(),
      title: "Overly Permissive Permissions-Policy",
      severity: "medium",
      category: "headers",
      description: "The Permissions-Policy header grants wildcard (*) access to browser features, defeating its purpose.",
      evidence: `Permissions-Policy contains wildcard (*) grants: ${pp.substring(0, 200)}`,
      riskImpact: "Wildcard permissions allow any embedded iframe or third-party content to access sensitive browser features like camera, microphone, geolocation, and payment APIs.",
      explanation: "Permissions-Policy (formerly Feature-Policy) restricts which browser APIs can be used by the page and its iframes. Using * as the allowlist defeats the purpose entirely, granting all embedded content full access to powerful features.",
      fixSteps: [
        "Replace * with 'self' to restrict features to your origin only.",
        "Explicitly list only the origins that need access to each feature.",
        "Disable features your application doesn't use with empty allowlists: camera=(), microphone=().",
      ],
      codeExamples: [
        { label: "Restrictive policy", language: "text", code: `Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(self "https://checkout.stripe.com")` },
      ],
    }
  }
  return null
}

// ── Window.postMessage without origin check ──

const checkPostMessageOrigin: CheckFn = (_url, _headers, body) => {
  const listeners = body.match(/addEventListener\s*\(\s*["']message["']/g) || []
  // Check if any message listener doesn't verify event.origin
  const listenerBlocks = body.match(/addEventListener\s*\(\s*["']message["']\s*,\s*(?:function\s*\([^)]*\)|(?:\([^)]*\)|\w+)\s*=>)\s*\{[^}]{0,500}\}/gs) || []
  const unsafeListeners = listenerBlocks.filter((block) => !block.includes(".origin") && !block.includes("event.source"))

  if (listeners.length > 0 && unsafeListeners.length > 0) {
    return {
      id: generateId(),
      title: "postMessage Listener Without Origin Validation",
      severity: "high",
      category: "content",
      description: `Found ${unsafeListeners.length} postMessage event listener(s) that don't appear to validate the message origin.`,
      evidence: `${listeners.length} message listener(s) found, ${unsafeListeners.length} missing origin checks.`,
      riskImpact: "Any website can send messages to your page via window.postMessage. Without origin validation, attackers can trigger unintended behavior, inject data, or exploit cross-origin communication.",
      explanation: "The postMessage API allows cross-origin communication between windows. If the receiving page doesn't verify event.origin, any malicious page opened alongside yours (even in a different tab) can send crafted messages that your code will process as trusted input.",
      fixSteps: [
        "Always check event.origin against a whitelist of trusted origins.",
        "Validate the structure and type of event.data before processing.",
        "Use event.source to verify the sender window if needed.",
      ],
      codeExamples: [
        { label: "Safe listener", language: "javascript", code: `window.addEventListener('message', (event) => {\n  // ALWAYS validate origin\n  if (event.origin !== 'https://trusted-domain.com') return;\n\n  // Validate data structure\n  if (typeof event.data !== 'object' || !event.data.type) return;\n\n  // Safe to process\n  handleMessage(event.data);\n});` },
      ],
    }
  }
  return null
}

// ── Unprotected sensitive endpoints hinted in HTML ──

const checkSensitiveEndpoints: CheckFn = (_url, _headers, body) => {
  const sensitiveEndpoints = [
    { pattern: /["']\/(?:api\/)?admin[^"']*["']/gi, label: "admin endpoint" },
    { pattern: /["']\/(?:api\/)?graphql\/?["']/gi, label: "GraphQL endpoint" },
    { pattern: /["']\/(?:api\/)?debug[^"']*["']/gi, label: "debug endpoint" },
    { pattern: /["']\/(?:\.env|wp-config|config\.php|web\.config)[^"']*["']/gi, label: "config file reference" },
    { pattern: /["']\/(?:api\/)?internal[^"']*["']/gi, label: "internal endpoint" },
    { pattern: /["']\/(?:phpmyadmin|adminer|phpinfo)[^"']*["']/gi, label: "database admin tool" },
    { pattern: /["']\/(?:api\/)?swagger[^"']*["']/gi, label: "API documentation (Swagger)" },
  ]

  const found: string[] = []
  for (const { pattern, label } of sensitiveEndpoints) {
    if (pattern.test(body)) found.push(label)
    pattern.lastIndex = 0
  }

  if (found.length > 0) {
    return {
      id: generateId(),
      title: "Sensitive Endpoints Referenced in Page Source",
      severity: "low",
      category: "information-disclosure",
      description: `Found ${found.length} reference(s) to potentially sensitive endpoints in the page source.`,
      evidence: `Detected: ${found.join(", ")}.`,
      riskImpact: "References to admin panels, debug endpoints, database tools, or API documentation in public HTML help attackers map your application's attack surface.",
      explanation: "Even if endpoints are protected by authentication, exposing their paths in HTML source gives attackers specific targets to probe. They can test for authentication bypasses, default credentials, or known vulnerabilities in these tools.",
      fixSteps: [
        "Remove references to internal/admin endpoints from client-side code.",
        "Use server-side rendering for admin navigation that only renders for authenticated admins.",
        "Move API documentation behind authentication in production.",
        "Ensure all sensitive endpoints have proper authentication and rate limiting.",
      ],
      codeExamples: [
        { label: "Conditional render", language: "tsx", code: `// Only render admin link server-side for admin users\n{session?.isAdmin && (\n  <Link href="/admin">Admin Panel</Link>\n)}` },
      ],
    }
  }
  return null
}

// ── Deprecated or dangerous HTML attributes ──

const checkDangerousHTMLAttrs: CheckFn = (_url, _headers, body) => {
  const findings: string[] = []

  // Event handler attributes (potential XSS vectors)
  const eventHandlers = body.match(/\s(?:onload|onerror|onmouseover|onfocus|onblur|onsubmit|onclick)\s*=\s*["'][^"']*(?:javascript:|eval|document\.cookie|window\.location)/gi) || []
  if (eventHandlers.length > 0) findings.push(`${eventHandlers.length} suspicious inline event handler(s)`)

  // javascript: protocol in href
  const jsHrefs = body.match(/href\s*=\s*["']javascript:/gi) || []
  if (jsHrefs.length > 0) findings.push(`${jsHrefs.length} javascript: protocol link(s)`)

  // data: URIs in script/iframe src
  const dataUris = body.match(/(?:src|href)\s*=\s*["']data:(?:text\/html|application\/javascript)/gi) || []
  if (dataUris.length > 0) findings.push(`${dataUris.length} dangerous data: URI(s)`)

  if (findings.length > 0) {
    return {
      id: generateId(),
      title: "Dangerous HTML Attributes Detected",
      severity: "high",
      category: "content",
      description: `Found ${findings.length} category(ies) of potentially dangerous HTML attributes.`,
      evidence: findings.join("; "),
      riskImpact: "Inline event handlers and javascript: URIs are common XSS vectors. If any of these values contain user-controlled input, attackers can execute arbitrary JavaScript.",
      explanation: "Inline event handlers (onload, onerror, etc.) with dynamic values, javascript: protocol links, and data: URIs embedding HTML/JS are all classic XSS injection points. Modern web security best practices avoid inline JavaScript entirely in favor of CSP-compatible patterns.",
      fixSteps: [
        "Remove all javascript: protocol links and replace with proper event listeners.",
        "Move inline event handlers to external JavaScript files.",
        "Implement CSP with 'unsafe-inline' disabled to prevent inline script execution.",
        "Use data: URIs only for images, never for HTML or JavaScript.",
      ],
      codeExamples: [
        { label: "Safe pattern", language: "html", code: `<!-- BAD -->\n<a href="javascript:void(0)" onclick="doStuff()">Click</a>\n\n<!-- GOOD -->\n<button type="button" id="action-btn">Click</button>\n<script>\n  document.getElementById('action-btn')\n    .addEventListener('click', doStuff);\n</script>` },
      ],
    }
  }
  return null
}

// ── NEW CHECKS ──────────────────────────────────────────

const checkInsecureFormSubmission: CheckFn = (url, _headers, body) => {
  if (!url.startsWith("https://")) return null
  const formActionHttp = body.match(/<form[^>]*action\s*=\s*["']http:\/\/[^"']+["'][^>]*>/i)
  if (formActionHttp) {
    return {
      id: generateId(),
      title: "Form Submits Data Over Insecure HTTP",
      severity: "critical",
      category: "content",
      description: "An HTTPS page contains a form that submits data to an HTTP endpoint, exposing user input (including credentials) in plaintext.",
      evidence: `Found form posting to HTTP: ${formActionHttp[0].substring(0, 120)}`,
      riskImpact: "User credentials, personal data, and form inputs are transmitted in plaintext, allowing interception by network attackers.",
      explanation: "When a secure page sends form data to an insecure endpoint, the browser may warn the user, but the real danger is that all submitted data travels unencrypted. Attackers on the same network can read every field submitted.",
      fixSteps: [
        "Change all form action URLs to use HTTPS.",
        "Use protocol-relative or relative URLs so forms inherit the page protocol.",
        "Implement HSTS to prevent any HTTP downgrades.",
      ],
      codeExamples: [
        { label: "Fix", language: "html", code: `<!-- BAD -->\n<form action="http://example.com/login" method="POST">\n\n<!-- GOOD -->\n<form action="https://example.com/login" method="POST">\n\n<!-- BEST - relative URL -->\n<form action="/login" method="POST">` },
      ],
    }
  }
  return null
}

const checkClickjackProtection: CheckFn = (_url, headers, body) => {
  const xfo = headers.get("x-frame-options")
  const csp = headers.get("content-security-policy")
  const hasFrameAncestors = csp?.includes("frame-ancestors")
  if (xfo || hasFrameAncestors) return null
  const hasFramebusting = /top\s*[.!=]==?\s*(self|window|parent)|window\.frameElement|self\s*!==?\s*top/i.test(body)
  if (hasFramebusting) return null
  return {
    id: generateId(),
    title: "No Clickjacking Protection Detected",
    severity: "medium",
    category: "headers",
    description: "The page has no X-Frame-Options header, no CSP frame-ancestors directive, and no JavaScript frame-busting code detected.",
    evidence: "Missing: X-Frame-Options header, CSP frame-ancestors directive, and JavaScript frame-busting.",
    riskImpact: "Attackers can embed this page in a transparent iframe and trick users into clicking hidden elements, leading to unauthorized actions.",
    explanation: "Clickjacking overlays a legitimate page beneath a decoy. Without any framing restriction, attackers can load your page in an iframe and position invisible buttons over enticing content to hijack clicks.",
    fixSteps: [
      "Add X-Frame-Options: DENY or SAMEORIGIN header.",
      "Add frame-ancestors 'self' to your Content-Security-Policy.",
      "Both methods should be used together for maximum browser compatibility.",
    ],
    codeExamples: [
      { label: "Nginx", language: "nginx", code: `add_header X-Frame-Options "DENY" always;\nadd_header Content-Security-Policy "frame-ancestors 'self';" always;` },
    ],
  }
}

const checkWeakCSPDirectives: CheckFn = (_url, headers) => {
  const csp = headers.get("content-security-policy")
  if (!csp) return null
  const weakPatterns: string[] = []
  if (csp.includes("'unsafe-eval'")) weakPatterns.push("'unsafe-eval' allows dynamic code execution (eval, Function, setTimeout with strings)")
  if (csp.includes("'unsafe-inline'") && !csp.includes("'nonce-") && !csp.includes("'sha256-")) {
    weakPatterns.push("'unsafe-inline' without nonces/hashes defeats XSS protection")
  }
  if (/script-src[^;]*\*/.test(csp)) weakPatterns.push("Wildcard (*) in script-src allows scripts from any origin")
  if (csp.includes("data:") && /script-src[^;]*data:/i.test(csp)) weakPatterns.push("data: URIs in script-src allow inline script injection")
  if (weakPatterns.length === 0) return null
  return {
    id: generateId(),
    title: "Content Security Policy Contains Weak Directives",
    severity: "high",
    category: "headers",
    description: `The CSP header is present but contains ${weakPatterns.length} weak directive(s) that significantly reduce its effectiveness against XSS.`,
    evidence: weakPatterns.join("; "),
    riskImpact: "Weak CSP directives create exploitable gaps that allow attackers to bypass the policy and execute malicious scripts.",
    explanation: "A CSP is only as strong as its weakest directive. Using unsafe-eval, unsafe-inline without nonces, wildcards in script-src, or data: URIs for scripts effectively negates the protection CSP provides. Attackers can craft payloads that exploit these gaps.",
    fixSteps: [
      "Replace 'unsafe-inline' with nonce-based or hash-based script loading.",
      "Remove 'unsafe-eval' and refactor code to avoid eval(), new Function(), etc.",
      "Replace wildcard (*) sources with explicit trusted domains.",
      "Remove data: from script-src directive.",
    ],
    codeExamples: [
      { label: "Strong CSP", language: "text", code: `Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{random}'; style-src 'self' 'nonce-{random}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self';` },
    ],
  }
}

const checkUnencryptedConnections: CheckFn = (url) => {
  if (url.startsWith("http://")) {
    return {
      id: generateId(),
      title: "Site Served Over Unencrypted HTTP",
      severity: "critical",
      category: "ssl",
      description: "The site is accessible over plain HTTP without TLS encryption, exposing all traffic to interception.",
      evidence: `URL scheme is HTTP: ${url}`,
      riskImpact: "All data including credentials, session cookies, and personal information are transmitted in plaintext. Any network observer can read and modify traffic.",
      explanation: "HTTP transmits everything in cleartext. On any shared network (coffee shops, airports, corporate networks), attackers can passively read all traffic or actively modify responses to inject malware. HTTPS is the baseline for any website.",
      fixSteps: [
        "Obtain and install a TLS certificate (free via Let's Encrypt).",
        "Configure your server to serve all content over HTTPS.",
        "Set up HTTP to HTTPS redirects (301 permanent).",
        "Enable HSTS to prevent future HTTP connections.",
      ],
      codeExamples: [
        { label: "Nginx redirect", language: "nginx", code: `server {\n    listen 80;\n    server_name example.com;\n    return 301 https://$server_name$request_uri;\n}` },
      ],
    }
  }
  return null
}

const checkCORSWildcardCredentials: CheckFn = (_url, headers) => {
  const origin = headers.get("access-control-allow-origin")
  const creds = headers.get("access-control-allow-credentials")
  if (origin === "*" && creds === "true") {
    return {
      id: generateId(),
      title: "CORS Wildcard Origin with Credentials Allowed",
      severity: "critical",
      category: "headers",
      description: "The server allows any origin (*) to make credentialed cross-origin requests, which is a severe misconfiguration.",
      evidence: "Access-Control-Allow-Origin: * combined with Access-Control-Allow-Credentials: true",
      riskImpact: "Any website can make authenticated requests to your API and read the responses, enabling complete data theft from logged-in users.",
      explanation: "While browsers should block this specific combination, some older browsers or misconfigured proxies may not. The intent clearly shows a misunderstanding of CORS that likely extends to other misconfigurations. Any relaxation of this could lead to credential theft.",
      fixSteps: [
        "Never combine wildcard origin with credentials: true.",
        "Validate the Origin header against an explicit allowlist.",
        "Reflect the specific requesting origin only if it is trusted.",
        "Remove Access-Control-Allow-Credentials if wildcard origin is needed.",
      ],
      codeExamples: [
        { label: "Node.js / Express", language: "javascript", code: `const allowedOrigins = ['https://app.example.com', 'https://admin.example.com'];\n\napp.use((req, res, next) => {\n  const origin = req.headers.origin;\n  if (allowedOrigins.includes(origin)) {\n    res.setHeader('Access-Control-Allow-Origin', origin);\n    res.setHeader('Access-Control-Allow-Credentials', 'true');\n  }\n  next();\n});` },
      ],
    }
  }
  return null
}

const checkHTMLCommentLeaks: CheckFn = (_url, _headers, body) => {
  const sensitivePatterns = /<!--[\s\S]*?(password|secret|api[_-]?key|token|TODO:\s*fix\s*auth|FIXME|HACK|internal|staging|production|database|credentials|admin|root)[\s\S]*?-->/gi
  const matches = body.match(sensitivePatterns)
  if (matches && matches.length > 0) {
    const sanitized = matches.slice(0, 3).map(m => m.substring(0, 80).replace(/[\n\r]+/g, " "))
    return {
      id: generateId(),
      title: "HTML Comments Contain Sensitive Keywords",
      severity: "medium",
      category: "information-disclosure",
      description: `Found ${matches.length} HTML comment(s) containing sensitive keywords (passwords, API keys, TODO notes, internal references).`,
      evidence: sanitized.join(" | "),
      riskImpact: "HTML comments are visible to anyone who views the page source. Leaked information can reveal internal infrastructure, credentials, or development notes useful for attackers.",
      explanation: "Developers often leave comments in HTML during development that reference sensitive systems, credentials, or internal notes. These comments ship to production and are visible in the browser's View Source. Attackers routinely inspect HTML comments for reconnaissance.",
      fixSteps: [
        "Remove all comments containing sensitive information before deployment.",
        "Use a build step that strips HTML comments from production output.",
        "Move developer notes to code comments in server-side files instead.",
      ],
      codeExamples: [
        { label: "Webpack plugin", language: "javascript", code: `// webpack.config.js\nconst TerserPlugin = require('terser-webpack-plugin');\n\nmodule.exports = {\n  optimization: {\n    minimizer: [\n      new TerserPlugin({\n        terserOptions: {\n          output: { comments: false },\n        },\n        extractComments: false,\n      }),\n    ],\n  },\n};` },
      ],
    }
  }
  return null
}

const checkJWTInURL: CheckFn = (_url, _headers, body) => {
  const jwtUrlPattern = /(?:href|src|action|url)\s*=\s*["'][^"']*[?&](?:token|jwt|auth|access_token|id_token)=eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/gi
  const match = body.match(jwtUrlPattern)
  if (match) {
    return {
      id: generateId(),
      title: "JWT Token Exposed in URL",
      severity: "critical",
      category: "information-disclosure",
      description: "A JSON Web Token (JWT) was found embedded in a URL within the page HTML. JWTs in URLs are logged in browser history, server logs, and referrer headers.",
      evidence: `Found JWT in URL: ${match[0].substring(0, 100)}...`,
      riskImpact: "The token appears in browser history, proxy logs, server access logs, and Referer headers when navigating away. Anyone with access to these logs can steal the session.",
      explanation: "JWTs contain encoded authentication claims. When placed in URLs, they persist in numerous locations: browser history, bookmarks, shared links, web server logs, CDN logs, and the Referer header sent to any external resource. This creates many avenues for token theft.",
      fixSteps: [
        "Transmit tokens in HTTP headers (Authorization: Bearer) instead of URLs.",
        "Use HTTP-only secure cookies for session management.",
        "If URL tokens are unavoidable, use short-lived single-use tokens.",
        "Implement token rotation and revocation.",
      ],
      codeExamples: [
        { label: "Fetch with header", language: "javascript", code: `// BAD: Token in URL\nfetch('/api/data?token=eyJ...');\n\n// GOOD: Token in header\nfetch('/api/data', {\n  headers: {\n    'Authorization': 'Bearer ' + token\n  }\n});` },
      ],
    }
  }
  return null
}

const checkSensitiveMetaTags: CheckFn = (_url, _headers, body) => {
  const issues: string[] = []
  if (/<meta[^>]*name\s*=\s*["']?author["']?[^>]*content\s*=\s*["'][^"']*@[^"']*["']/i.test(body)) {
    issues.push("Author meta tag contains email address")
  }
  if (/<meta[^>]*name\s*=\s*["']?generator["']?/i.test(body)) {
    const genMatch = body.match(/<meta[^>]*name\s*=\s*["']?generator["']?[^>]*content\s*=\s*["']([^"']+)["']/i)
    if (genMatch) issues.push(`Generator meta reveals: ${genMatch[1]}`)
  }
  if (/<meta[^>]*name\s*=\s*["']?csrf-token["']?/i.test(body)) {
    issues.push("CSRF token exposed in meta tag (visible in page source)")
  }
  if (/<meta[^>]*name\s*=\s*["']?api[_-]?(?:key|token|secret)["']?/i.test(body)) {
    issues.push("API key/token found in meta tag")
  }
  if (issues.length === 0) return null
  return {
    id: generateId(),
    title: "Sensitive Information in Meta Tags",
    severity: issues.some(i => i.includes("API key") || i.includes("CSRF")) ? "high" : "low",
    category: "information-disclosure",
    description: `Found ${issues.length} meta tag(s) that expose sensitive or unnecessary information.`,
    evidence: issues.join("; "),
    riskImpact: "Meta tag contents are visible in page source. Exposed generator versions aid targeted attacks, and leaked tokens/keys enable direct exploitation.",
    explanation: "Meta tags are among the first things attackers check during reconnaissance. Generator tags reveal exact software versions with known CVEs. CSRF tokens in meta tags are accessible to any script running on the page, and API keys in meta tags are fully exposed.",
    fixSteps: [
      "Remove generator meta tags in production builds.",
      "Move CSRF tokens to HTTP-only cookies or hidden form fields.",
      "Never store API keys or secrets in meta tags.",
      "Remove email addresses from author meta tags.",
    ],
    codeExamples: [
      { label: "WordPress (remove generator)", language: "php", code: `// functions.php\nremove_action('wp_head', 'wp_generator');` },
    ],
  }
}

const checkStorageAPIUsage: CheckFn = (_url, _headers, body) => {
  const issues: string[] = []
  const lsPattern = /localStorage\s*\.\s*(?:set|get)Item\s*\(\s*["'](?:token|jwt|auth|session|password|secret|api[_-]?key|credit[_-]?card|ssn|access_token|refresh_token)["']/gi
  const lsMatches = body.match(lsPattern)
  if (lsMatches) issues.push(`localStorage stores sensitive data: ${lsMatches.slice(0, 2).join(", ")}`)
  const ssPattern = /sessionStorage\s*\.\s*(?:set|get)Item\s*\(\s*["'](?:token|jwt|auth|password|secret|api[_-]?key|access_token|refresh_token)["']/gi
  const ssMatches = body.match(ssPattern)
  if (ssMatches) issues.push(`sessionStorage stores sensitive data: ${ssMatches.slice(0, 2).join(", ")}`)
  if (issues.length === 0) return null
  return {
    id: generateId(),
    title: "Sensitive Data Stored in Browser Storage APIs",
    severity: "high",
    category: "content",
    description: "JavaScript code stores sensitive values (tokens, secrets, credentials) in localStorage or sessionStorage, which are accessible to any script on the page.",
    evidence: issues.join("; "),
    riskImpact: "Any XSS vulnerability allows attackers to steal all data from browser storage. Unlike HTTP-only cookies, localStorage/sessionStorage has no built-in protection against script access.",
    explanation: "Web Storage APIs (localStorage, sessionStorage) are fully accessible to JavaScript. If an attacker exploits any XSS vulnerability on your site, they can read all stored values with a single line of code. Authentication tokens stored this way can be silently exfiltrated.",
    fixSteps: [
      "Move authentication tokens to HTTP-only, Secure, SameSite cookies.",
      "If client-side storage is required, encrypt values before storing.",
      "Never store passwords, API keys, or PII in browser storage.",
      "Implement Content Security Policy to reduce XSS risk.",
    ],
    codeExamples: [
      { label: "Secure cookie instead", language: "javascript", code: `// BAD: Token in localStorage\nlocalStorage.setItem('token', jwt);\n\n// GOOD: Set via server response header\n// Set-Cookie: session=abc123; HttpOnly; Secure; SameSite=Strict; Path=/` },
    ],
  }
}

const checkMissingSubresourceIntegrity: CheckFn = (_url, _headers, body) => {
  const cdnScripts = body.match(/<script[^>]*src\s*=\s*["']https?:\/\/(?:cdn|unpkg|cdnjs|jsdelivr|ajax\.googleapis|stackpath|bootstrapcdn)[^"']*["'][^>]*>/gi)
  if (!cdnScripts) return null
  const withoutSRI = cdnScripts.filter(s => !/integrity\s*=/i.test(s))
  if (withoutSRI.length === 0) return null
  return {
    id: generateId(),
    title: "CDN Resources Loaded Without Subresource Integrity",
    severity: "medium",
    category: "content",
    description: `${withoutSRI.length} script(s) loaded from CDNs lack integrity attributes. If a CDN is compromised, malicious code would execute on your site.`,
    evidence: withoutSRI.slice(0, 2).map(s => s.substring(0, 100)).join(" | "),
    riskImpact: "A compromised or hijacked CDN could serve malicious scripts to all your users. Without SRI, the browser has no way to verify the file has not been tampered with.",
    explanation: "Subresource Integrity (SRI) lets you provide a cryptographic hash of the expected file content. The browser verifies the downloaded file matches the hash before executing it. This protects against CDN compromises, MITM attacks on CDN traffic, and DNS hijacking targeting CDN domains.",
    fixSteps: [
      "Add integrity and crossorigin attributes to all CDN script and link tags.",
      "Generate hashes using: shasum -b -a 384 file.js | xxd -r -p | base64",
      "Use the crossorigin='anonymous' attribute alongside integrity.",
      "Consider self-hosting critical libraries as an alternative.",
    ],
    codeExamples: [
      { label: "SRI example", language: "html", code: `<script\n  src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.min.js"\n  integrity="sha384-geWF76RCwLtnZ8qwWowPQNguL3RmwHVBC9FhGdlKrxdiJJigb/j/68SIy3Te4Bkz"\n  crossorigin="anonymous"\n></script>` },
    ],
  }
}

const checkOpenGraphInjection: CheckFn = (_url, _headers, body) => {
  const ogTags = body.match(/<meta[^>]*property\s*=\s*["']og:[^"']+["'][^>]*>/gi)
  if (!ogTags) return null
  const suspiciousOg = ogTags.filter(tag => {
    const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)
    if (!content) return false
    return /javascript:|data:text\/html|<script|on\w+\s*=/i.test(content[1])
  })
  if (suspiciousOg.length === 0) return null
  return {
    id: generateId(),
    title: "Suspicious Content in Open Graph Tags",
    severity: "medium",
    category: "content",
    description: "Open Graph meta tags contain suspicious content that could indicate injection or be exploited by link preview renderers.",
    evidence: suspiciousOg[0].substring(0, 120),
    riskImpact: "Malicious OG tag content can be exploited by link preview services (Slack, Discord, Facebook) that render or process these values, potentially leading to SSRF or XSS in those platforms.",
    explanation: "Open Graph tags control how link previews appear on social media and messaging platforms. Some preview renderers process og:url, og:image, and og:video values in ways that can be exploited. Injected JavaScript or data URIs in these tags may execute in certain preview contexts.",
    fixSteps: [
      "Sanitize all Open Graph tag content to contain only valid URLs and text.",
      "Validate og:url and og:image point to your own domains.",
      "Never include user-controlled input in OG tags without proper encoding.",
    ],
    codeExamples: [
      { label: "Safe OG tags", language: "html", code: `<!-- Always use absolute HTTPS URLs -->\n<meta property="og:url" content="https://example.com/page" />\n<meta property="og:image" content="https://example.com/image.jpg" />\n\n<!-- Sanitize dynamic content -->\n<meta property="og:title" content="${"{{title | escape}}"}" />` },
    ],
  }
}

const checkServiceWorkerScope: CheckFn = (_url, _headers, body) => {
  const swRegistration = body.match(/navigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(\s*["']([^"']+)["']/i)
  if (!swRegistration) return null
  const swUrl = swRegistration[1]
  if (swUrl.startsWith("http://")) {
    return {
      id: generateId(),
      title: "Service Worker Registered Over Insecure HTTP",
      severity: "high",
      category: "content",
      description: "A service worker is being registered from an HTTP URL. Service workers over HTTP can be intercepted and replaced with malicious code.",
      evidence: `Service worker URL: ${swUrl}`,
      riskImpact: "An attacker who can perform a MITM attack could replace the service worker with malicious code that persists in the browser and intercepts all subsequent requests.",
      explanation: "Service workers are powerful: they can intercept and modify all network requests, serve cached content, and run in the background. A compromised service worker effectively gives an attacker persistent control over the user's experience on your site. Browsers require HTTPS for service workers for this reason.",
      fixSteps: [
        "Serve the service worker file over HTTPS.",
        "Ensure the entire site uses HTTPS before registering service workers.",
        "Use relative URLs for service worker registration.",
      ],
      codeExamples: [
        { label: "Safe registration", language: "javascript", code: `// BAD\nnavigator.serviceWorker.register('http://example.com/sw.js');\n\n// GOOD - relative URL\nnavigator.serviceWorker.register('/sw.js');` },
      ],
    }
  }
  return null
}

const checkWindowOpenerAbuse: CheckFn = (_url, _headers, body) => {
  const openerAccess = body.match(/window\s*\.\s*opener\s*\.\s*(?:location|document|postMessage)/gi)
  if (openerAccess && openerAccess.length > 0) {
    return {
      id: generateId(),
      title: "Window.opener Access Detected",
      severity: "medium",
      category: "content",
      description: "JavaScript code accesses window.opener properties, which can be exploited for reverse tabnabbing if the page was opened from a cross-origin link.",
      evidence: `Found: ${openerAccess.slice(0, 3).join(", ")}`,
      riskImpact: "If this page is opened from another site, accessing window.opener.location can redirect the parent tab to a phishing page without the user noticing.",
      explanation: "When a page is opened via window.open() or target='_blank', it may have a reference to the opening window via window.opener. Malicious or vulnerable pages can use this to redirect the original tab, creating a convincing phishing attack where the user returns to find a fake login page.",
      fixSteps: [
        "Add rel='noopener noreferrer' to all external links with target='_blank'.",
        "Set window.opener = null at the top of pages that should not access the opener.",
        "Use the Cross-Origin-Opener-Policy header set to 'same-origin'.",
      ],
      codeExamples: [
        { label: "Safe link", language: "html", code: `<!-- Always include noopener -->\n<a href="https://external.com" target="_blank" rel="noopener noreferrer">External Link</a>` },
      ],
    }
  }
  return null
}

const checkCrossSiteWebSocketHijacking: CheckFn = (_url, _headers, body) => {
  const wsConnections = body.match(/new\s+WebSocket\s*\(\s*["']ws:\/\//gi)
  if (wsConnections && wsConnections.length > 0) {
    return {
      id: generateId(),
      title: "Insecure WebSocket Connection (ws://)",
      severity: "high",
      category: "content",
      description: `Found ${wsConnections.length} WebSocket connection(s) using unencrypted ws:// instead of wss://. WebSocket traffic is not protected by same-origin policy.`,
      evidence: `${wsConnections.length} insecure WebSocket connection(s) detected using ws:// protocol`,
      riskImpact: "Unencrypted WebSocket connections can be intercepted by network attackers. Additionally, WebSocket connections do not enforce same-origin policy, making them vulnerable to cross-site hijacking.",
      explanation: "WebSocket connections using ws:// transmit data in plaintext, similar to HTTP vs HTTPS. Furthermore, WebSocket connections are not bound by the same-origin policy, meaning any website can initiate a WebSocket connection to your server. Without proper origin validation, an attacker's page can hijack an authenticated WebSocket session.",
      fixSteps: [
        "Use wss:// (WebSocket Secure) for all WebSocket connections.",
        "Validate the Origin header on the server for all WebSocket upgrades.",
        "Implement CSRF token verification in the WebSocket handshake.",
        "Authenticate WebSocket connections independently of HTTP cookies.",
      ],
      codeExamples: [
        { label: "Secure WebSocket", language: "javascript", code: `// BAD\nconst ws = new WebSocket('ws://example.com/feed');\n\n// GOOD\nconst ws = new WebSocket('wss://example.com/feed');` },
      ],
    }
  }
  return null
}

const checkDocumentDomainUsage: CheckFn = (_url, _headers, body) => {
  if (/document\s*\.\s*domain\s*=/i.test(body)) {
    return {
      id: generateId(),
      title: "Deprecated document.domain Usage Detected",
      severity: "medium",
      category: "content",
      description: "The page sets document.domain, a deprecated practice that relaxes same-origin policy restrictions and is being removed from browsers.",
      evidence: "Found document.domain assignment in page JavaScript.",
      riskImpact: "Setting document.domain weakens same-origin isolation, allowing sibling subdomains to access each other's DOM. If any subdomain is compromised, it can attack all others sharing the same document.domain.",
      explanation: "document.domain was historically used to allow cross-subdomain communication. However, it weakens security by expanding the origin boundary. Chrome has deprecated it and other browsers are following. Modern alternatives like postMessage and CORS are safer and more reliable.",
      fixSteps: [
        "Replace document.domain with postMessage() for cross-origin communication.",
        "Use CORS headers for cross-origin API requests.",
        "Consider using Channel Messaging API for iframe communication.",
      ],
      codeExamples: [
        { label: "Use postMessage instead", language: "javascript", code: `// BAD - deprecated\ndocument.domain = 'example.com';\n\n// GOOD - postMessage\nwindow.parent.postMessage({ type: 'data', payload: result }, 'https://parent.example.com');\n\n// Listen for messages with origin check\nwindow.addEventListener('message', (e) => {\n  if (e.origin !== 'https://parent.example.com') return;\n  // handle e.data\n});` },
      ],
    }
  }
  return null
}

const checkPrototypePollutionSinks: CheckFn = (_url, _headers, body) => {
  const sinkPatterns = /(?:Object\.assign\s*\(\s*\{\}|_\.merge|_\.defaultsDeep|_\.set|jQuery\.extend\s*\(\s*true|\$\.extend\s*\(\s*true|\.prototype\s*\[)/gi
  const matches = body.match(sinkPatterns)
  if (matches && matches.length > 0) {
    return {
      id: generateId(),
      title: "Potential Prototype Pollution Sinks Detected",
      severity: "medium",
      category: "content",
      description: `Found ${matches.length} potential prototype pollution sink(s) that could allow attackers to modify Object.prototype and affect application behavior.`,
      evidence: matches.slice(0, 3).join(", "),
      riskImpact: "Prototype pollution can lead to XSS, privilege escalation, or denial of service by injecting properties into Object.prototype that are inherited by all objects.",
      explanation: "Prototype pollution occurs when an attacker can inject properties into JavaScript's Object.prototype. Functions like deep merge, recursive extend, and direct prototype access can be exploited via crafted input (e.g., __proto__ or constructor.prototype) to add unexpected properties to all objects in the application.",
      fixSteps: [
        "Use Object.create(null) for dictionary objects instead of plain objects.",
        "Sanitize user input to reject __proto__, constructor, and prototype keys.",
        "Use Map instead of plain objects for user-controlled key-value data.",
        "Update vulnerable libraries (lodash < 4.17.12, jQuery < 3.4.0).",
      ],
      codeExamples: [
        { label: "Safe merge", language: "javascript", code: `// BAD - vulnerable to pollution\nfunction merge(target, source) {\n  for (const key in source) {\n    target[key] = source[key]; // __proto__ can be injected\n  }\n}\n\n// GOOD - filter dangerous keys\nfunction safeMerge(target, source) {\n  for (const key of Object.keys(source)) {\n    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;\n    target[key] = source[key];\n  }\n}` },
      ],
    }
  }
  return null
}

const checkInsecureCryptoUsage: CheckFn = (_url, _headers, body) => {
  const weakCrypto: string[] = []
  if (/\bMD5\s*\(|\bCryptoJS\.MD5/i.test(body)) weakCrypto.push("MD5 (broken, collision attacks are trivial)")
  if (/\bSHA1\s*\(|\bCryptoJS\.SHA1|sha-?1/i.test(body)) weakCrypto.push("SHA-1 (deprecated, collision attacks demonstrated)")
  if (/\bDES\s*[.(]|CryptoJS\.DES\b/i.test(body)) weakCrypto.push("DES (56-bit key, brute-forceable in hours)")
  if (/\bRC4\b|ARC4|arcfour/i.test(body)) weakCrypto.push("RC4 (multiple biases, prohibited in TLS)")
  if (/Math\.random\s*\(\s*\)[\s\S]{0,30}(?:token|key|secret|nonce|password|salt|iv|hash)/i.test(body)) {
    weakCrypto.push("Math.random() used for security-sensitive values (not cryptographically secure)")
  }
  if (weakCrypto.length === 0) return null
  return {
    id: generateId(),
    title: "Weak or Broken Cryptography Detected",
    severity: "high",
    category: "content",
    description: `Found ${weakCrypto.length} instance(s) of weak or broken cryptographic algorithms in client-side JavaScript.`,
    evidence: weakCrypto.join("; "),
    riskImpact: "Weak cryptography provides a false sense of security. MD5 and SHA-1 hashes can be forged, DES/RC4 encryption can be broken, and Math.random() output is predictable.",
    explanation: "Cryptographic algorithms become weak over time as computing power increases and new attacks are discovered. MD5 collisions can be generated in seconds. SHA-1 collision attacks have been demonstrated practically. DES has only a 56-bit key. Math.random() uses a deterministic PRNG that is not suitable for any security purpose.",
    fixSteps: [
      "Replace MD5/SHA-1 with SHA-256 or SHA-3 for hashing.",
      "Replace DES/RC4 with AES-256-GCM for encryption.",
      "Use crypto.getRandomValues() or the Web Crypto API instead of Math.random() for security.",
      "Use the SubtleCrypto API for all client-side cryptographic operations.",
    ],
    codeExamples: [
      { label: "Web Crypto API", language: "javascript", code: `// BAD: Math.random for tokens\nconst token = Math.random().toString(36);\n\n// GOOD: Cryptographically secure random\nconst array = new Uint8Array(32);\ncrypto.getRandomValues(array);\nconst token = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');` },
    ],
  }
}

const checkDNSPrefetchControl: CheckFn = (_url, headers) => {
  const dnsPrefetch = headers.get("x-dns-prefetch-control")
  if (!dnsPrefetch) return null
  if (dnsPrefetch.toLowerCase() === "on") {
    return {
      id: generateId(),
      title: "DNS Prefetch Explicitly Enabled",
      severity: "low",
      category: "headers",
      description: "The X-DNS-Prefetch-Control header is set to 'on', which instructs browsers to perform DNS lookups for all links on the page before the user clicks them.",
      evidence: `X-DNS-Prefetch-Control: ${dnsPrefetch}`,
      riskImpact: "DNS prefetching can leak which links exist on the page to DNS servers and network observers. On pages with sensitive content, this reveals browsing patterns.",
      explanation: "DNS prefetching improves performance by resolving domain names before the user clicks a link. However, it also means DNS queries are sent for every link on the page, revealing page content to network observers and DNS providers. For privacy-sensitive pages, this should be disabled.",
      fixSteps: [
        "Set X-DNS-Prefetch-Control: off for pages with sensitive or private links.",
        "Leave the header unset for public pages where performance matters more.",
      ],
      codeExamples: [
        { label: "Disable for sensitive pages", language: "text", code: `X-DNS-Prefetch-Control: off` },
      ],
    }
  }
  return null
}

const checkPasswordFieldsWithoutPaste: CheckFn = (_url, _headers, body) => {
  const noPastePassword = body.match(/<input[^>]*type\s*=\s*["']password["'][^>]*onpaste\s*=\s*["'](?:return false|event\.preventDefault)[^"']*["']/gi)
  if (noPastePassword && noPastePassword.length > 0) {
    return {
      id: generateId(),
      title: "Password Fields Block Pasting",
      severity: "low",
      category: "content",
      description: "Password input fields have paste functionality disabled, which discourages the use of password managers and strong passwords.",
      evidence: `Found ${noPastePassword.length} password field(s) with onpaste="return false" or similar.`,
      riskImpact: "Users who cannot paste are less likely to use long, unique passwords from a password manager, leading to weaker passwords and increased credential reuse.",
      explanation: "Preventing paste on password fields was once considered a security measure to prevent password spraying. In reality, it harms security by making password managers difficult to use. Both NCSC (UK) and NIST guidelines explicitly recommend against disabling paste on password fields.",
      fixSteps: [
        "Remove all onpaste event handlers from password fields.",
        "Remove any JavaScript that calls preventDefault() on paste events for password inputs.",
        "Allow paste on all form fields, especially password fields.",
      ],
      codeExamples: [
        { label: "Allow paste", language: "html", code: `<!-- BAD -->\n<input type="password" onpaste="return false">\n\n<!-- GOOD -->\n<input type="password" autocomplete="current-password">` },
      ],
    }
  }
  return null
}

const checkExposedErrorMessages: CheckFn = (_url, _headers, body) => {
  const errorPatterns: string[] = []
  if (/(?:Fatal error|Parse error|Warning):\s+\w+\(\)/i.test(body)) errorPatterns.push("PHP error/warning message")
  if (/(?:at\s+\w+\s+\([\w/\\]+\.(?:js|ts):\d+:\d+\))/i.test(body)) errorPatterns.push("JavaScript stack trace with file paths")
  if (/(?:Traceback \(most recent call last\)|File "[\w/\\]+\.py", line \d+)/i.test(body)) errorPatterns.push("Python traceback")
  if (/(?:Exception in thread|at\s+[\w.]+\([\w]+\.java:\d+\))/i.test(body)) errorPatterns.push("Java stack trace")
  if (/(?:Microsoft OLE DB|ODBC|SQL Server|mysql_|pg_query|SQLite3::)/i.test(body)) errorPatterns.push("Database error message")
  if (/(?:System\.(?:NullReferenceException|ArgumentException|IO\.)|at\s+[\w.]+\s+in\s+[\w:\\/.]+:line\s+\d+)/i.test(body)) errorPatterns.push(".NET exception details")
  if (errorPatterns.length === 0) return null
  return {
    id: generateId(),
    title: "Application Error Messages Exposed to Users",
    severity: "medium",
    category: "information-disclosure",
    description: `Found ${errorPatterns.length} type(s) of detailed error messages visible in the page HTML, revealing internal application details.`,
    evidence: errorPatterns.join("; "),
    riskImpact: "Detailed error messages reveal file paths, database types, library versions, and internal logic that attackers use to craft targeted exploits.",
    explanation: "Verbose error messages are invaluable for debugging but dangerous in production. They reveal the technology stack, file system structure, database configuration, and sometimes even partial source code. Attackers use this information to identify specific vulnerabilities and craft precise exploits.",
    fixSteps: [
      "Configure production environments to display generic error pages.",
      "Log detailed errors server-side, never expose them to the client.",
      "Implement custom error handlers that return safe, generic messages.",
      "Disable debug/development mode in production configurations.",
    ],
    codeExamples: [
      { label: "Next.js error handling", language: "typescript", code: `// app/error.tsx\n'use client'\nexport default function Error() {\n  return (\n    <div>\n      <h1>Something went wrong</h1>\n      <p>Please try again later.</p>\n    </div>\n  )\n}` },
    ],
  }
}

export const allChecks: CheckFn[] = [
  checkStrictTransportSecurity,
  checkContentSecurityPolicy,
  checkXFrameOptions,
  checkXContentTypeOptions,
  checkReferrerPolicy,
  checkPermissionsPolicy,
  checkServerHeader,
  checkMixedContent,
  checkOpenRedirectHints,
  checkCookieSecurity,
  checkDeprecatedTLS,
  checkCORSMisconfiguration,
  checkSubresourceIntegrity,
  checkFormAction,
  checkCacheControlHeaders,
  checkXXSSProtection,
  checkEmailExposure,
  checkDirectoryListingHints,
  checkSensitiveFileReferences,
  checkOutdatedJsLibraries,
  checkRobotsTxtExposure,
  checkCMSFingerprinting,
  checkSecurityTxt,
  checkInlineJavaScript,
  checkAccessControlHeaders,
  checkCrossOriginOpenerPolicy,
  checkCrossOriginResourcePolicy,
  checkReverseTabnabbing,
  checkSourceMapExposure,
  checkSensitiveComments,
  checkHardcodedSecrets,
  checkPrivateIPExposure,
  checkDebugIndicators,
  checkDOMXSSSinks,
  checkInsecureIframes,
  checkTokenExposure,
  checkAutocompleteOnSensitiveFields,
  checkCSPReportOnly,
  checkFormTargetBlank,
  checkMetaRefresh,
  checkBaseTag,
  checkExcessivePermissions,
  checkPostMessageOrigin,
  checkSensitiveEndpoints,
  checkDangerousHTMLAttrs,
  checkInsecureFormSubmission,
  checkClickjackProtection,
  checkWeakCSPDirectives,
  checkUnencryptedConnections,
  checkCORSWildcardCredentials,
  checkHTMLCommentLeaks,
  checkJWTInURL,
  checkSensitiveMetaTags,
  checkStorageAPIUsage,
  checkMissingSubresourceIntegrity,
  checkOpenGraphInjection,
  checkServiceWorkerScope,
  checkWindowOpenerAbuse,
  checkCrossSiteWebSocketHijacking,
  checkDocumentDomainUsage,
  checkPrototypePollutionSinks,
  checkInsecureCryptoUsage,
  checkDNSPrefetchControl,
  checkPasswordFieldsWithoutPaste,
  checkExposedErrorMessages,
]
