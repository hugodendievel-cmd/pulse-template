// apis/save-briefing.mjs — Run sweep and save timestamped + latest.json
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runSweep } from "./briefing.mjs";
import "./utils/env.mjs";
import { pulsePath } from "../lib/data-dir.mjs";

const runsDir = pulsePath("runs");
mkdirSync(runsDir, { recursive: true });

const data = await runSweep();
const ts = new Date().toISOString().replace(/[:.]/g, "-");

writeFileSync(resolve(runsDir, `${ts}.json`), JSON.stringify(data, null, 2));
writeFileSync(resolve(runsDir, "latest.json"), JSON.stringify(data, null, 2));

console.log(`[Pulse] Saved to runs/${ts}.json and runs/latest.json`);
