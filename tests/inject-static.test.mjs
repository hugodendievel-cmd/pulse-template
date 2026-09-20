// tests/inject-static.test.mjs — Story 7.1: repair `dashboard/inject.mjs` so
// the static snapshot keeps working against the domain-driven client.
//
// Three layers, no server and no browser:
//  1. source guards on inject.mjs / app.js (fast, no process spawn);
//  2. render-core export-map completeness (the inlined classic script must
//     expose every export by name);
//  3. an end-to-end generation into a temp dir, asserting a self-contained
//     file whose fonts are copied and whose bootstrap global runs before
//     app.js — plus a vm execution proving app.js's static module scope opens
//     no EventSource and makes no server request.
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import example from "../domains/example.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const injectSource = readFileSync(
  resolve(root, "dashboard/inject.mjs"),
  "utf-8",
);
const appSource = readFileSync(
  resolve(root, "dashboard/public/app.js"),
  "utf-8",
);
const renderCoreSource = readFileSync(
  resolve(root, "dashboard/public/render-core.mjs"),
  "utf-8",
);

// Every `export function name` / `export const name` in the pure data layer.
const renderCoreExports = [
  ...renderCoreSource.matchAll(
    /^export\s+(?:function|const)\s+([A-Za-z_$][\w$]*)/gm,
  ),
].map((m) => m[1]);

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Run inject.mjs against a fixture snapshot in a throwaway cwd. */
function generateStatic({ sources = [] } = {}) {
  const tmp = mkdtempSync(resolve(tmpdir(), "pulse-inject-"));
  tempDirs.push(tmp);
  const runsDir = resolve(tmp, ".pulse", "runs");
  mkdirSync(runsDir, { recursive: true });
  const sweep = {
    timestamp: new Date().toISOString(),
    sweepDurationMs: 1,
    sourcesOk: sources.length,
    sourcesTotal: sources.length,
    sources,
  };
  writeFileSync(resolve(runsDir, "latest.json"), JSON.stringify(sweep));
  execFileSync(process.execPath, [resolve(root, "dashboard/inject.mjs")], {
    cwd: tmp,
    env: { ...process.env, PULSE_DATA_DIR: tmp, PULSE_DOMAIN: "example" },
    stdio: "pipe",
  });
  return {
    tmp,
    html: readFileSync(resolve(tmp, "index-static.html"), "utf-8"),
  };
}

