const TERMINAL_SOURCE_STATES = new Set(["ok", "error"]);
const TERMINAL_LLM_STATES = new Set(["ok", "error", "skipped", "disabled"]);

function cloneStep(step) {
  return { ...step };
}

function llmDetailForState(state) {
  if (state === "running") return "Synthesizing the briefing";
  if (state === "ok") return "Briefing ready";
  if (state === "skipped") return "Skipped";
  if (state === "disabled") return "Disabled";
  if (state === "error") return "Briefing unavailable";
  return "Waiting for sources";
}

function stageLabelForPhase(phase, llmState) {
  if (phase === "sources") return "SOURCE SWEEP";
  if (phase === "llm") return "LLM BRIEFING";
  if (llmState === "error") return "BRIEFING UNAVAILABLE";
  if (llmState === "skipped") return "BRIEFING SKIPPED";
  return "READY";
}

function messageForSnapshot({
  phase,
  sourcesDone,
  sourcesTotal,
  llmEnabled,
  llmState,
  lastSource,
}) {
  if (phase === "sources") {
    if (!lastSource) {
      return `Launching ${sourcesTotal} live sources`;
    }
    const outcome = lastSource.state === "ok" ? "loaded" : "failed";
    return `${lastSource.label} ${outcome} - ${sourcesDone}/${sourcesTotal} sources complete`;
  }

  if (!llmEnabled) {
    return "Source sweep complete";
  }

  if (llmState === "running") return "Generating briefing";
  if (llmState === "ok") return "briefing complete";
  if (llmState === "skipped") return "briefing skipped";
  if (llmState === "disabled") return "LLM briefing disabled";
  if (llmState === "error") return "briefing failed";
  return "Waiting for briefing";
}

export function createSweepProgressTracker({ sourceNames, llmEnabled }) {
  const sourceSteps = sourceNames.map((name) => ({
    id: `source:${name}`,
    label: name,
    kind: "source",
    state: "running",
    detail: "Querying",
  }));
  const llmStep = {
    id: "llm",
    label: "LLM briefing",
    kind: "llm",
    state: llmEnabled ? "pending" : "disabled",
    detail: llmEnabled ? "Waiting for sources" : "Disabled",
  };

  let phase = "sources";
  let lastSource = null;

  function snapshot() {
    const sourcesDone = sourceSteps.filter((step) =>
      TERMINAL_SOURCE_STATES.has(step.state),
    ).length;
    const sourcesOk = sourceSteps.filter((step) => step.state === "ok").length;
    const sourcesError = sourceSteps.filter(
      (step) => step.state === "error",
    ).length;
    const total = sourceNames.length + Number(llmEnabled);
    const llmDone =
      llmEnabled && TERMINAL_LLM_STATES.has(llmStep.state) ? 1 : 0;
    const completed = sourcesDone + llmDone;

    let effectivePhase = phase;
    if (!llmEnabled && sourcesDone === sourceNames.length) {
      effectivePhase = "ready";
    }
    if (llmEnabled && (llmStep.state === "running" || llmDone === 1)) {
      effectivePhase = llmDone === 1 ? "ready" : "llm";
    }

    return {
      phase: effectivePhase,
      stageLabel: stageLabelForPhase(effectivePhase, llmStep.state),
      message: messageForSnapshot({
        phase: effectivePhase,
        sourcesDone,
        sourcesTotal: sourceNames.length,
        llmEnabled,
        llmState: llmStep.state,
        lastSource,
      }),
      percent: total === 0 ? 100 : Math.round((completed / total) * 100),
      totals: {
        completed,
        total,
        sourcesDone,
        sourcesTotal: sourceNames.length,
        sourcesOk,
        sourcesError,
      },
      llm: {
        enabled: llmEnabled,
        state: llmStep.state,
        detail: llmStep.detail,
      },
      steps: [...sourceSteps.map(cloneStep), cloneStep(llmStep)],
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    snapshot,

    markSource(source, status) {
      const step = sourceSteps.find((entry) => entry.label === source);
      if (!step) return snapshot();
      step.state = status;
      step.detail = status === "ok" ? "Loaded" : "Unavailable";
      lastSource = { label: source, state: status };
      return snapshot();
    },

    startLlm(detail = "Synthesizing the briefing") {
      if (!llmEnabled) return snapshot();
      phase = "llm";
      llmStep.state = "running";
      llmStep.detail = detail;
      return snapshot();
    },

    finishLlm({ state = "ok", detail } = {}) {
      if (!llmEnabled) return snapshot();
      phase = "ready";
      llmStep.state = state;
      llmStep.detail = detail || llmDetailForState(state);
      return snapshot();
    },
  };
}
