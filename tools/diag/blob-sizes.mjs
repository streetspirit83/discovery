/**
 * Diagnose: Grösse, Ladezeit und Kompression je Blob plus Anteil der Felder an den
 * Kandidaten-Blobs. Schreibt nichts. Läuft über .github/workflows/diag-blob-sizes.yml.
 */
const backendUrl = process.env.DISCOVERY_BACKEND_URL, secret = process.env.DISCOVERY_SECRET;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

async function read(body) {
  const t0 = performance.now();
  const res = await fetch(`${backendUrl}/api/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret, 'Accept-Encoding': 'gzip, br' },
    body: JSON.stringify(body),
  });
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const total = performance.now() - t0;
  return { text, ttfb, total, enc: res.headers.get('content-encoding') ?? 'keine', len: res.headers.get('content-length') };
}

const blobs = ['inbox', 'archive', 'export', 'watch', 'analyst', 'market', 'monitor'];
for (const b of blobs) {
  try {
    const r = await read({ op: 'read', blob_type: b });
    const j = JSON.parse(r.text);
    const cands = j?.data?.candidates;
    console.log(`${b.padEnd(8)} ${kb(r.text.length).padStart(8)} · ${cands ? `${cands.length} Titel · ` : ''}Server ${r.ttfb.toFixed(0)} ms · gesamt ${r.total.toFixed(0)} ms · Kompression ${r.enc}${r.len ? ` (${kb(+r.len)} übertragen)` : ''}`);
    if (cands?.length) {
      const share = {};
      for (const c of cands) for (const [k, v] of Object.entries(c)) share[k] = (share[k] ?? 0) + JSON.stringify(v ?? null).length;
      const sum = Object.values(share).reduce((a, v) => a + v, 0);
      const top = Object.entries(share).sort((a, b) => b[1] - a[1]).slice(0, 12);
      console.log('   ' + top.map(([k, v]) => `${k} ${kb(v)} (${Math.round((v / sum) * 100)} %)`).join(' · '));
      const sub = {};
      for (const c of cands) for (const [k, v] of Object.entries(c.swing_analysis ?? {})) sub[k] = (sub[k] ?? 0) + JSON.stringify(v ?? null).length;
      if (Object.keys(sub).length) console.log('   swing_analysis: ' + Object.entries(sub).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${kb(v)}`).join(' · '));
    }
    if (b === 'market') console.log('   ' + Object.entries((j.data?.briefings ?? []).reduce((m, x) => ((m[x.kind ?? 'daily'] = (m[x.kind ?? 'daily'] ?? 0) + JSON.stringify(x).length), m), {})).map(([k, v]) => `${k} ${kb(v)}`).join(' · '));
  } catch (e) { console.log(`${b}: Fehler ${e.message}`); }
}
try {
  const r = await read({ op: 'read_ls_history' });
  console.log(`ls_history ${kb(r.text.length)} · gesamt ${r.total.toFixed(0)} ms · Kompression ${r.enc}`);
} catch (e) { console.log(`ls_history: Fehler ${e.message}`); }
