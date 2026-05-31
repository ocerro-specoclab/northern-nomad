import React, { useState, useEffect, useCallback } from "react";
import { supabase, OWNER } from "./supabase.js";

// ─────────────────────────────────────────────────────────────────────────────
// Northern Nomad — versión Supabase (sincroniza entre móvil y ordenador)
//
//  • Sin login: una sola cartera (OWNER = "personal").
//  • Persistencia en Supabase → mismos datos en cualquier dispositivo con la URL.
//  • Detección de ventas al introducir una captura nueva.
//  • Snapshot del consenso de cada día.
//  • El consenso se introduce a mano (los datos de analistas te los busco yo).
//  • NO vigila el mercado solo entre sesiones · NO es asesoramiento financiero.
// ─────────────────────────────────────────────────────────────────────────────

const FONT_DISPLAY = "'Sora', -apple-system, system-ui, sans-serif";
const FONT_BODY = "'Sora', -apple-system, system-ui, sans-serif";
const FONT_NUM = "'Space Grotesk', ui-monospace, monospace";

const C = {
  bg: "#0b0f0c", panel: "#161c17", panelHi: "#1c241d", ink: "#f2f5f0",
  inkDim: "#8a948a", line: "#242d25", buy: "#c4f042", hold: "#e8c14a",
  sell: "#ff6b6b", accent: "#c4f042",
  card: "#161c17",
};

const RATING_META = {
  strong_buy: { label: "STRONG BUY", color: C.buy },
  buy: { label: "BUY", color: C.buy },
  hold: { label: "HOLD", color: C.hold },
  sell: { label: "SELL", color: C.sell },
  strong_sell: { label: "STRONG SELL", color: C.sell },
};

const todayISO = () => new Date().toISOString().slice(0, 10);

