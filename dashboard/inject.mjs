// dashboard/inject.mjs — Build a self-contained static snapshot of the
// dashboard (design-reference decision 6; architecture §2.8). It reads the
// same persisted run as `apis/save-briefing.mjs`, inlines the shell's CSS and
// client JS, exposes the pure data layer as a classic `window.RenderCore`, and
// emits `window.__PULSE_BOOTSTRAP__` so `app.js` boots server-free.
//
// Working sequence:
//   npm run brief:save   # sweeps and persists .pulse/runs/latest.json
//   npm run inject       # writes ./index-static.html and ./fonts/
// (`npm run sweep` only prints JSON — it never persists the run.)
//
// Manual self-check after a run (or use `node dashboard/inject.mjs --check`):
//   grep -c 'window.__PULSE_BOOTSTRAP__' index-static.html
//   grep -c '"static":true' index-static.html
//   grep -E '__PULSE_[A-Z_]+__|hideLoading[\(]|\brender[\(]' index-static.html
//   test -d fonts && ls fonts/*.woff2
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDomain, normalizeViews } from "../domains/index.mjs";
import { pulsePath } from "../lib/data-dir.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const publicDir = resolve(pkgRoot, "dashboard", "public");
const runsLatest = pulsePath("runs", "latest.json");

// ── Input: latest persisted sweep (save-briefing's location) ──
let run;
try {
  run = JSON.parse(readFileSync(runsLatest, "utf-8"));
} catch {
  console.error(
    `[Inject] No ${runsLatest} found. Run \`npm run brief:save\` first (npm run sweep only prints JSON).`,
  );
  process.exit(1);
}

// ── Domain chrome: exactly the GET /api/domain payload (server.mjs) ──
// Never spread the pack — that would leak sources/prompts/freshSources.
let pack;
try {
  pack = loadDomain();
} catch (err) {
  // Fail loudly rather than write a half-branded snapshot.
  console.error(`[Inject] Failed to load domain pack: ${err.message}`);
  process.exit(1);
}
const { name, tagline, credit, panels, stats, colors } = pack;
const views = Array.isArray(pack.views) ? pack.views : normalizeViews(pack);
const domain = { name, tagline, credit, panels, stats, views, colors };

// ── App data: the run snapshot wrapped like /api/data ──
const data = {
  sweep: run,
  delta: { isFirst: true },
  analysis: null,
  generatedAt: run.timestamp,
};

// ── Branding helpers ──
// Deliberate local copies of server.mjs's helpers (source of truth): the
// domain-endpoint test source-scans server.mjs for `function pulseNameHtml`,
// so hoisting these to lib/ would widen scope for no gain.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// "Acme Corp" → Acme<span>CORP</span> wordmark (first word plain, rest
// uppercased). Example: "AI Pulse" → AI<span>PULSE</span>.
function pulseNameHtml(packName) {
  const words = escapeHtml(packName).split(" ");
  const first = words.shift();
  const rest = words.join(" ").toUpperCase();
  return rest ? `${first}<span>${rest}</span>` : first;
}

function creditHtml(packCredit) {
  if (!packCredit?.text || !packCredit?.url) return "";
  return `<a class="logo-credit" href="${escapeHtml(packCredit.url)}" target="_blank" rel="noopener">${escapeHtml(packCredit.text)}</a>`;
}

// ── Read the shell sources ──
let html = readFileSync(resolve(publicDir, "index.html"), "utf-8");
let css = readFileSync(resolve(publicDir, "style.css"), "utf-8");
const js = readFileSync(resolve(publicDir, "app.js"), "utf-8");
const rcSource = readFileSync(resolve(publicDir, "render-core.mjs"), "utf-8");

