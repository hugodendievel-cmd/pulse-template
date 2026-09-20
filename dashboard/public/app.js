// app.js — domain-agnostic dashboard client. Panels, nav pills, stat cards
// and source colors are all built at runtime from GET /api/domain; item
// rendering binds to normalized fields (via window.RenderCore), never to
// source names.

// ── State ──
let data = null;
let DOMAIN = null; // active domain pack chrome, fetched at boot
// Delta `N new` badges, keyed by panel id (never cleared on a view switch, so a
// badge earned on one view is still shown when its panel is next rendered).
const pendingDelta = new Map(); // panelId -> count
// True once applyData has painted the active view at least once. A late-joining
// client can replay a sweep whose delta is already non-first; before the first
// paint that must still render fully with no badge, so client first paint — not
// just delta.isFirst — gates the full render.
let hasRendered = false;
const state = {
  view: null, // active pack view id, seeded from views[].default
  // In-view filter/sort for the source grid, session-persisted (Story 4.3).
  filters: { category: "all", sort: "freshest" },
  // Source-health live inputs (Story 4.4): the in-flight SSE snapshot, the
  // server refresh cooldown and the last completed sweep's timestamp.
  sweepProgress: null,
  cooldownMs: 0,
  lastSweepAt: null,
  // Current ISO week id (Brussels) from /api/health, for the digest's
  // once-per-week guard note (Story 5.2). Derived, never persisted.
  currentWeekId: "",
  // SSE transport liveness (Story 6.4): the page opens an EventSource
  // immediately, so the stream starts connected; the first onerror flips it.
  // lastEventAge is ms since the last stream event (not the sweep age) — the
  // 30s heartbeat keeps the connection open without firing onmessage, so a
  // quiet stream legitimately shows a rising `{n}s`.
  sse: "connected",
  lastEventAge: 0,
};

// Sort options for the filter bar. "freshest" is the default; the others are
// generic keys handled by RenderCore.sortSourceCards.
const SORT_OPTIONS = ["freshest", "engagement", "name", "status"];
// Session keys deliberately avoid any view-id substring (architecture scan).
const FILTER_CATEGORY_KEY = "pulse-filter-category";
const FILTER_SORT_KEY = "pulse-sort";

// Source cards show at most this many item rows; the header reports the panel's
// true total, so the cap is display-only (design 3b).
// Floor for a source card's rows. The card shows its panel's own pack `limit`
// and scrolls internally past six — design 3b: "each scrolls internally at ≥6
// items rather than growing the page". A flat 3 hid most of a feed whose own
// header advertised 25.
const CARD_ITEM_ROWS = 12;

// How long a dropped stream may stay in `reconnecting` before the pill
// downgrades to `offline` (design §5 SSE states).
const RECONNECT_OFFLINE_MS = 10000;

// ── Helpers ──
function esc(s) {
  // Attribute-safe escaping. The DOM text-node serialization escapes &, < and >
  // but leaves quotes untouched, so interpolating esc() into an attribute
  // (href/…) would let an LLM- or feed-supplied `"` close the attribute and
  // inject markup. Escape quotes too, mirroring the server's escapeHtml().
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

// Static export (Story 7.1): dashboard/inject.mjs sets
// window.__PULSE_BOOTSTRAP__ before this file runs. When present, skip every
// server call — there is no server (file:// / a hosted static file).
const BOOTSTRAP = window.__PULSE_BOOTSTRAP__ || null;
const IS_STATIC = BOOTSTRAP?.static === true;
// No stream in a static file: render `offline · showing cached`, never a fake
// `live`.
if (IS_STATIC) state.sse = "offline";

// Seed the countdown cooldown and the current ISO week from /api/health once
// at boot (no new API). The dashboard shell is already painted by then.
if (!IS_STATIC) {
  fetch("/api/health")
    .then((r) => r.json())
    .then((h) => {
      if (typeof h?.cooldownMs === "number") state.cooldownMs = h.cooldownMs;
      // Seed the current ISO week so the digest guard note is deterministic on
      // render; re-render an already-rendered digest once the week is known.
      state.currentWeekId = h?.currentWeekId ?? state.currentWeekId;
      if (lastDigest) renderDigest(lastDigest);
    })
    .catch(() => {
      /* non-blocking: the dashboard stays in its boot skeleton state */
    });
}

// ── SSE ──
let sseConnected = false;
// The pending reconnecting→offline grace timer (Story 6.4).
let reconnectOfflineTimer = null;
function clearReconnectTimer() {
  if (reconnectOfflineTimer) {
    clearTimeout(reconnectOfflineTimer);
    reconnectOfflineTimer = null;
  }
}
if (!IS_STATIC) {
  const evtSource = new EventSource("/events");
  evtSource.onmessage = (e) => {
    if (e.data === "connected") {
      sseConnected = true;
      state.sse = "connected";
      state.lastEventAge = 0;
      clearReconnectTimer();
      renderLivePill();
      return;
    }
    try {
      const msg = JSON.parse(e.data);
      // Any parsed message proves the stream is live: reset the age and recover
      // from a prior drop without discarding `data` or the rendered panels.
      state.lastEventAge = 0;
      if (state.sse !== "connected") {
        state.sse = "connected";
        clearReconnectTimer();
        renderLivePill();
      }
      if (msg.type === "progress") {
        state.sweepProgress = msg;
        renderSourceHealth();
        resolvePanelSkeletons(msg.steps);
      }
      if (msg.type === "update") {
        state.lastSweepAt = msg.data?.sweep?.timestamp ?? state.lastSweepAt;
        state.sweepProgress = null;
        renderSourceHealth();
        applyData(msg.data);
      }
      if (msg.type === "digest") {
        renderDigest(msg.data);
        renderEditionCard();
        renderArchive();
      }
      if (msg.type === "newsletter") {
        lastEdition = msg.data;
        renderEditionCard();
        renderDailyEdition();
      }
    } catch {
      /* ignore malformed messages */
    }
  };
  evtSource.onerror = () => {
    // The transport dropped: keep `data`/DOMAIN and every rendered body intact so
    // the cached content stays readable while we reconnect. `reconnecting` first;
    // `offline · showing cached` only if the stream stays down.
    state.sse = "reconnecting";
    renderLivePill();
    // EventSource retries on its own and fires `onerror` again on every failed
    // attempt. If each error restarted the grace timer, a sustained outage would
    // keep resetting it and never reach `offline` — so arm the timer only once
    // per drop. A proving `connected`/message clears it via clearReconnectTimer().
    if (!reconnectOfflineTimer) {
      reconnectOfflineTimer = setTimeout(() => {
        reconnectOfflineTimer = null;
        if (state.sse !== "connected") {
          state.sse = "offline";
          renderLivePill();
        }
      }, RECONNECT_OFFLINE_MS);
    }
  };
}

// Fallback: poll /api/data (only when SSE is not active)
async function fallbackFetch() {
  if (sseConnected) return;
  try {
    const res = await fetch("/api/data");
    if (res.ok) {
      const d = await res.json();
      applyData(d);
    }
  } catch {
    /* ignore */
  }
}
if (!IS_STATIC) {
  setTimeout(fallbackFetch, 8000);
  setInterval(fallbackFetch, 60000);
}

// ── Theme Toggle (dark ⇄ light, plus terminal via Shift+T) ──
// ── Theme ──
// A "mode" is auto (follow the OS, nothing stored) or an explicit
// light/dark/terminal. The effective class renders the mode's theme.
const THEME_CYCLE = ["light", "dark", "auto"];

function systemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function themeMode() {
  return document.documentElement.dataset.themeMode || "auto";
}

function applyTheme(mode, { persist = true } = {}) {
  // Anything unrecognised (a stale value, hand-edited storage) falls back to auto.
  if (!["light", "dark", "terminal", "auto"].includes(mode)) mode = "auto";
  const root = document.documentElement;
  const resolved = mode === "auto" ? systemTheme() : mode;
  root.classList.remove("light", "terminal");
  if (resolved === "light") root.classList.add("light");
  else if (resolved === "terminal") root.classList.add("terminal");
  root.dataset.themeMode = mode;
  if (persist) {
    // Auto stores nothing, so following the system stays live on the next visit.
    if (mode === "auto") localStorage.removeItem("pulse-theme");
    else localStorage.setItem("pulse-theme", mode);
  }
  const btn = document.getElementById("themeToggle");
  if (btn) {
    btn.setAttribute("aria-pressed", resolved === "light" ? "true" : "false");
    btn.setAttribute(
      "aria-label",
      mode === "auto" ? "Theme: automatic (system)" : `Theme: ${mode}`,
    );
  }
}

function cycleTheme() {
  const mode = themeMode();
  if (mode === "terminal") return applyTheme("light");
  const i = THEME_CYCLE.indexOf(mode);
  applyTheme(THEME_CYCLE[(i + 1) % THEME_CYCLE.length]);
}

function initTheme() {
  // Follow the OS by default; a saved choice overrides it and sticks.
  const saved = localStorage.getItem("pulse-theme");
  applyTheme(saved || "auto", { persist: false });
  // Live-follow the OS while the mode is automatic.
  window
    .matchMedia?.("(prefers-color-scheme: dark)")
    ?.addEventListener?.("change", () => {
      if (themeMode() === "auto") applyTheme("auto", { persist: false });
    });
  const btn = document.getElementById("themeToggle");
  if (btn) btn.addEventListener("click", cycleTheme);
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
      // Terminal is a separate explicit mode, outside the light/dark/auto cycle.
      applyTheme(themeMode() === "terminal" ? "auto" : "terminal");
    } else if (e.key === "t" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      cycleTheme();
    } else if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      toggleAllPanels();
    } else {
      // Numbering shortcuts: the active pack's `views` order is the mapping.
      // Positional (index → view), no view-id literal, no hardcoded count; a
      // missing index is a no-op.
      const digit = Number(e.key);
      if (!inInput && !e.metaKey && !e.ctrlKey && Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        const views = DOMAIN?.views ?? [];
        const target = views[digit - 1];
        if (target?.id) { e.preventDefault(); setView(target.id); }
      }
    }
  });
}

