// app.js — domain-agnostic dashboard client. Panels, nav pills, stat cards
// and source colors are all built at runtime from GET /api/domain; item
// rendering binds to normalized fields (via window.RenderCore), never to
// source names.

// ── State ──
let data = null;
let DOMAIN = null; // active domain pack chrome, fetched at boot

// ── Helpers ──
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatNum(n) {
  return window.RenderCore.formatNum(n);
}

// Inline SVGs for the runtime-built stat cards (1:1 with the original
// hardcoded dashboard markup).
const STAT_ICONS = {
  articles: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  models: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
  papers: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
  repos: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>`,
};

// ── Loading animation (live progress via SSE) ──
const loadingBar = document.getElementById("loadingBar");
const loadingStage = document.getElementById("loadingStage");
const loadingSub = document.querySelector(".loading-sub");
const loadingPercent = document.getElementById("loadingPercent");
const loadingCounts = document.getElementById("loadingCounts");
const loadingSteps = document.getElementById("loadingSteps");
let loadingDone = false;
let isFirstProgress = true;
let postLoadGrace = false;

setLoadingWidth(0);

// Pull live source count from /api/health and update the loading sub-line
// so the UI always reports the real N sources rather than a static literal.
fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    if (loadingSub && h?.sourceCount) {
      loadingSub.textContent = `Querying ${h.sourceCount} intelligence sources…`;
    }
  })
  .catch(() => {
    /* non-blocking: loading screen still shows fallback text */
  });

function setLoadingWidth(nextPct) {
  const boundedPct = Math.max(0, Math.min(100, nextPct));
  loadingBar.style.width = `${boundedPct}%`;
}

function loadingStepStateMeta(state) {
  if (state === "ok") return { icon: "✓", label: "Loaded" };
  if (state === "error") return { icon: "!", label: "Failed" };
  if (state === "running") return { icon: "●", label: "Running" };
  if (state === "skipped") return { icon: "-", label: "Skipped" };
  if (state === "disabled") return { icon: "-", label: "Disabled" };
  return { icon: "…", label: "Pending" };
}

function renderLoadingSteps(steps) {
  if (!loadingSteps) return;
  loadingSteps.innerHTML = steps
    .map((step) => {
      const meta = loadingStepStateMeta(step.state);
      const detail = step.detail || meta.label;
      return `<div class="loading-step state-${esc(step.state)}">
        <span class="loading-step-icon" aria-hidden="true">${meta.icon}</span>
        <div class="loading-step-copy">
          <div class="loading-step-label">${esc(step.label)}</div>
          <div class="loading-step-detail">${esc(detail)}</div>
        </div>
        <span class="loading-step-status">${esc(meta.label)}</span>
      </div>`;
    })
    .join("");

  // Auto-scroll to the last completed or running step
  const allStepEls = loadingSteps.querySelectorAll(".loading-step");
  let scrollTarget = null;
  for (const el of allStepEls) {
    if (
      el.classList.contains("state-ok") ||
      el.classList.contains("state-error") ||
      el.classList.contains("state-running")
    ) {
      scrollTarget = el;
    }
  }
  if (scrollTarget) {
    scrollTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function renderLoadingProgress(progress) {
  // Smooth catch-up for late joiners: if first event already shows
  // significant progress, use a longer animation so the bar doesn't jump.
  if (isFirstProgress) {
    isFirstProgress = false;
    if ((progress.percent || 0) > 15) {
      loadingBar.style.transition = "width 0.9s ease-out";
      setTimeout(() => {
        loadingBar.style.transition = "";
      }, 950);
    }
  }

  setLoadingWidth(progress.percent || 0);

  if (loadingStage) {
    loadingStage.textContent = progress.stageLabel || "SOURCE SWEEP";
  }

  loadingSub.textContent =
    progress.message || "Preparing live intelligence sweep…";

  if (loadingPercent) {
    loadingPercent.textContent = `${progress.percent || 0}%`;
  }

  if (loadingCounts) {
    const totals = progress.totals || {};
    const sourcesDone = totals.sourcesDone || 0;
    const sourcesTotal = totals.sourcesTotal || 0;
    if (progress.phase === "sources" || !progress.llm?.enabled) {
      loadingCounts.textContent = `${sourcesDone}/${sourcesTotal} sources`;
    } else {
      const llmDetail = progress.llm?.detail || "Ready";
      loadingCounts.textContent = `${sourcesDone}/${sourcesTotal} sources · ${llmDetail}`;
    }
  }

  renderLoadingSteps(progress.steps || []);
}

function completeLoading(nextData) {
  data = nextData;
  render(data);
  hideLoading();
  // Grace period: suppress one silent re-render so the dashboard doesn't
  // visibly refresh right after arriving (common with short refresh intervals).
  postLoadGrace = true;
}

// ── SSE ──
let sseConnected = false;
const evtSource = new EventSource("/events");
evtSource.onmessage = (e) => {
  if (e.data === "connected") {
    sseConnected = true;
    return;
  }
  try {
    const msg = JSON.parse(e.data);
    if (msg.type === "progress") {
      if (!loadingDone) renderLoadingProgress(msg);
    }
    if (msg.type === "update") {
      if (loadingDone) {
        data = msg.data;
        if (postLoadGrace) {
          postLoadGrace = false; // absorb first silent update
        } else {
          render(data);
        }
      } else {
        completeLoading(msg.data);
      }
    }
    if (msg.type === "digest") {
      renderDigest(msg.data);
    }
  } catch {
    /* ignore malformed messages */
  }
};
evtSource.onerror = () => {
  document.getElementById("statusDot").className = "status-dot";
  document.getElementById("statusText").textContent = "DISCONNECTED";
};

// Fallback: poll /api/data (only when SSE is not active)
async function fallbackFetch() {
  if (sseConnected) return;
  try {
    const res = await fetch("/api/data");
    if (res.ok) {
      const d = await res.json();
      if (loadingDone) {
        data = d;
        render(d);
      } else {
        completeLoading(d);
      }
    }
  } catch {
    /* ignore */
  }
}
setTimeout(fallbackFetch, 8000);
setInterval(fallbackFetch, 60000);

function hideLoading() {
  loadingDone = true;
  setLoadingWidth(100);
  if (loadingStage) loadingStage.textContent = "READY";
  loadingSub.textContent = data?.analysis
    ? "Briefing ready"
    : "Live dashboard ready";
  if (loadingPercent) loadingPercent.textContent = "100%";
  if (loadingCounts && data?.sweep) {
    loadingCounts.textContent = `${data.sweep.sourcesOk}/${data.sweep.sourcesTotal} live`;
  }
  setTimeout(
    () => document.getElementById("loading").classList.add("hidden"),
    500,
  );
}

// ── Theme Toggle (dark ⇄ light, plus terminal via Shift+T) ──
function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove("light", "terminal");
  if (theme === "light") root.classList.add("light");
  else if (theme === "terminal") root.classList.add("terminal");
  localStorage.setItem("ai-pulse-theme", theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
}
function initTheme() {
  // Default light (dendievel.me paper); fall back to dark only via
  // localStorage so returning visitors keep their choice.
  const saved = localStorage.getItem("ai-pulse-theme") || "light";
  applyTheme(saved);
  const btn = document.getElementById("themeToggle");
  if (btn) {
    btn.addEventListener("click", () => {
      const current = document.documentElement.classList.contains("light")
        ? "light"
        : document.documentElement.classList.contains("terminal")
          ? "terminal"
          : "dark";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }
}

// ── Keyboard shortcuts modal ──
function initKeyboardHelp() {
  const overlay = document.getElementById("kbdOverlay");
  const openBtn = document.getElementById("kbdHelpBtn");
  const closeBtn = document.getElementById("kbdClose");
  if (!overlay) return;
  const show = () => overlay.classList.add("active");
  const hide = () => overlay.classList.remove("active");
  if (openBtn) openBtn.addEventListener("click", show);
  if (closeBtn) closeBtn.addEventListener("click", hide);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) hide();
  });
  document.addEventListener("keydown", (e) => {
    const inInput =
      e.target &&
      (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
    if (inInput) return;
    if (e.key === "Escape" && overlay.classList.contains("active")) {
      hide();
      return;
    }
    if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      e.preventDefault();
      overlay.classList.contains("active") ? hide() : show();
    } else if (e.key === "T" && e.shiftKey) {
      e.preventDefault();
      applyTheme(
        document.documentElement.classList.contains("terminal")
          ? "dark"
          : "terminal",
      );
    } else if (e.key === "t" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      applyTheme(
        document.documentElement.classList.contains("light") ? "dark" : "light",
      );
    } else if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
      const btn = document.getElementById("collapseAllBtn");
      if (btn) btn.click();
    }
  });
}

// ── Nav Filter ──
function applyNavFilter() {
  const filter = activeFilter();
  // Expose the active filter on the .dashboard container so CSS can scope
  // tab-specific layout overrides (e.g. Community tab 2×2 grid, Code tab
  // full-width) without affecting the All view.
  const dashboard = document.querySelector(".dashboard");
  if (dashboard) dashboard.dataset.filter = filter;
  document.querySelectorAll(".dashboard .panel").forEach((panel) => {
    const section = panel.dataset.section;
    if (section === "digest") {
      panel.style.display = filter === "digest" ? "" : "none";
    } else if (filter === "all" || section === filter) {
      panel.style.display = "";
    } else {
      panel.style.display = "none";
    }
  });
}

function initNav() {
  const nav = document.getElementById("headerNav");
  if (!nav) return;
  nav.addEventListener("click", (e) => {
    const pill = e.target.closest(".nav-pill");
    if (!pill) return;
    nav
      .querySelectorAll(".nav-pill")
      .forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    applyNavFilter();
    nav.classList.remove("open");
  });
}

// ── Panel Collapse ──
function initPanelCollapse() {
  const STORAGE_KEY = "ai-pulse-collapsed";

  function getCollapsed() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveCollapsed(ids) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }

  function panelId(panel) {
    return panel.id || panel.querySelector(".panel-title")?.textContent.trim();
  }

  // Inject toggle chevron into every panel header
  document.querySelectorAll(".dashboard .panel").forEach((panel) => {
    const header = panel.querySelector(".panel-header");
    if (!header) return;

    const chevron = document.createElement("span");
    chevron.className = "panel-toggle";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▼";
    header.appendChild(chevron);

    // Restore collapsed state
    const id = panelId(panel);
    if (id && getCollapsed().includes(id)) {
      panel.classList.add("collapsed");
    }

    header.addEventListener("click", () => {
      panel.classList.toggle("collapsed");
      const collapsed = getCollapsed();
      const pid = panelId(panel);
      if (!pid) return;
      if (panel.classList.contains("collapsed")) {
        if (!collapsed.includes(pid)) collapsed.push(pid);
      } else {
        const idx = collapsed.indexOf(pid);
        if (idx !== -1) collapsed.splice(idx, 1);
      }
      saveCollapsed(collapsed);
      syncCollapseAllBtn();
    });
  });

  // Collapse-all button
  const collapseAllBtn = document.getElementById("collapseAllBtn");
  function syncCollapseAllBtn() {
    if (!collapseAllBtn) return;
    const panels = document.querySelectorAll(".dashboard .panel");
    const visible = [...panels].filter((p) => p.style.display !== "none");
    const allCollapsed =
      visible.length > 0 &&
      visible.every((p) => p.classList.contains("collapsed"));
    collapseAllBtn.classList.toggle("all-collapsed", allCollapsed);
  }

  if (collapseAllBtn) {
    collapseAllBtn.addEventListener("click", () => {
      const panels = document.querySelectorAll(".dashboard .panel");
      const visible = [...panels].filter((p) => p.style.display !== "none");
      const allCollapsed = visible.every((p) =>
        p.classList.contains("collapsed"),
      );
      const collapsed = getCollapsed();

      visible.forEach((panel) => {
        const pid = panelId(panel);
        if (allCollapsed) {
          panel.classList.remove("collapsed");
          if (pid) {
            const idx = collapsed.indexOf(pid);
            if (idx !== -1) collapsed.splice(idx, 1);
          }
        } else {
          panel.classList.add("collapsed");
          if (pid && !collapsed.includes(pid)) collapsed.push(pid);
        }
      });

      saveCollapsed(collapsed);
      syncCollapseAllBtn();
    });
  }

  syncCollapseAllBtn();
}

// ── Hamburger Menu ──
function initHamburger() {
  const btn = document.getElementById("hamburgerBtn");
  const nav = document.getElementById("headerNav");
  if (!btn || !nav) return;

  const isMobile = () => globalThis.matchMedia("(max-width: 768px)").matches;

  function ensureMobileExtras() {
    if (nav.querySelector(".mobile-menu-extras")) return;
    const extras = document.createElement("div");
    extras.className = "mobile-menu-extras";

    const search = document.getElementById("searchTrigger");
    if (search) {
      const searchClone = search.cloneNode(true);
      searchClone.removeAttribute("id");
      searchClone.addEventListener("click", () => {
        nav.classList.remove("open");
        search.click();
      });
      extras.appendChild(searchClone);
    }

    const theme = document.getElementById("themeToggle");
    if (theme) {
      const themeClone = theme.cloneNode(true);
      themeClone.removeAttribute("id");
      themeClone.addEventListener("click", () => {
        theme.click();
      });
      extras.appendChild(themeClone);
    }

    nav.appendChild(extras);
  }

  btn.addEventListener("click", () => {
    if (isMobile()) ensureMobileExtras();
    nav.classList.toggle("open");
  });

  document.addEventListener("click", (e) => {
    if (!btn.contains(e.target) && !nav.contains(e.target)) {
      nav.classList.remove("open");
    }
  });
}

// ── Command Palette (Search) ──
function initSearch() {
  const overlay = document.getElementById("commandOverlay");
  const input = document.getElementById("commandInput");
  const results = document.getElementById("commandResults");
  const trigger = document.getElementById("searchTrigger");

  function open() {
    overlay.classList.add("open");
    input.value = "";
    results.innerHTML = "";
    setTimeout(() => input.focus(), 50);
  }

  function close() {
    overlay.classList.remove("open");
    input.value = "";
    results.innerHTML = "";
  }

  trigger.addEventListener("click", open);

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      if (overlay.classList.contains("open")) close();
      else open();
    }
    if (e.key === "Escape" && overlay.classList.contains("open")) {
      close();
    }
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  function collectSearchItems(q) {
    const allItems = [];
    for (const s of data.sweep.sources || []) {
      if (s.status !== "ok") continue;
      for (const item of (s.data?.items || []).slice(0, 20)) {
        if (item.title?.toLowerCase().includes(q)) {
          allItems.push({
            title: item.title,
            source: s.source,
            url: item.permalink || item.url || item.hnLink,
          });
        }
      }
      for (const m of (s.data?.models?.items || []).slice(0, 20)) {
        if (m.id?.toLowerCase().includes(q)) {
          allItems.push({ title: m.id, source: "Model", url: m.url });
        }
      }
    }
    return allItems;
  }

  function renderSearchResults(items) {
    results.innerHTML = items
      .slice(0, 12)
      .map(
        (item) =>
          `<div class="command-result-item" data-url="${esc(item.url || "")}">
        <span class="command-result-source">${esc(item.source)}</span>
        <span class="command-result-title">${esc(item.title)}</span>
      </div>`,
      )
      .join("");

    results.querySelectorAll(".command-result-item").forEach((el) => {
      el.addEventListener("click", () => {
        const url = el.dataset.url;
        if (url) window.open(url, "_blank", "noopener");
        close();
      });
    });
  }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q || !data?.sweep) {
      results.innerHTML = "";
      return;
    }
    const allItems = collectSearchItems(q);
    if (allItems.length === 0) {
      results.innerHTML =
        '<div class="command-no-results">No results found</div>';
      return;
    }
    renderSearchResults(allItems);
  });
}

// ── Domain chrome (nav pills, stat cards, panels — built from /api/domain) ──
function buildDomainUI(domain) {
  const nav = document.getElementById("headerNav");
  if (nav) {
    nav.innerHTML = domain.nav
      .map(
        (n, i) =>
          `<button class="nav-pill${i === 0 ? " active" : ""}" data-filter="${esc(n.filter)}">${esc(n.label)}</button>`,
      )
      .join("");
  }

  const statsBar = document.getElementById("statsBar");
  if (statsBar) {
    statsBar.innerHTML =
      domain.stats
        .map((s) => {
          const iconSvg =
            STAT_ICONS[s.icon] ??
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"></svg>';
          return `<div class="stat-card">
        <div class="stat-icon stat-icon-${esc(s.icon)}">${iconSvg}</div>
        <div>
          <div class="stat-number" id="stat-${esc(s.key)}">0</div>
          <div class="stat-label">${esc(s.label)}</div>
        </div>
        ${s.chart ? '<div class="mini-chart" id="chartSources"></div>' : `<div>\n          <div class="stat-sub" id="stat-${esc(s.key)}-sub">—</div>\n        </div>`}
      </div>`;
        })
        .join("") +
      `<div class="stat-card">
        <div
          class="freshness-ring"
          id="freshnessRing"
          style="background: conic-gradient(var(--accent) 0%, var(--bg3) 0%)"
        >
          <span id="freshnessVal">—</span>
        </div>
        <div>
          <div class="stat-label">Freshness</div>
          <div class="stat-sub" id="freshnessSub">—</div>
        </div>
      </div>`;
  }

  const dash = document.getElementById("dashboard");
  if (dash) {
    dash.innerHTML = domain.panels
      .map((p) => {
        // Fixed-id exceptions keep the existing LLM/digest code untouched.
        let panelId = `panel-${p.id}`;
        let extraClass = "";
        let extraStyle = "";
        let headerRight = `<span class="panel-count" id="count-${esc(p.id)}">—</span>`;
        let bodyClass = "panel-body";
        let bodyId = `body-${p.id}`;
        let bodyContent = "";
        if (p.variant === "briefing") {
          panelId = "analysisPanel";
          extraStyle = ' style="display: none"';
          headerRight = `<span class="panel-count" id="analysisProvider"></span>`;
          bodyId = "analysisBody";
        } else if (p.variant === "radar") {
          panelId = "radarPanel";
          extraStyle = ' style="display: none"';
          headerRight = `<span class="panel-count" id="radarCount">—</span>`;
          bodyId = "radarBody";
        } else if (p.variant === "digest") {
          panelId = "digestPanel";
          extraClass = " digest-panel";
          extraStyle = ' style="display: none"';
          headerRight = `<span class="digest-meta" id="digestMeta"></span>`;
          bodyClass = "panel-body digest-body";
          bodyId = "digestBody";
          bodyContent = `<div class="digest-empty">
            <p>No digest generated yet.</p>
            <button class="digest-generate-btn" id="digestGenerateBtn">
              Generate Weekly Digest
            </button>
          </div>`;
        }
        return `<div class="panel col-${p.span}${extraClass} fade-in" id="${panelId}" data-section="${esc(p.section)}"${extraStyle}>
        <div class="panel-header">
          <span class="panel-title"
            ><svg class="panel-icon" width="16" height="16" aria-hidden="true" focusable="false"><use href="#ic-${esc(p.icon)}"/></svg> ${esc(p.title)}</span
          >
          ${headerRight}
        </div>
        <div class="${bodyClass}" id="${bodyId}">${bodyContent}</div>
      </div>`;
      })
      .join("");
  }
}

// ── Main Render ──
function render(d) {
  if (!d?.sweep || !DOMAIN) return;
  const sweep = d.sweep;
  const sources = sweep.sources || [];
  const RC = window.RenderCore;
  const byCategory = RC.aggregateByCategory(sources);

  document.getElementById("statusDot").className = "status-dot live";
  document.getElementById("statusText").textContent = "LIVE";
  document.getElementById("sweepTime").textContent = timeAgo(sweep.timestamp);
  document.getElementById("sourceCountText").textContent =
    `${sweep.sourcesOk}/${sweep.sourcesTotal}`;
  const footerSrc = document.getElementById("footerSources");
  if (footerSrc) footerSrc.textContent = `${sweep.sourcesTotal} sources`;

  renderTicker(sources);
  renderStats(sources, byCategory);
  for (const panel of DOMAIN.panels) renderPanel(panel, sources, byCategory);
  renderAnalysis(d.analysis);
  renderIntegrity(sources);
  applyNavFilter();
}

// ── Periodic refresh of time-dependent UI ──
setInterval(() => {
  if (!data?.sweep || !DOMAIN) return;
  document.getElementById("sweepTime").textContent = timeAgo(
    data.sweep.timestamp,
  );
  renderStats(data.sweep.sources || []);
}, 30000);

// ── Stats Bar ──
function renderSourceChart(sourceCounts) {
  const maxCount = Math.max(...Object.values(sourceCounts), 1);
  return Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => {
      const h = Math.max(4, Math.round((count / maxCount) * 32));
      return `<div class="mini-bar" style="height:${h}px" title="${esc(name)}: ${count}"></div>`;
    })
    .join("");
}

function renderFreshness(newestTime) {
  const ageMins = newestTime
    ? Math.max(0, Math.round((Date.now() - newestTime) / 60000))
    : 999;
  const freshPct = Math.max(
    0,
    Math.min(100, Math.round(100 * (1 - ageMins / 1440))),
  );

  let freshnessLabel = "Aging";
  if (ageMins < 60) freshnessLabel = "Very fresh";
  else if (ageMins < 360) freshnessLabel = "Recent";

  // Single quiet accent — the label carries the state, not a traffic light.
  document.getElementById("freshnessRing").style.background =
    `conic-gradient(var(--accent) ${freshPct}%, var(--bg3) ${freshPct}%)`;
  document.getElementById("freshnessVal").textContent =
    ageMins < 60 ? `${ageMins}m` : `${Math.round(ageMins / 60)}h`;
  document.getElementById("freshnessSub").textContent = freshnessLabel;
}

function renderStats(sources, byCategory) {
  if (!DOMAIN) return;
  const RC = window.RenderCore;
  byCategory = byCategory ?? RC.aggregateByCategory(sources);
  document.getElementById("statsBar").style.display = "flex";

  for (const stat of DOMAIN.stats) {
    const { value, sub } = RC.statValue(stat, byCategory);
    const numEl = document.getElementById(`stat-${stat.key}`);
    if (numEl) numEl.textContent = value;
    if (stat.sub) {
      const subEl = document.getElementById(`stat-${stat.key}-sub`);
      if (subEl) subEl.textContent = sub;
    }
    if (stat.chart) {
      // Per-source item counts across this stat's categories
      const sourceCounts = {};
      for (const s of sources) {
        if (s.status !== "ok") continue;
        const cat = s.data?.category ?? "news";
        if (!stat.categories.includes(cat)) continue;
        const n = (s.data?.items || []).length;
        if (n > 0) sourceCounts[s.source] = n;
      }
      const chartEl = document.getElementById("chartSources");
      if (chartEl) chartEl.innerHTML = renderSourceChart(sourceCounts);
    }
  }

  // Freshness (built-in engine chrome): newest item timestamp across everything
  let newestTime = 0;
  for (const items of Object.values(byCategory)) {
    for (const item of items) {
      const t = new Date(item._time || 0).getTime();
      if (t > newestTime) newestTime = t;
    }
  }
  renderFreshness(newestTime);
}

// ── Ticker ──
function renderTicker(sources) {
  const items = [];
  for (const s of sources) {
    if (s.status !== "ok") continue;
    const srcItems = s.data?.items || [];
    for (const item of srcItems.slice(0, 5)) {
      if (item.title) {
        items.push({
          title: item.title,
          source: s.source,
          url: item.permalink || item.url || "#",
        });
      }
    }
  }
  const html = items
    .map(
      (i) =>
        `<span class="ticker-item"><span class="ticker-src">${esc(i.source)}</span><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></span>`,
    )
    .join("");
  document.getElementById("ticker").innerHTML = html + html;
}

// ── Panels (variant-dispatched, field-driven) ──
function newsItemHtml(i) {
  const chipLabel = i.subreddit ? `r/${i.subreddit}` : i._source;
  const author = i.author || i.creator;
  const time = timeAgo(i._time);
  return `
    <div class="news-item">
      <div class="news-title"><a href="${esc(i._url)}" target="_blank" rel="noopener">${esc(i.title || i.name)}</a></div>
      <div class="news-meta">
        <span class="news-source">${esc(chipLabel)}</span>
        ${i._score ? `<span class="news-score">▲ ${formatNum(i._score)}</span>` : ""}
        ${i._comments ? `<span>↳ ${formatNum(i._comments)}</span>` : ""}
        ${i.flair ? `<span class="news-flair">${esc(i.flair)}</span>` : ""}
        ${author ? `<span>${esc(author)}</span>` : ""}
        ${time ? `<span>${time}</span>` : ""}
      </div>
      ${i.description ? `<div class="news-meta" style="opacity:0.7">${esc(i.description)}</div>` : ""}
    </div>
  `;
}

function repoCardHtml(r) {
  return `
  <div class="repo-card">
    <div class="repo-name"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a></div>
    <div class="repo-desc">${esc(r.description)}</div>
    <div class="repo-stats">
      <span><span class="star-icon">★</span> ${formatNum(r.stars)}</span>
      <span>🍴 ${formatNum(r.forks)}</span>
      ${r.language ? `<span>${esc(r.language)}</span>` : ""}
    </div>
  </div>
`;
}

function paperCardHtml(p) {
  return `
  <div class="paper-card">
    <div class="paper-title"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a></div>
    <div class="paper-authors">${esc((p.authors || []).join(", "))}</div>
    <div class="paper-cats">${(p.categories || [])
      .slice(0, 3)
      .map((c) => `<span class="paper-cat">${esc(c)}</span>`)
      .join("")}</div>
  </div>
`;
}

function modelCardHtml(m) {
  return `
  <div class="model-card">
    <div class="model-name"><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.id)}</a></div>
    <div class="model-stats">↓ ${formatNum(m.downloads)} &nbsp; ♥ ${formatNum(m.likes)} &nbsp; ${esc(m.pipeline)}</div>
    <div class="model-tags">${(m.tags || []).map((t) => `<span class="model-tag">${esc(t)}</span>`).join("")}</div>
  </div>