// ── Fonts: copy next to the output, keep the inlined url() valid ──
// Full-bleed snapshot must not depend on the server's /fonts route.
const outDir = process.cwd();
const fontRel = "fonts/";
mkdirSync(resolve(outDir, fontRel), { recursive: true });
cpSync(resolve(publicDir, "fonts"), resolve(outDir, fontRel), {
  recursive: true,
});
// style.css uses url("fonts/…") relative to the asset root; rewrite to the
// copied path so the reference resolves when index-static.html sits in outDir.
css = css.replace(/url\((["']?)fonts\//g, `url($1${fontRel}`);

// ── Inline render-core as a CLASSIC script ──
// Module scripts are deferred and would run after the inlined app.js calls
// init()/applyData(); stripping `export ` and exposing a plain global keeps
// window.RenderCore populated synchronously. The literal must cover every
// export in render-core.mjs (tests/inject-static.test.mjs enforces this).
const renderCoreClassic = rcSource
  .replace(/^export\s+/gm, "")
  .concat(
    `\nwindow.RenderCore = { normalizeItem, collectItems, aggregateByCategory, selectPanelItems, previewSources, SLOW_FETCH_MS, sourceCardStats, sortSourceCards, aggregateItems, formatNum, compactAge, statValue, sourceCountsFor, freshness, sourceColorFor, viewFor, viewPanels, editionCardModel, editionReaderModel, editionSignalCount, digestSignalCount, sourceHealthSummary, nextSweepSeconds, panelDeltaCount, weekNumberOf, archiveRows, storyMeta, healthTally, panelIdForSource, moreHeadlines };\n`,
  );

// ── Bootstrap global: `<`-escaped so </script> cannot break out ──
const safeJson = (v) =>
  JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
const bootstrapJs = `window.__PULSE_BOOTSTRAP__ = {"domain":${safeJson(domain)},"data":${safeJson(data)},"static":true};`;

// ── Inline the shell, matching the authored markup ──
html = html.replace(
  '<link rel="stylesheet" href="style.css" />',
  `<style>${css}</style>`,
);
html = html.replace(
  /<script type="module">\s*import \* as RC from "\.\/render-core\.mjs";\s*window\.RenderCore = RC;\s*<\/script>/,
  `<script>\n${renderCoreClassic}</script>`,
);
// Bootstrap BEFORE app.js: app.js reads IS_STATIC at module scope.
html = html.replace(
  '<script defer src="app.js"></script>',
  `<script>${bootstrapJs}</script>\n<script>${js}</script>`,
);

// ── Branding tokens (mirrors server.mjs's / handler) ──
// __PULSE_NAME__ appears twice (title + meta description), so replaceAll.
// __PULSE_NEWSLETTER_LINK__ is emptied: /newsletter is a server route and is
// dead in a static file, so the header-right link is intentionally omitted.
html = html
  .replaceAll("__PULSE_NAME_HTML__", pulseNameHtml(name))
  .replaceAll("__PULSE_NAME__", escapeHtml(name))
  .replaceAll("__PULSE_TAGLINE__", escapeHtml(tagline ?? ""))
  .replaceAll("__PULSE_CREDIT__", creditHtml(credit))
  .replaceAll("__PULSE_NEWSLETTER_LINK__", "")
  // The environment tag is deployment-scoped; a static snapshot has no env.
  .replaceAll("__PULSE_ENV_TAG__", "");

const outPath = resolve(outDir, "index-static.html");
writeFileSync(outPath, html);
console.log(`[Inject] Written to ${outPath}`);

// ── Optional self-check (never required for a normal run) ──
if (process.argv.includes("--check")) {
  const out = readFileSync(outPath, "utf-8");
  const problems = [];
  if (!out.includes("window.__PULSE_BOOTSTRAP__")) {
    problems.push("missing window.__PULSE_BOOTSTRAP__");
  }
  if (!out.includes('"static":true')) problems.push('missing "static":true');
  if (/__PULSE_[A-Z_]+__/.test(out.split("__PULSE_BOOTSTRAP__").join(""))) {
    problems.push("unresolved __PULSE_ token");
  }
  if (/hideLoading\s*\(/.test(out)) problems.push("hideLoading call remains");
  if (/\brender\s*\(/.test(out)) problems.push("bare render call remains");
  if (!existsSync(resolve(outDir, fontRel))) {
    problems.push(`missing ${fontRel} directory`);
  }
  if (problems.length) {
    console.error(`[Inject] --check failed: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log("[Inject] --check passed");
}