describe("inject.mjs source guards", () => {
  it("emits the bootstrap global with static:true", () => {
    expect(injectSource).toContain("__PULSE_BOOTSTRAP__");
    expect(injectSource).toContain('"static":true');
  });

  it("reads the persisted run through pulsePath (save-briefing's location)", () => {
    expect(injectSource).toContain('pulsePath("runs"');
  });

  it("does not call the removed render()/hideLoading() globals", () => {
    expect(injectSource).not.toMatch(/hideLoading\s*\(/);
    expect(injectSource).not.toMatch(/\brender\s*\(/);
  });

  it("does not read the legacy <cwd>/runs/latest.json path", () => {
    expect(injectSource).not.toMatch(
      /readFileSync\(resolve\(process\.cwd\(\),\s*"runs"/,
    );
  });

  it("names the producing command in the missing-run error", () => {
    expect(injectSource).toContain("npm run brief:save");
  });
});

describe("app.js static bootstrap guards", () => {
  it("reads window.__PULSE_BOOTSTRAP__ at module scope", () => {
    expect(appSource).toContain("__PULSE_BOOTSTRAP__");
    expect(appSource).toMatch(/IS_STATIC/);
  });

  it("guards the server paths behind if (!IS_STATIC)", () => {
    expect(appSource).toMatch(/if \(!IS_STATIC\)/);
    const idx = appSource.indexOf("new EventSource");
    expect(idx).toBeGreaterThan(-1);
    // The EventSource construction must sit immediately inside its own
    // !IS_STATIC block — not merely somewhere after the unrelated /api/health
    // guard earlier in the file.
    const before = appSource.slice(Math.max(0, idx - 120), idx);
    expect(before).toMatch(/if \(!IS_STATIC\)\s*\{/);
  });

  it("flips the live pill to offline when static", () => {
    expect(appSource).toMatch(
      /IS_STATIC[\s\S]{0,120}state\.sse\s*=\s*"offline"/,
    );
  });
});

describe("render-core export map completeness", () => {
  it("reads a full set of exports from render-core.mjs", () => {
    expect(renderCoreExports.length).toBeGreaterThanOrEqual(20);
  });

  it("lists every export in inject.mjs's window.RenderCore literal", () => {
    const literal = injectSource.match(
      /window\.RenderCore\s*=\s*\{([\s\S]*?)\}/,
    );
    expect(literal).not.toBeNull();
    for (const name of renderCoreExports) {
      expect(literal[1]).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

describe("end-to-end static generation", () => {
  it("writes a self-contained index-static.html with fonts", () => {
    const { tmp, html } = generateStatic();

    expect(html).toContain("window.__PULSE_BOOTSTRAP__");
    expect(html).toContain('"static":true');
    expect(html).toContain('"views"');
    expect(html).toContain(example.name);

    // Branding fully substituted, no dead render hooks left behind. The one
    // legitimate `__PULSE_` name is the bootstrap global itself.
    expect(html.split("__PULSE_BOOTSTRAP__").join("")).not.toMatch(
      /__PULSE_[A-Z_]+__/,
    );
    expect(html).not.toContain("hideLoading(");
    expect(html).not.toMatch(/\brender\s*\(/);
    expect(html).not.toContain("fonts.googleapis");

    // Render core inlined as a classic script.
    expect(html).toContain("window.RenderCore = {");

    // Fonts copied beside the output and the relative URLs kept valid.
    const fontDir = resolve(tmp, "fonts");
    expect(existsSync(fontDir)).toBe(true);
    expect(readdirSync(fontDir).some((f) => f.endsWith(".woff2"))).toBe(true);
    expect(html).toContain('url("fonts/inter.woff2")');
  });

  it("embeds no pack secrets and <-escapes run items out of the script tag", () => {
    const evilTitle = "Evil </script><script>alert(1)</script>";
    const { html } = generateStatic({
      sources: [
        {
          source: "TechCrunch",
          status: "ok",
          data: {
            category: "news",
            items: [
              {
                title: evilTitle,
                url: "https://example.test/a",
                published: new Date().toISOString(),
              },
            ],
          },
        },
      ],
    });

    // The domain chrome is a fixed 7-key projection — spreading the pack would
    // leak `sources`/`prompts`/`freshSources`. The prompt text proves the pack
    // itself never reaches the snapshot.
    expect(html).not.toContain("freshSources");
    expect(html).not.toContain('"prompts"');
    expect(html).not.toContain(example.prompts.analysis.slice(0, 40));

    // A malicious item title must not close the bootstrap <script>: JSON `<`
    // escaping turns every `<` into \u003c, so the only raw </script> tags are
    // the authored ones plus the injected bootstrap. Derive the authored count
    // from the template so adding a script (e.g. the pre-paint theme init)
    // does not force a magic-number bump.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(
      "\\u003c/script>\\u003cscript>alert(1)\\u003c/script>",
    );
    const template = readFileSync(
      resolve(root, "dashboard/public/index.html"),
      "utf-8",
    );
    const authored = (template.match(/<\/script>/g) || []).length;
    expect((html.match(/<\/script>/g) || []).length).toBe(authored + 1);
  });

  it("places the bootstrap before app.js and opens no server transport", () => {
    const { html } = generateStatic();
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (m) => m[1],
    );
    const bootstrapIdx = scripts.findIndex((s) =>
      s.includes("__PULSE_BOOTSTRAP__"),
    );
    const appIdx = scripts.findIndex((s) =>
      s.includes("domain-agnostic dashboard client"),
    );
    expect(bootstrapIdx).toBeGreaterThan(-1);
    expect(appIdx).toBeGreaterThan(bootstrapIdx);

    const calls = { fetch: [], eventSource: 0, timeouts: 0 };
    const win = {};
    const sandbox = {
      window: win,
      document: { addEventListener() {}, querySelectorAll: () => [] },
      localStorage: { getItem: () => null, setItem() {} },
      sessionStorage: { getItem: () => null, setItem() {} },
      fetch: (url) => {
        calls.fetch.push(url);
        return {
          then() {
            return this;
          },
          catch() {
            return this;
          },
        };
      },
      EventSource: function EventSource() {
        calls.eventSource += 1;
      },
      setTimeout: () => {
        calls.timeouts += 1;
        return 0;
      },
      setInterval: () => 0,
      clearTimeout() {},
      clearInterval() {},
      console,
    };
    vm.createContext(sandbox);

    // Run the generated bootstrap, then app.js's module scope only (its final
    // synchronous init() needs a real DOM — the assertions below cover the
    // module-scope guarantees the AC names).
    vm.runInContext(scripts[bootstrapIdx], sandbox);
    const moduleScope = scripts[appIdx].replace(/\ninit\(\);\s*$/, "\n");
    vm.runInContext(moduleScope, sandbox);

    expect(win.__PULSE_BOOTSTRAP__?.static).toBe(true);
    expect(calls.eventSource).toBe(0);
    expect(calls.fetch).toEqual([]);
    expect(calls.timeouts).toBe(0);
  });
});
