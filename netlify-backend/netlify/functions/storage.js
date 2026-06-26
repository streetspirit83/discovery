/**
 * Netlify Function: storage
 * POST /api/storage – CRUD for discovery blobs
 *
 * All ops require header x-discovery-secret matching env DISCOVERY_SECRET.
 */

import { getStore } from '@netlify/blobs';

const BLOB_NAMES = {
  inbox: 'discovery-inbox',
  archive: 'discovery-archive',
  export: 'discovery-export',
  watch: 'discovery-watch',
};

// Server-side config blob (screener presets etc.) – synced across devices.
const CONFIG_KEY = 'discovery-config';
function emptyConfig() {
  return {
    schema_version: 'discovery-config-1.0',
    updated_at: new Date().toISOString(),
    presets: [],
    alerts_muted: false,
  };
}

function log(level, msg, data = {}) {
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );
}

function emptyBlob(blobType) {
  return {
    schema_version: 'discovery-1.0',
    blob_type: blobType,
    updated_at: new Date().toISOString(),
    candidates: [],
  };
}

function respond(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-discovery-secret',
    },
  });
}

async function readBlobDoc(store, blobType) {
  try {
    const data = await store.get(BLOB_NAMES[blobType], { type: 'json' });
    return data ?? emptyBlob(blobType);
  } catch {
    return emptyBlob(blobType);
  }
}

async function writeBlobDoc(store, blobType, doc) {
  doc.updated_at = new Date().toISOString();
  await store.setJSON(BLOB_NAMES[blobType], doc);
}

