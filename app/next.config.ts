import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // Pin the workspace root so Next does not walk up to the home directory and
  // pick up an unrelated lockfile.
  turbopack: { root: path.join(__dirname) },
};
export default nextConfig;
