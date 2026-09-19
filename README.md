# Waymode site

The marketing site and live showcase for [waymode.ai](https://waymode.ai).

This repository owns the homepage, interactive demo, hosted API, browser
checks, and launch assets. The public `waymode` repository owns the SDK.

```sh
npm ci
npm run verify
npm run dev
```

`npm run dev` serves the homepage and live demo on loopback port 4317 with Vite
reload. Set `PORT` to choose another local port. Copy `.env.example` to
`.env.local` and set the server-held Gateway key for live model calls. Never put
credentials in browser code or public assets.

Cloudflare serves `public/` and routes `/api/*` to `hosted/worker.ts` in this same
repository. Production needs no separate demo host or local port. The homepage
is `public/index.html`; `/site` redirects to `/`.

## Build and deploy

1. Run `npm ci` and `npm run verify`. This checks the code, builds the showcase
   into `public/showcase/`, and checks the site files.
2. Run `npm run deploy -- --env preview` to deploy the preview.
3. Set `AI_GATEWAY_API_KEY` and `WAYMODE_MODEL` with Wrangler secrets for preview
   and production when provisioning a new environment. Existing secrets persist.
4. Check the scene, chat portal, external agent, and visitor isolation on preview,
   then run `npm run deploy -- --env=''` for production.
5. Check the same flow at `https://waymode.ai/` after deployment.

Deploy rebuilds and checks the public assets. `npm run dev:hosted` builds and runs
Wrangler locally for checks against the Cloudflare backend. Use an ignored
`.dev.vars` file for its model credentials.

## Source layout

- `public/` — marketing page and static files; `public/showcase/` is generated.
- `demo/` — demo apps, playback, local server, browser checks, and launch story.
- `hosted/` — Cloudflare API, visitor state, quotas, and model calls.
- `vendor/` — the pinned SDK package used by the demo; imports use public exports.
- `artifacts/` — ignored recordings, model receipts, and retained check results.

The pinned `vendor/mossburgh-waymode-0.2.0.tgz` keeps installs independent of a
sibling SDK checkout. To test a new SDK build, pack it into `vendor/`, update the
file dependency and lockfile, and rerun verification. Retained evidence records
the installed SDK bytes; a changed SDK requires fresh live runs.

Paid browser checks use `eval:public`, `eval:backend`, `eval:composed`, and
`eval:completion` against the running local app. Retain attempts under ignored
`artifacts/`. Keep the demo and launch files here rather than in the SDK repo.

The `Showcase` Durable Object stores visitor state and request quotas in SQLite.
Each visitor receives an opaque, HttpOnly, Secure, SameSite=Strict cookie lasting
one hour. Requests require the same origin; mutation bodies are limited to 16 KiB.
The host accepts only the demo product's own bounded API operations.

Model calls stop at 60 per session, 100 per IP per UTC day, or 600 across the site
per UTC day. At most four model calls run together. Failed calls still consume
a reservation. Quotas survive worker restarts. Session creation is also limited.
These are request caps, not a dollar budget or a claim of free inference. Gateway
reported charges and market estimates remain separate in Activity.

Set `DEMO_ENABLED` to `"false"` and deploy to stop new model calls. Keep Durable
Object bindings and migrations when rolling back code so stored quotas survive.
A rejected or expired session can restart by reloading the demo. Existing API
sessions expire after two minutes and fail closed after a worker restart.

This is a bounded public demo, not a multi-tenant production application backend.
The SDK and broader live reliability gates have their own release status.

## Search and analytics

The homepage serves its use cases, integration limits, FAQ, links, and structured
data in HTML. The primary layout is visible before JavaScript runs. The page
leads with the live showcase and four short capability captions; integration
details remain in native disclosures. Navigation and prompt copying run directly,
with a short intent caption in the compact header. Styles are inline so
the local demo server serves the same homepage at `/`. The old `/site` path
redirects to `/`; the app used inside the showcase lives at `/product.html`. The showcase
has its own implementation; keep product claims grounded in the SDK contract and
retained runs rather than animated examples.

Use free [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/get-started/)
with automatic injection for `waymode.ai`. The content security policy permits
the beacon script and its same-origin `/cdn-cgi/rum` endpoint. No manual beacon or
placeholder token is installed. Enable the site in the Cloudflare dashboard,
check regional collection settings, then verify a successful beacon request on
the deployed page and incoming data in the dashboard. Do not add a second beacon
if automatic injection is active.

Cloudflare says its Web Analytics uses no cookies, localStorage, or visitor
fingerprinting. This describes that service, not every feature of the site or a
blanket exemption from regional consent rules. Keep the site's privacy notice in
step with the services actually enabled. Its [FAQ](https://developers.cloudflare.com/web-analytics/faq/)
lists no custom-event or UTM support; pageviews cannot prove installation.

### Baseline and scorecard

On 2026-09-19, the local copy and search metadata were updated. Cloudflare
dashboard access required sign-in. Analytics collection, Search Console, and
Bing Webmaster Tools were not verified. No traffic or ranking baseline is claimed.

| Outcome                | Source                                                        | Compare                                                                                                  |
| ---------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Search discovery       | Verified Google Search Console property                       | Non-branded impressions, clicks, queries, landing pages over matching 28-day windows                     |
| AI citations           | Available search-provider AI reports and a fixed prompt panel | Cited URL and answer accuracy, with model, date, locale, and sample size                                 |
| Visits and performance | Cloudflare Web Analytics                                      | Referrers, landing pages, device mix, and p75 Core Web Vitals; disclose sampling and regional exclusions |
| Install intent         | A separate event collector, not yet installed                 | Successful prompt copies and GitHub clicks; never label these completed installs                         |
| Product results        | Retained SDK/app eval runs                                    | Task success, policy failures, latency, cost, and exact versions; separate from marketing metrics        |

Use the same prompt panel before and after a content change: “How can I add AI
chat that takes actions in a React app?”, “How can external AI agents use my
app's existing actions?”, and “How does Waymode work with computer-use agents?”
Report each provider separately and keep the tested answers. A small panel
measures that sample, not all AI-search visibility. Avoid mass-produced keyword
pages and unsupported benchmark numbers.