// ── Nav (view) switching ──
function initViewNav() {
  // Both the header and the mobile bottom nav carry `.nav-pill` buttons.
  for (const id of ["headerNav", "bottomNav"]) {
    const nav = document.getElementById(id);
    if (!nav) continue;
    nav.addEventListener("click", (e) => {
      const pill = e.target.closest(".nav-pill");
      if (!pill) return;
      setView(pill.dataset.view);
    });
  }
}

// ── Panel Collapse ──
// Collapse-all is keyboard-only (`C`): design 3a's header carries no button for
// it. initPanelCollapse assigns the real implementation, which needs its
// closure over the persisted collapsed set.
let toggleAllPanels = () => {};

function initPanelCollapse() {
  const STORAGE_KEY = "pulse-collapsed";

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

  // The chevron is a real button (Story 6.8): a keyboard user can collapse a
  // single panel, not only the `C` collapse-all. `aria-expanded` mirrors the
  // class state so the disclosure is announced.
  function syncPanelToggle(panel) {
    const toggle = panel.querySelector(".panel-toggle");
    if (!toggle) return;
    const collapsed = panel.classList.contains("collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute(
      "aria-label",
      collapsed ? "Expand panel" : "Collapse panel",
    );
  }

  // Inject toggle chevron into every panel header. Idempotent on re-init so a
  // restored panel never collects a second chevron.
  document.querySelectorAll(".dashboard .panel").forEach((panel) => {
    const header = panel.querySelector(".panel-header");
    if (!header) return;

    if (!header.querySelector(".panel-toggle")) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "panel-toggle";
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Collapse panel");
      toggle.textContent = "▼";
      // The header delegation toggles on any click; stop the button's own click
      // from bubbling and re-dispatch once so activation lands exactly once.
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        header.click();
      });
      header.appendChild(toggle);
    }

    // Restore collapsed state: chevron rotation and hidden body are both
    // class-driven, so re-adding `.collapsed` restores the whole state.
    const id = panelId(panel);
    if (id && getCollapsed().includes(id)) {
      panel.classList.add("collapsed");
    }
    syncPanelToggle(panel);

    if (panel.dataset.collapseBound) return;
    panel.dataset.collapseBound = "1";
    header.addEventListener("click", () => {
      panel.classList.toggle("collapsed");
      syncPanelToggle(panel);
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
    });
  });

  // Collapse-all (bound to `C`; no header control per design 3a).
  toggleAllPanels = () => {
    const panels = document.querySelectorAll(".dashboard .panel");
    const visible = [...panels].filter((p) => p.style.display !== "none");
    if (!visible.length) return;
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
      syncPanelToggle(panel);
    });

    saveCollapsed(collapsed);
  };

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
        const title = (item.title || item.name || "").toLowerCase();
        if (title.includes(q)) {
          allItems.push({
            title: item.title || item.name,
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
  // RenderCore is assigned by index.html's inline module script before this
  // runs; bail defensively so the static inject.mjs path cannot throw.
  if (!window.RenderCore) return;

  const views = Array.isArray(domain.views) ? domain.views : [];
  const activeView = window.RenderCore.viewFor(domain.views);
  const activeId = activeView?.id ?? null;
  state.view = activeId;

  const nav = document.getElementById("headerNav");
  if (nav) {
    // Pills come straight from the pack's `views` — no view id lives here.
    nav.innerHTML = views
      .map(
        (v) =>
          `<button class="nav-pill${v.id === activeId ? " active" : ""}" data-view="${esc(v.id)}">${esc(v.label)}</button>`,
      )
      .join("");
  }

  const bottomNav = document.getElementById("bottomNav");
  if (bottomNav) {
    // Same markup as the header nav, built from the pack's `views` (no view id
    // literal). setView toggles `.nav-pill.active` across both containers.
    bottomNav.innerHTML = views
      .map(
        (v) =>
          `<button class="nav-pill" data-view="${esc(v.id)}">${esc(v.label)}</button>`,
      )
      .join("");
  }

  const dash = document.getElementById("dashboard");
  if (dash) {
    // One `.view` container holds every panel frame; setView mutates its
    // data-view/data-layout and never rebuilds it (listeners must survive).
    const frameFor = (p) => {
        // Fixed-id exceptions keep the existing LLM/digest code untouched.
        let panelId = `panel-${p.id}`;
        let extraClass = "";
        let extraStyle = "";
        // Empty until a count arrives: CSS hides an empty count, so bare labels
        // (the edition reader's header row) no longer show a stray "—".
        let headerRight = `<span class="panel-count" id="count-${esc(p.id)}"></span>`;
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
          headerRight = `<span class="panel-count" id="radarCount"></span>`;
          bodyId = "radarBody";
        } else if (p.variant === "signals") {
          panelId = "signalsPanel";
          extraStyle = ' style="display: none"';
          headerRight = "";
          bodyId = "signalsBody";
        } else if (p.variant === "digest") {
          panelId = "digestPanel";
          extraClass = " digest-panel";
          extraStyle = ' style="display: none"';
          headerRight = `<span class="digest-meta" id="digestMeta"></span>`;
          bodyClass = "panel-body digest-body";
          bodyId = "digestBody";
          bodyContent = `<div class="digest-empty">
            <span class="digest-week">${esc(p.weeklyRun || "")} · next run</span>
            <p>no digest yet</p>
            <button class="digest-generate-btn" id="digestGenerateBtn">
              generate weekly digest
            </button>
          </div>`;
        }
        // Source-bound panels become uniform cards under the grid layout; the
        // class only styles inside [data-layout="grid"], never here by name.
        if (p.variant === "news" || p.variant === "cards") {
          extraClass += " source-card";
        }
        // Design 3a/3c bands: no card surface, no header chrome. Pack-declared
        // so the engine stays free of panel-id literals.
        if (p.chrome === "bare") extraClass += " panel--bare";
        // Pack-declared surface tone (design 3a's green editions card).
        if (p.tone === "green") extraClass += " panel--green";
        // A self-labelled panel's body renders the design's own label row, so
        // the generic header would duplicate it.
        const header = p.selfLabeled
          ? ""
          : `<div class="panel-header">
          <span class="panel-title">${esc(p.title)}</span>
          ${headerRight}
        </div>`;
        return `<div class="panel is-loading fade-in${extraClass}" aria-busy="true" id="${panelId}" data-section="${esc(p.section)}" data-column="${esc(p.column || "main")}" data-panel-id="${esc(p.id)}"${extraStyle}>
        ${header}
        <div class="${bodyClass}" id="${bodyId}">${bodyContent}</div>
      </div>`;
    };

    // Two column wrappers, always emitted. The rail layouts (design 3a/3c) need
    // main and rail to be independent stacks — as grid siblings they would
    // share row heights, leaving a hole beside a tall briefing. The grid layout
    // keeps one flat 3-column grid, so there the wrappers are `display:
    // contents` and the panels place themselves.
    const columnHtml = (which) =>
      domain.panels
        .filter((p) => (p.column === "rail" ? "rail" : "main") === which)
        .map(frameFor)
        .join("");
    const frames =
      `<div class="view-col view-col--main">${columnHtml("main")}</div>` +
      `<div class="view-col view-col--rail">${columnHtml("rail")}</div>`;
    // index.html ships an empty #viewRoot so the static shell and the runtime
    // view share one element; fall back to creating the container.
    // The quiet no-LLM note is a single grid-wide element prepended to the
    // view, so it renders exactly once above the main/rail split.
    const note = `<div class="briefing-note" id="briefingNote" hidden></div>`;
    const viewRoot = document.getElementById("viewRoot");
    if (viewRoot) {
      viewRoot.dataset.view = activeId ?? "";
      viewRoot.dataset.layout = activeView?.layout || "grid";
      viewRoot.innerHTML = note + frames;
    } else {
      dash.innerHTML = `<div class="view" data-view="${esc(activeId ?? "")}" data-layout="${esc(activeView?.layout || "grid")}">${note}${frames}</div>`;
    }
  }
}

// ── View switching (the single panel-visibility authority) ──
// Membership is always derived from pack data via RenderCore — no id literal.
function viewById(id) {
  return window.RenderCore.viewFor(DOMAIN.views, id);
}

function defaultView() {
  return window.RenderCore.viewFor(DOMAIN.views);
}

// Restore the session filter/sort at boot. Sort is validated against the known
// options; the category is validated lazily in renderViewToolbar against the
// resolved view's `sections` (a view without sections has no chips). Never
// throws when sessionStorage is unavailable.
function restoreFilters() {
  let category = "all";
  let sort = "freshest";
  try {
    const storedSort = sessionStorage.getItem(FILTER_SORT_KEY);
    if (SORT_OPTIONS.includes(storedSort)) sort = storedSort;
    const storedCategory = sessionStorage.getItem(FILTER_CATEGORY_KEY);
    if (storedCategory) category = storedCategory;
  } catch {
    /* storage disabled — fall back to the defaults */
  }
  state.filters = { category, sort };
}

function persistFilter(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage disabled — the choice still applies for this page */
  }
}

