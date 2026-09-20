// lib/delta/memory.mjs — Hot memory (last 3 runs) + persistence
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pulsePath } from "../data-dir.mjs";

// Runtime data lives under <PULSE_DATA_DIR|cwd>/.pulse (persistent volume
// in production); paths resolve lazily so env/cwd overrides apply.
const MEMORY_DIR = () => pulsePath("memory");
const HOT_FILE = () => pulsePath("memory", "hot.json");
const MAX_HOT = 3;

// Lazy in-process buffer — populated on first write or first read attempt
let hot = null; // null = not yet loaded

function loadHot() {
  if (hot !== null) return;
  try {
    hot = JSON.parse(readFileSync(HOT_FILE(), "utf-8"));
  } catch {
    hot = [];
  }
}

export function ensureMemoryDir() {
  mkdirSync(MEMORY_DIR(), { recursive: true });
}

export function pushSweep(sweep) {
  loadHot();
  hot.push(sweep);
  if (hot.length > MAX_HOT) hot.shift();
  ensureMemoryDir();
  writeFileSync(HOT_FILE(), JSON.stringify(hot, null, 2));
}

export function getPrevious() {
  loadHot();
  return hot.length >= 2 ? hot[hot.length - 2] : undefined;
}

export function getLatest() {
  loadHot();
  return hot.length ? hot[hot.length - 1] : undefined;
}
