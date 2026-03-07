export async function GET() {
  const body = `Contact: mailto:security@vulnradar.dev
Contact: https://vulnradar.dev/contact
Expires: 2027-02-15T00:00:00.000Z
Preferred-Languages: en
Canonical: https://vulnradar.dev/.well-known/security.txt
Policy: https://vulnradar.dev/legal/acceptable-use
`

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  })
}