// Mini-gráfica de evolución del valor de cartera (SVG nativo, sin librerías)
function Sparkline({ data, color = "#c4f042" }) {
  if (!data || data.length < 2) {
    return (
      <div style={{ fontSize: 11, color: "#8a948a", padding: "10px 0", textAlign: "center" }}>
        Aún sin histórico suficiente. Actualiza la cartera varios días para ver la evolución.
      </div>
    );
  }
  const W = 320, H = 60, PAD = 4;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (W - PAD * 2) / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (H - PAD * 2) * (1 - (d.value - min) / range);
    return [x, y];
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - PAD} L${pts[0][0].toFixed(1)},${H - PAD} Z`;
  const last = data[data.length - 1].value;
  const first = data[0].value;
  const delta = last - first;
  const pct = first > 0 ? (delta / first) * 100 : 0;
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <defs>
          <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#sparkfill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={color} />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8a948a", marginTop: 4 }}>
        <span>{data[0].date}</span>
        <span style={{ color: delta >= 0 ? color : "#ff6b6b", fontWeight: 600 }}>
          {delta >= 0 ? "+" : ""}{pct.toFixed(1)}% ({data.length} snapshots)
        </span>
        <span>{data[data.length - 1].date}</span>
      </div>
    </div>
  );
}

// Gráfica de precios de un valor con objetivo y línea de compra opcionales
function PriceHistoryChart({ points, target = 0, avgPrice = 0, color = "#c4f042" }) {
  if (!points || points.length === 0) {
    return (
      <div style={{ fontSize: 11, color: "#8a948a", padding: "20px 0", textAlign: "center", lineHeight: 1.5 }}>
        Sin histórico todavía.<br/>
        El gráfico se rellenará a medida que actualices el valor en los próximos días.
      </div>
    );
  }
  const W = 320, H = 140, PADL = 30, PADR = 8, PADT = 14, PADB = 22;
  const innerW = W - PADL - PADR;
  const innerH = H - PADT - PADB;
  // Valores a considerar para la escala Y: precios históricos + target + avgPrice
  const allValues = points.map((p) => p.price);
  if (target > 0) allValues.push(target);
  if (avgPrice > 0) allValues.push(avgPrice);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = (max - min) || 1;
  const yMin = min - range * 0.08;
  const yMax = max + range * 0.08;
  const yRange = yMax - yMin;
  const x = (i) => PADL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => PADT + (1 - (v - yMin) / yRange) * innerH;
  const pts = points.map((p, i) => [x(i), y(p.price)]);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const lastPrice = points[points.length - 1].price;
  const firstPrice = points[0].price;
  const delta = lastPrice - firstPrice;
  const pct = firstPrice > 0 ? (delta / firstPrice) * 100 : 0;
  // Etiquetas de eje Y: min, mid, max
  const yLabels = [yMax, (yMax + yMin) / 2, yMin];
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <defs>
          <linearGradient id="pricefill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Eje Y: etiquetas y líneas de cuadrícula */}
        {yLabels.map((v, i) => (
          <g key={i}>
            <line x1={PADL} y1={y(v)} x2={W - PADR} y2={y(v)} stroke="#242d25" strokeWidth="1" strokeDasharray="2,3" />
            <text x={PADL - 4} y={y(v) + 3} fontSize="9" fill="#8a948a" textAnchor="end" fontFamily="'Space Grotesk', monospace">
              ${v.toFixed(v < 10 ? 2 : 1)}
            </text>
          </g>
        ))}
        {/* Línea de precio de compra (si aplica) */}
        {avgPrice > 0 && (
          <g>
            <line x1={PADL} y1={y(avgPrice)} x2={W - PADR} y2={y(avgPrice)} stroke="#8a948a" strokeWidth="1" strokeDasharray="4,3" opacity="0.7" />
            <text x={W - PADR} y={y(avgPrice) - 3} fontSize="9" fill="#8a948a" textAnchor="end" fontFamily="'Space Grotesk', monospace">
              compra
            </text>
          </g>
        )}
        {/* Línea de objetivo */}
        {target > 0 && (
          <g>
            <line x1={PADL} y1={y(target)} x2={W - PADR} y2={y(target)} stroke={color} strokeWidth="1.2" strokeDasharray="5,3" opacity="0.85" />
            <text x={W - PADR} y={y(target) - 3} fontSize="9" fill={color} textAnchor="end" fontWeight="700" fontFamily="'Space Grotesk', monospace">
              objetivo ${target}
            </text>
          </g>
        )}
        {/* Área bajo la curva */}
        {points.length > 1 && (
          <path d={`${line} L${pts[pts.length - 1][0].toFixed(1)},${PADT + innerH} L${pts[0][0].toFixed(1)},${PADT + innerH} Z`}
            fill="url(#pricefill)" />
        )}
        {/* Línea principal */}
        {points.length > 1 && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {/* Puntos */}
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3.5 : 2.2} fill={color}
            stroke={i === pts.length - 1 ? "#0b0f0c" : "none"} strokeWidth="1.5" />
        ))}
        {/* Etiqueta primer y último día */}
        <text x={PADL} y={H - 6} fontSize="9" fill="#8a948a" fontFamily="'Space Grotesk', monospace">{points[0].date}</text>
        <text x={W - PADR} y={H - 6} fontSize="9" fill="#8a948a" textAnchor="end" fontFamily="'Space Grotesk', monospace">{points[points.length - 1].date}</text>
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8a948a", marginTop: 4 }}>
        <span>{points.length} {points.length === 1 ? "captura" : "capturas"}</span>
        {points.length > 1 && (
          <span style={{ color: delta >= 0 ? color : "#ff6b6b", fontWeight: 600 }}>
            {delta >= 0 ? "+" : ""}{pct.toFixed(1)}% desde primer registro
          </span>
        )}
      </div>
    </div>
  );
}

function RatingTag({ rating }) {
  const m = RATING_META[rating] || RATING_META.hold;
  return (
    <span style={{
      fontFamily: FONT_DISPLAY, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: m.color,
      background: `${m.color}1a`, borderRadius: 100, padding: "3px 9px", whiteSpace: "nowrap",
    }}>{m.label}</span>
  );
}

export default function App() {
  const [positions, setPositions] = useState([]);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState("cartera");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState([]);
  const [pendingSales, setPendingSales] = useState([]);
  const [pasteText, setPasteText] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(null); // valor abierto en detalle
  const [selectedWatch, setSelectedWatch] = useState(null);
  const [activeSector, setActiveSector] = useState(null);
  const [reports, setReports] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [reportText, setReportText] = useState("");
  const [cartUpdateText, setCartUpdateText] = useState("");
  const [watchUpdateText, setWatchUpdateText] = useState("");
  const [reportMsg, setReportMsg] = useState("");
  const [expandedReport, setExpandedReport] = useState(null);
  const [shareMsg, setShareMsg] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [editingNote, setEditingNote] = useState(null); // {kind:'cartera'|'seguimiento', id, value}
  const [confirmDelete, setConfirmDelete] = useState(null); // {kind, id, symbol}
  const [disciplineMode, setDisciplineMode] = useState(() => {
    try { return localStorage.getItem("nn-discipline") === "1"; } catch { return false; }
  });
  const [expandedQ, setExpandedQ] = useState(null); // qué pregunta del checklist está abierta
  // formateador de importes que respeta el modo privacidad
  const fmt$ = (v, opts = {}) => privacy ? "•••" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: opts.min ?? 0, maximumFractionDigits: opts.max ?? 2 })}`;
  const [showAddManual, setShowAddManual] = useState(false);
  const [manualRow, setManualRow] = useState(null);

  // ── Función de carga reutilizable (inicial y botón Actualizar) ─────────────
  async function loadData() {
    const { data: pos, error: e1 } = await supabase
      .from("positions").select("*").eq("owner", OWNER);
    const { data: hist, error: e2 } = await supabase
      .from("history").select("*").eq("owner", OWNER).order("ts", { ascending: false });
    if (e1 || e2) throw e1 || e2;
    setPositions(pos || []);
    setHistory(hist || []);
    // reports y watchlist se cargan aparte y no rompen si no existen las tablas todavía
    try {
      const { data: rep } = await supabase.from("reports").select("*").eq("owner", OWNER).order("ts", { ascending: false });
      setReports(rep || []);
    } catch (e) { /* tabla no creada aún, ignorar */ }
    try {
      const { data: wl } = await supabase.from("watchlist").select("*").eq("owner", OWNER);
      setWatchlist(wl || []);
    } catch (e) { /* idem */ }
    return pos || [];
  }

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await loadData();
    } catch (err) {
      setError("No se pudieron recargar los datos. (" + err.message + ")");
    } finally {
      setRefreshing(false);
    }
  }

  // ── Carga inicial desde Supabase ──────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const pos = await loadData();
        setDraft((pos && pos.length ? pos : [blankRow()]).map((p) => ({ ...p })));
      } catch (err) {
        setError("No se pudo conectar con la base de datos. Revisa las claves de Supabase. (" + err.message + ")");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function blankRow() {
    return { symbol: "", broker: "", sector: "", quantity: "", avg_price: "", current_price: "", rating: "hold", target: "" };
  }

  // clave única de una posición: símbolo + broker
  function posKey(p) { return `${(p.symbol || "").toUpperCase()}@${(p.broker || "").toLowerCase()}`; }

  // ── Guardar captura: reemplaza posiciones + añade snapshot/compras ─────────
  async function processCapture() {
    // mapa de posiciones previas por clave, para conservar análisis si no llega nuevo
    const prevByKey = {};
    positions.forEach((p) => { prevByKey[posKey(p)] = p; });

    const clean = draft.filter((r) => String(r.symbol).trim()).map((r) => {
      const base = {
        owner: OWNER,
        symbol: String(r.symbol).trim().toUpperCase(),
        broker: (r.broker || "").trim(),
        quantity: parseFloat(r.quantity) || 0,
        avg_price: parseFloat(r.avg_price) || 0,
        current_price: parseFloat(r.current_price) || 0,
        rating: r.rating,
        target: parseFloat(r.target) || 0,
      };
      const prev = prevByKey[posKey(base)] || {};
      // si la línea NO trae análisis/notas/sector nuevos, conserva los anteriores
      return {
        ...base,
        sector: (r.sector || "").trim() || prev.sector || "",
        note_short: r.note_short || prev.note_short || "",
        note_mid: r.note_mid || prev.note_mid || "",
        note_long: r.note_long || prev.note_long || "",
        analysis: r.analysis || prev.analysis || "",
        analysis_date: r.analysis ? (r.analysis_date || todayISO()) : (prev.analysis_date || ""),
        my_note: prev.my_note || "",
        checklist: prev.checklist || {},
      };
    });

    const prevKeys = new Set(positions.map(posKey));
    const newKeys = new Set(clean.map(posKey));
    const disappeared = positions.filter((p) => !newKeys.has(posKey(p)));

    if (disappeared.length) {
      setPendingSales(disappeared.map((p) => ({
        ...p, sell_price: p.current_price || p.avg_price,
      })));
    }

    const ts = Date.now();
    const snapshot = {
      owner: OWNER, ts, date: todayISO(), type: "snapshot",
      payload: { consensus: clean.map((p) => ({
        symbol: p.symbol, broker: p.broker, rating: p.rating, price: p.current_price, target: p.target })) },
    };
    const buyEvents = clean.filter((p) => !prevKeys.has(posKey(p))).map((p, i) => ({
      owner: OWNER, ts: ts + i + 1, date: todayISO(), type: "buy",
      payload: { symbol: p.symbol, broker: p.broker, quantity: p.quantity, price: p.avg_price },
    }));

    try {
      // reemplazar posiciones
      await supabase.from("positions").delete().eq("owner", OWNER);
      if (clean.length) await supabase.from("positions").insert(clean);
      // añadir eventos al histórico
      await supabase.from("history").insert([snapshot, ...buyEvents]);

      // recargar
      const { data: pos } = await supabase.from("positions").select("*").eq("owner", OWNER);
      const { data: hist } = await supabase.from("history").select("*").eq("owner", OWNER).order("ts", { ascending: false });
      setPositions(pos || []);
      setHistory(hist || []);
      if (!disappeared.length) setTab("historico");
    } catch (err) {
      setError("Error al guardar: " + err.message);
    }
  }

  async function confirmSale(idx) {
    const s = pendingSales[idx];
    const ev = {
      owner: OWNER, ts: Date.now(), date: todayISO(), type: "sell",
      payload: {
        symbol: s.symbol, broker: s.broker || "", quantity: s.quantity, price: s.sell_price,
        buy_price: s.avg_price, pnl: (s.sell_price - s.avg_price) * s.quantity,
      },
    };
    try {
      await supabase.from("history").insert([ev]);
      const { data: hist } = await supabase.from("history").select("*").eq("owner", OWNER).order("ts", { ascending: false });
      setHistory(hist || []);
      setPendingSales((ps) => ps.filter((_, i) => i !== idx));
    } catch (err) {
      setError("Error al registrar venta: " + err.message);
    }
  }

  const dismissSale = (idx) => setPendingSales((ps) => ps.filter((_, i) => i !== idx));
  const updateDraft = (i, f, v) => setDraft((d) => d.map((r, idx) => (idx === i ? { ...r, [f]: v } : r)));

  // ── Rellenar filas desde texto pegado ──────────────────────────────────────
  // Formato por línea (los bloques tras | son opcionales):
  //   SIMBOLO, broker, sector, cantidad, compra, actual, objetivo, rating | corto | medio | largo | analisis
  // Ej: RGTI, eToro, Cuántica, 441.86, 23.04, 26.58, 30, strong_buy | Volátil | Sólido | Líder | ...
  function fillFromPaste() {
    const validRatings = Object.keys(RATING_META);
    const lines = pasteText.split("\n").map((l) => l.trim()).filter(Boolean);
    const rows = [];
    let errors = 0;
    for (const line of lines) {
      // separar por bloques con "|": el primero son los datos, el resto plazos/análisis
      const blocks = line.split("|").map((b) => b.trim());
      const parts = blocks[0].split(/[,;\t]+/).map((p) => p.trim());
      if (parts.length < 2 || !parts[0]) { errors++; continue; }
      let rating = (parts[7] || "hold").toLowerCase().replace(/\s+/g, "_");
      if (!validRatings.includes(rating)) rating = "hold";
      rows.push({
        symbol: parts[0].toUpperCase(),
        broker: parts[1] || "",
        sector: parts[2] || "",
        quantity: parts[3] || "",
        avg_price: parts[4] || "",
        current_price: parts[5] || "",
        target: parts[6] || "",
        rating,
        note_short: blocks[1] || "",
        note_mid: blocks[2] || "",
        note_long: blocks[3] || "",
        analysis: blocks[4] || "",
        analysis_date: todayISO(),
      });
    }
    if (!rows.length) {
      setPasteMsg("No se reconoció ninguna línea. Revisa el formato.");
      return;
    }
    setDraft(rows);
    setPasteMsg(`✓ ${rows.length} valores cargados${errors ? ` (${errors} líneas ignoradas)` : ""}. Revísalos y pulsa Guardar captura.`);
    setPasteText("");
  }

  // ── Parsear líneas de cartera/seguimiento del informe ─────────────────────
  // Mismo formato que el Pegado Rápido. Devuelve filas listas.
  function parseLines(text) {
    const validRatings = Object.keys(RATING_META);
    const lines = (text || "").split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.map((line) => {
      const blocks = line.split("|").map((b) => b.trim());
      const parts = blocks[0].split(/[,;\t]+/).map((p) => p.trim());
      if (parts.length < 2 || !parts[0]) return null;
      let rating = (parts[7] || "hold").toLowerCase().replace(/\s+/g, "_");
      if (!validRatings.includes(rating)) rating = "hold";
      return {
        symbol: parts[0].toUpperCase(),
        broker: parts[1] || "",
        sector: parts[2] || "",
        quantity: parts[3] || "",
        avg_price: parts[4] || "",
        current_price: parts[5] || "",
        target: parts[6] || "",
        rating,
        note_short: blocks[1] || "",
        note_mid: blocks[2] || "",
        note_long: blocks[3] || "",
        analysis: blocks[4] || "",
      };
    }).filter(Boolean);
  }

  // ── Guardar informe completo: informe + cartera + seguimiento ─────────────
  async function saveFullReport() {
    if (!reportText.trim() && !cartUpdateText.trim() && !watchUpdateText.trim()) {
      setReportMsg("Pega al menos uno de los tres bloques antes de guardar.");
      return;
    }
    setReportMsg("");
    const ts = Date.now();
    const date = todayISO();
    const summary = [];

    try {
      // 1. Guardar informe en prosa
      if (reportText.trim()) {
        await supabase.from("reports").insert([{ owner: OWNER, ts, date, content: reportText.trim() }]);
        summary.push("informe guardado");
      }

      // 2. Actualizar cartera (mismo flujo que processCapture)
      if (cartUpdateText.trim()) {
        const rows = parseLines(cartUpdateText);
        if (rows.length) {
          const prevByKey = {};
          positions.forEach((p) => { prevByKey[posKey(p)] = p; });
          const clean = rows.map((r) => {
            const base = {
              owner: OWNER,
              symbol: r.symbol,
              broker: r.broker,
              quantity: parseFloat(r.quantity) || 0,
              avg_price: parseFloat(r.avg_price) || 0,
              current_price: parseFloat(r.current_price) || 0,
              rating: r.rating,
              target: parseFloat(r.target) || 0,
            };
            const prev = prevByKey[posKey(base)] || {};
            return {
              ...base,
              sector: r.sector || prev.sector || "",
              note_short: r.note_short || prev.note_short || "",
              note_mid: r.note_mid || prev.note_mid || "",
              note_long: r.note_long || prev.note_long || "",
              analysis: r.analysis || prev.analysis || "",
              analysis_date: r.analysis ? date : (prev.analysis_date || ""),
              my_note: prev.my_note || "",
        checklist: prev.checklist || {},
            };
          });
          const snapshot = {
            owner: OWNER, ts: ts + 1, date, type: "snapshot",
            payload: { consensus: clean.map((p) => ({
              symbol: p.symbol, broker: p.broker, rating: p.rating, price: p.current_price, target: p.target })) },
          };
          await supabase.from("positions").delete().eq("owner", OWNER);
          if (clean.length) await supabase.from("positions").insert(clean);
          await supabase.from("history").insert([snapshot]);
          summary.push(`cartera (${clean.length})`);
        }
      }

      // 3. Actualizar seguimiento (watchlist) - sin cantidad/coste, solo info
      if (watchUpdateText.trim()) {
        const rows = parseLines(watchUpdateText);
        if (rows.length) {
          const prevBySymbol = {};
          watchlist.forEach((w) => { prevBySymbol[w.symbol] = w; });
          const clean = rows.map((r) => {
            const prev = prevBySymbol[r.symbol] || {};
            return {
              owner: OWNER,
              symbol: r.symbol,
              sector: r.sector || prev.sector || "",
              current_price: parseFloat(r.current_price) || 0,
              target: parseFloat(r.target) || 0,
              rating: r.rating,
              note_short: r.note_short || prev.note_short || "",
              note_mid: r.note_mid || prev.note_mid || "",
              note_long: r.note_long || prev.note_long || "",
              analysis: r.analysis || prev.analysis || "",
              analysis_date: r.analysis ? date : (prev.analysis_date || ""),
              added_date: prev.added_date || date,
              my_note: prev.my_note || "",
            };
          });
          // upsert manual: borra los símbolos que vienen y los inserta
          const symbols = clean.map((c) => c.symbol);
          if (symbols.length) {
            await supabase.from("watchlist").delete().eq("owner", OWNER).in("symbol", symbols);
          }
          await supabase.from("watchlist").insert(clean);
          // Snapshot de seguimiento: para que la gráfica del detalle de cada valor pueda
          // reconstruir el histórico de precios objetivo y reales
          const watchSnapshot = {
            owner: OWNER, ts: ts + 2, date, type: "watch_snapshot",
            payload: { entries: clean.map((w) => ({
              symbol: w.symbol, sector: w.sector, rating: w.rating,
              price: w.current_price, target: w.target })) },
          };
          await supabase.from("history").insert([watchSnapshot]);
          summary.push(`seguimiento (${clean.length})`);
        }
      }

      await loadData();
      setReportMsg(`✓ Guardado: ${summary.join(", ")}.`);
      setReportText(""); setCartUpdateText(""); setWatchUpdateText("");
    } catch (err) {
      setReportMsg("Error al guardar: " + err.message);
    }
  }

  async function deleteReport(id) {
    try {
      await supabase.from("reports").delete().eq("id", id);
      setReports((r) => r.filter((x) => x.id !== id));
    } catch (err) { setError("Error al borrar: " + err.message); }
  }

  async function deleteWatch(id) {
    try {
      await supabase.from("watchlist").delete().eq("id", id);
      setWatchlist((w) => w.filter((x) => x.id !== id));
    } catch (err) { setError("Error al borrar: " + err.message); }
  }

  // Guardar la nota manual del usuario (campo my_note, no se pisa con informes)
  async function saveMyNote() {
    if (!editingNote) return;
    const { kind, id, value } = editingNote;
    const table = kind === "seguimiento" ? "watchlist" : "positions";
    try {
      await supabase.from(table).update({ my_note: value }).eq("id", id);
      // Actualizar estado local
      if (kind === "seguimiento") {
        setWatchlist((ws) => ws.map((w) => w.id === id ? { ...w, my_note: value } : w));
        if (selectedWatch && selectedWatch.id === id) setSelectedWatch({ ...selectedWatch, my_note: value });
      } else {
        setPositions((ps) => ps.map((p) => p.id === id ? { ...p, my_note: value } : p));
        if (selected && selected.id === id) setSelected({ ...selected, my_note: value });
      }
      setEditingNote(null);
    } catch (err) {
      setError("Error al guardar nota: " + err.message);
    }
  }

  // Borrar una posición de cartera (con confirmación)
  async function deletePosition(id) {
    try {
      await supabase.from("positions").delete().eq("id", id);
      setPositions((ps) => ps.filter((p) => p.id !== id));
      setSelected(null);
      setConfirmDelete(null);
    } catch (err) {
      setError("Error al borrar: " + err.message);
    }
  }

  async function deleteWatchAndClose(id) {
    try {
      await supabase.from("watchlist").delete().eq("id", id);
      setWatchlist((w) => w.filter((x) => x.id !== id));
      setSelectedWatch(null);
      setConfirmDelete(null);
    } catch (err) {
      setError("Error al borrar: " + err.message);
    }
  }

  // Toggle modo disciplina (persiste en localStorage)
  function toggleDiscipline() {
    setDisciplineMode((v) => {
      const next = !v;
      try { localStorage.setItem("nn-discipline", next ? "1" : "0"); } catch {}
      return next;
    });
  }

  // Marcar/desmarcar pregunta del checklist de una posición
  async function toggleCheck(positionId, questionKey) {
    const p = positions.find((x) => x.id === positionId);
    if (!p) return;
    const cur = p.checklist || {};
    const next = { ...cur, [questionKey]: !cur[questionKey] };
    try {
      await supabase.from("positions").update({ checklist: next }).eq("id", positionId);
      setPositions((ps) => ps.map((x) => x.id === positionId ? { ...x, checklist: next } : x));
      if (selected && selected.id === positionId) setSelected({ ...selected, checklist: next });
    } catch (err) {
      setError("Error al actualizar checklist: " + err.message);
    }
  }

  // Devuelve el estado del checklist: { buyDone, sellDone, buyCount, sellCount }
  function checklistStatus(p) {
    const c = p.checklist || {};
    const buyKeys = ["tesis", "tp_sl", "soporta_50", "no_urgente", "no_concentra"];
    const sellKeys = ["razon_definida", "parcial_tp", "respetar_sl", "no_emocion"];
    const buyCount = buyKeys.filter((k) => c[k]).length;
    const sellCount = sellKeys.filter((k) => c[k]).length;
    return {
      buyDone: buyCount === buyKeys.length,
      sellDone: sellCount === sellKeys.length,
      buyCount, buyTotal: buyKeys.length,
      sellCount, sellTotal: sellKeys.length,
    };
  }

  // Añadir o actualizar un valor a mano (un solo valor, sin reemplazar la cartera)
  async function saveManualPosition() {
    if (!manualRow || !manualRow.symbol.trim()) {
      setError("Falta el símbolo.");
      return;
    }
    try {
      const key = `${manualRow.symbol.toUpperCase()}@${(manualRow.broker || "").toLowerCase()}`;
      const prev = positions.find((p) => posKey(p) === key) || {};
      const row = {
        owner: OWNER,
        symbol: manualRow.symbol.trim().toUpperCase(),
        broker: (manualRow.broker || "").trim(),
        sector: (manualRow.sector || "").trim() || prev.sector || "",
        quantity: parseFloat(manualRow.quantity) || 0,
        avg_price: parseFloat(manualRow.avg_price) || 0,
        current_price: parseFloat(manualRow.current_price) || 0,
        rating: manualRow.rating || "hold",
        target: parseFloat(manualRow.target) || 0,
        note_short: prev.note_short || "",
        note_mid: prev.note_mid || "",
        note_long: prev.note_long || "",
        analysis: prev.analysis || "",
        analysis_date: prev.analysis_date || "",
        my_note: prev.my_note || "",
        checklist: prev.checklist || {},
      };
      // upsert manual: borrar la posición con esa clave y volver a insertar
      if (prev.id !== undefined) {
        await supabase.from("positions").delete().eq("id", prev.id);
      }
      await supabase.from("positions").insert([row]);
      await loadData();
      setShowAddManual(false);
      setManualRow(null);
    } catch (err) {
      setError("Error al añadir: " + err.message);
    }
  }

  const totalValue = positions.reduce((s, p) => s + p.current_price * p.quantity, 0);
  const totalCost = positions.reduce((s, p) => s + p.avg_price * p.quantity, 0);
  const totalPnl = totalValue - totalCost;
  const concentrationWarning = positions.length > 0 && positions.length <= 5;

  // Ganancia realizada: suma de PnL de todas las ventas registradas en history
  // Para cada venta: (precio_venta - precio_compra) * cantidad
  const realizedPnl = history
    .filter((h) => h.type === "sell" && h.payload)
    .reduce((sum, h) => {
      const p = h.payload;
      const qty = parseFloat(p.quantity) || 0;
      const sellPrice = parseFloat(p.sell_price ?? p.price) || 0;
      const buyPrice = parseFloat(p.avg_price ?? p.buy_price) || 0;
      return sum + (sellPrice - buyPrice) * qty;
    }, 0);

  // Serie temporal del valor de cartera: una entrada por snapshot
  // El snapshot guarda { consensus: [{symbol, broker, rating, price, target}, ...] }
  // No guarda cantidades, así que el "valor del momento" se aproxima usando
  // las cantidades ACTUALES de cartera, lo cual es razonable para una curva
  // de evolución de precios. Para ser exactos en el futuro habría que guardar
  // también cantidades en el snapshot.
  const qtyByKey = {};
  positions.forEach((p) => { qtyByKey[posKey(p)] = p.quantity; });
  // Serie del valor total de cartera, un punto por día (el último snapshot de ese día)
  const valueSeriesByDate = {};
  history
    .filter((h) => h.type === "snapshot" && h.payload && Array.isArray(h.payload.consensus))
    .forEach((h) => {
      const total = h.payload.consensus.reduce((s, c) => {
        const key = `${(c.symbol || "").toUpperCase()}@${(c.broker || "").toLowerCase()}`;
        const qty = qtyByKey[key] || 0;
        return s + (parseFloat(c.price) || 0) * qty;
      }, 0);
      if (total <= 0) return;
      // Nos quedamos con el snapshot más reciente (mayor ts) por fecha
      if (!valueSeriesByDate[h.date] || valueSeriesByDate[h.date].ts < h.ts) {
        valueSeriesByDate[h.date] = { date: h.date, ts: h.ts, value: total };
      }
    });
  const valueSeries = Object.values(valueSeriesByDate).sort((a, b) => a.ts - b.ts);

  // Extrae el histórico de precios de un símbolo concreto desde history.
  // Solo un punto por día — el más reciente (mayor ts) si hay varias actualizaciones el mismo día.
  function priceHistoryFor(symbol, broker, kind) {
    const SYM = (symbol || "").toUpperCase();
    const BRK = (broker || "").toLowerCase();
    const byDate = {};
    history.forEach((h) => {
      if (!h.payload) return;
      let price = null;
      if (kind === "cartera" && h.type === "snapshot" && Array.isArray(h.payload.consensus)) {
        const c = h.payload.consensus.find((c) => (c.symbol || "").toUpperCase() === SYM &&
          (BRK ? (c.broker || "").toLowerCase() === BRK : true));
        if (c && c.price) price = parseFloat(c.price);
      }
      if (kind === "seguimiento" && h.type === "watch_snapshot" && Array.isArray(h.payload.entries)) {
        const e = h.payload.entries.find((e) => (e.symbol || "").toUpperCase() === SYM);
        if (e && e.price) price = parseFloat(e.price);
      }
      if (price === null) return;
      // Conservar el snapshot del día con el mayor ts (el más reciente del día)
      if (!byDate[h.date] || byDate[h.date].ts < h.ts) {
        byDate[h.date] = { ts: h.ts, date: h.date, price };
      }
    });
    return Object.values(byDate).sort((a, b) => a.ts - b.ts);
  }

  return (
    <div style={{ fontFamily: FONT_BODY, background: C.bg, color: C.ink,
      minHeight: "100vh", maxWidth: 480, margin: "0 auto", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;700&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        input, select, textarea { font-family: ${FONT_BODY}; }
        body { background: ${C.bg}; }
        @keyframes nn-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .nn-card { animation: nn-rise 0.4s ease both; }
        .nn-press { transition: transform 0.12s ease; }
        .nn-press:active { transform: scale(0.98); }
      `}</style>

      {/* halo de fondo verde tenue */}
      <div style={{ position: "fixed", top: -120, left: "50%", transform: "translateX(-50%)",
        width: 380, height: 380, background: `radial-gradient(circle, ${C.accent}22, transparent 70%)`,
        pointerEvents: "none", zIndex: 0 }} />

      {/* ── DETALLE DE VALOR (overlay) ── */}
      {selected && (() => {
        const p = selected;
        const value = p.current_price * p.quantity;
        const pnl = (p.current_price - p.avg_price) * p.quantity;
        const pnlPct = p.avg_price ? ((p.current_price - p.avg_price) / p.avg_price) * 100 : 0;
        const upside = p.current_price ? ((p.target - p.current_price) / p.current_price) * 100 : 0;
        const m = RATING_META[p.rating] || RATING_META.hold;
        return (
          <div style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 50, maxWidth: 480,
            margin: "0 auto", overflowY: "auto" }}>
            <div style={{ position: "absolute", top: -120, left: "50%", transform: "translateX(-50%)",
              width: 380, height: 380, background: `radial-gradient(circle, ${m.color}22, transparent 70%)`,
              pointerEvents: "none" }} />
            <div style={{ padding: "18px 18px 8px", display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
              <button onClick={() => setSelected(null)} className="nn-press" style={{ background: C.panel, border: "none",
                color: C.ink, fontSize: 20, cursor: "pointer", width: 38, height: 38, borderRadius: 12 }}>‹</button>
              <div style={{ marginLeft: "auto" }}><RatingTag rating={p.rating} /></div>
            </div>

            <div style={{ padding: "8px 18px 24px", position: "relative" }}>
              {/* Símbolo + precio grande estilo referencia */}
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ width: 56, height: 56, borderRadius: 18, background: `${m.color}1a`, margin: "0 auto 12px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: m.color }}>
                  {p.symbol.slice(0, 2)}
                </div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>
                  {p.symbol}{p.broker ? <span style={{ fontSize: 13, fontWeight: 500, color: C.inkDim }}> · {p.broker}</span> : null}
                </div>
                <div style={{ fontFamily: FONT_NUM, fontWeight: 700, fontSize: 42, letterSpacing: -1, marginTop: 6 }}>
                  ${p.current_price}
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6,
                  background: upside >= 0 ? `${C.buy}1a` : `${C.sell}1a`, color: upside >= 0 ? C.buy : C.sell,
                  borderRadius: 100, padding: "4px 12px", fontSize: 13, fontWeight: 700 }}>
                  objetivo ${p.target} ({upside >= 0 ? "+" : ""}{upside.toFixed(1)}%)
                </div>
              </div>

              {/* Gráfica de precios con histórico */}
              <div style={{ background: C.card, borderRadius: 18, padding: 14, marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.inkDim, marginBottom: 8 }}>
                  EVOLUCIÓN DEL PRECIO
                </div>
                <PriceHistoryChart
                  points={priceHistoryFor(p.symbol, p.broker, "cartera")}
                  target={p.target}
                  avgPrice={p.avg_price}
                  color={m.color}
                />
              </div>

              {/* Tu posición */}
              <div style={{ background: C.card, borderRadius: 18, padding: 16, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ color: C.inkDim, fontSize: 13 }}>Tu posición</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{p.quantity} uds @ ${p.avg_price}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: C.inkDim, fontSize: 13 }}>Valor / Resultado</span>
                  <span style={{ textAlign: "right" }}>
                    <span style={{ fontFamily: FONT_NUM, fontWeight: 700 }}>{fmt$(value)}</span>
                    <span style={{ color: pnl >= 0 ? C.buy : C.sell, fontWeight: 700, fontSize: 13, marginLeft: 8 }}>
                      {pnl >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                    </span>
                  </span>
                </div>
              </div>

              {/* Plazos */}
              {(p.note_short || p.note_mid || p.note_long) && (
                <div style={{ marginBottom: 14 }}>
                  {[["Corto plazo", p.note_short], ["Medio plazo", p.note_mid], ["Largo plazo", p.note_long]].map(([label, txt]) => txt ? (
                    <div key={label} style={{ background: C.card, borderRadius: 16, padding: 14, marginBottom: 8,
                      borderLeft: `3px solid ${C.accent}` }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, color: C.accent, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 14, lineHeight: 1.4 }}>{txt}</div>
                    </div>
                  ) : null)}
                </div>
              )}

              {/* Análisis */}
              {p.analysis && (
                <div style={{ background: C.card, borderRadius: 16, padding: 16, marginBottom: 14 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.inkDim, marginBottom: 6 }}>
                    ANÁLISIS {p.analysis_date ? `· ${p.analysis_date}` : ""}
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{p.analysis}</div>
                </div>
              )}

              {!p.analysis && !p.note_short && !p.note_mid && !p.note_long && (
                <div style={{ color: C.inkDim, fontSize: 13, textAlign: "center", padding: 20 }}>
                  Sin análisis todavía. Pídele a Claude el texto actualizado y pégalo en Captura.
                </div>
              )}

              {/* Mi nota (manual del usuario, nunca pisada por informes) */}
              <div style={{ background: C.card, borderRadius: 16, padding: 14, marginBottom: 14,
                borderLeft: `3px solid ${C.accent}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: p.my_note ? 6 : 0 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: 0.5 }}>
                    ✎ MI NOTA
                  </div>
                  <button onClick={() => setEditingNote({ kind: "cartera", id: p.id, value: p.my_note || "" })}
                    className="nn-press" style={{ background: C.panel, border: "none", color: C.accent,
                      fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 100, padding: "4px 10px" }}>
                    {p.my_note ? "Editar" : "Añadir"}
                  </button>
                </div>
                {p.my_note && <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", marginTop: 4 }}>{p.my_note}</div>}
              </div>

              {/* Checklist Modo Disciplina */}
              {disciplineMode && (() => {
                const status = checklistStatus(p);
                const c = p.checklist || {};
                const posValue = p.current_price * p.quantity;
                const half = posValue / 2;
                const sectorTotal = positions.filter((x) => (x.sector || "Sin sector") === (p.sector || "Sin sector"))
                  .reduce((s, x) => s + x.current_price * x.quantity, 0);
                const sectorPct = totalValue > 0 ? (sectorTotal / totalValue) * 100 : 0;
                const tpDist = (p.target > 0 && p.current_price > 0) ? ((p.target - p.current_price) / p.current_price) * 100 : null;
                const slPrice = parseFloat((p.note_short || "").match(/SL\s*\$?(\d+(?:\.\d+)?)/i)?.[1]) || null;
                const slDist = (slPrice && p.current_price > 0) ? ((p.current_price - slPrice) / p.current_price) * 100 : null;

                const buyQuestions = [
                  { key: "tesis", q: "¿Puedo explicar la tesis en una frase?",
                    helpGeneral: "Una buena tesis dice qué hace la empresa, por qué vale más de lo que cotiza y qué lo demostrará. Bandera roja: «porque sube» o «porque la recomiendan».",
                    helpValor: p.my_note ? `Tu nota actual: "${p.my_note.slice(0, 120)}${p.my_note.length > 120 ? '…' : ''}"` : "No tienes nota personal todavía. Sería buen momento para escribirla." },
                  { key: "tp_sl", q: "¿Tengo TP y SL definidos?",
                    helpGeneral: "TP es dónde recojo, SL dónde admito el error. Decidir ahora en frío.",
                    helpValor: p.target > 0 ? `✓ TP $${p.target} definido. ${slPrice ? `SL $${slPrice} aparece en notas.` : '⚠ Define un SL en la nota corto plazo (formato: "SL $XX") antes de comprar más.'}` : "⚠ Falta el TP. Defínelo antes." },
                  { key: "soporta_50", q: "Si cae un 50%, ¿es soportable?",
                    helpGeneral: "Mirarlo en euros, no en %. Si esa pérdida me haría vender en pánico, la posición es demasiado grande.",
                    helpValor: posValue > 0 ? `Posición actual ~$${posValue.toFixed(0)}. Un -50% serían ~$${half.toFixed(0)} de pérdida. ¿Lo dormirías tranquilo?` : "Sin posición todavía. Calcula antes de comprar: si planeas meter $X, ¿perder $X/2 es soportable?" },
                  { key: "no_urgente", q: "¿Necesito hacerlo hoy?",
                    helpGeneral: "El mercado estará ahí mañana. Si la única urgencia es ganas de operar, esa es la respuesta. Bandera roja: comprar el mismo día que ya he operado.",
                    helpValor: "Pregúntate: ¿qué cambia entre comprar hoy y comprar el lunes? Si la respuesta es «nada concreto», no es urgente." },
                  { key: "no_concentra", q: "¿Me concentra demasiado?",
                    helpGeneral: "Si ese sector ya es la mitad o más de la cartera, otra acción del mismo sector no diversifica: multiplica el riesgo.",
                    helpValor: `Sector "${p.sector || 'Sin sector'}" pesa ahora ${sectorPct.toFixed(0)}% de tu cartera ($${sectorTotal.toFixed(0)} de $${totalValue.toFixed(0)}).${sectorPct >= 50 ? ' ⚠ Por encima del 50%: añadir más concentra, no diversifica.' : ''}` },
                ];

                const sellQuestions = [
                  { key: "razon_definida", q: "¿Vendo por una razón decidida de antemano?",
                    helpGeneral: "Solo tres legítimas: llegó al TP, saltó el SL, o se rompió la tesis. Si no, suele ser emoción.",
                    helpValor: `${tpDist !== null ? `A un ${tpDist >= 0 ? '+' : ''}${tpDist.toFixed(1)}% del TP ($${p.target}).` : ''} ${slDist !== null ? ` Estás un ${slDist.toFixed(1)}% por encima del SL ($${slPrice}).` : ''}`.trim() || "Define TP y SL para que esta pregunta tenga referencia." },
                  { key: "parcial_tp", q: "¿Recoger solo una parte en el TP?",
                    helpGeneral: "Vender un tercio asegura ganancia y deja correr el resto. No es todo o nada.",
                    helpValor: posValue > 0 ? `Posición ~$${posValue.toFixed(0)}. Un tercio sería ~$${(posValue/3).toFixed(0)}.` : "" },
                  { key: "respetar_sl", q: "¿Respeto el SL sin moverlo?",
                    helpGeneral: "Bajarlo cuando se acerca lo convierte en un deseo, no en un límite. El SL solo se mueve hacia arriba.",
                    helpValor: slPrice ? `Tu SL actual: $${slPrice}. Si se acerca, no lo bajes.` : "Sin SL definido en notas." },
                  { key: "no_emocion", q: "¿Tesis o emoción?",
                    helpGeneral: "Un día rojo es el peaje, no una señal. Pregúntate si venderías estando verde el mismo día.",
                    helpValor: "Si la respuesta a «¿vendería si hoy estuviese verde?» es no, probablemente sea emoción." },
                ];

                const renderQuestion = (Q, group) => {
                  const checked = !!c[Q.key];
                  const isOpen = expandedQ === Q.key;
                  return (
                    <div key={Q.key} style={{ marginBottom: 8 }}>
                      <div onClick={() => setExpandedQ(isOpen ? null : Q.key)} className="nn-press"
                        style={{ background: checked ? `${C.buy}10` : C.panel, borderRadius: 12,
                          padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                          border: checked ? `1px solid ${C.buy}44` : `1px solid ${C.line}` }}>
                        <button onClick={(e) => { e.stopPropagation(); toggleCheck(p.id, Q.key); }}
                          style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                            background: checked ? C.buy : "transparent",
                            border: checked ? "none" : `1.5px solid ${C.inkDim}`,
                            color: "#0b0f0c", fontSize: 13, fontWeight: 700, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {checked ? "✓" : ""}
                        </button>
                        <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: checked ? C.inkDim : C.ink, textDecoration: checked ? "line-through" : "none" }}>
                          {Q.q}
                        </div>
                        <span style={{ color: C.inkDim, fontSize: 14, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</span>
                      </div>
                      {isOpen && (
                        <div style={{ background: C.bg, borderRadius: 12, padding: 12, marginTop: 4, fontSize: 12, lineHeight: 1.5, color: C.inkDim }}>
                          <div style={{ marginBottom: Q.helpValor ? 8 : 0 }}>{Q.helpGeneral}</div>
                          {Q.helpValor && (
                            <div style={{ background: C.card, borderRadius: 8, padding: 10, color: C.ink, fontSize: 12 }}>
                              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 10, color: C.accent, fontWeight: 700, marginBottom: 4, letterSpacing: 0.3 }}>
                                EN TU CASO · {p.symbol}
                              </div>
                              {Q.helpValor}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                };

                return (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ background: C.card, borderRadius: 18, padding: 16, marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 700, color: C.accent, letterSpacing: 0.5 }}>
                          ⚖ CHECKLIST DE COMPRA
                        </div>
                        <div style={{ fontSize: 11, color: status.buyDone ? C.buy : C.inkDim, fontWeight: 700 }}>
                          {status.buyCount}/{status.buyTotal} {status.buyDone ? "✓" : ""}
                        </div>
                      </div>
                      {buyQuestions.map((Q) => renderQuestion(Q, "buy"))}
                    </div>

                    {status.buyDone && (
                      <div style={{ background: C.card, borderRadius: 18, padding: 16,
                        border: `1px solid ${C.accent}44` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 700, color: C.accent, letterSpacing: 0.5 }}>
                            ⚖ CHECKLIST DE VENTA
                          </div>
                          <div style={{ fontSize: 11, color: status.sellDone ? C.buy : C.inkDim, fontWeight: 700 }}>
                            {status.sellCount}/{status.sellTotal} {status.sellDone ? "✓" : ""}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: C.inkDim, marginBottom: 12, lineHeight: 1.4, fontStyle: "italic" }}>
                          Usar cuando estés planteándote vender. La app no decide por ti — solo pone los hechos delante.
                        </div>
                        {sellQuestions.map((Q) => renderQuestion(Q, "sell"))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Acciones (borrar valor) */}
              <div style={{ marginBottom: 14 }}>
                <button onClick={() => setConfirmDelete({ kind: "cartera", id: p.id, symbol: p.symbol })}
                  className="nn-press" style={{ width: "100%", background: `${C.sell}1a`, color: C.sell,
                    border: `1px solid ${C.sell}55`, borderRadius: 100, padding: "11px",
                    fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT_DISPLAY }}>
                  🗑 Eliminar de cartera
                </button>
              </div>

              <div style={{ fontSize: 10, color: C.inkDim, textAlign: "center" }}>
                No es asesoramiento financiero.
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── DETALLE DE SEGUIMIENTO (overlay) ── */}
      {selectedWatch && (() => {
        const w = selectedWatch;
        const upside = w.current_price ? ((w.target - w.current_price) / w.current_price) * 100 : 0;
        const m = RATING_META[w.rating] || RATING_META.hold;
        return (
          <div style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 50, maxWidth: 480,
            margin: "0 auto", overflowY: "auto" }}>
            <div style={{ position: "absolute", top: -120, left: "50%", transform: "translateX(-50%)",
              width: 380, height: 380, background: `radial-gradient(circle, ${m.color}22, transparent 70%)`,
              pointerEvents: "none" }} />
            <div style={{ padding: "18px 18px 8px", display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
              <button onClick={() => setSelectedWatch(null)} className="nn-press" style={{ background: C.panel, border: "none",
                color: C.ink, fontSize: 20, cursor: "pointer", width: 38, height: 38, borderRadius: 12 }}>‹</button>
              <span style={{ fontSize: 11, color: C.accent, fontWeight: 700, fontFamily: FONT_DISPLAY,
                background: `${C.accent}1a`, borderRadius: 100, padding: "4px 10px", letterSpacing: 0.3 }}>SEGUIMIENTO</span>
              <div style={{ marginLeft: "auto" }}><RatingTag rating={w.rating} /></div>
            </div>
            <div style={{ padding: "8px 18px 24px", position: "relative" }}>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ width: 56, height: 56, borderRadius: 18, background: `${m.color}1a`, margin: "0 auto 12px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: m.color }}>
                  {w.symbol.slice(0, 2)}
                </div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>
                  {w.symbol} <span style={{ fontSize: 13, fontWeight: 500, color: C.inkDim }}>· {w.sector || "—"}</span>
                </div>
                <div style={{ fontFamily: FONT_NUM, fontWeight: 700, fontSize: 42, letterSpacing: -1, marginTop: 6 }}>
                  ${w.current_price}
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6,
                  background: upside >= 0 ? `${C.buy}1a` : `${C.sell}1a`, color: upside >= 0 ? C.buy : C.sell,
                  borderRadius: 100, padding: "4px 12px", fontSize: 13, fontWeight: 700 }}>
                  objetivo ${w.target} ({upside >= 0 ? "+" : ""}{upside.toFixed(1)}%)
                </div>
              </div>

              {/* Gráfica de precios histórica */}
              <div style={{ background: C.card, borderRadius: 18, padding: 14, marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.inkDim, marginBottom: 8 }}>
                  EVOLUCIÓN DEL PRECIO
                </div>
                <PriceHistoryChart
                  points={priceHistoryFor(w.symbol, "", "seguimiento")}
                  target={w.target}
                  color={C.accent}
                />
              </div>

              {(w.note_short || w.note_mid || w.note_long) && (
                <div style={{ marginBottom: 14 }}>
                  {[["Corto plazo", w.note_short], ["Medio plazo", w.note_mid], ["Largo plazo", w.note_long]].map(([label, txt]) => txt ? (
                    <div key={label} style={{ background: C.card, borderRadius: 16, padding: 14, marginBottom: 8,
                      borderLeft: `3px solid ${C.accent}` }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, color: C.accent, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 14, lineHeight: 1.4 }}>{txt}</div>
                    </div>
                  ) : null)}
                </div>
              )}

              {w.analysis && (
                <div style={{ background: C.card, borderRadius: 16, padding: 16, marginBottom: 14 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.inkDim, marginBottom: 6 }}>
                    ANÁLISIS {w.analysis_date ? `· ${w.analysis_date}` : ""}
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{w.analysis}</div>
                </div>
              )}

              {/* Mi nota (manual) */}
              <div style={{ background: C.card, borderRadius: 16, padding: 14, marginBottom: 14,
                borderLeft: `3px solid ${C.accent}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: w.my_note ? 6 : 0 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: 0.5 }}>
                    ✎ MI NOTA
                  </div>
                  <button onClick={() => setEditingNote({ kind: "seguimiento", id: w.id, value: w.my_note || "" })}
                    className="nn-press" style={{ background: C.panel, border: "none", color: C.accent,
                      fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 100, padding: "4px 10px" }}>
                    {w.my_note ? "Editar" : "Añadir"}
                  </button>
                </div>
                {w.my_note && <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", marginTop: 4 }}>{w.my_note}</div>}
              </div>

              {/* Borrar de seguimiento */}
              <div style={{ marginBottom: 14 }}>
                <button onClick={() => setConfirmDelete({ kind: "seguimiento", id: w.id, symbol: w.symbol })}
                  className="nn-press" style={{ width: "100%", background: `${C.sell}1a`, color: C.sell,
                    border: `1px solid ${C.sell}55`, borderRadius: 100, padding: "11px",
                    fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT_DISPLAY }}>
                  🗑 Eliminar de seguimiento
                </button>
              </div>

              <div style={{ fontSize: 10, color: C.inkDim, textAlign: "center" }}>
                No es asesoramiento financiero.
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{ padding: "20px 18px 14px", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 19, letterSpacing: -0.5 }}>
              Northern<span style={{ color: C.accent }}> ✦ </span>Nomad
            </div>
            <button onClick={() => setShowSettings(true)} className="nn-press" aria-label="Ajustes"
              style={{ background: "transparent", border: "none", color: C.inkDim, fontSize: 16,
                cursor: "pointer", padding: 4, lineHeight: 1 }}>⚙</button>
            <button onClick={toggleDiscipline} className="nn-press"
              title={disciplineMode ? "Modo disciplina ACTIVO" : "Activar modo disciplina"}
              style={{ background: disciplineMode ? `${C.accent}33` : "transparent",
                border: disciplineMode ? `1px solid ${C.accent}` : "1px solid transparent",
                color: disciplineMode ? C.accent : C.inkDim, fontSize: 13, cursor: "pointer",
                padding: "3px 8px", lineHeight: 1, borderRadius: 100, fontFamily: FONT_DISPLAY,
                fontWeight: 700, letterSpacing: 0.3 }}>
              ⚖ {disciplineMode ? "ON" : "OFF"}
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setPrivacy((v) => !v)} className="nn-press" aria-label="Modo privacidad"
              title={privacy ? "Mostrar valores" : "Ocultar valores"} style={{
              background: privacy ? C.accent : C.panel, color: privacy ? "#0b0f0c" : C.inkDim,
              border: "none", borderRadius: 100, width: 38, height: 38, cursor: "pointer", fontSize: 14,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{privacy ? "🙈" : "👁"}</button>
            <button onClick={handleRefresh} disabled={refreshing} className="nn-press" aria-label="Actualizar"
              title="Recargar desde la nube" style={{
              background: refreshing ? C.panel : C.accent, color: refreshing ? C.inkDim : "#0b0f0c",
              border: "none", borderRadius: 100, width: 38, height: 38,
              cursor: refreshing ? "default" : "pointer", fontSize: 16, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ display: "inline-block", transform: refreshing ? "rotate(360deg)" : "none",
                transition: "transform 0.6s" }}>↻</span>
            </button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.inkDim, marginTop: 4 }}>Cartera personal · sincronizada</div>
      </div>

      <div style={{ display: "flex", gap: 6, padding: "0 18px 8px", position: "relative", zIndex: 1,
        overflowX: "auto" }}>
        {["cartera", "informes", "historico"].map((t) => (
          <button key={t} onClick={() => setTab(t)} className="nn-press" style={{
            flexShrink: 0, padding: "10px 16px", borderRadius: 100,
            background: tab === t ? C.accent : C.panel, border: "none",
            color: tab === t ? "#0b0f0c" : C.inkDim, fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 700,
            letterSpacing: 0.3, cursor: "pointer", textTransform: "capitalize",
          }}>{t}</button>
        ))}
      </div>

      {error && (
        <div style={{ margin: 14, padding: 12, background: "#1d1110", border: `1px solid ${C.sell}`,
          borderRadius: 12, fontSize: 13, color: C.sell, position: "relative", zIndex: 1 }}>{error}</div>
      )}
      {loading && <div style={{ padding: 40, textAlign: "center", color: C.inkDim }}>Cargando…</div>}

      {pendingSales.length > 0 && (
        <div style={{ margin: 14, padding: 16, background: "#1d1410", border: `1px solid ${C.sell}`, borderRadius: 16, position: "relative", zIndex: 1 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 700, color: C.sell, letterSpacing: 0.5, marginBottom: 8 }}>
            ⚠ VALORES DESAPARECIDOS — ¿LOS VENDISTE?
          </div>
          {pendingSales.map((s, i) => (
            <div key={posKey(s)} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 800 }}>{s.symbol} {s.broker ? <span style={{ color: C.inkDim, fontWeight: 400 }}>· {s.broker}</span> : null} · {s.quantity} uds</div>
              <div style={{ fontSize: 12, color: C.inkDim, margin: "4px 0" }}>
                Precio de venta:
                <input type="number" value={s.sell_price}
                  onChange={(e) => setPendingSales((ps) => ps.map((x, idx) =>
                    idx === i ? { ...x, sell_price: parseFloat(e.target.value) || 0 } : x))}
                  style={{ width: 80, marginLeft: 6, background: C.panel, color: C.ink,
                    border: `1px solid ${C.line}`, borderRadius: 4, padding: "3px 6px" }} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => confirmSale(i)} style={btn(C.sell)}>Registrar venta</button>
                <button onClick={() => dismissSale(i)} style={btnGhost()}>No fue venta</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "cartera" && (
        <div style={{ padding: "6px 14px 14px", position: "relative", zIndex: 1 }}>
          <div className="nn-card" style={{ background: `linear-gradient(150deg, ${C.panelHi}, ${C.panel})`,
            borderRadius: 24, padding: 22, marginBottom: 14, border: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 12, color: C.inkDim, fontWeight: 500 }}>Valor total</div>
            <div style={{ fontFamily: FONT_NUM, fontSize: 40, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1, marginTop: 4 }}>
              {fmt$(totalValue, { min: 2, max: 2 })}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8,
              background: totalPnl >= 0 ? `${C.buy}1a` : `${C.sell}1a`, color: totalPnl >= 0 ? C.buy : C.sell,
              borderRadius: 100, padding: "4px 10px", fontSize: 13, fontWeight: 700 }}>
              {totalPnl >= 0 ? "▲" : "▼"} {privacy ? "•••" : `$${Math.abs(totalPnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              {totalCost > 0 && <span style={{ opacity: 0.8 }}>({((totalPnl / totalCost) * 100).toFixed(1)}%)</span>}
            </div>

            {/* Gráfica de evolución */}
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 11, color: C.inkDim, fontWeight: 500, marginBottom: 6 }}>Evolución de la cartera</div>
              <Sparkline data={valueSeries} color={C.accent} />
            </div>

            {/* Resumen abierto / realizado */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}`,
              display: "flex", gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: C.inkDim, fontWeight: 500, letterSpacing: 0.3 }}>EN ABIERTO</div>
                <div style={{ fontFamily: FONT_NUM, fontSize: 16, fontWeight: 700, color: totalPnl >= 0 ? C.buy : C.sell, marginTop: 2 }}>
                  {totalPnl >= 0 ? "+" : ""}{fmt$(totalPnl)}
                </div>
                <div style={{ fontSize: 10, color: C.inkDim, marginTop: 1 }}>papel, aún no vendido</div>
              </div>
              <div style={{ width: 1, background: C.line }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: C.inkDim, fontWeight: 500, letterSpacing: 0.3 }}>REALIZADO</div>
                <div style={{ fontFamily: FONT_NUM, fontSize: 16, fontWeight: 700, color: realizedPnl >= 0 ? C.buy : C.sell, marginTop: 2 }}>
                  {realizedPnl >= 0 ? "+" : ""}{fmt$(realizedPnl)}
                </div>
                <div style={{ fontSize: 10, color: C.inkDim, marginTop: 1 }}>ya embolsado en ventas</div>
              </div>
            </div>
          </div>
          {concentrationWarning && (
            <div className="nn-card" style={{ background: `${C.hold}12`, borderRadius: 16,
              padding: 14, marginBottom: 14, fontSize: 13, lineHeight: 1.4 }}>
              <b style={{ color: C.hold }}>Riesgo de concentración.</b> Pocas posiciones, posible exposición a un solo sector. No es asesoramiento financiero.
            </div>
          )}
          {positions.length === 0 && (
            <div style={{ color: C.inkDim, textAlign: "center", padding: 30 }}>
              Sin posiciones. Ve a "Captura".
            </div>
          )}
          {(() => {
            const sectors = [...new Set(positions.map((p) => (p.sector || "Sin sector")))];
            if (positions.length === 0 && watchlist.length === 0) return null;
            return (
              <>
                {sectors.map((sec) => {
                  const items = positions.filter((p) => (p.sector || "Sin sector") === sec);
                  const sectorValue = items.reduce((s, p) => s + p.current_price * p.quantity, 0);
                  return (
                    <div key={sec} style={{ marginBottom: 18 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, padding: "0 2px" }}>
                        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: C.ink, textTransform: "uppercase" }}>
                          {sec}
                        </div>
                        <div style={{ fontSize: 11, color: C.inkDim, fontFamily: FONT_NUM }}>
                          {items.length} · {fmt$(sectorValue)}
                        </div>
                      </div>
                      {items.map((p, idx) => {
                        const value = p.current_price * p.quantity;
                        const pnl = (p.current_price - p.avg_price) * p.quantity;
                        const pnlPct = p.avg_price ? ((p.current_price - p.avg_price) / p.avg_price) * 100 : 0;
                        const m = RATING_META[p.rating] || RATING_META.hold;
                        return (
                          <div key={posKey(p)} onClick={() => setSelected(p)} className="nn-card nn-press"
                            style={{ background: C.card, borderRadius: 18, padding: 16, marginBottom: 10,
                              cursor: "pointer", animationDelay: `${idx * 0.05}s`,
                              borderLeft: `3px solid ${m.color}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ width: 38, height: 38, borderRadius: 12, background: `${m.color}1a`,
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: m.color }}>
                                  {p.symbol.slice(0, 2)}
                                </div>
                                <div>
                                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                                    {p.symbol}
                                    {p.broker ? <span style={{ fontSize: 9, fontWeight: 600, color: C.inkDim,
                                      background: C.panelHi, borderRadius: 100, padding: "2px 7px" }}>{p.broker}</span> : null}
                                    {p.my_note ? <span title="Tiene tu nota" style={{ width: 6, height: 6, borderRadius: 100, background: C.accent, flexShrink: 0 }} /> : null}
                                    {disciplineMode && !checklistStatus(p).buyDone ? (
                                      <span title="Checklist sin completar" style={{ fontSize: 10, color: C.hold,
                                        background: `${C.hold}1a`, borderRadius: 100, padding: "1px 6px", fontWeight: 700 }}>
                                        ⚖ {checklistStatus(p).buyCount}/{checklistStatus(p).buyTotal}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div style={{ fontSize: 11, color: C.inkDim, marginTop: 2 }}>{p.quantity} uds · ${p.avg_price}</div>
                                </div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontFamily: FONT_NUM, fontWeight: 700, fontSize: 15 }}>{fmt$(value)}</div>
                                <div style={{ color: pnl >= 0 ? C.buy : C.sell, fontSize: 12, fontWeight: 600 }}>
                                  {pnl >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {watchlist.length > 0 && (
                  <div style={{ marginTop: 4, marginBottom: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, padding: "0 2px" }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: C.accent, textTransform: "uppercase",
                        display: "flex", alignItems: "center", gap: 6 }}>
                        <span>◉</span> Seguimiento
                      </div>
                      <div style={{ fontSize: 11, color: C.inkDim }}>{watchlist.length} {watchlist.length === 1 ? "valor" : "valores"}</div>
                    </div>
                    <div style={{ fontSize: 11, color: C.accent, marginBottom: 10, fontStyle: "italic", lineHeight: 1.4, padding: "0 2px" }}>
                      Valores que vigilas. No cuentan en el valor total ni en la gráfica.
                    </div>
                    {watchlist.map((w, idx) => {
                      const upside = w.current_price ? ((w.target - w.current_price) / w.current_price) * 100 : 0;
                      const m = RATING_META[w.rating] || RATING_META.hold;
                      return (
                        <div key={w.id} onClick={() => setSelectedWatch(w)} className="nn-card nn-press" style={{
                          background: "transparent", border: `1.5px dashed ${C.accent}55`,
                          borderRadius: 18, padding: 16, marginBottom: 10, animationDelay: `${idx * 0.05}s`,
                          cursor: "pointer" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                              <div style={{ width: 38, height: 38, borderRadius: 12, background: `${m.color}1a`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: m.color }}>
                                {w.symbol.slice(0, 2)}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                                  {w.symbol}
                                  {w.my_note ? <span title="Tiene tu nota" style={{ width: 6, height: 6, borderRadius: 100, background: C.accent, flexShrink: 0 }} /> : null}
                                </div>
                                <div style={{ fontSize: 11, color: C.inkDim }}>{w.sector || "—"}</div>
                              </div>
                            </div>
                            <div style={{ textAlign: "right", marginRight: 8 }}>
                              <div style={{ fontFamily: FONT_NUM, fontWeight: 700, fontSize: 15 }}>${w.current_price}</div>
                              <div style={{ color: upside >= 0 ? C.buy : C.sell, fontSize: 11, fontWeight: 600 }}>
                                obj ${w.target} ({upside >= 0 ? "+" : ""}{upside.toFixed(1)}%)
                              </div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); deleteWatch(w.id); }} style={{ background: "none", border: "none",
                              color: C.inkDim, fontSize: 18, cursor: "pointer", padding: 0 }}>×</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}

          {/* Botón flotante para añadir un valor a mano */}
          <button onClick={() => { setManualRow({ symbol: "", broker: "", sector: "", quantity: "", avg_price: "", current_price: "", target: "", rating: "hold" }); setShowAddManual(true); }}
            className="nn-press" style={{
            position: "fixed", bottom: 24, right: "max(24px, calc((100vw - 480px) / 2 + 24px))",
            width: 56, height: 56, borderRadius: 28, background: C.accent, color: "#0b0f0c",
            border: "none", fontSize: 28, fontWeight: 700, cursor: "pointer", zIndex: 40,
            boxShadow: `0 8px 24px ${C.accent}55`, fontFamily: FONT_DISPLAY,
            display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
          }} aria-label="Añadir valor a mano">+</button>
        </div>
      )}

      {/* Modal añadir valor a mano */}
      {showAddManual && manualRow && (
        <div onClick={() => setShowAddManual(false)} style={{ position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.75)", zIndex: 60, display: "flex", alignItems: "flex-end",
          justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, width: "100%",
            maxWidth: 480, borderRadius: "24px 24px 0 0", padding: 22, animation: "nn-rise 0.3s ease both" }}>
            <div style={{ width: 38, height: 4, background: C.line, borderRadius: 100, margin: "0 auto 16px" }} />
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, marginBottom: 14 }}>
              Añadir valor a mano
            </div>
            <div style={{ fontSize: 11, color: C.inkDim, marginBottom: 14, lineHeight: 1.4 }}>
              Para un valor puntual sin pegar texto. Si ya existe el símbolo+broker, se actualizan precios y se conserva el análisis.
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input placeholder="Símbolo *" value={manualRow.symbol} onChange={(e) => setManualRow({ ...manualRow, symbol: e.target.value })} style={inp(1)} autoFocus />
              <input placeholder="Broker" value={manualRow.broker} onChange={(e) => setManualRow({ ...manualRow, broker: e.target.value })} style={inp(1)} />
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input placeholder="Sector" value={manualRow.sector} onChange={(e) => setManualRow({ ...manualRow, sector: e.target.value })} style={inp(2)} />
              <input placeholder="Cantidad" type="number" value={manualRow.quantity} onChange={(e) => setManualRow({ ...manualRow, quantity: e.target.value })} style={inp(1)} />
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input placeholder="P. compra" type="number" value={manualRow.avg_price} onChange={(e) => setManualRow({ ...manualRow, avg_price: e.target.value })} style={inp(1)} />
              <input placeholder="P. actual" type="number" value={manualRow.current_price} onChange={(e) => setManualRow({ ...manualRow, current_price: e.target.value })} style={inp(1)} />
              <input placeholder="Objetivo" type="number" value={manualRow.target} onChange={(e) => setManualRow({ ...manualRow, target: e.target.value })} style={inp(1)} />
            </div>
            <select value={manualRow.rating} onChange={(e) => setManualRow({ ...manualRow, rating: e.target.value })}
              style={{ ...inp(1), width: "100%", marginBottom: 14 }}>
              {Object.keys(RATING_META).map((k) => <option key={k} value={k}>{RATING_META[k].label}</option>)}
            </select>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowAddManual(false)} style={btnGhost()}>Cancelar</button>
              <button onClick={saveManualPosition} style={btn(C.accent)}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {!loading && tab === "historico" && (
        <div style={{ padding: 14 }}>
          {history.length === 0 && (
            <div style={{ color: C.inkDim, textAlign: "center", padding: 30 }}>Histórico vacío.</div>
          )}
          {history.map((h) => {
            const pl = h.payload || {};
            return (
              <div key={h.ts} style={{ background: C.panel, borderRadius: 10, padding: 12, marginBottom: 8,
                borderLeft: `3px solid ${h.type === "buy" ? C.buy : h.type === "sell" ? C.sell : C.accent}` }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: 1,
                    color: h.type === "buy" ? C.buy : h.type === "sell" ? C.sell : C.accent }}>
                    {h.type === "buy" ? "COMPRA" : h.type === "sell" ? "VENTA" : "ACTUALIZACIÓN"}
                  </span>
                  <span style={{ fontSize: 11, color: C.inkDim }}>{h.date}</span>
                </div>
                {h.type === "snapshot" ? (
                  <div style={{ marginTop: 8 }}>
                    {(pl.consensus || []).map((c) => (
                      <div key={c.symbol} style={{ display: "flex", justifyContent: "space-between",
                        alignItems: "center", padding: "3px 0", fontSize: 13 }}>
                        <span style={{ fontFamily: FONT_DISPLAY }}>{c.symbol}</span>
                        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ color: C.inkDim, fontSize: 11 }}>${c.price} → obj ${c.target}</span>
                          <RatingTag rating={c.rating} />
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ marginTop: 6, fontSize: 14 }}>
                    <b>{pl.symbol}</b>{pl.broker ? <span style={{ color: C.inkDim }}> · {pl.broker}</span> : null} · {pl.quantity} uds @ ${pl.price}
                    {h.type === "sell" && (
                      <span style={{ color: pl.pnl >= 0 ? C.buy : C.sell, marginLeft: 8 }}>
                        ({pl.pnl >= 0 ? "+" : ""}{Number(pl.pnl).toLocaleString(undefined, { maximumFractionDigits: 2 })})
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── INFORMES ── */}
      {!loading && tab === "informes" && (
        <div style={{ padding: 14, position: "relative", zIndex: 1 }}>
          <div style={{ background: C.card, borderRadius: 18, padding: 14, marginBottom: 14,
            border: `1px solid ${C.accent}33` }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.accent, marginBottom: 8 }}>
              ✦ NUEVO INFORME DIARIO
            </div>
            <div style={{ fontSize: 12, color: C.inkDim, marginBottom: 10, lineHeight: 1.4 }}>
              Pide a Claude el informe diario y pega las tres partes. Lo que dejes vacío no se toca.
            </div>

            <div style={{ fontSize: 11, color: C.inkDim, marginBottom: 4, fontWeight: 600 }}>1. Informe en prosa</div>
            <textarea value={reportText} onChange={(e) => setReportText(e.target.value)}
              placeholder="Pega aquí el informe narrativo del día..."
              rows={5} style={{ width: "100%", background: C.bg, color: C.ink, border: `1px solid ${C.line}`,
                borderRadius: 10, padding: 10, fontSize: 12, fontFamily: FONT_BODY, resize: "vertical", marginBottom: 10 }} />

            <div style={{ fontSize: 11, color: C.inkDim, marginBottom: 4, fontWeight: 600 }}>2. Actualizar cartera (opcional)</div>
            <textarea value={cartUpdateText} onChange={(e) => setCartUpdateText(e.target.value)}
              placeholder="QBTS, eToro, Cuántica, 401.16, 26.80, 29.77, 35, strong_buy | ..."
              rows={3} style={{ width: "100%", background: C.bg, color: C.ink, border: `1px solid ${C.line}`,
                borderRadius: 10, padding: 10, fontSize: 11, fontFamily: FONT_DISPLAY, resize: "vertical", marginBottom: 10 }} />

            <div style={{ fontSize: 11, color: C.inkDim, marginBottom: 4, fontWeight: 600 }}>3. Añadir / actualizar seguimiento (opcional)</div>
            <textarea value={watchUpdateText} onChange={(e) => setWatchUpdateText(e.target.value)}
              placeholder="NVDA, , Semiconductores, , , 145, 180, buy | ..."
              rows={3} style={{ width: "100%", background: C.bg, color: C.ink, border: `1px solid ${C.line}`,
                borderRadius: 10, padding: 10, fontSize: 11, fontFamily: FONT_DISPLAY, resize: "vertical", marginBottom: 10 }} />

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={saveFullReport} style={btn(C.accent)}>Guardar todo</button>
              {reportMsg && <span style={{ fontSize: 12, color: reportMsg.startsWith("✓") ? C.buy : C.sell, flex: 2 }}>{reportMsg}</span>}
            </div>
          </div>

          {reports.length === 0 && (
            <div style={{ color: C.inkDim, textAlign: "center", padding: 30, fontSize: 13 }}>
              Sin informes guardados todavía.
            </div>
          )}
          {reports.map((r) => {
            // Extraer un titular: primera línea no vacía
            const lines = (r.content || "").split("\n").map((l) => l.trim()).filter(Boolean);
            const headline = lines[0] || "";
            const preview = lines.slice(1, 4).join(" · ").slice(0, 140);
            return (
              <div key={r.id} onClick={() => setExpandedReport(r)} className="nn-card nn-press"
                style={{ background: C.card, borderRadius: 16, padding: 14, marginBottom: 10, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.accent }}>
                    ☀ {r.date}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); deleteReport(r.id); }} style={{ background: "none", border: "none",
                    color: C.inkDim, fontSize: 16, cursor: "pointer" }}>×</button>
                </div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, marginBottom: 4, lineHeight: 1.3 }}>
                  {headline}
                </div>
                {preview && (
                  <div style={{ fontSize: 12, color: C.inkDim, lineHeight: 1.4 }}>
                    {preview}{lines.length > 4 ? "…" : ""}
                  </div>
                )}
                <div style={{ fontSize: 10, color: C.accent, marginTop: 8, fontWeight: 600 }}>Tocar para abrir →</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Informe en pantalla completa */}
      {expandedReport && (
        <div style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 50, maxWidth: 480,
          margin: "0 auto", overflowY: "auto" }}>
          <div style={{ padding: "18px 18px 8px", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => { setExpandedReport(null); setShareMsg(""); }} className="nn-press" style={{ background: C.panel, border: "none",
              color: C.ink, fontSize: 20, cursor: "pointer", width: 38, height: 38, borderRadius: 12 }}>‹</button>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, flex: 1 }}>
              ☀ Informe · {expandedReport.date}
            </div>
            {/* Botón compartir nativo (móvil) */}
            <button onClick={async () => {
              const text = `Informe Northern Nomad · ${expandedReport.date}\n\n${expandedReport.content}`;
              try {
                if (navigator.share) {
                  await navigator.share({ title: `Informe · ${expandedReport.date}`, text });
                  setShareMsg("");
                } else {
                  await navigator.clipboard.writeText(text);
                  setShareMsg("✓ Copiado");
                  setTimeout(() => setShareMsg(""), 2000);
                }
              } catch (e) { /* usuario canceló, ignorar */ }
            }} className="nn-press" title="Compartir" style={{ background: C.panel, border: "none",
              color: C.accent, fontSize: 16, cursor: "pointer", width: 38, height: 38, borderRadius: 12 }}>⇪</button>
            {/* Botón copiar al portapapeles */}
            <button onClick={async () => {
              const text = `Informe Northern Nomad · ${expandedReport.date}\n\n${expandedReport.content}`;
              try {
                await navigator.clipboard.writeText(text);
                setShareMsg("✓ Copiado");
                setTimeout(() => setShareMsg(""), 2000);
              } catch (e) { setShareMsg("Error al copiar"); }
            }} className="nn-press" title="Copiar al portapapeles" style={{ background: C.panel, border: "none",
              color: C.ink, fontSize: 14, cursor: "pointer", width: 38, height: 38, borderRadius: 12 }}>⧉</button>
          </div>
          {shareMsg && <div style={{ padding: "0 18px", fontSize: 12, color: C.buy, textAlign: "right" }}>{shareMsg}</div>}
          <div style={{ padding: "8px 18px 30px" }}>
            <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{expandedReport.content}</div>
          </div>
        </div>
      )}

      {/* Ajustes / Acerca de */}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 50, maxWidth: 480,
          margin: "0 auto", overflowY: "auto" }}>
          <div style={{ position: "absolute", top: -120, left: "50%", transform: "translateX(-50%)",
            width: 380, height: 380, background: `radial-gradient(circle, ${C.accent}1a, transparent 70%)`,
            pointerEvents: "none" }} />
          <div style={{ padding: "18px 18px 8px", display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
            <button onClick={() => setShowSettings(false)} className="nn-press" style={{ background: C.panel, border: "none",
              color: C.ink, fontSize: 20, cursor: "pointer", width: 38, height: 38, borderRadius: 12 }}>‹</button>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>Ajustes</div>
          </div>

          <div style={{ padding: "8px 18px 30px", position: "relative", fontSize: 13, lineHeight: 1.55 }}>
            <div style={{ background: C.card, borderRadius: 18, padding: 18, marginBottom: 14 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.accent, marginBottom: 10 }}>
                ✦ ACERCA DE
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 800, letterSpacing: -0.5, marginBottom: 4 }}>
                Northern<span style={{ color: C.accent }}> ✦ </span>Nomad
              </div>
              <div style={{ fontSize: 11, color: C.inkDim, marginBottom: 14 }}>
                Visor personal de cartera bursátil
              </div>
              <p style={{ marginBottom: 12, marginTop: 0 }}>
                Northern Nomad es una <b>app de seguimiento personal</b> diseñada para registrar tu cartera, archivar informes diarios y vigilar valores que aún no has comprado. Es un visor y archivo — no toma decisiones por ti ni se conecta a tu broker.
              </p>
              <p style={{ marginBottom: 0, marginTop: 0 }}>
                La app guarda tus datos en una base de datos personal sincronizada (Supabase), accesible desde cualquier dispositivo con tu enlace.
              </p>
            </div>

            <div style={{ background: C.card, borderRadius: 18, padding: 18, marginBottom: 14 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.accent, marginBottom: 10 }}>
                ☉ DE DÓNDE SALEN LOS DATOS
              </div>
              <p style={{ marginTop: 0, marginBottom: 12 }}>
                <b>La app no se conecta a ninguna fuente de datos financieros.</b> Los precios, ratings y análisis los traes tú pegando texto en la pestaña Informes.
              </p>
              <p style={{ marginBottom: 12 }}>
                Ese texto lo genera <b>Claude</b> (IA) buscando en la web cuando le pides el informe. Las fuentes habituales:
              </p>
              <div style={{ fontSize: 12, color: C.inkDim, lineHeight: 1.7, marginBottom: 12, paddingLeft: 4 }}>
                · TipRanks · MarketBeat · StockAnalysis<br/>
                · ChartMill · Benzinga · CNN Money<br/>
                · Yahoo Finance · Investing.com · Public.com
              </div>
              <p style={{ marginBottom: 0 }}>
                Estas plataformas <b>agregan</b> los ratings y precios objetivo publicados por bancos de inversión y casas de análisis reales: Goldman Sachs, Morgan Stanley, JP Morgan, Wells Fargo, Citi, Barclays, Bernstein, Rosenblatt, KeyBanc, Needham, entre otros.
              </p>
            </div>

            <div style={{ background: C.card, borderRadius: 18, padding: 18, marginBottom: 14 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.accent, marginBottom: 10 }}>
                ⌖ CÓMO LEER EL CONSENSO
              </div>
              <p style={{ marginTop: 0, marginBottom: 8 }}>
                El <b>rating de consenso</b> es la media de las recomendaciones de varios analistas:
              </p>
              <div style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 12, paddingLeft: 4 }}>
                <span style={{ color: C.buy, fontWeight: 700 }}>STRONG BUY</span> — fuerte mayoría recomienda comprar<br/>
                <span style={{ color: C.buy, fontWeight: 700 }}>BUY</span> — mayoría recomienda comprar<br/>
                <span style={{ color: C.hold, fontWeight: 700 }}>HOLD</span> — opinión mixta o neutral<br/>
                <span style={{ color: C.sell, fontWeight: 700 }}>SELL</span> — mayoría recomienda vender
              </div>
              <p style={{ marginBottom: 0 }}>
                El <b>precio objetivo</b> es el precio medio que los analistas creen que el valor podría alcanzar en los próximos 12 meses. No es una garantía: hay dispersión entre analistas y se equivocan con frecuencia.
              </p>
            </div>

            <div style={{ background: `${C.sell}10`, borderRadius: 18, padding: 18, marginBottom: 14, border: `1px solid ${C.sell}33` }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.sell, marginBottom: 10 }}>
                ⚠ AVISO IMPORTANTE
              </div>
              <p style={{ marginTop: 0, marginBottom: 8 }}>
                Esta app es una herramienta personal de seguimiento. <b>No es asesoramiento financiero ni una recomendación de inversión.</b>
              </p>
              <p style={{ marginBottom: 0 }}>
                Las decisiones de invertir, comprar o vender son tuyas y bajo tu responsabilidad. Invertir en bolsa conlleva riesgo de pérdida del capital, especialmente en valores volátiles o muy concentrados sectorialmente.
              </p>
            </div>

            <div style={{ fontSize: 10, color: C.inkDim, textAlign: "center", marginTop: 18 }}>
              Northern Nomad · uso personal
            </div>
          </div>
        </div>
      )}

      {/* Modal editar Mi Nota */}
      {editingNote && (
        <div onClick={() => setEditingNote(null)} style={{ position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.75)", zIndex: 70, display: "flex", alignItems: "flex-end",
          justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, width: "100%",
            maxWidth: 480, borderRadius: "24px 24px 0 0", padding: 22, animation: "nn-rise 0.3s ease both" }}>
            <div style={{ width: 38, height: 4, background: C.line, borderRadius: 100, margin: "0 auto 16px" }} />
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, marginBottom: 6 }}>
              ✎ Mi nota
            </div>
            <div style={{ fontSize: 11, color: C.inkDim, marginBottom: 14, lineHeight: 1.4 }}>
              Tu anotación personal. No se borra cuando guardas informes nuevos.
            </div>
            <textarea value={editingNote.value} onChange={(e) => setEditingNote({ ...editingNote, value: e.target.value })}
              placeholder="Escribe lo que quieras recordar sobre este valor..."
              rows={6} autoFocus style={{ width: "100%", background: C.bg, color: C.ink, border: `1px solid ${C.line}`,
                borderRadius: 12, padding: 12, fontSize: 14, fontFamily: FONT_BODY, resize: "vertical", marginBottom: 14, lineHeight: 1.5 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setEditingNote(null)} style={btnGhost()}>Cancelar</button>
              <button onClick={saveMyNote} style={btn(C.accent)}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar borrado */}
      {confirmDelete && (
        <div onClick={() => setConfirmDelete(null)} style={{ position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.75)", zIndex: 70, display: "flex", alignItems: "center",
          justifyContent: "center", padding: 22 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, width: "100%",
            maxWidth: 380, borderRadius: 18, padding: 22, animation: "nn-rise 0.3s ease both" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 8, color: C.sell }}>
              ¿Eliminar {confirmDelete.symbol}?
            </div>
            <div style={{ fontSize: 13, color: C.inkDim, marginBottom: 18, lineHeight: 1.5 }}>
              {confirmDelete.kind === "cartera"
                ? "Se eliminará de tu cartera. El histórico de actualizaciones se mantiene. Esta acción no se puede deshacer."
                : "Se eliminará de seguimiento. Esta acción no se puede deshacer."}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} style={btnGhost()}>Cancelar</button>
              <button onClick={() => confirmDelete.kind === "cartera" ? deletePosition(confirmDelete.id) : deleteWatchAndClose(confirmDelete.id)}
                style={{ flex: 1, background: C.sell, color: "#fff", border: "none", borderRadius: 100,
                  padding: "13px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT_DISPLAY }}>
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: 16, fontSize: 10, color: C.inkDim, textAlign: "center",
        borderTop: `1px solid ${C.line}`, marginTop: 10 }}>
        Prototipo MVP · datos manuales · no es asesoramiento financiero
      </div>
    </div>
  );
}

function inp(flex) {
  return { flex, minWidth: 0, background: C.panelHi, color: C.ink, border: `1px solid ${C.line}`,
    borderRadius: 12, padding: "10px", fontSize: 13 };
}
function btn(color) {
  return { flex: 1, background: color, color: "#0b0f0c", border: "none", borderRadius: 100,
    padding: "13px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT_DISPLAY, letterSpacing: 0.3 };
}
function btnGhost() {
  return { background: C.panel, color: C.ink, border: "none", borderRadius: 100,
    padding: "13px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
}
