import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel builds with apps/web as the root directory, so file tracing defaults
  // to this directory and silently omits everything above it — including the
  // agent package and the node_modules that npm workspaces hoist to the repo
  // root. Pages still work (they only import from apps/web); the /api/runs
  // route does not, because it reaches outside.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),

  // Note on serverExternalPackages: deepagents and the LangChain packages are
  // deliberately NOT listed there. They are ESM-only ("type": "module"), and
  // marking a package external makes Next require() it at runtime, which throws
  //   Cannot use import statement outside a module
  // in the deployed function. Bundling them is what works.
};

export default nextConfig;
