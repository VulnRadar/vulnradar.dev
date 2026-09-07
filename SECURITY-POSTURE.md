# VulnRadar Self-Hardening Checklist (vulnradar.dev)

We ship a scanner that grades other people's domains, so our own domain has to
pass its own checks. This is the reference for what vulnradar.dev should have in
place, split into two parts:

- **A. Enforced by the application** already lives in this repo (headers,
  cookies, `.well-known` files). Verify it, don't re-invent it.
- **B. DNS and edge records** are set at the DNS host (Cloudflare) or the
  registrar. These are the ones that are easy to forget because they are not in
  the codebase.

The fastest verification is to scan `https://vulnradar.dev` with VulnRadar
itself (dogfood it) and read the `dns`, `email`, `headers`, `ssl`, `tls`, and
`cookies` categories. Everything below maps to one of those.

---

## A. Enforced by the application (already in the repo)

| Control                                             | Where                                | Notes                                                                                                                                               |
| --------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| HSTS (2y, includeSubDomains, preload)               | `middleware.ts`                      | Submit the apex to https://hstspreload.org once you are sure every subdomain is HTTPS-only.                                                         |
| Content-Security-Policy (nonce, strict-dynamic)     | `middleware.ts`                      | Report-Only Trusted-Types is also set; promote it to enforcing once devtools shows zero violations across the app.                                  |
| X-Frame-Options: DENY + `frame-ancestors 'none'`    | `middleware.ts`                      | Clickjacking.                                                                                                                                       |
| X-Content-Type-Options: nosniff                     | `middleware.ts`                      | MIME sniffing.                                                                                                                                      |
| Referrer-Policy: strict-origin-when-cross-origin    | `middleware.ts`                      |                                                                                                                                                     |
| Permissions-Policy (camera/mic/geo/payment/usb off) | `middleware.ts`                      |                                                                                                                                                     |
| COOP: same-origin, CORP: same-origin                | `middleware.ts`                      | COEP is deliberately `unsafe-none` (the BrowserBase live-view iframe breaks under `require-corp`).                                                  |
| Cookies: Secure + HttpOnly + SameSite=Lax           | `lib/auth/auth.ts` (`createSession`) | Secure is gated on production.                                                                                                                      |
| security.txt                                        | `public/.well-known/security.txt`    | Keep `Expires` in the future; it currently expires 2028-06-18.                                                                                      |
| MTA-STS policy file                                 | `public/.well-known/mta-sts.txt`     | Served, but **not yet effective** until the DNS record + subdomain in part B exist. Currently `mode: testing`; flip to `enforce` once you trust it. |
| robots.txt, canonical URLs, no secrets in responses | `app/robots.ts`, `lib/seo/`          |                                                                                                                                                     |

TLS itself (1.2/1.3 only, valid chain, OCSP stapling) is handled by the hosting
platform and Cloudflare, not this repo. Confirm Cloudflare SSL/TLS mode is
**Full (strict)** and the minimum TLS version is **1.2**.

---

## B. DNS and edge records (set these at Cloudflare / the registrar)

Mail is on **ProtonMail**, so the mail records below use Proton's values. Adjust
if the provider ever changes.

### Email authentication

