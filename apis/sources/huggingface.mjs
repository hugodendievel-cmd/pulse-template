// apis/sources/huggingface.mjs — Hugging Face trending models (no key needed)
import { safeFetch } from "../utils/fetch.mjs";

// config unused — Hugging Face has no domain filter; uniform signature for the pack orchestrator
export async function briefing(config = {}, opts = {}) {
  const [models, datasets] = await Promise.allSettled([
    safeFetch(
      "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=20",
      { timeout: 15000 },
    ),
    safeFetch(
      "https://huggingface.co/api/datasets?sort=trendingScore&direction=-1&limit=10",
      { timeout: 15000 },
    ),
  ]);

  const trendingModels =
    models.status === "fulfilled"
      ? models.value.map((m) => ({
          id: m.id || m.modelId,
          author: m.author,
          downloads: m.downloads,
          likes: m.likes,
          tags: (m.tags || []).slice(0, 5),
          pipeline: m.pipeline_tag || "unknown",
          lastModified: m.lastModified,
          url: `https://huggingface.co/${m.id || m.modelId}`,
        }))
      : [];

  const trendingDatasets =
    datasets.status === "fulfilled"
      ? datasets.value.map((d) => ({
          id: d.id,
          author: d.author,
          downloads: d.downloads,
          likes: d.likes,
          tags: (d.tags || []).slice(0, 5),
          url: `https://huggingface.co/datasets/${d.id}`,
        }))
      : [];

  return {
    source: "Hugging Face",
    category: "models",
    models: { count: trendingModels.length, items: trendingModels },
    datasets: { count: trendingDatasets.length, items: trendingDatasets },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  briefing().then((d) => console.log(JSON.stringify(d, null, 2)));
}
