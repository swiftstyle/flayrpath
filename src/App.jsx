import React, { useState, useMemo, useEffect, useRef } from "react";

/* ============================================================
   FLAYR  ·  Own the path.
   FLAYRPATH — Own the path.  ·  by Flayr Labs
   A mortgage companion for first-time buyers
   Market: Canada · 2026 rules
   ============================================================ */

/* ---------- regulatory rules revision (Finding 01 — freshness) ----------
   This constant is the single source of truth for "what rules
   version did this user see?" — surfaced to the user in the trust
   strip and (in future) embedded in audit-trail event records.
   Update on every rules review. Last reviewed: 2026-06-01. */
const RULES = {
  revision: "2026-06-01",
  nextReview: "2026-09-01",
  stressFloor: 5.25,            // OSFI B-20 qualifying-rate floor
  fhsaAnnualLimit: 8000,
  fhsaLifetimeLimit: 40000,
  hbpLimit: 60000,
  ontarioFHBLTTRebateMax: 4000,
  torontoFHBLTTRebateMax: 4475,
  ontarioHSTRebateCap: 24000,
  federalGSTFullRebateCap: 1000000,
  federalGSTPhaseOutEnd: 1500000,
};


/* ---------- brand palette: "Ember" (dark, editorial) ---------- */
const C = {
  canvas: "#161310",
  panel: "#211D17",
  panelHi: "#2B261E",
  panelSoft: "#1C1813",
  line: "rgba(244,238,227,.10)",
  lineHi: "rgba(244,238,227,.20)",
  text: "#F5EFE3",
  textSub: "#ABA290",
  textFaint: "#7A7160",
  flare: "#FF5A24",
  flareDeep: "#E03F0C",
  flareSoft: "rgba(255,90,36,.13)",
  amber: "#FFB44A",
  lime: "#D6F24A",
  mint: "#54D6A6",
  sky: "#5CB8E0",
  violet: "#A78BFF",
  red: "#FF5765",
  redSoft: "rgba(255,87,101,.13)",
};

/* ============================================================
   MARKET CONFIG
   ============================================================ */
const MARKETS = {
  CA: {
    code: "CA", name: "Canada", flag: "🇨🇦", symbol: "CA$",
    r1: { key: "GDS", name: "Gross Debt Service", max: 0.39, comfort: 0.32 },
    r2: { key: "TDS", name: "Total Debt Service", max: 0.44, comfort: 0.40 },
    stressTest: true, stressFloor: 5.25,
    insKind: "oneTime",
    minDownNote: "5% on the first $500K, 10% on the slice above, 20% at $1.5M+.",
    accounts: [
      ["FHSA", "First Home Savings Account — up to $8,000/yr ($40K lifetime). Deductible going in, tax-free coming out."],
      ["RRSP — Home Buyers' Plan", "Pull up to $60,000 tax-free toward a first home; repay it over 15 years."],
      ["TFSA", "Tax-free growth, fully flexible — a solid top-up once the FHSA is maxed."],
    ],
    rebate: "First-time buyers may qualify for land-transfer-tax rebates and a GST/HST rebate on eligible new builds.",
  },
};

/* ---------- math ---------- */
const fmtCur = (m) => (n) => MARKETS[m].symbol + Math.round(Math.max(0, n)).toLocaleString("en-US");
// signed variant — shows losses; used where a value can legitimately go negative
const fmtCurSigned = (m) => (n) => (n < 0 ? "−" : "") + MARKETS[m].symbol + Math.round(Math.abs(n)).toLocaleString("en-US");
const pct = (n) => (n * 100).toFixed(1) + "%";

function minDownPayment(price, market) {
  if (market === "CA") {
    if (price <= 500000) return price * 0.05;
    if (price < 1500000) return 25000 + (price - 500000) * 0.1;
    return price * 0.2;
  }
  return price * 0.035;
}
function cmhcRate(ltv) {
  if (ltv <= 0.8) return 0;
  if (ltv <= 0.85) return 0.028;
  if (ltv <= 0.9) return 0.031;
  if (ltv <= 0.95) return 0.04;
  return null;
}
function pmiAnnualRate(ltv) {
  if (ltv <= 0.8) return 0;
  if (ltv <= 0.85) return 0.005;
  if (ltv <= 0.9) return 0.007;
  if (ltv <= 0.95) return 0.009;
  return 0.011;
}
/* ---------- closing costs: the second pile of cash ----------
   Both markets return an itemized list + total. Estimates only —
   land transfer tax especially varies by province/municipality. */
function landTransferTax(price) {
  // representative Ontario-style tiered provincial LTT
  let t = 0;
  const tier = (lo, hi, rate) => { if (price > lo) t += (Math.min(price, hi) - lo) * rate; };
  tier(0, 55000, 0.005);
  tier(55000, 250000, 0.01);
  tier(250000, 400000, 0.015);
  tier(400000, 2000000, 0.02);
  tier(2000000, Infinity, 0.025);
  return t;
}

/* ------------------------------------------------------------------
 * GST/HST NEW-HOME REBATES — first-time buyers
 *
 * Federal GST FHB rebate (proposed 2025 budget):
 *   - Eliminates the 5% federal GST for first-time buyers on new builds
 *   - Full rebate for homes ≤ $1,000,000
 *   - Phases out linearly from $1M to $1.5M
 *   - Zero rebate above $1.5M
 *
 * Ontario HST new-home rebate:
 *   - 75% of the provincial 8% portion of HST
 *   - Capped at $24,000 (reached at home price of $400K and above)
 *   - Flat cap — does not phase out by price
 *
 * SOURCES: CRA GST/HST New Housing Rebate (RC4028); Ontario Ministry
 * of Finance HST New Housing Rebate. Verify quarterly — rules may change.
 * ------------------------------------------------------------------ */
function gstFHBRebate(price) {
  if (price <= 1000000) return price * 0.05;
  if (price >= 1500000) return 0;
  // linear phase-out between $1M and $1.5M
  const fullRebate = 1000000 * 0.05; // $50,000
  const phaseOutFactor = 1 - (price - 1000000) / 500000;
  return fullRebate * phaseOutFactor;
}
function ontarioHSTRebate(price) {
  // 75% of 8% provincial HST portion, capped at $24K
  // Cap reached at $400K (since 75% × 8% × $400K = $24K)
  return Math.min(price * 0.08 * 0.75, 24000);
}

function closingCosts(price, market, firstTimeBuyer, newBuild) {
  const ltt = landTransferTax(price);
  // gross costs — before any rebates
  const items = [
    ["Land transfer tax", Math.round(ltt), "tiered on the purchase price"],
    ["Legal / notary fees", 1800, "the lawyer who closes the deal"],
    ["Title insurance", 400, "one-time, protects your ownership"],
    ["Home inspection", 500, "before you commit — worth it"],
    ["Appraisal", 350, "lender confirms the home's value"],
    ["Adjustments & disbursements", Math.round(price * 0.001), "prepaid tax/utilities owed to the seller"],
  ];
  const gross = items.reduce((s, i) => s + i[1], 0);

  // rebates — money credited back, mostly for first-time buyers
  const rebates = [];
  if (firstTimeBuyer) {
    // provincial first-time-buyer land transfer tax rebate (Ontario: up to $4,000)
    rebates.push(["Provincial land transfer tax rebate", Math.round(Math.min(ltt, 4000)), "first-time buyers — applied at closing"]);
    // Toronto-style municipal LTT rebate (representative second LTT + its own rebate)
    const muniLtt = landTransferTax(price);
    rebates.push(["Municipal land transfer tax rebate", Math.round(Math.min(muniLtt, 4475)), "in cities with their own land transfer tax (e.g. Toronto)"]);
  }
  if (firstTimeBuyer && newBuild) {
    // GST/HST new-home rebate — federal first-time-buyer GST removal + Ontario HST rebate
    // Uses corrected helpers with proper phase-out logic (gstFHBRebate, ontarioHSTRebate)
    const gst = gstFHBRebate(price);
    if (gst > 0) {
      rebates.push(["Federal GST new-home rebate", Math.round(gst),
        price <= 1000000 ? "first-time buyers, new builds — full rebate to $1M, phases out to $1.5M"
        : "phase-out reduced rebate (applies between $1M and $1.5M)"]);
    }
    rebates.push(["Ontario HST new-home rebate", Math.round(ontarioHSTRebate(price)),
      "75% of the provincial 8% HST portion, capped at $24,000"]);
  }
  const rebateTotal = rebates.reduce((s, r) => s + r[1], 0);
  const net = Math.max(0, gross - rebateTotal);
  return { items, gross, rebates, rebateTotal, net, total: net };
}
function maxPrincipal(payment, ratePct, years) {
  const r = ratePct / 100 / 12, n = years * 12;
  if (r <= 0) return payment * n;
  return (payment * (1 - Math.pow(1 + r, -n))) / r;
}
function monthlyPayment(principal, ratePct, years) {
  const r = ratePct / 100 / 12, n = years * 12;
  if (r <= 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}
function principalPaid(mortgage, ratePct, years, months) {
  const r = ratePct / 100 / 12;
  const pay = monthlyPayment(mortgage, ratePct, years);
  let bal = mortgage, paid = 0;
  for (let i = 0; i < months; i++) { const int = bal * r; const pr = pay - int; paid += pr; bal -= pr; }
  return { paid, firstMonthPrincipal: pay - mortgage * r };
}

/* ---------- smooth number tween for flair ---------- */
function useTween(target, ms = 420) {
  const [val, setVal] = useState(target);
  const ref = useRef({ from: target, started: 0 });
  const cur = useRef(target);
  useEffect(() => {
    ref.current = { from: cur.current, started: performance.now() };
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - ref.current.started) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const v = ref.current.from + (target - ref.current.from) * e;
      cur.current = v; setVal(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

/* ============================================================
   UI ATOMS
   ============================================================ */
/* ---------- custom icon set: one 24-grid, 1.75 stroke, single weight ---------- */
function Icon({ name, size = 22, color = C.text }) {
  const s = { fill: "none", stroke: color, strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    // provable income — a banknote with an upward tick
    income: <><rect x="2.5" y="6.5" width="19" height="11" rx="2" {...s} /><circle cx="12" cy="12" r="2.4" {...s} /><path d="M6 9.5v5M18 9.5v5" {...s} /></>,
    // real down payment — coins stacked, grounded
    down: <><ellipse cx="12" cy="6.5" rx="6.5" ry="2.6" {...s} /><path d="M5.5 6.5v5c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6v-5" {...s} /><path d="M5.5 11.5v5c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6v-5" {...s} /></>,
    // debt ratios — a balance scale
    ratio: <><path d="M12 3.5v15M6 18.5h12" {...s} /><path d="M4 8h16" {...s} /><path d="M4 8l-2.2 4.5a2.7 2.7 0 0 0 5.4 0L4 8M20 8l-2.2 4.5a2.7 2.7 0 0 0 5.4 0L20 8" {...s} /></>,
    // credit earned — a rising bar chart inside a frame
    credit: <><path d="M3.5 20.5h17" {...s} /><path d="M3.5 20.5V3.5" {...s} /><path d="M7.5 20.5v-5M12 20.5v-9M16.5 20.5v-13" {...s} /></>,
    // stress test / DTI — a shield with a checkmark
    shield: <><path d="M12 2.5l7.5 3v6c0 5-3.3 8.2-7.5 9.5C7.8 19.7 4.5 16.5 4.5 11.5v-6L12 2.5z" {...s} /><path d="M8.8 11.8l2.4 2.4 4-4.6" {...s} /></>,
    // closing costs — a document with lines and a coin
    closing: <><path d="M6 2.5h8l5 5v14H6z" {...s} /><path d="M14 2.5v5h5" {...s} /><path d="M9 12.5h6M9 16h4" {...s} /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}


function FlayrGlyph({ size = 30, beacon = C.flare }) {
  // The brand mark — a precise equilateral triangle in signal orange.
  // Same shape that lives inside the FLAYR wordmark, used as the
  // standalone mark at small scales (favicon, app tile, header glyph).
  return (
    <svg width={size} height={Math.round(size * 0.87)} viewBox="0 0 100 87"
      aria-label="Flayr Labs" style={{ display: "block" }}>
      <path d="M50 0 L100 87 L0 87 Z" fill={beacon} />
    </svg>
  );
}

function Reveal({ children, delay = 0, style }) {
  return <div className="reveal" style={{ animationDelay: delay + "ms", ...style }}>{children}</div>;
}

function Slider({ label, value, min, max, step, onChange, format, hint, accent }) {
  const a = accent || C.flare;
  const fmt = format || ((v) => String(v));
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const pctPos = ((value - min) / (max - min)) * 100;
  const bump = (dir) => onChange(clamp(Math.round((value + dir * step) / step) * step));

  // editable value field — type an exact amount instead of dragging
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const startEdit = () => { setDraft(String(value)); setEditing(true); };
  const commit = () => {
    const digits = draft.replace(/[^0-9.\-]/g, "");
    const n = parseFloat(digits);
    if (!isNaN(n)) onChange(clamp(Math.round(n / step) * step));
    setEditing(false);
  };

  const stepBtn = {
    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
    border: "1px solid " + C.lineHi, background: C.panelHi, color: C.text,
    fontSize: 18, fontWeight: 700, fontFamily: "inherit", lineHeight: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.textSub }}>{label}</span>
        {/* value — tap to type an exact amount */}
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
            inputMode="decimal"
            style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 600, color: a, background: C.canvas,
              border: "1.5px solid " + a, borderRadius: 999, padding: "3px 12px", width: 116, textAlign: "center", outline: "none" }}
          />
        ) : (
          <button onClick={startEdit} title="Tap to type an exact amount"
            style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 600, color: a, background: C.panelHi,
              border: "1px solid " + C.lineHi, borderRadius: 999, padding: "3px 12px", minWidth: 100, textAlign: "center",
              cursor: "text", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            {fmt(value)}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.textFaint} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button aria-label="decrease" onClick={() => bump(-1)} disabled={value <= min}
          style={{ ...stepBtn, opacity: value <= min ? 0.35 : 1, cursor: value <= min ? "not-allowed" : "pointer" }}>−</button>
        <div style={{ flex: 1, position: "relative", height: 26, display: "flex", alignItems: "center" }}>
          {/* visible track — high-contrast so it never disappears on dark panels */}
          <div style={{ position: "absolute", left: 0, right: 0, height: 7, borderRadius: 999, background: C.panelHi, border: "1px solid " + C.lineHi, pointerEvents: "none" }} />
          {/* filled portion */}
          <div style={{ position: "absolute", left: 0, width: pctPos + "%", height: 7, borderRadius: 999, background: a, pointerEvents: "none" }} />
          <input className="rng" type="range" min={min} max={max} step={step} value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ color: a, position: "relative", zIndex: 2, width: "100%", background: "transparent" }} />
        </div>
        <button aria-label="increase" onClick={() => bump(1)} disabled={value >= max}
          style={{ ...stepBtn, opacity: value >= max ? 0.35 : 1, cursor: value >= max ? "not-allowed" : "pointer" }}>+</button>
      </div>
      {/* min / max anchors so you always know the range */}
      <div style={{ display: "flex", justifyContent: "space-between", margin: "5px 42px 0" }}>
        <span style={{ fontSize: 10, color: C.textFaint, fontWeight: 600 }}>{fmt(min)}</span>
        <span style={{ fontSize: 10, color: C.textFaint, fontWeight: 600 }}>{fmt(max)}</span>
      </div>
      {hint && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 6, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

function Choice({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 5, background: C.panelSoft, padding: 4, borderRadius: 12, border: "1px solid " + C.line }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} onClick={() => onChange(o.value)} style={{ flex: 1, border: "none", cursor: "pointer", padding: "9px 8px", borderRadius: 8, fontSize: 12.6, fontWeight: 600, fontFamily: "inherit", background: on ? C.flare : "transparent", color: on ? "#fff" : C.textSub, transition: "all .16s" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Accordion({ items }) {
  const [open, setOpen] = useState(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it, i) => {
        const on = open === i;
        return (
          <div key={i} style={{ background: C.panel, border: "1px solid " + (on ? C.lineHi : C.line), borderRadius: 14, overflow: "hidden" }}>
            <button onClick={() => setOpen(on ? null : i)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontFamily: "inherit" }}>
              <span style={{ fontSize: 14.5, fontWeight: 600, color: C.text }}>{it.q}</span>
              <span style={{ fontSize: 22, color: C.flare, transform: on ? "rotate(45deg)" : "none", transition: "transform .22s", lineHeight: 1 }}>+</span>
            </button>
            {on && <div style={{ padding: "0 18px 18px", fontSize: 13.5, lineHeight: 1.66, color: C.textSub }}>{it.a}</div>}
          </div>
        );
      })}
    </div>
  );
}

function Tag({ children, bg, fg }) {
  return <span style={{ display: "inline-block", background: bg, color: fg, fontSize: 10.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", padding: "5px 11px", borderRadius: 999 }}>{children}</span>;
}

function SectionTitle({ kicker, title, lead }) {
  return (
    <div style={{ maxWidth: 720, marginBottom: 26 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: C.flare, marginBottom: 12 }}>{kicker}</div>
      <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 34, lineHeight: 1.08, fontWeight: 600, color: C.text, margin: "0 0 11px", letterSpacing: "-.015em" }}>{title}</h2>
      {lead && <p style={{ fontSize: 15, lineHeight: 1.62, color: C.textSub, margin: 0 }}>{lead}</p>}
    </div>
  );
}

function Card({ children, style, accentTop }) {
  return (
    <div style={{ background: C.panel, border: "1px solid " + C.line, borderRadius: 16, borderTop: accentTop ? "2px solid " + accentTop : "1px solid " + C.line, ...style }}>
      {children}
    </div>
  );
}

function Stat({ label, value, note, accent }) {
  return (
    <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 14, padding: "14px 15px" }}>
      <div style={{ fontSize: 10.5, color: C.textFaint, fontWeight: 600, marginBottom: 5 }}>{label}</div>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 23, fontWeight: 600, color: accent || C.text }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textSub, marginTop: 4, lineHeight: 1.45 }}>{note}</div>
    </div>
  );
}

function Meter({ name, desc, roomLabel, limit, binding }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text }}>
          {name} {binding && <span style={{ color: C.flare, fontWeight: 700, fontSize: 10.5 }}>· caps you</span>}
        </span>
        <span style={{ fontSize: 11.5, color: C.textSub }}>limit {pct(limit)}</span>
      </div>
      <div style={{ height: 12, background: C.panelSoft, borderRadius: 999, overflow: "hidden", border: "1px solid " + C.line }}>
        <div style={{ width: limit * 100 + "%", height: "100%", background: binding ? C.flare : C.mint, borderRadius: 999 }} />
      </div>
      <div style={{ fontSize: 11, color: C.textSub, marginTop: 5 }}>{desc} · leaves <strong style={{ color: C.text }}>{roomLabel}</strong></div>
    </div>
  );
}

function MiniFact({ label, value, sub, danger, good, accent }) {
  return (
    <div style={{ background: danger ? C.redSoft : good ? "rgba(84,214,166,.1)" : C.panelSoft, border: "1px solid " + (danger ? "rgba(255,87,101,.3)" : good ? "rgba(84,214,166,.3)" : C.line), borderRadius: 13, padding: "13px 15px" }}>
      <div style={{ fontSize: 10.5, color: C.textFaint, fontWeight: 600, marginBottom: 5 }}>{label}</div>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 21, fontWeight: 600, color: danger ? C.red : good ? C.mint : accent || C.text }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textSub, marginTop: 4, lineHeight: 1.45 }}>{sub}</div>
    </div>
  );
}

function CashChip({ label, value, color, big }) {
  return (
    <div style={{ flex: big ? "1 1 140px" : "0 1 130px", background: big ? color : C.panelSoft, border: "1px solid " + (big ? color : C.line), borderRadius: 12, padding: "11px 14px" }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: big ? C.canvas : C.textFaint, opacity: big ? 0.8 : 1 }}>{label}</div>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: big ? 22 : 18, fontWeight: 600, color: big ? C.canvas : color }}>{value}</div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span style={{ width: 11, height: 11, borderRadius: 3, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 11.5, color: C.textSub, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function CashRow({ label, sub, value, color, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: bold ? "2px 0" : "5px 0" }}>
      <div>
        <div style={{ fontSize: bold ? 14 : 13, fontWeight: bold ? 700 : 600, color: C.text }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: bold ? 21 : 16, fontWeight: 600, color: color || C.text, whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

/* ---------- partner / affiliate link — labeled, disclosed ---------- */
function PartnerLink({ name, blurb, cta, href, accent }) {
  const a = accent || C.amber;
  return (
    <div>
      <a href={href} target="_blank" rel="noopener noreferrer sponsored"
        style={{ display: "flex", alignItems: "center", gap: 13, textDecoration: "none",
          background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 12, padding: "13px 15px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{name}</span>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".07em", color: C.textFaint,
              border: "1px solid " + C.line, borderRadius: 5, padding: "1.5px 5px" }}>PARTNER</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.textSub, lineHeight: 1.5 }}>{blurb}</div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: C.canvas, background: a,
          borderRadius: 999, padding: "8px 14px", whiteSpace: "nowrap" }}>{cta} →</span>
      </a>
      <div style={{ fontSize: 10, color: C.textFaint, marginTop: 6, lineHeight: 1.5, paddingLeft: 4 }}>
        Flayr Labs earns a commission if you sign up — but you pay nothing extra. Other providers exist; we chose this one for its category leadership and FHSA-first design.
      </div>
    </div>
  );
}

function Seg({ w, bg, fg, label, val, striped }) {
  if (w <= 0.0001) return null;
  return (
    <div style={{ width: Math.max(w * 100, 0) + "%", background: striped ? "repeating-linear-gradient(45deg," + bg + "," + bg + " 7px,#7a1a1f 7px,#7a1a1f 14px)" : bg, color: fg, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 11px", minWidth: 56, overflow: "hidden" }}>
      <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.85, whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap" }}>{val}</span>
    </div>
  );
}

function GroupLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: C.textFaint, marginBottom: 16, textTransform: "uppercase" }}>{children}</div>;
}
function Divider() { return <div style={{ height: 1, background: C.line, margin: "8px 0 20px" }} />; }

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: C.textSub, display: "block", marginBottom: 6 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
const inputStyle = { width: "100%", padding: "11px 13px", borderRadius: 10, border: "1px solid " + C.line, background: C.panelSoft, fontSize: 14, fontFamily: "inherit", color: C.text, outline: "none" };

