// lib/newsletter/render.mjs — public edition page renderer (web documents).
//
// Server-rendered HTML for GET /newsletter, /newsletter/:id and /digest.
// These are WEB documents. The edition/digest JSON is the contract, and this
// file is NOT the future Listmonk email body: the shell below (flex, radius,
// hairline dividers) was never email-safe, so nothing is lost. Phase 2 email
// gets its own table-based template reading the same sanitized JSON — do not
// add email-client workarounds here.

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The only anchor builder; escapes both the URL (attribute context) and text.
function link(url, text, cls = "") {
  if (!url) return esc(text);
  const c = cls ? ` class="${cls}"` : "";
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"${c}>${esc(text)}</a>`;
}

const STYLES = `
@font-face{font-family:"Inter";font-style:normal;font-weight:400 700;font-display:swap;src:url("/fonts/inter.woff2") format("woff2");}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/jetbrains-mono-400.woff2") format("woff2");}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:500;font-display:swap;src:url("/fonts/jetbrains-mono-500.woff2") format("woff2");}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:700;font-display:swap;src:url("/fonts/jetbrains-mono-700.woff2") format("woff2");}
:root{--paper:#f5f1e9;--surface:#faf8f3;--surface-2:#f1ede4;--inset:#ece8de;--strip:#efeade;--ink:#1d1b19;--ink-2:#3b3732;--ink-3:#55504a;--ink-4:#6b665e;--hairline:rgba(29,27,25,.08);--green:#12a150;--green-ink:#0c7a3d;--green-tint:#e0efe3;--green-tint-2:#e4f0e4;--green-soft:#7cc294;--amber-ink:#96500c;--amber-tint:#fbe8d4}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--paper);color:var(--ink-2);font-family:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased}
.doc-head{background:var(--surface);border-bottom:1px solid var(--hairline)}
.doc-head-inner{max-width:720px;margin:0 auto;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.doc-wordmark{font-family:"JetBrains Mono",monospace;font-size:17px;font-weight:700;color:var(--ink);text-transform:lowercase}
.zip{color:var(--green-ink)}
.doc-credit{font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--ink-4)}
.doc-credit a{color:var(--ink-4);text-decoration:none}
.doc-credit a:hover{color:var(--green-ink)}
.doc-main{max-width:720px;margin:0 auto;padding:22px 20px 40px}
.doc-eyebrow{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-4);margin-bottom:18px}
section{margin-top:28px}
.sec-label{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-4);display:flex;align-items:center;gap:12px;margin-bottom:10px}
.sec-label::after{content:"";flex:1;height:1px;background:var(--hairline)}
.doc-foot{background:var(--surface);border-top:1px solid var(--hairline)}
.doc-foot-inner{max-width:720px;margin:0 auto;padding:16px 20px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--ink-4)}
.doc-foot-archive{padding-top:0}
.doc-foot a{color:var(--green-ink);text-decoration:none}
.doc-foot a:hover{color:var(--green)}
.doc-pills{display:flex;gap:8px;flex-wrap:wrap}
.doc-pill{font-family:"JetBrains Mono",monospace;font-size:11.5px;color:var(--ink-3);background:var(--inset);border-radius:999px;padding:4px 11px;text-decoration:none}
.doc-pill:hover{color:var(--green-ink)}
.doc-msg{padding:8px 0 4px}
.doc-msg h1{font-family:"Inter",system-ui,sans-serif;font-size:20px;color:var(--ink);margin-bottom:10px}
.doc-msg p{font-size:14.5px;color:var(--ink-3);margin-bottom:10px}
.doc-msg code{font-family:"JetBrains Mono",monospace;font-size:12.5px;background:var(--inset);border-radius:4px;padding:1px 6px}
.doc-back{margin-top:18px;font-size:13.5px}
.doc-back a{color:var(--green-ink);text-decoration:none;font-weight:600}
.doc-back a:hover{color:var(--green)}
@media(min-width:720px){.doc-head-inner,.doc-main,.doc-foot-inner{padding-left:32px;padding-right:32px}}
/* shared document body primitives — used by both the daily and weekly bodies */
.doc-lede{font-family:"Inter",system-ui,sans-serif;font-size:20px;line-height:1.46;letter-spacing:-.008em;color:var(--ink-2)}
.doc-stories{list-style:none}
.doc-story{display:grid;grid-template-columns:22px 1fr;gap:12px;padding:14px 0;border-top:1px solid var(--hairline)}
.doc-story:first-child{border-top:0}
.doc-rank{font-family:"JetBrains Mono",monospace;font-size:18px;font-weight:700;color:var(--green)}
.doc-headline{font-family:"Inter",system-ui,sans-serif;font-size:17px;font-weight:600;line-height:1.3;letter-spacing:-.01em;color:var(--ink)}
.doc-headline a{color:inherit;text-decoration:none}
.doc-headline a:hover{color:var(--green-ink)}
.doc-summary{font-family:"Inter",system-ui,sans-serif;font-size:14.5px;line-height:1.55;color:var(--ink-3);margin-top:4px}
.doc-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.doc-chip{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--green-ink);background:var(--green-tint-2);border-radius:4px;padding:2px 7px}
.doc-chip.hot{color:var(--amber-ink);background:var(--amber-tint)}
.doc-model{padding:12px 0;border-top:1px solid var(--hairline);font-size:14.5px}
.doc-model:first-child{border-top:0}
.doc-model-name{font-weight:600;color:var(--ink)}
.doc-model a{color:var(--ink);text-decoration:none}
.doc-model a:hover{color:var(--green-ink)}
.doc-model-org{color:var(--ink-4);font-size:13.5px}
.doc-model p{color:var(--ink-3);font-size:14px;margin-top:2px}
.doc-paper{background:var(--surface-2);border-radius:10px;padding:16px 18px;margin-top:14px}
.doc-paper h3{font-size:15px;color:var(--ink);margin-bottom:3px}
.doc-paper h3 a{color:var(--ink);text-decoration:none}
.doc-paper h3 a:hover{color:var(--green-ink)}
.doc-paper .authors{font-size:12.5px;color:var(--ink-4);margin-bottom:6px}
.doc-paper .insight{font-size:14px;color:var(--ink-3)}
.doc-bullets{list-style:none}
.doc-bullets li{padding:6px 0;font-size:14.5px;color:var(--ink-2)}
.doc-bullets li::before{content:"—";color:var(--green);margin-right:9px;font-weight:600}
.doc-bullets a{color:var(--ink-2);text-decoration:none}
.doc-bullets a:hover{color:var(--green-ink)}
.doc-lookahead{font-family:"Inter",system-ui,sans-serif;font-size:15.5px;line-height:1.6;color:var(--ink-2)}
/* Responsive overrides stay last: media queries add no specificity, so the
   base .doc-lede/.doc-headline rules above would otherwise win over this block. */
@media(max-width:520px){.doc-lede{font-size:18px}.doc-headline{font-size:16px}}
`;