// One authority for panel visibility: membership (pack `viewPanels`) AND the
// active category. A non-source-card panel (health tile, aggregates) is chrome
// and survives every chip. Both a chip change and a view switch land here.
function applyVisibility() {
  if (!DOMAIN || !window.RenderCore) return;
  const view = viewById(state.view) ?? defaultView();
  if (!view) return;
  const members = new Set(
    window.RenderCore
      .viewPanels(DOMAIN.views, DOMAIN.panels, view.id)
      .map((panel) => panel.id),
  );
  const category = state.filters.category;
  document.querySelectorAll(".dashboard .panel").forEach((panel) => {
    const inCategory =
      category === "all" ||
      panel.dataset.section === category ||
      !panel.classList.contains("source-card");
    const visible = members.has(panel.dataset.panelId) && inCategory;
    panel.style.display = visible ? "" : "none";
  });

  // The main column's closing band takes the column's slack so it finishes
  // level with the rail. CSS cannot select "last visible", and the wrappers
  // hold every panel of every view, so the flag is set here.
  document
    .querySelectorAll(".view-col--main > .panel--closing")
    .forEach((panel) => panel.classList.remove("panel--closing"));
  const mainVisible = [
    ...document.querySelectorAll(".view-col--main > .panel"),
  ].filter((panel) => panel.style.display !== "none");
  mainVisible.at(-1)?.classList.add("panel--closing");
}

// Reorder the visible source cards with the pure helper via CSS `order`, so
// DOM order (and collapse/fade listeners) is never disturbed. Non-card panels
// keep their default order.
function applyCardOrder() {
  if (!DOMAIN || !window.RenderCore) return;
  const container = document.querySelector(".dashboard .view");
  if (!container) return;
  const cards = [...container.querySelectorAll(".panel.source-card")].filter(
    (panel) => panel.style.display !== "none",
  );
  const byId = new Map(DOMAIN.panels.map((panel) => [panel.id, panel]));
  const panels = cards
    .map((card) => byId.get(card.dataset.panelId))
    .filter(Boolean);
  const sources = data?.sweep?.sources || [];
  const ordered = window.RenderCore.sortSourceCards(
    panels,
    sources,
    state.filters.sort,
  );
  const index = new Map(ordered.map((panel, i) => [panel.id, i]));
  cards.forEach((card) => {
    card.style.order = index.has(card.dataset.panelId)
      ? index.get(card.dataset.panelId)
      : 0;
  });
}

// Build the in-view filter bar from the pack's `sections` (the only literal is
// "all"). A view without sections has no chips — hide the bar. Rendered even
// before the first sweep so the chips work against skeletons.
function renderViewToolbar(view) {
  const container = document.querySelector(".dashboard .view");
  if (!container) return;
  container.querySelector(".view-toolbar")?.remove();
  const sections = Array.isArray(view?.sections) ? view.sections : [];
  if (sections.length === 0) return;

  if (!sections.includes(state.filters.category)) state.filters.category = "all";
  const chips = ["all", ...view.sections]
    .map(
      (cat) =>
        `<button class="filter-chip${cat === state.filters.category ? " active" : ""}" data-cat="${esc(cat)}" type="button">${esc(cat)}</button>`,
    )
    .join("");
  const options = SORT_OPTIONS.map(
    (s) =>
      `<option value="${esc(s)}"${s === state.filters.sort ? " selected" : ""}>${esc(s)}</option>`,
  ).join("");

  // Design 3b closes the filter bar with the live health tally.
  const tally = window.RenderCore.healthTally(data?.sweep?.sources || []);
  const tallyText = [
    `${tally.healthy} healthy`,
    tally.slow ? `${tally.slow} slow` : "",
    tally.idle ? `${tally.idle} idle` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  container.insertAdjacentHTML(
    "afterbegin",
    `<div class="view-toolbar">${chips}<label class="sort">sort: <select id="streamSort">${options}</select></label><span class="health-tally" id="healthTally">${esc(tallyText)}</span></div>`,
  );

  const bar = container.querySelector(".view-toolbar");
  bar.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => setCategoryFilter(chip.dataset.cat));
  });
  bar.querySelector("#streamSort")?.addEventListener("change", (e) => {
    setStreamSort(e.target.value);
  });
}

function setCategoryFilter(cat) {
  state.filters.category = cat;
  persistFilter(FILTER_CATEGORY_KEY, cat);
  document.querySelectorAll(".view-toolbar .filter-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.cat === cat);
  });
  applyVisibility();
  // Recompute order for the newly visible subset: a sort chosen while another
  // category was active only ran applyCardOrder over that category, so the
  // cards revealed here would otherwise keep a stale order (filter/sort race).
  applyCardOrder();
}

function setStreamSort(sort) {
  state.filters.sort = SORT_OPTIONS.includes(sort) ? sort : "freshest";
  persistFilter(FILTER_SORT_KEY, state.filters.sort);
  applyCardOrder();
}

// Story 6.9: the header trigger and the palette input show the active view's
// pack-declared placeholder. `{n}` is the sweep-wide searchable item count
// (collectItems); a per-view count is deferred (open question 1). Generic:
// reads `view.searchPlaceholder`, never a view id literal.
function applySearchPlaceholder(view) {
  const template = view?.searchPlaceholder;
  if (!template) return;
  const RC = window.RenderCore;
  if (!RC?.collectItems) return;
  const n = RC.collectItems(data?.sweep?.sources ?? []).length;
  const text = template.replace("{n}", String(n));
  const label = document.getElementById("searchTriggerLabel");
  if (label) label.textContent = text;
  const input = document.getElementById("commandInput");
  if (input) input.placeholder = text;
}

function setView(id) {
  if (!DOMAIN || !window.RenderCore) return;
  const view = viewById(id) ?? defaultView();
  if (!view) return;
  state.view = view.id;
  applySearchPlaceholder(view);

  const container = document.querySelector(".dashboard .view");
  if (container) {
    container.dataset.view = view.id;
    container.dataset.layout = view.layout || "grid";
  }

  // The filter bar and visibility are recomputed together so a chip and a view
  // switch can never fight over the grid.
  renderViewToolbar(view);
  applyVisibility();
  applyCardOrder();

  document.querySelectorAll(".nav-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.view === view.id);
  });

  // Design 3c is the only screen whose header carries the archive pill; 3a/3b
  // keep the right side to search + theme + live. Keyed off the view's layout,
  // so it stays pack-driven (no view-id literal).
  const archiveLink = document.querySelector(".header-link");
  if (archiveLink) archiveLink.hidden = (view.layout || "grid") !== "reader";

  // The note is per-view: switching must hide/show it even before a render.
  syncBriefingNote();

  // After boot, switching swaps the visible panels without a page reload.
  if (data?.sweep) renderActiveView();
}

// Re-render only the active view's panels from the current `data`.
function renderActiveView() {
  if (!DOMAIN || !data?.sweep || !window.RenderCore) return;
  const RC = window.RenderCore;
  const sources = data.sweep.sources || [];
  const byCategory = RC.aggregateByCategory(sources);
  const view = RC.viewFor(DOMAIN.views, state.view);
  const opts =
    !data.analysis && Array.isArray(view?.fallbackPanels) ? { fallback: true } : {};
  for (const panel of RC.viewPanels(DOMAIN.views, DOMAIN.panels, state.view, opts)) {
    renderPanel(panel, sources, byCategory);
    markPanelLoaded(panelFrame(panel.id));
    // A badge earned earlier survives a view switch (pendingDelta is keyed by
    // panel id): the body re-renders, then its pill is re-attached, never
    // cleared here.
    if (pendingDelta.has(panel.id)) {
      renderDeltaBadge(panel, pendingDelta.get(panel.id));
    }
  }
  applyCardOrder();
  scheduleColumnFit();
}

// Trim the ranked continuation so the main column finishes level with the
// rail. The row count that fits depends on how many stories the model returned
// and how tall the rail's cards are, so it is measured rather than guessed: a
// fixed count overshoots on one day and leaves a hole on the next. Rows are
// hidden, never removed, so a later re-measure can bring them back.
// Run the column fit. Deliberately synchronous: getBoundingClientRect() forces
// the pending layout, so the freshly written panels measure correctly without
// waiting a frame. An earlier rAF version never ran at all in a background tab
// — Chrome does not service animation frames there — and its in-flight guard
// latched, so the fit stayed dead even after the tab came forward.
function scheduleColumnFit() {
  fitMoreHeadlines();
}

// Wired from init(), not module scope: the static export evaluates this file's
// module scope with no real window (tests/inject-static.test.mjs).
function initColumnFit() {
  document.fonts?.ready?.then(scheduleColumnFit).catch(() => {});
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(scheduleColumnFit, 150);
  });
}

function fitMoreHeadlines() {
  const main = document.querySelector(".view-col--main");
  const rail = document.querySelector(".view-col--rail");
  const list = document.querySelector(".more-list");
  if (!main || !rail || !list) return;
  const rows = [...list.children];
  if (!rows.length) return;

  // Content height, not box height: the grid stretches both columns to the
  // taller one and the closing band's auto margin fills any slack, so the
  // boxes always measure equal. Summing the visible children is the only
  // reading that reflects what is actually in each column.
  const contentHeight = (col) => {
    const kids = [...col.children].filter(
      (kid) => kid.style.display !== "none" && !kid.hidden,
    );
    if (!kids.length) return 0;
    const gap = parseFloat(getComputedStyle(col).rowGap) || 0;
    const total = kids.reduce(
      (sum, kid) => sum + kid.getBoundingClientRect().height,
      0,
    );
    return total + gap * (kids.length - 1);
  };

  // Start from the full list so the fit can grow back, not only shrink.
  for (const row of rows) row.hidden = false;

  let overshoot = contentHeight(main) - contentHeight(rail);
  for (let i = rows.length - 1; i >= 0 && overshoot > 0; i -= 1) {
    overshoot -= rows[i].getBoundingClientRect().height;
    rows[i].hidden = true;
  }

  // An empty list would leave its label dangling.
  list.previousElementSibling?.toggleAttribute(
    "hidden",
    rows.every((row) => row.hidden),
  );
}

// The frame a panel body belongs to, resolved by its emitted data-panel-id.
function panelFrame(panelId) {
  return document.querySelector(
    `.dashboard .panel[data-panel-id="${panelId}"]`,
  );
}

