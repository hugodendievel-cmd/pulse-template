// lib/data-dir.mjs — single source of truth for the runtime data root.
//
// All persisted runtime state (daily editions, weekly digests, the LLM
// budget, the hot-memory ring, saved sweeps) lives under `<base>/.pulse/`.
// The base defaults to process.cwd(); PULSE_DATA_DIR overrides it so a
// deployment can point at a persistent volume — Railway containers have an
// ephemeral filesystem, so without this every redeploy wipes the editions.
//
// Resolution is lazy (functions, not module constants) so env loading order
// and test cwd mocking behave predictably.
import { resolve } from "node:path";

export function pulseDataDir() {
  return resolve(process.env.PULSE_DATA_DIR || process.cwd(), ".pulse");
}

export function pulsePath(...parts) {
  return resolve(pulseDataDir(), ...parts);
}
