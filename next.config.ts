import type { NextConfig } from "next";
import { assertEnv } from "./src/env/required";

// Next has loaded .env* by the time this file runs, so this crashes on boot
// when configuration is missing.
assertEnv();

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
