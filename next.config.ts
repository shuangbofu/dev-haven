import type { NextConfig } from "next";
const config: NextConfig = {
  output: "export",
  assetPrefix: process.env.NODE_ENV === 'production' ? './' : undefined,
  images: { unoptimized: true },
  devIndicators: false,
};
export default config;
