/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // @meshsdk/* ship WASM (cardano serialization) — needs async wasm support.
  transpilePackages: ["@meshsdk/core", "@meshsdk/react"],
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    // tlock-js uses a dynamic require() for isomorphic (node/browser) crypto, which
    // webpack flags as a "Critical dependency" — harmless here (verified: the browser
    // seal round-trips), so silence the cosmetic warning.
    config.module.exprContextCritical = false;
    return config;
  },
};

export default nextConfig;
