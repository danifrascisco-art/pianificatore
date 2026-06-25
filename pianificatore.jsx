import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Check, Target, ChevronLeft, ChevronRight, RotateCcw, Flame, Download, Upload, FileText, Copy, X, Layers, Repeat, Settings, Bell, Calendar } from "lucide-react";

const GIORNI = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
const SHORT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const MESI_S = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const STORAGE_KEY = "pianificatore:v2";

const DEFAULT_CATS = [
  { key: "lab", label: "Laboratorio", color: "#CC7A33" },
  { key: "social", label: "Social", color: "#3F6FA3" },
  { key: "studio", label: "Studio", color: "#C2A23A" },
  { key: "sport", label: "Allenamento", color: "#5C7A52" },
  { key: "pers", label: "Personale", color: "#8A6FB0" },
];
const PALETTE = [
  "#C2A23A", "#DCC06B", // giallo spento + sfumatura
  "#CC7A33", "#E0A165", // arancio + sfumatura
  "#B5413B", "#CE7269", // rosso + sfumatura
  "#5C7A52", "#86A476", // verde + sfumatura
  "#3F6FA3", "#6F99C2", // blu + sfumatura
  "#8A6FB0", "#AE95CE", // viola + sfumatura
];
const tint = (hex, a = 0.85) => {
  const h = (hex || "#888888").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c + (247 - c) * a);
  return `#${[mix(r), mix(g), mix(b)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};
const sanitizeCats = (stored) => Array.isArray(stored) && stored.length
  ? stored.map((c, i) => ({ key: c.key || "c" + i + "_" + Math.random().toString(36).slice(2, 6), label: c.label || "Categoria", color: c.color || PALETTE[i % PALETTE.length] }))
  : DEFAULT_CATS;

// --- date helpers
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const j = x.getDay(); x.setDate(x.getDate() + (j === 0 ? -6 : 1 - j)); return x; };
const parseHM = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec((s || "").trim()); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const bandHours = (r) => { const a = parseHM(r.start), b = parseHM(r.end); if (a == null || b == null) return 0; let d = b - a; if (d < 0) d += 1440; return d / 60; };
const daysBetween = (aISO, bISO) => Math.round((fromISO(bISO).getTime() - fromISO(aISO).getTime()) / 86400000);
const weekdayIndex = (date) => (date.getDay() === 0 ? 6 : date.getDay() - 1); // Lun=0 … Dom=6
const hobbyDueOn = (h, date) => {
  if (!h) return false;
  if (h.mode === "interval") {
    if (!h.anchor || !(h.interval > 0)) return false;
    const diff = daysBetween(h.anchor, toISO(date));
    return diff >= 0 && diff % h.interval === 0;
  }
  return !!(h.weekdays && h.weekdays[weekdayIndex(date)]);
};

const emptyDays = () => Array.from({ length: 7 }, () => ({ text: "", category: null, done: false }));
const DEFAULT_ROWS = [
  { id: "r1", start: "08:00", end: "10:00" }, { id: "r2", start: "10:00", end: "12:00" },
  { id: "r3", start: "12:00", end: "14:00" }, { id: "r4", start: "14:00", end: "16:00" },
  { id: "r5", start: "16:00", end: "18:00" }, { id: "r6", start: "18:00", end: "20:00" },
  { id: "r7", start: "20:00", end: "22:00" },
];
const blankWeek = () => ({ cells: {}, notes: ["", "", "", "", "", "", ""] });
const DEFAULT = { rows: DEFAULT_ROWS, weeks: {}, current: toISO(mondayOf(new Date())), goals: [], month: MESI[new Date().getMonth()], appunti: "", cats: DEFAULT_CATS, hobbies: [], todos: [] };

const copyCellsResetDone = (cells) => {
  const out = {};
  Object.keys(cells || {}).forEach((k) => { out[k] = cells[k].map((c) => ({ text: c.text || "", category: c.category || null, done: false })); });
  return out;
};
const inheritFrom = (weeks, iso) => {
  const target = fromISO(iso).getTime();
  const keys = Object.keys(weeks || {}).filter((k) => fromISO(k).getTime() < target).sort((a, b) => fromISO(b) - fromISO(a));
  for (const k of keys) {
    const w = weeks[k];
    const hasText = w && w.cells && Object.values(w.cells).some((arr) => arr.some((c) => c.text && c.text.trim()));
    if (hasText) return { cells: copyCellsResetDone(w.cells), notes: ["", "", "", "", "", "", ""] };
  }
  return blankWeek();
};

const normalize = (s) => ({
  rows: Array.isArray(s.rows) && s.rows.length ? s.rows.map((r, i) => ({ id: r.id || "r" + i, start: r.start || "", end: r.end || "" })) : DEFAULT_ROWS,
  weeks: s.weeks && typeof s.weeks === "object" ? s.weeks : {},
  current: s.current || toISO(mondayOf(new Date())),
  goals: Array.isArray(s.goals) ? s.goals.map((g) => ({ id: g.id || "g" + Math.random().toString(36).slice(2), text: g.text || "", progress: g.progress || 0, mode: g.mode === "auto" ? "auto" : "manual", category: g.category || DEFAULT_CATS[0].key, target: g.target || 0 })) : [],
  month: s.month || MESI[new Date().getMonth()],
  appunti: s.appunti || "",
  cats: sanitizeCats(s.cats),
  hobbies: Array.isArray(s.hobbies) ? s.hobbies.map((h, i) => ({
    id: h.id || "h" + i + "_" + Math.random().toString(36).slice(2, 6),
    name: h.name || "",
    color: h.color || PALETTE[i % PALETTE.length],
    mode: h.mode === "interval" ? "interval" : "weekly",
    weekdays: Array.isArray(h.weekdays) && h.weekdays.length === 7 ? h.weekdays.map(Boolean) : [false, false, false, false, false, false, false],
    interval: h.interval > 0 ? Math.round(h.interval) : 2,
    anchor: h.anchor || toISO(new Date()),
    done: h.done && typeof h.done === "object" ? h.done : {},
  })) : [],
  todos: Array.isArray(s.todos) ? s.todos.map((t, i) => ({
    id: t.id || "t" + i + "_" + Math.random().toString(36).slice(2, 6),
    text: t.text || "",
    due: t.due || null,
    done: !!t.done,
  })) : [],
});

const useIsDesktop = () => {
  const [desk, setDesk] = useState(typeof window !== "undefined" && window.innerWidth >= 768);
  useEffect(() => {
    const h = () => setDesk(window.innerWidth >= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return desk;
};

// ─── Sync via jsonblob.com ────────────────────────────────────────────────────
const BLOB_API = "https://jsonblob.com/api/jsonBlob";
const SYNC_LS = "pian:sync:v1";
const syncStore = {
  get: () => { try { return JSON.parse(localStorage.getItem(SYNC_LS)) || {}; } catch { return {}; } },
  set: (v) => { try { localStorage.setItem(SYNC_LS, JSON.stringify(v)); } catch {} },
};
const blobCreate = async (payload) => {
  const res = await fetch(BLOB_API, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error("create");
  const loc = res.headers.get("Location") || res.url || "";
  const id = loc.split("/").pop();
  if (!id || id.length < 5) throw new Error("no_id");
  return id;
};
const blobPut = async (id, payload) => {
  const res = await fetch(`${BLOB_API}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error("put");
};
const blobGet = async (id) => {
  const res = await fetch(`${BLOB_API}/${id}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("get");
  return res.json();
};
const fmtSyncTime = (iso) => { if (!iso) return "mai"; const d = new Date(iso); return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };

export default function App() {
  const [data, setData] = useState(DEFAULT);
  const [page, setPage] = useState("week");
  const [loading, setLoading] = useState(true);
  const [goalText, setGoalText] = useState("");
  const [editor, setEditor] = useState(null); // {rowId, day}
  const [syncInfo, setSyncInfo] = useState({ code: null, lastSync: null, status: "idle", joinInput: "" });
  const fileRef = useRef(null);
  const loadedRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const ss = syncStore.get();
    if (ss.code) setSyncInfo((s) => ({ ...s, code: ss.code, lastSync: ss.lastSync || null }));
    (async () => {
      try { const res = await window.storage.get(STORAGE_KEY); if (res && res.value) setData(normalize(JSON.parse(res.value))); }
      catch {} finally { loadedRef.current = true; setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => window.storage.set(STORAGE_KEY, JSON.stringify(data)).catch(() => {}), 500);
    return () => clearTimeout(timerRef.current);
  }, [data]);

  // Auto-push to cloud when data changes and sync is active
  const syncCode = syncInfo.code;
  useEffect(() => {
    if (!syncCode || !loadedRef.current) return;
    const t = setTimeout(async () => {
      setSyncInfo((s) => ({ ...s, status: "pushing" }));
      try {
        await blobPut(syncCode, data);
        const now = new Date().toISOString();
        setSyncInfo((s) => ({ ...s, lastSync: now, status: "ok" }));
        syncStore.set({ code: syncCode, lastSync: now });
      } catch { setSyncInfo((s) => ({ ...s, status: "error" })); }
    }, 2000);
    return () => clearTimeout(t);
  }, [data, syncCode]);

  const handleCreateSync = async () => {
    setSyncInfo((s) => ({ ...s, status: "creating" }));
    try {
      const code = await blobCreate(data);
      const now = new Date().toISOString();
      setSyncInfo({ code, lastSync: now, status: "ok", joinInput: "" });
      syncStore.set({ code, lastSync: now });
    } catch { setSyncInfo((s) => ({ ...s, status: "error" })); }
  };
  const handleJoinSync = async () => {
    const code = (syncInfo.joinInput || "").trim(); if (!code) return;
    setSyncInfo((s) => ({ ...s, status: "pulling" }));
    try {
      const remote = await blobGet(code);
      setData(normalize(remote));
      const now = new Date().toISOString();
      setSyncInfo({ code, lastSync: now, status: "ok", joinInput: "" });
      syncStore.set({ code, lastSync: now });
    } catch { setSyncInfo((s) => ({ ...s, status: "error" })); }
  };
  const handlePullSync = async () => {
    if (!syncInfo.code) return;
    setSyncInfo((s) => ({ ...s, status: "pulling" }));
    try {
      const remote = await blobGet(syncInfo.code);
      setData(normalize(remote));
      const now = new Date().toISOString();
      setSyncInfo((s) => ({ ...s, lastSync: now, status: "ok" }));
      syncStore.set({ code: syncInfo.code, lastSync: now });
    } catch { setSyncInfo((s) => ({ ...s, status: "error" })); }
  };
  const handleDisconnectSync = () => {
    setSyncInfo({ code: null, lastSync: null, status: "idle", joinInput: "" });
    syncStore.set({});
  };

  const stored = data.weeks[data.current];
  const wk = stored || inheritFrom(data.weeks, data.current);
  const isInherited = !stored && Object.values(wk.cells || {}).some((arr) => arr.some((c) => c.text && c.text.trim()));
  const start = fromISO(data.current);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const todayISO = toISO(new Date());
  const getCell = (rowId, day) => (wk.cells[rowId] && wk.cells[rowId][day]) || { text: "", category: null, done: false };
  const cats = (data.cats || DEFAULT_CATS).map((c) => ({ ...c, bg: tint(c.color) }));
  const catOf = (k) => cats.find((c) => c.key === k) || null;
  const setCat = (key, patch) => setData((s) => ({ ...s, cats: (s.cats || DEFAULT_CATS).map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  const addCat = () => setData((s) => {
    const list = s.cats || DEFAULT_CATS; const used = new Set(list.map((c) => c.color));
    const color = PALETTE.find((p) => !used.has(p)) || PALETTE[list.length % PALETTE.length];
    return { ...s, cats: [...list, { key: "c" + Date.now(), label: "Nuova categoria", color }] };
  });
  const delCat = (key) => setData((s) => {
    const remaining = (s.cats || []).filter((c) => c.key !== key);
    const fallback = remaining[0] ? remaining[0].key : null;
    const weeks = {};
    Object.keys(s.weeks).forEach((wkk) => {
      const w = s.weeks[wkk]; const cells = {};
      Object.keys(w.cells || {}).forEach((rid) => { cells[rid] = w.cells[rid].map((c) => (c.category === key ? { ...c, category: null } : c)); });
      weeks[wkk] = { ...w, cells };
    });
    return {
      ...s, cats: remaining, weeks,
      goals: s.goals.map((g) => (g.category === key ? { ...g, category: fallback } : g)),
    };
  });

  const editWeek = (fn) => setData((s) => {
    const iso = s.current; const cur = s.weeks[iso] || inheritFrom(s.weeks, iso);
    return { ...s, weeks: { ...s.weeks, [iso]: fn(cur) } };
  });
  const setCell = (rowId, day, patch) => editWeek((cur) => {
    const arr = cur.cells[rowId] ? [...cur.cells[rowId]] : emptyDays();
    arr[day] = { ...(arr[day] || { text: "", category: null, done: false }), ...patch };
    return { ...cur, cells: { ...cur.cells, [rowId]: arr } };
  });
  const copyRowAcross = (rowId, day) => editWeek((cur) => {
    const arr = cur.cells[rowId] ? [...cur.cells[rowId]] : emptyDays();
    const src = arr[day] || { text: "", category: null, done: false };
    for (let i = 0; i < 7; i++) if (i !== day) arr[i] = { text: src.text, category: src.category, done: false };
    return { ...cur, cells: { ...cur.cells, [rowId]: arr } };
  });
  const setNote = (day, val) => editWeek((cur) => ({ ...cur, notes: cur.notes.map((n, i) => (i === day ? val : n)) }));
  const resetWeek = () => editWeek((cur) => {
    const cells = {}; Object.keys(cur.cells).forEach((k) => { cells[k] = cur.cells[k].map((c) => ({ ...c, done: false })); });
    return { ...cur, cells };
  });

  const setBand = (rid, field, val) => setData((s) => ({ ...s, rows: s.rows.map((r) => (r.id === rid ? { ...r, [field]: val } : r)) }));
  const addRow = () => setData((s) => ({ ...s, rows: [...s.rows, { id: "r" + Date.now(), start: "", end: "" }] }));
  const addRowAt = (idx) => setData((s) => {
    const rows = [...s.rows];
    rows.splice(idx, 0, { id: "r" + Date.now(), start: "", end: "" });
    return { ...s, rows };
  });
  const delRow = (rid) => setData((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== rid) }));

  const shiftWeek = (n) => setData((s) => ({ ...s, current: toISO(addDays(fromISO(s.current), n * 7)) }));
  const thisWeek = () => setData((s) => ({ ...s, current: toISO(mondayOf(new Date())) }));

  const addGoal = () => { if (!goalText.trim()) return; setData((s) => ({ ...s, goals: [...s.goals, { id: "g" + Date.now(), text: goalText.trim(), progress: 0, mode: "manual", category: DEFAULT_CATS[0].key, target: 10 }] })); setGoalText(""); };
  const setGoal = (id, patch) => setData((s) => ({ ...s, goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
  const delGoal = (id) => setData((s) => ({ ...s, goals: s.goals.filter((g) => g.id !== id) }));

  // ── Hobby / attività ricorrenti ──
  const addHobby = () => setData((s) => ({ ...s, hobbies: [...(s.hobbies || []), { id: "h" + Date.now(), name: "", color: PALETTE[(s.hobbies || []).length % PALETTE.length], mode: "weekly", weekdays: [false, false, false, false, false, false, false], interval: 2, anchor: todayISO, done: {} }] }));
  const setHobby = (id, patch) => setData((s) => ({ ...s, hobbies: (s.hobbies || []).map((h) => (h.id === id ? { ...h, ...patch } : h)) }));
  const delHobby = (id) => setData((s) => ({ ...s, hobbies: (s.hobbies || []).filter((h) => h.id !== id) }));
  const toggleHobbyDay = (id, wd) => setData((s) => ({ ...s, hobbies: (s.hobbies || []).map((h) => (h.id === id ? { ...h, weekdays: (h.weekdays || [false, false, false, false, false, false, false]).map((v, i) => (i === wd ? !v : v)) } : h)) }));
  const toggleHobbyDone = (id, iso) => setData((s) => ({ ...s, hobbies: (s.hobbies || []).map((h) => { if (h.id !== id) return h; const done = { ...(h.done || {}) }; if (done[iso]) delete done[iso]; else done[iso] = true; return { ...h, done }; }) }));

  // ── To-do con scadenza ──
  const addTodo = (text, due) => { const t = (text || "").trim(); if (!t) return; setData((s) => ({ ...s, todos: [...(s.todos || []), { id: "t" + Date.now(), text: t, due: due || null, done: false }] })); };
  const setTodo = (id, patch) => setData((s) => ({ ...s, todos: (s.todos || []).map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const delTodo = (id) => setData((s) => ({ ...s, todos: (s.todos || []).filter((t) => t.id !== id) }));
  const toggleTodo = (id) => setData((s) => ({ ...s, todos: (s.todos || []).map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }));

  // conteggio attività completate per categoria nel mese selezionato (per obiettivi automatici)
  const monthIdx = MESI.indexOf(data.month);
  const autoDone = (cat) => {
    let n = 0;
    Object.keys(data.weeks).forEach((k) => {
      const monday = fromISO(k); const w = data.weeks[k];
      Object.keys(w.cells || {}).forEach((rid) => w.cells[rid].forEach((c, di) => {
        if (c.done && c.category === cat && addDays(monday, di).getMonth() === monthIdx) n++;
      }));
    });
    return n;
  };
  const goalPctOf = (g) => g.mode === "auto" ? (g.target > 0 ? Math.min(100, Math.round(autoDone(g.category) / g.target * 100)) : 0) : (g.progress || 0);
  const goalsPct = data.goals.length ? Math.round(data.goals.reduce((s, g) => s + goalPctOf(g), 0) / data.goals.length) : 0;

  // export / import
  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `pianificatore-backup-${todayISO}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const importData = (file) => { const r = new FileReader(); r.onload = () => { try { setData(normalize(JSON.parse(r.result))); } catch { alert("File non valido"); } }; r.readAsText(file); };
  const exportWeekText = () => {
    let t = `Settimana ${weekLabel} ${dates[0].getFullYear()}\n\n`;
    dates.forEach((d, di) => {
      t += `${GIORNI[di]} ${d.getDate()} ${MESI_S[d.getMonth()]}\n`;
      const lines = data.rows.map((r) => { const c = getCell(r.id, di); return c.text.trim() ? `  ${bandLabel(r)}  ${c.text}${c.category ? " [" + catOf(c.category).label + "]" : ""}` : null; }).filter(Boolean);
      t += (lines.length ? lines.join("\n") : "  —") + "\n\n";
    });
    const blob = new Blob([t], { type: "text/plain" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `settimana-${data.current}.txt`; a.click(); URL.revokeObjectURL(url);
  };

  const weekLabel = (() => {
    const a = dates[0], b = dates[6];
    const m = a.getMonth() === b.getMonth() ? MESI_S[a.getMonth()] : `${MESI_S[a.getMonth()]}–${MESI_S[b.getMonth()]}`;
    return `${a.getDate()} – ${b.getDate()} ${m}`;
  })();

  const isDesktop = useIsDesktop();
  const COL = 116;

  return (
    <div style={{ ...S.page, maxWidth: isDesktop ? "none" : 520, padding: isDesktop ? "20px 32px 40px" : "16px 14px 40px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Hanken+Grotesk:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        input, textarea, select { font-family: 'Hanken Grotesk', sans-serif; }
        input:focus, textarea:focus, select:focus { outline: none; }
        input::placeholder, textarea::placeholder { color: #BCB1A0; }
        .nav::-webkit-scrollbar { display: none; }
        .scroll::-webkit-scrollbar { height: 7px; }
        .scroll::-webkit-scrollbar-thumb { background: #D8CEBF; border-radius: 99px; }
        .tap:active { transform: scale(.9); }
        .fadein { animation: f .3s ease both; }
        .rise { animation: r .25s ease both; }
        @keyframes f { from { opacity: 0; transform: translateY(5px);} to { opacity:1; transform:none;} }
        @keyframes r { from { opacity: 0; transform: translateY(20px);} to { opacity:1; transform:none;} }
        input[type=range] { accent-color: #5C7A52; }
      `}</style>

      <div className="nav" style={S.nav}>
        <Pill active={page === "week"} onClick={() => setPage("week")}>Settimana</Pill>
        {SHORT.map((s, i) => <Pill key={i} active={page === i} today={toISO(dates[i]) === todayISO} onClick={() => setPage(i)}>{s}</Pill>)}
        <Pill active={page === "hobby"} onClick={() => setPage("hobby")}><Repeat size={12} style={{ marginRight: 4 }} />Hobby</Pill>
        <Pill active={page === "todo"} onClick={() => setPage("todo")}><Bell size={12} style={{ marginRight: 4 }} />Da fare</Pill>
        <Pill active={page === "settings"} onClick={() => setPage("settings")}><Settings size={13} /></Pill>
      </div>

      {loading ? <p style={S.loading}>Carico…</p> : page === "week" ? (
        /* ===================== PAGINA 1 — TABELLA ===================== */
        <div className="fadein">
          <header style={S.headRow}><div><p style={S.kicker}>Panoramica</p><h1 style={S.h1}>Settimana</h1></div></header>
          <div style={S.weekSel}>
            <button className="tap" onClick={() => shiftWeek(-1)} style={S.weekArrow} aria-label="Precedente"><ChevronLeft size={18} /></button>
            <button onClick={thisWeek} style={S.weekLabelBtn}>
              <span style={S.weekLabel}>{weekLabel}</span>
              <span style={S.weekYear}>{dates[0].getFullYear()} · tocca per oggi</span>
            </button>
            <button className="tap" onClick={() => shiftWeek(1)} style={S.weekArrow} aria-label="Successiva"><ChevronRight size={18} /></button>
          </div>
          <p style={{ ...S.hint, color: isInherited ? "#C0552B" : "#A89C8A", fontWeight: isInherited ? 600 : 400 }}>
            {isInherited ? "↺ copiata dalla settimana precedente — modifica per personalizzarla" : "← scorri · tocca il pallino di una casella per categoria e opzioni"}
          </p>

          <div className="scroll" style={{ ...S.scroll, overflowX: isDesktop ? "visible" : "auto" }}>
            <table style={{ ...S.table, width: isDesktop ? "100%" : undefined, tableLayout: isDesktop ? "fixed" : undefined }}>
              <thead><tr>
                <th style={S.corner}>Ora</th>
                {SHORT.map((g, i) => {
                  const isT = toISO(dates[i]) === todayISO;
                  return <th key={i} style={{ ...S.dayHead, width: isDesktop ? undefined : COL, minWidth: isDesktop ? undefined : COL, background: isT ? "#1A1714" : "#EFE8DB", color: isT ? "#F7F3EC" : "#6B6151" }}>
                    <span>{g}</span><span style={{ ...S.dayHeadDate, color: isT ? "#E7C9B8" : "#A89C8A" }}>{dates[i].getDate()}</span>
                  </th>;
                })}
              </tr></thead>
              <tbody>
                {data.rows.map((r, rowIdx) => (
                  <tr key={r.id}>
                    <th style={S.timeCell}>
                      <div style={S.bandWrap}>
                        <input value={r.start} onChange={(e) => setBand(r.id, "start", e.target.value)} placeholder="inizio" style={S.bandInput} />
                        <span style={S.bandDash} />
                        <input value={r.end} onChange={(e) => setBand(r.id, "end", e.target.value)} placeholder="fine" style={S.bandInput} />
                      </div>
                      <div style={S.rowBtns}>
                        <button className="tap" onClick={() => addRowAt(rowIdx + 1)} style={S.insertInline} aria-label="Inserisci fascia sotto">+</button>
                        <button onClick={() => delRow(r.id)} style={S.delRow} aria-label="Elimina fascia"><Trash2 size={12} /></button>
                      </div>
                    </th>
                    {dates.map((_, di) => {
                      const c = getCell(r.id, di); const cat = catOf(c.category);
                      return (
                        <td key={di} style={{ ...S.cell, width: isDesktop ? undefined : COL, minWidth: isDesktop ? undefined : COL, background: cat ? cat.bg : "#FCFAF5" }}>
                          <button className="tap" onClick={() => setEditor({ rowId: r.id, day: di })} aria-label="Opzioni casella"
                            style={{ ...S.catDot, background: cat ? cat.color : "#fff", borderColor: cat ? cat.color : "#D2C8B8" }} />
                          <textarea value={c.text} onChange={(e) => setCell(r.id, di, { text: e.target.value })} placeholder="—" rows={2} style={S.cText} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={S.actions}>
            <button className="tap" onClick={addRow} style={S.addBtnFull}><Plus size={18} strokeWidth={2.5} /> Aggiungi fascia oraria</button>
            <button className="tap" onClick={resetWeek} style={S.resetBtn}><RotateCcw size={13} /> Azzera</button>
          </div>
        </div>
      ) : page === "hobby" ? (
        /* ===================== HOBBY · ATTIVITÀ RICORRENTI ===================== */
        <HobbyPage hobbies={data.hobbies || []} addHobby={addHobby} setHobby={setHobby} delHobby={delHobby} toggleHobbyDay={toggleHobbyDay} />
      ) : page === "todo" ? (
        /* ===================== DA FARE · SCADENZE ===================== */
        <TodoPage todos={data.todos || []} addTodo={addTodo} setTodo={setTodo} delTodo={delTodo} toggleTodo={toggleTodo} todayISO={todayISO} />
      ) : page === "settings" ? (
        /* ===================== PIÙ (bilancio · costanza · appunti · dati) ===================== */
        <MorePage data={data} dates={dates} getCell={getCell} weekLabel={weekLabel} setData={setData}
          exportData={exportData} importData={importData} exportWeekText={exportWeekText} fileRef={fileRef}
          catOf={catOf} cats={cats} setCat={setCat} addCat={addCat} delCat={delCat}
          syncInfo={syncInfo} setSyncInfo={setSyncInfo}
          handleCreateSync={handleCreateSync} handleJoinSync={handleJoinSync}
          handlePullSync={handlePullSync} handleDisconnectSync={handleDisconnectSync} />
      ) : (
        /* ===================== PAGINA GIORNO ===================== */
        <DayPage key={String(page) + data.current} di={page} date={dates[page]} name={GIORNI[page]}
          isToday={toISO(dates[page]) === todayISO} rows={data.rows} getCell={getCell} setCell={setCell}
          note={wk.notes[page]} setNote={setNote} catOf={catOf}
          hobbies={data.hobbies || []} toggleHobbyDone={toggleHobbyDone}
          todos={data.todos || []} toggleTodo={toggleTodo} />
      )}

      {/* ===================== EDITOR CASELLA (bottom sheet) ===================== */}
      {editor && (() => {
        const c = getCell(editor.rowId, editor.day); const row = data.rows.find((r) => r.id === editor.rowId);
        return (
          <div style={S.backdrop} onClick={() => setEditor(null)}>
            <div className="rise" style={S.sheet} onClick={(e) => e.stopPropagation()}>
              <div style={S.sheetHead}>
                <div><b style={S.sheetTitle}>{GIORNI[editor.day]} {dates[editor.day].getDate()}</b><span style={S.sheetBand}>{bandLabel(row)}</span></div>
                <button onClick={() => setEditor(null)} style={S.iconBtn}><X size={18} /></button>
              </div>
              <textarea autoFocus value={c.text} onChange={(e) => setCell(editor.rowId, editor.day, { text: e.target.value })} placeholder="Cosa fare in questa fascia…" rows={2} style={S.sheetInput} />
              <p style={S.sheetLbl}>Categoria</p>
              <div style={S.catRow}>
                {cats.map((cat) => { const sel = c.category === cat.key; return <button key={cat.key} onClick={() => setCell(editor.rowId, editor.day, { category: sel ? null : cat.key })} style={{ ...S.catChip, background: sel ? cat.color : cat.bg, color: sel ? "#fff" : cat.color, borderColor: cat.color }}>{cat.label}</button>; })}
              </div>
              <div style={S.sheetActions}>
                <button className="tap" onClick={() => { copyRowAcross(editor.rowId, editor.day); setEditor(null); }} style={S.sheetBtn}><Copy size={15} /> Copia su tutti i giorni</button>
                <button className="tap" onClick={() => { setCell(editor.rowId, editor.day, { text: "", category: null, done: false }); setEditor(null); }} style={S.sheetBtnGhost}><Trash2 size={15} /> Svuota</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const bandLabel = (r) => (r && r.start && r.end ? `${r.start}–${r.end}` : (r && (r.start || r.end)) || "—");

function Pill({ active, today, onClick, children }) {
  return <button onClick={onClick} style={{ ...S.pill, background: active ? "#1A1714" : "#EFE8DB", color: active ? "#F7F3EC" : today ? "#C0552B" : "#6B6151", fontWeight: today && !active ? 700 : 600 }}>{children}</button>;
}

function DayPage({ di, date, name, isToday, rows, getCell, setCell, note, setNote, catOf, hobbies, toggleHobbyDone, todos, toggleTodo }) {
  const items = rows.map((r) => ({ r, c: getCell(r.id, di) })).filter((x) => x.c.text.trim().length > 0);
  const done = items.filter((x) => x.c.done).length, tot = items.length, pct = tot ? Math.round((done / tot) * 100) : 0;
  const dISO = toISO(date);

  // hobby ricorrenti previsti per questo giorno
  const dueHobbies = (hobbies || []).filter((h) => h.name && h.name.trim() && hobbyDueOn(h, date));

  // scadenze: in scadenza (oggi · tra 1-2 giorni) + scadute non completate
  const reminders = (todos || [])
    .filter((t) => t.due)
    .map((t) => ({ t, delta: daysBetween(dISO, t.due) }))
    .filter(({ t, delta }) => (delta >= 0 && delta <= 2) || (delta < 0 && !t.done))
    .sort((a, b) => a.delta - b.delta || (a.t.done - b.t.done));
  const remLabel = (delta) => delta < 0 ? `scaduta ${-delta === 1 ? "da 1 giorno" : "da " + -delta + " giorni"}` : delta === 0 ? "scade oggi · da fare" : delta === 1 ? "sta scadendo · tra 1 giorno" : "sta scadendo · tra 2 giorni";
  const remColor = (delta) => delta <= 0 ? "#C0552B" : "#B98A1E";

  return (
    <div className="fadein">
      <header style={S.head}>
        <p style={S.kicker}>{isToday ? "Oggi" : "Giorno"}</p>
        <div style={S.dayHeadRow}>
          <h1 style={S.h1}>{name} <span style={S.dayDate}>{date.getDate()} {MESI_S[date.getMonth()]}</span></h1>
          <div style={S.dayScore}><span style={S.dayScoreNum}>{pct}%</span>{tot > 0 && <span style={S.dayScoreLbl}>{done}/{tot}</span>}</div>
        </div>
      </header>
      {tot > 0 && <div style={S.barTrack}><div style={{ ...S.barFill, width: `${pct}%` }} /></div>}

      {reminders.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <label style={{ ...S.sect, marginTop: 4, color: "#C0552B" }}><Bell size={12} style={{ verticalAlign: -1, marginRight: 5 }} />Scadenze</label>
          <div style={S.dayItems}>
            {reminders.map(({ t, delta }) => (
              <div key={t.id} style={{ ...S.remItem, borderColor: t.done ? "#CBD8C2" : remColor(delta), background: t.done ? "#EEF2EA" : delta <= 0 ? "#FBEDE6" : "#FAF3DF" }}>
                <button className="tap" onClick={() => toggleTodo(t.id)} style={{ ...S.dChk, background: t.done ? "#5C7A52" : "#fff", borderColor: t.done ? "#5C7A52" : remColor(delta), color: t.done ? "#fff" : "transparent" }}><Check size={15} strokeWidth={3} /></button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ ...S.dText, display: "block", textDecoration: t.done ? "line-through" : "none", color: t.done ? "#9A9082" : "#1A1714" }}>{t.text}</span>
                  {!t.done && <span style={{ ...S.remTag, color: remColor(delta) }}>{remLabel(delta)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {dueHobbies.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <label style={S.sect}><Repeat size={11} style={{ verticalAlign: -1, marginRight: 5 }} />Attività ricorrenti</label>
          <div style={S.dayItems}>
            {dueHobbies.map((h) => { const hd = !!(h.done && h.done[dISO]); return (
              <div key={h.id} style={{ ...S.dItem, background: hd ? "#EEF2EA" : "#FCFAF5", borderColor: hd ? "#CBD8C2" : "#EBE3D6" }}>
                <button className="tap" onClick={() => toggleHobbyDone(h.id, dISO)} style={{ ...S.dChk, background: hd ? "#5C7A52" : "#fff", borderColor: hd ? "#5C7A52" : "#D8CEBF", color: hd ? "#fff" : "transparent" }}><Check size={15} strokeWidth={3} /></button>
                <span style={{ ...S.catTag, background: h.color || "#B7AC9B" }} />
                <span style={{ ...S.dText, textDecoration: hd ? "line-through" : "none", color: hd ? "#9A9082" : "#1A1714" }}>{h.name}</span>
              </div>
            ); })}
          </div>
        </div>
      )}

      <label style={S.sect}>Tracker del giorno</label>
      <div style={S.dayItems}>
        {tot === 0 && <p style={S.empty}>Niente per oggi. Pianifica dalla tabella Settimana.</p>}
        {items.map(({ r, c }) => { const cat = catOf(c.category); return (
          <div key={r.id} style={{ ...S.dItem, background: c.done ? "#EEF2EA" : "#FCFAF5", borderColor: c.done ? "#CBD8C2" : "#EBE3D6" }}>
            <button className="tap" onClick={() => setCell(r.id, di, { done: !c.done })} style={{ ...S.dChk, background: c.done ? "#5C7A52" : "#fff", borderColor: c.done ? "#5C7A52" : "#D8CEBF", color: c.done ? "#fff" : "transparent" }}><Check size={15} strokeWidth={3} /></button>
            {cat && <span style={{ ...S.catTag, background: cat.color }} />}
            <span style={S.dTime}>{bandLabel(r)}</span>
            <input value={c.text} onChange={(e) => setCell(r.id, di, { text: e.target.value })} style={{ ...S.dText, textDecoration: c.done ? "line-through" : "none", color: c.done ? "#9A9082" : "#1A1714" }} />
          </div>
        ); })}
      </div>
      <label style={{ ...S.sect, marginTop: 24 }}>Note del giorno</label>
      <textarea value={note} onChange={(e) => setNote(di, e.target.value)} placeholder="Dettagli e cose specifiche da fare oggi…" rows={6} style={S.textarea} />
    </div>
  );
}

function MorePage({ data, dates, getCell, weekLabel, setData, exportData, importData, exportWeekText, fileRef, catOf, cats, setCat, addCat, delCat, syncInfo, setSyncInfo, handleCreateSync, handleJoinSync, handlePullSync, handleDisconnectSync }) {
  // bilancio settimana corrente (per categoria)
  const perCat = {};
  data.rows.forEach((r) => { for (let di = 0; di < 7; di++) { const c = getCell(r.id, di); if (c.text && c.text.trim()) { const key = c.category || "none"; (perCat[key] = perCat[key] || { count: 0, hours: 0, done: 0 }); perCat[key].count++; perCat[key].hours += bandHours(r); if (c.done) perCat[key].done++; } } });
  const maxH = Math.max(1, ...Object.values(perCat).map((v) => v.hours));
  const catKeys = Object.keys(perCat).sort((a, b) => perCat[b].hours - perCat[a].hours);

  return (
    <div className="fadein">
      <header style={S.head}><p style={S.kicker}>Strumenti</p><h1 style={S.h1}>Impostazioni</h1></header>

      <label style={S.sect}>Bilancio per categoria · {weekLabel}</label>
      <div style={S.legend}>
        {catKeys.length === 0 && <p style={S.empty}>Nessuna attività questa settimana.</p>}
        {catKeys.map((k) => { const cat = catOf(k); const v = perCat[k]; return (
          <div key={k} style={S.legRow}>
            <span style={{ ...S.legDot, background: cat ? cat.color : "#B7AC9B" }} />
            <span style={S.legLabel}>{cat ? cat.label : "Senza categoria"}</span>
            <div style={S.legBarTrack}><div style={{ width: `${(v.hours / maxH) * 100}%`, height: "100%", background: cat ? cat.color : "#B7AC9B", borderRadius: 99 }} /></div>
            <span style={S.legVal}>{v.count}× · {v.hours ? v.hours.toFixed(1).replace(".0", "") + "h" : "—"}</span>
          </div>
        ); })}
      </div>

      <label style={{ ...S.sect, marginTop: 22 }}>Categorie</label>
      <div style={S.catEdit}>
        {cats.length === 0 && <p style={S.empty}>Nessuna categoria. Aggiungine una qui sotto.</p>}
        {cats.map((cat) => (
          <div key={cat.key} style={S.catEditRow}>
            <div style={S.catEditTop}>
              <span style={{ ...S.legDot, background: cat.color, width: 13, height: 13 }} />
              <input value={cat.label} onChange={(e) => setCat(cat.key, { label: e.target.value })} placeholder="Nome categoria" style={S.catNameInput} />
              <button onClick={() => delCat(cat.key)} style={S.del} aria-label="Elimina categoria"><Trash2 size={15} /></button>
            </div>
            <div style={S.swatches}>
              {PALETTE.map((col) => (
                <button key={col} className="tap" onClick={() => setCat(cat.key, { color: col })} aria-label="colore"
                  style={{ ...S.swatch, background: col, boxShadow: cat.color === col ? `0 0 0 2px #FCFAF5, 0 0 0 4px ${col}` : "none" }} />
              ))}
            </div>
          </div>
        ))}
        <button className="tap" onClick={addCat} style={S.addCatBtn}><Plus size={16} strokeWidth={2.5} /> Aggiungi categoria</button>
      </div>

      <label style={{ ...S.sect, marginTop: 22 }}>Sincronizzazione</label>
      {!syncInfo.code ? (
        <div style={S.syncBox}>
          <p style={S.syncDesc}>Attiva la sincronizzazione per tenere i dati aggiornati su tutti i tuoi dispositivi automaticamente.</p>
          <button className="tap" onClick={handleCreateSync} disabled={syncInfo.status === "creating"} style={{ ...S.addBtnFull, opacity: syncInfo.status === "creating" ? 0.7 : 1 }}>
            {syncInfo.status === "creating" ? "Creazione in corso…" : "✦ Attiva sincronizzazione"}
          </button>
          <div style={{ ...S.addRow, marginTop: 10 }}>
            <input value={syncInfo.joinInput || ""} onChange={(e) => setSyncInfo((s) => ({ ...s, joinInput: e.target.value, status: "idle" }))} onKeyDown={(e) => e.key === "Enter" && handleJoinSync()} placeholder="Hai già un codice? Inseriscilo…" style={S.addInput} />
            <button className="tap" onClick={handleJoinSync} disabled={syncInfo.status === "pulling"} style={S.addBtn}><ChevronRight size={20} /></button>
          </div>
          {syncInfo.status === "error" && <p style={S.syncError}>⚠ Errore di connessione. Controlla la rete e riprova.</p>}
        </div>
      ) : (
        <div style={S.syncBox}>
          <div style={S.syncStatusRow}>
            <span style={{ ...S.syncDot, background: syncInfo.status === "error" ? "#C0552B" : syncInfo.status === "pushing" || syncInfo.status === "pulling" || syncInfo.status === "creating" ? "#B98A1E" : "#5C7A52" }} />
            <span style={S.syncStatusTxt}>
              {syncInfo.status === "pushing" ? "Salvataggio cloud…" : syncInfo.status === "pulling" ? "Aggiornamento…" : syncInfo.status === "error" ? "Errore di connessione" : `Sincronizzato ${fmtSyncTime(syncInfo.lastSync)}`}
            </span>
          </div>
          <div style={S.codeBox}>
            <span style={S.codeLbl}>Codice sync</span>
            <span style={S.codeVal}>{syncInfo.code}</span>
            <button className="tap" onClick={() => navigator.clipboard && navigator.clipboard.writeText(syncInfo.code).catch(() => {})} style={S.copyBtn}>Copia</button>
          </div>
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(syncInfo.code)}&bgcolor=FCFAF5&color=1A1714&margin=8`}
            style={{ width: 150, height: 150, borderRadius: 12, display: "block", margin: "14px auto" }}
            alt="QR sync"
          />
          <p style={S.syncHint}>Su un altro dispositivo: apri l'app → ⚙ → Sincronizzazione → inserisci il codice oppure scansiona il QR</p>
          <div style={S.syncActions}>
            <button className="tap" onClick={handlePullSync} disabled={syncInfo.status === "pulling"} style={{ ...S.dataBtn, flex: 1 }}><Download size={15} /> Aggiorna da cloud</button>
            <button className="tap" onClick={handleDisconnectSync} style={{ ...S.dataBtn, flex: 1, color: "#CB8A7A" }}><X size={15} /> Disconnetti</button>
          </div>
          {syncInfo.status === "error" && <p style={S.syncError}>⚠ Errore di connessione. Controlla la rete e riprova.</p>}
        </div>
      )}

      <label style={{ ...S.sect, marginTop: 22 }}>Dati e backup</label>
      <div style={S.dataBtns}>
        <button className="tap" onClick={exportData} style={S.dataBtn}><Download size={16} /> Esporta backup</button>
        <button className="tap" onClick={() => fileRef.current && fileRef.current.click()} style={S.dataBtn}><Upload size={16} /> Importa backup</button>
        <button className="tap" onClick={exportWeekText} style={S.dataBtn}><FileText size={16} /> Esporta settimana (testo)</button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ""; }} />
      </div>
      <p style={S.tip}>I dati sono salvati in automatico in questo pianificatore. Il backup è la tua copia di sicurezza: scaricalo ogni tanto.</p>
    </div>
  );
}

const WD = ["L", "M", "M", "G", "V", "S", "D"];

function HobbyPage({ hobbies, addHobby, setHobby, delHobby, toggleHobbyDay }) {
  return (
    <div className="fadein">
      <header style={S.head}>
        <p style={S.kicker}>Ricorrenti</p>
        <h1 style={S.h1}>Hobby</h1>
      </header>
      <p style={S.hintL}>Attività che torni a fare con regolarità. Compaiono in automatico nei giorni previsti, dove puoi spuntarle.</p>
      <div style={S.hobbyList}>
        {hobbies.length === 0 && <p style={S.emptyBig}>Nessuna attività ricorrente. Aggiungine una qui sotto.</p>}
        {hobbies.map((h) => (
          <div key={h.id} style={S.hobbyCard}>
            <div style={S.hobbyTop}>
              <span style={{ ...S.legDot, background: h.color || "#B7AC9B", width: 14, height: 14 }} />
              <input value={h.name} onChange={(e) => setHobby(h.id, { name: e.target.value })} placeholder="Nome attività (es. Sashiko)" style={S.hobbyName} />
              <button onClick={() => delHobby(h.id)} style={S.del} aria-label="Elimina"><Trash2 size={15} /></button>
            </div>

            <div style={S.modeSwitch}>
              <button onClick={() => setHobby(h.id, { mode: "weekly" })} style={{ ...S.modePill, ...(h.mode !== "interval" ? S.modePillOn : {}) }}>Giorni fissi</button>
              <button onClick={() => setHobby(h.id, { mode: "interval" })} style={{ ...S.modePill, ...(h.mode === "interval" ? S.modePillOn : {}) }}>Ogni N giorni</button>
            </div>

            {h.mode === "interval" ? (
              <div style={S.intervalRow}>
                <span style={S.autoTxt}>Ogni</span>
                <input type="number" min="1" value={h.interval} onChange={(e) => setHobby(h.id, { interval: Math.max(1, Number(e.target.value) || 1) })} style={S.targetInput} />
                <span style={S.autoTxt}>giorni · da</span>
                <input type="date" value={h.anchor} onChange={(e) => setHobby(h.id, { anchor: e.target.value })} style={S.dateInput} />
              </div>
            ) : (
              <div style={S.wdRow}>
                {WD.map((w, i) => { const on = h.weekdays && h.weekdays[i]; return (
                  <button key={i} onClick={() => toggleHobbyDay(h.id, i)} style={{ ...S.wdChip, background: on ? "#1A1714" : "#fff", color: on ? "#F7F3EC" : "#8A8073", borderColor: on ? "#1A1714" : "#E0D7C9" }}>{w}</button>
                ); })}
              </div>
            )}

            <div style={S.swatches}>
              {PALETTE.map((col) => (
                <button key={col} className="tap" onClick={() => setHobby(h.id, { color: col })} aria-label="colore"
                  style={{ ...S.swatch, background: col, boxShadow: h.color === col ? `0 0 0 2px #FCFAF5, 0 0 0 4px ${col}` : "none" }} />
              ))}
            </div>
          </div>
        ))}
        <button className="tap" onClick={addHobby} style={S.addCatBtn}><Plus size={16} strokeWidth={2.5} /> Aggiungi attività</button>
      </div>
    </div>
  );
}

