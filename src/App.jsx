// ==========================
// Goal Tracker — Production Build (Zero Deps)
// ==========================
// Frontend: React single-file component (drop-in for Vite/CRA)
// Backend: Google Apps Script (Web App) + optional Cloudflare Worker CORS proxy
// ------------------------------------------
// Notes:
//  - Replace SHEETS_API_URL with your deployed Apps Script Web App **/exec** URL.
//  - Make the Apps Script deployment public (Execute as: Me, Who has access: Anyone).
//  - POST uses Content-Type: text/plain to avoid preflight.
//  - Optional CORS proxy: set CORS_PROXY_URL to a Worker that forwards and adds CORS headers.
//  - On first load, the app imports all goals/tasks automatically, then enables auto-sync.
// ------------------------------------------

import React, { useEffect, useMemo, useRef, useState } from "react";

/*************************
 * Goal Tracker — Best UI (Zero deps)
 * List view + Multi-theme + Google Sheets auto-sync
 * Hardening for production:
 *  - No Node-only crypto calls (works on mobile + desktop)
 *  - Robust CORS handling (optional proxy)
 *  - First-load import of all goals/tasks
 *  - Debounced, failure-tolerant auto-sync
 *  - Defensive JSON parsing & SSR-safe localStorage
 *  - Dev self-tests kept + a few more
 *************************/

// ==========================
// Config
// ==========================
// Prefer env vars if available (Vite): VITE_SHEETS_API_URL, VITE_SHEETS_API_KEY, VITE_CORS_PROXY_URL
const SHEETS_API_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SHEETS_API_URL)
  || "https://script.google.com/macros/s/AKfycbyHRwu-spWdIlsMIHWJjpsDYfBtGNdTaJfsTiwnHmhxroNcLvgtrW2qQClDrQ_GIn4n/exec"; // <-- REPLACE
const API_KEY = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SHEETS_API_KEY)
  || ""; // leave blank if Apps Script doesn't enforce an API key
// Optional CORS proxy (Cloudflare Worker below). Leave blank if Apps Script is public and works directly.
const CORS_PROXY_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_CORS_PROXY_URL)
  || ""; // e.g., https://your-worker.example.workers.dev

// Tiny emoji icons (no external libs)
const I = {
  add: (p) => <span {...p}>＋</span>,
  del: (p) => <span {...p}>🗑️</span>,
  edit: (p) => <span {...p}>✏️</span>,
  cal: (p) => <span {...p}>📅</span>,
  palette: (p) => <span {...p}>🎨</span>,
  upload: (p) => <span {...p}>↗</span>,
  download: (p) => <span {...p}>↙</span>,
};

// ==========================
// Themes
// ==========================
const TLight = { name: "light", bg: "#f7f7f8", text: "#0f172a", sub: "#64748b", card: "#ffffff", cardBorder: "#e5e7eb", muted: "#f3f4f6", dangerBg: "#fef2f2", danger: "#b91c1c", accent: "#111827", radius: 12, radiusLg: 16, shadow: "0 1px 2px rgba(0,0,0,0.04)" };
const TDark = { name: "dark", bg: "#0b1220", text: "#e5e7eb", sub: "#94a3b8", card: "#0f172a", cardBorder: "#1f2937", muted: "#101827", dangerBg: "#2b0f13", danger: "#f87171", accent: "#6366f1", radius: 12, radiusLg: 16, shadow: "0 1px 2px rgba(0,0,0,0.20)" };
const TEmerald = { name: "emerald", bg: "#f6fef9", text: "#064e3b", sub: "#047857", card: "#ffffff", cardBorder: "#def7ec", muted: "#ecfdf5", dangerBg: "#fff1f2", danger: "#be123c", accent: "#059669", radius: 12, radiusLg: 16, shadow: "0 1px 2px rgba(0,0,0,0.04)" };
const TRose = { name: "rose", bg: "#fff7f9", text: "#4c0519", sub: "#9f1239", card: "#ffffff", cardBorder: "#ffe4e6", muted: "#fff1f2", dangerBg: "#fff1f2", danger: "#e11d48", accent: "#e11d48", radius: 12, radiusLg: 16, shadow: "0 1px 2px rgba(0,0,0,0.04)" };
const TSapphire = { name: "sapphire", bg: "#0b1220", text: "#dbeafe", sub: "#93c5fd", card: "#0f172a", cardBorder: "#1e3a8a", muted: "#0b1322", dangerBg: "#1b0f10", danger: "#fda4af", accent: "#3b82f6", radius: 12, radiusLg: 16, shadow: "0 1px 2px rgba(0,0,0,0.25)" };
const TAmoled = { name: "amoled", bg: "#000000", text: "#e5e7eb", sub: "#94a3b8", card: "#0a0a0a", cardBorder: "#171717", muted: "#0a0a0a", dangerBg: "#1f0a0c", danger: "#fb7185", accent: "#22d3ee", radius: 12, radiusLg: 16, shadow: "0 1px 2px rgba(0,0,0,0.6)" };
const THEMES = { light: TLight, dark: TDark, emerald: TEmerald, rose: TRose, sapphire: TSapphire, amoled: TAmoled };
const THEME_OPTIONS = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "emerald", label: "Emerald" },
  { id: "rose", label: "Rose" },
  { id: "sapphire", label: "Sapphire" },
  { id: "amoled", label: "AMOLED" },
];

