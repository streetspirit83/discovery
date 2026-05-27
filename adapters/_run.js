#!/usr/bin/env node
/**
 * Adapter runner CLI
 * Usage: node adapters/_run.js <adapter-name>
 * Example: node adapters/_run.js openinsider
 */

import { createStorageClientFromEnv } from './_shared/storage-client.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

const ADAPTERS = {
  openinsider: './openinsider.js',
  'boerse-frankfurt': './boerse-frankfurt.js',
  'etf-holdings': './etf-holdings.js',
};

async function main() {
  const adapterName = process.argv[2];

  if (!adapterName) {
    log('error', 'No adapter specified');
    process.stderr.write(`Usage: node adapters/_run.js <adapter>\nAvailable: ${Object.keys(ADAPTERS).join(', ')}\n`);
    process.exit(1);
  }

  const adapterPath = ADAPTERS[adapterName];
  if (!adapterPath) {
    log('error', 'Unknown adapter', { adapterName, available: Object.keys(ADAPTERS) });
    process.exit(1);
  }

  log('info', 'adapter: starting', { adapter: adapterName });

  let storageClient;
  try {
    storageClient = createStorageClientFromEnv();
  } catch (err) {
    log('error', 'Failed to create storage client', { error: err.message });
    process.exit(1);
  }

  let adapter;
  try {
    adapter = await import(adapterPath);
  } catch (err) {
    log('error', 'Failed to load adapter', { adapter: adapterName, error: err.message });
    process.exit(1);
  }

  if (typeof adapter.fetchCandidates !== 'function') {
    log('error', 'Adapter does not export fetchCandidates()', { adapter: adapterName });
    process.exit(1);
  }

  let candidates;
  try {
    log('info', 'adapter: fetching candidates', { adapter: adapterName });
    candidates = await adapter.fetchCandidates();
    log('info', 'adapter: fetched candidates', { adapter: adapterName, count: candidates.length });
  } catch (err) {
    log('error', 'adapter: fetchCandidates failed', { adapter: adapterName, error: err.message });
    process.exit(1);
  }

  let added = 0;
  let merged = 0;
  let skipped = 0;
  let errors = 0;

  for (const candidate of candidates) {
    try {
      const result = await storageClient.appendCandidate(candidate);
      if (result.action === 'added') added++;
      else if (result.action === 'merged') merged++;
      else if (result.action === 'skipped') skipped++;
      log('debug', 'adapter: candidate processed', {
        adapter: adapterName,
        symbol: candidate.symbol,
        action: result.action,
        id: result.id,
      });
    } catch (err) {
      errors++;
      log('error', 'adapter: failed to append candidate', {
        adapter: adapterName,
        symbol: candidate.symbol,
        error: err.message,
      });
    }
  }

  log('info', 'adapter: complete', {
    adapter: adapterName,
    total: candidates.length,
    added,
    merged,
    skipped,
    errors,
  });

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ level: 'fatal', msg: err.message, stack: err.stack }) + '\n');
  process.exit(1);
});
