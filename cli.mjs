#!/usr/bin/env node
// cli.mjs — CLI entrypoint for the pulse dashboard

import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Check Node.js version
const [major] = process.versions.node.split(".").map(Number);
if (major < 22) {
  console.error(
    `\n  ✗ pulse requires Node.js 22+, you have v${process.versions.node}\n`,
  );
  process.exit(1);
}

// Copy .env.example → .env in user's cwd if missing
const envDest = resolve(process.cwd(), ".env");
if (!existsSync(envDest)) {
  const envSrc = resolve(__dirname, ".env.example");
  if (existsSync(envSrc)) {
    copyFileSync(envSrc, envDest);
    console.log(
      "[pulse] Created .env in current directory — edit it to configure LLM and API keys\n",
    );
  }
}

// Export package root so modules can find bundled assets
process.env.__AI_PULSE_ROOT = __dirname;

// Start the server
await import("./server.mjs");
