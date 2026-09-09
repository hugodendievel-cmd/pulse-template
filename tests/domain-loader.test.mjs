// tests/domain-loader.test.mjs — domains/index.mjs loader + example pack shape.
// No network, no DOM.
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listDomains, loadDomain, validateDomain } from "../domains/index.mjs";
import example from "../domains/example.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

afterEach(() => {
  delete process.env.PULSE_DOMAIN;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("domains/index.mjs loader", () => {
  it("loadDomain() returns the example pack by default", () => {
    expect(loadDomain().id).toBe("example");
  });

  it("loadDomain('example') returns the same object (cache)", () => {
    expect(loadDomain("example")).toBe(loadDomain());
  });

  it("listDomains() includes example", () => {
    expect(listDomains()).toContain("example");
  });

  it("loadDomain('nope') throws Unknown domain pack", () => {
    expect(() => loadDomain("nope")).toThrow("Unknown domain pack: nope");
  });

  it("validateDomain({}) throws mentioning the first missing key", () => {
    expect(() => validateDomain({})).toThrow(/Invalid domain pack.*"id"/);
  });

  it("PULSE_DOMAIN env selects the pack", async () => {
    process.env.PULSE_DOMAIN = "example";
    vi.resetModules();
    const mod = await import("../domains/index.mjs");
    expect(mod.loadDomain().id).toBe("example");
  });
});

describe("domains/example.mjs pack shape", () => {
  it("declares its sources with config", () => {
    expect(example.sources.length).toBeGreaterThanOrEqual(3);
    for (const s of example.sources) {
      expect(s.name).toBeTruthy();
      expect(s.module).toBeTruthy();
      expect(s.config).toBeDefined();
    }
  });

  it("every source module resolves to an existing file", () => {
    for (const s of example.sources) {
      expect(
        existsSync(resolve(root, "apis/sources", `${s.module}.mjs`)),
        `apis/sources/${s.module}.mjs`,
      ).toBe(true);
    }
  });

  it("pack is self-describing: prompts, freshSources, panels, stats, nav, colors", () => {
    // The engine has no default prompts — packs own the analyst voice. The
    // JSON schema inside these prompts is renderer-dependent and must stay.
    for (const field of [
      '"summary"',
      '"topStories"',
      '"trends"',
      '"modelRadar"',
      '"signals"',
    ]) {
      expect(example.prompts.analysis).toContain(field);
    }
    for (const field of [
      '"tldr"',
      '"highlights"',
      '"modelUpdates"',
      '"communityBuzz"',
      '"lookAhead"',
    ]) {
      expect(example.prompts.digest).toContain(field);
    }
    expect(example.freshSources.length).toBeGreaterThanOrEqual(1);
    expect(example.panels.length).toBeGreaterThanOrEqual(5);
    expect(example.stats.length).toBeGreaterThanOrEqual(1);
    expect(example.nav[0].filter).toBe("all");
  });

  it("name coherence: panel/color/freshSources names exist in sources[].name", () => {
    const names = new Set(example.sources.map((s) => s.name));
    for (const p of example.panels) {
      for (const n of p.sources ?? []) {
        expect(names, `panel ${p.id} → ${n}`).toContain(n);
      }
    }
    for (const n of Object.keys(example.colors)) {
      expect(names, `colors key ${n}`).toContain(n);
    }
    for (const n of example.freshSources) {
      expect(names, `freshSources ${n}`).toContain(n);
    }
  });
});