`;
}

function cardHtmlFor(item) {
  if (item.stars != null) return repoCardHtml(item);
  if (item.authors) return paperCardHtml(item);
  if (item.downloads != null || item.pipeline) return modelCardHtml(item);
  return newsItemHtml(item);
}

function renderPanel(panel, sources, byCategory) {
  if (panel.variant === "briefing" || panel.variant === "radar") return; // LLM-driven
  if (panel.variant === "digest") return; // digest flow owns its body

  const RC = window.RenderCore;
  const items =
    panel.variant === "aggregate"
      ? RC.aggregateItems(panel, byCategory)
      : RC.selectPanelItems(panel, sources, byCategory);

  const countEl = document.getElementById(`count-${panel.id}`);
  if (countEl) countEl.textContent = items.length;
  const bodyEl = document.getElementById(`body-${panel.id}`);
  if (!bodyEl) return;
  bodyEl.innerHTML = items
    .map((i) => (panel.variant === "cards" ? cardHtmlFor(i) : newsItemHtml(i)))
    .join("");
}

// ── Analysis ──
function activeFilter() {
  const active = document.querySelector(".nav-pill.active");
  return active?.dataset?.filter || "all";
}

function buildBriefingHtml(analysis) {
  let html = "";
  if (analysis.summary) {
    html += `<div class="analysis-summary">${esc(analysis.summary)}</div>`;
  }

  if (analysis.trends?.length) {
    html += `<div class="section-label">Emerging Trends</div>`;
    const trendSpans = analysis.trends
      .map((t) => `<span class="trend-item">${esc(t)}</span>`)
      .join("");
    html += `<div style="margin-bottom:14px">${trendSpans}</div>`;
  }

  if (analysis.topStories?.length) {
    html += `<div class="section-label">Top Stories</div>`;
    for (const s of analysis.topStories) {
      const imp = s.impact || "medium";
      const headlineText = esc(s.headline);
      const headline = s.url
        ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${headlineText}</a>`
        : headlineText;
      html += `<div class="analysis-story">
        <div class="analysis-headline">
          <span class="impact-badge ${imp}">${imp}</span>
          ${headline}
        </div>
        <div class="analysis-significance">${esc(s.significance)} <span class="cat-tag">${esc(s.category)}</span></div>
      </div>`;
    }
  }
  return html;
}