// A rendered panel leaves the skeleton state; other frames are untouched.
function markPanelLoaded(frame) {
  if (!frame) return;
  const wasLoading = frame.classList.contains("is-loading");
  frame.classList.remove("is-loading");
  frame.setAttribute("aria-busy", "false");
  // Arrival motion runs once, on the skeleton -> content transition. Leaving
  // it on a standing selector re-animated every child on every sweep, which
  // read as the whole card flashing about once a minute.
  if (!wasLoading) return;
  const body = frame.querySelector(".panel-body");
  if (!body) return;
  body.classList.add("panel-body--entering");
  setTimeout(() => body.classList.remove("panel-body--entering"), 400);
}

// Delta badge (Story 6.5): a numeric `+N new` pill in the panel header. It lives
// in `.panel-header`, never the body, so a later `renderPanel` (which replaces
// only the body) cannot remove it. The count is always a number — item text is
// never interpolated. Click/Enter/Space applies the update and clears the entry.
function renderDeltaBadge(panel, count) {
  const frame = panelFrame(panel.id);
  if (!frame) return;
  const header = frame.querySelector(".panel-header");
  if (!header) return;
  let badge = header.querySelector(".delta-badge");
  if (!badge) {
    badge = document.createElement("button");
    badge.type = "button";
    badge.className = "delta-badge";
    badge.dataset.panelId = panel.id;
    const anchor = header.querySelector(".panel-count, .digest-meta");
    if (anchor) anchor.insertAdjacentElement("afterend", badge);
    else header.appendChild(badge);
    badge.addEventListener("click", (event) => {
      // The header toggles collapse on click; activating the badge must apply
      // the pending update, not fold the panel.
      event.stopPropagation();
      pendingDelta.delete(panel.id);
      badge.remove();
      const sources = data?.sweep?.sources || [];
      renderPanel(
        panel,
        sources,
        window.RenderCore.aggregateByCategory(sources),
      );
    });
  }
  badge.textContent = `+${count} new`;
  // The visible text is a compact numeral; the accessible name spells out the
  // action so assistive tech does not read "+N new" out of context.
  badge.setAttribute("aria-label", `${count} new items — show`);
  // A badge is inserted into a panel body that is otherwise never re-rendered,
  // so without a live region its arrival is silent to assistive tech. The
  // visually-hidden polite announcer speaks it; focus is never moved (AC4).
  const announcer = document.getElementById("liveAnnouncer");
  if (announcer) {
    const where = panel.title || panel.id || "";
    announcer.textContent = where
      ? `${count} new items in ${where}`
      : `${count} new items`;
  }
}

// Per-source liveness drives pending→resolved skeletons: a panel bound (via
// `panel.sources`) to a source that reached a terminal state stops pulsing.
// A no-op before /api/domain lands, and for aggregate panels with no binding.
function resolvePanelSkeletons(steps) {
  const terminal = new Set(
    (steps || [])
      .filter((s) => s && s.kind === "source" && (s.state === "ok" || s.state === "error"))
      .map((s) => s.label),
  );
  document.querySelectorAll(".dashboard .panel.is-loading").forEach((frame) => {
    const panel = DOMAIN?.panels?.find((p) => p.id === frame.dataset.panelId);
    const bound = Array.isArray(panel?.sources) ? panel.sources : [];
    if (bound.some((name) => terminal.has(name))) {
      frame.dataset.resolved = "true";
      frame.setAttribute("aria-busy", "false");
    }
  });
}

// ── Main Render ──
// The single door for sweep data. Sets `data`, refreshes the status line,
// metrics, ticker, footer, briefing and source-health, renders the active
// view's panel bodies, then drops the skeleton state on those frames only.
// Returns true when it rendered, false when data/DOMAIN are absent.
function applyData(nextData) {
  if (!nextData?.sweep) return false;
  const d = nextData;
  // Keep the captured sweep even before /api/domain lands: init() replays it
  // once the chrome exists, so an early SSE update is never lost.
  data = d;
  if (!DOMAIN) return false;
  const sweep = d.sweep;
  const sources = sweep.sources || [];
  const RC = window.RenderCore;
  const byCategory = RC.aggregateByCategory(sources);

  // status line (6.4): state.sse/lastEventAge drive the pill; the count comes
  // from the same shared summary as the source-health tile (cannot diverge).
  state.lastSweepAt = sweep.timestamp ?? state.lastSweepAt;
  renderLivePill();
  // Refresh the stats dialog in place when it is open — a sweep landing while
  // the reader has it open should not show stale counts.
  if (
    document.getElementById("statsDialog")?.classList.contains("open")
  )
    renderStatsDialog();
  const footerSrc = document.getElementById("footerSources");
  if (footerSrc) footerSrc.textContent = `${sweep.sourcesTotal} sources`;

  renderTicker(sources);
  // Pack data declares the fallback panels; runtime state decides when to use
  // them. A view without fallbackPanels must not be blanked by the no-LLM gate.
  const view = RC.viewFor(DOMAIN.views, state.view);
  applySearchPlaceholder(view);
  const opts =
    !data.analysis && Array.isArray(view?.fallbackPanels) ? { fallback: true } : {};
  const panels = RC.viewPanels(DOMAIN.views, DOMAIN.panels, state.view, opts);
  const delta = nextData.delta;
  // First paint (or a first sweep) renders every panel fully with no badge. A
  // later update never re-sorts a visible list: it records the arrival count and
  // shows a header pill, leaving every rendered body untouched.
  const isFirst = !hasRendered || !delta || delta.isFirst === true;
  if (isFirst) {
    pendingDelta.clear();
    document.querySelectorAll(".delta-badge").forEach((badge) => badge.remove());
    for (const panel of panels) {
      renderPanel(panel, sources, byCategory);
      markPanelLoaded(panelFrame(panel.id));
    }
    hasRendered = true;
  } else {
    for (const panel of panels) {
      const n = RC.panelDeltaCount(panel, delta.newItems);
      if (n > 0) {
        pendingDelta.set(panel.id, n);
        renderDeltaBadge(panel, n);
        continue; // badge only — never re-render the body mid-read
      }
      // no arrivals for this panel: leave its rendered body untouched
    }
  }
  renderBriefing(d.analysis, d);
  renderSourceHealth();
  // Keep the filter bar, visibility and order in step with the freshly
  // rendered panels (the toolbar works even before the first sweep).
  renderViewToolbar(view);
  applyVisibility();
  applyCardOrder();
  scheduleColumnFit();
  return true;
}

// Write text only when it actually changed. Assigning identical `textContent`
// still replaces the child text node, which is a mutation inside a polite live
// region and can make a screen reader re-announce unchanged status (Story 6.8:
// the pill fires every second and must not speak each tick).
function setTextIfChanged(el, value) {
  if (el && el.textContent !== value) el.textContent = value;
}

// ── Live pill (header, design 3a item 1 / §5 SSE states) ──
// state.sse/lastEventAge are the only inputs; the count is read from the same
// `sourceHealthSummary` as the source-health tile, so the two cannot diverge.
// `{n}s` is the age since the last stream event, not the sweep age.
function renderLivePill() {
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  const counts = document.getElementById("sourceCountText");
  const h = window.RenderCore.sourceHealthSummary(
    data?.sweep?.sources,
    state.sweepProgress,
  );
  if (dot) dot.dataset.state = state.sse; // connected | reconnecting | offline
  if (text)
    setTextIfChanged(
      text,
      state.sse === "connected"
        ? "live"
        : state.sse === "reconnecting"
          ? "reconnecting…"
          : "offline · showing cached",
    );
  if (counts) setTextIfChanged(counts, `${h.ok}/${h.total}`);
}

// ── Intelligence stats dialog (the live pill is the trigger) ──
// The pack's `stats` (counts + sub-lines) and the sweep freshness live here
// rather than in a standing chrome strip. Pure computation is RenderCore's
// (`statValue`, `sourceCountsFor`, `freshness`); this only paints.
function renderStatsDialog() {
  const body = document.getElementById("statsBody");
  if (!body) return;
  const RC = window.RenderCore;
  if (!DOMAIN || !data?.sweep) {
    body.innerHTML =
      '<div class="stats-empty">waiting for the first sweep…</div>';
    return;
  }
  const sources = data.sweep.sources || [];
  const byCategory = RC.aggregateByCategory(sources);
  let html = "";
  for (const stat of DOMAIN.stats ?? []) {
    const { value, sub } = RC.statValue(stat, byCategory);
    html += `<div class="stats-row">
      <span class="stats-label">${esc(stat.label)}</span>
      <span class="stats-figure"><span class="stats-value">${esc(String(value))}</span><span class="stats-sub">${esc(sub)}</span></span>
    </div>`;
    if (stat.chart) {
      const bars = RC.sourceCountsFor(stat, sources);
      if (bars.length) {
        const max = bars[0].count || 1;
        html += `<div class="stats-bars">${bars
          .map(
            (b, i) =>
              `<span class="stats-bar${i < 3 ? "" : " dim"}" style="height:${Math.max(4, Math.round((b.count / max) * 18))}px" title="${esc(b.source)}: ${b.count}"></span>`,
          )
          .join("")}</div>`;
      }
    }
  }
  const fresh = RC.freshness(sources);
  html += `<div class="stats-row">
    <span class="stats-label">freshness</span>
    <span class="stats-figure"><span class="stats-value">${esc(fresh.text)}</span><span class="stats-sub">${esc(fresh.label)}</span></span>
  </div>`;
  body.innerHTML = html;
}

function initStatsDialog() {
  const trigger = document.getElementById("statsTrigger");
  const popover = document.getElementById("statsDialog");
  const closeBtn = document.getElementById("statsClose");
  if (!trigger || !popover) return;
  const isOpen = () => popover.classList.contains("open");
  const open = () => {
    renderStatsDialog();
    popover.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
  };
  const close = () => {
    popover.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
  };
  trigger.addEventListener("click", () => (isOpen() ? close() : open()));
  closeBtn?.addEventListener("click", close);
  // Non-modal: Esc and a click outside dismiss it, but nothing is trapped and
  // the page behind stays readable and interactive.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });
  document.addEventListener("click", (e) => {
    if (!isOpen()) return;
    if (popover.contains(e.target) || trigger.contains(e.target)) return;
    close();
  });
}