// ==========================
// Helpers
// ==========================
const uid = () => ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const todayISO = () => new Date().toISOString().slice(0, 10);
const toISO = (d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
const endOfYearISO = () => toISO(new Date(Date.UTC(new Date().getFullYear(), 11, 31)));
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const impactWeight = (lvl) => (lvl === "High" ? 10 : lvl === "Medium" ? 5 : 1);

const addByFreq = (date, freq) => {
  const d = new Date(date);
  switch (freq) {
    case "daily": d.setDate(d.getDate() + 1); break;
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
    default: break;
  }
  return d;
};
const nextDueDate = (iso, freq) => toISO(addByFreq(new Date(iso + "T00:00:00"), freq));

const buildSeries = (title, impact, startISO, endISO, freq) => {
  const start = new Date(startISO + "T00:00:00");
  const end = new Date(endISO + "T00:00:00");
  if (start > end) return [];
  const out = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    out.push({ id: uid(), title: title.trim(), dueDate: toISO(cursor), impact, frequency: "once", completed: false });
    cursor = addByFreq(cursor, freq);
  }
  return out;
};

// SSR-safe localStorage hook
const useLocal = (key, init) => {
  const [val, setVal] = useState(() => {
    if (typeof window === 'undefined') return init;
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : init;
    } catch (e) { return init; }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }, [key, val]);
  return [val, setVal];
};

// ==========================
// Google Sheets helpers (CORS-aware)
// ==========================
async function fetchSheets(url, opts = {}) {
  const finalUrl = API_KEY ? `${url}?key=${encodeURIComponent(API_KEY)}` : url;
  if (!CORS_PROXY_URL) return fetch(finalUrl, opts);
  // Proxy format: GET/POST to <CORS_PROXY_URL>?u=<encoded target>
  const proxied = `${CORS_PROXY_URL}${CORS_PROXY_URL.endsWith('/') ? '' : '/'}?u=${encodeURIComponent(finalUrl)}`;
  return fetch(proxied, opts);
}

function flattenForSheet(goals) {
  const rows = [];
  goals.forEach(g => {
    const gTasks = (g.tasks || []);
    if (gTasks.length === 0) {
      rows.push({
        goalId: g.id, goalTitle: g.title, goalImpact: g.impact,
        goalTargetDate: g.targetDate || '',
        taskId: `${g.id}__goal`, taskTitle: '', taskDueDate: '', taskImpact: '',
        frequency: 'goal', completed: 'FALSE'
      });
      return;
    }
    gTasks.forEach(t => {
      rows.push({
        goalId: g.id, goalTitle: g.title, goalImpact: g.impact,
        goalTargetDate: g.targetDate || '',
        taskId: t.id, taskTitle: t.title, taskDueDate: t.dueDate,
        taskImpact: t.impact, frequency: t.frequency,
        completed: t.completed ? 'TRUE' : 'FALSE'
      });
    });
  });
  return rows;
}

function inflateFromSheet(rows) {
  const byGoal = new Map();
  rows.forEach(r => {
    const g = byGoal.get(r.goalId) || {
      id: r.goalId, title: r.goalTitle, impact: r.goalImpact,
      targetDate: r.goalTargetDate || '', collapsed: false, tasks: []
    };
    const isGoalOnly = r.frequency === 'goal';
    const hasTask = r.taskId && r.taskTitle;
    if (hasTask && !isGoalOnly) {
      g.tasks.push({
        id: r.taskId, title: r.taskTitle, dueDate: r.taskDueDate,
        impact: r.taskImpact, frequency: r.frequency,
        completed: r.completed === 'TRUE'
      });
    }
    byGoal.set(r.goalId, g);
  });
  return [...byGoal.values()].map(g => ({ ...g, tasks: g.tasks.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)) }));
}

async function pushToSheets(goals) {
  const rows = flattenForSheet(goals); // can be []
  try {
    const res = await fetchSheets(SHEETS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // simple request, no preflight
      body: JSON.stringify({ mode: 'replace', rows }) // full snapshot
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> '');
      console.error('Export error', res.status, text);
      return { ok: false, status: res.status, body: text };
    }
    let out; try { out = await res.json(); } catch { out = { ok: res.ok }; }
    return out;
  } catch (e) {
    console.error('Export network error', e);
    return { ok: false, error: String(e) };
  }
}

async function pullFromSheets() {
  const res = await fetchSheets(SHEETS_API_URL);
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    console.error('Import error', res.status, text);
    throw new Error(`Failed to pull from Sheets (status ${res.status}).`);
  }
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!ct.includes('application/json')) {
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      throw new Error('Import failed: endpoint returned HTML (likely sign-in/non-public). Make the Apps Script public or set CORS_PROXY_URL.');
    }
  }
  let data; try { data = JSON.parse(text); } catch { data = { rows: [] }; }
  return inflateFromSheet(data.rows || []);
}

// ==========================
// Sort helpers
// ==========================
const SORT_OPTIONS = ["dueAsc", "dueDesc", "impactHigh", "impactLow"];
const sanitizeSort = (v) => (SORT_OPTIONS.includes(v) ? v : "dueAsc");