const RADAR_STATUS_META = {
  released: {
    color: "var(--green)",
    bg: "rgba(0,230,118,.15)",
    label: "RELEASED",
  },
  announced: {
    color: "var(--amber)",
    bg: "rgba(255,193,7,.15)",
    label: "ANNOUNCED",
  },
  rumored: {
    color: "var(--pink)",
    bg: "rgba(255,128,171,.15)",
    label: "RUMORED",
  },
  "in-development": {
    color: "var(--blue)",
    bg: "rgba(68,138,255,.15)",
    label: "IN DEV",
  },
};

function buildRadarHtml(analysis) {
  let html = "";
  if (analysis.modelRadar?.length) {
    html += `<div class="section-label">Model Radar</div>`;
    document.getElementById("radarCount").textContent =
      analysis.modelRadar.length + (analysis.signals?.length || 0);
    for (const m of analysis.modelRadar) {
      const meta =
        RADAR_STATUS_META[m.status] || RADAR_STATUS_META["in-development"];
      const nameText = esc(m.name);
      const nameHtml = m.url
        ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${nameText}</a>`
        : nameText;
      html += `<div class="radar-card">
        <div class="radar-status" style="background:${meta.color};box-shadow:0 0 6px ${meta.color}"></div>
        <div class="radar-info">
          <div class="radar-name">${nameHtml}</div>
          <div class="radar-org">${esc(m.org)}</div>
          ${m.note ? `<div class="radar-note">${esc(m.note)}</div>` : ""}
        </div>
        <span class="radar-status-label" style="background:${meta.bg};color:${meta.color}">${meta.label}</span>
      </div>`;
    }
  }

  if (analysis.signals?.length) {
    html += `<div class="section-label" style="margin-top:12px">Signals</div>`;
    for (const s of analysis.signals) {
      const conf = s.confidence || "low";
      const sigText = esc(s.signal);
      const sigContent = s.url
        ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${sigText}</a>`
        : sigText;
      html += `<div class="signal-item">
        <span class="signal-conf conf-${conf}">${esc(conf)}</span>
        <div class="signal-text">${sigContent}<span class="signal-source">${esc(s.source)}</span></div>
      </div>`;
    }
  }
  return html;
}