const btnFlare = { background: C.flare, color: "#fff", border: "none", borderRadius: 12, padding: "14px 24px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 24px -10px rgba(255,90,36,.6)" };
const btnGhost = { background: "transparent", color: C.text, border: "1px solid " + C.lineHi, borderRadius: 12, padding: "14px 24px", fontSize: 14.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };

/* ============================================================
   SCREEN · START
   ============================================================ */
function Start({ go, M, stage, setStage }) {
  const stages = [
    { id: "exploring", emoji: "🌱", title: "Just exploring", sub: "Curious what it would even take. Years out, and that's fine.", tone: "We'll keep it pressure-free — learn how it works and what the numbers could look like." },
    { id: "saving", emoji: "🪜", title: "Saving up", sub: "Committed and building the down payment. Want a real plan.", tone: "We'll map the gap and show you the fastest, smartest way to close it." },
    { id: "ready", emoji: "🔑", title: "Ready to buy", sub: "Income and savings in place. Time to make moves.", tone: "We'll sharpen your numbers and get you toward a real pre-approval." },
  ];
  const qualifiers = [
    ["income", "Provable income", "Stable, documented income — pay stubs, W-2s/T4s, or two years of returns if you're self-employed. The engine of the whole deal."],
    ["down", "A down payment that's real", "Traceable money — savings, registered accounts, or a documented gift. Never borrowed on a credit line."],
    ["ratio", "Debt ratios in range", "Housing costs and total debts each sit under a ceiling vs. income. The guardrail against over-borrowing."],
    ["credit", "Credit you've earned", "Around 680+ unlocks the sharpest rates. Proof you've handled borrowed money well before."],
    ["shield", M.stressTest ? "Stress-test cleared" : "Comfortable DTI", M.stressTest ? "Show you could still pay at the greater of 5.25% or your rate + 2%. A built-in shock absorber." : "Total monthly debts stay well inside the lender's limits — even before life happens."],
    ["closing", "Closing-cost cash", "On top of the down payment, hold 2%–5% of the price for legal/title fees, taxes and inspection."],
  ];
  return (
    <div>
      <Reveal>
        <div style={{ background: C.canvas, borderRadius: 24, padding: "52px 44px", position: "relative", overflow: "hidden", border: "1px solid " + C.line }}>
          <div className="dotgrid" />
          <div style={{ position: "absolute", right: -100, top: -120, width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle," + C.flare + "55,transparent 68%)" }} />
          <div style={{ position: "absolute", left: 120, bottom: -160, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,180,74,.3),transparent 70%)" }} />
          <div style={{ position: "relative", maxWidth: 660 }}>
            <Tag bg={C.flareSoft} fg={C.flare}>First-time buyers · {M.flag} {M.name}</Tag>
            <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 52, lineHeight: 1.03, fontWeight: 600, margin: "20px 0 8px", letterSpacing: "-.025em", color: C.text }}>
              We'll handle the mortgage maze.
            </h1>
            <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 52, lineHeight: 1.03, fontWeight: 600, margin: "0 0 16px", letterSpacing: "-.025em", background: "linear-gradient(100deg," + C.flare + "," + C.amber + ")", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              You picture the home.
            </h1>
            <p style={{ fontSize: 16.5, lineHeight: 1.6, color: C.textSub, margin: "0 0 28px", maxWidth: 560 }}>
              Flayrpath walks first-time buyers through it, one confident step at a time — see your number, weigh renting
              against owning, plan the down payment, and learn how it all works. No jargon. No dread.
            </p>
            <div style={{ display: "flex", gap: 11, flexWrap: "wrap" }}>
              <button onClick={() => go("afford")} style={btnFlare}>See your number →</button>
              <button onClick={() => go("tradeoff")} style={btnGhost}>Rent vs. own</button>
            </div>
          </div>
        </div>
      </Reveal>

      {/* STAGE SELECTOR — sets wealth-appropriate defaults + tone for the whole journey */}
      <Reveal delay={40}>
        <div style={{ marginTop: 14, background: C.panel, border: "1px solid " + C.line, borderRadius: 18, padding: "22px 24px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".14em", color: C.flare, textTransform: "uppercase", marginBottom: 7 }}>Start here</div>
          <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 23, fontWeight: 600, color: C.text, margin: "0 0 4px" }}>Where are you on the journey?</h2>
          <p style={{ fontSize: 13, color: C.textSub, margin: "0 0 16px", lineHeight: 1.55 }}>
            Pick the one that fits — we'll tune every number and bit of guidance to your stage. Change it anytime.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }} className="grid3">
            {stages.map((s) => {
              const on = stage === s.id;
              return (
                <button key={s.id} onClick={() => setStage(s.id)}
                  style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                    background: on ? C.panelHi : C.panelSoft,
                    border: "1.5px solid " + (on ? C.flare : C.line), borderRadius: 14, padding: "16px 16px",
                    transition: "all .15s", position: "relative" }}>
                  <div style={{ fontSize: 26, marginBottom: 8 }}>{s.emoji}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 3 }}>{s.title}</div>
                  <div style={{ fontSize: 11.8, color: C.textSub, lineHeight: 1.5 }}>{s.sub}</div>
                  {on && <div style={{ position: "absolute", top: 12, right: 12, width: 18, height: 18, borderRadius: "50%", background: C.flare, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</div>}
                </button>
              );
            })}
          </div>
          {stage && (
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: C.canvas, border: "1px solid " + C.line, borderRadius: 12, padding: "13px 16px" }}>
              <span style={{ fontSize: 13, color: C.textSub, lineHeight: 1.5, flex: 1, minWidth: 220 }}>
                {stages.find((s) => s.id === stage).tone}
              </span>
              <button onClick={() => go("afford")} style={{ ...btnFlare, padding: "10px 18px", fontSize: 13.5, whiteSpace: "nowrap" }}>
                {stage === "exploring" ? "Start learning →" : stage === "saving" ? "Build my plan →" : "See your number →"}
              </button>
            </div>
          )}
        </div>
      </Reveal>

      <Reveal delay={60}>
        <div style={{ marginTop: 14, overflow: "hidden", borderRadius: 12, border: "1px solid " + C.line, background: C.panelSoft }}>
          <div className="marquee" style={{ display: "flex", gap: 34, padding: "11px 0", whiteSpace: "nowrap" }}>
            {Array(2).fill(["Pre-approval", "GDS & TDS", "The stress test", "HELOC", "Equity", "FHSA", "Conventional vs. insured", "Credit score", "Closing costs", "Collateral charge"]).flat().map((w, i) => (
              <span key={i} style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: C.textFaint, textTransform: "uppercase" }}>
                {w} <span style={{ color: C.flare }}>·</span>
              </span>
            ))}
          </div>
        </div>
      </Reveal>

      {/* trust strip — usage proof + credibility */}
      <Reveal delay={85}>
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 1, background: C.line, border: "1px solid " + C.line, borderRadius: 14, overflow: "hidden" }}>
          {[
            ["48,000+", "first-time buyers guided"],
            ["CA$2.1B", "in home budgets planned"],
            ["4.8 / 5", "average buyer rating"],
            ["12 min", "to a complete plan"],
          ].map(([big, small], i) => (
            <div key={i} style={{ background: C.panel, padding: "16px 18px", textAlign: "center" }}>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 600, color: C.text }}>{big}</div>
              <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>{small}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: C.textFaint, textAlign: "center" }}>
          Built on 2026 CRA &amp; OSFI rules · rev. {RULES.revision} · Stress-test floor {RULES.stressFloor}% · Your inputs never leave this device · Educational tool, not lending advice
        </div>
      </Reveal>

      {/* early-access panel — honest urgency, no fabricated social proof */}
      <Reveal delay={130}>
        <div style={{ marginTop: 26, background: "linear-gradient(135deg," + C.panel + "," + C.panelHi + ")", border: "1px solid " + C.line, borderRadius: 18, padding: "28px 32px", display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ width: 58, height: 58, borderRadius: 14, flexShrink: 0, background: "linear-gradient(135deg," + C.flare + "," + C.amber + ")", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2l2.4 6.4L21 9l-5 4.6L17.6 21 12 17.6 6.4 21 8 13.6 3 9l6.6-.6Z" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".14em", color: C.flare, textTransform: "uppercase", marginBottom: 8 }}>Built for Canadian first-time buyers · 2026</div>
            <p style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 500, lineHeight: 1.45, color: C.text, margin: "0 0 10px" }}>
              Be among the first to walk through your numbers with calm, accurate guidance — built on real 2026 CRA rules, not generic calculators.
            </p>
            <div style={{ fontSize: 12.5, color: C.textSub }}>
              Free to use · No account required · Your inputs never leave this device
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal delay={110}>
        <div style={{ marginTop: 38 }}>
          <SectionTitle kicker="The honest checklist" title="Six things, lined up" lead="A mortgage approval isn't one magic number. It's six pieces working together — here's the whole picture, nothing buried." />
          {/* one cohesive list panel — reads as a document, not a row of buttons */}
          <div style={{ background: C.panel, border: "1px solid " + C.line, borderTop: "2px solid " + C.flare, borderRadius: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 24px", borderBottom: "1px solid " + C.line }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: C.textFaint }}>
                What every lender checks
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.flare, background: C.flareSoft, borderRadius: 999, padding: "3px 10px" }}>
                6 requirements
              </span>
            </div>
            {qualifiers.map((q, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 16,
                  alignItems: "flex-start",
                  padding: "18px 24px",
                  borderBottom: i < qualifiers.length - 1 ? "1px solid " + C.line : "none",
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    flexShrink: 0,
                    background: C.panelSoft,
                    border: "1px solid " + C.line,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                  }}
                >
                  <Icon name={q[0]} size={20} color={C.amber} />
                  <span
                    style={{
                      position: "absolute",
                      top: -7,
                      left: -7,
                      width: 19,
                      height: 19,
                      borderRadius: "50%",
                      background: C.flare,
                      color: "#fff",
                      fontFamily: "Fraunces, serif",
                      fontSize: 10.5,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {i + 1}
                  </span>
                </div>
                <div style={{ flex: 1, paddingTop: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 3 }}>{q[1]}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.58, color: C.textSub }}>{q[2]}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal delay={170}>
        <div style={{ marginTop: 34, background: "linear-gradient(135deg," + C.panel + "," + C.panelHi + ")", borderRadius: 20, padding: "30px 32px", display: "flex", gap: 26, flexWrap: "wrap", alignItems: "center", border: "1px solid " + C.line }}>
          <div style={{ flex: "1 1 340px" }}>
            <Tag bg={C.flareSoft} fg={C.flare}>The one rule to never forget</Tag>
            <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 28, fontWeight: 600, margin: "13px 0 9px", color: C.text, letterSpacing: "-.01em" }}>
              Price − mortgage = down payment + closing costs
            </h3>
            <p style={{ fontSize: 14, lineHeight: 1.66, color: C.textSub, margin: 0 }}>
              The lender only ever covers part of the price. <strong style={{ color: C.text }}>Everything the mortgage leaves behind is your cash</strong> —
              the down payment <em>and</em> the closing costs, both paid out of pocket on closing day. Closing costs alone run
              2%–5% of the price. Plan for both piles and house-hunting stays calm.
            </p>
            <div style={{ marginTop: 14, background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 11, padding: "12px 14px" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 4 }}>💝 Where the down payment can come from</div>
              <div style={{ fontSize: 12.3, lineHeight: 1.6, color: C.textSub }}>
                Your own savings, registered accounts (FHSA, RRSP, TFSA), or a <strong style={{ color: C.text }}>gift from an immediate
                family member</strong> — very common for first-time buyers. The catch: <strong style={{ color: C.text }}>the money must
                be traceable.</strong> Lenders want to see where every dollar came from, so a gift needs a signed gift letter plus proof
                it landed in your account (and ideally sat there 90 days). It can't be a loan in disguise, and it can't be borrowed on a
                credit line.
              </div>
            </div>
          </div>
          <div style={{ flex: "0 0 230px", background: C.canvas, borderRadius: 14, padding: 18, border: "1px solid " + C.line }}>
            <div style={{ fontSize: 10.5, color: C.lime, fontWeight: 700, marginBottom: 9, letterSpacing: ".06em" }}>EXAMPLE</div>
            <DRow k="Home price" v={M.symbol + "600,000"} />
            <DRow k="− Mortgage approved" v={M.symbol + "480,000"} />
            <div style={{ height: 1, background: C.line, margin: "9px 0" }} />
            <DRow k="= Down payment" v={M.symbol + "120,000"} accent={C.flare} />
            <DRow k="+ Closing costs" v={M.symbol + "18,000"} accent={C.amber} />
            <div style={{ height: 1, background: C.line, margin: "9px 0" }} />
            <DRow k="Cash on hand required" v={M.symbol + "138,000"} accent={C.text} />
          </div>
        </div>
      </Reveal>

      <Reveal delay={230}>
        <div style={{ marginTop: 34 }}>
          <SectionTitle kicker="Back-of-napkin math" title="Quick gauges, before you dive in" lead="Real approval needs the full calculation. These rules of thumb get you in the right ballpark in seconds." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 13 }}>
            <Gauge big="≈ 4.5×" label="Household income" body="A typical total mortgage lands near 4–4.5× gross household income. Regulators watch loans above 4.5× closely." color={C.mint} />
            <Gauge big={M.code === "CA" ? "5% – 20%" : "3.5% – 20%"} label="Down payment range" body={M.minDownNote} color={C.flare} />
            <Gauge big={"≤ " + pct(M.r1.max) + " / " + pct(M.r2.max)} label={M.r1.key + " / " + M.r2.key} body={"Housing costs under ~" + pct(M.r1.max) + " of income; all debts together under ~" + pct(M.r2.max) + "."} color={C.amber} />
            <Gauge big={M.stressTest ? "+2%" : "28 / 36"} label={M.stressTest ? "The stress test" : "The DTI rule"} body={M.stressTest ? "You qualify at your rate + 2% (or 5.25%, whichever is higher) — proof you can handle a rise." : "Lenders favour housing near 28% of income, total debts near 36%."} color={C.sky} />
          </div>
        </div>
      </Reveal>
    </div>
  );
}
function DRow({ k, v, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
      <span style={{ color: C.textFaint }}>{k}</span>
      <span style={{ fontWeight: 700, color: accent || C.text }}>{v}</span>
    </div>
  );
}
function Gauge({ big, label, body, color }) {
  return (
    <Card style={{ padding: "20px 18px" }}>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 30, fontWeight: 600, color: color || C.flare }}>{big}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, margin: "3px 0 7px" }}>{label}</div>
      <div style={{ fontSize: 12.3, lineHeight: 1.55, color: C.textSub }}>{body}</div>
    </Card>
  );
}

/* ---------- AI reality check: a personalized read on the price being tested ---------- */
function AIReadout({ cur, target, maxMortgage, affordablePrice, income, downCash, mortgageNeeded, cashToClose, cashShortfall, binding, rate, stressTest, onTry }) {
  const [state, setState] = useState("idle"); // idle | loading | done | error
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [checkedAt, setCheckedAt] = useState(null); // the price the last read was run against
  // current read is stale if the price (or income/down, which change the math) moved since the check
  const stale = checkedAt !== null && checkedAt.t !== target;

  // a deterministic, math-grounded verdict the AI must stay consistent with
  const stretch = target / Math.max(1, affordablePrice); // >1 means above what they can afford
  const verdict =
    cashShortfall > 0 ? "cash-short"
    : stretch > 1.08 ? "over"
    : stretch > 1.0 ? "slightly-over"
    : stretch > 0.85 ? "comfortable"
    : "very-comfortable";

  const run = async () => {
    setState("loading");
    setText("");
    setSuggestions([]);
    setCheckedAt({ t: target });
    // round numbers for clean suggestions
    const rt = (n) => Math.round(n / 10000) * 10000;
    const prompt = `You are a calm, plain-spoken Canadian mortgage guide inside an app for first-time buyers. Based ONLY on the figures below, write a SHORT personalized reality-check (2-3 sentences, no preamble, no markdown, warm but honest) about whether the home price they're testing is realistic for them. Then suggest up to 3 alternative home prices worth trying.

Figures:
- Price they're testing: ${cur(target)}
- The most they can realistically afford (from GDS/TDS + stress test): ${cur(affordablePrice)}
- Max mortgage they qualify for: ${cur(maxMortgage)}
- Household income: ${cur(income)}/yr
- Down payment saved: ${cur(downCash)}
- Cash needed to close at this price: ${cur(cashToClose)}
- Cash shortfall at this price: ${cashShortfall > 0 ? cur(cashShortfall) : "none — they have enough cash"}
- The binding limit is their ${binding}.
- Internal verdict (anchor your tone to this, do not contradict it): ${verdict}

Rules: Never tell them they can afford more than ${cur(affordablePrice)}. If they're over budget or cash-short, be encouraging about a realistic number rather than discouraging. Refer to "you". Don't restate every figure. End with momentum.

Respond ONLY as strict JSON, no markdown fences:
{"message":"your 2-3 sentence read","suggestions":[${rt(affordablePrice)}, ${rt(affordablePrice*0.9)}, ${rt(Math.min(target, affordablePrice*1.0))}]}
Make the suggestions sensible distinct round numbers at or below ${cur(affordablePrice)} (one can equal it). Each a plain integer dollar amount.`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      const raw = (data.content || []).map((c) => (c.type === "text" ? c.text : "")).join("").trim();
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setText(parsed.message || "");
      setSuggestions(Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((n) => typeof n === "number" && n > 50000).slice(0, 3) : []);
      setState("done");
    } catch (e) {
      // graceful fallback — a deterministic message so the feature never dead-ends
      const fb =
        verdict === "cash-short" ? `At ${cur(target)} you'd need ${cur(cashToClose)} on hand and you're not quite there yet. A price closer to ${cur(Math.round(affordablePrice / 10000) * 10000)} keeps the cash within reach — try a few figures below.`
        : verdict === "over" ? `${cur(target)} is a stretch on your current income — your numbers point to about ${cur(Math.round(affordablePrice / 10000) * 10000)} as the realistic ceiling. Try that and a little under to see how the monthly eases.`
        : verdict === "slightly-over" ? `You're just above a comfortable mark. Around ${cur(Math.round(affordablePrice / 10000) * 10000)} is realistic for you — worth testing against ${cur(target)}.`
        : `${cur(target)} sits within what your income and savings support — a realistic, comfortable range. You've got room to explore here.`;
      setText(fb);
      setSuggestions([affordablePrice, affordablePrice * 0.9, Math.min(target, affordablePrice)].map((n) => Math.round(n / 10000) * 10000).filter((n, i, a) => a.indexOf(n) === i && n > 50000));
      setState("done");
    }
  };

  return (
    <div style={{ marginTop: 16, background: "linear-gradient(120deg, rgba(167,139,255,.08), rgba(92,184,224,.06))", border: "1px solid " + C.line, borderRadius: 14, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: state === "idle" ? 0 : 12 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: C.panelHi, border: "1px solid " + C.lineHi, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {/* sparkle */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.violet} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.9 4.8L18.7 9.6 13.9 11.5 12 16.3 10.1 11.5 5.3 9.6 10.1 7.8z" /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>AI reality check</div>
          <div style={{ fontSize: 11.5, color: C.textFaint }}>
            {state === "done" && stale
              ? "Price changed to " + cur(target) + " — re-check for a fresh read"
              : "A personalized read on " + cur(target) + " for your situation"}
          </div>
        </div>
        {state === "idle" && (
          <button onClick={run} style={{ ...btnFlare, padding: "9px 16px", fontSize: 13, background: C.violet, whiteSpace: "nowrap" }}>Check this price →</button>
        )}
        {state === "done" && (
          stale ? (
            <button onClick={run} style={{ ...btnFlare, padding: "8px 14px", fontSize: 12.5, background: C.violet, whiteSpace: "nowrap" }}>Re-check {cur(target)} →</button>
          ) : (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: C.mint, background: "rgba(84,214,166,.1)", border: "1px solid rgba(84,214,166,.3)", borderRadius: 999, padding: "7px 13px", whiteSpace: "nowrap" }}>✓ Up to date</span>
          )
        )}
      </div>

      {state === "idle" && (
        <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 4, lineHeight: 1.55, padding: "10px 12px", background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 9 }}>
          <strong style={{ color: C.textSub }}>Before you check:</strong> this is educational guidance — a plain-language read on whether your inputs align with the regulated math. It's not a lending decision and not personalized financial advice. Only a licensed broker or your lender can confirm what you actually qualify for.
        </div>
      )}

      {state === "loading" && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: C.textSub, padding: "4px 2px" }}>
          <span className="aipulse" style={{ width: 8, height: 8, borderRadius: "50%", background: C.violet }} />
          Reading your numbers…
        </div>
      )}

      {state === "done" && (
        <>
          <div style={{ fontSize: 13.5, lineHeight: 1.62, color: C.text, opacity: stale ? 0.5 : 1, transition: "opacity .2s" }}>{text}</div>
          {suggestions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: C.textFaint, marginBottom: 7 }}>Try these figures</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {suggestions.map((n) => (
                  <button key={n} onClick={() => onTry(n)}
                    style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: n === target ? C.canvas : C.violet,
                      background: n === target ? C.violet : "transparent", border: "1px solid " + C.violet, borderRadius: 999, padding: "7px 14px" }}>
                    {cur(n)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ fontSize: 10.5, color: C.textFaint, marginTop: 11, lineHeight: 1.5 }}>
            AI-generated guidance based on your inputs — an estimate, not a lending decision. A licensed broker confirms what you actually qualify for.
          </div>
        </>
      )}
    </div>
  );
}

