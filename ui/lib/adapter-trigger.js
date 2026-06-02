/**
 * Adapter Trigger – manually dispatch adapter GitHub Actions from the UI.
 *
 * Each adapter has a `workflow_dispatch:` trigger in its workflow file, so we
 * can kick a run via the GitHub REST API. The PAT is stored in localStorage
 * (Settings → "GitHub PAT", classic scope `workflow` or fine-grained
 * "Actions: write"). The actual scraping still runs on GitHub's runners – this
 * only starts the run; results land in the inbox blob as usual.
 *
 * Repo + ref default to this project's main branch but can be overridden via
 * localStorage (`discovery_github_repo`, `discovery_github_ref`) without a
 * rebuild – handy if the workflows ever move to a fork.
 */

const REPO = localStorage.getItem('discovery_github_repo') || 'streetspirit83/discovery';
const REF  = localStorage.getItem('discovery_github_ref')  || 'main';

export const ADAPTERS = [
  { key: 'openinsider',           label: 'OpenInsider',          workflow: 'adapter-openinsider.yml' },
  { key: 'boerse-frankfurt',      label: 'Börse Frankfurt',      workflow: 'adapter-boerse-frankfurt.yml' },
  { key: 'etf-holdings',          label: 'ETF Holdings',         workflow: 'adapter-etf-holdings.yml' },
  { key: 'stocktwits',            label: 'StockTwits Trending',  workflow: 'adapter-stocktwits.yml' },
  { key: 'yahoo-trending',        label: 'Yahoo Trending',       workflow: 'adapter-yahoo-trending.yml' },
  { key: 'tradingview-screener',  label: 'TradingView Screener', workflow: 'adapter-tradingview-screener.yml' },
];

/** True if a GitHub PAT is configured in settings. */
export function hasGithubPat() {
  return !!localStorage.getItem('discovery_github_pat');
}

/** Public Actions page for the repo (so the user can watch the run). */
export const ACTIONS_URL = `https://github.com/${REPO}/actions`;

/**
 * Dispatch one adapter workflow. Resolves on success, throws with a
 * human-readable message otherwise. GitHub returns 204 No Content on success.
 */
export async function triggerAdapter(workflowFile) {
  const pat = localStorage.getItem('discovery_github_pat');
  if (!pat) throw new Error('Kein GitHub PAT konfiguriert');

  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: REF }),
    });
  } catch (err) {
    throw new Error(`Netzwerkfehler: ${err.message}`);
  }

  if (res.status === 204) return; // success – run queued

  // Try to surface GitHub's error message
  let detail = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    if (j?.message) detail = j.message;
  } catch { /* no JSON body */ }

  if (res.status === 401) throw new Error('PAT ungültig oder abgelaufen (401)');
  if (res.status === 403) throw new Error(`Kein Zugriff (403) – PAT-Scope „workflow"? · ${detail}`);
  if (res.status === 404) throw new Error(`Workflow/Repo nicht gefunden (404) – Repo „${REPO}", Branch „${REF}" · ${detail}`);
  if (res.status === 422) throw new Error(`Ungültige Anfrage (422) – existiert Branch „${REF}"? · ${detail}`);
  throw new Error(detail);
}
