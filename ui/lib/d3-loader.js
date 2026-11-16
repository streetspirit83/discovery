/**
 * Lädt d3-hierarchy (vendor/, 15 KB, ISC) erst bei Bedarf – für die Treemap im
 * Monitor-Dashboard. Ein Aufruf genügt, weitere bekommen dasselbe Promise.
 * Schlägt das Laden fehl, liefert es `null`; das Dashboard zeichnet dann ein
 * einfaches Raster statt der Treemap.
 */
let p = null;
export function loadD3() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.d3?.treemap) return Promise.resolve(window.d3);
  p ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/d3-hierarchy-3.1.2.min.js', import.meta.url).href;
    s.async = true;
    s.onload = () => resolve(window.d3?.treemap ? window.d3 : null);
    s.onerror = () => { p = null; resolve(null); };
    document.head.appendChild(s);
  });
  return p;
}
