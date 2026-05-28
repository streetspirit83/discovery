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
};

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
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return respond(204, {});
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

  const store = getStore('discovery-data');

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
    if (!candidate.symbol || !candidate.exchange) {
      return respond(400, { ok: false, error: 'candidate.symbol and candidate.exchange are required' });
    }

    const sym = candidate.symbol.toUpperCase();
    const exch = candidate.exchange.toUpperCase();

    // Check archive and export first – no resurrection
    for (const bt of ['archive', 'export']) {
      const doc = await readBlobDoc(store, bt);
      const found = doc.candidates.find(
        (c) => c.symbol.toUpperCase() === sym && c.exchange.toUpperCase() === exch,
      );
      if (found) {
        log('info', 'storage: append_candidate skipped (in archive/export)', { sym, exch, bt });
        return respond(200, { ok: true, action: 'skipped', id: found.id });
      }
    }

    // Check inbox for merge
    const inbox = await readBlobDoc(store, 'inbox');
    const existing = inbox.candidates.find(
      (c) => c.symbol.toUpperCase() === sym && c.exchange.toUpperCase() === exch,
    );

    if (existing) {
      // Merge sources
      const newSources = candidate.sources ?? [];
      existing.sources.push(...newSources);
      existing.last_updated_at = new Date().toISOString();
      await writeBlobDoc(store, 'inbox', inbox);
      log('info', 'storage: append_candidate merged', { sym, exch, id: existing.id });
      return respond(200, { ok: true, action: 'merged', id: existing.id });
    }

    // New candidate
    inbox.candidates.push(candidate);
    await writeBlobDoc(store, 'inbox', inbox);
    log('info', 'storage: append_candidate added', { sym, exch, id: candidate.id });
    return respond(200, { ok: true, action: 'added', id: candidate.id });
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
    toDoc.candidates.push(candidate);

    await writeBlobDoc(store, fromBlob, fromDoc);
    await writeBlobDoc(store, toBlob, toDoc);

    log('info', 'storage: move_candidate', { candidateId, fromBlob, toBlob });
    return respond(200, { ok: true, id: candidateId });
  }

  return respond(400, { ok: false, error: `Unknown op: ${op}` });
}
