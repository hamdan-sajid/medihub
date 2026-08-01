import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