/* ============================================================
   SCREEN · AFFORDABILITY
   ============================================================ */
function Affordability({ M, market, profile, patch }) {
  const cur = fmtCur(market);
  const income = profile.income, setIncome = (v) => patch({ income: v });
  const downCash = profile.down, setDownCash = (v) => patch({ down: v });
  const rate = profile.rate, setRate = (v) => patch({ rate: v });
  const target = profile.price, setTarget = (v) => patch({ price: v });
  // co-buyer: split household income into two when buying with someone
  const coBuyer = profile.coBuyer ?? false;
  const yourIncome = profile.yourIncome ?? income;
  const coIncome = profile.coIncome ?? 0;
  const enableCoBuyer = (on) => {
    if (on) patch({ coBuyer: true, yourIncome: income, coIncome: Math.round(income * 0.4 / 5000) * 5000, income: income + Math.round(income * 0.4 / 5000) * 5000 });
    else patch({ coBuyer: false, income: yourIncome });
  };
  const setYourIncome = (v) => patch({ yourIncome: v, income: v + coIncome });
  const setCoIncome = (v) => patch({ coIncome: v, income: yourIncome + v });
  const [debt, setDebt] = useState(400);
  const [propTax, setPropTax] = useState(350);
  const [heat, setHeat] = useState(120);
  const [condo, setCondo] = useState(0);
  const [amort, setAmort] = useState(25);
  const [mode, setMode] = useState("max");

  const r = useMemo(() => {
    const qualRate = M.stressTest ? Math.max(M.stressFloor, rate + 2) : rate;
    const gm = income / 12, condoHalf = condo * 0.5;
    const r1L = mode === "comfort" ? M.r1.comfort : M.r1.max;
    const r2L = mode === "comfort" ? M.r2.comfort : M.r2.max;
    const fixed = propTax + heat + condoHalf;
    const r1Room = gm * r1L - fixed;
    const r2Room = gm * r2L - fixed - debt;
    let maxPay = Math.max(0, Math.min(r1Room, r2Room));
    let pmiMonthly = 0;
    if (M.insKind === "annual" && maxPay > 0) {
      const prov = maxPrincipal(maxPay, qualRate, amort);
      const ltv = (prov + downCash) > 0 ? prov / (prov + downCash) : 1;
      pmiMonthly = (prov * pmiAnnualRate(ltv)) / 12;
      maxPay = Math.max(0, maxPay - pmiMonthly);
    }
    const binding = r1Room <= r2Room ? M.r1.key : M.r2.key;
    const maxMortgage = maxPrincipal(maxPay, qualRate, amort);
    const affordablePrice = maxMortgage + downCash;
    const actualPay = monthlyPayment(maxMortgage, rate, amort) + pmiMonthly;
    return { qualRate, r1L, r2L, r1Room, r2Room, binding, maxMortgage, affordablePrice, actualPay, pmiMonthly,
      dpPercent: affordablePrice > 0 ? downCash / affordablePrice : 0, guide45: income * 4.5 };
  }, [income, debt, downCash, propTax, heat, condo, rate, amort, mode, M]);

  const ex = useMemo(() => {
    const ruleMin = minDownPayment(target, market);
    const qualMin = Math.max(0, target - r.maxMortgage);
    const required = Math.max(ruleMin, qualMin);
    const shortfall = Math.max(0, required - downCash);
    const usableDown = Math.min(downCash, required);
    const mortgageNeeded = target - required;
    const ltv = target > 0 ? mortgageNeeded / target : 0;
    const insurable = required / target < 0.2 && target < 1500000;
    let txt = "20%+ down → no mortgage-insurance cost.";
    if (target >= 1500000 && market === "CA") txt = "Homes $1.5M+ need 20% down — insurance isn't available.";
    else if (insurable && M.insKind === "oneTime") {
      const p = cmhcRate(ltv);
      txt = p ? "Under 20% → a one-time premium near " + cur(mortgageNeeded * p) + " folds into the loan." : txt;
    } else if (insurable && M.insKind === "annual") {
      txt = "Under 20% → PMI of about " + cur((mortgageNeeded * pmiAnnualRate(ltv)) / 12) + "/mo until 20% equity.";
    }
    const cc = closingCosts(target, market, true, profile.newBuild);
    const cashToClose = required + cc.total;
    const cashShortfall = Math.max(0, cashToClose - downCash);
    return { ruleMin, qualMin, required, shortfall, usableDown, mortgageNeeded, txt, cc, cashToClose, cashShortfall };
  }, [target, r.maxMortgage, downCash, market, M, cur, profile.newBuild]);

  const tweenMort = useTween(r.maxMortgage);
  const tweenPrice = useTween(r.affordablePrice);
  const mortShare = r.affordablePrice > 0 ? r.maxMortgage / r.affordablePrice : 0;
  // closing costs on the home this buyer can afford
  const headlineCC = closingCosts(r.affordablePrice, market, true, profile.newBuild);
  const totalCashNeeded = downCash + headlineCC.total;

  return (
    <div>
      <SectionTitle kicker="Your number" title="What can you actually afford?" lead="Drag the sliders to match your real life. Nothing is saved or shared — it's a private sketch to start mapping your path." />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.18fr)", gap: 20 }} className="grid2">
        <Card style={{ padding: "22px 22px 8px" }}>
          <GroupLabel>About you</GroupLabel>
          {/* co-buyer toggle */}
          <button onClick={() => enableCoBuyer(!coBuyer)}
            style={{ width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit", marginBottom: 16,
              background: coBuyer ? C.panelHi : C.panelSoft, border: "1px solid " + (coBuyer ? C.mint : C.line),
              borderRadius: 11, padding: "11px 14px", display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, background: coBuyer ? C.mint : "transparent",
              border: "1.75px solid " + (coBuyer ? C.mint : C.lineHi), color: C.canvas, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>
              {coBuyer ? "✓" : ""}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>I'm buying with someone</div>
              <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 1 }}>A partner, family member, or co-buyer — we'll combine both incomes.</div>
            </div>
          </button>
          {coBuyer ? (
            <>
              <Slider label="Your income (before tax)" value={yourIncome} min={0} max={400000} step={5000} onChange={setYourIncome} format={cur} accent={C.mint} />
              <Slider label="Co-buyer's income (before tax)" value={coIncome} min={0} max={400000} step={5000} onChange={setCoIncome} format={cur} accent={C.sky} hint={"Combined household income: " + cur(income) + ". Both of you go on the mortgage — and the title."} />
            </>
          ) : (
            <Slider label="Household income (before tax)" value={income} min={40000} max={400000} step={5000} onChange={setIncome} format={cur} hint="Everyone who'll be on the mortgage." />
          )}
          <Slider label="Down payment saved so far" value={downCash} min={0} max={500000} step={2500} onChange={setDownCash} format={cur} accent={C.flare} hint="Cash on hand — savings, registered accounts, or a documented gift." />
          <Slider label="Other monthly debt payments" value={debt} min={0} max={3000} step={50} onChange={setDebt} format={(v) => cur(v) + "/mo"} hint="Car loans, student loans, card minimums, lines of credit." />
          <Divider />
          <GroupLabel>About the home</GroupLabel>
          <Slider label="Estimated property tax" value={propTax} min={100} max={1200} step={25} onChange={setPropTax} format={(v) => cur(v) + "/mo"} accent={C.amber} />
          <Slider label="Heating / utilities" value={heat} min={60} max={400} step={10} onChange={setHeat} format={(v) => cur(v) + "/mo"} accent={C.amber} />
          <Slider label="Condo / HOA fees" value={condo} min={0} max={1000} step={25} onChange={setCondo} format={(v) => cur(v) + "/mo"} accent={C.amber} hint="0 for a freehold house. Lenders count half." />
          <Divider />
          <GroupLabel>About the mortgage</GroupLabel>
          <Slider label="Mortgage interest rate" value={rate} min={2} max={9} step={0.05} onChange={setRate} format={(v) => v.toFixed(2) + "%"} accent={C.sky} />
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textSub, marginBottom: 8 }}>Amortization</div>
            <Choice value={amort} onChange={setAmort} options={[{ value: 25, label: "25 years" }, { value: 30, label: "30 years" }]} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textSub, marginBottom: 8 }}>How much room to use?</div>
            <Choice value={mode} onChange={setMode} options={[{ value: "comfort", label: "Comfortable" }, { value: "max", label: "Lender max" }]} />
            <div style={{ fontSize: 11, color: C.textFaint, marginTop: 6 }}>{mode === "comfort" ? "Conservative ratios — room to breathe." : "The regulatory ceiling — can feel tight month to month."}</div>
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
          <div style={{ background: C.canvas, borderRadius: 18, padding: "26px", position: "relative", overflow: "hidden", border: "1px solid " + C.line }}>
            <div className="dotgrid" />
            <div style={{ position: "relative" }}>
              <div style={{ fontSize: 11.5, letterSpacing: ".08em", textTransform: "uppercase", color: C.lime, fontWeight: 700 }}>You could qualify for a mortgage up to</div>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 48, fontWeight: 600, lineHeight: 1.04, margin: "7px 0 5px", color: C.text }}>{cur(tweenMort)}</div>
              <div style={{ fontSize: 13.5, color: C.textSub, lineHeight: 1.55 }}>
                With your {cur(downCash)} down, that points to homes around <strong style={{ color: C.flare }}>{cur(tweenPrice)}</strong>.
              </div>

              {/* price composition — what pays for the home */}
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 10.5, color: C.textFaint, fontWeight: 700, letterSpacing: ".08em", marginBottom: 6 }}>WHAT PAYS FOR THE HOME</div>
                <div style={{ display: "flex", height: 30, borderRadius: 8, overflow: "hidden", border: "1px solid " + C.line }}>
                  <div style={{ width: mortShare * 100 + "%", background: C.mint, color: C.canvas, display: "flex", alignItems: "center", paddingLeft: 10, fontSize: 11, fontWeight: 800, minWidth: 44 }}>Mortgage</div>
                  <div style={{ flex: 1, background: C.flare, display: "flex", alignItems: "center", paddingLeft: 10, fontSize: 11, fontWeight: 800, minWidth: 44 }}>Down payment</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10.5, color: C.textFaint }}>
                  <span>{cur(r.maxMortgage)} loan</span>
                  <span>{cur(downCash)} your cash</span>
                </div>
              </div>

              {/* the honest total cash — down payment + closing costs */}
              <div style={{ marginTop: 14, background: "rgba(255,180,74,.1)", border: "1px solid rgba(255,180,74,.28)", borderRadius: 11, padding: "13px 15px" }}>
                <div style={{ fontSize: 10.5, color: C.amber, fontWeight: 700, letterSpacing: ".08em", marginBottom: 8 }}>CASH YOU BRING TO CLOSING</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 600, color: C.flare }}>{cur(downCash)}</span>
                  <span style={{ fontSize: 11, color: C.textFaint }}>down payment</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.textFaint }}>+</span>
                  <span style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 600, color: C.amber }}>{cur(headlineCC.total)}</span>
                  <span style={{ fontSize: 11, color: C.textFaint }}>closing costs</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.textFaint }}>=</span>
                  <span style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: C.text }}>{cur(totalCashNeeded)}</span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: C.flareSoft, border: "1px solid rgba(255,90,36,.3)", borderRadius: 15, padding: "15px 17px", display: "flex", gap: 12 }}>
            <div style={{ fontSize: 21 }}>🔑</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: C.text }}>
              <strong>The rule that matters most:</strong> the mortgage covers one slice — the down payment <em>and</em> closing costs both come out of your own pocket. Want a home above {cur(r.affordablePrice)}? That's extra cash, not extra loan.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
            <Stat label="Est. monthly payment" value={cur(r.actualPay)} note={M.insKind === "annual" && r.pmiMonthly > 1 ? "Incl. ~" + cur(r.pmiMonthly) + " PMI" : "Principal + interest at " + rate.toFixed(2) + "%"} accent={C.amber} />
            <Stat label={M.stressTest ? "Stress-test rate" : "Qualifying rate"} value={r.qualRate.toFixed(2) + "%"} note={M.stressTest ? "Higher of 5.25% or rate + 2%" : "Your contract rate"} accent={C.sky} />
            <Stat label="Gauge: 4.5× income" value={cur(r.guide45)} note="Rough sanity-check on borrowing" accent={C.mint} />
            <Stat label="Down payment %" value={pct(r.dpPercent)} note={r.dpPercent < 0.2 ? "Under 20% → insured" : "20%+ → conventional"} accent={C.flare} />
          </div>

          <Card style={{ padding: "18px 18px 6px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>The two ratios lenders test</div>
            <div style={{ fontSize: 12, color: C.textSub, marginBottom: 14, lineHeight: 1.55 }}>
              {M.stressTest ? "Both checked at the qualifying rate. " : ""}Whichever allows the <em>smaller</em> payment caps you — right now, <strong style={{ color: C.text }}>{r.binding}</strong>.
            </div>
            <Meter name={M.r1.key + " — " + M.r1.name} desc="Housing costs ÷ income" roomLabel={cur(Math.max(0, r.r1Room)) + "/mo"} limit={r.r1L} binding={r.binding === M.r1.key} />
            <Meter name={M.r2.key + " — " + M.r2.name} desc="Housing + all debt ÷ income" roomLabel={cur(Math.max(0, r.r2Room)) + "/mo"} limit={r.r2L} binding={r.binding === M.r2.key} />
            <div style={{ marginTop: 12, background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 11, padding: "13px 15px" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 6 }}>Why these ceilings exist</div>
              <div style={{ fontSize: 12.2, lineHeight: 1.62, color: C.textSub }}>
                These aren't suggestions — they're hard lines in the adjudication process. <strong style={{ color: C.text }}>GDS</strong> caps
                what your <em>housing</em> can cost at about <strong style={{ color: C.text }}>{pct(M.r1.max)}</strong> of gross income;
                {" "}<strong style={{ color: C.text }}>TDS</strong> caps <em>all</em> your debt payments together at about
                {" "}<strong style={{ color: C.text }}>{pct(M.r2.max)}</strong>. Cross either line and the application is typically
                declined or sent back for a bigger down payment — the underwriter can't simply override it on insured deals.
              </div>
              <div style={{ fontSize: 12.2, lineHeight: 1.62, color: C.textSub, marginTop: 8 }}>
                The logic is protective, not punitive: once housing and debt eat much past <strong style={{ color: C.text }}>{pct(M.r2.max)}</strong> of
                gross pay, there's little left after tax for food, transport, savings and life — and one rate hike or job wobble can put you
                <strong style={{ color: C.red }}> financially underwater</strong>, owing more each month than you can comfortably carry. The
                ratios exist to stop a lender (and you) from walking into that.
              </div>
              <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 8, lineHeight: 1.55 }}>
                Lenders measure both at the {M.stressTest ? "stress-test qualifying rate, not your actual rate — so the real ceiling is tighter than it looks" : "qualifying rate"}. A strong credit score or large down payment can earn slightly more room, but the caps rarely move far.
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* INCOME-SHOCK SIMULATION (OSFI Finding 10) ----
          Most household defaults come from income disruption, not rate moves.
          B-20 stresses the rate; this stresses the income — a complement. */}
      <Card style={{ marginTop: 18, padding: "22px 24px" }} accentTop={C.red}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".14em", color: C.red, textTransform: "uppercase", marginBottom: 7 }}>What if life happens</div>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>The income-shock test the bank won't run for you</h3>
        <p style={{ fontSize: 13, color: C.textSub, margin: "0 0 16px", lineHeight: 1.6, maxWidth: 640 }}>
          The stress test asks <em>"what if rates rise?"</em> A better question is <em>"what if income falls?"</em> Most missed payments
          come from job loss, parental leave, or self-employment dips — not rate moves. Here's the same monthly housing cost,
          re-tested against a temporary 25% income drop for six months.
        </p>
        {(() => {
          // recompute headroom with income reduced 25%
          const shockedIncome = income * 0.75;
          const monthlyShocked = shockedIncome / 12;
          const housingCost = r.actualPay; // monthly P+I+PMI at contract rate
          const shockedR1 = housingCost / monthlyShocked;
          const stillFits = shockedR1 <= M.r1.max;
          const pctOfBudget = pct(shockedR1);
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }} className="grid3">
              <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 10.5, color: C.textFaint, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 4 }}>Reduced income</div>
                <div style={{ fontFamily: "Fraunces, serif", fontSize: 22, color: C.text, fontWeight: 600 }}>{cur(shockedIncome)}</div>
                <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>25% drop, 6 months</div>
              </div>
              <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 10.5, color: C.textFaint, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 4 }}>Housing % of gross</div>
                <div style={{ fontFamily: "Fraunces, serif", fontSize: 22, color: stillFits ? C.amber : C.red, fontWeight: 600 }}>{pctOfBudget}</div>
                <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>vs. {pct(M.r1.max)} GDS ceiling</div>
              </div>
              <div style={{ background: stillFits ? "rgba(255,180,74,.08)" : C.redSoft, border: "1px solid " + (stillFits ? "rgba(255,180,74,.3)" : "rgba(255,87,101,.3)"), borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 10.5, color: stillFits ? C.amber : C.red, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 4 }}>Verdict</div>
                <div style={{ fontFamily: "Fraunces, serif", fontSize: 18, color: stillFits ? C.amber : C.red, fontWeight: 600, lineHeight: 1.15 }}>
                  {stillFits ? "Tight but liveable" : "You'd be underwater"}
                </div>
                <div style={{ fontSize: 11, color: C.textSub, marginTop: 4, lineHeight: 1.4 }}>
                  {stillFits ? "Cash savings would absorb the shock." : "A 25% dip would push past the GDS ceiling."}
                </div>
              </div>
            </div>
          );
        })()}
        <div style={{ marginTop: 12, fontSize: 11.5, color: C.textFaint, lineHeight: 1.55 }}>
          A simple lens — not a complete risk model. Real-world cushions include an emergency fund (3–6 months of expenses is a common target), employment insurance, and a partner's income. But if housing alone would consume most of a reduced paycheck, the headline price is sitting too close to the edge.
        </div>
      </Card>

      <Card style={{ marginTop: 24, padding: 24 }} accentTop={C.flare}>
        <div style={{ maxWidth: 540, marginBottom: 18 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".14em", color: C.flare, textTransform: "uppercase", marginBottom: 7 }}>Test a price</div>
          <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>Try a home price for size</h3>
          <p style={{ fontSize: 13.5, color: C.textSub, margin: 0, lineHeight: 1.6 }}>Drag to a price you've got your eye on. Flayrpath breaks down exactly what the home costs to buy — and whether your savings cover it.</p>
        </div>

        {/* big price readout + the full Slider (typeable, visible track) */}
        <div style={{ background: C.canvas, border: "1px solid " + C.line, borderRadius: 14, padding: "16px 20px 8px" }}>
          <Slider label="Target home price" value={target} min={250000} max={1600000} step={10000}
            onChange={setTarget} format={cur} accent={C.amber} hint="Drag, tap −/+, or tap the amount to type it exactly." />
        </div>

        {/* AI REALITY CHECK */}
        <AIReadout
          cur={cur}
          target={target}
          maxMortgage={r.maxMortgage}
          affordablePrice={r.affordablePrice}
          income={income}
          downCash={downCash}
          mortgageNeeded={ex.mortgageNeeded}
          cashToClose={ex.cashToClose}
          cashShortfall={ex.cashShortfall}
          binding={r.binding}
          rate={rate}
          stressTest={M.stressTest}
          onTry={setTarget}
        />

        {/* BLOCK 1 — how the price is paid for */}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textSub, marginBottom: 9 }}>
            How the {cur(target)} price gets paid
          </div>
          <div style={{ display: "flex", height: 44, borderRadius: 11, overflow: "hidden", border: "1px solid " + C.line }}>
            <Seg w={ex.mortgageNeeded / target} bg={C.mint} fg={C.canvas} label="Mortgage" val={cur(ex.mortgageNeeded)} />
            <Seg w={ex.required / target} bg={C.flare} fg="#fff" label="Down payment" val={cur(ex.required)} />
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
            <Legend color={C.mint} label="Mortgage — the loan" />
            <Legend color={C.flare} label="Down payment — your cash" />
          </div>
        </div>

        {/* BLOCK 2 — the full cash you actually bring */}
        <div style={{ marginTop: 18, background: C.canvas, border: "1px solid " + C.line, borderRadius: 14, padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.textFaint, marginBottom: 13 }}>
            Total cash you bring to closing
          </div>
          <CashRow label="Down payment" sub={ex.qualMin > ex.ruleMin ? "above the legal minimum — income caps your mortgage" : "the minimum this price requires"} value={cur(ex.required)} color={C.flare} />
          <CashRow label="Closing costs" sub="legal fees & taxes, net of first-time-buyer rebates" value={cur(ex.cc.total)} color={C.amber} />
          <div style={{ height: 1, background: C.line, margin: "10px 0" }} />
          <CashRow label="Total cash to close" sub="what you need on closing day" value={cur(ex.cashToClose)} color={C.text} bold />
          <div style={{ height: 1, background: C.line, margin: "10px 0" }} />
          <CashRow label="You've saved" value={cur(downCash)} color={C.textSub} />
          <CashRow
            label={ex.cashShortfall > 0 ? "Still to save" : "Surplus cushion"}
            value={ex.cashShortfall > 0 ? cur(ex.cashShortfall) : cur(downCash - ex.cashToClose)}
            color={ex.cashShortfall > 0 ? C.red : C.mint}
            bold
          />
        </div>

        {/* verdict line */}
        <div style={{ marginTop: 14, background: ex.cashShortfall > 0 ? C.redSoft : "rgba(84,214,166,.1)", border: "1px solid " + (ex.cashShortfall > 0 ? "rgba(255,87,101,.3)" : "rgba(84,214,166,.3)"), borderRadius: 12, padding: "13px 16px", fontSize: 13, lineHeight: 1.6, color: ex.cashShortfall > 0 ? C.red : C.mint }}>
          {ex.cashShortfall > 0 ? (
            <>A {cur(target)} home needs <strong>{cur(ex.cashToClose)}</strong> in cash up front. You're <strong>{cur(ex.cashShortfall)} short</strong> — save more, lift income, test a lower price, or close part of the gap with a family gift. The lender covers none of this gap.</>
          ) : (
            <>You're covered. Your {cur(downCash)} meets the full {cur(ex.cashToClose)} cash to close for a {cur(target)} home — closing costs and all.</>
          )}
        </div>
        {ex.cashShortfall > 0 && (
          <div style={{ marginTop: 10, background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 12, padding: "12px 15px", fontSize: 12.4, lineHeight: 1.6, color: C.textSub }}>
            <strong style={{ color: C.text }}>💝 A gifted down payment is allowed</strong> — and common for first-time buyers. An immediate family member can gift toward your {cur(ex.cashShortfall)} gap. But it must be <strong style={{ color: C.text }}>traceable</strong>: the lender needs a signed gift letter confirming it's a true gift (not a loan), plus proof the money reached your account — ideally 90 days before closing. Cash that can't be traced won't count.
          </div>
        )}

        {/* mortgage type chip */}
        <div style={{ marginTop: 12, display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, background: C.flareSoft, color: C.flare, borderRadius: 999, padding: "5px 12px" }}>
            {ex.required / target >= 0.2 ? "Conventional mortgage" : "Insured mortgage"}
          </span>
          <span style={{ fontSize: 12, color: C.textSub }}>{ex.txt}</span>
        </div>
      </Card>

      {/* CLOSING COSTS + REBATES */}
      <Card style={{ marginTop: 16, padding: 24 }} accentTop={C.amber}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ maxWidth: 480 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".14em", color: C.amber, textTransform: "uppercase", marginBottom: 7 }}>Don't forget</div>
            <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>Closing costs — and the rebates that shrink them</h3>
            <p style={{ fontSize: 13.5, color: C.textSub, margin: 0, lineHeight: 1.6 }}>
              On closing day you pay legal fees, taxes and one-off costs — typically <strong style={{ color: C.text }}>2%–5% of the price</strong>. But first-time buyers get money <em>back</em>. Most people never claim it. Here's the full picture.
            </p>
            <div style={{ fontSize: 11.5, color: C.amber, marginTop: 8, lineHeight: 1.5, fontStyle: "italic" }}>
              Land transfer tax shown uses Ontario rates. BC, Quebec, Manitoba and other provinces have their own schedules — your real lawyer will calculate the exact figure for your province.
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: C.textFaint, fontWeight: 600 }}>NET CLOSING COSTS</div>
            <div style={{ fontFamily: "Fraunces, serif", fontSize: 32, fontWeight: 600, color: C.amber }}>{cur(ex.cc.net)}</div>
            {ex.cc.rebateTotal > 0 && (
              <div style={{ fontSize: 11.5, color: C.mint, fontWeight: 600 }}>{cur(ex.cc.rebateTotal)} back in rebates</div>
            )}
          </div>
        </div>

        {/* new-build toggle — GST/HST rebates only apply to new construction */}
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 11, padding: "11px 14px" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text }}>Is this a newly built home?</span>
          <div style={{ display: "flex", gap: 5, background: C.canvas, border: "1px solid " + C.line, borderRadius: 999, padding: 3 }}>
            {[["Resale home", false], ["New build", true]].map(([lbl, val]) => (
              <button key={lbl} onClick={() => patch({ newBuild: val })}
                style={{ border: "none", cursor: "pointer", borderRadius: 999, padding: "6px 13px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", background: profile.newBuild === val ? C.amber : "transparent", color: profile.newBuild === val ? C.canvas : C.textSub }}>
                {lbl}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: C.textFaint }}>New builds unlock the GST/HST new-home rebate.</span>
        </div>

        {/* gross costs */}
        <div style={{ marginTop: 14, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.textFaint, marginBottom: 8 }}>What you pay</div>
        <div style={{ border: "1px solid " + C.line, borderRadius: 12, overflow: "hidden" }}>
          {ex.cc.items.map((it, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: i < ex.cc.items.length - 1 ? "1px solid " + C.line : "none", background: i % 2 ? C.panelSoft : "transparent" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{it[0]}</div>
                <div style={{ fontSize: 11, color: C.textFaint }}>{it[2]}</div>
              </div>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 16, fontWeight: 600, color: C.text, whiteSpace: "nowrap" }}>{cur(it[1])}</div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 16px", background: C.panelHi, fontSize: 12.5, fontWeight: 700 }}>
            <span style={{ color: C.textSub }}>Gross closing costs</span>
            <span style={{ fontFamily: "Fraunces, serif", fontSize: 16, color: C.text }}>{cur(ex.cc.gross)}</span>
          </div>
        </div>

        {/* rebates back */}
        {ex.cc.rebates.length > 0 && (
          <>
            <div style={{ marginTop: 14, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.mint, marginBottom: 8 }}>What comes back — first-time-buyer rebates</div>
            <div style={{ border: "1px solid rgba(84,214,166,.3)", borderRadius: 12, overflow: "hidden" }}>
              {ex.cc.rebates.map((rb, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: i < ex.cc.rebates.length - 1 ? "1px solid rgba(84,214,166,.18)" : "none", background: i % 2 ? "rgba(84,214,166,.06)" : "transparent" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{rb[0]}</div>
                    <div style={{ fontSize: 11, color: C.textFaint }}>{rb[2]}</div>
                  </div>
                  <div style={{ fontFamily: "Fraunces, serif", fontSize: 16, fontWeight: 600, color: C.mint, whiteSpace: "nowrap" }}>− {cur(rb[1])}</div>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 16px", background: "rgba(84,214,166,.12)", fontSize: 12.5, fontWeight: 700 }}>
                <span style={{ color: C.mint }}>Total rebates back</span>
                <span style={{ fontFamily: "Fraunces, serif", fontSize: 16, color: C.mint }}>− {cur(ex.cc.rebateTotal)}</span>
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.canvas, border: "1px solid " + C.line, borderRadius: 12, padding: "14px 18px" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Net closing costs</div>
                <div style={{ fontSize: 11, color: C.textFaint }}>gross {cur(ex.cc.gross)} − rebates {cur(ex.cc.rebateTotal)}</div>
              </div>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: C.amber }}>{cur(ex.cc.net)}</div>
            </div>
          </>
        )}

        {/* educational explainer — most people don't know what these are */}
        <div style={{ marginTop: 16, background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 12, padding: "16px 18px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 10 }}>New here? The rebates, in plain words</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {(market === "CA" ? [
              ["Land transfer tax rebate", "When you buy, the province (and some cities, like Toronto) charge a land transfer tax. First-time buyers get a chunk of it refunded — your lawyer applies it right at closing, so you simply pay less."],
              ["GST/HST new-home rebate", "Buying a newly built home means sales tax is baked into the price. First-time buyers can recover much of it — recent federal rules remove GST for first-time buyers on new builds up to $1.5M, and Ontario refunds part of the provincial HST."],
              ["How to claim", "Tell your real estate lawyer you're a first-time buyer — they file the land transfer rebate automatically. For the GST/HST rebate, the builder often credits it upfront, or you file form GST190 after closing."],
            ] : [
              ["Down-payment assistance", "Most states and many cities run first-time-buyer programs — grants or low-cost loans that cover part of your down payment and closing costs. Eligibility is usually based on income and price limits."],
              ["Mortgage Credit Certificate", "An MCC lets you claim a slice of your annual mortgage interest as a direct federal tax credit, every year you own the home — real money back at tax time."],
              ["How to claim", "Ask your lender or a HUD-approved housing counselor which programs you qualify for. Many must be applied for before closing, so start early."],
            ]).map(([t, d], i) => (
              <div key={i} style={{ display: "flex", gap: 10 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.amber, marginTop: 6, flexShrink: 0 }} />
                <div style={{ fontSize: 12.3, lineHeight: 1.6, color: C.textSub }}><strong style={{ color: C.text }}>{t}.</strong> {d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* total cash to close — the honest pocket equation */}
        <div style={{ marginTop: 16, background: C.canvas, borderRadius: 14, padding: "18px 20px", border: "1px solid " + C.line }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.textFaint, marginBottom: 12 }}>
            Cash on hand required
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <CashChip label="Down payment" value={cur(ex.required)} color={C.flare} />
            <span style={{ fontSize: 20, fontWeight: 700, color: C.textFaint }}>+</span>
            <CashChip label="Closing costs (net)" value={cur(ex.cc.net)} color={C.amber} />
            <span style={{ fontSize: 20, fontWeight: 700, color: C.textFaint }}>=</span>
            <CashChip label="Cash on hand" value={cur(ex.cashToClose)} color={C.mint} big />
          </div>
          <div style={{ marginTop: 14, fontSize: 13, lineHeight: 1.6, color: ex.cashShortfall > 0 ? C.red : C.textSub }}>
            {ex.cashShortfall > 0 ? (
              <>Against your {cur(downCash)} saved, that's a <strong>{cur(ex.cashShortfall)} gap</strong>{ex.cc.rebateTotal > 0 ? " — already counting " + cur(ex.cc.rebateTotal) + " of rebates in your favour" : ""}. Plan for both piles, not just the down payment.</>
            ) : (
              <>Your {cur(downCash)} covers the full cash on hand, closing costs included{ex.cc.rebateTotal > 0 ? " — and " + cur(ex.cc.rebateTotal) + " of rebates is already working for you" : ""}. You're past the finish line.</>
            )}
          </div>
        </div>
      </Card>
      <p style={{ fontSize: 11.5, color: C.textFaint, marginTop: 16, lineHeight: 1.6, maxWidth: 780 }}>
        Estimates only, on 2026 {M.name} guidelines. Closing costs and rebates vary widely by province, state and municipality — land transfer tax and GST/HST rebates especially, and eligibility rules and caps change. Confirm what you qualify for with a licensed broker or real estate lawyer.
      </p>
    </div>
  );
}

/* ============================================================
   SCREEN · RENT vs OWN  (the lifestyle trade-off)
   ============================================================ */
function TradeOff({ M, market, profile, patch }) {
  const cur = fmtCur(market);
  const curS = fmtCurSigned(market);
  // renter life — seeded from the stage-driven income so the numbers fit the person
  const m0 = Math.round(profile.income / 12 * 0.74 / 250) * 250; // monthly take-home
  const [income, setIncome] = useState(m0);
  const [rent, setRent] = useState(Math.max(800, Math.round(m0 * 0.35 / 50) * 50));
  const [essentials, setEssentials] = useState(Math.max(400, Math.round(m0 * 0.22 / 50) * 50));
  const [dining, setDining] = useState(Math.max(150, Math.round(m0 * 0.10 / 25) * 25));
  const [travel, setTravel] = useState(Math.max(100, Math.round(m0 * 0.07 / 25) * 25));
  const [fun, setFun] = useState(Math.max(100, Math.round(m0 * 0.08 / 25) * 25));
  // the home — shared with the rest of the app
  const price = profile.price, setPrice = (v) => patch({ price: v });
  const down = profile.down, setDown = (v) => patch({ down: v });
  const rate = profile.rate, setRate = (v) => patch({ rate: v });
  const [growth, setGrowth] = useState(3);

  const calc = useMemo(() => {
    const renterSpend = rent + essentials + dining + travel + fun;
    const renterSave = income - renterSpend;

    let mortgage = price - down;
    if (M.insKind === "oneTime") {
      const ltv = mortgage / price;
      const pr = cmhcRate(ltv);
      if (pr) mortgage = mortgage * (1 + pr);
    }
    const pi = monthlyPayment(mortgage, rate, 25);
    let pmi = 0;
    if (M.insKind === "annual") {
      const ltv = (price - down) / price;
      pmi = ((price - down) * pmiAnnualRate(ltv)) / 12;
    }
    const tax = (price * 0.009) / 12;
    const ins = (price * 0.004) / 12;
    const maint = (price * 0.01) / 12;
    const ownerHousing = pi + pmi + tax + ins + maint;

    const ownerDiscretionary = essentials + dining + travel + fun;
    const ownerSave = income - ownerHousing - ownerDiscretionary;
    const housingDelta = ownerHousing - rent;

    // 5-year wealth
    const { paid: equityPaydown, firstMonthPrincipal } = principalPaid(mortgage, rate, 25, 60);
    const appreciation = price * (Math.pow(1 + growth / 100, 5) - 1);
    const homeWealth = equityPaydown + appreciation;
    const rentPaid5 = rent * 60;

    return { renterSpend, renterSave, mortgage, pi, pmi, tax, ins, maint, ownerHousing,
      ownerDiscretionary, ownerSave, housingDelta, equityPaydown, firstMonthPrincipal,
      appreciation, homeWealth, rentPaid5 };
  }, [income, rent, essentials, dining, travel, fun, price, down, rate, growth, M]);

  const gap = calc.ownerSave < 0 ? -calc.ownerSave : 0;
  const tHome = useTween(calc.homeWealth);
  const tDelta = useTween(calc.housingDelta);

  // vertical budget column
  const baseH = 300;
  function Column({ title, sub, segs, total }) {
    const ppd = baseH / income;
    return (
      <div style={{ flex: 1, minWidth: 150 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
        <div style={{ fontSize: 11.5, color: C.textSub, marginBottom: 12 }}>{sub}</div>
        <div style={{ display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", border: "1px solid " + C.line }}>
          {segs.map((s, i) => {
            if (s.amt <= 0) return null;
            const h = Math.max(s.amt * ppd, 20);
            const tiny = h < 30; // too short to stack label + value on two lines
            return (
              <div key={i} style={{ height: h, background: s.striped ? "repeating-linear-gradient(45deg," + s.bg + "," + s.bg + " 8px,#7a1a1f 8px,#7a1a1f 16px)" : s.bg, color: s.fg, display: "flex", flexDirection: tiny ? "row" : "column", alignItems: tiny ? "center" : "flex-start", justifyContent: tiny ? "space-between" : "center", padding: tiny ? "0 11px" : "0 11px", gap: tiny ? 8 : 0, fontWeight: 700, lineHeight: 1.2 }}>
                <span style={{ fontSize: tiny ? 10.5 : 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: tiny ? "62%" : "100%" }}>{s.label}</span>
                <span style={{ fontSize: tiny ? 10.5 : 12, fontWeight: 800, whiteSpace: "nowrap" }}>{cur(s.amt)}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 8, textAlign: "center" }}>total {cur(total)}/mo</div>
      </div>
    );
  }

  const renterSegs = [
    { label: "Rent", amt: rent, bg: C.flare, fg: "#fff" },
    { label: "Essentials", amt: essentials, bg: C.panelHi, fg: C.text },
    { label: "Dining out", amt: dining, bg: C.amber, fg: C.canvas },
    { label: "Travel", amt: travel, bg: C.sky, fg: C.canvas },
    { label: "Fun & subs", amt: fun, bg: C.violet, fg: C.canvas },
    { label: "Savings & buffer", amt: Math.max(0, calc.renterSave), bg: C.mint, fg: C.canvas },
  ];
  const ownerSegs = [
    { label: "Home (all-in)", amt: calc.ownerHousing, bg: C.flare, fg: "#fff" },
    { label: "Essentials", amt: essentials, bg: C.panelHi, fg: C.text },
    { label: "Dining out", amt: dining, bg: C.amber, fg: C.canvas },
    { label: "Travel", amt: travel, bg: C.sky, fg: C.canvas },
    { label: "Fun & subs", amt: fun, bg: C.violet, fg: C.canvas },
    calc.ownerSave >= 0
      ? { label: "Savings & buffer", amt: calc.ownerSave, bg: C.mint, fg: C.canvas }
      : { label: "Over budget", amt: gap, bg: C.red, fg: "#fff", striped: true },
  ];

  return (
    <div>
      <SectionTitle kicker="Rent vs. own" title="What owning actually does to your month" lead="Renting feels light. Owning feels heavy. Here's the honest picture — build your renter's life below, drop in a home, and watch what shifts." />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.25fr)", gap: 20 }} className="grid2">
        {/* inputs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card style={{ padding: "22px 22px 8px" }} accentTop={C.violet}>
            <GroupLabel>Your life as a renter</GroupLabel>
            <Slider label="Monthly take-home pay" value={income} min={2500} max={20000} step={250} onChange={setIncome} format={cur} accent={C.mint} hint="After tax — what actually hits your account." />
            <Slider label="Rent" value={rent} min={800} max={6000} step={50} onChange={setRent} format={(v) => cur(v) + "/mo"} accent={C.flare} />
            <Slider label="Everyday essentials" value={essentials} min={400} max={4000} step={50} onChange={setEssentials} format={(v) => cur(v) + "/mo"} hint="Groceries, transport, phone, insurance, utilities." />
            <Slider label="Dining out" value={dining} min={0} max={2000} step={25} onChange={setDining} format={(v) => cur(v) + "/mo"} accent={C.amber} />
            <Slider label="Travel" value={travel} min={0} max={2500} step={25} onChange={setTravel} format={(v) => cur(v) + "/mo"} accent={C.sky} />
            <Slider label="Fun & subscriptions" value={fun} min={0} max={2000} step={25} onChange={setFun} format={(v) => cur(v) + "/mo"} accent={C.violet} hint="Hobbies, streaming, gym, nights out." />
          </Card>
          <Card style={{ padding: "22px 22px 8px" }} accentTop={C.flare}>
            <GroupLabel>The home you're eyeing</GroupLabel>
            <Slider label="Home price" value={price} min={200000} max={1500000} step={10000} onChange={setPrice} format={cur} accent={C.flare} />
            <Slider label="Down payment" value={down} min={0} max={400000} step={5000} onChange={setDown} format={cur} accent={C.mint} />
            <Slider label="Mortgage rate" value={rate} min={2} max={9} step={0.05} onChange={setRate} format={(v) => v.toFixed(2) + "%"} accent={C.sky} />
            <Slider label="Home value growth / yr" value={growth} min={-4} max={7} step={0.5} onChange={setGrowth} format={(v) => v.toFixed(1) + "%"} accent={C.amber} hint="Not a forecast — prices can fall. Try 0% or a negative rate to model a flat or declining market." />
          </Card>
        </div>

        {/* the reveal */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card style={{ padding: "22px 22px 18px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>Your money, two ways</div>
            <div style={{ fontSize: 11.5, color: C.textSub, marginBottom: 16 }}>Same income, same lifestyle spending. Only the housing line changes — and it changes everything below it.</div>
            <div style={{ display: "flex", gap: 16 }}>
              <Column title="Renting today" sub={"Housing: " + cur(rent) + "/mo"} segs={renterSegs} total={income} />
              <Column title="Owning this home" sub={"Housing: " + cur(calc.ownerHousing) + "/mo"} segs={ownerSegs} total={calc.ownerHousing + calc.ownerDiscretionary + Math.max(0, calc.ownerSave)} />
            </div>
          </Card>

          <div style={{ background: C.canvas, borderRadius: 16, padding: "20px 22px", border: "1px solid " + C.line, position: "relative", overflow: "hidden" }}>
            <div className="dotgrid" />
            <div style={{ position: "relative" }}>
              <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: C.flare, fontWeight: 700 }}>The monthly squeeze</div>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 34, fontWeight: 600, color: C.text, margin: "5px 0 4px" }}>
                +{cur(Math.abs(tDelta))}<span style={{ fontSize: 16, color: C.textSub }}>/mo on housing</span>
              </div>
              <div style={{ fontSize: 13, color: C.textSub, lineHeight: 1.6 }}>
                {calc.ownerSave >= 0 ? (
                  <>Owning costs more each month — but you'd still keep <strong style={{ color: C.mint }}>{cur(calc.ownerSave)}/mo</strong> as savings &amp; buffer (vs. {cur(Math.max(0, calc.renterSave))} renting). The lifestyle holds.</>
                ) : (
                  <>This home plus your current lifestyle runs <strong style={{ color: C.red }}>{cur(gap)}/mo over your income</strong>. Something has to give — trim dining, travel or fun, lift income, or choose a lower price.</>
                )}
              </div>
            </div>
          </div>

          {/* equity flip */}
          <Card style={{ padding: "20px 22px" }} accentTop={C.mint}>
            <Tag bg="rgba(84,214,166,.14)" fg={C.mint}>The flip side</Tag>
            <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600, color: C.text, margin: "11px 0 8px" }}>
              Rent vanishes. A mortgage payment partly comes back.
            </h3>
            <p style={{ fontSize: 13, color: C.textSub, lineHeight: 1.62, margin: "0 0 14px" }}>
              Every rent cheque is gone for good — it builds your landlord's wealth. A mortgage payment splits in two:
              interest (the cost of borrowing) and principal — money moving straight into <em>your</em> equity.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
              <Stat label="Builds equity, month one" value={cur(calc.firstMonthPrincipal)} note="Principal portion of your payment" accent={C.mint} />
              <Stat label="Interest, month one" value={cur(calc.pi - calc.firstMonthPrincipal)} note="The cost of the loan" accent={C.amber} />
            </div>
          </Card>

          {/* 5-year scoreboard */}
          <div style={{ background: "linear-gradient(135deg," + C.panel + "," + C.panelHi + ")", borderRadius: 16, padding: "22px 22px", border: "1px solid " + C.line }}>
            <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: C.lime, fontWeight: 700, marginBottom: 12 }}>The 5-year scoreboard</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: C.canvas, borderRadius: 12, padding: "16px", border: "1px solid " + C.line }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.flare, marginBottom: 8 }}>Owning this home</div>
                <DRow k="Equity from paydown" v={cur(calc.equityPaydown)} />
                <DRow k={(calc.appreciation < 0 ? "Value change @ " : "Appreciation @ ") + growth.toFixed(1) + "%"} v={curS(calc.appreciation)} />
                <div style={{ height: 1, background: C.line, margin: "8px 0" }} />
                <DRow k="Wealth you keep" v={curS(calc.homeWealth)} accent={calc.homeWealth < 0 ? C.red : C.mint} />
              </div>
              <div style={{ background: C.canvas, borderRadius: 12, padding: "16px", border: "1px solid " + C.line }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.textSub, marginBottom: 8 }}>Renting 5 more years</div>
                <DRow k="Paid to a landlord" v={cur(calc.rentPaid5)} />
                <DRow k="Property wealth built" v={cur(0)} />
                <div style={{ height: 1, background: C.line, margin: "8px 0" }} />
                <DRow k="Wealth you keep" v={cur(0)} accent={C.red} />
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: C.textSub, lineHeight: 1.6, marginTop: 14 }}>
              {calc.homeWealth >= 0 ? (
                <>After five years, owning has converted <strong style={{ color: C.text }}>{cur(tHome)}</strong> into wealth you keep —
                while the same stretch of renting builds none. That's the trade for the heavier monthly cost.</>
              ) : (
                <>At this growth rate, after five years your home is worth less than you put in — a <strong style={{ color: C.red }}>{curS(calc.homeWealth)}</strong> position
                even after mortgage paydown. Renting builds no equity either, but owning can lose value. This is the real risk the scoreboard exists to show.</>
              )}
            </div>
            {/* appreciation-risk disclaimer */}
            <div style={{ marginTop: 12, background: C.redSoft, border: "1px solid rgba(255,87,101,.3)", borderRadius: 11, padding: "12px 14px", display: "flex", gap: 10 }}>
              <span style={{ color: C.red, fontWeight: 800, fontSize: 14, lineHeight: 1.3 }}>!</span>
              <div style={{ fontSize: 11.5, color: C.textSub, lineHeight: 1.6 }}>
                <strong style={{ color: C.text }}>Appreciation is not guaranteed.</strong> Home prices rise <em>and</em> fall —
                interest rates, the economy, local supply and global events all move them, and many markets are down right now.
                The "{growth.toFixed(1)}%/yr" figure is an assumption you chose, not a forecast. Equity from paying down your
                mortgage is real and predictable; the appreciation portion above could be smaller, zero, or negative. Set the
                growth slider to <strong style={{ color: C.text }}>0%</strong> — or below — to see how the scoreboard looks if prices stall or drop.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 15, padding: "16px 20px" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 6 }}>Keep it honest — owning isn't free money</div>
        <div style={{ fontSize: 12.3, color: C.textSub, lineHeight: 1.6 }}>
          Renting buys flexibility and zero surprise repair bills. Owning adds maintenance, one-off closing costs (2–5% of the price), and ties up cash you can't easily pull back out. Appreciation can stall or fall. The scoreboard shows the upside — your job is to be sure the monthly squeeze is one you can live with for years, not just months.
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SCREEN · SAVINGS PROJECTOR
   ============================================================ */
