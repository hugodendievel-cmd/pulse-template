// diag.mjs — Diagnostic script for Pulse (template)

console.log("\n  PULSE — Diagnostics\n  ──────────────────\n");

// Node version
const [major] = process.versions.node.split(".").map(Number);
console.log(
  `  Node.js:  v${process.versions.node} ${major >= 22 ? "✓" : "✗ (need 22+)"}`,
);

// Imports
const modules = [["express", () => import("express")]];
for (const [name, fn] of modules) {
  try {
    await fn();
    console.log(`  ${name}: ✓`);
  } catch {
    console.log(`  ${name}: ✗ (npm install)`);
  }
}

// Source imports — driven by SOURCE_NAMES so diag stays in sync with briefing.mjs
const { SOURCE_NAMES, SOURCE_COUNT } = await import("./apis/briefing.mjs");
const { loadDomain } = await import("./domains/index.mjs");

// Slugs come from the active pack's `module` fields; the static map only
// covers display names that predate the packs (used by older child repos).
const slugOf = new Map(loadDomain().sources.map((s) => [s.name, s.module]));
const NAME_TO_SLUG = {
  "Hacker News": "hackernews",
  ArXiv: "arxiv",
  "GitHub Trending": "github-trending",
  TechCrunch: "techcrunch",
  "The Verge": "theverge",
  VentureBeat: "venturebeat",
  Reddit: "reddit",
  "Google News": "google-news",
  NewsAPI: "newsapi",
  "Product Hunt": "producthunt",
  "Simon Willison": "simonwillison",
};

console.log(`\n  Sources (${SOURCE_COUNT} total):`);
for (const name of SOURCE_NAMES) {
  const slug = slugOf.get(name) || NAME_TO_SLUG[name];
  try {
    if (!slug) throw new Error("no slug mapping");
    await import(`./apis/sources/${slug}.mjs`);
    console.log(`    ${name}: ✓`);
  } catch (err) {
    console.log(`    ${name}: ✗ (${err.message})`);
  }
}
console.log(`  Total: ${SOURCE_COUNT} sources`);

// Port check
const port = process.env.PORT || 3200;
try {
  const { createServer } = await import("node:net");
  await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(port, () => {
      srv.close();
      resolve();
    });
  });
  console.log(`\n  Port ${port}: ✓ (available)`);
} catch {
  console.log(`\n  Port ${port}: ✗ (in use)`);
}

// .env check
try {
  const { readFileSync } = await import("node:fs");
  readFileSync(".env", "utf-8");
  console.log(`  .env: ✓`);
} catch {
  console.log(`  .env: ✗ (copy .env.example to .env)`);
}

console.log("\n  Done.\n");
