import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(
  resolve(__dirname, "../dashboard/public/style.css"),
  "utf-8",
);

// Count definitions (property declarations, not usages)
function countDefinitions(varName) {
  // Matches lines like: --text-dim: #value;
  const re = new RegExp(`${varName}\\s*:`, "g");
  return (css.match(re) || []).length;
}

// Check that a variable is defined inside :root
function definedInRoot(varName) {
  // Extract the :root block and check for the variable inside it
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/);
  if (!rootMatch) return false;
  return rootMatch[1].includes(`${varName}:`);
}

describe("digest panel CSS variables", () => {
  it("--text-dim has at least 3 definitions (one per theme)", () => {
    expect(countDefinitions("--text-dim")).toBeGreaterThanOrEqual(3);
  });

  it("--card has at least 3 definitions (one per theme)", () => {
    expect(countDefinitions("--card")).toBeGreaterThanOrEqual(3);
  });

  it("--text-dim is defined in :root (dark theme fallback)", () => {
    expect(definedInRoot("--text-dim")).toBe(true);
  });

  it("--card is defined in :root (dark theme fallback)", () => {
    expect(definedInRoot("--card")).toBe(true);
  });
});

// ── Semantic token layer (Story 2.1) ──────────────────────────────────────
// The 19 semantic tokens are the source of truth in each theme block; legacy
// tokens are redefined as aliases of them so component selectors keep working.
const SEMANTIC_TOKENS = [
  "--paper",
  "--surface",
  "--surface-2",
  "--inset",
  "--strip",
  "--ink",
  "--ink-2",
  "--ink-3",
  "--ink-4",
  "--hairline",
  "--green",
  "--green-ink",
  "--green-tint",
  "--green-tint-2",
  "--green-soft",
  "--amber-ink",
  "--amber-tint",
  "--amber-dot",
  "--idle",
];

const LEGACY_ALIASES = [
  "--bg",
  "--bg2",
  "--bg3",
  "--bg4",
  "--text",
  "--text2",
  "--muted",
  "--dim",
  "--accent",
  "--accent2",
  "--border",
  "--border2",
];

// Extract a token block (selector `{ … }`, values contain no braces).
function extractBlock(selectorPattern) {
  const match = css.match(new RegExp(`${selectorPattern}\\s*\\{([^}]+)\\}`));
  return match ? match[1] : "";
}

// True when the block declares `name:` (a definition, not a `var(name)` usage).
function declares(block, name) {
  return new RegExp(`${name}\\s*:`).test(block);
}

// The declared value of `name` inside the block, or null when absent.
function declarationValue(block, name) {
  const match = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

const THEME_BLOCKS = {
  ":root": extractBlock(":root"),
  "html.light": extractBlock("html\\.light"),
  "html.terminal": extractBlock("html\\.terminal"),
};

describe("semantic token layer with legacy aliases", () => {
  it("declares all 19 semantic tokens in every theme block", () => {
    for (const [selector, block] of Object.entries(THEME_BLOCKS)) {
      for (const token of SEMANTIC_TOKENS) {
        expect(declares(block, token), `${selector} ${token}`).toBe(true);
      }
    }
  });

  it("declares every semantic token at least 3 times (once per theme)", () => {
    for (const token of SEMANTIC_TOKENS) {
      expect(countDefinitions(token), token).toBeGreaterThanOrEqual(3);
    }
  });

  it("redefines every legacy token as an alias containing var( in every theme block", () => {
    for (const [selector, block] of Object.entries(THEME_BLOCKS)) {
      for (const token of LEGACY_ALIASES) {
        const value = declarationValue(block, token);
        expect(value, `${selector} ${token}`).not.toBeNull();
        expect(value, `${selector} ${token}`).toContain("var(");
      }
    }
  });

  it("maps every legacy alias to its expected semantic token", () => {
    const expected = {
      "--bg": "--paper",
      "--bg2": "--surface",
      "--bg3": "--surface-2",
      "--bg4": "--inset",
      "--text": "--ink",
      "--text2": "--ink-2",
      "--muted": "--ink-3",
      "--dim": "--ink-4",
      "--accent": "--green-ink",
      "--accent2": "--green",
      "--border": "--hairline",
    };
    for (const [selector, block] of Object.entries(THEME_BLOCKS)) {
      for (const [legacy, semantic] of Object.entries(expected)) {
        expect(declarationValue(block, legacy), `${selector} ${legacy}`).toBe(
          `var(${semantic})`,
        );
      }
    }
  });

  it("keeps --text-dim and --card explicit (not var()) in every theme block", () => {
    for (const [selector, block] of Object.entries(THEME_BLOCKS)) {
      for (const token of ["--text-dim", "--card"]) {
        const value = declarationValue(block, token);
        expect(value, `${selector} ${token}`).not.toBeNull();
        expect(value, `${selector} ${token}`).not.toContain("var(");
      }
    }
  });
});
