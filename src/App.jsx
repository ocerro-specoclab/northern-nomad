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

  // ── Función de carga reutilizable (inicial y botón Actualizar) ─────────────
  async function loadData() {
    const { data: pos, error: e1 } = await supabase
      .from("positions").select("*").eq("owner", OWNER);
    const { data: hist, error: e2 } = await supabase
      .from("history").select("*").eq("owner", OWNER).order("ts", { ascending: false });
    if (e1 || e2) throw e1 || e2;
    setPositions(pos || []);
    setHistory(hist || []);
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
    return { symbol: "", broker: "", quantity: "", avg_price: "", current_price: "", rating: "hold", target: "" };
  }

  // clave única de una posición: símbolo + broker
  function posKey(p) { return `${(p.symbol || "").toUpperCase()}@${(p.broker || "").toLowerCase()}`; }

  // ── Guardar captura: reemplaza posiciones + añade snapshot/compras ─────────
  async function processCapture() {
    const clean = draft.filter((r) => String(r.symbol).trim()).map((r) => ({
      owner: OWNER,
      symbol: String(r.symbol).trim().toUpperCase(),
      broker: (r.broker || "").trim(),
      quantity: parseFloat(r.quantity) || 0,
      avg_price: parseFloat(r.avg_price) || 0,
      current_price: parseFloat(r.current_price) || 0,
      rating: r.rating,
      target: parseFloat(r.target) || 0,
      note_short: r.note_short || "",
      note_mid: r.note_mid || "",
      note_long: r.note_long || "",
      analysis: r.analysis || "",
      analysis_date: r.analysis_date || todayISO(),
    }));

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
  //   SIMBOLO, broker, cantidad, compra, actual, objetivo, rating | corto | medio | largo | analisis
  // Ej: RGTI, eToro, 441.86, 23.04, 26.58, 30, strong_buy | Volátil | Sólido | Líder | ...
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
      let rating = (parts[6] || "hold").toLowerCase().replace(/\s+/g, "_");
      if (!validRatings.includes(rating)) rating = "hold";
      rows.push({
        symbol: parts[0].toUpperCase(),
        broker: parts[1] || "",
        quantity: parts[2] || "",
        avg_price: parts[3] || "",
        current_price: parts[4] || "",
        target: parts[5] || "",
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

  const totalValue = positions.reduce((s, p) => s + p.current_price * p.quantity, 0);
  const totalCost = positions.reduce((s, p) => s + p.avg_price * p.quantity, 0);
  const totalPnl = totalValue - totalCost;
  const concentrationWarning = positions.length > 0 && positions.length <= 5;

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

      <div style={{ display: "flex", gap: 8, padding: "0 18px 8px", position: "relative", zIndex: 1 }}>
        {["cartera", "captura", "historico"].map((t) => (
          <button key={t} onClick={() => setTab(t)} className="nn-press" style={{
            flex: 1, padding: "10px 0", borderRadius: 100,
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
          {positions.map((p, idx) => {
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
                    {/* avatar circular con inicial */}
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
              <br/><code style={{ color: C.ink }}>SÍMBOLO, broker, cant, compra, actual, objetivo, rating | corto | medio | largo | análisis</code>
            </div>
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
              placeholder={"RGTI, eToro, 441.86, 23.04, 26.58, 30, strong_buy | Volátil | Sólido | Líder del sector | Consenso Strong Buy de 9 analistas..."}
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
