// tests/env-inline-comments.test.mjs — inline `#` comment stripping in .env
// values. Regression guard: .env.example ships inline comments; before the
// fix, a verbatim copy crashed pino ("default level:info  # pino… must be
// included in custom levels") and broke npx first-run.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEYS = [
  "AIPULSE_TEST_BARE",
  "AIPULSE_TEST_NUM",
  "AIPULSE_TEST_QUOTED_DQ",
  "AIPULSE_TEST_QUOTED_SQ",
  "AIPULSE_TEST_NO_SPACE",
];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

/** Write a fixture .env in a temp dir, chdir there, re-import the loader. */
async function loadFixture(content) {
  const dir = mkdtempSync(join(tmpdir(), "env-inline-test-"));
  writeFileSync(join(dir, ".env"), content);
  const prev = process.cwd();
  process.chdir(dir);
  try {
    vi.resetModules();
    return await import("../apis/utils/env.mjs");
  } finally {
    process.chdir(prev);
    rmSync(dir, { recursive: true, force: true });
  }
}

describe(".env inline comment stripping", () => {
  it("strips an unquoted inline comment after a value", async () => {
    const { env } = await loadFixture(
      "AIPULSE_TEST_BARE=info                 # pino log level: trace | debug | info | warn | error\n",
    );
    expect(env("AIPULSE_TEST_BARE")).toBe("info");
  });

  it("strips inline comments on numeric values", async () => {
    const { env } = await loadFixture(
      "AIPULSE_TEST_NUM=200            # max concurrent SSE connections\n",
    );
    expect(env("AIPULSE_TEST_NUM")).toBe("200");
  });

  it("preserves # inside double quotes", async () => {
    const { env } = await loadFixture(
      'AIPULSE_TEST_QUOTED_DQ="keep # this"\n',
    );
    expect(env("AIPULSE_TEST_QUOTED_DQ")).toBe("keep # this");
  });

  it("preserves # inside single quotes", async () => {
    const { env } = await loadFixture(
      "AIPULSE_TEST_QUOTED_SQ='a # b'   # trailing comment\n",
    );
    expect(env("AIPULSE_TEST_QUOTED_SQ")).toBe("a # b");
  });

  it("strips comments glued to the value without a space", async () => {
    const { env } = await loadFixture("AIPULSE_TEST_NO_SPACE=3200#comment\n");
    expect(env("AIPULSE_TEST_NO_SPACE")).toBe("3200");
  });

  it("full-line comments and blank lines are still ignored", async () => {
    const { env } = await loadFixture(
      "# a full-line comment\n\nAIPULSE_TEST_BARE=x\n",
    );
    expect(env("AIPULSE_TEST_BARE")).toBe("x");
  });

  it("real .env.example values parse cleanly end-to-end", async () => {
    // The exact LOG_LEVEL line from .env.example that used to crash pino.
    const { env } = await loadFixture(
      "LOG_LEVEL_REPO_CHECK=info                 # pino log level: trace | debug | info | warn | error\n",
    );
    expect(env("LOG_LEVEL_REPO_CHECK")).toBe("info");
  });
});