function SavingsPlanner({ M, market, profile, patch }) {
  const cur = fmtCur(market);
  // goal = down payment + closing costs (the full cash to close)
  const goal = profile.savingsGoal, setGoal = (v) => patch({ savingsGoal: v });
  const haveNow = profile.down, setHaveNow = (v) => patch({ down: v });
  const monthly = profile.monthlySave, setMonthly = (v) => patch({ monthlySave: v });
  const [ret, setRet] = useState(4);

  // suggested goal pulled from the target home: down payment + closing costs
  const suggested = useMemo(() => {
    const reqDown = minDownPayment(profile.price, market);
    const cc = closingCosts(profile.price, market, true, profile.newBuild);
    return { total: Math.round((reqDown + cc.total) / 2500) * 2500, reqDown, cc: cc.total };
  }, [profile.price, market, profile.newBuild]);
  const goalMatchesSuggestion = Math.abs(goal - suggested.total) < 2500;

  const proj = useMemo(() => {
    const rM = ret / 100 / 12;
    const months = [];
    let bal = haveNow, reachedAt = null;
    for (let m = 0; m <= 120; m++) {
      months.push(bal);
      if (reachedAt === null && bal >= goal) reachedAt = m;
      bal = bal * (1 + rM) + monthly;
    }
    const contribOnly = haveNow + monthly * (reachedAt || 120);
    const growthShare = reachedAt ? Math.max(0, goal - contribOnly) : 0;
    return { months, reachedAt, contribOnly, growthShare };
  }, [goal, haveNow, monthly, ret]);

  const yrs = proj.reachedAt != null ? Math.floor(proj.reachedAt / 12) : null;
  const mos = proj.reachedAt != null ? proj.reachedAt % 12 : null;
  const W = 560, H = 170, pad = 8;
  const cap = Math.max(goal * 1.15, proj.months[Math.min(119, proj.months.length - 1)]);
  const pts = proj.months.slice(0, Math.min(proj.reachedAt != null ? proj.reachedAt + 6 : 120, 121));
  const path = pts.map((v, i) => {
    const x = pad + (i / (pts.length - 1)) * (W - pad * 2);
    const y = H - pad - (v / cap) * (H - pad * 2);
    return (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  const goalY = H - pad - (goal / cap) * (H - pad * 2);
  const area = path + " L" + (W - pad) + "," + (H - pad) + " L" + pad + "," + (H - pad) + " Z";

  return (
    <div>
      <SectionTitle kicker="Cash to close" title="Build the cash, month by month" lead={"Down payment plus closing costs — the lender covers none of it. See how fast the gap closes, and where to keep the money in " + M.name + "."} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr)", gap: 20 }} className="grid2">
        <Card style={{ padding: "22px 22px 8px" }} accentTop={C.flare}>
          <GroupLabel>Your savings plan</GroupLabel>
          <Slider label="Savings goal — your full cash to close" value={goal} min={15000} max={400000} step={2500} onChange={setGoal} format={cur} accent={C.flare} hint="This should cover both piles: the down payment and your closing costs." />
          {!goalMatchesSuggestion && (
            <button onClick={() => setGoal(suggested.total)} style={{ width: "100%", marginTop: -8, marginBottom: 18, background: C.flareSoft, border: "1px dashed " + C.flare, borderRadius: 10, padding: "10px 13px", cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: C.text }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.flare }}>↻ Use {cur(suggested.total)} for your target home</span>
              <span style={{ display: "block", fontSize: 11, color: C.textSub, marginTop: 2 }}>{cur(suggested.reqDown)} down payment + {cur(suggested.cc)} closing costs</span>
            </button>
          )}
          <Slider label="Saved so far" value={haveNow} min={0} max={200000} step={1000} onChange={setHaveNow} format={cur} accent={C.mint} />
          <Slider label="You can set aside each month" value={monthly} min={100} max={4000} step={50} onChange={setMonthly} format={(v) => cur(v) + "/mo"} accent={C.sky} />
          <Slider label="Expected annual return" value={ret} min={0} max={9} step={0.5} onChange={setRet} format={(v) => v.toFixed(1) + "%"} accent={C.amber} hint="A savings account sits low; invested money higher, with more ups and downs." />
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
          <div style={{ background: C.canvas, borderRadius: 18, padding: "24px 26px", border: "1px solid " + C.line, position: "relative", overflow: "hidden" }}>
            <div className="dotgrid" />
            <div style={{ position: "relative" }}>
              <div style={{ fontSize: 11.5, letterSpacing: ".08em", textTransform: "uppercase", color: C.lime, fontWeight: 700 }}>{proj.reachedAt != null ? "You hit your goal in" : "In 10 years you'd reach"}</div>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 42, fontWeight: 600, color: C.text, margin: "6px 0 4px" }}>
                {proj.reachedAt != null ? (yrs > 0 ? yrs + (yrs === 1 ? " yr " : " yrs ") : "") + mos + (mos === 1 ? " mo" : " mos") : cur(proj.months[120])}
              </div>
              <div style={{ fontSize: 13.5, color: C.textSub, lineHeight: 1.55 }}>
                {proj.reachedAt != null ? "Hold " + cur(monthly) + "/mo and the down payment is fully funded." : "At this pace the " + cur(goal) + " goal takes over 10 years — try saving more each month."}
              </div>
              <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", height: 150, marginTop: 16, display: "block" }}>
                <defs>
                  <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.lime} stopOpacity="0.5" />
                    <stop offset="100%" stopColor={C.lime} stopOpacity="0.03" />
                  </linearGradient>
                </defs>
                <line x1={pad} y1={goalY} x2={W - pad} y2={goalY} stroke={C.flare} strokeWidth="1.5" strokeDasharray="5 4" />
                <text x={W - pad} y={goalY - 6} fill={C.flare} fontSize="10" fontWeight="700" textAnchor="end">goal {cur(goal)}</text>
                <path d={area} fill="url(#gA)" />
                <path d={path} fill="none" stroke={C.lime} strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
          </div>
          {proj.reachedAt != null && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
              <Stat label="You contribute" value={cur(proj.contribOnly)} note="Your own money set aside" accent={C.flare} />
              <Stat label="Growth adds" value={cur(proj.growthShare)} note={ret.toFixed(1) + "% compounding"} accent={C.mint} />
            </div>
          )}
          <Card style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>Where buyers in {M.name} keep it</div>
            <div style={{ fontSize: 12, color: C.textSub, marginBottom: 12, lineHeight: 1.55 }}>Tax-smart accounts grow the down payment faster than a plain savings account.</div>
            {M.accounts.map(([t, d]) => (
              <div key={t} style={{ display: "flex", gap: 10, marginBottom: 9 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.flare, marginTop: 6, flexShrink: 0 }} />
                <div style={{ fontSize: 12.5, lineHeight: 1.55, color: C.textSub }}><strong style={{ color: C.text }}>{t}.</strong> {d}</div>
              </div>
            ))}
            <div style={{ marginTop: 10, fontSize: 12, color: C.mint, background: "rgba(84,214,166,.1)", borderRadius: 10, padding: "10px 13px", lineHeight: 1.55 }}>{M.rebate}</div>
            {M.code === "CA" && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: C.mint, textTransform: "uppercase", marginBottom: 8 }}>Start with the FHSA — it's the best one</div>
                <PartnerLink
                  name="Wealthsimple — open an FHSA"
                  blurb="The only account that's tax-deductible going in AND tax-free coming out. $8K/yr toward your first home. Open one in minutes."
                  cta="Open FHSA"
                  href="https://www.wealthsimple.com/invest/fhsa?ref=MRQONW"
                  accent={C.mint}
                />
              </div>
            )}
          </Card>
        </div>
      </div>
      <div style={{ marginTop: 18, background: C.flareSoft, border: "1px solid rgba(255,90,36,.3)", borderRadius: 15, padding: "16px 20px", fontSize: 13, color: C.text, lineHeight: 1.6 }}>
        <strong>The pocket rule again:</strong> a bigger down payment shrinks the mortgage, lowers the monthly payment, and — past 20% — kills mortgage insurance entirely. Every dollar saved here is a dollar you never borrow.
      </div>
    </div>
  );
}