| Record          | Type      | Host                                                                        | Value (shape)                                                                                               | Why                                                                                                                                                                         |
| --------------- | --------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPF             | TXT       | `@`                                                                         | `v=spf1 include:_spf.protonmail.ch -all`                                                                    | Only Proton may send as us. Prefer `-all` (hard fail) over `~all` once confirmed.                                                                                           |
| DKIM            | CNAME x3  | `protonmail._domainkey`, `protonmail2._domainkey`, `protonmail3._domainkey` | the three targets Proton shows in its dashboard                                                             | Signs outbound mail.                                                                                                                                                        |
| DMARC           | TXT       | `_dmarc`                                                                    | `v=DMARC1; p=reject; rua=mailto:dmarc@vulnradar.dev; ruf=mailto:dmarc@vulnradar.dev; fo=1; adkim=s; aspf=s` | Tells receivers to reject spoofed mail and where to send reports. Start at `p=quarantine`, move to `p=reject`.                                                              |
| MTA-STS         | TXT       | `_mta-sts`                                                                  | `v=STSv1; id=<timestamp>`                                                                                   | Points enforcing senders at the policy file. **Bump `id` every time you change the policy.**                                                                                |
| MTA-STS host    | subdomain | `mta-sts`                                                                   | serve `.well-known/mta-sts.txt` over HTTPS at `https://mta-sts.vulnradar.dev/`                              | **Gotcha:** MTA-STS requires the policy at `mta-sts.<domain>`, NOT the apex. The file in this repo sits at the apex, so it does nothing until this subdomain serves it too. |
| TLS-RPT         | TXT       | `_smtp._tls`                                                                | `v=TLSRPTv1; rua=mailto:tlsrpt@vulnradar.dev`                                                               | Delivery-security failure reports.                                                                                                                                          |
| BIMI (optional) | TXT       | `default._bimi`                                                             | `v=BIMI1; l=https://vulnradar.dev/bimi-logo.svg`                                                            | Brand logo in inboxes; only worth it after DMARC is at `p=reject`.                                                                                                          |

### Zone and certificate integrity

| Record              | Where                  | Value (shape)                                                                                                     | Why                                   |
| ------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| DNSSEC              | Registrar + Cloudflare | enable in Cloudflare, then add the DS record at the registrar                                                     | Stops DNS answer tampering.           |
| CAA                 | DNS                    | `0 issue "letsencrypt.org"` (plus whatever CA Cloudflare/host uses) and `0 iodef "mailto:security@vulnradar.dev"` | Restricts which CAs may issue for us. |
| No dangling records | DNS                    | remove CNAMEs pointing at decommissioned hosts; avoid a wildcard that resolves to something you do not control    | Subdomain takeover.                   |

---

## C. Cloudflare-specific reminders

- **Managed robots.txt / AI Crawl Control**: leave it OFF. When on, it overrides
  our own `robots.txt` and disallows AI crawlers (see the AI-crawler indexing
  history). This is a known foot-gun for us.
- **SSL/TLS**: Full (strict), minimum TLS 1.2, Always Use HTTPS, HSTS enabled at
  the edge to match the app header.
- **Email Address Obfuscation (Scrape Shield)**: injecting the decode script
  trips our own CSP; turn it off for this zone (noted in `middleware.ts`).

---

## D. Optional feature subdomains and how nginx serves them

Two features use their own subdomain, and BOTH point back to this one app on the
same upstream port. You do not run a second app.

### mta-sts.vulnradar.dev (MTA-STS policy)

- DNS: **Proxied** (orange cloud) A record to this server.
- TLS: Cloudflare's Universal SSL covers it, so there is no origin cert to add.
- Serving: the app already serves `public/.well-known/mta-sts.txt` on any host,
  so there is nothing to add in nginx. Confirm
  `https://mta-sts.vulnradar.dev/.well-known/mta-sts.txt` returns the policy.

### ip4.vulnradar.dev (IPv4 capture for IPv6 sign-ins)

Fussier, because it has to force the browser onto IPv4:

1. **DNS:** a **DNS-only (grey-cloud)** A record to this server, with **no AAAA
   record**. The missing AAAA is what forces IPv4. Do NOT proxy it through
   Cloudflare (Cloudflare is dual-stack, which defeats the point), and a
   Cloudflare Worker cannot do this either, for the same reason.
2. **Cert:** because it bypasses Cloudflare, nginx must present a valid cert for
   `ip4.vulnradar.dev` (a `*.vulnradar.dev` wildcard, or
   `certbot -d ip4.vulnradar.dev`).
