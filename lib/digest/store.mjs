// lib/digest/store.mjs — Weekly digest persistence
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sanitizeDigest } from "../../apis/utils/sanitize.mjs";
import { pulsePath } from "../data-dir.mjs";
import { weekIdBrussels } from "./week-id.mjs";

// Lazy: honours PULSE_DATA_DIR (persistent volume in production) and test mocks.
const digestDir = () => pulsePath("digests");

/**
 * Save a weekly digest with a week identifier.
 */
export function saveDigest(digest) {
  const weekId = weekIdBrussels();
  const dir = digestDir();
  const filePath = resolve(dir, `${weekId}.json`);
  const clean = sanitizeDigest(digest);
  const payload = {
    ...clean,
    generatedAt: new Date().toISOString(),
    weekId,
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2));
  writeFileSync(
    resolve(dir, "latest.json"),
    JSON.stringify(payload, null, 2),
  );
  return payload;
}

/**
 * Load the latest saved digest.
 */
export function loadLatestDigest() {
  const latest = resolve(digestDir(), "latest.json");
  if (!existsSync(latest)) return null;
  try {
    return JSON.parse(readFileSync(latest, "utf-8"));
  } catch {
    return null;
  }
}
