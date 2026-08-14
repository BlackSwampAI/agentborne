import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@agentborne/shared', '@agentborne/world-engine'],
};

export default nextConfig;