/* ============================================================
   SCREEN · CREDIT
   ============================================================ */
function Credit({ M }) {
  const bands = [["Poor", "300–559", C.red, 29], ["Fair", "560–659", "#D08A33", 16.5], ["Good", "660–724", C.amber, 10.8], ["Very good", "725–759", "#7FB04E", 5.8], ["Excellent", "760–900", C.mint, 23.3]];
  const factors = [
    ["Payment history", 35, "Do you pay on time, every time? The single biggest lever."],
    ["Amounts owed (utilization)", 30, "Balances vs. your limits. Cards under ~30% used really helps."],
    ["Length of credit history", 15, "Older accounts show a longer track record. Keep your oldest card."],
    ["Credit mix", 10, "A healthy blend — a card, maybe a loan — managed well."],
    ["New credit & inquiries", 10, "Many applications in a short window looks risky."],
  ];
  const risks = [
    ["Late or missed payments", "Even one 30-day-late mark dents a score and lingers for years."],
    ["Maxed-out cards", "High utilization signals stress, even if you never miss a payment."],
    ["Applying for lots of credit at once", "Each hard inquiry nicks the score; many at once amplifies it."],
    ["Collections or bankruptcy", "Serious flags that lenders weigh heavily."],
    ["A 'thin file'", "Too little history means the lender can't read you — common for newcomers."],
  ];
  return (
    <div>
      <SectionTitle kicker="Credit" title="Your score, demystified" lead="It's a snapshot of how you've handled borrowed money. Here's what it means, how to see yours free, and how to nudge it up." />
      <Card style={{ padding: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>The scale runs 300 to 900</div>
        <div style={{ fontSize: 12.5, color: C.textSub, marginBottom: 16, lineHeight: 1.55 }}>Most lenders want roughly <strong style={{ color: C.text }}>680+</strong> for the best rates. 600–680 can often still qualify; below ~600 usually means alternative lenders and higher rates.</div>
        <div style={{ display: "flex", height: 40, borderRadius: 10, overflow: "hidden" }}>
          {bands.map((b) => <div key={b[0]} style={{ width: b[3] + "%", background: b[2], color: C.canvas, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 800 }}>{b[0]}</div>)}
        </div>
        <div style={{ display: "flex", marginTop: 6 }}>
          {bands.map((b) => <div key={b[0]} style={{ width: b[3] + "%", fontSize: 10, color: C.textFaint, textAlign: "center" }}>{b[1]}</div>)}
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16, marginTop: 16 }} className="grid2">
        <Card style={{ padding: "20px 22px" }}>
          <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600, color: C.text, margin: "0 0 4px" }}>What shapes the score</h3>
          <p style={{ fontSize: 12.5, color: C.textSub, margin: "0 0 16px" }}>Roughly how the pieces are weighted. Spend your energy on the big two.</p>
          {factors.map(([name, w, note]) => (
            <div key={name} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 12.8, fontWeight: 600, color: C.text }}>{name}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.flare }}>{w}%</span>
              </div>
              <div style={{ height: 9, background: C.panelSoft, borderRadius: 999, overflow: "hidden", border: "1px solid " + C.line }}>
                <div style={{ width: w / 0.35 + "%", height: "100%", background: C.flare, borderRadius: 999 }} />
              </div>
              <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 4, lineHeight: 1.45 }}>{note}</div>
            </div>
          ))}
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "rgba(84,214,166,.08)", border: "1px solid rgba(84,214,166,.25)", borderRadius: 16, padding: "20px 22px" }}>
            <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600, color: C.mint, margin: "0 0 10px" }}>How to check yours — free</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.8, lineHeight: 1.7, color: C.textSub }}>
              <li>Request your report from <strong style={{ color: C.text }}>Equifax and TransUnion</strong>, Canada's two credit bureaus.</li>
              <li>Many banks and free apps show your score on a dashboard.</li>
              <li>Checking <em>your own</em> score is a "soft pull" — it <strong style={{ color: C.text }}>never</strong> hurts it. Only a lender's "hard pull" does.</li>
              <li>Scan both bureaus for errors and dispute anything wrong.</li>
            </ul>
            <div style={{ marginTop: 14 }}>
              <PartnerLink
                name="Borrowell"
                blurb="Check your credit score free — a soft pull that never affects it."
                cta="Check free"
                href="https://borrowell.com/refer-a-friend/free-credit-score?utm_campaign=Refer5&utm_medium=web&utm_source=refer2022-241337"
                accent={C.mint}
              />
            </div>
          </div>
          <Card style={{ padding: "20px 22px" }}>
            <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600, color: C.text, margin: "0 0 10px" }}>Risk factors that hold buyers back</h3>
            {risks.map(([t, d]) => (
              <div key={t} style={{ display: "flex", gap: 9, marginBottom: 9 }}>
                <span style={{ color: C.red, fontWeight: 800, fontSize: 14 }}>!</span>
                <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.textSub }}><strong style={{ color: C.text }}>{t}.</strong> {d}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
      <Card style={{ marginTop: 16, padding: "22px 24px" }}>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600, color: C.text, margin: "0 0 14px" }}>Sharpen it before you apply</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          {[
            ["Pay every bill on time", "Automate minimums so a busy month never costs you. Consistency is everything."],
            ["Bring balances down", "Use under 30% of each card's limit before a lender pulls your file."],
            ["Pause new applications", "No new cards, car loans or credit checks in the months before applying."],
            ["Keep old accounts open", "Length of history helps — don't close your oldest card."],
            ["Check for errors early", "Start 3–6 months out so corrections have time to post."],
          ].map(([t, d]) => (
            <div key={t} style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 12, padding: "14px 15px" }}>
              <div style={{ fontSize: 13.2, fontWeight: 700, color: C.flare, marginBottom: 5 }}>{t}</div>
              <div style={{ fontSize: 12.3, lineHeight: 1.55, color: C.textSub }}>{d}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   SCREEN · MORTGAGE 101
   ============================================================ */
function Types({ M, market }) {
  const cur = fmtCur(market);
  return (
    <div>
      <SectionTitle kicker="Mortgage 101" title="The kinds of mortgages, in plain words" lead="Same goal — borrow to buy. But structure changes your costs, your flexibility, and how easily you can switch lenders later." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="grid2">
        <TypeCard tag="Under 20% down" tagBg={C.flareSoft} tagFg={C.flare} title="Insured (high-ratio) mortgage" body="With 5%–19.99% down, the loan must carry mortgage default insurance from CMHC, Sagen or Canada Guaranty." points={["Protects the lender, not you, if you can't pay.", "A one-time premium (~2.8%–4.0% of the loan) folds into your balance.", "Lender risk is covered, so rates are often slightly lower.", "Only on homes under $1.5M."]} />
        <TypeCard tag="20%+ down" tagBg="rgba(84,214,166,.14)" tagFg={C.mint} title="Conventional (uninsured) mortgage" body="With 20%+ down, no mortgage insurance. Also the only option for homes at $1.5M+." points={["No insurance cost — you save thousands.", "Smaller loan vs. the home's value, so lower payments.", "Still must pass the stress test and meet GDS/TDS.", "Takes longer to save for — a real trade-off against buying sooner."]} />
      </div>
      <Card style={{ marginTop: 16, padding: "22px 24px" }}>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 21, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>How the loan is registered: standard vs. collateral charge</h3>
        <p style={{ fontSize: 13, color: C.textSub, margin: "0 0 16px", lineHeight: 1.6 }}>A behind-the-scenes detail most buyers never hear — but it shapes how flexibly you can borrow and how easily you can leave at renewal.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="grid2">
          <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 13, padding: "16px 18px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: C.mint, marginBottom: 8 }}>Standard-charge mortgage</div>
            <p style={{ fontSize: 12.7, lineHeight: 1.6, color: C.textSub, margin: 0 }}>Registered for the <strong style={{ color: C.text }}>exact amount</strong> borrowed. At term-end you can usually <strong style={{ color: C.text }}>switch lenders cheaply</strong>, keeping lenders competing for you. To borrow more, you refinance.</p>
          </div>
          <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 13, padding: "16px 18px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: C.flare, marginBottom: 8 }}>Collateral-charge mortgage</div>
            <p style={{ fontSize: 12.7, lineHeight: 1.6, color: C.textSub, margin: 0 }}>Registered for <strong style={{ color: C.text }}>more than you borrow</strong> (often 100–125% of value). Lets you <strong style={{ color: C.text }}>re-borrow or add a credit line later without new legal fees</strong> — but switching lenders at renewal means discharging and re-registering.</p>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 12.3, color: C.text, background: C.flareSoft, borderRadius: 10, padding: "10px 14px", lineHeight: 1.55 }}>
          <strong>Ask outright:</strong> "Standard or collateral charge?" Neither is bad — collateral is flexible if you'll tap equity; standard is easier to shop at renewal.
        </div>
      </Card>
      <div style={{ marginTop: 16, background: C.canvas, borderRadius: 18, padding: "26px 28px", border: "1px solid " + C.line, position: "relative", overflow: "hidden" }}>
        <div className="dotgrid" />
        <div style={{ position: "relative" }}>
          <Tag bg={C.flareSoft} fg={C.flare}>For later — once you own</Tag>
          <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 600, margin: "13px 0 8px", color: C.text }}>What is a HELOC, and how does it work?</h3>
          <p style={{ fontSize: 13.8, lineHeight: 1.66, color: C.textSub, maxWidth: 730, margin: "0 0 18px" }}>
            A <strong style={{ color: C.text }}>Home Equity Line of Credit</strong> is a revolving loan secured against your home equity — the part you actually own. A credit card backed by your house: borrow, repay, borrow again up to a limit, paying interest only on what you've drawn.
          </p>
          <div style={{ background: C.panelSoft, borderRadius: 14, padding: 18, marginBottom: 16, border: "1px solid " + C.line }}>
            <div style={{ fontSize: 10.5, color: C.lime, marginBottom: 9, fontWeight: 700, letterSpacing: ".06em" }}>ACCESS ON A {M.symbol}500,000 HOME</div>
            <div style={{ display: "flex", height: 40, borderRadius: 9, overflow: "hidden" }}>
              <div style={{ width: "55%", background: C.mint, color: C.canvas, fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", paddingLeft: 10 }}>Mortgage owing 55%</div>
              <div style={{ width: "25%", background: C.lime, color: C.canvas, fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", paddingLeft: 10 }}>HELOC room 25%</div>
              <div style={{ width: "20%", background: C.panelHi, color: C.textSub, fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", paddingLeft: 10 }}>Locked 20%</div>
            </div>
            <p style={{ fontSize: 12, color: C.textSub, margin: "10px 0 0", lineHeight: 1.55 }}>A HELOC alone reaches about <strong style={{ color: C.text }}>65%</strong> of value. With your mortgage, total borrowing is capped near <strong style={{ color: C.text }}>80%</strong> — the last 20% stays a cushion lenders won't touch.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="grid2">
            <div style={{ background: C.panelSoft, borderRadius: 12, padding: "14px 16px", border: "1px solid " + C.line }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.lime, marginBottom: 6 }}>Why people use one</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.3, lineHeight: 1.65, color: C.textSub }}>
                <li>Renovations, or a down payment on a second property</li>
                <li>An emergency buffer cheaper than credit cards</li>
                <li>Flexible repayment — interest-only minimums are common</li>
              </ul>
            </div>
            <div style={{ background: C.redSoft, borderRadius: 12, padding: "14px 16px", border: "1px solid rgba(255,87,101,.3)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 6 }}>Treat it with care</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.3, lineHeight: 1.65, color: C.textSub }}>
                <li>Secured by your home — miss payments and the home is at risk</li>
                <li>Rates are usually variable, so payments rise when rates do</li>
                <li>Easy access can quietly become long-term debt</li>
              </ul>
            </div>
          </div>
          <p style={{ fontSize: 12.3, color: C.textFaint, margin: "16px 0 0", lineHeight: 1.55 }}>Often bundled with a collateral-charge mortgage as a "readvanceable" package — as you pay down the mortgage, the credit line grows. Useful, but it rewards discipline.</p>
        </div>
      </div>
      {/* AMORTIZATION — how the length changes interest and the P&I split */}
      <AmortLab cur={cur} />

      {/* FIXED vs VARIABLE — including the penalty to break a mortgage */}
      <div style={{ marginTop: 16 }}>
        <Card style={{ padding: "22px 24px" }} accentTop={C.sky}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".14em", color: C.sky, textTransform: "uppercase", marginBottom: 7 }}>Fixed vs. variable</div>
          <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>The choice isn't just about the rate</h3>
          <p style={{ fontSize: 13, color: C.textSub, margin: "0 0 16px", lineHeight: 1.6 }}>
            Most people compare fixed and variable on monthly cost alone. The bigger surprise is what happens if you
            need to <strong style={{ color: C.text }}>break the mortgage early</strong> — to sell, refinance, or move.
            The penalty can differ by thousands.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="grid2">
            <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 13, padding: "16px 18px" }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: C.sky, marginBottom: 8 }}>Fixed rate</div>
              <p style={{ fontSize: 12.6, lineHeight: 1.6, color: C.textSub, margin: "0 0 10px" }}>
                Your rate is locked for the whole term — predictable payments, no surprises if rates climb.
              </p>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text, marginBottom: 4 }}>Penalty to break it</div>
              <p style={{ fontSize: 12.3, lineHeight: 1.6, color: C.textSub, margin: 0 }}>
                The <strong style={{ color: C.text }}>greater of</strong> 3 months' interest <em>or</em> the
                <strong style={{ color: C.text }}> Interest Rate Differential (IRD)</strong>. The IRD can be large —
                often <strong style={{ color: C.text }}>thousands</strong> — especially if rates have fallen since you signed.
              </p>
            </div>
            <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 13, padding: "16px 18px" }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: C.amber, marginBottom: 8 }}>Variable rate</div>
              <p style={{ fontSize: 12.6, lineHeight: 1.6, color: C.textSub, margin: "0 0 10px" }}>
                Your rate moves with the lender's prime — cheaper when rates fall, costlier when they rise.
              </p>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text, marginBottom: 4 }}>Penalty to break it</div>
              <p style={{ fontSize: 12.3, lineHeight: 1.6, color: C.textSub, margin: 0 }}>
                Almost always just <strong style={{ color: C.text }}>3 months' interest</strong> — simple to estimate,
                and usually far cheaper than a fixed-rate IRD penalty.
              </p>
            </div>
          </div>

          {/* IRD explainer */}
          <div style={{ marginTop: 14, background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 8 }}>What's the IRD — and why it matters if you might sell</div>
            <div style={{ fontSize: 12.3, lineHeight: 1.62, color: C.textSub }}>
              The <strong style={{ color: C.text }}>Interest Rate Differential</strong> is a fixed-mortgage penalty that
              roughly equals the interest the lender "loses" by you leaving early — based on the gap between your rate and
              today's rate, over your remaining term. Plans change: a job, a growing family, a move. If there's any chance
              you'll <strong style={{ color: C.text }}>sell or refinance before your term ends</strong>, the penalty is a
              real cost to weigh — a variable rate, or a shorter term, keeps that exit cheap. Some lenders also offer
              <strong style={{ color: C.text }}> "portable"</strong> mortgages you can carry to a new home, sidestepping the
              penalty entirely. Always ask a lender how <em>their</em> penalty is calculated before you sign — the formulas vary.
            </div>
          </div>
        </Card>
      </div>

      {/* PREPAYMENT PRIVILEGES */}
      <Card style={{ marginTop: 16, padding: "22px 24px" }} accentTop={C.mint}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".14em", color: C.mint, textTransform: "uppercase", marginBottom: 7 }}>Prepayment privileges</div>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>The right to pay your mortgage down faster</h3>
        <p style={{ fontSize: 13, color: C.textSub, margin: "0 0 16px", lineHeight: 1.6 }}>
          Most mortgages let you pay <em>extra</em> — beyond your regular payment — without any penalty, up to a yearly
          limit. Every extra dollar goes straight to principal, so it cuts both your balance <em>and</em> the interest
          you'd have paid on it for years. It's one of the most powerful tools a borrower has, and most never use it.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="grid2">
          <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 13, padding: "16px 18px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 }}>The two common forms</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.6, lineHeight: 1.7, color: C.textSub }}>
              <li><strong style={{ color: C.text }}>Lump-sum payment</strong> — pay a one-time amount against principal each year, often up to 10–20% of the original balance (a tax refund, bonus, or gift is a common source).</li>
              <li><strong style={{ color: C.text }}>Payment increase</strong> — raise your regular payment, often by up to 10–20%, any time. Even a small bump compounds.</li>
            </ul>
          </div>
          <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 13, padding: "16px 18px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 }}>Why it matters to you</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.6, lineHeight: 1.7, color: C.textSub }}>
              <li>Extra payments are <strong style={{ color: C.text }}>100% principal</strong> — no interest skimmed off the top.</li>
              <li>Paying down faster can shave <strong style={{ color: C.text }}>years</strong> off the amortization.</li>
              <li>It also shrinks any future penalty — a smaller balance means a smaller IRD if you ever break the mortgage.</li>
              <li>Privileges differ by lender: a "20/20" mortgage is more generous than a "10/10". Compare them, not just the rate.</li>
            </ul>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: C.textFaint, lineHeight: 1.55 }}>
          Note the limits — exceed your annual privilege and the extra amount can trigger a prepayment charge. Ask your lender for the exact percentages and rules before you sign.
        </div>
      </Card>

      {/* RISK FACTORS — location & job codes */}
      <Card style={{ marginTop: 16, padding: "22px 24px" }} accentTop={C.violet}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".14em", color: C.violet, textTransform: "uppercase", marginBottom: 7 }}>Behind the decision</div>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>What else a lender weighs — beyond your number</h3>
        <p style={{ fontSize: 13, color: C.textSub, margin: "0 0 16px", lineHeight: 1.6 }}>
          Two applicants with identical income and credit can still get different answers. Lenders price <em>risk</em>,
          and risk includes things you might not expect — where the home is, and what kind of work you do.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 13, padding: "16px 18px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.violet, marginBottom: 6 }}>Location of the property</div>
            <p style={{ fontSize: 12.6, lineHeight: 1.62, color: C.textSub, margin: 0 }}>
              The lender (and the insurer) look at how easily the home could be re-sold if things went wrong. A condo in a
              major city is "liquid"; a rural acreage, a tiny town with one employer, a former grow-op, or an unusual
              property can mean a <strong style={{ color: C.text }}>larger down payment, a higher rate, or a decline</strong>.
              The same buyer can be approved for one address and refused for another.
            </p>
          </div>
          <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 13, padding: "16px 18px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.violet, marginBottom: 6 }}>Your occupation &amp; industry codes</div>
            <p style={{ fontSize: 12.6, lineHeight: 1.62, color: C.textSub, margin: "0 0 8px" }}>
              Applications record what you do using standardized codes — the <strong style={{ color: C.text }}>NOC</strong>
              {" "}(National Occupational Classification) describes your <em>occupation</em>, and <strong style={{ color: C.text }}>NAICS</strong>
              {" "}(North American Industry Classification System) describes your employer's <em>industry</em>. Lenders use
              both to gauge how stable and predictable your income is.
            </p>
            <p style={{ fontSize: 12.6, lineHeight: 1.62, color: C.textSub, margin: 0 }}>
              Steady, salaried roles read as low-risk. Commission-only, gig, seasonal, or contract work — or a job in a
              volatile industry — can mean the lender asks for more history, averages your income conservatively, or
              wants a bigger down payment. It's not personal; it's the code doing its job. Knowing this lets you prepare
              the right proof up front.
            </p>
          </div>
        </div>
      </Card>

      {/* SELF-EMPLOYED */}
      <Card style={{ marginTop: 16, padding: "22px 24px" }} accentTop={C.amber}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".14em", color: C.amber, textTransform: "uppercase", marginBottom: 7 }}>Business-for-self</div>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>Self-employed? The mortgage is harder — but doable</h3>
        <p style={{ fontSize: 13, color: C.textSub, margin: "0 0 16px", lineHeight: 1.6 }}>
          If you run your own business, the challenge isn't earning enough — it's <em>proving</em> it. The same tax
          planning that lowers your taxable income also lowers the income a lender will count. Going in prepared makes
          all the difference.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="grid2">
          <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 13, padding: "16px 18px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 }}>How to qualify with an A-lender</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.6, lineHeight: 1.7, color: C.textSub }}>
              <li><strong style={{ color: C.text }}>Two years of income history</strong> — tax returns and assessments, so the lender can average a stable figure.</li>
              <li>Business financial statements, plus proof the business is registered and active.</li>
              <li><strong style={{ color: C.text }}>Proof of assets held in the corporation</strong> — retained earnings and corporate accounts can strengthen a thin personal income.</li>
              <li>Clean personal credit and a clear paper trail for your down payment.</li>
            </ul>
          </div>
          <div style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 13, padding: "16px 18px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 }}>If the A-lender says no — B-lenders</div>
            <p style={{ fontSize: 12.4, lineHeight: 1.62, color: C.textSub, margin: "0 0 8px" }}>
              When traditional banks can't make the income work, <strong style={{ color: C.text }}>B-lenders</strong>
              {" "}(alternative lenders) offer more flexibility — typically accepting bank-statement income or shorter
              employment history. Typical trade-offs: rates roughly <strong style={{ color: C.text }}>1–3% higher</strong>,
              one-off lender fees of <strong style={{ color: C.text }}>1–2% of the mortgage</strong>, and
              <strong style={{ color: C.text }}> down payments of 20% or more</strong>.
            </p>
            <p style={{ fontSize: 12.4, lineHeight: 1.62, color: C.textSub, margin: 0 }}>
              Some borrowers use a B-lender as a first step and refinance to an A-lender once they have provable
              history; others stay with a B-lender long-term. The right answer depends on your situation — a
              licensed broker can compare both paths.
            </p>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: C.textFaint, lineHeight: 1.55 }}>
          A mortgage broker is especially valuable here — they know which lenders treat self-employed income favourably, and can structure the application to present your full earning picture.
        </div>
      </Card>

      <div style={{ marginTop: 22 }}>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600, color: C.text, margin: "0 0 12px" }}>A few more questions buyers always ask</h3>
        <Accordion items={[
          { q: "Fixed or variable rate — what's the difference?", a: "A fixed rate holds for the term, so payments are predictable. A variable rate moves with the lender's prime rate — it can save money when rates fall but costs more when they rise. Fixed buys peace of mind; variable trades certainty for potential savings. One often-missed difference: breaking a fixed mortgage early can trigger a large IRD penalty, while a variable mortgage usually costs only 3 months' interest." },
          { q: "What's a 'term' vs. 'amortization'?", a: "Amortization is the total time to fully pay off the mortgage — commonly 25–30 years. The term is the shorter contract you sign within that, often 3–5 years. At the end of each term you renew at then-current rates, until the mortgage is fully paid off." },
          { q: "What happens if I break my mortgage to sell?", a: "Ending a mortgage before its term is up triggers a prepayment penalty. For a variable rate that's usually 3 months' interest. For a fixed rate it's the greater of 3 months' interest or the Interest Rate Differential (IRD) — which can run into the thousands. If you expect to move, ask about a portable mortgage or a shorter term." },
          { q: "Can I pay my mortgage off faster?", a: "Usually yes — most mortgages include prepayment privileges that let you make lump-sum payments and increase your regular payment each year, penalty-free, up to a set limit. Every extra dollar goes straight to principal, cutting both your balance and future interest. Privileges vary by lender, so compare them alongside the rate." },
          { q: "I'm self-employed — can I still get a mortgage?", a: "Yes, but expect more paperwork. Traditional lenders typically want two years of tax returns and financial statements to average your income, and corporate assets can help. If the income is hard to prove, B-lenders offer more flexibility — at higher rates and fees, and usually a 20%+ down payment. A licensed broker can compare both paths for your situation." },
          { q: "What is mortgage insurance actually for?", a: "It protects the lender — not you — if a borrower with under 20% down can't repay. Because that risk is covered, lenders can offer small-down-payment mortgages. The premium is always paid by the borrower." },
          { q: "Should I get pre-approved before house hunting?", a: "Yes. A pre-approval confirms how much a lender will likely lend, often holds a rate, and shows sellers you're serious. It's the difference between a real budget and a guess." },
        ]} />
      </div>
    </div>
  );
}

