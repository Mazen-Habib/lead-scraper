import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /* config options here */
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });
    return config;
  },

    // Root is the repo root (one level up), not this app's own directory —
    // src/lib/facets.ts imports ../../../shared/*.json, which lives outside
    // this Next.js project. Turbopack refuses to resolve modules outside its
    // configured root, so the root must cover the shared taxonomy files too.
    turbopack: {
      root: path.join(__dirname, ".."),
      rules: {
        '*.svg': {
          loaders: ['@svgr/webpack'],
          as: '*.js',
        },
      },
    },
  
};

export default nextConfig;
