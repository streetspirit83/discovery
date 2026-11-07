/**
 * Storage Client (browser version)
 * Communicates with the Netlify backend storage function.
 */

const MAX_BATCH = 20;

export class StorageClient {
  constructor({ baseUrl, secret }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.secret = secret;
    this.writeSeq = 0;   // zählt Schreibvorgänge – app.js erkennt so, ob ein Hintergrund-Lesen schon veraltet ist
    this.pending = 0;    // laufende Schreibvorgänge
    this.#idleWaiters = [];
  }

  #idleWaiters;
  /** Wartet, bis kein Schreibvorgang mehr läuft. */
  writesSettled() {
    return this.pending === 0 ? Promise.resolve() : new Promise((r) => this.#idleWaiters.push(r));
  }

  async #post(body) {
    if (String(body.op ?? '').startsWith('read')) return this.#send(body);
    this.writeSeq++;
    this.pending++;
    try { return await this.#send(body); }
    finally {
      if (--this.pending === 0) { const w = this.#idleWaiters; this.#idleWaiters = []; w.forEach((r) => r()); }
    }
  }

  async #send(body) {
    const res = await fetch(`${this.baseUrl}/api/storage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-discovery-secret': this.secret,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new Error('Unauthorized – check your shared secret');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }

  async readBlob(blobType) {
    const result = await this.#post({ op: 'read', blob_type: blobType });
    return result.data;
  }

  /** Lesen mit Änderungsprüfung: mit `etag` kommt bei unverändertem Blob nur
   *  { unchanged: true } zurück (keine Daten). Ältere Backends ignorieren `etag`. */
  async readBlobIfChanged(blobType, etag = null) {
    const r = await this.#post({ op: 'read', blob_type: blobType, ...(etag ? { etag } : {}) });
    return { data: r.data ?? null, etag: r.etag ?? null, unchanged: !!r.unchanged };
  }

  async writeBlob(blobType, blob) {
    return this.#post({ op: 'write', blob_type: blobType, blob });
  }

  async appendCandidate(candidate) {
    return this.#post({ op: 'append_candidate', candidate });
  }

  /* update_candidate liest und schreibt den ganzen Blob ohne Sperre: zwei Aufrufe
     zugleich, und der zweite überschreibt den ersten. Deshalb läuft je Blob immer nur
     ein Schreibvorgang; was währenddessen auflief, geht danach gesammelt als Bulk raus. */
  #queues = new Map();

  #enqueue(blobType, ups) {
    return new Promise((resolve, reject) => {
      const q = this.#queues.get(blobType) ?? { items: [], running: false };
      this.#queues.set(blobType, q);
      q.items.push({ ups, resolve, reject });
      if (!q.running) this.#drain(blobType, q);
    });
  }

  updateCandidate(blobType, candidateId, updates) {
    return this.#enqueue(blobType, [{ candidate_id: candidateId, updates }]);
  }

  async #drain(blobType, q) {
    q.running = true;
    await Promise.resolve();              // alles aus demselben Tick zusammenfassen
    while (q.items.length) {
      const batch = q.items.splice(0, MAX_BATCH);
      const ups = batch.flatMap((b) => b.ups);
      try {
        const res = ups.length === 1
          ? await this.#post({ op: 'update_candidate', blob_type: blobType, candidate_id: ups[0].candidate_id, updates: ups[0].updates })
          : await this.#post({ op: 'bulk_update_candidates', blob_type: blobType, updates: ups });
        batch.forEach((b) => b.resolve(res));
      } catch (err) {
        batch.forEach((b) => b.reject(err));
      }
    }
    q.running = false;
  }

  async moveCandidate(candidateId, fromBlob, toBlob) {
    return this.#post({ op: 'move_candidate', candidate_id: candidateId, from_blob: fromBlob, to_blob: toBlob });
  }

  async bulkUpdateCandidates(blobType, updates) {
    return this.#enqueue(blobType, updates);
  }

  async deleteCandidate(blobType, candidateId) {
    return this.#post({ op: 'delete_candidate', blob_type: blobType, candidate_id: candidateId });
  }

  /** Bulk-Löschen: ein Backend-Roundtrip für alle IDs (statt N Einzel-Ops). */
  async deleteCandidates(blobType, candidateIds) {
    return this.#post({ op: 'delete_candidates', blob_type: blobType, candidate_ids: candidateIds });
  }

  /** Echtes Löschen aus der Inbox + Tombstone (Re-Add-Schutz ohne Archiv). */
  async deleteAndTombstone(blobType, candidateIds) {
    return this.#post({ op: 'delete_and_tombstone', blob_type: blobType, candidate_ids: candidateIds });
  }

  /** Bulk-Verschieben inkl. Dup-Merge im Ziel: ein Roundtrip für alle IDs. */
  async moveCandidates(candidateIds, fromBlob, toBlob) {
    return this.#post({ op: 'move_candidates', candidate_ids: candidateIds, from_blob: fromBlob, to_blob: toBlob });
  }

  /** Read the nightly LS snapshot history (10-day rolling, watch-bucket tickers).
   *  Shape: { history: { [candidateId]: { symbol, name, snapshots:[…] } }, updated_at } */
  async readLsHistory() {
    const result = await this.#post({ op: 'read_ls_history' });
    return result.data;
  }

  /** Read the server-side config blob (screener presets, synced across devices). */
  async readConfig() {
    const result = await this.#post({ op: 'read_config' });
    return result.data;
  }

  /** Overwrite the server-side config blob. `config` must contain a `presets` array. */
  async writeConfig(config) {
    return this.#post({ op: 'write_config', config });
  }
}

export function loadStorageClient() {
  const baseUrl = localStorage.getItem('discovery_backend_url');
  const secret = localStorage.getItem('discovery_secret');
  if (!baseUrl || !secret) return null;
  return new StorageClient({ baseUrl, secret });
}
