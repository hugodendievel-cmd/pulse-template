// tests/sse-states.test.mjs — Story 6.4: SSE connection-state UI contract
// (connected / reconnecting / offline). Source-scan only, no DOM/browser
// harness exists (architecture §7), following skeleton-loading.test.mjs.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const appjs = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");
const css = readFileSync(resolve(root, "dashboard/public/style.css"), "utf-8");

describe("SSE client state (Story 6.4)", () => {
  it("seeds state.sse connected and state.lastEventAge at 0", () => {
    expect(appjs).toMatch(/sse:\s*"connected"/);
    expect(appjs).toMatch(/lastEventAge:\s*0/);
  });

  it("declares the reconnect grace period constant", () => {
    expect(appjs).toMatch(/RECONNECT_OFFLINE_MS\s*=\s*10000/);
  });

  it("drives the pill through the three states via renderLivePill", () => {
    expect(appjs).toMatch(/function renderLivePill\(\)/);
    expect(appjs).toContain("renderLivePill()");
    expect(appjs).toContain('"reconnecting"');
    expect(appjs).toContain('"offline"');
    expect(appjs).toContain("offline · showing cached");
    expect(appjs).toContain("reconnecting…");
  });

  it("renders the connected pill as `live \u00b7 {k}/{n}`", () => {
    const fn =
      appjs.match(/function renderLivePill\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).not.toBe("");
    expect(fn).toContain('"live"');
    expect(fn).toMatch(/\$\{h\.ok\}\/\$\{h\.total\}/);
    // The per-second event age is gone from the pill.
    expect(fn).not.toMatch(/lastEventAge/);
  });

  it("clears the grace timer on a proving message and arms it once per drop", () => {
    const msg = appjs.match(/evtSource\.onmessage[\s\S]*?\n\};/)?.[0] ?? "";
    expect(msg).not.toBe("");
    expect(msg).toContain("clearReconnectTimer()");
    expect(msg).toMatch(/state\.sse = "connected"/);
    // EventSource fires onerror on every failed retry; re-arming each time
    // would prevent the offline downgrade from ever firing.
    const err =
      appjs.match(/evtSource\.onerror\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n\};/)?.[0] ??
      "";
    expect(err).not.toBe("");
    expect(err).toMatch(/if \(!reconnectOfflineTimer\)/);
  });

  it("derives the count from the shared sourceHealthSummary", () => {
    const fn =
      appjs.match(/function renderLivePill\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).not.toBe("");
    expect(fn).toMatch(/sourceHealthSummary\(/);
    // numeric {k}/{total} only — never item text.
    expect(fn).toContain("sourceCountText");
  });

  it("sets data-state on the dot and ticks the age at 1Hz only while connected", () => {
    expect(appjs).toMatch(/dataset\.state\s*=\s*state\.sse/);
    expect(appjs).toMatch(
      /if \(state\.sse === "connected"\) state\.lastEventAge \+= 1000/,
    );
  });

  it("starts the offline timer on onerror without clearing data", () => {
    const fn = appjs.match(/evtSource\.onerror\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n\};/)?.[0] ?? "";
    expect(fn).not.toBe("");
    expect(fn).toMatch(/state\.sse = "reconnecting"/);
    expect(fn).toContain("RECONNECT_OFFLINE_MS");
    expect(fn).toMatch(/state\.sse = "offline"/);
    expect(fn).not.toContain("data = null");
    expect(fn).not.toContain("DOMAIN = null");
  });
});

describe("live pill CSS contract (Story 6.4)", () => {
  it("binds the pill and dot to semantic tokens", () => {
    expect(css).toMatch(
      /\.status-badge\s*\{[^}]*background:\s*var\(--green-tint\)[^}]*color:\s*var\(--green-ink\)/s,
    );
    expect(css).toMatch(
      /\.status-dot\s*\{[^}]*background:\s*var\(--green\)/s,
    );
  });

  it("pulses the connected dot and suppresses it under reduced motion", () => {
    expect(css).toMatch(
      /\.status-dot\[data-state="connected"\]\s*\{[^}]*animation:\s*pulse/s,
    );
    expect(css).toContain("@keyframes pulse");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.status-dot\[data-state="connected"\]\s*\{[^}]*animation:\s*none/s,
    );
  });

  it("binds reconnecting to --amber-dot and offline to --ink-4", () => {
    expect(css).toMatch(
      /\.status-dot\[data-state="reconnecting"\]\s*\{[^}]*background:\s*var\(--amber-dot\)/s,
    );
    expect(css).toMatch(
      /\.status-dot\[data-state="offline"\]\s*\{[^}]*background:\s*var\(--ink-4\)/s,
    );
  });

  it("hides the blank age and its separator so the pill keeps a single dot", () => {
    expect(css).toMatch(/#sweepTime:empty/);
    expect(css).toMatch(/\.status-sep:has\(\+ #sweepTime:empty\)/);
  });
});
