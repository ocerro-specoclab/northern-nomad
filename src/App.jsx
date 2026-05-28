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
  const [activeSector, setActiveSector] = useState(null);
  const [reports, setReports] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [reportText, setReportText] = useState("");
  const [cartUpdateText, setCartUpdateText] = useState("");
  const [watchUpdateText, setWatchUpdateText] = useState("");
  const [reportMsg, setReportMsg] = useState("");

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
            };
          });
          // upsert manual: borra los símbolos que vienen y los inserta
          const symbols = clean.map((c) => c.symbol);
          if (symbols.length) {
            await supabase.from("watchlist").delete().eq("owner", OWNER).in("symbol", symbols);
          }
          await supabase.from("watchlist").insert(clean);
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
  const valueSeries = history
    .filter((h) => h.type === "snapshot" && h.payload && Array.isArray(h.payload.consensus))
    .map((h) => {
      const total = h.payload.consensus.reduce((s, c) => {
        const key = `${(c.symbol || "").toUpperCase()}@${(c.broker || "").toLowerCase()}`;
        const qty = qtyByKey[key] || 0;
        return s + (parseFloat(c.price) || 0) * qty;
      }, 0);
      return { date: h.date, ts: h.ts, value: total };
    })
    .filter((p) => p.value > 0)
    .sort((a, b) => a.ts - b.ts);

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

              {/* Tu posición */}
              <div style={{ background: C.card, borderRadius: 18, padding: 16, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ color: C.inkDim, fontSize: 13 }}>Tu posición</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{p.quantity} uds @ ${p.avg_price}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: C.inkDim, fontSize: 13 }}>Valor / Resultado</span>
                  <span style={{ textAlign: "right" }}>
                    <span style={{ fontFamily: FONT_NUM, fontWeight: 700 }}>${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
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

              <div style={{ fontSize: 10, color: C.inkDim, textAlign: "center" }}>
                No es asesoramiento financiero.
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{ padding: "20px 18px 14px", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 19, letterSpacing: -0.5 }}>
            Northern<span style={{ color: C.accent }}> ✦ </span>Nomad
          </div>
          <button onClick={handleRefresh} disabled={refreshing} className="nn-press" style={{
            background: refreshing ? C.panel : C.accent, color: refreshing ? C.inkDim : "#0b0f0c",
            border: "none", borderRadius: 100, padding: "9px 16px",
            fontSize: 13, fontWeight: 700, cursor: refreshing ? "default" : "pointer", fontFamily: FONT_DISPLAY,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ display: "inline-block", transform: refreshing ? "rotate(360deg)" : "none",
              transition: "transform 0.6s" }}>↻</span>
            {refreshing ? "..." : "Actualizar"}
          </button>
        </div>
        <div style={{ fontSize: 12, color: C.inkDim, marginTop: 4 }}>Cartera personal · sincronizada</div>
      </div>

      <div style={{ display: "flex", gap: 6, padding: "0 18px 8px", position: "relative", zIndex: 1,
        overflowX: "auto" }}>
        {["cartera", "seguimiento", "captura", "informes", "historico"].map((t) => (
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
              ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8,
              background: totalPnl >= 0 ? `${C.buy}1a` : `${C.sell}1a`, color: totalPnl >= 0 ? C.buy : C.sell,
              borderRadius: 100, padding: "4px 10px", fontSize: 13, fontWeight: 700 }}>
              {totalPnl >= 0 ? "▲" : "▼"} ${Math.abs(totalPnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
                  {totalPnl >= 0 ? "+" : ""}${totalPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 10, color: C.inkDim, marginTop: 1 }}>papel, aún no vendido</div>
              </div>
              <div style={{ width: 1, background: C.line }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: C.inkDim, fontWeight: 500, letterSpacing: 0.3 }}>REALIZADO</div>
                <div style={{ fontFamily: FONT_NUM, fontSize: 16, fontWeight: 700, color: realizedPnl >= 0 ? C.buy : C.sell, marginTop: 2 }}>
                  {realizedPnl >= 0 ? "+" : ""}${realizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
            // sectores presentes (los que tienen al menos una posición)
            const sectors = [...new Set(positions.map((p) => (p.sector || "Sin sector")))];
            const cur = (activeSector && sectors.includes(activeSector)) ? activeSector : sectors[0];
            return positions.length > 0 && sectors.length > 0 ? (
              <>
                {sectors.length > 1 && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
                    {sectors.map((s) => (
                      <button key={s} onClick={() => setActiveSector(s)} className="nn-press" style={{
                        flexShrink: 0, padding: "8px 14px", borderRadius: 100, border: "none",
                        background: s === cur ? C.accent : C.panel, color: s === cur ? "#0b0f0c" : C.inkDim,
                        fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 700, cursor: "pointer",
                      }}>{s}</button>
                    ))}
                  </div>
                )}
                {positions.filter((p) => (p.sector || "Sin sector") === cur).map((p, idx) => {
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
                            </div>
                            <div style={{ fontSize: 11, color: C.inkDim, marginTop: 2 }}>{p.quantity} uds · ${p.avg_price}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: FONT_NUM, fontWeight: 700, fontSize: 15 }}>${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                          <div style={{ color: pnl >= 0 ? C.buy : C.sell, fontSize: 12, fontWeight: 600 }}>
                            {pnl >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : null;
          })()}
        </div>
      )}

      {!loading && tab === "captura" && (
        <div style={{ padding: 14 }}>
          <div style={{ fontSize: 13, color: C.inkDim, marginBottom: 12 }}>
            Introduce tu cartera tal como aparece hoy. Al guardar, la app detecta ventas y registra el snapshot del consenso.
          </div>

          {/* Pegado rápido: texto que genera Claude desde un pantallazo */}
          <div style={{ background: C.panel, borderRadius: 10, padding: 12, marginBottom: 14,
            border: `1px solid ${C.accent}` }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: 1, color: C.accent, marginBottom: 6 }}>
              ⚡ PEGADO RÁPIDO
            </div>
            <div style={{ fontSize: 12, color: C.inkDim, marginBottom: 8 }}>
              Pega aquí el texto que te da Claude. Una línea por valor. El análisis y los plazos son opcionales:
              <br/><code style={{ color: C.ink }}>SÍMBOLO, broker, sector, cant, compra, actual, objetivo, rating | corto | medio | largo | análisis</code>
            </div>
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
              placeholder={"RGTI, eToro, Cuántica, 441.86, 23.04, 26.58, 30, strong_buy | Volátil | Sólido | Líder del sector | Consenso Strong Buy de 9 analistas..."}
              rows={4} style={{ width: "100%", background: C.bg, color: C.ink, border: `1px solid ${C.line}`,
                borderRadius: 6, padding: 8, fontSize: 12, fontFamily: FONT_DISPLAY, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              <button onClick={fillFromPaste} style={btn(C.accent)}>Rellenar filas</button>
              {pasteMsg && <span style={{ fontSize: 12, color: pasteMsg.startsWith("✓") ? C.buy : C.sell }}>{pasteMsg}</span>}
            </div>
          </div>

          {draft.map((r, i) => (
            <div key={i} style={{ background: C.panel, borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <input placeholder="Símbolo" value={r.symbol} onChange={(e) => updateDraft(i, "symbol", e.target.value)} style={inp(1.2)} />
                <input placeholder="Broker" value={r.broker || ""} onChange={(e) => updateDraft(i, "broker", e.target.value)} style={inp(1)} />
                <input placeholder="Sector" value={r.sector || ""} onChange={(e) => updateDraft(i, "sector", e.target.value)} style={inp(1)} />
                <input placeholder="Cantidad" type="number" value={r.quantity} onChange={(e) => updateDraft(i, "quantity", e.target.value)} style={inp(1)} />
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <input placeholder="P. compra" type="number" value={r.avg_price} onChange={(e) => updateDraft(i, "avg_price", e.target.value)} style={inp(1)} />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input placeholder="P. actual" type="number" value={r.current_price} onChange={(e) => updateDraft(i, "current_price", e.target.value)} style={inp(1)} />
                <input placeholder="Objetivo" type="number" value={r.target} onChange={(e) => updateDraft(i, "target", e.target.value)} style={inp(1)} />
                <select value={r.rating} onChange={(e) => updateDraft(i, "rating", e.target.value)} style={inp(1.2)}>
                  {Object.keys(RATING_META).map((k) => <option key={k} value={k}>{RATING_META[k].label}</option>)}
                </select>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => setDraft((d) => [...d, blankRow()])} style={btnGhost()}>+ Fila</button>
            <button onClick={processCapture} style={btn(C.accent)}>Guardar captura</button>
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
                    {h.type === "buy" ? "COMPRA" : h.type === "sell" ? "VENTA" : "SNAPSHOT CONSENSO"}
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
          {reports.map((r) => (
            <div key={r.id} className="nn-card" style={{ background: C.card, borderRadius: 16, padding: 16, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.accent }}>
                  ☀ INFORME · {r.date}
                </span>
                <button onClick={() => deleteReport(r.id)} style={{ background: "none", border: "none",
                  color: C.inkDim, fontSize: 16, cursor: "pointer" }}>×</button>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{r.content}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── SEGUIMIENTO ── */}
      {!loading && tab === "seguimiento" && (
        <div style={{ padding: 14, position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 12, color: C.inkDim, marginBottom: 12, lineHeight: 1.4 }}>
            Valores que vigilas (sin comprar todavía). Para añadir o actualizar, pega en Informes → bloque 3.
          </div>
          {watchlist.length === 0 && (
            <div style={{ color: C.inkDim, textAlign: "center", padding: 30, fontSize: 13 }}>
              Sin valores en seguimiento.
            </div>
          )}
          {watchlist.map((w, idx) => {
            const upside = w.current_price ? ((w.target - w.current_price) / w.current_price) * 100 : 0;
            const m = RATING_META[w.rating] || RATING_META.hold;
            return (
              <div key={w.id} className="nn-card" style={{ background: C.card, borderRadius: 18, padding: 16, marginBottom: 10,
                borderLeft: `3px solid ${m.color}`, animationDelay: `${idx * 0.05}s` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 12, background: `${m.color}1a`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: m.color }}>
                      {w.symbol.slice(0, 2)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15 }}>{w.symbol}</div>
                      <div style={{ fontSize: 11, color: C.inkDim }}>{w.sector || "—"}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", marginRight: 8 }}>
                    <div style={{ fontFamily: FONT_NUM, fontWeight: 700, fontSize: 15 }}>${w.current_price}</div>
                    <div style={{ color: upside >= 0 ? C.buy : C.sell, fontSize: 11, fontWeight: 600 }}>
                      obj ${w.target} ({upside >= 0 ? "+" : ""}{upside.toFixed(1)}%)
                    </div>
                  </div>
                  <button onClick={() => deleteWatch(w.id)} style={{ background: "none", border: "none",
                    color: C.inkDim, fontSize: 18, cursor: "pointer", padding: 0 }}>×</button>
                </div>
                {(w.note_short || w.note_mid || w.note_long) && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 6 }}>
                    {w.note_short && <div style={{ fontSize: 12 }}><b style={{ color: C.accent, fontSize: 10 }}>CORTO</b> {w.note_short}</div>}
                    {w.note_mid && <div style={{ fontSize: 12 }}><b style={{ color: C.accent, fontSize: 10 }}>MEDIO</b> {w.note_mid}</div>}
                    {w.note_long && <div style={{ fontSize: 12 }}><b style={{ color: C.accent, fontSize: 10 }}>LARGO</b> {w.note_long}</div>}
                  </div>
                )}
                {w.analysis && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}`, fontSize: 12, lineHeight: 1.4, color: C.inkDim }}>
                    {w.analysis}
                  </div>
                )}
              </div>
            );
          })}
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