function renderAnalysis(analysis) {
  const briefPanel = document.getElementById("analysisPanel");
  const radarPanel = document.getElementById("radarPanel");
  if (!briefPanel || !radarPanel) return;
  if (!analysis) {
    // No LLM layer: keep the grid rhythm intact with a quiet placeholder
    // instead of collapsing the panels into holes.
    briefPanel.style.display = "";
    radarPanel.style.display = "";
    const briefBody = document.getElementById("analysisBody");
    const radarBody = document.getElementById("radarBody");
    if (briefBody)
      briefBody.innerHTML =
        '<div class="panel-hint">briefing disabled — no LLM configured. set <code>LLM_PROVIDER</code> and <code>LLM_API_KEY</code> in <code>.env</code> for daily analyst briefings.</div>';
    if (radarBody)
      radarBody.innerHTML =
        '<div class="panel-hint">radar rides along with the briefing — it needs the LLM layer.</div>';
    const provider = document.getElementById("analysisProvider");
    if (provider) provider.textContent = "";
    const radarCount = document.getElementById("radarCount");
    if (radarCount) radarCount.textContent = "";
    return;
  }
  briefPanel.style.display = "";
  radarPanel.style.display = "";

  document.getElementById("analysisBody").innerHTML =
    buildBriefingHtml(analysis);
  document.getElementById("radarBody").innerHTML = buildRadarHtml(analysis);
}