function TodoPage({ todos, addTodo, setTodo, delTodo, toggleTodo, todayISO }) {
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const submit = () => { addTodo(text, due || null); setText(""); setDue(""); };

  const sorted = [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.due && !b.due) return 0;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
  });
  const badge = (t) => {
    if (!t.due) return { txt: "nessuna scadenza", col: "#A89C8A" };
    const d = daysBetween(todayISO, t.due);
    const dd = fromISO(t.due);
    const label = `${dd.getDate()} ${MESI_S[dd.getMonth()]}`;
    if (t.done) return { txt: label, col: "#A89C8A" };
    if (d < 0) return { txt: `scaduta · ${label}`, col: "#C0552B" };
    if (d === 0) return { txt: "scade oggi", col: "#C0552B" };
    if (d <= 2) return { txt: `tra ${d} giorn${d === 1 ? "o" : "i"} · ${label}`, col: "#B98A1E" };
    return { txt: label, col: "#8A8073" };
  };

  return (
    <div className="fadein">
      <header style={S.head}>
        <p style={S.kicker}>Promemoria</p>
        <h1 style={S.h1}>Da fare</h1>
      </header>
      <p style={S.hintL}>Cose da fare con scadenza facoltativa. Da 2 giorni prima ti avvisa nelle pagine dei giorni; il giorno stesso scatta l'allerta.</p>

      <div style={S.todoAdd}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Cosa devi fare…" style={S.addInput} />
        <div style={S.todoAddRow}>
          <div style={S.dateField}><Calendar size={15} color="#A89C8A" /><input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={S.dateInputFlat} /></div>
          <button className="tap" onClick={submit} style={S.addBtn}><Plus size={20} strokeWidth={2.5} /></button>
        </div>
      </div>

      <div style={{ ...S.dayItems, marginTop: 16 }}>
        {sorted.length === 0 && <p style={S.emptyBig}>Niente da fare. Aggiungi qualcosa qui sopra.</p>}
        {sorted.map((t) => { const b = badge(t); return (
          <div key={t.id} style={{ ...S.dItem, alignItems: "flex-start", background: t.done ? "#EEF2EA" : "#FCFAF5", borderColor: t.done ? "#CBD8C2" : "#EBE3D6" }}>
            <button className="tap" onClick={() => toggleTodo(t.id)} style={{ ...S.dChk, marginTop: 1, background: t.done ? "#5C7A52" : "#fff", borderColor: t.done ? "#5C7A52" : "#D8CEBF", color: t.done ? "#fff" : "transparent" }}><Check size={15} strokeWidth={3} /></button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input value={t.text} onChange={(e) => setTodo(t.id, { text: e.target.value })} style={{ ...S.dText, width: "100%", textDecoration: t.done ? "line-through" : "none", color: t.done ? "#9A9082" : "#1A1714" }} />
              <div style={S.todoMeta}>
                <span style={{ ...S.remTag, color: b.col }}>{b.txt}</span>
                <input type="date" value={t.due || ""} onChange={(e) => setTodo(t.id, { due: e.target.value || null })} style={S.dateMini} />
              </div>
            </div>
            <button onClick={() => delTodo(t.id)} style={S.del} aria-label="Elimina"><Trash2 size={15} /></button>
          </div>
        ); })}
      </div>
    </div>
  );
}

