import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module: Node loads it at runtime, the bundler must not touch it.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