3. **nginx:** put this in its OWN config file, not in the main `vulnradar.dev`
   one. Both work, but one file per server name is the nginx convention and
   keeps things tidy. Create `/etc/nginx/sites-available/ip4.vulnradar.dev` and
   symlink it into `sites-enabled/` (`sudo ln -s
/etc/nginx/sites-available/ip4.vulnradar.dev /etc/nginx/sites-enabled/`), or
   drop it straight into `/etc/nginx/conf.d/ip4.vulnradar.dev.conf`. It proxies
   ONLY the echo endpoint to the same app and 404s everything else (this host is
   directly exposed, so it should not serve the rest of the site):

   ```nginx
   server {
     listen 80;
     server_name ip4.vulnradar.dev;
     return 301 https://$host$request_uri;
   }

   server {
     # Check your nginx version first: `nginx -v`.
     #
     # 1.25.1 and newer: HTTP/2 is its own directive, and putting it on the
     # listen line warns on every reload.
     #     listen 443 ssl;
     #     http2 on;
     #
     # Older than 1.25.1: `http2` as a standalone directive does not exist and
     # nginx refuses to start with "unknown directive", so it goes on the
     # listen line, which is the line below. Ubuntu 22.04 ships 1.18 and
     # 24.04 ships 1.24, so this is still the common case.
     listen 443 ssl http2;
     server_name ip4.vulnradar.dev;

     ssl_certificate     /etc/letsencrypt/live/ip4.vulnradar.dev/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/ip4.vulnradar.dev/privkey.pem;
     ssl_protocols TLSv1.2 TLSv1.3;
     ssl_ciphers HIGH:!aNULL:!MD5:!SHA1:!kRSA;

     # Only the echo endpoint, proxied to the SAME app as vulnradar.dev.
     location = /api/v3/whoami-ip {
       # Wherever the app is actually bound. 127.0.0.1 is what you want, but
       # check with `ss -ltnp | grep 3000` first: on Pterodactyl, and on any
       # `docker run -p 3000:3000`, the app is bound to a public address and
       # proxying to loopback gets connection refused. See D2 item 4 for how
       # to move the binding, which is the part that closes the port.
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_http_version 1.1;
       proxy_hide_header X-Powered-By;
     }

     location / {
       return 404;
     }
   }
   ```

   Use IPv4-only listeners here (no `listen [::]:443` line at all).
   The point of this host is to be IPv4-only; an IPv6 listener is unnecessary,
   and if an AAAA record ever slipped in it would let the host answer over IPv6
   and defeat the capture. Then `sudo nginx -t && sudo systemctl reload nginx`.

4. **App env:** set `NEXT_PUBLIC_IPV4_ECHO_URL` in the app's build/deploy
   environment (this is a `NEXT_PUBLIC_` variable, so it is baked in at build
   time: setting it only in a local `.env.local` will NOT reach production).
   Then rebuild:

   ```
   NEXT_PUBLIC_IPV4_ECHO_URL=https://ip4.vulnradar.dev/api/v3/whoami-ip
   ```

   Leave it unset to turn the feature off; nothing breaks, IPv6 users just show
   an IPv6 address on the security page.

Both subdomains proxy to the same upstream (`127.0.0.1:3000`) on the same
nginx. It is one app on one port.

---

## D2. The main server block

Four things about the primary `vulnradar.dev` block are easy to get wrong and
give no error when you do. All four have bitten this deployment.

### 1. `add_header` appends, it does not replace

This is the one that costs the most time, because the symptom looks like a bug
in the app. nginx's `add_header` does not override a header the upstream
already sent: it adds a second copy. So a security header set in
`middleware.ts` and set again in nginx arrives at the browser **twice**, and a
scanner (including ours) reports the duplicate.

To override an upstream header you have to remove it first:

```nginx
proxy_hide_header Cross-Origin-Embedder-Policy;
add_header Cross-Origin-Embedder-Policy "credentialless" always;
```

The better answer is usually to set it in exactly one place. The app already
sets the full header set; nginx does not need to repeat any of it.

### 2. Do not send `Connection: upgrade` at all

The copy-pasted Next.js reverse-proxy recipe everyone starts from includes:

```nginx
proxy_set_header Upgrade    $http_upgrade;
proxy_set_header Connection "upgrade";
```

