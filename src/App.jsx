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

const FONT_DISPLAY = "'Space Mono', ui-monospace, monospace";
const FONT_BODY = "'Public Sans', -apple-system, system-ui, sans-serif";

const C = {
  bg: "#0a0e14", panel: "#121822", panelHi: "#1a2230", ink: "#e8edf4",
  inkDim: "#8b97a8", line: "#243043", buy: "#3fd18a", hold: "#e8c14a",
  sell: "#f06464", accent: "#5ad1ff",
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
      fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: 1, color: m.color,
      border: `1px solid ${m.color}`, borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap",
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
    return { symbol: "", quantity: "", avg_price: "", current_price: "", rating: "hold", target: "" };
  }

  // ── Guardar captura: reemplaza posiciones + añade snapshot/compras ─────────
  async function processCapture() {
    const clean = draft.filter((r) => String(r.symbol).trim()).map((r) => ({
      owner: OWNER,
      symbol: String(r.symbol).trim().toUpperCase(),
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

    const prevSymbols = new Set(positions.map((p) => p.symbol));
    const newSymbols = new Set(clean.map((p) => p.symbol));
    const disappeared = positions.filter((p) => !newSymbols.has(p.symbol));

    if (disappeared.length) {
      setPendingSales(disappeared.map((p) => ({
        ...p, sell_price: p.current_price || p.avg_price,
      })));
    }

    const ts = Date.now();
    const snapshot = {
      owner: OWNER, ts, date: todayISO(), type: "snapshot",
      payload: { consensus: clean.map((p) => ({
        symbol: p.symbol, rating: p.rating, price: p.current_price, target: p.target })) },
    };
    const buyEvents = clean.filter((p) => !prevSymbols.has(p.symbol)).map((p, i) => ({
      owner: OWNER, ts: ts + i + 1, date: todayISO(), type: "buy",
      payload: { symbol: p.symbol, quantity: p.quantity, price: p.avg_price },
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
        symbol: s.symbol, quantity: s.quantity, price: s.sell_price,
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
  //   SIMBOLO, cantidad, compra, actual, objetivo, rating | corto | medio | largo | analisis
  // Ej: RGTI, 580, 23.91, 26.58, 30, strong_buy | Volátil | Sólido | Líder | Consenso Strong Buy...
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
      let rating = (parts[5] || "hold").toLowerCase().replace(/\s+/g, "_");
      if (!validRatings.includes(rating)) rating = "hold";
      rows.push({
        symbol: parts[0].toUpperCase(),
        quantity: parts[1] || "",
        avg_price: parts[2] || "",
        current_price: parts[3] || "",
        target: parts[4] || "",
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
      minHeight: "100vh", maxWidth: 480, margin: "0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Public+Sans:wght@400;600;800&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        input, select { font-family: ${FONT_BODY}; }
      `}</style>

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
            <div style={{ padding: "18px 18px 12px", borderBottom: `1px solid ${C.line}`,
              display: "flex", alignItems: "center", gap: 12 }}>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none",
                color: C.accent, fontSize: 22, cursor: "pointer", padding: 0 }}>‹</button>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20 }}>{p.symbol}</div>
              <div style={{ marginLeft: "auto" }}><RatingTag rating={p.rating} /></div>
            </div>

            <div style={{ padding: 16 }}>
              {/* Cifras */}
              <div style={{ background: C.panel, borderRadius: 12, padding: 16, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: C.inkDim, fontSize: 13 }}>Precio actual</span>
                  <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}>${p.current_price}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: C.inkDim, fontSize: 13 }}>Objetivo analistas</span>
                  <span style={{ fontWeight: 700, color: upside >= 0 ? C.buy : C.sell }}>
                    ${p.target} ({upside >= 0 ? "+" : ""}{upside.toFixed(1)}%)
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: C.inkDim, fontSize: 13 }}>Tu posición</span>
                  <span>{p.quantity} uds @ ${p.avg_price}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: C.inkDim, fontSize: 13 }}>Tu P&L</span>
                  <span style={{ color: pnl >= 0 ? C.buy : C.sell, fontWeight: 700 }}>
                    {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
                  </span>
                </div>
              </div>

              {/* Plazos */}
              {(p.note_short || p.note_mid || p.note_long) && (
                <div style={{ marginBottom: 14 }}>
                  {[["CORTO PLAZO", p.note_short], ["MEDIO PLAZO", p.note_mid], ["LARGO PLAZO", p.note_long]].map(([label, txt]) => txt ? (
                    <div key={label} style={{ background: C.panel, borderRadius: 10, padding: 12, marginBottom: 8,
                      borderLeft: `3px solid ${C.accent}` }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: 1, color: C.accent, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 14 }}>{txt}</div>
                    </div>
                  ) : null)}
                </div>
              )}

              {/* Análisis */}
              {p.analysis && (
                <div style={{ background: C.panel, borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: 1, color: C.inkDim, marginBottom: 6 }}>
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

      <div style={{ padding: "18px 18px 12px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>
            NORTHERN<span style={{ color: C.accent }}> ✦ </span>NOMAD
          </div>
          <button onClick={handleRefresh} disabled={refreshing} style={{
            background: C.panel, color: refreshing ? C.inkDim : C.accent,
            border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 12px",
            fontSize: 12, cursor: refreshing ? "default" : "pointer", fontFamily: FONT_DISPLAY,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ display: "inline-block", transform: refreshing ? "rotate(360deg)" : "none",
              transition: "transform 0.6s" }}>↻</span>
            {refreshing ? "..." : "Actualizar"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.inkDim, marginTop: 4 }}>Cartera personal · sincronizada</div>
      </div>

      <div style={{ display: "flex", borderBottom: `1px solid ${C.line}` }}>
        {["cartera", "captura", "historico"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "12px 0", background: "none", border: "none",
            borderBottom: tab === t ? `2px solid ${C.accent}` : "2px solid transparent",
            color: tab === t ? C.ink : C.inkDim, fontFamily: FONT_DISPLAY, fontSize: 12,
            letterSpacing: 1, cursor: "pointer", textTransform: "uppercase",
          }}>{t}</button>
        ))}
      </div>

      {error && (
        <div style={{ margin: 14, padding: 12, background: "#1d1110", border: `1px solid ${C.sell}`,
          borderRadius: 8, fontSize: 13, color: C.sell }}>{error}</div>
      )}
      {loading && <div style={{ padding: 40, textAlign: "center", color: C.inkDim }}>Cargando…</div>}

      {pendingSales.length > 0 && (
        <div style={{ margin: 14, padding: 14, background: "#1d1410", border: `1px solid ${C.sell}`, borderRadius: 10 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, color: C.sell, letterSpacing: 1, marginBottom: 8 }}>
            ⚠ VALORES DESAPARECIDOS — ¿LOS VENDISTE?
          </div>
          {pendingSales.map((s, i) => (
            <div key={s.symbol} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 800 }}>{s.symbol} · {s.quantity} uds</div>
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
        <div style={{ padding: 14 }}>
          <div style={{ background: C.panel, borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.inkDim, letterSpacing: 1 }}>VALOR TOTAL</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 700 }}>
              ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ color: totalPnl >= 0 ? C.buy : C.sell, fontSize: 14, fontWeight: 600 }}>
              {totalPnl >= 0 ? "▲" : "▼"} ${Math.abs(totalPnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          {concentrationWarning && (
            <div style={{ background: "#16110a", border: `1px solid ${C.hold}`, borderRadius: 10,
              padding: 12, marginBottom: 14, fontSize: 13 }}>
              <b style={{ color: C.hold }}>Riesgo de concentración.</b> Pocas posiciones, posible exposición a un solo sector. No es asesoramiento financiero.
            </div>
          )}
          {positions.length === 0 && (
            <div style={{ color: C.inkDim, textAlign: "center", padding: 30 }}>
              Sin posiciones. Ve a “Captura”.
            </div>
          )}
          {positions.map((p) => {
            const value = p.current_price * p.quantity;
            const pnl = (p.current_price - p.avg_price) * p.quantity;
            const atTarget = p.target > 0 && p.current_price >= p.target * 0.98;
            return (
              <div key={p.symbol} onClick={() => setSelected(p)} style={{ background: C.panel, borderRadius: 10, padding: 14,
                marginBottom: 8, border: `1px solid ${C.line}`, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>{p.symbol} <span style={{ color: C.inkDim, fontSize: 12 }}>›</span></div>
                    <div style={{ fontSize: 12, color: C.inkDim }}>{p.quantity} uds · coste ${p.avg_price}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                    <div style={{ color: pnl >= 0 ? C.buy : C.sell, fontSize: 12 }}>
                      {pnl >= 0 ? "+" : ""}{pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                  marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
                  <RatingTag rating={p.rating} />
                  <div style={{ fontSize: 11, color: C.inkDim }}>
                    objetivo ${p.target}{atTarget && <span style={{ color: C.hold, marginLeft: 6 }}>● en objetivo</span>}
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
              <br/><code style={{ color: C.ink }}>SÍMBOLO, cant, compra, actual, objetivo, rating | corto | medio | largo | análisis</code>
            </div>
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
              placeholder={"RGTI, 580, 23.91, 26.58, 30, strong_buy | Volátil | Sólido | Líder del sector | Consenso Strong Buy de 9 analistas..."}
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
                <input placeholder="Cantidad" type="number" value={r.quantity} onChange={(e) => updateDraft(i, "quantity", e.target.value)} style={inp(1)} />
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
                    <b>{pl.symbol}</b> · {pl.quantity} uds @ ${pl.price}
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
  return { flex, minWidth: 0, background: C.bg, color: C.ink, border: `1px solid ${C.line}`,
    borderRadius: 6, padding: "8px", fontSize: 13 };
}
function btn(color) {
  return { flex: 1, background: color, color: "#06121a", border: "none", borderRadius: 8,
    padding: "11px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT_DISPLAY, letterSpacing: 1 };
}
function btnGhost() {
  return { background: "none", color: C.ink, border: `1px solid ${C.line}`, borderRadius: 8,
    padding: "11px 16px", fontSize: 13, cursor: "pointer" };
}