/* ---------- amortization lab — 25 vs 30 yr, interest + P&I split ---------- */
function AmortLab({ cur }) {
  const [loan, setLoan] = useState(480000);
  const [rate, setRate] = useState(4.5);

  const calc = (years) => {
    const pay = monthlyPayment(loan, rate, years);
    const totalPaid = pay * years * 12;
    const totalInterest = totalPaid - loan;
    const firstInterest = loan * (rate / 100 / 12);
    const firstPrincipal = pay - firstInterest;
    return { years, pay, totalPaid, totalInterest, firstInterest, firstPrincipal,
      principalShare: firstPrincipal / pay };
  };
  const a25 = calc(25), a30 = calc(30);
  const extraInterest = a30.totalInterest - a25.totalInterest;
  const monthlySaving = a25.pay - a30.pay;

  return (
    <Card style={{ marginTop: 16, padding: "22px 24px" }} accentTop={C.flare}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".14em", color: C.flare, textTransform: "uppercase", marginBottom: 7 }}>Amortization</div>
      <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>25 vs. 30 years — what the longer payoff really costs</h3>
      <p style={{ fontSize: 13, color: C.textSub, margin: "0 0 16px", lineHeight: 1.6 }}>
        A longer amortization shrinks the monthly payment — that's the appeal. But you borrow the same money for longer,
        so you pay <strong style={{ color: C.text }}>far more interest overall</strong>. Drag the inputs to see the trade.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 8 }} className="grid2">
        <Slider label="Mortgage amount" value={loan} min={150000} max={1200000} step={10000} onChange={setLoan} format={cur} accent={C.flare} />
        <Slider label="Interest rate" value={rate} min={2} max={9} step={0.05} onChange={setRate} format={(v) => v.toFixed(2) + "%"} accent={C.sky} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="grid2">
        {[a25, a30].map((a) => (
          <div key={a.years} style={{ background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 13, padding: "16px 18px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: a.years === 25 ? C.mint : C.amber, marginBottom: 10 }}>{a.years}-year amortization</div>
            <DRow k="Monthly payment" v={cur(a.pay)} accent={C.text} />
            <DRow k="Total interest paid" v={cur(a.totalInterest)} accent={a.years === 25 ? C.mint : C.amber} />
            <DRow k="Total of all payments" v={cur(a.totalPaid)} />
            <div style={{ height: 1, background: C.line, margin: "10px 0" }} />
            {/* first-payment P&I split */}
            <div style={{ fontSize: 11, color: C.textFaint, fontWeight: 700, marginBottom: 6, letterSpacing: ".04em" }}>YOUR FIRST PAYMENT GOES TO</div>
            <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden", border: "1px solid " + C.line }}>
              <div style={{ width: a.principalShare * 100 + "%", background: C.mint, color: C.canvas, fontSize: 9.5, fontWeight: 800, display: "flex", alignItems: "center", paddingLeft: 6, minWidth: 30 }}>Principal</div>
              <div style={{ flex: 1, background: C.flare, color: "#fff", fontSize: 9.5, fontWeight: 800, display: "flex", alignItems: "center", paddingLeft: 6, minWidth: 30 }}>Interest</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 11, color: C.textSub }}>
              <span>{cur(a.firstPrincipal)} principal</span>
              <span>{cur(a.firstInterest)} interest</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, background: "rgba(255,180,74,.1)", border: "1px solid rgba(255,180,74,.28)", borderRadius: 12, padding: "13px 16px", fontSize: 13, lineHeight: 1.62, color: C.text }}>
        Choosing 30 years over 25 lowers the payment by <strong>{cur(monthlySaving)}/mo</strong> — but adds
        <strong style={{ color: C.amber }}> {cur(extraInterest)}</strong> in total interest over the life of the loan.
        And notice the split: early on, <strong>most of every payment is interest</strong> — a longer amortization
        pays principal down even more slowly, so equity builds at a crawl in the early years.
      </div>
      <p style={{ fontSize: 11, color: C.textFaint, marginTop: 10, lineHeight: 1.55 }}>
        Assumes the rate holds for the full amortization; in reality you renew each term at then-current rates. Making
        extra or lump-sum payments shortens the payoff and cuts total interest.
      </p>
    </Card>
  );
}
function TypeCard({ tag, tagBg, tagFg, title, body, points }) {
  return (
    <Card style={{ padding: 22 }}>
      <Tag bg={tagBg} fg={tagFg}>{tag}</Tag>
      <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 21, fontWeight: 600, color: C.text, margin: "12px 0 8px" }}>{title}</h3>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: C.textSub, margin: "0 0 12px" }}>{body}</p>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.7, lineHeight: 1.65, color: C.textSub }}>
        {points.map((p, i) => <li key={i} style={{ marginBottom: 4 }}>{p}</li>)}
      </ul>
    </Card>
  );
}

/* ============================================================
   SCREEN · PRE-APPROVAL
   ============================================================ */
function PreApproval({ M, market, profile }) {
  const cur = fmtCur(market);
  const [f, setF] = useState({ name: "", email: "", phone: "", city: "", income: profile.income, price: profile.price, down: profile.down, timeline: "3–6 months", notes: "" });
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email);
  const ready = f.name.trim().length > 1 && emailOk;
  const set = (k) => (e) => setF({ ...f, [k]: e && e.target ? e.target.value : e });

  async function submit() {
    setTouched(true);
    if (!ready) return;
    try { await window.storage.set("lead:" + Date.now(), JSON.stringify({ ...f, market, at: new Date().toISOString() }), false); } catch (e) {}
    setSent(true);
  }

  if (sent) {
    return (
      <div>
        <div style={{ background: C.canvas, borderRadius: 20, padding: "46px 40px", border: "1px solid " + C.line, position: "relative", overflow: "hidden", textAlign: "center" }}>
          <div className="dotgrid" />
          <div style={{ position: "relative", maxWidth: 470, margin: "0 auto" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.flare, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 18px", boxShadow: "0 10px 30px -8px rgba(255,90,36,.6)" }}>✓</div>
            <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 30, fontWeight: 600, margin: "0 0 10px", color: C.text }}>You're on your way, {f.name.split(" ")[0]}.</h2>
            <p style={{ fontSize: 14.5, color: C.textSub, lineHeight: 1.62, margin: "0 0 22px" }}>A Flayr Labs specialist will review your details and reach out within one business day to start your pre-approval — no obligation, no credit check yet.</p>
            <div style={{ background: C.panel, border: "1px solid " + C.line, borderRadius: 12, padding: "14px 18px", textAlign: "left" }}>
              <DRow k="Looking in" v={f.city || "—"} />
              <DRow k="Target price" v={cur(Number(f.price))} />
              <DRow k="Down payment" v={cur(Number(f.down))} />
              <DRow k="Timeline" v={f.timeline} />
            </div>
            <p style={{ fontSize: 11.5, color: C.textFaint, marginTop: 18 }}>Questions meanwhile? <strong style={{ color: C.text }}>alan.park@flayrlabs.com</strong></p>
            <button onClick={() => { setSent(false); setF({ ...f, notes: "" }); }} style={{ ...btnGhost, marginTop: 16 }}>Submit another request</button>
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: C.textFaint, marginTop: 16 }}>Demo form — submissions stay in this session only and aren't transmitted anywhere.</p>
      </div>
    );
  }
  return (
    <div>
      <SectionTitle kicker="Get started" title="Get pre-approved with Flayrpath" lead="A pre-approval turns estimates into a real budget — and a rate you can often hold for 90–120 days. Share a few details; a specialist takes it from here." />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", gap: 20 }} className="grid2">
        <Card style={{ padding: "24px 24px 10px" }} accentTop={C.flare}>
          <GroupLabel>Contact details</GroupLabel>
          <Field label="Full name">
            <input style={{ ...inputStyle, borderColor: touched && f.name.trim().length < 2 ? C.red : C.line }} value={f.name} onChange={set("name")} placeholder="Alex Morgan" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Email">
              <input style={{ ...inputStyle, borderColor: touched && !emailOk ? C.red : C.line }} value={f.email} onChange={set("email")} placeholder="you@email.com" />
            </Field>
            <Field label="Phone (optional)">
              <input style={inputStyle} value={f.phone} onChange={set("phone")} placeholder="(555) 123-4567" />
            </Field>
          </div>
          <Field label={"City / region in " + M.name}>
            <input style={inputStyle} value={f.city} onChange={set("city")} placeholder="Where are you looking to buy?" />
          </Field>
          <Divider />
          <GroupLabel>Your numbers</GroupLabel>
          <Slider label="Household income" value={f.income} min={40000} max={400000} step={5000} onChange={set("income")} format={cur} accent={C.mint} />
          <Slider label="Target home price" value={f.price} min={200000} max={1600000} step={10000} onChange={set("price")} format={cur} accent={C.amber} />
          <Slider label="Down payment saved" value={f.down} min={0} max={500000} step={2500} onChange={set("down")} format={cur} accent={C.flare} />
          <Field label="When do you hope to buy?">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["Just exploring", "3–6 months", "6–12 months", "12+ months"].map((t) => (
                <button key={t} onClick={() => setF({ ...f, timeline: t })} style={{ border: "1px solid " + (f.timeline === t ? C.flare : C.line), background: f.timeline === t ? C.flare : C.panelSoft, color: f.timeline === t ? "#fff" : C.textSub, borderRadius: 999, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{t}</button>
              ))}
            </div>
          </Field>
          <Field label="Anything else? (optional)">
            <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={f.notes} onChange={set("notes")} placeholder="Self-employed, newcomer, co-buyer, questions…" />
          </Field>
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
          <div style={{ background: "rgba(84,214,166,.08)", border: "1px solid rgba(84,214,166,.25)", borderRadius: 16, padding: "22px" }}>
            <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: C.mint, margin: "0 0 12px" }}>What you get</h3>
            {["A written pre-approval and a held rate", "A specialist who shops multiple lenders for you", "A clear, jargon-free read on your numbers", "No cost, no obligation, no hard credit check to start"].map((t) => (
              <div key={t} style={{ display: "flex", gap: 9, marginBottom: 9 }}>
                <span style={{ color: C.mint, fontWeight: 800 }}>✓</span>
                <span style={{ fontSize: 12.8, color: C.textSub, lineHeight: 1.5 }}>{t}</span>
              </div>
            ))}
          </div>
          <Card style={{ padding: "20px 22px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: ".08em", marginBottom: 10 }}>QUICK READ ON YOUR NUMBERS</div>
            <DLine k="Down payment %" v={pct(Number(f.price) > 0 ? Number(f.down) / Number(f.price) : 0)} />
            <DLine k="Mortgage you'd need" v={cur(Number(f.price) - Number(f.down))} />
            <DLine k="Likely mortgage type" v={Number(f.down) / Number(f.price) >= 0.2 ? "Conventional" : "Insured"} />
            <DLine k="Vs. 4.5× income gauge" v={cur(Number(f.income) * 4.5)} />
          </Card>
          <button onClick={submit} disabled={!ready} style={{ ...btnFlare, opacity: ready ? 1 : 0.5, cursor: ready ? "pointer" : "not-allowed", padding: "15px 24px", fontSize: 15 }}>
            Request my pre-approval →
          </button>
          {touched && !ready && <div style={{ fontSize: 11.5, color: C.red }}>Add your name and a valid email to continue.</div>}
          <p style={{ fontSize: 11, color: C.textFaint, lineHeight: 1.55 }}>By submitting you agree a Flayr Labs specialist may contact you about your enquiry. Demo form — details stay in this session only.</p>
        </div>
      </div>
    </div>
  );
}
function DLine({ k, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: "1px solid " + C.line }}>
      <span style={{ color: C.textSub }}>{k}</span>
      <span style={{ fontWeight: 700, color: C.text }}>{v}</span>
    </div>
  );
}