// ── Periodic refresh of time-dependent UI ──
setInterval(() => {
  if (!data?.sweep || !DOMAIN) return;
  // The pill reads `live · {k}/{n}` — no event-age seconds — so this tick only
  // refreshes the metrics strip.
}, 30000);

// 1Hz liveness tick: advance the event age only while the stream is live, then
// recompute the tile and the pill. Offline/reconnecting freezes the age.
setInterval(() => {
  if (state.sse === "connected") state.lastEventAge += 1000;
  renderSourceHealth();
  renderLivePill();
}, 1000);

// ── Ticker ──
// Keys (escaped url, the DOM identity) and signatures (url · title · source,
// the content identity) of the items currently in the marquee, in order.
// Module-scoped so an unchanged sweep can short-circuit without touching the
// DOM: the CSS animation on .ticker-inner keeps running and its scroll position
// is preserved across applyData calls. The signature matters because a live
// feed can edit a headline while keeping the permalink, so diffing on url alone
// would leave a stale title on screen.
let tickerKeys = [];
let tickerSignatures = [];

// One `source · title` pair. `data-key` (the escaped url) is the stable diff
// identity; the second marquee run is cloned from these nodes so
// translateX(-50%) stays seamless.
function tickerItemInner(item) {
  return (
    `<span class="ticker-src">${esc(item.source)}</span>` +
    `<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>`
  );
}

function tickerItemNode(item) {
  const node = document.createElement("span");
  node.className = "ticker-item";
  node.setAttribute("data-key", esc(item.url));
  node.innerHTML = tickerItemInner(item);
  return node;
}

// Reconcile #ticker with nextItems, reusing unchanged nodes, creating added
// ones and dropping removed ones. Reused nodes get their content refreshed so a
// same-url/edited-title item still updates. It never re-sets #ticker's
// className nor replaces its innerHTML wholesale, so the CSS animation is never
// reset mid-loop. Returns true only when the DOM changed.
function updateTickerInPlace(nextItems) {
  const track = document.getElementById("ticker");
  if (!track) return false;
  const nextKeys = nextItems.map((i) => esc(i.url));
  const nextSignatures = nextItems.map(
    (i) => `${esc(i.url)}\u0000${esc(i.title)}\u0000${esc(i.source)}`,
  );
  const sameOrder =
    nextKeys.length === tickerKeys.length &&
    nextKeys.every((key, i) => key === tickerKeys[i]);
  const sameContent =
    nextSignatures.length === tickerSignatures.length &&
    nextSignatures.every((sig, i) => sig === tickerSignatures[i]);
  if (sameOrder && sameContent) return false; // no-op: scroll position untouched

  const reusable = new Map(
    [...track.querySelectorAll('.ticker-item[data-run="a"]')].map((node) => [
      node.dataset.key,
      node,
    ]),
  );
  const runA = nextItems.map((item, i) => {
    const key = nextKeys[i];
    const reused = reusable.get(key);
    if (reused) {
      reusable.delete(key); // removed keys are whatever is left behind
      reused.dataset.run = "a";
      reused.innerHTML = tickerItemInner(item); // refresh edited title/source
      return reused;
    }
    const node = tickerItemNode(item);
    node.dataset.run = "a";
    return node;
  });
  // The nodes left in `reusable` were removed; not re-appending them drops them.
  const runB = runA.map((node) => {
    const clone = node.cloneNode(true);
    clone.dataset.run = "b";
    clone.setAttribute("aria-hidden", "true");
    return clone;
  });
  track.replaceChildren(...runA, ...runB);
  tickerKeys = nextKeys;
  tickerSignatures = nextSignatures;
  syncTickerSpeed(track);
  return true;
}

// Reading speed for the marquee, in px/s. The keyframe travels -50% (one of
// the two identical runs), so a fixed duration would make a busy sweep scroll
// faster than a quiet one. Deriving the duration from the measured width keeps
// the speed constant and legible however many items are in the track.
const TICKER_PX_PER_SEC = 45;

function syncTickerSpeed(track) {
  if (!track) return;
  const runWidth = track.scrollWidth / 2;
  if (!runWidth || !Number.isFinite(runWidth)) return;
  const seconds = Math.max(20, Math.round(runWidth / TICKER_PX_PER_SEC));
  track.style.setProperty("--ticker-duration", `${seconds}s`);
}

// Ticker size is capped for two reasons: 5 items from every source built a
// ~52,000px track (90 nodes) that the compositor animates continuously, and at
// a readable speed that is a ~10 minute loop nobody sees the end of. Two per
// source, 14 total, keeps the strip lively and the layer small.
const TICKER_PER_SOURCE = 2;
const TICKER_MAX_ITEMS = 14;

function renderTicker(sources) {
  const items = [];
  for (const s of sources) {
    if (s.status !== "ok") continue;
    const srcItems = s.data?.items || [];
    for (const item of srcItems.slice(0, TICKER_PER_SOURCE)) {
      if (item.title) {
        items.push({
          title: item.title,
          source: s.source,
          url: item.permalink || item.url || "#",
        });
      }
    }
  }
  updateTickerInPlace(items.slice(0, TICKER_MAX_ITEMS));
}

