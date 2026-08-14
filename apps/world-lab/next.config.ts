import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@agentborne/shared', '@agentborne/world-engine'],
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
