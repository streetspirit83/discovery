/**
 * Price Cycle & Historical Position Score (PCHS) — 0–100 pts
 *
 * Assesses where the current price sits relative to its absolute historical
 * extremes and recent cycle ranges. High = near ATH, Low = near all-time floor.
 *
 * Components:
 *   S_LT  (40 pts): lifetime range position   (close - Low.All) / (High.All - Low.All)
 *   S_ATH (30 pts): ATH drawdown              close / High.All
 *   S_52W (20 pts): 52-week cycle position    (close - low52w) / (high52w - low52w)
 *   S_6M  (10 pts): 6-month structural trend  (close - Low.6M) / (High.6M - Low.6M)
 *
 * Input uses verbatim TradingView field names (or tv_data field names for the
 * already-stored aliases).
 */
export function computeCycleScore(r) {
  const close   = r.close;
  const highAll = r['High.All'] ?? r.high_all;
  const lowAll  = r['Low.All']  ?? r.low_all;
  const high52w = r.price_52_week_high;
  const low52w  = r.price_52_week_low;
  const high6m  = r['High.6M']  ?? r.high_6m;
  const low6m   = r['Low.6M']   ?? r.low_6m;

  // Require at minimum: close + all-time range (40+30 pt anchor)
  if (close == null || close <= 0 || highAll == null || lowAll == null || highAll <= lowAll) {
    return null;
  }

  // S_LT — 40 pts
  const ltRange = highAll - lowAll;
  const s_lt = clamp((close - lowAll) / ltRange * 40, 0, 40);

  // S_ATH — 30 pts
  const s_ath = clamp(close / highAll * 30, 0, 30);

  // S_52W — 20 pts (skip gracefully if data absent)
  let s_52w = 0;
  if (high52w != null && low52w != null) {
    const r52 = high52w - low52w;
    s_52w = r52 > 0 ? clamp((close - low52w) / r52 * 20, 0, 20) : 10;
  }

  // S_6M — 10 pts (skip gracefully if data absent)
  let s_6m = 0;
  if (high6m != null && low6m != null) {
    const r6m = high6m - low6m;
    s_6m = r6m > 0 ? clamp((close - low6m) / r6m * 10, 0, 10) : 5;
  }

  const total = Math.round(s_lt + s_ath + s_52w + s_6m);

  let label, labelCode;
  if      (total >= 85) { label = 'Blue Sky / ATH-Nähe';   labelCode = 'ATH';   }
  else if (total >= 65) { label = 'Oberer Zyklus';          labelCode = 'HIGH';  }
  else if (total >= 35) { label = 'Mitte / Coiled Spring';  labelCode = 'MID';   }
  else if (total >= 20) { label = 'Unterer Zyklus';         labelCode = 'LOW';   }
  else                  { label = 'Distressed / Bodennähe'; labelCode = 'FLOOR'; }

  return {
    total,
    components: {
      s_lt:  round1(s_lt),
      s_ath: round1(s_ath),
      s_52w: round1(s_52w),
      s_6m:  round1(s_6m),
    },
    label,
    labelCode,
  };
}

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function round1(v)         { return Math.round(v * 10) / 10; }