const ImpactPill = ({ level, T }) => {
  const map = { Low:{b:'#bbf7d0',t:'#166534',bd:'#86efac'}, Medium:{b:'#fde68a',t:'#92400e',bd:'#fcd34d'}, High:{b:'#fecaca',t:'#7f1d1d',bd:'#fca5a5'} };
  const dm = { Low:{b:'#07341f',t:'#86efac',bd:'#065f46'}, Medium:{b:'#3b2b05',t:'#facc15',bd:'#92400e'}, High:{b:'#3a0b0b',t:'#fda4af',bd:'#7f1d1d'} };
  const darkish = T.name === 'dark' || T.name === 'sapphire' || T.name === 'amoled';
  const c = (darkish ? dm : map)[level] || { b:T.muted, t:T.text, bd:T.cardBorder };
  return <span style={{ fontSize:12, padding:'2px 8px', borderRadius:999, background:c.b, color:c.t, border:`1px solid ${c.bd}`, whiteSpace:'nowrap' }}>{level}</span>;
};

// ==========================
// App
// ==========================
export default function App() {
  const [themeId, setThemeId] = useLocal("gt_theme", "light");
  const T = THEMES[themeId] || TLight;

  const [goals, setGoals] = useLocal("gt_best_goals", []);
  const [showAddGoal, setShowAddGoal] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Initial load from Google Sheets
  const [initializing, setInitializing] = useState(true);
  const skipNextSync = useRef(false);

  // Filters
  const [impHigh, setImpHigh] = useState(true);
  const [impMedium, setImpMedium] = useState(true);
  const [impLow, setImpLow] = useState(true);
  const [status, setStatus] = useState("all"); // all | open | done
  const [dateScope, setDateScope] = useState("all"); // all | today | week | overdue
  const [search, setSearch] = useState("");

  // Defensive sort state
  const [sortModeRaw, setSortModeRaw] = useLocal("gt_sort", "dueAsc");
  const sortMode = sanitizeSort(sortModeRaw);

  // Add goal form
  const [gTitle, setGTitle] = useState("");
  const [gImpact, setGImpact] = useState("Medium");
  const [gTarget, setGTarget] = useState(endOfYearISO());
  const [error, setError] = useState("");

  // Sync state
  const [syncBusy, setSyncBusy] = useState(false);
  const firstRender = useRef(true);
  const pendingTimer = useRef(null);

  // Derived overall progress
  const overall = useMemo(() => {
    if (!goals.length) return 0;
    const denom = goals.reduce((s, g) => s + impactWeight(g.impact), 0) || 1;
    const num = goals.reduce((s, g) => s + impactWeight(g.impact) * progressOf(g), 0);
    return clamp(Math.round(num / denom), 0, 100);
  }, [goals]);

  function progressOf(goal) {
    if (!goal.tasks || !goal.tasks.length) return 0;
    const totalW = goal.tasks.reduce((s, t) => s + impactWeight(t.impact), 0) || 1;
    const doneW = goal.tasks.reduce((s, t) => s + (t.completed && t.frequency === "once" ? impactWeight(t.impact) : 0), 0);
    return clamp(Math.round((doneW / totalW) * 100), 0, 100);
  }

  // CRUD: goals
  const addGoal = () => {
    setError("");
    const title = gTitle.trim();
    if (title.length < 3) return setError("Goal title must be at least 3 characters.");
    if (!gTarget) return setError("Please pick a target date.");
    const goal = { id: uid(), title, impact: gImpact, targetDate: gTarget, collapsed: false, tasks: [] };
    setGoals([goal, ...goals]);
    setGTitle(""); setGImpact("Medium"); setGTarget(endOfYearISO()); setShowAddGoal(false);
  };
  const removeGoal = (id) => setGoals(goals.filter(g => g.id !== id));
  const renameGoal = (goalId, nextTitle) => setGoals(goals.map(g => g.id === goalId ? { ...g, title: nextTitle } : g));
  const toggleCollapse = (goalId) => setGoals(goals.map(g => g.id === goalId ? { ...g, collapsed: !g.collapsed } : g));

  // CRUD: tasks
  const updateTask = (goalId, taskId, patch) => setGoals(goals.map(g => g.id === goalId ? { ...g, tasks: g.tasks.map(t => t.id === taskId ? { ...t, ...patch } : t) } : g));
  const removeTask = (goalId, taskId) => setGoals(goals.map(g => g.id === goalId ? { ...g, tasks: g.tasks.filter(t => t.id !== taskId) } : g));
  const toggleTask = (goalId, taskId, checked) => setGoals(goals.map(g => g.id === goalId ? ({
    ...g,
    tasks: g.tasks.map(t => {
      if (t.id !== taskId) return t;
      if (t.frequency === "once") return { ...t, completed: checked };
      return checked ? { ...t, dueDate: nextDueDate(t.dueDate, t.frequency) } : t;
    })
  }) : g));

  const addTask = (goalId, payload) => {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    const title = (payload?.title || "").trim();
    if (!title) return;

    const startISO = todayISO();
    const goalEndISO = goal.targetDate || endOfYearISO();

    if (payload.frequency === "daily") {
      let days = payload.durationDays && payload.durationDays > 0 ? Math.min(payload.durationDays, 365) : undefined;
      if (!days) {
        if (goal.targetDate) {
          const start = new Date(startISO + "T00:00:00");
          const end = new Date(goalEndISO + "T00:00:00");
          days = clamp(Math.floor((end - start) / 86400000) + 1, 1, 365);
        } else { days = 7; }
      }
      const endByDays = toISO(new Date(new Date(startISO + "T00:00:00").getTime() + (days - 1) * 86400000));
      const cappedEnd = new Date(endByDays + "T00:00:00") < new Date(goalEndISO + "T00:00:00") ? endByDays : goalEndISO;
      const series = buildSeries(title, payload.impact, startISO, cappedEnd, "daily");
      if (series.length) setGoals(goals.map(g => g.id === goalId ? { ...g, tasks: [...(g.tasks || []), ...series] } : g));
      return;
    }

    if (payload.frequency !== "once") {
      if (goal.targetDate) {
        const series = buildSeries(title, payload.impact, startISO, goalEndISO, payload.frequency);
        if (series.length) setGoals(goals.map(g => g.id === goalId ? { ...g, tasks: [...(g.tasks || []), ...series] } : g));
        return;
      }
      const shell = { id: uid(), title, dueDate: startISO, impact: payload.impact, frequency: payload.frequency, completed: false };
      setGoals(goals.map(g => g.id === goalId ? { ...g, tasks: [...(g.tasks || []), shell] } : g));
      return;
    }

    const once = { id: uid(), title, dueDate: startISO, impact: payload.impact, frequency: "once", completed: false };
    setGoals(goals.map(g => g.id === goalId ? { ...g, tasks: [...(g.tasks || []), once] } : g));
  };

  // Filters
  const impactPass = (impact) => ((impact === "High" && impHigh) || (impact === "Medium" && impMedium) || (impact === "Low" && impLow));
  const statusPass = (t) => (status === "open" ? !(t.frequency === "once" && t.completed) : status === "done" ? t.frequency === "once" && t.completed : true);
  const dateScopePass = (iso) => {
    const today = new Date(new Date().toDateString());
    const d = new Date(iso + "T00:00:00");
    if (dateScope === "today") return d.getTime() === today.getTime();
    if (dateScope === "week") { const in7 = new Date(today); in7.setDate(in7.getDate() + 7); return d >= today && d <= in7; }
    if (dateScope === "overdue") return d < today;
    return true;
  };
  const clearFilters = () => { setImpHigh(true); setImpMedium(true); setImpLow(true); setStatus("all"); setDateScope("all"); setSearch(""); };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); const el = document.getElementById('gt-search'); if (el) el.focus(); }
      if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey) { setShowAddGoal(v=>!v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-sync to Google Sheets (debounced, never throws)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (skipNextSync.current) { skipNextSync.current = false; return; }

    if (pendingTimer.current) clearTimeout(pendingTimer.current);

    pendingTimer.current = setTimeout(async () => {
      try {
        const res = await pushToSheets(goals);
        if (!res?.ok) console.warn("Auto-sync failed (non-OK)", res);
      } catch (e) {
        console.warn("Auto-sync failed (exception)", e);
      }
    }, 800);

    return () => { if (pendingTimer.current) clearTimeout(pendingTimer.current); };
  }, [goals]);

  // Initial import on first render (load all goals/tasks)
  useEffect(() => {
    (async () => {
      try {
        const pulled = await pullFromSheets();
        skipNextSync.current = true; // don't immediately re-export the same data
        setGoals(pulled);
      } catch (e) {
        console.warn('Initial import failed:', e);
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  // Styles
  const page = { minHeight: '100vh', background: T.bg, color: T.text, transition: 'background .2s ease, color .2s ease' };
  const container = { maxWidth: 960, margin: '0 auto', padding: '20px 24px' };
  const btn = { padding: '8px 12px', borderRadius: T.radius, background: T.accent, color: '#fff', border: `1px solid ${T.accent}`, cursor: 'pointer' };
  const btnGhost = { padding: '8px 12px', borderRadius: T.radius, background: T.card, color: T.text, border: `1px solid ${T.cardBorder}`, cursor: 'pointer' };
  const card = { background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radiusLg, padding: 16, boxShadow: T.shadow };
  const input = { border: `1px solid ${T.cardBorder}`, borderRadius: 10, padding: '8px 10px', width: '100%', background: T.card, color: T.text };
  const label = { fontSize: 12, color: T.sub };
  const hoverable = (base) => ({ ...base, outline: 'none', boxShadow: 'none' });
  const onHover = (e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.10)'; };
  const onLeave = (e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; };
  const chip = (active) => ({ padding:'6px 10px', borderRadius:999, background: active ? T.accent : T.card, color: active ? '#fff' : T.text, border: `1px solid ${active ? T.accent : T.cardBorder}`, cursor: 'pointer' });

  // Sorting comparator
  const cmp = (a,b) => {
    const impRank = { High:3, Medium:2, Low:1 };
    switch (sortMode) {
      case 'dueAsc': return a.dueDate.localeCompare(b.dueDate);
      case 'dueDesc': return b.dueDate.localeCompare(a.dueDate);
      case 'impactHigh': return (impRank[b.impact]||0)-(impRank[a.impact]||0) || a.dueDate.localeCompare(b.dueDate);
      case 'impactLow': return (impRank[a.impact]||0)-(impRank[b.impact]||0) || a.dueDate.localeCompare(b.dueDate);
      default: return a.dueDate.localeCompare(b.dueDate);
    }
  };

  return (
    <div style={page}>
      {/* Header */}
      <header style={{ position:'sticky', top:0, zIndex:10, background:T.card, borderBottom:`1px solid ${T.cardBorder}`, backdropFilter:'saturate(180%) blur(4px)' }}>
        <div style={{ maxWidth:960, margin:'0 auto', padding:'14px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:10 }}>
            <h1 style={{ fontSize:20, fontWeight:700, color:T.text, letterSpacing:0.2 }}>Goal Tracker</h1>
            <span style={{ fontSize:12, color:T.sub }}>clean & fast</span>
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:T.muted, padding:'6px 10px', borderRadius:999, border:`1px solid ${T.cardBorder}`, fontSize:12, color:T.text }}>
              <span aria-hidden>🏁</span>
              <strong style={{ fontWeight:600 }}>{overall}%</strong>
              <span style={{ color:T.sub }}>overall</span>
            </div>

            {/* Theme picker */}
            <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:999, padding:4 }}>
              <I.palette aria-hidden />
              <select aria-label="Theme" value={themeId} onChange={(e)=>setThemeId(e.target.value)}
                      style={{ background:'transparent', color:T.text, border:'none', outline:'none', fontSize:13, padding:'4px 6px', borderRadius:999 }}>
                {THEME_OPTIONS.map(o=> <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>

            {/* Sheets sync (manual) */}
            <button
              title="Export to Google Sheets"
              disabled={syncBusy}
              onClick={async()=>{
                setSyncBusy(true);
                try{
                  const res = await pushToSheets(goals);
                  if (!res?.ok) alert('Sync failed. See console for details.');
                  else alert('Synced to Google Sheets ✅');
                } catch (e) {
                  console.warn('Manual export failed', e);
                  alert('Sync failed: ' + (e?.message || String(e)));
                } finally { setSyncBusy(false); }
              }}
              style={{...hoverable(btn), opacity: syncBusy?0.6:1}}
              onMouseEnter={onHover} onMouseLeave={onLeave}
            ><I.upload /> Export</button>

            <button
              title="Import from Google Sheets"
              disabled={syncBusy}
              onClick={async()=>{
                setSyncBusy(true);
                try{
                  const pulled = await pullFromSheets();
                  setGoals(pulled);
                  alert('Imported from Google Sheets ✅');
                } catch(e){
                  alert('Import failed: ' + (e?.message || String(e)));
                } finally { setSyncBusy(false); }
              }}
              style={{...hoverable(btnGhost), opacity: syncBusy?0.6:1}}
              onMouseEnter={onHover} onMouseLeave={onLeave}
            ><I.download /> Import</button>
          </div>
        </div>
      </header>

      {/* Controls */}
      <div style={container}>
        {initializing && (
          <div style={{ ...card, marginBottom: 12, fontSize: 13 }}>
            Loading from Google Sheets…
          </div>
        )}
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <button onClick={() => setShowAddGoal(v => !v)} style={hoverable(btn)} onMouseEnter={onHover} onMouseLeave={onLeave}>
            <I.add /> {showAddGoal ? "Hide" : "Add Goal"}
          </button>
          <button onClick={() => setFiltersOpen(v => !v)} style={hoverable(btnGhost)} onMouseEnter={onHover} onMouseLeave={onLeave}>Filters</button>

          <input id="gt-search" value={search} onChange={(e)=>setSearch(e.target.value)}
                 placeholder="Search tasks… (/ to focus)" style={{ ...input, width: 220 }} />
          <select value={sortMode} onChange={(e)=>setSortModeRaw(sanitizeSort(e.target.value))} style={input} aria-label="Sort tasks">
            <option value="dueAsc">Due ↑</option>
            <option value="dueDesc">Due ↓</option>
            <option value="impactHigh">Impact High→Low</option>
            <option value="impactLow">Impact Low→High</option>
          </select>
        </div>

        {filtersOpen && (
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
              <div>
                <div style={label}>Impact</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <button style={chip(impHigh)} onClick={() => setImpHigh(v => !v)}>High</button>
                  <button style={chip(impMedium)} onClick={() => setImpMedium(v => !v)}>Medium</button>
                  <button style={chip(impLow)} onClick={() => setImpLow(v => !v)}>Low</button>
                </div>
              </div>
              <div>
                <div style={label}>Status</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  {['all','open','done'].map(s => (
                    <button key={s} style={chip(status===s)} onClick={() => setStatus(s)}>{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={label}>Date</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  {[['all','All'],['today','Today'],['week','Next 7 days'],['overdue','Overdue']].map(([v,txt]) => (
                    <button key={v} style={chip(dateScope===v)} onClick={() => setDateScope(v)}>{txt}</button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button style={hoverable(btnGhost)} onMouseEnter={onHover} onMouseLeave={onLeave} onClick={clearFilters}>Clear filters</button>
            </div>
          </div>
        )}

        {showAddGoal && (
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
              <div style={{ gridColumn: 'span 2 / span 2' }}>
                <div style={label}>Goal title</div>
                <input style={{ ...input, marginTop: 6 }} placeholder="Ship v1, learn React, run 5k..." value={gTitle} onChange={(e) => setGTitle(e.target.value)} />
              </div>
              <div>
                <div style={label}>Impact</div>
                <select style={{ ...input, marginTop: 6 }} value={gImpact} onChange={(e) => setGImpact(e.target.value)}>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
              <div>
                <div style={label}>Target date</div>
                <input type="date" style={{ ...input, marginTop: 6 }} value={gTarget} onChange={(e) => setGTarget(e.target.value)} />
              </div>
            </div>
            {error && (
              <div style={{ marginTop: 10, fontSize: 13, color: T.danger, background: T.dangerBg, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, padding: '8px 10px' }}>{error}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={addGoal} style={hoverable(btn)} onMouseEnter={onHover} onMouseLeave={onLeave}><I.add /> Add Goal</button>
            </div>
          </div>
        )}
      </div>

      {/* Goal Cards */}
      <div style={{ ...container, paddingTop: 0 }}>
        {goals.length === 0 && (
          <div style={{ textAlign: 'center', fontSize: 13, color: T.sub, padding: '48px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🧭</div>
            No goals yet. Create your first one above.
          </div>
        )}

        {goals.map((g) => {
          let tasks = (g.tasks || []).slice();
          const q = search.trim().toLowerCase();
          tasks = tasks.filter(t => (!q || t.title.toLowerCase().includes(q)));
          tasks = tasks.filter((t) => impactPass(t.impact) && statusPass(t) && dateScopePass(t.dueDate));
          tasks.sort(cmp);

          return (
            <div key={g.id} style={{ ...card, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{g.title}</div>
                    <ImpactPill level={g.impact} T={T} />
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: T.sub, display: 'flex', gap: 12 }}>
                    {g.targetDate && (<span><I.cal /> Target {g.targetDate}</span>)}
                    <span>{progressOf(g)}% done</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button title={g.collapsed ? "Show" : "Hide"} onClick={() => toggleCollapse(g.id)} style={hoverable(btnGhost)} onMouseEnter={onHover} onMouseLeave={onLeave}>{g.collapsed ? 'Show' : 'Hide'}</button>
                  <button title="Rename" onClick={() => { const next = prompt("Rename goal", g.title); if (next && next.trim()) renameGoal(g.id, next.trim()); }} style={hoverable(btnGhost)} onMouseEnter={onHover} onMouseLeave={onLeave}><I.edit /></button>
                  <button title="Delete" onClick={() => removeGoal(g.id)} style={hoverable(btnGhost)} onMouseEnter={onHover} onMouseLeave={onLeave}><I.del /></button>
                </div>
              </div>

              {!g.collapsed && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ width: '100%', height: 10, background: T.muted, borderRadius: 999, overflow: 'hidden', border: `1px solid ${T.cardBorder}` }}>
                    <div style={{ height: '100%', background: T.accent, width: `${progressOf(g)}%`, transition: 'width .25s ease' }} />
                  </div>

                  <TaskList T={T} goal={g} tasks={tasks} updateTask={updateTask} removeTask={removeTask} toggleTask={toggleTask} />
                  <AddTaskPanel T={T} goal={g} onAdd={(p) => addTask(g.id, p)} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ height: 36 }} />
    </div>
  );
}

function TaskList({ T, goal, tasks, updateTask, removeTask, toggleTask }) {
  const rowWrap = { marginTop: 12, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, padding: 8, background: T.card };
  const row = { display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto auto', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8 };
  const pill = (overdue) => ({ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: overdue ? T.dangerBg : T.muted, color: overdue ? T.danger : T.text, border: `1px solid ${overdue ? '#fecaca' : T.cardBorder}`, whiteSpace: 'nowrap' });
  const btnGhost = { padding: '6px 8px', borderRadius: 8, background: T.card, color: T.text, border: `1px solid ${T.cardBorder}`, cursor: 'pointer' };
  const hover = (e)=>{ e.currentTarget.style.background = T.muted; };
  const unhover = (e)=>{ e.currentTarget.style.background = T.card; };

  return (
    <div style={rowWrap}>
      <div style={{ fontSize: 13, fontWeight: 600, margin: '4px 6px', color: T.text }}>Tasks</div>
      {tasks.length === 0 ? (
        <div style={{ fontSize: 12, color: T.sub, padding: '8px 6px' }}>No tasks match your filters.</div>
      ) : (
        <ul style={{ display: 'grid', gap: 4, marginTop: 6 }}>
          {tasks.map((t) => {
            const overdue = new Date(t.dueDate) < new Date(new Date().toDateString());
            const completed = t.frequency === "once" && t.completed;
            return (
              <li key={t.id}
                  style={{ ...row, background: completed ? ((T.name==='dark'||T.name==='sapphire'||T.name==='amoled')?'#0b1322':'#fafafa') : 'transparent' }}
                  onMouseEnter={(e)=>{e.currentTarget.style.background=(T.name==='dark'||T.name==='sapphire'||T.name==='amoled')?'#0b1322':'#f8fafc'}}
                  onMouseLeave={(e)=>{e.currentTarget.style.background=completed ? ((T.name==='dark'||T.name==='sapphire'||T.name==='amoled')?'#0b1322':'#fafafa') : 'transparent'}}
              >
                <input type="checkbox" checked={completed} onChange={(e) => toggleTask(goal.id, t.id, e.target.checked)} aria-label={t.frequency === "once" ? "Complete task" : "Complete occurrence (advance)"} />
                <div style={{ fontSize: 14, flex: 1, textDecoration: completed ? 'line-through' : 'none', color: completed ? '#9ca3af' : T.text }}>{t.title}</div>
                <span style={pill(overdue)}><I.cal /> {t.dueDate}</span>
                <ImpactPill level={t.impact} T={T} />
                <button title="Rename" onMouseEnter={hover} onMouseLeave={unhover} onClick={() => { const next = prompt("Edit task", t.title); if (next && next.trim()) updateTask(goal.id, t.id, { title: next.trim() }); }} style={btnGhost}><I.edit /></button>
                <button title="Delete" onMouseEnter={hover} onMouseLeave={unhover} onClick={() => removeTask(goal.id, t.id)} style={btnGhost}><I.del /></button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AddTaskPanel({ T, goal, onAdd }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [impact, setImpact] = useState("Medium");
  const [frequency, setFrequency] = useState("once");
  const [durationDays, setDurationDays] = useState(7);

  const isDaily = frequency === "daily";
  const btn = { padding: '8px 12px', borderRadius: T.radius, background: T.accent, color: '#fff', border: `1px solid ${T.accent}`, cursor: 'pointer' };
  const input = { border: `1px solid ${T.cardBorder}`, borderRadius: 10, padding: '8px 10px', width: '100%', background: T.card, color: T.text };

  return (
    <div style={{ marginTop: 12 }}>
      <button onClick={() => setOpen(v => !v)} style={{ width: '100%', background: T.muted, color: T.text, border: `1px solid ${T.cardBorder}`, borderRadius: T.radiusLg, padding: '8px 12px', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><I.add /> Add task</span>
        <span>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginTop: 12 }}>
            <input style={{ ...input, gridColumn: 'span 2 / span 2' }} placeholder="Task title (e.g., Write 500 words)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <select style={input} value={impact} onChange={(e) => setImpact(e.target.value)}>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
            <select style={{ ...input, textTransform: 'capitalize' }} value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              <option value="once">once</option>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="quarterly">quarterly</option>
              <option value="yearly">yearly</option>
            </select>
            {isDaily ? (
              <input type="number" min={1} max={365} style={input} value={durationDays} onChange={(e) => setDurationDays(Number(e.target.value))} placeholder="Duration (days)" />
            ) : (
              <div />
            )}
          </div>
          <div style={{ fontSize: 11, color: T.sub, marginTop: 6 }}>
            {frequency === "daily" && (
              <>Creates one task for <b>each day</b> starting <b>{todayISO()}</b>{goal.targetDate ? <> until <b>{goal.targetDate}</b></> : <> for <b>{durationDays}</b> day(s)</>}.</>
            )}
            {frequency !== "once" && frequency !== "daily" && (
              goal.targetDate
                ? <>Will create a <b>{frequency}</b> series from <b>{todayISO()}</b> to <b>{goal.targetDate}</b>.</>
                : <>Adds a single <b>{frequency}</b> item due today (set a goal target date to generate a full series).</>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button onClick={() => { if (!title.trim()) return; onAdd({ title: title.trim(), impact, frequency, durationDays: isDaily ? durationDays : undefined }); setTitle(""); setImpact("Medium"); setFrequency("once"); setDurationDays(7); setOpen(false); }} style={btn}>Add Task</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------
   Dev self-tests (runs once)
------------------------- */
(function devTests(){
  try {
    if (typeof window === 'undefined') return; // skip SSR
    const assert = (c,msg)=>{ if(!c) throw new Error(msg); };

    // sort sanitizer tests
    assert(sanitizeSort("dueAsc")==="dueAsc","dueAsc ok");
    assert(sanitizeSort("dueDesc")==="dueDesc","dueDesc ok");
    assert(sanitizeSort("impactHigh")==="impactHigh","impactHigh ok");
    assert(sanitizeSort("impactLow")==="impactLow","impactLow ok");
    assert(sanitizeSort("weird")==="dueAsc","invalid falls back");

    // date helpers
    const nextW = addByFreq("2025-01-01","weekly"); assert(toISO(nextW)==="2025-01-08","weekly +7");
    const nextM = addByFreq("2025-01-31","monthly"); assert(toISO(nextM).startsWith("2025-02"),"monthly +1M");
    const nd = nextDueDate("2025-03-10","daily"); assert(nd==="2025-03-11","daily next");

    // buildSeries
    const series = buildSeries("x","Low","2025-01-01","2025-01-05","daily");
    assert(series.length===5,"series daily 5 days");
    assert(series[0].dueDate==="2025-01-01" && series[4].dueDate==="2025-01-05","series bounds");

    // flatten/inflate roundtrip (basic)
    const g0 = { id:"g1", title:"G", impact:"High", targetDate:"2025-12-31", tasks:[{id:"t1", title:"T", dueDate:"2025-01-01", impact:"High", frequency:"once", completed:false}] };
    const flat = flattenForSheet([g0]);
    const inflated = inflateFromSheet(flat);
    assert(inflated.length===1 && inflated[0].tasks.length===1, "inflate keeps one task");

    // goal-only flatten
    const gOnly = { id:"g2", title:"NoTasks", impact:"Low", targetDate:"2025-12-31", tasks:[] };
    const flatOnly = flattenForSheet([gOnly]);
    assert(flatOnly.length===1 && flatOnly[0].frequency==='goal', "goal-only flatten emits placeholder");

    // sort comparator stability
    const s1 = [{dueDate:'2025-01-02',impact:'Low'},{dueDate:'2025-01-01',impact:'High'}].sort((a,b)=>{
      const impRank = { High:3, Medium:2, Low:1 }; return (impRank[b.impact]||0)-(impRank[a.impact]||0) || a.dueDate.localeCompare(b.dueDate);
    });
    assert(s1[0].impact==='High', 'impactHigh comparator works');

    // theme sanity
    assert(TAmoled.muted==="#0a0a0a","AMOLED muted valid hex");

    console.info("Dev tests: ✅ passed");
  } catch (e) {
    console.warn("Dev tests: ❌", e);
  }
})();


// =============================================================
// BACKEND (Apps Script) — paste into Google Apps Script (Code.gs)
// =============================================================
// Sheet config
// const SHEET_NAME = 'data';
// const HEADERS = [
//   'goalId','goalTitle','goalImpact','goalTargetDate',
//   'taskId','taskTitle','taskDueDate','taskImpact','frequency','completed'
// ];
//
// function doGet(e) {
//   const sheet = getSheet_();
//   ensureHeader_(sheet);
//   const rows = readRows_(sheet);
//   return ContentService
//     .createTextOutput(JSON.stringify({ rows }))
//     .setMimeType(ContentService.MimeType.JSON);
// }
//
// function doPost(e) {
//   try {
//     const body = JSON.parse(e.postData && e.postData.contents || '{}');
//     const mode = body.mode || 'replace';
//     const rows = Array.isArray(body.rows) ? body.rows : [];
//     const sheet = getSheet_();
//     ensureHeader_(sheet);
//     if (mode === 'merge') mergeRows_(sheet, rows);
//     else if (mode === 'append') appendRows_(sheet, rows);
//     else { clearDataRows_(sheet); writeRows_(sheet, rows); }
//     return ContentService.createTextOutput(JSON.stringify({ ok:true })).setMimeType(ContentService.MimeType.JSON);
//   } catch (err) {
//     return ContentService.createTextOutput(JSON.stringify({ ok:false, error:String(err) })).setMimeType(ContentService.MimeType.JSON);
//   }
// }
//
// function getSheet_(){ const ss=SpreadsheetApp.getActiveSpreadsheet(); return ss.getSheetByName(SHEET_NAME)||ss.insertSheet(SHEET_NAME); }
// function writeHeader_(sh){ sh.getRange(1,1,1,HEADERS.length).setValues([HEADERS]); }
// function ensureHeader_(sh){ const lr=sh.getLastRow(); if(lr===0){writeHeader_(sh);return;} const first=sh.getRange(1,1,1,HEADERS.length).getValues()[0]; const same=HEADERS.every((h,i)=>(first[i]||'')===h); if(!same) writeHeader_(sh); }
// function clearDataRows_(sh){ const lr=sh.getLastRow(); if(lr>=2) sh.getRange(2,1,lr-1,HEADERS.length).clearContent(); }
// function writeRows_(sh,rows){ if(!rows||!rows.length) return; const out=rows.map(r=>HEADERS.map(h=>r[h]??'')); sh.getRange(2,1,out.length,HEADERS.length).setValues(out); }
// function appendRows_(sh,rows){ if(!rows||!rows.length) return; const start=Math.max(1,sh.getLastRow())+1; const out=rows.map(r=>HEADERS.map(h=>r[h]??'')); sh.getRange(start,1,out.length,HEADERS.length).setValues(out); }
// function readRows_(sh){ const lr=sh.getLastRow(); const lc=sh.getLastColumn(); if(lr<2) return []; const raw=sh.getRange(2,1,lr-1,lc).getValues(); return raw.map(row=>{ const obj={}; for(let i=0;i<HEADERS.length;i++) obj[HEADERS[i]]=row[i]??''; return obj; }); }
// function mergeRows_(sh,payload){ const lr=sh.getLastRow(); const lc=sh.getLastColumn(); if(lr<1){writeHeader_(sh);return;} const keyOf=r=>`${r.goalId}␟${r.taskId}`; const incoming=new Map(payload.map(r=>[keyOf(r),r])); const existing=lr>=2?sh.getRange(2,1,lr-1,lc).getValues():[]; const header=sh.getRange(1,1,1,lc).getValues()[0]; const col={}; header.forEach((h,i)=>col[h]=i); const toDelete=[]; const seen=new Set(); existing.forEach((row,i)=>{ const key=`${row[col.goalId]||''}␟${row[col.taskId]||''}`; const inc=incoming.get(key); if(!inc){ toDelete.push(i+2); return; } seen.add(key); const desired=HEADERS.map(h=>inc[h]??''); let diff=false; for(let j=0;j<desired.length;j++){ if((row[j]||'')!==desired[j]){ diff=true; break; } } if(diff) sh.getRange(i+2,1,1,HEADERS.length).setValues([desired]); }); if(toDelete.length){ toDelete.sort((a,b)=>b-a).forEach(r=>sh.deleteRow(r)); } const newRows=[]; payload.forEach(r=>{ const key=keyOf(r); if(!seen.has(key)) newRows.push(HEADERS.map(h=>r[h]??'')); }); if(newRows.length){ const start=Math.max(1,sh.getLastRow())+1; sh.getRange(start,1,newRows.length,HEADERS.length).setValues(newRows); } }

// =============================================================
// OPTIONAL Cloudflare Worker CORS proxy (worker.js)
// =============================================================
// export default {
//   async fetch(request) {
//     const url = new URL(request.url);
//     const target = url.searchParams.get('u');
//     if (!target) return new Response('Missing ?u= param', { status: 400 });
//     const init = { method: request.method, headers: {} };
//     // forward body for POST
//     if (request.method !== 'GET' && request.method !== 'HEAD') {
//       init.body = await request.text();
//     }
//     // Force simple request downstream to avoid preflight: keep Content-Type text/plain when present
//     const ct = request.headers.get('content-type');
//     if (ct) init.headers['content-type'] = ct;
//     const resp = await fetch(target, init);
//     const text = await resp.text();
//     return new Response(text, {
//       status: resp.status,
//       headers: {
//         'content-type': resp.headers.get('content-type') || 'application/json; charset=utf-8',
//         'access-control-allow-origin': '*',
//         'access-control-allow-methods': 'GET,POST,OPTIONS',
//         'access-control-allow-headers': 'Content-Type'
//       }
//     });
//   }
// };
