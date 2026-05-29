/**
 * Storage Client (browser version)
 * Communicates with the Netlify backend storage function.
 */

export class StorageClient {
  constructor({ baseUrl, secret }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.secret = secret;
  }

  async #post(body) {
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

  async writeBlob(blobType, blob) {
    return this.#post({ op: 'write', blob_type: blobType, blob });
  }

  async appendCandidate(candidate) {
    return this.#post({ op: 'append_candidate', candidate });
  }

  async updateCandidate(blobType, candidateId, updates) {
    return this.#post({ op: 'update_candidate', blob_type: blobType, candidate_id: candidateId, updates });
  }

  async moveCandidate(candidateId, fromBlob, toBlob) {
    return this.#post({ op: 'move_candidate', candidate_id: candidateId, from_blob: fromBlob, to_blob: toBlob });
  }

  async deleteCandidate(blobType, candidateId) {
    return this.#post({ op: 'delete_candidate', blob_type: blobType, candidate_id: candidateId });
  }
}

export function loadStorageClient() {
  const baseUrl = localStorage.getItem('discovery_backend_url');
  const secret = localStorage.getItem('discovery_secret');
  if (!baseUrl || !secret) return null;
  return new StorageClient({ baseUrl, secret });
}
