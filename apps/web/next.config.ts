import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel builds with apps/web as the root directory, so file tracing defaults
  // to this directory and silently omits everything above it — including
  // apps/agent/dist, which /api/runs imports. The pages still work (they only
  // import from apps/web), but the route handler 500s because its module is not
  // in the function bundle. Point tracing at the workspace root instead.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),

  // LangChain and friends are large, do dynamic requires, and expect to run as
  // real Node modules. Bundling them into the serverless function breaks those
  // assumptions; leaving them external keeps them as plain node_modules imports.
  serverExternalPackages: [
    "deepagents",
    "langchain",
    "@langchain/core",
    "@langchain/langgraph",
    "@langchain/anthropic",
    "@langchain/google-genai",
    "@langchain/groq",
  ],
};

export default nextConfig;
