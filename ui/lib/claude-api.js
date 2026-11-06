/**
 * Claude API – AI Enrichment for Discovery Candidates
 * Calls api.anthropic.com directly from the browser.
 *
 * Requires: anthropic-dangerous-direct-browser-access: true header
 * API key stored in localStorage under 'discovery_claude_key'
 */

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You are a financial analyst assistant. Analyze trading candidates and return structured enrichment data as JSON.

IMPORTANT: Respond ONLY with a valid JSON object matching this exact schema:
{
  "sector": string,
  "industry": string,
  "market_cap_bucket": "large" | "mid" | "small" | "micro",
  "region": "US" | "DE" | "EU" | "other",
  "thesis_short": string (1-2 sentences, German or English),
  "thesis_long": string (3-5 sentences, markdown allowed),
  "risks": string[] (2-4 items),
  "catalysts": string[] (2-4 items),
  "confidence": "high" | "medium" | "low",
  "upside_20pct_probability": number (0-100, integer),
  "upside_reasoning": string (1 Satz, German or English)
}

Market cap buckets: large = >$10B, mid = $2B-$10B, small = $300M-$2B, micro = <$300M
upside_20pct_probability: estimated probability in percent that the price rises by at least +20% within the next 1 month, based on the signals, momentum and thesis above. upside_reasoning gives a one-sentence justification for that estimate.
Do not include any explanation outside the JSON. No markdown fences in your response.`;

/**
 * Build the user prompt for a candidate.
 * @param {object} candidate
 * @returns {string}
 */
function buildPrompt(candidate) {
  const sourceSummary = candidate.sources
    .map(
      (s) =>
        `- [${s.adapter}] ${s.signal_type} (${s.discovered_at.slice(0, 10)}): ${s.info_snippet}`,
    )
    .join('\n');

  return `Analyze this trading candidate:

Symbol: ${candidate.symbol} @ ${candidate.exchange}
Name: ${candidate.name}
ISIN: ${candidate.isin ?? 'n/a'}
Yahoo Symbol: ${candidate.yahoo_symbol}

Signals:
${sourceSummary}

Notes: ${candidate.notes || 'none'}

Return enrichment JSON only.`;
}

/**
 * Strip markdown code fences from a string.
 * @param {string} text
 * @returns {string}
 */
function stripFences(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/**
 * Enrich a single candidate with AI analysis.
 *
 * @param {object} candidate
 * @param {object} [opts]
 * @param {function} [opts.onProgress] - called with status messages
 * @returns {Promise<object>} enrichment object
 */
export async function enrichCandidate(candidate, opts = {}) {
  const apiKey = localStorage.getItem('discovery_claude_key');
  if (!apiKey) throw new Error('Claude API key not configured. Go to Settings.');

  const { onProgress } = opts;
  onProgress?.(`Enriching ${candidate.symbol}…`);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildPrompt(candidate),
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  const rawText = data.content?.[0]?.text ?? '';
  const cleaned = stripFences(rawText);

  let enrichment;
  try {
    enrichment = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Failed to parse Claude response as JSON: ${cleaned.slice(0, 300)}`);
  }

  enrichment.enriched_at = new Date().toISOString();
  enrichment.model = MODEL;

  onProgress?.(`✓ ${candidate.symbol} enriched`);
  return enrichment;
}

/**
 * Enrich multiple candidates in sequence.
 *
 * @param {object[]} candidates
 * @param {object} [opts]
 * @param {function} [opts.onProgress]
 * @param {function} [opts.onResult] - called with (candidate, enrichment) after each
 * @returns {Promise<Map<string, object>>} id → enrichment
 */
export async function enrichBulk(candidates, opts = {}) {
  const { onProgress, onResult } = opts;
  const results = new Map();

  for (const candidate of candidates) {
    try {
      const enrichment = await enrichCandidate(candidate, { onProgress });
      results.set(candidate.id, enrichment);
      onResult?.(candidate, enrichment);
    } catch (err) {
      onProgress?.(`✗ ${candidate.symbol}: ${err.message}`);
    }
  }

  return results;
}