// ── Weekly Digest ──
let lastDigest = null;

async function fetchDigest() {
  try {
    const res = await fetch("/api/digest");
    if (res.ok) {
      const digest = await res.json();
      renderDigest(digest);
    }
  } catch {
    /* no digest available */
  }
}

function renderDigestHighlights(highlights) {
  let html = `<div class="digest-section-title">Key Highlights</div><div class="digest-highlights">`;
  for (const h of highlights) {
    const imp = h.impact || "medium";
    const titleText = esc(h.title);
    const titleHtml = h.url
      ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">${titleText}</a>`
      : titleText;
    html += `<div class="digest-highlight-card">
      <div class="highlight-head">
        <span class="impact-badge ${imp}">${imp}</span>
        <span class="highlight-title">${titleHtml}</span>
      </div>
      <div class="highlight-body">${esc(h.body)}</div>
      ${h.category ? `<span class="highlight-category">${esc(h.category)}</span>` : ""}
    </div>`;
  }
  return html + `</div>`;
}

function renderDigestModels(models) {
  let html = `<div class="digest-section-title">Model & Tool Updates</div><div class="digest-models">`;
  for (const m of models) {
    const nameText = esc(m.name);
    const nameHtml = m.url
      ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${nameText}</a>`
      : nameText;
    html += `<div class="digest-model-row">
      <span class="model-name">${nameHtml}</span>
      <span class="model-org">${esc(m.org)}</span>
      <span class="model-summary">${esc(m.summary)}</span>
    </div>`;
  }
  return html + `</div>`;
}

function renderDigestPapers(papers) {
  let html = `<div class="digest-section-title">Paper Picks</div><div class="digest-papers">`;
  for (const p of papers) {
    const pTitle = esc(p.title);
    const pHtml = p.url
      ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${pTitle}</a>`
      : pTitle;
    html += `<div class="digest-paper">
      <div class="paper-title">${pHtml}</div>
      <div class="paper-authors">${esc(p.authors)}</div>
      <div class="paper-insight">${esc(p.insight)}</div>
    </div>`;
  }
  return html + `</div>`;
}

