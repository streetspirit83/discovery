/**
 * Lädt TradingView Lightweight Charts (vendor/, 164 KB) erst bei Bedarf statt
 * blockierend im <head>. Ein Aufruf genügt, weitere bekommen dasselbe Promise.
 * Die App stösst das Laden nach der ersten Listen-Zeichnung im Leerlauf an, sodass
 * es beim ersten Detail-Sheet meist schon da ist.
 */
let p = null;
export function loadCharts() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  p ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/lightweight-charts-4.2.0.standalone.js', import.meta.url).href;
    s.async = true;
    s.onload = () => resolve(window.LightweightCharts ?? null);
    s.onerror = () => { p = null; resolve(null); };
    document.head.appendChild(s);
  });
  return p;
}