function pageShell({
  title,
  brand,
  cadence = "Daily",
  eyebrow = "",
  body = "",
  footnote = "",
  pills = "",
}) {
  const brandName = esc(brand?.name || "Pulse");
  const credit =
    brand?.credit?.text && brand?.credit?.url
      ? `<div class="doc-credit"><a href="${esc(brand.credit.url)}" target="_blank" rel="noopener noreferrer">${esc(brand.credit.text)}</a></div>`
      : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.svg" />
<style>${STYLES}</style>
</head>
<body>
<header class="doc-head"><div class="doc-head-inner">
  <span class="doc-wordmark">${brandName} <span class="zip">${esc(cadence)}</span></span>
  ${credit}
</div></header>
<main class="doc-main">
  ${eyebrow ? `<div class="doc-eyebrow">${esc(eyebrow)}</div>` : ""}
  ${body}
</main>
<footer class="doc-foot">
  <div class="doc-foot-inner">${footnote}<span>generated · <a href="/">Dashboard</a></span></div>
  ${pills ? `<div class="doc-foot-inner doc-foot-archive"><div class="doc-pills">${pills}</div></div>` : ""}
</footer>
</body></html>`;
}

function section(label, innerHtml) {
  return `<section><div class="sec-label">${esc(label)}</div>${innerHtml}</section>`;
}

function archivePills(ids) {
  return ids
    .map((id) => `<a class="doc-pill" href="/newsletter/${esc(id)}">${esc(id)}</a>`)
    .join("");
}

// Stored editions/digests are JSON: a malformed section field must degrade to
// "no data" (section omitted) rather than throw a 500 on a public page. Valid
// input is always an array; the existing per-item filters still apply.
const asArray = (value) => (Array.isArray(value) ? value : []);

// Shared body primitives — story 9.3 reuses every one of these for the weekly
// digest body. They take arrays of sanitized objects, never pre-rendered HTML,
// and do not special-case either edition.
function storyRows(items) {
  return `<ol class="doc-stories">${items
    .map(
      (s, i) => `<li class="doc-story">
  <span class="doc-rank">${i + 1}</span>
  <div>
    <h2 class="doc-headline">${link(s.url, s.title || "")}</h2>
    ${s.body ? `<p class="doc-summary">${esc(s.body)}</p>` : ""}
    ${
      s.category || s.impact === "high"
        ? `<div class="doc-chips">
      ${s.category ? `<span class="doc-chip">${esc(s.category)}</span>` : ""}
      ${s.impact === "high" ? '<span class="doc-chip hot">high impact</span>' : ""}
    </div>`
        : ""
    }
  </div>
</li>`,
    )
    .join("\n")}</ol>`;
}

function modelRows(items) {
  return items
    .map(
      (m) => `<div class="doc-model">
  <strong class="doc-model-name">${link(m.url, m.name || "")}</strong>${m.org ? ` <span class="doc-model-org">· ${esc(m.org)}</span>` : ""}
  ${m.summary ? `<p>${esc(m.summary)}</p>` : ""}
</div>`,
    )
    .join("\n");
}

function paperHtml(paper) {
  return `<div class="doc-paper">
  <h3>${link(paper.url, paper.title || "")}</h3>
  ${paper.authors ? `<div class="authors">${esc(paper.authors)}</div>` : ""}
  ${paper.insight ? `<div class="insight">${esc(paper.insight)}</div>` : ""}
</div>`;
}

// An item is either a plain string (community buzz) or `{ text, url }` (quick
// links). Strings are escaped with esc(); links go through link(), which escapes
// both the href attribute and the visible text.
function bullets(items) {
  return `<ul class="doc-bullets">${items
    .map((item) => {
      if (item && typeof item === "object") {
        return `<li>${item.url ? link(item.url, item.text || "") : esc(item.text || "")}</li>`;
      }
      return `<li>${esc(item)}</li>`;
    })
    .join("\n")}</ul>`;
}

/**
 * Render the full daily-edition page (a web document).
 * @param {object} edition           – saved edition (sanitizeDailyEdition output)
 * @param {object} [opts]
 * @param {object} [opts.brand]      – domain pack chrome ({ name, credit })
 * @param {string[]} [opts.editions] – all edition ids (desc) for archive pills
 * @param {number} [opts.sourceCount] – active pack source count for the footer;
 *   omitted → count-free "generated" (never hardcode the count here)
 * @returns {string}
 */
export function renderDailyEditionHtml(
  edition,
  { brand = {}, editions = [], sourceCount } = {},
) {
  if (!edition) return renderNotFoundHtml({ editionId: "", brand });

  const editionId = edition.editionId || "";
  const dateLine = edition.dateOf ? esc(edition.dateOf) : esc(editionId);
  const others = Array.isArray(editions)
    ? editions.filter((id) => id !== editionId)
    : [];

  const stories = asArray(edition.topStories).filter(
    (t) => t && typeof t === "object",
  );

  const models = asArray(edition.modelReleases).filter(
    (m) => m && typeof m === "object",
  );

  const paper =
    edition.paperPick && edition.paperPick.title ? edition.paperPick : null;

  const quickLinks = asArray(edition.quickLinks).filter(
    (l) => l && typeof l === "object",
  );

  const buzz = asArray(edition.communityBuzz).filter((b) => b);

  const pills = others.length ? archivePills(others) : "";

  const generatedLine = edition.generatedAt
    ? `Generated ${esc(edition.generatedAt)}`
    : Number.isFinite(sourceCount)
      ? `generated from ${sourceCount} sources`
      : "generated";

  const eyebrow = `${edition.dateOf || editionId}${
    editionId ? ` · edition ${editionId}` : ""
  }`;

  const body = `
  <p class="doc-lede">${esc(edition.tldr || "")}</p>
  ${stories.length ? section("Top stories", storyRows(stories)) : ""}
  ${models.length ? section("Model releases", modelRows(models)) : ""}
  ${paper ? section("Paper pick", paperHtml(paper)) : ""}
  ${quickLinks.length ? section("Quick links", bullets(quickLinks)) : ""}
  ${buzz.length ? section("Community buzz", bullets(buzz)) : ""}`;

  return pageShell({
    title: `Daily — ${dateLine || "Daily edition"}`,
    brand,
    eyebrow,
    body,
    footnote: `<span>${generatedLine}</span>`,
    pills,
  });
}

/**
 * Weekly digest as its own page (GET /digest). The rail card on the dashboard
 * is a summary — the full digest is a document, and a document belongs on a
 * page rather than expanded inside a 420px column. Reuses the daily edition's
 * shell so the two read as one publication.
 */
export function renderWeeklyDigestHtml(digest, { brand = {} } = {}) {
  if (!digest || !digest.weekId) {
    const body = `<div class="doc-msg">
  <h1>No digest generated yet</h1>
  <p>The weekly digest is generated once per ISO week from the dashboard.</p>
  <div class="doc-back"><a href="/">\u2190 Back to the dashboard</a></div>
</div>`;
    return pageShell({
      title: "Weekly \u2014 no digest yet",
      brand,
      cadence: "Weekly",
      eyebrow: "Weekly digest",
      body,
    });
  }

  const weekLine = digest.weekOf ? esc(digest.weekOf) : esc(digest.weekId);

  // Defensive: a malformed weekId still renders (falls back to the raw id)
  // rather than throwing or printing NaN.
  const weekNumber =
    String(digest.weekId).match(/^\d{4}-W(\d+)$/)?.[1] || String(digest.weekId);
  const eyebrow = `week ${weekNumber} \u00b7 sun 18:00`;

  const highlights = asArray(digest.highlights).filter(
    (h) => h && typeof h === "object",
  );

  const models = asArray(digest.modelUpdates).filter(
    (m) => m && typeof m === "object",
  );

  const papers = asArray(digest.paperPicks).filter(
    (p) => p && typeof p === "object" && p.title,
  );

  const buzz = asArray(digest.communityBuzz).filter((b) => b);

  const generatedLine = digest.generatedAt
    ? `Generated ${esc(digest.generatedAt)}`
    : "generated";

  const body = `
  <p class="doc-lede">${esc(digest.tldr || "")}</p>
  ${highlights.length ? section("Key highlights", storyRows(highlights)) : ""}
  ${models.length ? section("Model & tool updates", modelRows(models)) : ""}
  ${papers.length ? section("Paper picks", papers.map(paperHtml).join("")) : ""}
  ${buzz.length ? section("Community buzz", bullets(buzz)) : ""}
  ${digest.lookAhead ? section("Look ahead", `<p class="doc-lookahead">${esc(digest.lookAhead)}</p>`) : ""}`;

  return pageShell({
    title: `Weekly \u2014 ${weekLine}`,
    brand,
    cadence: "Weekly",
    eyebrow,
    body,
    footnote: `<span>${generatedLine}</span>`,
  });
}

/** Shown at /newsletter before the first edition exists. */
export function renderEmptyArchiveHtml({ brand = {} } = {}) {
  const body = `<div class="doc-msg">
  <h1>No editions generated yet</h1>
  <p>Editions are generated automatically once per day, or locally with <code>npm run edition:save</code>.</p>
  <div class="doc-back"><a href="/">← Back to the dashboard</a></div>
</div>`;
  return pageShell({
    title: "Daily — no editions yet",
    brand,
    eyebrow: "Daily edition",
    body,
  });
}

/** Shown for an unknown /newsletter/:editionId. */
export function renderNotFoundHtml({ editionId = "", brand = {} } = {}) {
  const body = `<div class="doc-msg">
  <h1>Edition not found</h1>
  <p>${editionId ? `No saved edition for ${esc(editionId)}.` : "No saved edition."}</p>
  <div class="doc-back"><a href="/newsletter">← Latest edition</a></div>
</div>`;
  return pageShell({
    title: "Daily — not found",
    brand,
    eyebrow: "Daily edition",
    body,
  });
}
