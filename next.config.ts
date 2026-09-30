import type { NextConfig } from "next";

// `standalone` is for Docker/Cloud Run only. Netlify's Next runtime breaks with it
// (often "Page not found"). Enable via OUTPUT_STANDALONE=1 when building images.
const nextConfig: NextConfig = {
  ...(process.env.OUTPUT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  experimental: {
    staleTimes: {
      dynamic: 300,
      static: 600,
    },
  },
  // Ensure Prisma query engine binaries are available in Netlify serverless functions
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/.prisma/client/**",
      "./node_modules/@prisma/client/**",
    ],
  },
};

export default nextConfig;