// ── Panels (variant-dispatched, field-driven) ──
function newsItemHtml(i) {
  const chipLabel = i.subreddit ? `r/${i.subreddit}` : i._source;
  const author = i.author || i.creator;
  const time = timeAgo(i._time);
  // Generic RSS feeds emit "title source" as the description — showing it
  // duplicates the headline. Drop descriptions that restate the title.
  const title = (i.title || i.name || "").replace(/\s+/g, " ").trim();
  const desc = (i.description || "").replace(/\s+/g, " ").trim();
  const showDesc = desc && !desc.toLowerCase().startsWith(title.toLowerCase().slice(0, 24));
  return `
    <div class="news-item">
      <div class="news-title"><a href="${esc(i._url)}" target="_blank" rel="noopener">${esc(title)}</a></div>
      <div class="news-meta">
        <span class="news-source">${esc(chipLabel)}</span>
        ${i._score ? `<span class="news-score">▲ ${formatNum(i._score)}</span>` : ""}
        ${i._comments ? `<span>↳ ${formatNum(i._comments)}</span>` : ""}
        ${i.flair ? `<span class="news-flair">${esc(i.flair)}</span>` : ""}
        ${author ? `<span>${esc(author)}</span>` : ""}
        ${time ? `<span>${time}</span>` : ""}
      </div>
      ${showDesc ? `<div class="news-meta" style="opacity:0.7">${esc(desc)}</div>` : ""}
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

// One uniform source card (design 3b): header status dot + mono name +
// `count · last-fetch age`, then at most CARD_ITEM_ROWS item rows. The count is
// the panel's true total (the row cap is display-only) and the empty state is
// never a bare card. Generic: dispatches on variant, never on a source/view id.
function renderSourceCard(panel, sources, byCategory) {
  const stats = window.RenderCore.sourceCardStats(panel, sources);
  const age = timeAgo(stats.lastFetch || data?.sweep?.timestamp);

  const countEl = document.getElementById(`count-${panel.id}`);
  if (countEl) {
    countEl.textContent = `${stats.count} · ${age}`;
    countEl.classList.toggle("slow", stats.status === "slow");
  }

  // The dot is injected once per frame; data-status drives its colour and lives
  // on the frame the card CSS selects (`.panel[data-status] .src-dot`).
  const frame = document.getElementById(`panel-${panel.id}`);
  if (frame) {
    frame.dataset.status = stats.status;
    const header = frame.querySelector(".panel-header");
    if (header && !header.querySelector(".src-dot")) {
      header.insertAdjacentHTML(
        "afterbegin",
        '<span class="src-dot" aria-hidden="true"></span>',
      );
    }
  }

  const bodyEl = document.getElementById(`body-${panel.id}`);
  if (!bodyEl) return;

  if (stats.count === 0) {
    bodyEl.innerHTML = `<div class="panel-empty">no items in the last 24h · last ok ${timeAgo(data?.sweep?.timestamp)}</div>`;
    bodyEl.classList.remove("panel-body--scroll");
    return;
  }

  // Cards cap the displayed rows at their pack `limit` (Story 4.1), so the
  // scroll count is the rendered count — never the panel's raw item set.
  const rows = window.RenderCore.selectPanelItems(panel, sources, byCategory)
    .slice(0, panel.limit || CARD_ITEM_ROWS);
  bodyEl.innerHTML = rows
    .map((i) => (panel.variant === "cards" ? cardHtmlFor(i) : newsItemHtml(i)))
    .join("");
  const renderedCount = rows.length;
  bodyEl.classList.toggle("panel-body--scroll", renderedCount >= 6);
}

// Source-health tile (design 3b): the panel is pack-declared via the
// "source-health" variant and resolved generically. The shared summary feeds
// both the tile and the header live pill, so their {k}/{total} cannot diverge.
// The mock drew four name/status rows because its tile was short. The real
// tile stretches to its grid row, so it lists every source it knows about —
// that is the whole point of the "11/12" being legible at a glance.

function sourceHealthPanel() {
  return (
    (DOMAIN?.panels || []).find((p) => p.variant === "source-health") || null
  );
}

function renderSourceHealth(panel) {
  const p = panel || sourceHealthPanel();
  if (!p || !window.RenderCore) return;
  const s = window.RenderCore.sourceHealthSummary(
    data?.sweep?.sources,
    state.sweepProgress,
  );

  const count = `${s.ok}/${s.total}`;
  const pill = document.getElementById("sourceCountText");
  if (pill) pill.textContent = count;
  const countEl = document.getElementById("count-" + p.id);
  if (countEl) countEl.textContent = count;

  const bodyEl = document.getElementById("body-" + p.id);
  if (!bodyEl) return;

  const rows = s.rows
    .map(
      (r) =>
        `<div class="health-row" data-state="${esc(r.status)}"><span class="src-dot" aria-hidden="true"></span><span class="health-name">${esc(r.name)}</span><span class="health-status">${esc(r.status)}</span></div>`,
    )
    .join("");
  const cells = s.cells
    .map(
      (c) => `<span class="health-cell" data-state="${esc(c.status)}"></span>`,
    )
    .join("");

  let nextLabel;
  if (s.sweeping) {
    const done = s.cells.filter((c) => c.status !== "running").length;
    nextLabel = `sweeping… ${done}/${s.total}`;
  } else {
    // Pure helper (unit-tested) so the countdown formula has one home.
    const n = window.RenderCore.nextSweepSeconds(
      state.lastSweepAt,
      state.cooldownMs,
      Date.now(),
    );
    nextLabel = `next sweep ${n}s`;
  }

  bodyEl.innerHTML =
    `<div class="health-rows">${rows}</div>` +
    `<div class="health-cells">${cells}</div>` +
    `<div class="health-next">${nextLabel}</div>`;
}

function renderPanel(panel, sources, byCategory) {
  if (panel.variant === "source-health") {
    renderSourceHealth(panel);
    return;
  }
  if (panel.variant === "briefing" || panel.variant === "radar") return; // LLM-driven
  if (panel.variant === "digest") return; // digest flow owns its body
  if (panel.variant === "edition") {
    renderDailyEdition(panel);
    return;
  }
  if (panel.variant === "edition-card") {
    renderEditionCard(panel);
    return;
  }
  if (panel.variant === "archive") {
    renderArchive(panel);
    return;
  }
  if (panel.variant === "sources-preview") {
    renderSourcesPreview(panel, sources);
    return;
  }
  if (panel.variant === "news" || panel.variant === "cards") {
    renderSourceCard(panel, sources, byCategory);
    return;
  }

  const RC = window.RenderCore;
  const items =
    panel.variant === "aggregate"
      ? RC.aggregateItems(panel, byCategory)
      : RC.selectPanelItems(panel, sources, byCategory);

  const countEl = document.getElementById(`count-${panel.id}`);
  if (countEl) countEl.textContent = items.length;
  const bodyEl = document.getElementById(`body-${panel.id}`);
  if (!bodyEl) return;

  // An aggregate panel with no rankable rows must say so: the no-LLM fallback
  // categories can all be excluded or carry no engagement/date, and a blank
  // column would read as broken. Other variants keep their own empty states.
  if (panel.variant === "aggregate" && items.length === 0) {
    bodyEl.innerHTML = '<div class="panel-empty">no ranked items yet</div>';
    bodyEl.classList.remove("panel-body--scroll");
    return;
  }

  bodyEl.innerHTML = items
    .map((i) => (panel.variant === "cards" ? cardHtmlFor(i) : newsItemHtml(i)))
    .join("");
  const renderedCount = items.length;
  bodyEl.classList.toggle("panel-body--scroll", renderedCount >= 6);
}

// ── Briefing (the landing view's LLM band) ──
function buildBriefingHtml(analysis, d) {
  let html = "";

  const dateIso = d?.generatedAt ?? d?.sweep?.timestamp;
  const dateLabel = dateIso
    ? new Date(dateIso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })
    : "";
  const byline = analysis.model || analysis.provider;
  html += `<div class="briefing-head">
    <span class="briefing-label">briefing · ${esc(dateLabel)}</span>
    ${byline ? `<span class="briefing-by">summarized by ${esc(byline)}</span>` : ""}
  </div>`;

  // A deck, not a briefing: one short sentence above the headline list. The
  // pack prompt caps it at ~20 words; the CSS clamp is the guard for a model
  // that ignores the cap.
  if (analysis.summary) {
    html += `<div class="analysis-summary">${esc(analysis.summary)}</div>`;
  }

  const trends = analysis.trends?.slice(0, 3) ?? [];
  if (trends.length) {
    html += `<div class="section-label">emerging trends</div>`;
    for (const t of trends) {
      html += `<div class="trend-item"><span class="trend-dot"></span><span class="trend-text">${esc(t)}</span></div>`;
    }
  }

  const briefingPanel = (DOMAIN?.panels || []).find(
    (p) => p.variant === "briefing",
  );
  const usedUrls = [];

  if (analysis.topStories?.length) {
    html += `<div class="section-label">top stories</div>`;
    // Provenance for the right-hand column is recovered from the sweep by url
    // (design 3a); the model itself reports no source, age or score.
    const sweepItems = window.RenderCore.collectItems(d?.sweep?.sources || []);
    const stories = analysis.topStories.slice(
      0,
      panelLimitFor("briefing", Infinity),
    );
    stories.forEach((s, index) => {
      const rankClass =
        index >= 3 ? "story-rank story-rank--dim" : "story-rank";
      const headlineText = esc(s.headline);
      const headline = s.url
        ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${headlineText}</a>`
        : headlineText;
      let chips = `<span class="chip chip-category">${esc(s.category)}</span>`;
      if (s.impact === "high") {
        chips += `<span class="chip chip-impact">high impact</span>`;
      }
      if (s.category === "rumor") {
        chips += `<span class="chip chip-rumor">rumor</span>`;
      }
      if (s.url) usedUrls.push(s.url);
      const meta = window.RenderCore.storyMeta(s, sweepItems);
      const metaHtml = meta
        ? `<div class="story-meta">${esc([meta.source, meta.age].filter(Boolean).join(" · "))}${
            meta.score
              ? `<br />▲ ${esc(window.RenderCore.formatNum(meta.score))}`
              : ""
          }</div>`
        : `<div class="story-meta"></div>`;
      html += `<div class="story-row">
        <div class="${rankClass}">${index + 1}</div>
        <div class="story-main">
          <div class="story-headline">${headline}</div>
          <div class="story-why">${esc(s.significance)}</div>
          <div class="story-chips">${chips}</div>
        </div>
        ${metaHtml}
      </div>`;
    });
  }

  // Top the list up from the ranked feed: the model's picks carry the context,
  // these carry the volume, so a quiet generation still fills the column.
  const more = window.RenderCore.moreHeadlines(
    briefingPanel ?? {},
    d?.byCategory ?? window.RenderCore.aggregateByCategory(d?.sweep?.sources || []),
    usedUrls,
    briefingPanel?.more ?? 0,
  );
  if (more.length) {
    html += `<div class="section-label">${esc(briefingPanel?.moreLabel || "more")}</div>`;
    html += `<div class="more-list">`;
    for (const item of more) {
      const title = esc(item.title || item.name || item.id || "");
      const link = item._url
        ? `<a href="${esc(item._url)}" target="_blank" rel="noopener">${title}</a>`
        : title;
      const age = timeAgo(item._time);
      html += `<div class="more-row">
        <span class="more-title">${link}</span>
        <span class="more-meta">${esc(item._source)}${age ? ` \u00b7 ${age}` : ""}</span>
      </div>`;
    }
    html += `</div>`;
  }
  return html;
}

// Confidence classes are a fixed whitelist: an arbitrary LLM-supplied value
// must never become a CSS class (or a styled label).
const SIGNAL_CONFIDENCE_LEVELS = ["high", "medium", "low"];

// Token bindings per radar status. The colours live here as the documented
// contract, but the row/tag styling is applied via [data-status] CSS rules so
// theme swaps stay in the token layer (no inline style).
const RADAR_STATUS_META = {
  released: {
    dot: "var(--green)",
    bg: "var(--green-tint)",
    fg: "var(--green-ink)",
    label: "RELEASED",
  },
  announced: {
    dot: "var(--amber-dot)",
    bg: "var(--amber-tint)",
    fg: "var(--amber-ink)",
    label: "ANNOUNCED",
  },
  rumored: {
    dot: "var(--amber-dot)",
    bg: "var(--inset)",
    fg: "var(--ink-4)",
    label: "RUMORED",
  },
  "in-development": {
    dot: "var(--green-soft)",
    bg: "var(--green-tint-2)",
    fg: "var(--green-ink)",
    label: "IN DEV",
  },
};

function buildRadarHtml(analysis) {
  let html = "";
  const radarCount = document.getElementById("radarCount");
  if (radarCount) {
    const tracked = analysis.modelRadar?.length || 0;
    radarCount.textContent = tracked ? `${tracked} tracked` : "";
  }
  const radarEntries = (analysis.modelRadar || []).slice(
    0,
    panelLimitFor("radar", Infinity),
  );
  if (radarEntries.length) {
    for (const m of radarEntries) {
      if (!m || typeof m !== "object") continue;
      // Own-key guard: a prototype key ("toString", "constructor", …) is truthy
      // on the map literal but carries no `label`, which would defeat the
      // safe fallback and render an undefined tag from untrusted LLM output.
      const status = Object.prototype.hasOwnProperty.call(
        RADAR_STATUS_META,
        m.status,
      )
        ? m.status
        : "in-development";
      const meta = RADAR_STATUS_META[status];
      const nameText = esc(m.name);
      const nameHtml = m.url
        ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${nameText}</a>`
        : nameText;
      html += `<div class="radar-row" data-status="${esc(status)}">
        <span class="radar-dot"></span>
        <div class="radar-info">
          <div class="radar-name">${nameHtml}</div>
          <div class="radar-org">${esc(m.org)}</div>
          ${m.note ? `<div class="radar-note">${esc(m.note)}</div>` : ""}
        </div>
        <span class="radar-tag">${meta.label}</span>
      </div>`;
    }
  }

  return html;
}

function buildSignalsHtml(analysis) {
  let html = "";
  const signalEntries = (analysis.signals || []).slice(
    0,
    panelLimitFor("signals", Infinity),
  );
  if (signalEntries.length) {
    for (const s of signalEntries) {
      if (!s || typeof s !== "object") continue;
      const conf = SIGNAL_CONFIDENCE_LEVELS.includes(s.confidence)
        ? s.confidence
        : "low";
      const statementText = esc(s.signal);
      const statement = s.url
        ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${statementText}</a>`
        : statementText;
      html += `<div class="signal-item">
        <div class="signal-statement">${statement}</div>
        <div class="signal-meta">
          <span class="signal-source">${esc(s.source)}</span>
          ·
          <span class="signal-confidence ${conf}">${esc(conf)}</span>
        </div>
      </div>`;
    }
  }
  return html;
}