const ACCENT = "#C0552B", INK = "#1A1714", SAGE = "#5C7A52";
const S = {
  page: { fontFamily: "'Hanken Grotesk', sans-serif", background: "#F7F3EC", minHeight: "100vh", padding: "16px 14px 40px", color: INK, maxWidth: 520, margin: "0 auto" },
  loading: { textAlign: "center", color: "#8A8073", marginTop: 40 },
  nav: { display: "flex", gap: 5, overflowX: "auto", padding: "2px 0 10px", scrollbarWidth: "none", marginBottom: 8, maxWidth: 900 },
  pill: { flexShrink: 0, border: "none", borderRadius: 99, padding: "8px 14px", fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center" },
  head: { marginBottom: 12 },
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  kicker: { margin: 0, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: ACCENT, fontWeight: 600 },
  h1: { margin: "2px 0 0", fontFamily: "'Fraunces', serif", fontWeight: 900, fontSize: 32, lineHeight: 1 },

  weekSel: { display: "flex", alignItems: "center", gap: 8, background: "#FCFAF5", border: "1px solid #EBE3D6", borderRadius: 14, padding: "6px 8px", marginBottom: 10 },
  weekArrow: { width: 38, height: 38, borderRadius: 10, border: "1px solid #E0D7C9", background: "#fff", color: INK, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 },
  weekLabelBtn: { flex: 1, background: "none", border: "none", cursor: "pointer", textAlign: "center", padding: "2px 0" },
  weekLabel: { display: "block", fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 18, color: INK },
  weekYear: { display: "block", fontSize: 11, color: "#A89C8A", marginTop: 1 },
  hint: { fontSize: 11.5, margin: "0 0 8px", textAlign: "center", letterSpacing: 0.3 },

  scroll: { overflowX: "auto", borderRadius: 16, border: "1px solid #E5DCCD", background: "#F2EADC", WebkitOverflowScrolling: "touch" },
  table: { borderCollapse: "separate", borderSpacing: 0 },
  corner: { position: "sticky", left: 0, zIndex: 3, background: "#E3DAC9", width: 80, minWidth: 80, padding: "10px 8px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#6B6151", textAlign: "left" },
  dayHead: { padding: "8px 0", fontSize: 13, fontWeight: 700, position: "sticky", top: 0, zIndex: 1, textAlign: "center" },
  dayHeadDate: { display: "block", fontSize: 11, fontWeight: 600, marginTop: 1, fontVariantNumeric: "tabular-nums" },
  timeCell: { position: "sticky", left: 0, zIndex: 2, background: "#F2EADC", width: 80, minWidth: 80, padding: "8px 6px", borderTop: "1px solid #E5DCCD", verticalAlign: "middle", textAlign: "center" },
  bandWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3 },
  bandInput: { width: "100%", border: "none", borderBottom: "1px dashed #D6C9B3", background: "transparent", fontSize: 12.5, fontWeight: 700, color: ACCENT, padding: "1px 0", textAlign: "center", fontVariantNumeric: "tabular-nums" },
  bandDash: { width: 10, height: 1, background: "#C9BBA4" },
  delRow: { background: "none", border: "none", color: "#CB8A7A", cursor: "pointer", padding: "2px 0 0", display: "inline-flex" },
  rowBtns: { display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 4 },
  insertInline: { background: "none", border: "1px solid #C9BBA4", borderRadius: 99, color: "#A89C8A", fontSize: 14, fontWeight: 700, cursor: "pointer", width: 20, height: 20, lineHeight: "18px", padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" },
  cell: { position: "relative", padding: "6px 7px", borderTop: "1px solid #E5DCCD", borderLeft: "1px solid #E5DCCD", verticalAlign: "top" },
  catDot: { position: "absolute", top: 6, right: 6, width: 16, height: 16, borderRadius: 99, border: "2px solid", cursor: "pointer", padding: 0, zIndex: 1 },
  cText: { width: "100%", border: "none", background: "transparent", fontSize: 13.5, lineHeight: 1.35, resize: "none", color: INK, paddingRight: 18, minHeight: 38 },
  actions: { display: "flex", gap: 10, marginTop: 14 },
  addBtnFull: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "13px", background: INK, color: "#F7F3EC", border: "none", borderRadius: 13, fontSize: 14.5, fontWeight: 600, cursor: "pointer" },
  resetBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "13px 16px", background: "none", border: "1px solid #E0D7C9", borderRadius: 13, color: "#8A8073", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },

  dayHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-end" },
  dayDate: { fontSize: 17, fontWeight: 600, color: ACCENT, fontFamily: "'Hanken Grotesk', sans-serif" },
  dayScore: { textAlign: "right" },
  dayScoreNum: { fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 600, color: SAGE, display: "block", lineHeight: 1 },
  dayScoreLbl: { fontSize: 12, color: "#8A8073", fontVariantNumeric: "tabular-nums" },
  sect: { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#A89C8A", margin: "8px 0 8px" },
  empty: { fontSize: 14, color: "#A89C8A", fontStyle: "italic", margin: "2px 0" },
  dayItems: { display: "flex", flexDirection: "column", gap: 7 },
  dItem: { display: "flex", alignItems: "center", gap: 9, border: "1px solid", borderRadius: 12, padding: "9px 11px" },
  dChk: { width: 26, height: 26, flexShrink: 0, border: "1.5px solid", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
  catTag: { width: 6, height: 22, borderRadius: 99, flexShrink: 0 },
  dTime: { flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: ACCENT, fontVariantNumeric: "tabular-nums", minWidth: 78 },
  dText: { flex: 1, minWidth: 0, border: "none", background: "transparent", fontSize: 15 },
  del: { background: "none", border: "none", color: "#CB8A7A", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 },
  textarea: { width: "100%", border: "1px solid #E0D7C9", borderRadius: 14, padding: "13px 15px", fontSize: 15, lineHeight: 1.5, background: "#FCFAF5", color: INK, resize: "vertical" },

  monthRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 2 },
  monthSel: { fontFamily: "'Fraunces', serif", fontWeight: 900, fontSize: 30, border: "none", background: "transparent", color: INK, cursor: "pointer", padding: 0, appearance: "none" },
  monthBig: { fontFamily: "'Fraunces', serif", fontSize: 30, fontWeight: 600, color: SAGE },
  barTrack: { height: 8, background: "#E7DFD2", borderRadius: 99, overflow: "hidden", margin: "12px 0 18px" },
  barFill: { height: "100%", background: "linear-gradient(90deg,#5C7A52,#7E9C6E)", borderRadius: 99, transition: "width .3s" },
  goalList: { display: "flex", flexDirection: "column", gap: 9 },
  emptyBig: { fontSize: 14, color: "#A89C8A", fontStyle: "italic", textAlign: "center", padding: "10px 0" },
  goalCard: { background: "#FCFAF5", border: "1px solid #EBE3D6", borderRadius: 14, padding: "11px 13px" },
  goalCardDone: { background: "#EEF2EA", borderColor: "#CBD8C2" },
  goalTop: { display: "flex", alignItems: "center", gap: 8 },
  gChk: { width: 26, height: 26, flexShrink: 0, border: "1.5px solid", borderRadius: 99, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
  goalText: { flex: 1, minWidth: 0, border: "none", background: "transparent", fontSize: 15.5, fontWeight: 600 },
  modeBtn: { flexShrink: 0, border: "1px solid #E0D7C9", background: "#fff", color: "#8A8073", borderRadius: 99, padding: "4px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" },
  modeBtnOn: { background: "#1A1714", color: "#F7F3EC", borderColor: "#1A1714" },
  goalProg: { display: "flex", alignItems: "center", gap: 10, marginTop: 9, paddingLeft: 35 },
  goalPct: { fontSize: 12.5, fontWeight: 700, color: SAGE, marginLeft: "auto", fontVariantNumeric: "tabular-nums" },
  catRowSm: { display: "flex", flexWrap: "wrap", gap: 5 },
  catChipSm: { border: "1px solid", borderRadius: 99, padding: "4px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" },
  autoRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 9, fontSize: 13 },
  autoTxt: { color: "#8A8073", fontSize: 12.5 },
  targetInput: { width: 52, border: "1px solid #E0D7C9", borderRadius: 8, padding: "5px 8px", fontSize: 14, fontWeight: 700, background: "#fff", color: INK, textAlign: "center" },
  addRow: { display: "flex", gap: 8, marginTop: 18 },
  addInput: { flex: 1, border: "1px solid #E0D7C9", borderRadius: 12, padding: "12px 16px", fontSize: 15, background: "#FCFAF5", color: INK },
  addBtn: { background: INK, color: "#F7F3EC", border: "none", borderRadius: 12, width: 48, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 },
  tip: { fontSize: 12, color: "#A89C8A", lineHeight: 1.5, marginTop: 14 },

  statRow: { display: "flex", gap: 10, marginBottom: 6 },
  statCard: { flex: 1, background: "#FCFAF5", border: "1px solid #EBE3D6", borderRadius: 14, padding: "14px 12px", textAlign: "center" },
  statNum: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 32, color: SAGE, display: "block", lineHeight: 1 },
  statLbl: { fontSize: 11.5, color: "#8A8073", marginTop: 6, display: "block" },
  legend: { display: "flex", flexDirection: "column", gap: 9 },
  legRow: { display: "flex", alignItems: "center", gap: 9 },
  legDot: { width: 11, height: 11, borderRadius: 99, flexShrink: 0 },
  legLabel: { fontSize: 13, fontWeight: 600, width: 92, flexShrink: 0 },
  legBarTrack: { flex: 1, height: 8, background: "#E7DFD2", borderRadius: 99, overflow: "hidden" },
  legVal: { fontSize: 11.5, fontWeight: 700, color: "#8A8073", width: 74, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" },
  dataBtns: { display: "flex", flexDirection: "column", gap: 8 },
  catEdit: { display: "flex", flexDirection: "column", gap: 8 },
  catEditRow: { background: "#FCFAF5", border: "1px solid #EBE3D6", borderRadius: 12, padding: "10px 12px" },
  catEditTop: { display: "flex", alignItems: "center", gap: 9 },
  catNameInput: { flex: 1, border: "none", borderBottom: "1px solid #E5DCCD", background: "transparent", fontSize: 15, fontWeight: 600, color: INK, padding: "2px 0" },
  swatches: { display: "flex", flexWrap: "wrap", gap: 9, marginTop: 12, paddingLeft: 22 },
  swatch: { width: 22, height: 22, borderRadius: 99, border: "none", cursor: "pointer", padding: 0 },
  addCatBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", padding: "12px", background: "none", border: "1.5px dashed #D6C9B3", borderRadius: 12, color: "#8A8073", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Hanken Grotesk', sans-serif", marginTop: 2 },
  syncBox: { background: "#FCFAF5", border: "1px solid #EBE3D6", borderRadius: 14, padding: "14px" },
  syncDesc: { fontSize: 13.5, color: "#6B6151", lineHeight: 1.5, margin: "0 0 12px" },
  syncStatusRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },
  syncDot: { width: 9, height: 9, borderRadius: 99, flexShrink: 0, transition: "background .3s" },
  syncStatusTxt: { fontSize: 13, fontWeight: 600, color: "#6B6151" },
  codeBox: { background: "#EFE8DB", borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 },
  codeLbl: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#A89C8A", flexShrink: 0 },
  codeVal: { flex: 1, fontSize: 11.5, fontFamily: "monospace", wordBreak: "break-all", color: "#1A1714" },
  copyBtn: { flexShrink: 0, background: "#1A1714", color: "#F7F3EC", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Hanken Grotesk', sans-serif" },
  syncHint: { fontSize: 12, color: "#A89C8A", textAlign: "center", lineHeight: 1.5, margin: "10px 0 12px" },
  syncActions: { display: "flex", gap: 8 },
  syncError: { fontSize: 12.5, color: "#C0552B", marginTop: 10, fontWeight: 600 },
  dataBtn: { display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "13px 15px", background: "#FCFAF5", border: "1px solid #E0D7C9", borderRadius: 12, color: INK, fontSize: 14.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Hanken Grotesk', sans-serif" },

  backdrop: { position: "fixed", inset: 0, background: "rgba(26,23,20,.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50, padding: 0 },
  sheet: { width: "100%", maxWidth: 520, background: "#F7F3EC", borderRadius: "20px 20px 0 0", padding: "16px 16px 28px", boxShadow: "0 -10px 40px rgba(0,0,0,.2)" },
  sheetHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sheetTitle: { fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600 },
  sheetBand: { marginLeft: 8, fontSize: 13, fontWeight: 700, color: ACCENT, fontVariantNumeric: "tabular-nums" },
  iconBtn: { background: "#EFE8DB", border: "none", borderRadius: 99, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: INK },
  sheetInput: { width: "100%", border: "1px solid #E0D7C9", borderRadius: 12, padding: "12px 14px", fontSize: 15, background: "#FCFAF5", color: INK, resize: "none", lineHeight: 1.4 },
  sheetLbl: { fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#A89C8A", margin: "16px 0 8px" },
  catRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  catChip: { border: "1.5px solid", borderRadius: 99, padding: "7px 13px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  sheetActions: { display: "flex", gap: 8, marginTop: 18 },
  sheetBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px", background: INK, color: "#F7F3EC", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Hanken Grotesk', sans-serif" },
  sheetBtnGhost: { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "13px 16px", background: "none", border: "1px solid #E0D7C9", borderRadius: 12, color: "#A0564A", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Hanken Grotesk', sans-serif", whiteSpace: "nowrap" },

  hintL: { fontSize: 13, color: "#8A8073", lineHeight: 1.5, margin: "0 0 16px" },
  hobbyList: { display: "flex", flexDirection: "column", gap: 10 },
  hobbyCard: { background: "#FCFAF5", border: "1px solid #EBE3D6", borderRadius: 14, padding: "12px 13px" },
  hobbyTop: { display: "flex", alignItems: "center", gap: 9 },
  hobbyName: { flex: 1, minWidth: 0, border: "none", borderBottom: "1px solid #E5DCCD", background: "transparent", fontSize: 15.5, fontWeight: 600, color: INK, padding: "2px 0" },
  modeSwitch: { display: "flex", gap: 6, marginTop: 12 },
  modePill: { flex: 1, border: "1px solid #E0D7C9", background: "#fff", color: "#8A8073", borderRadius: 99, padding: "7px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Hanken Grotesk', sans-serif" },
  modePillOn: { background: "#1A1714", color: "#F7F3EC", borderColor: "#1A1714" },
  wdRow: { display: "flex", gap: 6, marginTop: 12, justifyContent: "space-between" },
  wdChip: { flex: 1, border: "1.5px solid", borderRadius: 10, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Hanken Grotesk', sans-serif" },
  intervalRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" },
  dateInput: { border: "1px solid #E0D7C9", borderRadius: 8, padding: "6px 8px", fontSize: 13.5, background: "#fff", color: INK, fontFamily: "'Hanken Grotesk', sans-serif" },

  todoAdd: { background: "#FCFAF5", border: "1px solid #EBE3D6", borderRadius: 14, padding: "12px 13px", display: "flex", flexDirection: "column", gap: 10 },
  todoAddRow: { display: "flex", gap: 8, alignItems: "center" },
  dateField: { flex: 1, display: "flex", alignItems: "center", gap: 7, border: "1px solid #E0D7C9", borderRadius: 12, padding: "10px 13px", background: "#fff" },
  dateInputFlat: { flex: 1, border: "none", background: "transparent", fontSize: 14.5, color: INK, fontFamily: "'Hanken Grotesk', sans-serif" },
  todoMeta: { display: "flex", alignItems: "center", gap: 10, marginTop: 4 },
  dateMini: { border: "none", background: "transparent", fontSize: 11.5, color: "#A89C8A", fontFamily: "'Hanken Grotesk', sans-serif", padding: 0 },
  remItem: { display: "flex", alignItems: "center", gap: 9, border: "1.5px solid", borderRadius: 12, padding: "9px 11px" },
  remTag: { fontSize: 11.5, fontWeight: 700, letterSpacing: 0.2 },
};