function renderDigest(digest) {
  lastDigest = digest;
  const panel = document.getElementById("digestPanel");
  const body = document.getElementById("digestBody");
  const meta = document.getElementById("digestMeta");
  if (!digest || !panel || !body || !meta) return;

  // Only show the digest panel if the digest filter is active
  const filter = activeFilter();
  panel.style.display = filter === "digest" ? "" : "none";
  meta.textContent = digest.weekId
    ? `${digest.weekId} · Generated ${timeAgo(digest.generatedAt)}`
    : "";

  let html = `<div class="digest-toolbar">
    <span class="digest-meta">${digest.generatedAt ? "Last generated: " + new Date(digest.generatedAt).toLocaleString() : ""}</span>
    <button class="digest-generate-btn" id="digestRegenBtn">Regenerate Digest</button>
  </div>`;

  if (digest.tldr) {
    html += `<div class="digest-tldr">${esc(digest.tldr)}</div>`;
  }
  if (digest.highlights?.length)
    html += renderDigestHighlights(digest.highlights);
  if (digest.modelUpdates?.length)
    html += renderDigestModels(digest.modelUpdates);
  if (digest.paperPicks?.length) html += renderDigestPapers(digest.paperPicks);

  if (digest.communityBuzz?.length) {
    html += `<div class="digest-section-title">Community Buzz</div><div class="digest-buzz">`;
    for (const b of digest.communityBuzz) {
      html += `<span class="digest-buzz-item">${esc(b)}</span>`;
    }
    html += `</div>`;
  }

  if (digest.lookAhead) {
    html += `<div class="digest-section-title">Look Ahead</div>`;
    html += `<div class="digest-lookahead">${esc(digest.lookAhead)}</div>`;
  }

  body.innerHTML = html;
  document
    .getElementById("digestRegenBtn")
    ?.addEventListener("click", function () {
      triggerDigestGeneration(this);
    });
}

