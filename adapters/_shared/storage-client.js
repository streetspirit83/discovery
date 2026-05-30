/**
 * Storage Client (Node.js version)
 * Communicates with the Netlify backend storage function.
 */

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

export class StorageClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl  - e.g. "https://mysite.netlify.app"
   * @param {string} opts.secret   - shared secret for x-discovery-secret header
   */
  constructor({ baseUrl, secret }) {
    if (!baseUrl) throw new Error('StorageClient: baseUrl is required');
    if (!secret) throw new Error('StorageClient: secret is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.secret = secret;
  }

  /**
   * Internal POST helper.
   * @param {object} body
   * @returns {Promise<object>}
   */
  async #post(body) {
    const url = `${this.baseUrl}/api/storage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-discovery-secret': this.secret,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      throw new Error('StorageClient: authentication failed (invalid secret)');
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`StorageClient: unexpected response (${res.status}): ${text.slice(0, 200)}`);
    }

    if (!res.ok) {
      throw new Error(`StorageClient: request failed (${res.status}): ${data?.error ?? text}`);
    }

    return data;
  }

  /**
   * Read a blob from storage.
   * @param {'inbox'|'archive'|'export'} blobType
   * @returns {Promise<object>} blob document
   */
  async readBlob(blobType) {
    log('debug', 'storage: readBlob', { blobType });
    return this.#post({ op: 'read', blob_type: blobType });
  }

  /**
   * Write (overwrite) a blob.
   * @param {'inbox'|'archive'|'export'} blobType
   * @param {object} blob
   * @returns {Promise<object>}
   */
  async writeBlob(blobType, blob) {
    log('debug', 'storage: writeBlob', { blobType });
    return this.#post({ op: 'write', blob_type: blobType, blob });
  }

  /**
   * Append (or merge) a candidate into inbox.
   * Dedup logic is server-side.
   * @param {object} candidate
   * @returns {Promise<object>} { action: 'added'|'merged'|'skipped', id: string }
   */
  async appendCandidate(candidate) {
    log('debug', 'storage: appendCandidate', { symbol: candidate.symbol });
    return this.#post({ op: 'append_candidate', candidate });
  }

  async appendCandidates(candidates) {
    log('debug', 'storage: appendCandidates', { count: candidates.length });
    return this.#post({ op: 'append_candidates', candidates });
  }

  /**
   * Update a candidate in place (by id).
   * @param {'inbox'|'archive'|'export'} blobType
   * @param {string} candidateId
   * @param {object} updates  - partial candidate fields to merge
   * @returns {Promise<object>}
   */
  async updateCandidate(blobType, candidateId, updates) {
    log('debug', 'storage: updateCandidate', { blobType, candidateId });
    return this.#post({ op: 'update_candidate', blob_type: blobType, candidate_id: candidateId, updates });
  }

  /**
   * Move a candidate between blobs.
   * @param {string} candidateId
   * @param {'inbox'|'archive'|'export'} fromBlob
   * @param {'inbox'|'archive'|'export'} toBlob
   * @returns {Promise<object>}
   */
  async moveCandidate(candidateId, fromBlob, toBlob) {
    log('debug', 'storage: moveCandidate', { candidateId, fromBlob, toBlob });
    return this.#post({ op: 'move_candidate', candidate_id: candidateId, from_blob: fromBlob, to_blob: toBlob });
  }
}

/**
 * Create a StorageClient from environment variables.
 * @returns {StorageClient}
 */
export function createStorageClientFromEnv() {
  const baseUrl = process.env.DISCOVERY_BACKEND_URL;
  const secret = process.env.DISCOVERY_SECRET;
  if (!baseUrl) throw new Error('DISCOVERY_BACKEND_URL env var is not set');
  if (!secret) throw new Error('DISCOVERY_SECRET env var is not set');
  return new StorageClient({ baseUrl, secret });
}
