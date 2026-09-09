// apis/utils/env.mjs — .env loader (no dotenv dependency)
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..", "..");

// Look for .env in cwd first (npx case), then package root (dev case)
const cwdEnv = resolve(process.cwd(), ".env");
const pkgEnv = resolve(pkgRoot, ".env");
const envPath = existsSync(cwdEnv) ? cwdEnv : pkgEnv;

/** Strip an unquoted inline comment: `PORT=3200   # comment` → `3200`.
 *  A `#` inside quotes is part of the value and is preserved. */
function stripInlineComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#") {
      return raw.slice(0, i).trimEnd();
    }
  }
  return raw;
}

try {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = stripInlineComment(trimmed.slice(eqIdx + 1).trim())
      .replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env file is optional
}

export function env(key, fallback = "") {
  return process.env[key] || fallback;
}
