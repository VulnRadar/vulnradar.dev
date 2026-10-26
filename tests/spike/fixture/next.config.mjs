/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // The real next.config.mjs carries these two rewrites. A config rewrite list
  // that is not empty changes how Next orders its routing phases, so the
  // fixture keeps the same shape instead of a config with none.
  async rewrites() {
    return [
      {
        source: "/.well-known/security.txt",
        destination: "/api/security-txt",
      },
      { source: "/security.txt", destination: "/api/security-txt" },
    ];
  },
};

export default nextConfig;