export default async function handler(req) {
  // CORS preflight – return 200 + null body (204 with body is invalid HTTP)
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-discovery-secret',
      },
    });
  }

  if (req.method !== 'POST') {
    return respond(405, { ok: false, error: 'Method not allowed' });
  }

  // Auth
  const secret = req.headers.get('x-discovery-secret');
  if (!secret || secret !== process.env.DISCOVERY_SECRET) {
    log('warn', 'storage: unauthorized request');
    return respond(401, { ok: false, error: 'Unauthorized' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return respond(400, { ok: false, error: 'Invalid JSON body' });
  }

  const { op, blob_type: blobType } = body;

  if (!op) {
    return respond(400, { ok: false, error: 'Missing op' });
  }

  const store = getStore({ name: 'discovery-data', consistency: 'strong' });

  // --- op: read_config ---
  if (op === 'read_config') {
    log('info', 'storage: read_config');
    let doc;
    try {
      doc = await store.get(CONFIG_KEY, { type: 'json' });
    } catch {
      doc = null;
    }
    return respond(200, { ok: true, data: doc ?? emptyConfig() });
  }

  // --- op: write_config ---
  if (op === 'write_config') {
    const { config } = body;
    if (!config || typeof config !== 'object') {
      return respond(400, { ok: false, error: 'Missing config' });
    }
    // Merge with existing so a partial write (e.g. only alerts_muted from the
    // Alert-Overview) doesn't clobber presets, and vice-versa.
    let existing;
    try { existing = await store.get(CONFIG_KEY, { type: 'json' }); } catch { existing = null; }
    existing = existing ?? emptyConfig();
    const doc = {
      schema_version: 'discovery-config-1.0',
      presets: Array.isArray(config.presets) ? config.presets : (existing.presets ?? []),
      alerts_muted: typeof config.alerts_muted === 'boolean' ? config.alerts_muted : (existing.alerts_muted ?? false),
      updated_at: new Date().toISOString(),
    };
    await store.setJSON(CONFIG_KEY, doc);
    log('info', 'storage: write_config', { presets: doc.presets.length, alerts_muted: doc.alerts_muted });
    return respond(200, { ok: true });
  }

  // --- op: read ---
  if (op === 'read') {
    if (!blobType || !BLOB_NAMES[blobType]) {
      return respond(400, { ok: false, error: `Unknown blob_type: ${blobType}` });
    }
    log('info', 'storage: read', { blobType });
    const doc = await readBlobDoc(store, blobType);
    return respond(200, { ok: true, data: doc });
  }

  // --- op: write ---
  if (op === 'write') {
    if (!blobType || !BLOB_NAMES[blobType]) {
      return respond(400, { ok: false, error: `Unknown blob_type: ${blobType}` });
    }
    const { blob } = body;
    if (!blob) return respond(400, { ok: false, error: 'Missing blob' });
    log('info', 'storage: write', { blobType });
    await writeBlobDoc(store, blobType, blob);
    return respond(200, { ok: true });
  }

  // --- op: append_candidate ---
  if (op === 'append_candidate') {
    const { candidate } = body;
    if (!candidate) return respond(400, { ok: false, error: 'Missing candidate' });
    if (!candidate.symbol) {
      return respond(400, { ok: false, error: 'candidate.symbol is required' });
    }

    const sym = candidate.symbol.toUpperCase();
    const exch = (candidate.exchange || 'UNKNOWN').toUpperCase();
    candidate.exchange = exch; // normalise before writing

    // Inbox is a raw capture: always add, never merge or skip on import.
    // Dedup/merge happens only when a candidate is moved to archive/watch/export.
    const inbox = await readBlobDoc(store, 'inbox');
    inbox.candidates.push(candidate);
    await writeBlobDoc(store, 'inbox', inbox);
    log('info', 'storage: append_candidate added', { sym, exch, id: candidate.id });
    return respond(200, { ok: true, action: 'added', id: candidate.id });
  }

  // --- op: append_candidates (bulk, atomic single write) ---
  if (op === 'append_candidates') {
    const { candidates } = body;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return respond(400, { ok: false, error: 'Missing or empty candidates array' });
    }

    // Bulk path is used by the scheduled adapters (run daily). It keeps
    // dedup + tombstone-skip so repeated daily runs don't pile up duplicates
    // or resurrect dismissed values. The manual UI import uses the singular
    // append_candidate op, which always adds.
    const [archiveDoc, exportDoc, watchDoc, inbox] = await Promise.all([
      readBlobDoc(store, 'archive'),
      readBlobDoc(store, 'export'),
      readBlobDoc(store, 'watch'),
      readBlobDoc(store, 'inbox'),
    ]);

    const archiveKeys = new Set(archiveDoc.candidates.map((c) => `${c.symbol.toUpperCase()}:${c.exchange.toUpperCase()}`));
    const exportKeys  = new Set([
      ...exportDoc.candidates.map((c) => `${c.symbol.toUpperCase()}:${c.exchange.toUpperCase()}`),
      ...watchDoc.candidates.map((c)  => `${c.symbol.toUpperCase()}:${c.exchange.toUpperCase()}`),
    ]);
    const inboxMap    = new Map(inbox.candidates.map((c) => [`${c.symbol.toUpperCase()}:${c.exchange.toUpperCase()}`, c]));

    const now = new Date().toISOString();
    const results = [];

    for (const candidate of candidates) {
      if (!candidate.symbol) {
        results.push({ action: 'error', error: 'Missing symbol' });
        continue;
      }
      const sym  = candidate.symbol.toUpperCase();
      const exch = (candidate.exchange || 'UNKNOWN').toUpperCase();
      candidate.exchange = exch; // normalise before writing
      const key  = `${sym}:${exch}`;

      if (archiveKeys.has(key) || exportKeys.has(key)) {
        log('info', 'storage: bulk skipped (tombstoned)', { sym, exch });
        results.push({ action: 'skipped' });
        continue;
      }

      const existing = inboxMap.get(key);
      if (existing) {
        existing.sources.push(...(candidate.sources ?? []));
        existing.last_updated_at = now;
        log('info', 'storage: bulk merged', { sym, exch, id: existing.id });
        results.push({ action: 'merged', id: existing.id });
      } else {
        inbox.candidates.push(candidate);
        inboxMap.set(key, candidate);
        log('info', 'storage: bulk added', { sym, exch, id: candidate.id });
        results.push({ action: 'added', id: candidate.id });
      }
    }

    await writeBlobDoc(store, 'inbox', inbox);
    log('info', 'storage: append_candidates done', {
      total: candidates.length,
      added:   results.filter((r) => r.action === 'added').length,
      merged:  results.filter((r) => r.action === 'merged').length,
      skipped: results.filter((r) => r.action === 'skipped').length,
    });
    return respond(200, { ok: true, results });
  }

  // --- op: bulk_update_candidates (atomic single read-modify-write) ---
  if (op === 'bulk_update_candidates') {
    if (!blobType || !BLOB_NAMES[blobType]) {
      return respond(400, { ok: false, error: `Unknown blob_type: ${blobType}` });
    }
    const { updates } = body; // [{ candidate_id, updates }]
    if (!Array.isArray(updates) || updates.length === 0) {
      return respond(400, { ok: false, error: 'Missing or empty updates array' });
    }

    const doc = await readBlobDoc(store, blobType);
    const idxMap = new Map(doc.candidates.map((c, i) => [c.id, i]));
    const now = new Date().toISOString();
    let updated = 0;

    for (const { candidate_id: candidateId, updates: candidateUpdates } of updates) {
      const idx = idxMap.get(candidateId);
      if (idx === undefined) continue;
      doc.candidates[idx] = {
        ...doc.candidates[idx],
        ...candidateUpdates,
        id: doc.candidates[idx].id,
        last_updated_at: now,
      };
      updated++;
    }

    await writeBlobDoc(store, blobType, doc);
    log('info', 'storage: bulk_update_candidates', { blobType, updated });
    return respond(200, { ok: true, updated });
  }

  // --- op: update_candidate ---
  if (op === 'update_candidate') {
    if (!blobType || !BLOB_NAMES[blobType]) {
      return respond(400, { ok: false, error: `Unknown blob_type: ${blobType}` });
    }
    const { candidate_id: candidateId, updates } = body;
    if (!candidateId) return respond(400, { ok: false, error: 'Missing candidate_id' });
    if (!updates) return respond(400, { ok: false, error: 'Missing updates' });

    const doc = await readBlobDoc(store, blobType);
    const idx = doc.candidates.findIndex((c) => c.id === candidateId);
    if (idx === -1) {
      return respond(404, { ok: false, error: `Candidate ${candidateId} not found in ${blobType}` });
    }

    doc.candidates[idx] = {
      ...doc.candidates[idx],
      ...updates,
      id: doc.candidates[idx].id, // never overwrite id
      last_updated_at: new Date().toISOString(),
    };
    await writeBlobDoc(store, blobType, doc);
    log('info', 'storage: update_candidate', { blobType, candidateId });
    return respond(200, { ok: true, id: candidateId });
  }

  // --- op: delete_candidate ---
  if (op === 'delete_candidate') {
    if (!blobType || !BLOB_NAMES[blobType]) {
      return respond(400, { ok: false, error: `Unknown blob_type: ${blobType}` });
    }
    const { candidate_id: candidateId } = body;
    if (!candidateId) return respond(400, { ok: false, error: 'Missing candidate_id' });

    const doc = await readBlobDoc(store, blobType);
    const idx = doc.candidates.findIndex((c) => c.id === candidateId);
    if (idx === -1) {
      return respond(404, { ok: false, error: `Candidate ${candidateId} not found in ${blobType}` });
    }

    doc.candidates.splice(idx, 1);
    await writeBlobDoc(store, blobType, doc);
    log('info', 'storage: delete_candidate', { blobType, candidateId });
    return respond(200, { ok: true, id: candidateId });
  }

  // --- op: move_candidate ---
  if (op === 'move_candidate') {
    const { candidate_id: candidateId, from_blob: fromBlob, to_blob: toBlob } = body;
    if (!candidateId) return respond(400, { ok: false, error: 'Missing candidate_id' });
    if (!fromBlob || !BLOB_NAMES[fromBlob]) return respond(400, { ok: false, error: `Unknown from_blob: ${fromBlob}` });
    if (!toBlob || !BLOB_NAMES[toBlob]) return respond(400, { ok: false, error: `Unknown to_blob: ${toBlob}` });

    const fromDoc = await readBlobDoc(store, fromBlob);
    const idx = fromDoc.candidates.findIndex((c) => c.id === candidateId);
    if (idx === -1) {
      return respond(404, { ok: false, error: `Candidate ${candidateId} not found in ${fromBlob}` });
    }

    const [candidate] = fromDoc.candidates.splice(idx, 1);
    candidate.last_updated_at = new Date().toISOString();

    const toDoc = await readBlobDoc(store, toBlob);
    const dupIdx = toDoc.candidates.findIndex(
      (c) => c.symbol.toUpperCase() === candidate.symbol.toUpperCase() &&
             c.exchange.toUpperCase() === candidate.exchange.toUpperCase(),
    );
    if (dupIdx !== -1) {
      // Already in target – merge sources, don't duplicate
      toDoc.candidates[dupIdx].sources.push(...(candidate.sources ?? []));
      toDoc.candidates[dupIdx].last_updated_at = candidate.last_updated_at;
    } else {
      toDoc.candidates.push(candidate);
    }

    await writeBlobDoc(store, fromBlob, fromDoc);
    await writeBlobDoc(store, toBlob, toDoc);

    log('info', 'storage: move_candidate', { candidateId, fromBlob, toBlob });
    return respond(200, { ok: true, id: candidateId });
  }

  return respond(400, { ok: false, error: `Unknown op: ${op}` });
}