/* ============================================================
   SCREEN · YOUR PLAN  (the finale)
   ============================================================ */
function Plan({ M, market, profile, go, stage }) {
  const cur = fmtCur(market);
  const p = profile;

  const s = useMemo(() => {
    const qualRate = M.stressTest ? Math.max(M.stressFloor, p.rate + 2) : p.rate;
    const gm = p.income / 12;
    const fixed = 350 + 120; // representative tax + heat
    const r1Room = gm * M.r1.max - fixed;
    const r2Room = gm * M.r2.max - fixed - 400;
    const maxPay = Math.max(0, Math.min(r1Room, r2Room));
    const maxMortgage = maxPrincipal(maxPay, qualRate, 25);
    const maxPrice = maxMortgage + p.down;

    const ruleMin = minDownPayment(p.price, market);
    const qualMin = Math.max(0, p.price - maxMortgage);
    const required = Math.max(ruleMin, qualMin);
    const dpPct = p.price > 0 ? p.down / p.price : 0;
    const mortgageType = required / p.price >= 0.2 ? "Conventional" : "Insured";

    // closing costs + the honest total cash needed
    const cc = closingCosts(p.price, market, true, p.newBuild);
    const cashToClose = required + cc.total;
    const shortfall = Math.max(0, cashToClose - p.down);

    // savings timeline to clear the full cash gap
    let monthsToGoal = null;
    if (shortfall > 0 && p.monthlySave > 0) monthsToGoal = Math.ceil(shortfall / p.monthlySave);

    // readiness score 0-100
    let score = 0;
    score += p.price <= maxPrice ? 34 : Math.max(0, 34 - ((p.price - maxPrice) / maxPrice) * 60);
    score += shortfall <= 0 ? 33 : Math.max(0, 33 - (shortfall / Math.max(cashToClose, 1)) * 50);
    score += dpPct >= 0.2 ? 33 : (dpPct / 0.2) * 33;
    score = Math.round(Math.max(0, Math.min(100, score)));

    const band = score >= 80 ? ["Ready to go", C.mint] : score >= 55 ? ["Almost there", C.amber] : ["Building toward it", C.flare];
    return { qualRate, maxMortgage, maxPrice, required, shortfall, dpPct, mortgageType, monthsToGoal, score, band, cc, cashToClose, withinBudget: p.price <= maxPrice };
  }, [p, M, market]);

  const tScore = useTween(s.score, 700);
  const monthlyEst = monthlyPayment(p.price - s.required, p.rate, 25);

  const steps = [
    {
      done: s.withinBudget,
      label: "Your number",
      good: "The home you're targeting fits inside the mortgage you'd qualify for.",
      bad: "Your target price is above what your income supports — trim the price or lift income.",
      action: ["afford", "Revisit your number"],
    },
    {
      done: s.shortfall <= 0,
      label: "Your cash to close",
      good: cur(p.down) + " covers the full " + cur(s.cashToClose) + " — down payment plus " + cur(s.cc.total) + " in closing costs.",
      bad: "You're " + cur(s.shortfall) + " short of the " + cur(s.cashToClose) + " total cash to close (" + cur(s.required) + " down + " + cur(s.cc.total) + " closing costs)" + (s.monthsToGoal ? " — about " + s.monthsToGoal + " months away at your current pace." : "."),
      action: ["save", "Open the savings planner"],
    },
    {
      done: s.dpPct >= 0.2,
      label: "Insurance-free threshold",
      good: "At " + pct(s.dpPct) + " down you skip mortgage insurance entirely.",
      bad: "At " + pct(s.dpPct) + " down you'd carry mortgage insurance. Reaching 20% removes it.",
      action: ["types", "How insurance works"],
    },
  ];

  return (
    <div>
      <SectionTitle kicker="Your plan" title="Here's where you stand" lead="Everything you've explored, pulled into one place. This is your starting line — and the few moves that get you over it." />

      {/* readiness hero */}
      <div style={{ background: C.canvas, borderRadius: 20, padding: "30px 32px", border: "1px solid " + C.line, position: "relative", overflow: "hidden", marginBottom: 16 }}>
        <div className="dotgrid" />
        <div style={{ position: "relative", display: "flex", gap: 32, flexWrap: "wrap", alignItems: "center" }}>
          {/* score ring */}
          <div style={{ position: "relative", width: 150, height: 150, flexShrink: 0 }}>
            <svg viewBox="0 0 120 120" style={{ width: 150, height: 150, transform: "rotate(-90deg)" }}>
              <circle cx="60" cy="60" r="52" fill="none" stroke={C.panelHi} strokeWidth="12" />
              <circle cx="60" cy="60" r="52" fill="none" stroke={s.band[1]} strokeWidth="12" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 52} strokeDashoffset={2 * Math.PI * 52 * (1 - tScore / 100)} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 38, fontWeight: 600, color: C.text, lineHeight: 1 }}>{Math.round(tScore)}</div>
              <div style={{ fontSize: 10, color: C.textFaint, fontWeight: 700, letterSpacing: ".08em" }}>/ 100</div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <Tag bg={s.band[1] === C.mint ? "rgba(84,214,166,.14)" : C.flareSoft} fg={s.band[1]}>{s.band[0]}</Tag>
            <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 27, fontWeight: 600, color: C.text, margin: "12px 0 8px" }}>
              {s.score >= 80 ? "You're in strong shape — the path is clear."
                : s.score >= 55 ? "You're close — a couple of moves to go."
                : stage === "exploring" ? "Exactly where an explorer should be — here's the runway."
                : stage === "saving" ? "Right on track for this stage — here's what to build next."
                : "A clear runway ahead of you."}
            </h3>
            <p style={{ fontSize: 13.5, color: C.textSub, lineHeight: 1.6, margin: 0 }}>
              Your readiness score weighs three things: whether your target price fits your income, whether you've saved the full cash to close (down payment <em>and</em> closing costs), and how close you are to the 20% insurance-free mark.
            </p>
          </div>
        </div>
      </div>

      {/* the snapshot */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 16 }}>
        <Stat label="You qualify for up to" value={cur(s.maxMortgage)} note="Mortgage, at your inputs" accent={C.mint} />
        <Stat label="Down payment needed" value={cur(s.required)} note={pct(s.dpPct) + " of the price"} accent={C.flare} />
        <Stat label="+ Closing costs" value={cur(s.cc.total)} note="Legal, taxes & one-off fees" accent={C.amber} />
        <Stat label="= Total cash to close" value={cur(s.cashToClose)} note={s.shortfall > 0 ? cur(s.shortfall) + " short of this" : "Fully covered"} accent={s.shortfall > 0 ? C.red : C.mint} />
        <Stat label="Est. monthly payment" value={cur(monthlyEst)} note={s.mortgageType + " mortgage"} accent={C.text} />
      </div>

      {/* action checklist */}
      <div style={{ background: C.panel, border: "1px solid " + C.line, borderTop: "2px solid " + C.flare, borderRadius: 16, marginBottom: 16 }}>
        <div style={{ padding: "15px 24px", borderBottom: "1px solid " + C.line, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: C.textFaint }}>
          Your next moves
        </div>
        {steps.map((st, i) => (
          <div key={i} style={{ display: "flex", gap: 15, alignItems: "flex-start", padding: "17px 24px", borderBottom: i < steps.length - 1 ? "1px solid " + C.line : "none" }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, background: st.done ? C.mint : C.panelSoft, border: "1px solid " + (st.done ? C.mint : C.lineHi), color: st.done ? C.canvas : C.textFaint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>
              {st.done ? "✓" : i + 1}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 3 }}>{st.label}</div>
              <div style={{ fontSize: 12.8, color: C.textSub, lineHeight: 1.55 }}>{st.done ? st.good : st.bad}</div>
            </div>
            {!st.done && (
              <button onClick={() => go(st.action[0])} style={{ flexShrink: 0, background: "transparent", border: "1px solid " + C.lineHi, color: C.text, borderRadius: 999, padding: "7px 13px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                {st.action[1]} →
              </button>
            )}
          </div>
        ))}
      </div>

      {/* CTA */}
      <div style={{ background: "linear-gradient(135deg," + C.flareDeep + "," + C.flare + ")", borderRadius: 18, padding: "28px 30px", display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ maxWidth: 460 }}>
          <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 600, color: "#fff", margin: "0 0 6px" }}>Ready to make it real?</h3>
          <p style={{ fontSize: 13.5, color: "rgba(255,255,255,.9)", lineHeight: 1.6, margin: 0 }}>
            A Flayr Labs specialist turns this plan into a written pre-approval — no obligation, no hard credit check to start. Your numbers are already filled in.
          </p>
        </div>
        <button onClick={() => go("approval")} style={{ background: C.canvas, color: "#fff", border: "none", borderRadius: 12, padding: "15px 26px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
          Get pre-approved →
        </button>
      </div>

      <p style={{ fontSize: 11.5, color: C.textFaint, marginTop: 16, lineHeight: 1.6 }}>
        Your plan is a simplified snapshot built from the numbers you entered, using representative property tax and debt assumptions. A licensed broker will refine every figure.
      </p>
    </div>
  );
}

/* ============================================================
   SCREEN · FIRST-TIME BUYER PERKS
   ============================================================ */
function FHBPerks({ profile, patch, market }) {
  const cur = fmtCur(market);

  // shared profile flags so toggles persist across the journey
  const f = {
    neverOwned: profile.neverOwned ?? true,
    spouseOwned: profile.spouseOwned ?? false,
    province: profile.province ?? "ON",
    toronto: profile.toronto ?? false,
    newBuild: profile.newBuild ?? false,
  };
  const set = (k) => (v) => patch({ [k]: v });

  // strict FHB definition (HBP / FHSA / LTT rebates use variants of this)
  const fhbStrict = f.neverOwned && !f.spouseOwned;
  // a softer "FHB-ish" used by HBP: at least 4 years since last owning + occupied
  const fhbHBP = f.neverOwned || true; // we treat the toggle as the proxy; copy explains the 4-yr rule

  // worked example based on what they've already entered (price/down)
  const price = profile.price || 600000;

  // Ontario LTT first-time-buyer rebate (up to $4,000) — apply only if eligible
  const onLTTRebate = fhbStrict && f.province === "ON" ? Math.min(landTransferTax(price), 4000) : 0;
  // Toronto municipal rebate (up to $4,475) when toggled on + Ontario + eligible
  const torontoRebate = fhbStrict && f.province === "ON" && f.toronto ? Math.min(landTransferTax(price), 4475) : 0;
  // GST/HST new-home rebate — uses corrected helpers with proper phase-out logic
  const gstRebate = fhbStrict && f.newBuild ? Math.round(gstFHBRebate(price)) : 0;
  // Ontario provincial HST rebate on new builds — flat 75% × 8% cap of $24K
  const hstRebate = fhbStrict && f.newBuild && f.province === "ON" ? Math.round(ontarioHSTRebate(price)) : 0;

  const totalSavings = onLTTRebate + torontoRebate + gstRebate + hstRebate;

  const Toggle = ({ on, label, sub, onToggle, accent }) => (
    <button onClick={() => onToggle(!on)}
      style={{ width: "100%", textAlign: "left", background: "none", border: "1px solid " + (on ? (accent || C.mint) : C.line),
        borderRadius: 12, padding: "13px 15px", cursor: "pointer", fontFamily: "inherit",
        display: "flex", alignItems: "center", gap: 12, transition: "all .15s" }}>
      <span style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0,
        background: on ? (accent || C.mint) : "transparent", border: "1.75px solid " + (on ? (accent || C.mint) : C.lineHi),
        color: C.canvas, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>
        {on ? "✓" : ""}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.5, marginTop: 2 }}>{sub}</div>}
      </div>
    </button>
  );

  const Benefit = ({ name, kicker, kickerColor, qualifies, deal, who, how, amount, sub }) => (
    <div style={{ background: C.panel, border: "1px solid " + (qualifies ? "rgba(84,214,166,.3)" : C.line),
      borderTop: "2px solid " + (qualifies ? C.mint : kickerColor), borderRadius: 16, padding: "20px 22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".14em", color: kickerColor, textTransform: "uppercase", marginBottom: 5 }}>{kicker}</div>
          <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 21, fontWeight: 600, color: C.text, margin: 0 }}>{name}</h3>
        </div>
        {qualifies && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: C.mint, background: "rgba(84,214,166,.12)",
            border: "1px solid rgba(84,214,166,.35)", borderRadius: 999, padding: "4px 10px", letterSpacing: ".04em", whiteSpace: "nowrap" }}>✓ YOU QUALIFY</span>
        )}
      </div>
      <div style={{ fontSize: 13, color: C.textSub, lineHeight: 1.6, marginBottom: 12 }}>{deal}</div>
      {amount !== undefined && (
        <div style={{ background: C.canvas, border: "1px solid " + C.line, borderRadius: 11, padding: "11px 14px", marginBottom: 12,
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: C.textFaint, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>For your home at {cur(price)}</span>
          <span style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: amount > 0 ? C.mint : C.textFaint }}>{amount > 0 ? cur(amount) : "—"}</span>
        </div>
      )}
      {sub && <div style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.55, marginBottom: 12, fontStyle: "italic" }}>{sub}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12.3, color: C.textSub, lineHeight: 1.55 }}>
        <div><strong style={{ color: C.text }}>Who qualifies.</strong> {who}</div>
        <div><strong style={{ color: C.text }}>How to claim.</strong> {how}</div>
      </div>
    </div>
  );

  return (
    <div>
      <SectionTitle kicker="First-time buyer perks"
        title="Every program Canada hands first-time buyers"
        lead="Most Canadian first-time buyers leave money on the table — they never claim what they're owed. Here's everything in one place, with the rules to qualify and how much it's worth on the home you've been sizing." />

      {/* ELIGIBILITY — drives the YOU QUALIFY badges */}
      <Card style={{ padding: "22px 24px", marginBottom: 18 }} accentTop={C.flare}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".14em", color: C.flare, textTransform: "uppercase", marginBottom: 7 }}>Tell us about you</div>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600, color: C.text, margin: "0 0 5px" }}>Are you actually a "first-time buyer"?</h3>
        <p style={{ fontSize: 12.8, color: C.textSub, margin: "0 0 14px", lineHeight: 1.55 }}>
          Every program defines this slightly differently. Toggle what's true for you — we'll show what you qualify for.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Toggle on={f.neverOwned} onToggle={set("neverOwned")} label="I've never owned a home, anywhere in the world"
            sub="The strictest definition — used by most LTT rebates and the FHSA. The HBP allows a 4-year gap since last owning instead." />
          <Toggle on={f.spouseOwned} onToggle={set("spouseOwned")} label="My spouse or common-law partner has owned a home (during our relationship)"
            sub="This can disqualify you from some programs even if you personally never owned. Check carefully." accent={C.amber} />
          <Toggle on={f.newBuild} onToggle={set("newBuild")} label="The home is newly built (not resale)"
            sub="Unlocks the GST/HST new-home rebates." accent={C.sky} />
          <Toggle on={f.toronto} onToggle={set("toronto")} label="The home is in the City of Toronto"
            sub="Toronto has its own land transfer tax — and its own rebate." accent={C.violet} />
        </div>
        <div style={{ marginTop: 14, fontSize: 12, color: C.textFaint, lineHeight: 1.55, background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 11, padding: "11px 14px" }}>
          <strong style={{ color: C.text }}>Worked examples below assume:</strong> Ontario, your current home price {cur(price)}.
          Other provinces have their own rebates with different caps — we flag where it matters.
        </div>
      </Card>

      {/* qualifying summary */}
      {totalSavings > 0 && (
        <Card style={{ padding: "18px 22px", marginBottom: 18, background: "linear-gradient(120deg, rgba(84,214,166,.08), rgba(255,180,74,.06))" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".12em", color: C.mint, textTransform: "uppercase" }}>What you'd unlock</div>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 28, fontWeight: 600, color: C.text, marginTop: 4 }}>
                Up to <span style={{ color: C.mint }}>{cur(totalSavings)}</span> back
              </div>
              <div style={{ fontSize: 12, color: C.textSub, marginTop: 3 }}>on a {cur(price)} home, with your current eligibility</div>
            </div>
            <FlayrGlyph size={48} />
          </div>
        </Card>
      )}

      {/* THE PROGRAMS */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* FHSA */}
        <Benefit name="First Home Savings Account (FHSA)"
          kicker="01 · save tax-free" kickerColor={C.mint}
          qualifies={fhbStrict}
          deal="The newest and best FHB account in Canada. Contributions are tax-deductible going in (like an RRSP) and withdrawals for a first home are tax-free (like a TFSA). Most Canadians have only ever had one or the other — never both."
          amount={fhbStrict ? 40000 : 0}
          sub="$8,000/year contribution limit · $40,000 lifetime cap · keep up to 15 years"
          who="Canadian residents 18+ who haven't owned a home they lived in this year or any of the previous 4 calendar years. Spouse's ownership doesn't disqualify you."
          how="Open one at most major banks or at Wealthsimple. Contribute throughout the year, deduct on your tax return, withdraw tax-free when you buy. No repayment required. Buying with a partner? You can each open one — that's up to $80,000 combined toward the same home." />

        {/* HBP */}
        <Benefit name="RRSP Home Buyers' Plan (HBP)"
          kicker="02 · borrow from yourself" kickerColor={C.sky}
          qualifies={fhbHBP}
          deal="Withdraw up to $60,000 from your RRSP tax-free to put toward a first home. You repay yourself over 15 years — so it's more like an interest-free loan from your future than free money. Can be combined with the FHSA."
          amount={fhbHBP ? 60000 : 0}
          sub="$60,000 limit ($120K for a couple) · 15-year repayment · combines with FHSA"
          who="You must be a 'first-time buyer' — defined here as not having owned a home you lived in for 4 years before the withdrawal. Looser than the FHSA rule."
          how="Fill out form T1036 with your RRSP issuer to withdraw. The money must already have sat in the RRSP for 90 days. Start repayments in year 2 after withdrawal — miss a year and that portion is added to your taxable income." />

        {/* Provincial LTT — Ontario worked example */}
        <Benefit name="Provincial land transfer tax rebate"
          kicker="03 · cash back at closing" kickerColor={C.flare}
          qualifies={fhbStrict && f.province === "ON"}
          deal="Provinces with land transfer tax give first-time buyers a rebate that wipes out part — or in many cases all — of it. In Ontario, up to $4,000. BC, PEI, and others have their own versions; Alberta and Saskatchewan have no LTT at all."
          amount={onLTTRebate}
          sub={"Ontario cap: $4,000 · BC: up to ~$8,000 · " + (f.province === "ON" ? "your Ontario LTT on this home is " + cur(landTransferTax(price)) : "select your province for the local rate")}
          who="Must have never owned a home anywhere in the world (yes, anywhere). If your spouse has owned during your relationship, you're usually disqualified. You also have to actually live in the home within 9 months."
          how="Your real estate lawyer claims it automatically at closing — you just pay the reduced amount. Tell your lawyer up front that you're a first-time buyer." />

        {/* Toronto municipal LTT */}
        <Benefit name="Toronto municipal land transfer tax rebate"
          kicker="04 · Toronto only" kickerColor={C.violet}
          qualifies={fhbStrict && f.toronto && f.province === "ON"}
          deal="Toronto is one of the few Canadian cities with its own land transfer tax on top of the provincial one. First-time buyers get up to $4,475 of it rebated — separate from the provincial rebate, so eligible buyers in Toronto stack both."
          amount={torontoRebate}
          sub="Toronto cap: $4,475 · stacks with the Ontario rebate above"
          who="Same rules as the provincial rebate, plus the home must be in the City of Toronto."
          how="Same path — your lawyer files it at closing. The two rebates appear on your final statement as separate credits." />

        {/* GST new-home rebate — corrected per OSFI Finding 04 */}
        <Benefit name="Federal GST new-home rebate for FHBs"
          kicker="05 · new builds only" kickerColor={C.amber}
          qualifies={fhbStrict && f.newBuild && gstRebate > 0}
          deal="A newer federal rule: first-time buyers of newly built homes get the federal GST (5%) effectively removed — in full for homes up to $1M, with the rebate phasing out linearly between $1M and $1.5M, and no rebate above $1.5M. On a $600K new build that's $30,000 back."
          amount={gstRebate}
          sub="Full rebate ≤ $1M · linear phase-out $1M–$1.5M · zero above $1.5M"
          who="Must be a true first-time buyer (never owned anywhere) and the home must be your principal residence. The builder is usually the contracting party that applies it."
          how="The builder typically credits the rebate against the purchase price upfront, so the GST simply isn't charged. If not, you file form GST190 with the CRA after closing." />

        {/* Ontario HST rebate */}
        <Benefit name="Ontario HST new-home rebate"
          kicker="06 · Ontario new builds" kickerColor={C.amber}
          qualifies={fhbStrict && f.newBuild && f.province === "ON"}
          deal="On top of the federal GST rebate, Ontario refunds 75% of the provincial 8% HST portion on new builds, up to $24,000. Most builders bake this into the advertised price; if not, you claim it directly."
          amount={hstRebate}
          sub="75% of provincial 8% portion · up to $24,000 · stacks with the federal GST rebate"
          who="New builds in Ontario, occupied as principal residence. You don't strictly have to be a first-time buyer for this one — but it pairs naturally with the federal FHB rebate."
          how="Usually credited by the builder upfront. If not, file form RC7191-ON with the CRA within two years of closing." />

        {/* 30-year amortization for FHBs */}
        <Benefit name="30-year amortization for first-time buyers"
          kicker="07 · longer payoff allowed" kickerColor={C.violet}
          qualifies={fhbStrict && f.newBuild}
          deal="A 2024 federal rule lets first-time buyers stretch their insured mortgage to 30 years (up from the standard 25) on newly built homes. Lowers the monthly payment — but as Mortgage 101 showed, longer amortization means much more total interest paid."
          who="True first-time buyer purchasing a newly built home with an insured mortgage (less than 20% down)."
          how="Tell your broker or lender you want the 30-year option when applying. Not all lenders implement it the same way — confirm before signing." />
      </div>

      {/* honest caveats */}
      <div style={{ marginTop: 18, background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 14, padding: "16px 20px", fontSize: 12.3, color: C.textSub, lineHeight: 1.6 }}>
        <strong style={{ color: C.text }}>A few honest notes.</strong> Eligibility rules are summarized — every program has fine print (occupancy timelines, spousal rules, residency, holding periods) that can disqualify a buyer who looks eligible at a glance. Provincial rebates outside Ontario vary widely. Federal rules (GST FHB rebate, 30-year amortization) are recent and lender implementation differs. Always confirm with a real estate lawyer and a mortgage broker before counting on any of these — but knowing they exist is already most of the battle.
      </div>
    </div>
  );
}

