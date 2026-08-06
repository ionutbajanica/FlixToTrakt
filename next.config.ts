import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: 'standalone',
  turbopack: {
    root: path.join(__dirname),
  },
  // Dev server is reachable on the LAN at the "Network" URL Next.js prints
  // on startup; without this, cross-origin requests to dev-only resources
  // from that origin are blocked and things silently misbehave.
  allowedDevOrigins: ['192.168.56.1'],
};

export default nextConfig;
