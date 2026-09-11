import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't regenerate AGENTS.md / CLAUDE.md on every dev start.
  agentRules: false,
  // Pre-computed runs are read from disk at request time; make sure they ship.
  outputFileTracingIncludes: {
    "/**": ["./data/runs/**"],
  },
};

export default nextConfig;