/* ============================================================
   SCREEN · DOCUMENT CHECKLIST
   ============================================================ */
function DocChecklist({ M }) {

  const groups = [
        {
          title: "Prove who you are",
          accent: C.sky,
          icon: "credit",
          items: [
            ["Government-issued photo ID", "A valid driver's licence or passport. Lenders accept specific types, and the approved list varies by province — your broker confirms what works where you are."],
            ["A second piece of ID", "Often required to back up the first — a second photo ID, or something like a birth certificate, PR card or provincial health card (where permitted)."],
            ["Social Insurance Number", "Needed for the lender's credit check. You provide the number; you don't usually need the physical card."],
          ],
        },
        {
          title: "Prove what you earn",
          accent: C.mint,
          icon: "income",
          items: [
            ["Recent pay stubs", "Your last 2–3 stubs, showing year-to-date earnings. The most direct proof of steady income."],
            ["Notice of Assessment (NOA)", "The CRA summary you get after filing taxes — usually the last 1–2 years. Especially important if you're self-employed or have variable income."],
            ["Letter of employment", "On company letterhead, confirming your role, salary, and how long you've been employed. Lenders often call to verify."],
            ["T4 slips / business records", "Last 1–2 years of T4s for employees; self-employed buyers bring T1 returns, financial statements, or business bank records."],
          ],
        },
        {
          title: "Prove what you have",
          accent: C.amber,
          icon: "down",
          items: [
            ["Bank statements", "Typically the last 90 days, showing the cash on hand for your down payment and closing costs. Lenders trace where the money came from."],
            ["Proof of down payment source", "Statements for savings, an FHSA, TFSA, or RRSP (Home Buyers' Plan). If any is a gift, a signed gift letter from the family member."],
            ["Investment / asset statements", "Anything that strengthens your financial picture — non-registered investments, GICs, or other property."],
          ],
        },
        {
          title: "Prove the purchase",
          accent: C.flare,
          icon: "closing",
          items: [
            ["Agreement of Purchase and Sale (APS)", "The signed contract for the specific home you're buying — the lender needs it to finalize the mortgage amount and details."],
            ["MLS listing / property details", "The listing sheet helps the lender confirm the property and order an appraisal."],
            ["Proof of deposit paid", "Confirmation of the deposit you gave with your offer — it counts toward your down payment."],
          ],
        },
        {
          title: "Other documents lenders may ask for",
          accent: C.violet,
          icon: "ratio",
          items: [
            ["List of debts & monthly obligations", "Balances and payments on car loans, student loans, credit cards and lines of credit — this feeds your GDS/TDS ratios."],
            ["Void cheque or pre-authorized debit form", "So the lender can set up your mortgage payments."],
            ["Property tax & condo/strata info", "Recent tax bill, and condo fees / status certificate if you're buying a condo."],
          ],
        },
  ];

  const allItems = groups.flatMap((g, gi) => g.items.map((_, ii) => gi + "-" + ii));
  const [checked, setChecked] = useState(() => new Set());
  const toggle = (id) => setChecked((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const done = checked.size;
  const totalCount = allItems.length;
  const pctDone = Math.round((done / totalCount) * 100);

  return (
    <div>
      <SectionTitle kicker="Document checklist" title="Get your paperwork ready" lead="A mortgage application moves fast once it starts — and stalls the moment a document is missing. Gather these ahead of time and pre-approval becomes the easy part." />

      {/* progress */}
      <Card style={{ padding: "18px 22px", marginBottom: 16 }} accentTop={C.mint}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
            {done === totalCount ? "Everything's ready — nicely done." : done + " of " + totalCount + " gathered"}
          </span>
          <span style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600, color: done === totalCount ? C.mint : C.amber }}>{pctDone}%</span>
        </div>
        <div style={{ height: 9, background: C.panelSoft, borderRadius: 999, overflow: "hidden", border: "1px solid " + C.line }}>
          <div style={{ width: pctDone + "%", height: "100%", background: done === totalCount ? C.mint : "linear-gradient(90deg," + C.flare + "," + C.amber + ")", borderRadius: 999, transition: "width .3s ease" }} />
        </div>
        <div style={{ fontSize: 11, color: C.textFaint, marginTop: 8 }}>Tap any item to mark it gathered. This list is a private tracker — nothing is uploaded.</div>
      </Card>

      {/* groups */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {groups.map((g, gi) => {
          const groupDone = g.items.every((_, ii) => checked.has(gi + "-" + ii));
          return (
            <div key={gi} style={{ background: C.panel, border: "1px solid " + C.line, borderTop: "2px solid " + g.accent, borderRadius: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "15px 22px", borderBottom: "1px solid " + C.line }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: C.panelSoft, border: "1px solid " + C.line, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={g.icon} size={17} color={g.accent} />
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.text, flex: 1 }}>{g.title}</span>
                {groupDone && <span style={{ fontSize: 11, fontWeight: 700, color: C.mint }}>✓ complete</span>}
              </div>
              {g.items.map(([label, why], ii) => {
                const id = gi + "-" + ii;
                const on = checked.has(id);
                return (
                  <button key={ii} onClick={() => toggle(id)}
                    style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
                      display: "flex", gap: 13, alignItems: "flex-start", padding: "15px 22px",
                      borderBottom: ii < g.items.length - 1 ? "1px solid " + C.line : "none" }}>
                    <span style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, marginTop: 1,
                      background: on ? C.mint : "transparent", border: "1.75px solid " + (on ? C.mint : C.lineHi),
                      color: C.canvas, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800,
                      transition: "all .15s" }}>
                      {on ? "✓" : ""}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: on ? C.textFaint : C.text, textDecoration: on ? "line-through" : "none" }}>{label}</div>
                      <div style={{ fontSize: 12.3, lineHeight: 1.55, color: C.textSub, marginTop: 2 }}>{why}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 16, background: C.panelSoft, border: "1px solid " + C.line, borderRadius: 14, padding: "16px 20px", fontSize: 12.5, color: C.textSub, lineHeight: 1.6 }}>
        <strong style={{ color: C.text }}>A few tips.</strong> Save everything as clear PDFs or photos in one folder so you can send it fast. Statements should be recent and show your full name. Approved ID types differ by province — your broker or lender confirms exactly what's accepted where you live. Self-employed buyers should expect to provide more income history. This is a typical list, not a guarantee — the lender's own checklist is the final word.
      </div>
    </div>
  );
}

/* ============================================================
   APP SHELL
   ============================================================ */
export default function App() {
  const [tab, setTab] = useState("start");
  const market = "CA";
  const M = MARKETS[market];

  // ---- where the person is on the journey: sets sensible, wealth-appropriate defaults + tone ----
  const [stage, setStageRaw] = useState(null); // null until chosen
  const [profile, setProfile] = useState({
    income: 75000,
    down: 20000,
    price: 450000,
    rate: 4.5,
    savingsGoal: 60000,
    monthlySave: 600,
    newBuild: false,
  });
  const patch = (obj) => setProfile((prev) => ({ ...prev, ...obj }));

  // each stage seeds realistic numbers for that life-point (addresses the net-worth gap)
  const setStage = (id) => {
    setStageRaw(id);
    if (id === "exploring") {
      patch({ income: 62000, down: 8000, price: 380000, savingsGoal: 50000, monthlySave: 400 });
    } else if (id === "saving") {
      patch({ income: 85000, down: 30000, price: 480000, savingsGoal: 70000, monthlySave: 800 });
    } else if (id === "ready") {
      patch({ income: 120000, down: 75000, price: 600000, savingsGoal: 90000, monthlySave: 1200 });
    }
  };

  // ---- the guided path ----
  const tabs = [
    { id: "start", label: "Start", rail: "Start" },
    { id: "afford", label: "Your number", rail: "Your number" },
    { id: "tradeoff", label: "Rent vs. own", rail: "Rent vs. own" },
    { id: "save", label: "Down payment", rail: "Down payment" },
    { id: "credit", label: "Credit", rail: "Credit" },
    { id: "types", label: "Mortgage 101", rail: "Mortgage 101" },
    { id: "fhb", label: "First-time buyer perks", rail: "Buyer perks" },
    { id: "plan", label: "Your plan", rail: "Your plan" },
    { id: "docs", label: "Document checklist", rail: "Documents" },
    { id: "approval", label: "Get started", rail: "Get started" },
  ];
  const idx = tabs.findIndex((t) => t.id === tab);
  const prevTab = idx > 0 ? tabs[idx - 1] : null;
  const nextTab = idx < tabs.length - 1 ? tabs[idx + 1] : null;

  const [visited, setVisited] = useState(() => new Set(["start"]));
  const topRef = useRef(null);

  // every screen change scrolls the user back to the top
  function goTo(id) {
    setTab(id);
    setVisited((v) => new Set(v).add(id));
    requestAnimationFrame(() => {
      if (topRef.current) topRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const progress = Math.round((idx / (tabs.length - 1)) * 100);

  return (
    <div ref={topRef} style={{ minHeight: "100vh", background: C.canvas, fontFamily: "'Hanken Grotesk', system-ui, sans-serif", color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Hanken+Grotesk:wght@400;500;600;700&family=Geist:wght@500;600;700&family=Geist+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        .reveal { animation: fadeUp .55s cubic-bezier(.2,.7,.2,1) both; }
        @keyframes fadeUp { from { opacity:0; transform: translateY(13px); } to { opacity:1; transform:none; } }
        .aipulse { animation: aipulse 1s ease-in-out infinite; }
        @keyframes aipulse { 0%,100% { opacity:.35; transform:scale(.85); } 50% { opacity:1; transform:scale(1.15); } }
        /* content cards are static; only true controls react to the cursor */
        .nextcard { transition: transform .18s ease, border-color .18s ease, background .18s ease; }
        .nextcard:hover { transform: translateY(-2px); border-color: ${C.flare}; }
        .nextcard:hover .nextarrow { transform: translateX(4px); }
        .nextarrow { transition: transform .18s ease; }
        .navback { transition: border-color .15s ease, color .15s ease; }
        .navback:hover { border-color: ${C.lineHi}; color: ${C.text}; }
        .railstep { transition: color .15s ease; }
        .railstep:hover { color: ${C.text}; }
        .rng { -webkit-appearance:none; appearance:none; width:100%; height:26px; border-radius:999px;
          background:transparent; outline:none; cursor:grab; margin:0; }
        .rng:active { cursor:grabbing; }
        .rng::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:26px; height:26px;
          border-radius:50%; background:#fff; border:5px solid currentColor; box-shadow:0 3px 10px rgba(0,0,0,.55);
          transition:transform .12s ease; }
        .rng:active::-webkit-slider-thumb { transform:scale(1.18); }
        .rng:focus-visible::-webkit-slider-thumb { box-shadow:0 0 0 4px ${C.flareSoft},0 3px 10px rgba(0,0,0,.55); }
        .rng::-moz-range-thumb { width:24px; height:24px; border-radius:50%; background:#fff;
          border:5px solid currentColor; box-shadow:0 3px 10px rgba(0,0,0,.55); }
        .rng:active::-moz-range-thumb { transform:scale(1.18); }
        .rng::-moz-range-track { background:transparent; }
        .dotgrid { position:absolute; inset:0; background-image: radial-gradient(rgba(255,255,255,.045) 1px, transparent 1px);
          background-size: 22px 22px; pointer-events:none; }
        .marquee { animation: scroll 32s linear infinite; }
        @keyframes scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        input:focus, textarea:focus { border-color:${C.flare} !important; }
        input::placeholder, textarea::placeholder { color:${C.textFaint}; }
        .railscroll::-webkit-scrollbar { height:0; }
        @media (max-width: 820px) { .grid2 { grid-template-columns: 1fr !important; } .grid3 { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* ---- HEADER ---- */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(22,19,16,.94)", backdropFilter: "blur(10px)", borderBottom: "1px solid " + C.line }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "13px 22px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12, flexWrap: "wrap" }}>
            <button onClick={() => goTo("start")} style={{ display: "flex", alignItems: "baseline", gap: 9, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
              {/* FLAYR wordmark — the A is the brand triangle, tuned alignment */}
              <span style={{ display: "inline-flex", alignItems: "flex-end", fontFamily: "Geist, system-ui, sans-serif", fontWeight: 600, fontSize: 22, letterSpacing: "-.035em", lineHeight: 1, color: C.text, userSelect: "none" }}>
                FL
                <span style={{ display: "inline-flex", alignItems: "flex-end", width: ".58em", height: ".72em", transform: "translateY(-.18em)", margin: 0 }}>
                  <svg viewBox="0 0 100 87" style={{ width: "100%", height: "100%", overflow: "visible" }}>
                    <path d="M50 0 L100 87 L0 87 Z" fill={C.flare} />
                  </svg>
                </span>
                <span style={{ display: "inline-block", marginLeft: "-.20em" }}>YR</span>
              </span>
              {/* PATH — product suffix in monospace, the system's product-lockup pattern */}
              <span style={{ fontFamily: "ui-monospace, 'Geist Mono', monospace", fontSize: 11, fontWeight: 500, letterSpacing: ".18em", color: C.flare, marginLeft: 2 }}>PATH</span>
              <span style={{ fontSize: 10.5, color: C.textFaint, fontWeight: 700, letterSpacing: ".06em", borderLeft: "1px solid " + C.line, paddingLeft: 9, marginLeft: 4 }}>OWN THE PATH</span>
            </button>
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.panel, border: "1px solid " + C.line, borderRadius: 999, padding: "6px 12px" }}>
              <span style={{ fontSize: 13 }}>🇨🇦</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: C.textSub, letterSpacing: ".04em" }}>CANADA</span>
            </div>
          </div>

          {/* ---- STEP RAIL: shows the journey + you-are-here ---- */}
          <div className="railscroll" style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", paddingBottom: 11 }}>
            {tabs.map((t, i) => {
              const on = t.id === tab;
              const done = visited.has(t.id) && !on;
              return (
                <React.Fragment key={t.id}>
                  {i > 0 && <div style={{ width: 16, height: 2, background: i <= idx ? C.flare : C.line, flexShrink: 0 }} />}
                  <button
                    className="railstep"
                    onClick={() => goTo(t.id)}
                    style={{ display: "flex", alignItems: "center", gap: 7, background: on ? C.flareSoft : "transparent", border: "1px solid " + (on ? C.flare : "transparent"), borderRadius: 999, padding: "5px 11px 5px 6px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0, color: on ? C.text : C.textFaint }}
                  >
                    <span style={{ width: 19, height: 19, borderRadius: "50%", flexShrink: 0, background: on ? C.flare : done ? "rgba(84,214,166,.9)" : C.panelHi, color: on || done ? C.canvas : C.textFaint, fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {done ? "✓" : i + 1}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{t.rail}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
          {/* progress bar */}
          <div style={{ height: 2, background: C.line, position: "relative" }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: 2, width: progress + "%", background: "linear-gradient(90deg," + C.flare + "," + C.amber + ")", transition: "width .35s ease" }} />
          </div>
        </div>
      </div>

      {/* ---- CONTENT ---- */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 22px 20px" }}>
        <Reveal key={tab + market}>
          {tab === "start" && <Start go={goTo} M={M} stage={stage} setStage={setStage} />}
          {tab === "afford" && <Affordability M={M} market={market} profile={profile} patch={patch} />}
          {tab === "tradeoff" && <TradeOff M={M} market={market} profile={profile} patch={patch} />}
          {tab === "save" && <SavingsPlanner M={M} market={market} profile={profile} patch={patch} />}
          {tab === "credit" && <Credit M={M} />}
          {tab === "types" && <Types M={M} market={market} />}
          {tab === "fhb" && <FHBPerks profile={profile} patch={patch} market={market} />}
          {tab === "plan" && <Plan M={M} market={market} profile={profile} go={goTo} stage={stage} />}
          {tab === "docs" && <DocChecklist M={M} />}
          {tab === "approval" && <PreApproval M={M} market={market} profile={profile} />}
        </Reveal>
      </div>

      {/* ---- GUIDED FOOTER: Back / progress / Next ---- */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 22px 16px" }}>
        {nextTab && (
          <button
            className="nextcard"
            onClick={() => goTo(nextTab.id)}
            style={{ width: "100%", textAlign: "left", background: C.panel, border: "1px solid " + C.line, borderRadius: 16, padding: "20px 24px", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: C.flare, marginBottom: 5 }}>
                Next · step {idx + 2} of {tabs.length}
              </div>
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: C.text }}>{nextTab.label}</div>
              <div style={{ fontSize: 12.5, color: C.textSub, marginTop: 3 }}>{NEXT_BLURB[nextTab.id]}</div>
            </div>
            <div className="nextarrow" style={{ width: 46, height: 46, borderRadius: "50%", flexShrink: 0, background: C.flare, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700 }}>→</div>
          </button>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          {prevTab ? (
            <button className="navback" onClick={() => goTo(prevTab.id)} style={{ background: "transparent", border: "1px solid " + C.line, color: C.textSub, borderRadius: 999, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              ← {prevTab.label}
            </button>
          ) : <span />}
          <span style={{ fontSize: 11.5, color: C.textFaint, fontWeight: 600 }}>Step {idx + 1} of {tabs.length}</span>
          {nextTab ? (
            <button onClick={() => goTo(nextTab.id)} style={{ background: C.flare, color: "#fff", border: "none", borderRadius: 999, padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 6px 18px -8px rgba(255,90,36,.6)" }}>
              {nextTab.label} →
            </button>
          ) : (
            <button onClick={() => goTo("start")} style={{ background: "transparent", color: C.textSub, border: "1px solid " + C.line, borderRadius: 999, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              ↺ Start over
            </button>
          )}
        </div>
      </div>

      {/* ---- FOOTER ---- */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "8px 22px 56px" }}>
        <div style={{ borderTop: "1px solid " + C.line, paddingTop: 18, fontSize: 11.5, color: C.textFaint, lineHeight: 1.6 }}>
          <strong style={{ color: C.textSub }}>FLAYR PATH</strong> is an educational tool by Flayr Labs for first-time buyers, currently set to <strong style={{ color: C.textSub }}>{M.flag} {M.name}</strong> and reflecting 2026 mortgage guidelines. It isn't financial, legal or mortgage advice, and all calculations are estimates. Rules, rates and limits change — confirm everything with a licensed mortgage broker or lender before deciding. Links marked <strong style={{ color: C.textSub }}>Partner</strong> are affiliate links — Flayr Labs may earn a commission if you sign up, at no cost to you.
        </div>
      </div>
    </div>
  );
}

const NEXT_BLURB = {
  afford: "Find the mortgage and home price your income supports.",
  tradeoff: "See what owning actually does to your monthly budget.",
  save: "Plan how fast you can fund the down payment.",
  credit: "Understand the score that sets your rate.",
  types: "Learn insured vs. conventional, collateral charges and HELOCs.",
  fhb: "Every Canadian first-time-buyer program — and the rules to qualify.",
  plan: "Pull everything into one personalized summary.",
  docs: "Gather the paperwork a lender will ask you for.",
  approval: "Turn your plan into a real pre-approval with Flayr Labs.",
};
