/**
 * Kontroll-Modal – kriterienbasierte Multi-Selektion für Bulk-Aktionen.
 *
 * Öffnet sich über den Button in der Subbar. Kriterien auf den AKTIVEN Bucket:
 * - Overall-Score als Dual-Range-Slider (min–max) + „auch ohne Score"
 * - Sektoren, Financial Stability (Health-Label), Größenklassen (MCap),
 *   Dividendenhöhe, Wachstum 6M (perf_6m) je als Multi-Select-Dropdown
 *   (dieselbe filterMultiSelect-Komponente wie in der Filterbar)
 *
 * Live-Trefferzähler; „Auswählen" setzt die Tabellen-Selektion auf die
 * Treffer → die Bulk-Bar mit allen Aktionen (Löschen/Export/…) erscheint.
 */

import { icons } from '../lib/icons.js?v=20260803c';
import { filterMultiSelect } from './filter-multiselect.js?v=20260803c';
import { liveOverallScore, liveHealthScore, capSizeFromMC, volRatioPct } from './candidate-list.js?v=20260803c';
import { monthlyGrowthRate } from '../lib/tv-upside.js';
import { MEGA_CLUSTERS, megaClusterOf } from '../lib/sector-clusters.js?v=20260719b';

const DIV_BUCKETS = [
  { value: 'none',  label: 'Keine Dividende' },
  { value: 'lt2',   label: 'bis 2 %' },
  { value: '2to4',  label: '2–4 %' },
  { value: 'gt4',   label: 'über 4 %' },
];
const GROWTH_BUCKETS = [
  { value: 'neg',    label: 'negativ' },
  { value: '0to10',  label: '0–10 %' },
  { value: '10to30', label: '10–30 %' },
  { value: 'gt30',   label: 'über 30 %' },
];
// Δ1W / Δ1M – kurzfristige Kursveränderung (kann negativ sein).
const CHG_BUCKETS = [
  { value: 'neg',    label: 'negativ' },
  { value: '0to5',   label: '0–5 %' },
  { value: '5to15',  label: '5–15 %' },
  { value: 'gt15',   label: 'über 15 %' },
];
// ØGr/M – Ø monatliche Wachstumsrate (geometrisch aus Perf.6M).
const OGRM_BUCKETS = [
  { value: 'neg',   label: 'negativ' },
  { value: '0to3',  label: '0–3 %' },
  { value: '3to8',  label: '3–8 %' },
  { value: 'gt8',   label: 'über 8 %' },
];
// V/Ø10d / V/Ø30d – aktuelles Volumen ÷ Ø-Volumen in % (Volumen-Impuls).
const VOLR_BUCKETS = [
  { value: 'lt50',     label: '< 50 %' },
  { value: '50to100',  label: '50–100 %' },
  { value: '100to150', label: '100–150 %' },
  { value: 'gt150',    label: '≥ 150 % (Spike)' },
];
const HEALTH_OPTIONS = [
  { value: 'STRONG', label: 'Safe Allocation (≥75)' },
  { value: 'SOUND',  label: 'Solide (55–74)' },
  { value: 'MIXED',  label: 'Gemischt (35–54)' },
  { value: 'WEAK',   label: 'Fragil (<35)' },
];
const CAP_OPTIONS = [
  { value: 'micro', label: 'Micro (<300M)' },
  { value: 'small', label: 'Small (300M–2B)' },
  { value: 'mid',   label: 'Mid (2–50B)' },
  { value: 'large', label: 'Large (>50B)' },
];

const divBucket = (d) => (d == null || d <= 0 ? 'none' : d < 2 ? 'lt2' : d <= 4 ? '2to4' : 'gt4');
const growthBucket = (g) => (g < 0 ? 'neg' : g < 10 ? '0to10' : g < 30 ? '10to30' : 'gt30');
const chgBucket = (v) => (v < 0 ? 'neg' : v < 5 ? '0to5' : v < 15 ? '5to15' : 'gt15');
const ogrmBucket = (v) => (v < 0 ? 'neg' : v < 3 ? '0to3' : v < 8 ? '3to8' : 'gt8');
const volrBucket = (v) => (v < 50 ? 'lt50' : v < 100 ? '50to100' : v < 150 ? '100to150' : 'gt150');