async function triggerDigestGeneration(btn) {
  const body = document.getElementById("digestBody");

  // Show loading animation
  body.innerHTML = `<div class="digest-loading">
    <div class="digest-spinner"></div>
    <div class="digest-loading-text">Fetching 7 days of AI intelligence across ${data?.sweep?.sourcesTotal || "all"} sources…</div>
  </div>`;

  function showError(msg) {
    if (lastDigest) {
      renderDigest(lastDigest);
    } else {
      body.innerHTML = "";
    }
    const notice = document.createElement("div");
    notice.className = "digest-notice";
    notice.textContent = msg;
    body.prepend(notice);
    setTimeout(() => notice.remove(), 5000);
  }

  try {
    const res = await fetch("/api/digest/generate", { method: "POST" });
    if (res.ok) {
      const digest = await res.json();
      renderDigest(digest);
    } else if (res.status === 409) {
      // Digest already exists for this ISO week — show it, don't show an error banner
      const payload = await res.json().catch(() => ({}));
      if (payload.existing) {
        renderDigest({ ...lastDigest, ...payload.existing });
        const notice = document.createElement("div");
        notice.className = "digest-notice";
        notice.textContent = `Already generated for this week · ${timeAgo(payload.existing.generatedAt)}`;
        document.getElementById("digestBody")?.prepend(notice);
        setTimeout(() => notice.remove(), 5000);
      } else {
        // 409 without `existing` → the digestGenerating mutex fired (another
        // generation is already in flight). Surface the server message so the
        // user gets feedback instead of an empty silent render.
        showError(payload.error || "Digest generation already in progress");
      }
    } else {
      const err = await res.json().catch(() => ({}));
      showError(err.error || "Failed to generate digest");
    }
  } catch {
    showError("Network error — could not generate digest");
  }
}

