/**
 * Schema Validator for Discovery Workspace blobs and candidates.
 */

const REQUIRED_CANDIDATE_FIELDS = [
  'id',
  'symbol',
  'exchange',
  'yahoo_symbol',
  'name',
  'sources',
  'links',
  'workspace_state',
  'first_discovered_at',
  'last_updated_at',
];

const VALID_WORKSPACE_STATES = ['new', 'reviewed', 'promoted', 'dismissed'];

const VALID_BLOB_TYPES = ['inbox', 'archive', 'export'];

/**
 * Validate a single candidate object.
 * @param {unknown} candidate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCandidate(candidate) {
  const errors = [];

  if (!candidate || typeof candidate !== 'object') {
    return { valid: false, errors: ['candidate must be an object'] };
  }

  // Required fields
  for (const field of REQUIRED_CANDIDATE_FIELDS) {
    if (candidate[field] === undefined || candidate[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // ID must be UUID v4 format
  if (candidate.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.id)) {
    errors.push(`id must be a valid UUID v4, got: ${candidate.id}`);
  }

  // Workspace state
  if (candidate.workspace_state && !VALID_WORKSPACE_STATES.includes(candidate.workspace_state)) {
    errors.push(
      `workspace_state must be one of ${VALID_WORKSPACE_STATES.join(', ')}, got: ${candidate.workspace_state}`,
    );
  }

  // Sources must be array
  if (candidate.sources !== undefined && !Array.isArray(candidate.sources)) {
    errors.push('sources must be an array');
  }

  // Links must be object with at least tradingview, stocktwits, yahoo
  if (candidate.links && typeof candidate.links === 'object') {
    for (const key of ['tradingview', 'stocktwits', 'yahoo']) {
      if (!candidate.links[key]) {
        errors.push(`links.${key} is missing`);
      }
    }
  }

  // Timestamp format
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
  for (const field of ['first_discovered_at', 'last_updated_at']) {
    if (candidate[field] && !ISO_RE.test(candidate[field])) {
      errors.push(`${field} must be ISO 8601 UTC (e.g. 2026-05-27T08:00:00Z)`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a blob (top-level storage document).
 * @param {unknown} blob
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateBlob(blob) {
  const errors = [];

  if (!blob || typeof blob !== 'object') {
    return { valid: false, errors: ['blob must be an object'] };
  }

  if (blob.schema_version !== 'discovery-1.0') {
    errors.push(`schema_version must be "discovery-1.0", got: ${blob.schema_version}`);
  }

  if (!VALID_BLOB_TYPES.includes(blob.blob_type)) {
    errors.push(
      `blob_type must be one of ${VALID_BLOB_TYPES.join(', ')}, got: ${blob.blob_type}`,
    );
  }

  if (!blob.updated_at) {
    errors.push('updated_at is required');
  }

  if (!Array.isArray(blob.candidates)) {
    errors.push('candidates must be an array');
  } else {
    blob.candidates.forEach((c, i) => {
      const result = validateCandidate(c);
      if (!result.valid) {
        result.errors.forEach((e) => errors.push(`candidates[${i}]: ${e}`));
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a source entry within a candidate.
 * @param {unknown} source
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSource(source) {
  const errors = [];

  if (!source || typeof source !== 'object') {
    return { valid: false, errors: ['source must be an object'] };
  }

  for (const field of ['adapter', 'source_url', 'discovered_at', 'signal_type']) {
    if (!source[field]) {
      errors.push(`Missing source field: ${field}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