/** Prüft einen Kandidaten gegen die eingestellten Kriterien (AND über alle). */
export function matchesCriteria(c, crit) {
  const tv = c.tv_data;
  const score = liveOverallScore(tv)?.total ?? null;
  if (score == null) {
    if (!crit.includeNoScore) return false;
  } else if (score < crit.scoreMin || score > crit.scoreMax) {
    return false;
  }
  if (crit.mega.length && !crit.mega.includes(megaClusterOf(c.sector))) return false;
  if (crit.sectors.length && !crit.sectors.includes(c.sector)) return false;
  if (crit.health.length) {
    const lc = liveHealthScore(tv)?.labelCode ?? null;
    if (!lc || !crit.health.includes(lc)) return false;
  }
  if (crit.caps.length && !crit.caps.includes(capSizeFromMC(tv?.market_cap))) return false;
  if (crit.div.length && !crit.div.includes(divBucket(tv?.dividend_yield))) return false;
  if (crit.growth.length) {
    const g = tv?.perf_6m;
    if (g == null || !crit.growth.includes(growthBucket(g))) return false;
  }
  if (crit.chg1w.length) {
    const v = tv?.change_1w;
    if (v == null || !crit.chg1w.includes(chgBucket(v))) return false;
  }
  if (crit.chg1m.length) {
    const v = tv?.change_1m;
    if (v == null || !crit.chg1m.includes(chgBucket(v))) return false;
  }
  if (crit.ogrm.length) {
    const v = monthlyGrowthRate(tv?.perf_6m, 6);
    if (v == null || !crit.ogrm.includes(ogrmBucket(v))) return false;
  }
  if (crit.vol10d.length) {
    const v = volRatioPct(c, 10);
    if (v == null || !crit.vol10d.includes(volrBucket(v))) return false;
  }
  if (crit.vol30d.length) {
    const v = volRatioPct(c, 30);
    if (v == null || !crit.vol30d.includes(volrBucket(v))) return false;
  }
  return true;
}

const defaultCriteria = () => ({
  scoreMin: 0, scoreMax: 100, includeNoScore: true,
  sectors: [], mega: [], health: [], caps: [], div: [], growth: [],
  chg1w: [], chg1m: [], ogrm: [], vol10d: [], vol30d: [],
});

/**
 * @param {{ candidates: Array, bucket: string, onApply: (ids: string[]) => void }} opts
 */
