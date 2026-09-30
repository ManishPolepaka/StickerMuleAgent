import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep visited pages in the client router cache so detail routes feel instant.
  experimental: {
    staleTimes: {
      dynamic: 300,
      static: 600,
    },
  },
};

export default nextConfig;
