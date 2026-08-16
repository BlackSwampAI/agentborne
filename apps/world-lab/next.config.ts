import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: ['@agentborne/shared', '@agentborne/world-engine'],
  experimental: { useTypeScriptCli: false },
  async rewrites() {
    return [
      {
        source: '/api/game/:path*',
        destination: 'http://127.0.0.1:8787/api/:path*',
      },
    ];
  },
};

export default nextConfig;