// The quiet, pack-declared note shown on the fallback path (no LLM). It is a
// single element in the view, so it renders exactly once; the pack owns the
// copy, this only decides when it is visible.
function syncBriefingNote() {
  const note = document.getElementById("briefingNote");
  if (!note || !DOMAIN || !window.RenderCore) return;
  const view = window.RenderCore.viewFor(DOMAIN.views, state.view);
  const show = Boolean(view?.noBriefingNote) && !data?.analysis;
  note.hidden = !show;
  if (show) note.textContent = view.noBriefingNote;
}

function renderBriefing(analysis, d) {
  const briefPanel = document.getElementById("analysisPanel");
  const radarPanel = document.getElementById("radarPanel");
  const signalsPanel = document.getElementById("signalsPanel");
  if (!briefPanel || !radarPanel) return;

  const briefBody = document.getElementById("analysisBody");
  const radarBody = document.getElementById("radarBody");
  const signalsBody = document.getElementById("signalsBody");
  const provider = document.getElementById("analysisProvider");
  const radarCount = document.getElementById("radarCount");

  // No LLM layer: take the briefing frame away so we never show an empty card
  // (AC3). `.panel-absent` is the single, reversible removal mechanism —
  // visibility stays owned by setView, never forced display.
  briefPanel.classList.toggle("panel-absent", !analysis);

  if (!analysis) {
    // The content-driven radar frame is absent too; clear both bodies and sync
    // the quiet fallback note. The fallback panel selection lives in the
    // panel loops (render/renderActiveView).
    radarPanel.classList.toggle("panel-absent", true);
    signalsPanel?.classList.toggle("panel-absent", true);
    if (briefBody) briefBody.innerHTML = "";
    if (radarBody) radarBody.innerHTML = "";
    if (signalsBody) signalsBody.innerHTML = "";
    if (provider) provider.textContent = "";
    if (radarCount) radarCount.textContent = "";
    syncBriefingNote();
    return;
  }

  // The radar frame is content-driven: it stays absent until it has at least
  // one radar entry or signal, and comes back when entries return.
  radarPanel.classList.toggle("panel-absent", !analysis?.modelRadar?.length);
  signalsPanel?.classList.toggle("panel-absent", !analysis?.signals?.length);

  if (briefBody) briefBody.innerHTML = buildBriefingHtml(analysis, d);
  if (radarBody) radarBody.innerHTML = buildRadarHtml(analysis);
  if (signalsBody) signalsBody.innerHTML = buildSignalsHtml(analysis);
  if (provider) provider.textContent = analysis.model || analysis.provider || "";
  syncBriefingNote();
}

// ── Weekly Digest ──
let lastDigest = null;
let lastEdition = null;
// Stored day ids from /api/health (newest-first), the archive's daily rows.
let lastEditionIds = [];

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


// The digest panel's pack entry, resolved by variant at call time (never a
// panel-id literal): its `weeklyRun` is the card label's schedule text.
function digestPanel() {
  return (DOMAIN?.panels || []).find((p) => p.variant === "digest") || null;
}

// The once-per-week guard is a state, not an error: this persistent note shows
// whenever the rendered digest belongs to the current ISO week. Distinct from
// the transient `.digest-notice` a failure prepends.
function digestGuardNote() {
  if (
    lastDigest?.weekId &&
    state.currentWeekId &&
    lastDigest.weekId === state.currentWeekId
  ) {
    return `<div class="digest-notice">already generated this week</div>`;
  }
  return "";
}

function renderDigest(digest) {
  lastDigest = digest;
  const panel = document.getElementById("digestPanel");
  const body = document.getElementById("digestBody");
  const meta = document.getElementById("digestMeta");
  if (!digest || !panel || !body || !meta) return;

  const runLabel = digestPanel()?.weeklyRun || "";
  const weekNo = window.RenderCore.weekNumberOf(digest.weekId);

  // Visibility is owned by setView, so never force display here: the digest
  // panel appears only while its owning view is active.
  meta.textContent = digest.weekId
    ? `week ${weekNo} · ${runLabel}${digest.generatedAt ? ` · generated ${timeAgo(digest.generatedAt)}` : ""}`
    : "";

  let html = digestGuardNote();
  if (digest.tldr) {
    html += `<div class="digest-tldr">${esc(digest.tldr)}</div>`;
  }
  html += `<div class="digest-actions">
    <a class="digest-link" href="/digest">read the full digest \u2192</a>
    <button class="digest-generate-btn" id="digestRegenBtn">regenerate</button>
  </div>`;

  body.innerHTML = html;
  // One source of truth for the condensed-item count: the same pure helper the
  // archive's weekly row uses (Story 5.3), so the two cards can never drift.
  const renderedCount = window.RenderCore.digestSignalCount(digest);
  body.classList.toggle("panel-body--scroll", renderedCount >= 6);
  document
    .getElementById("digestRegenBtn")
    ?.addEventListener("click", function () {
      triggerDigestGeneration(this);
    });

}

