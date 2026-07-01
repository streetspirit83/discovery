# Discovery Workspace – Claude Code Notes

## Project Overview
Stock/ETF candidate discovery tool. Scrapes signals from multiple sources (insider buying, trend lists, ETF changes), stores them in Netlify Blob Storage, and provides a UI for review + AI enrichment.

## Architecture
- **adapters/**: Node.js 20 scrapers that push candidates to the backend
- **netlify-backend/**: Netlify serverless functions for storage + scrape proxy
- **ui/**: Plain HTML/CSS/ES Modules frontend (no build step)
- **data/**: Example data files

## Running Adapters
```bash
npm ci
node adapters/_run.js openinsider
node adapters/_run.js boerse-frankfurt
node adapters/_run.js etf-holdings
```

Requires env vars: `DISCOVERY_BACKEND_URL`, `DISCOVERY_SECRET`
Optional: `FMP_API_KEY`, `TWELVEDATA_API_KEY` (for US exchange resolution)

## UI Development
Open `ui/index.html` directly in a browser – no build step needed.
Works with mock data without any backend.
Settings → configure backend URL, secret, and Claude API key for full functionality.

**Before any UI change, read [`ui/STYLEGUIDE.md`](ui/STYLEGUIDE.md)** – the binding
design rules (design tokens, Lucide-only icons via `ui/lib/icons.js`, icon-only
links, stacked stat-blocks with a smaller second line, single-row panels). UI
changes are agreed as a visual/plan in chat first, then built.

## Key Design Decisions
- All storage goes through Netlify Blobs (3 blobs: inbox, archive, export)
- Dedup by symbol+exchange: inbox merges sources, archive/export skips
- AI enrichment calls Anthropic API directly from browser (requires CORS header `anthropic-dangerous-direct-browser-access: true`)
- No TypeScript, no React, no bundler – intentional simplicity

## Blob Types
- **inbox**: Active candidates being reviewed
- **archive**: Dismissed candidates (kept for dedup)
- **export**: Promoted candidates ready for action

## Workspace States
`new` → `reviewed` → `promoted` | `dismissed`

## GitHub Actions
- Adapters run on schedule (daily at 6 AM UTC)
- UI deploys to GitHub Pages on push to main

## Netlify Setup
Deploy `netlify-backend/` directory. Set environment variables:
- `DISCOVERY_SECRET` – shared secret for API auth

## Development Gotchas

### Netlify deploys cost credits — batch changes
Never deploy speculatively. Diagnose locally first, then merge all Netlify-touching changes into one commit before pushing. Every push to `netlify-backend/` or `netlify.toml` that triggers a deploy burns a credit.

### Netlify Functions v2 sharp edges
- Return `new Response(body, { status, headers })` — not `{ statusCode, headers, body }` (that's v1 format)
- A `204` response **must** have a null body; sending any body causes Netlify's CDN to strip response headers (including CORS). Use `200` with a null body for OPTIONS preflights.
- Set CORS headers in **both** the function response and `netlify.toml` `[[headers]]` — one covers direct function invocations, the other covers CDN edge routing.
- `[[headers]]` `for` patterns must match the actual request path. `/.netlify/functions/*` and `/api/*` are different paths; add both if you alias functions.

### Cloud environments get blocked by consumer-facing websites
GitHub Actions (Azure) and Netlify Functions (AWS) are on well-known cloud IP ranges. Consumer sites often block them. Before writing any scraper, verify the target allows automated access from cloud IPs — or find an official API / primary-source feed that does.

### Inspect real API responses before writing parsing logic
Never assume field names, nesting depth, or data formats. Fetch one live response, log it verbatim, and read it before writing any parser. Wrong assumptions compound: each fix that's based on another guess adds another debug cycle.

### CI cache optimizations aren't always worth it
Optional CI caches (`cache: 'npm'`) fail when lock files are missing or in unexpected paths. If the cache isn't already working, remove it — the time saved rarely justifies the debugging overhead for infrequent scheduled jobs.

### CI workflow viewers show the YAML at run-trigger-time
When a GitHub Actions run shows an outdated workflow definition, that's expected — the UI shows the YAML as it was when the run was triggered, not the current file. Verify the current branch has your changes and wait for a new run.

### No paid API plans — ever
Never propose or implement adapters that require a paid subscription or API key purchase. Only use free tiers (no credit card), public/unauthenticated endpoints, or official free developer APIs. If a data source requires payment, find an alternative primary source that exposes the same underlying data for free.

### Diagnose before you assume it's a bug
Unexpected behaviour (e.g. an item "disappearing" after an action) is often intended behaviour with a missing UX affordance (a toast, a redirect, a drawer close). Check the intended flow first before writing fix code.

## Git Workflow

### Always promote finished work to `main` yourself — don't ask
The user has given standing permission to push to `main`. When a unit of work is complete and verified, promote it without asking. Full sequence each time:
1. Commit on the feature branch (`claude/<...>`).
2. Push the feature branch.
3. Merge the feature branch into `main` (resolve conflicts; verify the merge didn't silently drop changes — a parallel `main` once dropped a column + a function that were re-added in the same region).
4. Push `main`.
5. Fast-forward the feature branch back to `main` so the next round starts clean.

Pushing to `main` triggers both deploys (GitHub Pages UI + Netlify backend), so batch Netlify-touching changes first (see "Netlify deploys cost credits").
