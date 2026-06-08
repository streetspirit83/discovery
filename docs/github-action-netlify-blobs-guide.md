# Guide: Persisting GitHub Action scraper output via Netlify Blobs

This pattern lets a scheduled GitHub Action (e.g. a scraper that writes a JSON
file into the ephemeral runner workspace) push its result to a durable store
that survives past job end and can be read by a frontend or other services.

It was first implemented for the AltIndex toplist scraper
(`streetspirit83/Claude` → `streetspirit83/discovery`, see PR #20 in
`discovery` and the `scrape-toplist.yml` workflow in `Claude`). Use this as a
template for any future "scrape → persist → serve" project.

## Architecture (Option B: ingest via a Netlify Function endpoint)

```
GitHub Action (scrapes, writes result.json to runner workspace)
        │  curl POST + shared secret
        ▼
Netlify Function  POST /api/<name>-ingest   (writes to Netlify Blobs)
        │
        ▼
Netlify Blobs store  (durable, accessible across deploys/functions)
        │
        ▼
Netlify Function  GET /api/<name>           (reads back, served to frontend)
```

Two repos are typically involved:
- the **scraper repo** (runs the GitHub Action, produces the JSON)
- the **backend repo** (Netlify site with the ingest/read functions)

They can be the same repo if the Netlify site is built from the scraper repo.

## Step-by-step

### 1. Confirm the Netlify site and its function setup

Before writing any code, verify (ask the user if unclear):
- Netlify **site name** and **site ID** (`mcp__Netlify__netlify-project-services-reader` → `get-project`)
- the site's **production branch** (functions only go live once merged to that branch — PRs only get *deploy previews* on their own URL)
- whether the site already has Netlify Functions (`netlify.toml`, `netlify/functions/` dir) and what bundler/runtime it uses (v2 functions use `export default async function handler(req)`, not the v1 `{ statusCode, body }` shape)
- existing CORS header config in `netlify.toml` (`[[headers]]` blocks) — new headers must be added there too, not just in the function response

### 2. Add the ingest function (write endpoint)

Create `netlify/functions/<name>-ingest.js`:

```js
import { getStore } from '@netlify/blobs';

const STORE_NAME = '<name>';
const BLOB_KEY = 'data.json';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-deploy-secret',
};

function respond(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS }); // 200, not 204 — null body required
  }
  if (req.method !== 'POST') return respond(405, { ok: false, error: 'Method not allowed' });

  const secret = req.headers.get('x-deploy-secret');
  if (!secret || secret !== process.env.<NAME>_INGEST_SECRET) {
    return respond(401, { ok: false, error: 'Unauthorized' });
  }

  let body;
  try { body = await req.json(); } catch { return respond(400, { ok: false, error: 'Invalid JSON body' }); }

  await getStore(STORE_NAME).setJSON(BLOB_KEY, body);
  return respond(200, { ok: true });
}

export const config = { path: '/api/<name>-ingest' };
```

### 3. Add the read function (optional, if the data needs to be served)

Create `netlify/functions/<name>.js` mirroring the structure above but with
`req.method === 'GET'`, no auth, `getStore(STORE_NAME).get(BLOB_KEY, { type: 'json' })`,
and a 404 response when the blob doesn't exist yet.

### 4. Update `netlify.toml`

Add/extend the `[[headers]]` blocks for both `/api/*` and
`/.netlify/functions/*` so the CDN passes through the new method (`GET` if you
added a read endpoint) and the `x-deploy-secret` header — function-level CORS
headers alone are not enough; the edge routing needs them too.

### 5. Add the workflow step in the scraper's GitHub Action

At the end of the job that produces the JSON file:

```yaml
      - name: Push result to Netlify Blobs
        env:
          <NAME>_INGEST_SECRET: ${{ secrets.<NAME>_INGEST_SECRET }}
        run: |
          curl -sS -f -X POST "https://<site-name>.netlify.app/api/<name>-ingest" \
            -H "Content-Type: application/json" \
            -H "x-deploy-secret: ${<NAME>_INGEST_SECRET}" \
            --data-binary @<result-file>.json
```

`-f` makes curl fail loudly (non-zero exit) on 4xx/5xx instead of silently
"succeeding" with an error body — important for catching deploy/secret issues
in CI.

### 6. Wire up the shared secret (manual — cannot be automated by the agent)

Generate one random secret value and set it in **two places** with the exact
same value:
- **Netlify**: Site settings → Environment variables → `<NAME>_INGEST_SECRET`
  (or via `mcp__Netlify__netlify-project-services-updater` → manage env vars)
- **GitHub**: scraper repo → Settings → Secrets and variables → Actions →
  `<NAME>_INGEST_SECRET`

### 7. Merge to the production branch and verify

- Merge the backend-repo PR into its **production** branch (not just open it —
  Netlify only serves new functions from the production deploy; a PR/branch
  only gets a preview URL like `deploy-preview-N--<site>.netlify.app`).
- Confirm the production deploy picked up the new commit
  (`mcp__Netlify__netlify-deploy-services-reader` → list deploys, check the
  "Production" deploy's commit SHA matches).
- Smoke-test both endpoints directly:
  ```bash
  curl -i -X OPTIONS https://<site-name>.netlify.app/api/<name>-ingest
  curl -i -X POST https://<site-name>.netlify.app/api/<name>-ingest \
    -H "Content-Type: application/json" -H "x-deploy-secret: <secret>" -d '{"test":true}'
  curl -i https://<site-name>.netlify.app/api/<name>
  ```
- Trigger the GitHub Action manually (`workflow_dispatch`) and confirm the
  push step succeeds and the read endpoint returns the new data.

## Pitfalls to remember (all bit us on the first run)

- **404 from the production URL right after merging a PR** → almost always
  means you're hitting `https://<site>.netlify.app/...` while the *production*
  deploy still points at the pre-merge commit. Check "Production: main@<sha>"
  in the Netlify deploy log against the merge commit SHA — a deploy preview
  existing for the PR does NOT mean production has it.
- **`204` with a body breaks CORS** — Netlify's CDN strips headers (including
  `Access-Control-Allow-*`) from `204` responses carrying a body. Always answer
  `OPTIONS` preflights with `200` + `null` body.
- **CORS headers must be set in two places** — the function response AND the
  `netlify.toml` `[[headers]]` blocks (one covers direct function invocation,
  the other covers CDN edge routing). `/api/*` and `/.netlify/functions/*` are
  different paths; cover both if the site aliases functions under `/api/`.
- **v1 vs v2 function shape** — return `new Response(body, { status, headers })`,
  not `{ statusCode, headers, body }`.
- **Don't deploy speculatively** — batch all Netlify-touching changes
  (functions + `netlify.toml`) into one commit/PR; every push that triggers a
  deploy can burn a credit on metered plans.
