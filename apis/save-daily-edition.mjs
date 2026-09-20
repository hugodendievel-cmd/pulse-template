// apis/save-daily-edition.mjs — Operator CLI: generate today's daily edition
// locally (budget-gated, same pipeline as the server's internal scheduler).
//
//   npm run edition:save           # once per Brussels day (skips if exists)
//   npm run edition:save -- --force  # regenerate today's edition (overwrites)
import "./utils/env.mjs";
import { loadDomain } from "../domains/index.mjs";
import { createLLMProvider } from "../lib/llm/index.mjs";
import { SKIP_REASONS, generateDailyEditionPipeline } from "../lib/newsletter/pipeline.mjs";

const force = process.argv.includes("--force");
const cap = Number.parseInt(process.env.MAX_LLM_CALLS_PER_DAY || "100", 10);

const llm = await createLLMProvider();
if (!llm) {
  console.error(
    "[Pulse] Daily edition aborted — LLM not configured. Set LLM_PROVIDER and LLM_API_KEY in .env",
  );
  process.exit(1);
}

const domain = loadDomain();
const outcome = await generateDailyEditionPipeline(llm, {
  prompt: domain.prompts.daily,
  freshSources: domain.freshSources,
  cap,
  force,
});

if (outcome.skipped === SKIP_REASONS.alreadyGenerated) {
  console.log(
    `[Pulse] Daily edition already generated for ${outcome.editionId} — use --force to regenerate`,
  );
  process.exit(0);
}
if (outcome.skipped === SKIP_REASONS.budget) {
  console.error(
    "[Pulse] Daily edition aborted — daily LLM budget exhausted. Budget resets at midnight Europe/Brussels.",
  );
  process.exit(1);
}
if (outcome.error) {
  console.error("[Pulse] Daily edition generation failed — see logs");
  process.exit(1);
}

console.log(
  `[Pulse] Daily edition saved to newsletters/${outcome.edition.editionId}.json (latest.json updated)`,
);
