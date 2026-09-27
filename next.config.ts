import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static resolves its binary path at runtime; keep it out of the bundle
  // and ship the binary + frame fonts with every server function.
  serverExternalPackages: ["ffmpeg-static", "youtubei.js"],
  outputFileTracingIncludes: {
    "/**": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