export function renderControlModal({ candidates = [], bucket = '', onApply } = {}) {
  if (document.getElementById('control-modal-overlay')) return;
  const crit = defaultCriteria();
  const sectors = [...new Set(candidates.map((c) => c.sector).filter(Boolean))].sort();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'control-modal-overlay';
  overlay.innerHTML = `
    <div class="modal control-modal" role="dialog" aria-modal="true" aria-label="Kontroll-Center">
      <div class="modal-header">
        <h2>${icons.sliders} Kontrolle <span class="ctl-bucket">${bucket}</span></h2>
        <button class="icon-btn" id="ctl-close" aria-label="Schließen">${icons.xMark}</button>
      </div>
      <div class="modal-body">
        <div class="ctl-row">
          <span class="ctl-label">Score</span>
          <div class="ctl-range" id="ctl-range">
            <div class="ctl-range__track"></div>
            <div class="ctl-range__fill" id="ctl-range-fill"></div>
            <input type="range" id="ctl-score-min" min="0" max="100" step="5" value="0" aria-label="Score Minimum">
            <input type="range" id="ctl-score-max" min="0" max="100" step="5" value="100" aria-label="Score Maximum">
          </div>
          <span class="ctl-range__val" id="ctl-score-val">0–100</span>
        </div>
        <label class="ctl-noscore">
          <input type="checkbox" id="ctl-noscore" checked> Kandidaten ohne Score einbeziehen
        </label>
        <div class="ctl-drops" id="ctl-drops"></div>
        <div class="ctl-hits" id="ctl-hits"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="ctl-reset">Zurücksetzen</button>
        <button class="btn btn-primary" id="ctl-apply"></button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = (id) => overlay.querySelector(`#${id}`);
  const minEl = $('ctl-score-min');
  const maxEl = $('ctl-score-max');

  const matched = () => candidates.filter((c) => matchesCriteria(c, crit));

  const renderHits = () => {
    const n = matched().length;
    $('ctl-hits').innerHTML = `<b>${n}</b> von ${candidates.length} Kandidaten matchen die Kriterien`;
    const apply = $('ctl-apply');
    apply.textContent = n ? `${n} auswählen` : 'Auswählen';
    apply.disabled = !n;
  };

  const renderRange = () => {
    $('ctl-score-val').textContent = `${crit.scoreMin}–${crit.scoreMax}`;
    const fill = $('ctl-range-fill');
    fill.style.left = `${crit.scoreMin}%`;
    fill.style.width = `${crit.scoreMax - crit.scoreMin}%`;
  };

  // Dual-Slider: Min darf Max nicht überholen (und umgekehrt).
  minEl.addEventListener('input', () => {
    crit.scoreMin = Math.min(+minEl.value, crit.scoreMax);
    minEl.value = crit.scoreMin;
    renderRange(); renderHits();
  });
  maxEl.addEventListener('input', () => {
    crit.scoreMax = Math.max(+maxEl.value, crit.scoreMin);
    maxEl.value = crit.scoreMax;
    renderRange(); renderHits();
  });
  $('ctl-noscore').addEventListener('change', (e) => { crit.includeNoScore = e.target.checked; renderHits(); });

  // Multi-Select-Dropdowns (Filterbar-Komponente wiederverwendet).
  const buildDrops = () => {
    const host = $('ctl-drops');
    host.innerHTML = '';
    const mk = (cfg) => host.appendChild(filterMultiSelect(cfg));
    mk({ id: 'ctl-mega', label: 'Mega', title: 'Nach Mega-Cluster filtern (5 Sektor-Gruppen, Mehrfachauswahl)',
      options: MEGA_CLUSTERS.map((m) => ({ value: m.key, label: m.label })), selected: crit.mega,
      onChange: (v) => { crit.mega = v; renderHits(); } });
    mk({ id: 'ctl-sectors', label: 'Sektoren', title: 'Nach Sektor filtern (Mehrfachauswahl)',
      options: sectors.map((s) => ({ value: s, label: s })), selected: crit.sectors,
      onChange: (v) => { crit.sectors = v; renderHits(); } });
    mk({ id: 'ctl-health', label: 'Health', title: 'Financial Stability (Health-Label, Mehrfachauswahl)',
      options: HEALTH_OPTIONS, selected: crit.health,
      onChange: (v) => { crit.health = v; renderHits(); } });
    mk({ id: 'ctl-caps', label: 'Größe', title: 'Größenklasse nach Marktkapitalisierung (Mehrfachauswahl)',
      options: CAP_OPTIONS, selected: crit.caps,
      onChange: (v) => { crit.caps = v; renderHits(); } });
    mk({ id: 'ctl-div', label: 'Dividende', title: 'Dividendenrendite (Mehrfachauswahl)',
      options: DIV_BUCKETS, selected: crit.div,
      onChange: (v) => { crit.div = v; renderHits(); } });
    mk({ id: 'ctl-growth', label: 'Wachstum 6M', title: 'Kursentwicklung der letzten 6 Monate (perf_6m, Mehrfachauswahl)',
      options: GROWTH_BUCKETS, selected: crit.growth,
      onChange: (v) => { crit.growth = v; renderHits(); } });
    mk({ id: 'ctl-chg1w', label: 'Δ1W', title: 'Veränderung 1 Woche (Mehrfachauswahl)',
      options: CHG_BUCKETS, selected: crit.chg1w,
      onChange: (v) => { crit.chg1w = v; renderHits(); } });
    mk({ id: 'ctl-chg1m', label: 'Δ1M', title: 'Veränderung 1 Monat (Mehrfachauswahl)',
      options: CHG_BUCKETS, selected: crit.chg1m,
      onChange: (v) => { crit.chg1m = v; renderHits(); } });
    mk({ id: 'ctl-ogrm', label: 'ØGr/M', title: 'Ø monatliche Growth Rate der letzten 6 Monate (Mehrfachauswahl)',
      options: OGRM_BUCKETS, selected: crit.ogrm,
      onChange: (v) => { crit.ogrm = v; renderHits(); } });
    mk({ id: 'ctl-vol10d', label: 'V/Ø10d', title: 'Aktuelles Volumen ÷ Ø10d in % — Volumen-Impuls (Mehrfachauswahl)',
      options: VOLR_BUCKETS, selected: crit.vol10d,
      onChange: (v) => { crit.vol10d = v; renderHits(); } });
    mk({ id: 'ctl-vol30d', label: 'V/Ø30d', title: 'Aktuelles Volumen ÷ Ø30d in % — Volumen-Impuls (Mehrfachauswahl)',
      options: VOLR_BUCKETS, selected: crit.vol30d,
      onChange: (v) => { crit.vol30d = v; renderHits(); } });
  };
  buildDrops();

  $('ctl-reset').addEventListener('pointerup', () => {
    Object.assign(crit, defaultCriteria());
    minEl.value = 0; maxEl.value = 100;
    $('ctl-noscore').checked = true;
    buildDrops(); renderRange(); renderHits();
  });

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  // Escape: erst das offene Multi-Select-Popover schließen (macht dessen
  // eigener Listener), das Modal nur schließen, wenn keins offen ist.
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.fms-pop')) close(); };
  document.addEventListener('keydown', onKey);
  $('ctl-close').addEventListener('pointerup', close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });

  $('ctl-apply').addEventListener('pointerup', () => {
    const ids = matched().map((c) => c.id);
    if (!ids.length) return;
    close();
    onApply?.(ids);
  });

  renderRange();
  renderHits();
}