That literal `"upgrade"` is unconditional: it goes out on **every** request,
not just WebSocket ones. Most upstreams tolerate it, some proxies and CDNs do
not, and the failure is intermittent because it depends which hop is in the
path.

**VulnRadar serves no WebSocket endpoints**, so the correct fix is to delete
both lines rather than to make them conditional. There is no WS route in the
app, and the live browser view is an iframe pointing at BrowserBase, which the
visitor's browser connects to directly rather than through your proxy. Keep
`proxy_http_version 1.1;`, which is about upstream keepalive and is still
wanted.

If a future feature ever does add a WebSocket route, the idiom is a `map` at
`http` level (outside `server{}`, so a file in `conf.d/`, which Debian and
Ubuntu include before `sites-enabled`):

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

and then `proxy_set_header Connection $connection_upgrade;`. Referencing that
variable without defining it first is an `unknown "connection_upgrade"
variable` error at startup, which is what you get if the file lands in the
wrong directory or after the site config.

### 3. The read timeout has to clear the longest request

nginx's default `proxy_read_timeout` is **60 seconds**. AI verification on a
deep scan answers with one JSON body at the end rather than streaming, and with
a reasoning model it can legitimately run for minutes: the app's own ceiling
(`CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS`) is 900 seconds. A proxy left at its
default cuts the connection long before anything configured inside the app
matters, and the browser gets a 504 with no explanation.

```nginx
proxy_read_timeout 960s;
proxy_send_timeout 960s;
```

Keep it above the app's budget, not equal to it, so the app is always the thing
that times out and reports why. This is the one layer the application cannot
see or fix on your behalf.

### 4. Proxy to wherever the app actually listens, then close the public port

`proxy_pass http://<your public IP>:3000;` works and has a real cost: it
requires the app's port to stay reachable from the internet, which means anyone
who knows the address can bypass Cloudflare and hit the origin directly. WAF
rules, bot protection, rate limits and IP filtering all become optional.

`proxy_pass http://127.0.0.1:3000;` is the answer **only if the app is actually
bound to loopback**. Check before changing it:

```bash
ss -ltnp | grep 3000
```

If that shows `127.0.0.1:3000` you are fine. If it shows a public address, the
proxy will get connection refused and the site goes down, so fix the binding
first:

- **Docker / docker compose:** publish as `127.0.0.1:3000:3000` rather than
  `3000:3000`.
- **Pterodactyl:** Wings binds each container to the IP of its primary
  allocation, so this is a panel change, not a config one. Admin -> Nodes ->
  your node -> Allocations, create one on `127.0.0.1`, assign it to the server
  as primary, remove the public one, restart.

If you cannot change the binding, firewall the port instead, and note that
**`ufw deny 3000/tcp` does not work when the app is in Docker**. Docker
publishes ports by writing its own iptables rules into the `DOCKER` chain,
which is evaluated before UFW sees the packet: the port stays open and `ufw
status` reports it blocked, which is worse than not trying. The rule belongs in
`DOCKER-USER`, which Docker consults first and never rewrites:

```bash
ip route get 1.1.1.1                 # identify the public interface
sudo iptables -I DOCKER-USER -i eth0 -p tcp --dport 3000 -j DROP
sudo netfilter-persistent save       # needs iptables-persistent
```

That drops only traffic arriving from outside. nginx reaching the container
from the host does not traverse `DOCKER-USER`, so the site keeps working.

---

## E. When you are confident, tighten

1. MTA-STS `mode: testing` -> `enforce` (in `public/.well-known/mta-sts.txt`),
   and bump the `_mta-sts` TXT `id`.
2. DMARC `p=quarantine` -> `p=reject`.
3. SPF `~all` -> `-all`.
4. Promote the Report-Only Trusted-Types CSP to enforcing.
5. Submit the apex to the HSTS preload list.

Re-scan vulnradar.dev after each change and confirm the score stays clean. If
our own domain cannot get a top grade from our own engine, that is a bug in one
or the other, and both are worth fixing.