// ── Source Integrity (modal) ──
let cachedSources = [];
function renderIntegrity(sources) {
  cachedSources = sources;
}

function initSourceModal() {
  document.getElementById("sourceCount").addEventListener("click", () => {
    const modal = document.getElementById("sourceModal");
    if (cachedSources.length) {
      document.getElementById("sourceModalBody").innerHTML =
        `<div class="source-grid">${cachedSources
          .map(
            (s) =>
              `<div class="source-chip"><span class="dot ${s.status === "ok" ? "ok" : "err"}"></span>${esc(s.source)}</div>`,
          )
          .join("")}</div>`;
    }
    modal.classList.add("open");
  });
  document.getElementById("sourceModalClose").addEventListener("click", () => {
    document.getElementById("sourceModal").classList.remove("open");
  });
  document.getElementById("sourceModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
  });
}

// ── Boot: domain chrome first, then all init ──
// Panels/nav/stats are built from /api/domain BEFORE the collapse/nav/etc.
// initializers run (they key off runtime-built elements). If the domain fetch
// fails (e.g. the static inject.mjs export has no server), the dashboard
// renders no panels but must not throw.
async function init() {
  try {
    const res = await fetch("/api/domain");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DOMAIN = await res.json();
    buildDomainUI(DOMAIN);
  } catch (err) {
    console.error("Failed to load /api/domain — dashboard disabled", err);
  }

  initTheme();
  initKeyboardHelp();
  initNav();
  initPanelCollapse();
  initHamburger();
  initSearch();
  initSourceModal();

  // Wire up the initial digest generate button (runtime-built panel)
  document
    .getElementById("digestGenerateBtn")
    ?.addEventListener("click", function () {
      triggerDigestGeneration(this);
    });

  // Fetch digest on load
  fetchDigest().catch(() => {}); // NOSONAR — browser script, not an ES module
}

init();