async function triggerDigestGeneration(btn) {
  const body = document.getElementById("digestBody");
  if (btn) btn.disabled = true;

  // Show loading animation
  body.innerHTML = `<div class="digest-loading">
    <div class="digest-spinner"></div>
    <div class="digest-loading-text">Fetching 7 days of intelligence across ${data?.sweep?.sourcesTotal || "all"} sources…</div>
  </div>`;
  body.classList.remove("panel-body--scroll");

  function showError(msg) {
    // A failure must never clear existing content: restore the last digest
    // first, then prepend the transient, auto-removing notice.
    if (lastDigest) {
      renderDigest(lastDigest);
    } else {
      body.innerHTML = "";
      body.classList.remove("panel-body--scroll");
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
      const payload = await res.json().catch(() => ({}));
      if (payload.existing) {
        // Once-per-week state, not an error: re-render the existing digest so
        // the persistent `already generated this week` note shows.
        renderDigest({ ...lastDigest, ...payload.existing });
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

// ── Edition card (rail) ──
// The panel is pack-declared (variant "edition-card"); its body is resolved by
// panel id at call time so the card renders both from the panel loop and when
// data arrives after the sweep. Only the pack's target/labels are read — no
// view id or panel id literal lives here.
function panelLimitFor(variant, fallback) {
  const panel = (DOMAIN?.panels || []).find((p) => p.variant === variant);
  return panel?.limit ?? fallback;
}

function editionPanel() {
  return (DOMAIN?.panels || []).find((p) => p.variant === "edition-card") || null;
}

function renderEditionCard(panel) {
  const p = panel || editionPanel();
  if (!p) return;
  const body = document.getElementById("body-" + p.id);
  if (!body) return;

  const { daily, weekly } = window.RenderCore.editionCardModel(
    lastDigest,
    lastEdition,
  );

  let html = `<div class="edition-card">`;
  if (daily) {
    html += `<div class="edition-row">
      <span class="edition-lines">
        <span class="edition-title">${esc(p.dailyTitle || "")}</span>
        <span class="edition-when">sent 07:00 · edition ${esc(daily.id)}</span>
      </span>
      <button class="edition-btn" type="button">${esc(p.actionLabel || "read")}</button>
    </div>`;
  } else {
    html += `<div class="edition-row edition-row--empty">
      <span class="edition-lines">
        <span class="edition-title">${esc(p.dailyTitle || "")}</span>
        <span class="edition-when">${esc(p.emptyLabel || "no edition yet")}</span>
      </span>
    </div>`;
  }
  html += `<div class="edition-row edition-row--weekly">
    <span class="edition-lines">
      <span class="edition-title">${esc(p.weeklyTitle || "")}</span>
      <span class="edition-when">${esc(p.weeklyRun || "")}</span>
    </span>
    <span class="edition-state">${weekly ? "generated" : "next run"}</span>
  </div>`;
  html += `</div>`;
  body.innerHTML = html;

  // Design 3a puts `archive →` on the right of the card's label row; the
  // header's count slot carries it, as on the sources-preview panel.
  const linkEl = document.getElementById("count-" + p.id);
  if (linkEl && p.linkLabel) {
    linkEl.textContent = p.linkLabel;
    if (!linkEl.dataset.bound) {
      linkEl.dataset.bound = "1";
      linkEl.classList.add("view-link");
      linkEl.addEventListener("click", (e) => {
        e.stopPropagation();
        setView(p.target);
      });
    }
  }
  const renderedCount = body.querySelectorAll(".edition-row").length;
  body.classList.toggle("panel-body--scroll", renderedCount >= 6);

  if (daily) {
    body
      .querySelector(".edition-btn")
      ?.addEventListener("click", () => setView(p.target));
  }
}

// ── Daily edition reader (main column) ──
// Pack-declared variant "edition": resolves the panel by variant at call time
// (mirrors editionPanel), never by a panel-id literal, so the reader renders
// both from the panel loop and when the latest edition arrives after the sweep.
function dailyEditionPanel() {
  return (DOMAIN?.panels || []).find((p) => p.variant === "edition") || null;
}

function renderDailyEdition(panel) {
  const p = panel || dailyEditionPanel();
  if (!p) return;
  const body = document.getElementById("body-" + p.id);
  if (!body) return;

  const m = window.RenderCore.editionReaderModel(lastEdition);
  if (!m.present) {
    // A 404 latest means no earlier edition is stored, so an archive link
    // would be dead: show only the honest generation hint.
    body.innerHTML = `<div class="panel-empty">no edition yet · generated automatically each morning (07:00 cest)</div>`;
    body.classList.remove("panel-body--scroll");
    return;
  }

  const stories = m.stories
    .map((s, i) => {
      const chips = [];
      if (s.category)
        chips.push(
          `<span class="chip chip-category">${esc(s.category)}</span>`,
        );
      if (s.impact)
        chips.push(`<span class="chip chip-impact">${esc(s.impact)}</span>`);
      return `<li class="edition-story">
        <span class="edition-rank">${i + 1}</span>
        <div class="edition-story-body">
          <a class="edition-headline" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>
          <p class="edition-summary">${esc(s.body)}</p>
          <span class="edition-chips">${chips.join("")}</span>
        </div>
      </li>`;
    })
    .join("");

  body.innerHTML = `<div class="edition-reader">
    <div class="edition-masthead">
      <span class="edition-wordmark">ai <span class="edition-wordmark-green">pulse daily</span></span>
      <span class="edition-sub">edition ${esc(m.id)} · 07:00 cest</span>
    </div>
    <hr class="hairline">
    <p class="edition-lede">${esc(m.lede)}</p>
    <div class="edition-section-label">top stories</div>
    <ol class="edition-stories">${stories}</ol>
    <div class="edition-foot">
      <span class="edition-links"><a class="edition-browser-link" href="/newsletter/${esc(m.id)}">read in browser</a> · <button class="edition-share" type="button">share</button></span>
      <span class="edition-signals">${m.signals} signals condensed</span>
    </div>
    <a class="view-link" href="/newsletter">open archive →</a>
  </div>`;
  // The reader is a document, not a list: it grows naturally instead of
  // scrolling internally.
  body.classList.remove("panel-body--scroll");

  body.querySelector(".edition-share")?.addEventListener("click", () => {
    const url = location.origin + "/newsletter/" + m.id;
    if (navigator.share) {
      navigator.share({ url }).catch(() => {});
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  });
}

// ── Archive card (reader) ──
// Pack-declared variant "archive": past rows built from existing endpoints
// only — the health's persisted day ids and the latest digest's weekId. The
// panel is resolved by variant at call time (mirrors the other cards), so it
// renders from the panel loop and when data arrives after the sweep. Daily
// rows link out to the retained /newsletter/:id pages; the weekly row scrolls
// the same-view digest panel into sight (no view id literal, no setView).
function archivePanel() {
  return (DOMAIN?.panels || []).find((p) => p.variant === "archive") || null;
}

function renderArchive(panel) {
  const p = panel || archivePanel();
  if (!p) return;
  const body = document.getElementById("body-" + p.id);
  if (!body) return;

  const rows = window.RenderCore.archiveRows(
    lastEditionIds,
    lastDigest,
    lastEdition,
  );

  if (rows.length === 0) {
    body.innerHTML = '<div class="panel-empty">no past editions yet</div>';
    body.classList.remove("panel-body--scroll");
    return;
  }

  body.innerHTML =
    `<ul class="archive-rows">` +
    rows
      .map((row) => {
        if (row.kind === "weekly") {
          return `<li class="archive-row" data-kind="weekly">
        <button class="archive-link" type="button">week ${row.weekNumber} digest</button>
        <span class="archive-meta">${row.signals} signals</span>
      </li>`;
        }
        // An older day's count is unknown (only the latest payload is
        // fetched), so no meta is rendered rather than a fabricated number.
        const meta =
          row.signals == null
            ? ""
            : `<span class="archive-meta">${row.signals} signals</span>`;
        return `<li class="archive-row" data-kind="daily">
        <a class="archive-link" href="/newsletter/${esc(row.id)}">${esc(row.date)} daily</a>
        ${meta}
      </li>`;
      })
      .join("") +
    `</ul>`;

  body.classList.toggle("panel-body--scroll", rows.length >= 6);

  body
    .querySelector(".archive-row[data-kind='weekly'] .archive-link")
    ?.addEventListener("click", () => {
      document
        .getElementById("digestPanel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
}

async function fetchEdition() {
  const [d, e, h] = await Promise.allSettled([
    fetch("/api/digest").then((r) => (r.ok ? r.json() : null)),
    fetch("/api/newsletter").then((r) => (r.ok ? r.json() : null)),
    fetch("/api/health").then((r) => (r.ok ? r.json() : null)),
  ]);
  if (d.status === "fulfilled") lastDigest = d.value ?? lastDigest;
  if (e.status === "fulfilled") lastEdition = e.value ?? lastEdition;
  // A transient health failure must not blank a populated list: fall back to
  // the last known ids when the payload is absent.
  if (h.status === "fulfilled") {
    lastEditionIds = h.value?.persistence?.editions ?? lastEditionIds;
  }
  renderEditionCard();
  renderDailyEdition();
  renderArchive();
}

// ── Sources preview (main column) ──
// Pack-declared variant "sources-preview": up to panel.limit source cards
// computed from the raw sweep in pack order — never the category aggregate,
// so a filter applied on the sources view cannot leak into the preview. The
// action reads panel.target/panel.actionLabel (no view id literal).
// Switch to the destination view and bring that source's card into view,
// flagging it briefly so the eye lands on it. The source -> panel mapping is
// pure (RenderCore.panelIdForSource), so no source name is named here.
function jumpToSource(viewId, sourceName) {
  if (!viewId) return;
  setView(viewId);
  const panelId = window.RenderCore.panelIdForSource(
    DOMAIN?.views,
    DOMAIN?.panels,
    viewId,
    data?.sweep?.sources,
    sourceName,
  );
  if (!panelId) return;
  const frame = panelFrame(panelId);
  if (!frame) return;
  frame.scrollIntoView({ behavior: "smooth", block: "center" });
  frame.classList.add("panel--jumped");
  setTimeout(() => frame.classList.remove("panel--jumped"), 1600);
}

function renderSourcesPreview(panel, sources) {
  const bodyEl = document.getElementById("body-" + panel.id);
  if (!bodyEl) return;
  const rows = window.RenderCore.previewSources(sources, panel.limit || 4);

  const countEl = document.getElementById("count-" + panel.id);
  if (countEl) countEl.textContent = panel.actionLabel || "";
  const titleEl = document
    .getElementById("panel-" + panel.id)
    ?.querySelector(".panel-title");
  if (titleEl) {
    const total = (sources || []).length;
    titleEl.textContent = total
      ? `${panel.title} · ${total} sources`
      : panel.title;
  }

  if (rows.length === 0) {
    bodyEl.innerHTML = '<div class="panel-empty">no source activity yet</div>';
    bodyEl.classList.remove("panel-body--scroll");
    return;
  }

  // A directory of the sweep's sources: name and count only. Each tile is a
  // button that jumps to that source in the destination view — the headline
  // that used to sit here made the tiles tall, uneven and redundant with the
  // grid the link leads to.
  bodyEl.innerHTML =
    `<div class="preview-grid">` +
    rows
      .map(
        (r) => `
      <button class="preview-card" type="button" data-source="${esc(r.source)}">
        <span class="preview-source">${esc(r.source)}</span>
        <span class="preview-count">${r.count}</span>
      </button>`,
      )
      .join("") +
    `</div>`;
  // Never capped: this is a complete list, not a feed.
  bodyEl.classList.remove("panel-body--scroll");

  bodyEl.querySelectorAll(".preview-card").forEach((card) => {
    card.addEventListener("click", () => {
      jumpToSource(panel.target, card.dataset.source);
    });
  });

  // The header's count slot carries the action label, so the link lives there.
  if (countEl && !countEl.dataset.bound) {
    countEl.dataset.bound = "1";
    countEl.classList.add("view-link");
    countEl.addEventListener("click", (e) => {
      e.stopPropagation();
      setView(panel.target);
    });
  }
}

// ── Boot: domain chrome first, then all init ──
// Panels/nav/stats are built from /api/domain BEFORE the collapse/nav/etc.
// initializers run (they key off runtime-built elements). If the domain fetch
// fails (e.g. the static inject.mjs export has no server), the dashboard
// renders no panels but must not throw.
async function init() {
  // Session filter/sort must be restored before the first setView paints.
  restoreFilters();
  // Static export: the chrome and the run snapshot are already in memory, so
  // skip the domain fetch entirely.
  if (BOOTSTRAP?.domain) {
    DOMAIN = BOOTSTRAP.domain;
    buildDomainUI(DOMAIN);
    setView(state.view);
  } else {
    try {
      const res = await fetch("/api/domain");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      DOMAIN = await res.json();
      buildDomainUI(DOMAIN);
      setView(state.view);
    } catch (err) {
      console.error("Failed to load /api/domain — dashboard disabled", err);
    }
  }

  initTheme();
  initKeyboardHelp();
  initStatsDialog();
  initViewNav();
  initPanelCollapse();
  initSearch();
  initColumnFit();

  if (!IS_STATIC) {
    // Wire up the initial digest generate button (runtime-built panel)
    document
      .getElementById("digestGenerateBtn")
      ?.addEventListener("click", function () {
        triggerDigestGeneration(this);
      });

    // Fetch digest + latest edition on load
    fetchDigest().catch(() => {}); // NOSONAR — browser script, not an ES module
    fetchEdition().catch(() => {}); // NOSONAR — browser script, not an ES module
  }

  // The SSE replay (or fallback fetch) may have captured a sweep while the
  // domain chrome was still loading — or the bootstrap seeded `data` directly.
  // Render it now against the freshly built panels; otherwise the page would
  // wait for the next sweep update.
  if (IS_STATIC && BOOTSTRAP?.data) data = BOOTSTRAP.data;
  if (data?.sweep) applyData(data);
}

init();
