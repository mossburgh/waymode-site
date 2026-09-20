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
3. Set `AI_GATEWAY_API_KEY`, `WAYMODE_MODEL`, and `TURNSTILE_SECRET` with Wrangler secrets for production
   when provisioning a new environment. Existing secrets persist. Paid calls in
   preview are disabled; use local credentials for live pre-release checks.
4. Check the scene, chat portal, external agent, and visitor isolation on preview,
   then run `npm run deploy -- --env=''` for production.
5. Check the same flow at `https://waymode.ai/` after deployment.

Deploy rebuilds and checks the public assets. `npm run dev:hosted` builds and runs
Wrangler locally for checks against the Cloudflare backend. Use an ignored
`.dev.vars` file for its model credentials.

## Source layout

- `public/` — marketing page and static files; `showcase/` and `waymode/` are generated.
- `site/` — the navbar, compact receipts, and browser runtime for page guidance.
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

Model calls stop at 60 per session, 100 per network per UTC day, or 600 across the site
per UTC day. IPv6 addresses share a /64 network bucket. The temporary
`DEMO_BOOST_UNTIL` setting raises only the shared daily pool to 1,200, then
returns to 600 at the configured expiry. Additional limits cap model calls
at 12 per network per minute, 60 site-wide per minute, and 150 site-wide per hour. At most four model calls run together. Failed calls still consume
a reservation. Quotas survive worker restarts. Session creation is also limited. A Cloudflare edge binding rejects more than 240
API requests per network per minute before shared storage; its counters are
eventually consistent. Durable Object limits remain authoritative. Stored network
identifiers use HMAC with a random secret rotated and expired each UTC day.
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
details remain in native disclosures. The navbar runs requests through the Waymode SDK and the same capped Worker API as
the demo. It observes live controls, guides actions, and leaves clipboard and
external-link clicks to the visitor. Hover context follows each control’s state.
`npm run build` builds both the demo and navbar runtime. The old `/site` path
redirects to `/`; the app used inside the showcase lives at `/product.html`. The showcase
has its own implementation; keep product claims grounded in the SDK contract and
retained runs rather than animated examples.

PostHog supplies autocapture, heatmaps, and session replay. A single bridge records
Waymode runtime activity, including submitted prompts, decisions, receipts, and
stop requests. Same-origin demo frames load the same SDK for autocapture; the
parent records replay. No per-button event catalog is maintained.

Set `POSTHOG_PUBLIC_KEY` to the public `phc_...` project key and `POSTHOG_REGION`
to `us` or `eu` in the Worker environment. Never use a personal API key. Without
a valid project key, the SDK stays unloaded and no PostHog events are sent.
Visitors must opt in before the SDK loads. The notice explicitly covers prompt
drafts, messages, console messages, and runtime activity. Analytics preferences can withdraw
consent; GPC and Do Not Track disable capture. The demo still works without it.

Ordinary site text, inputs, and visible traces are readable in replay after consent.
Password fields, security widgets, network bodies, auth headers, and cookies are
excluded. Runtime events and console capture redact credential fields and common
secret patterns.
Pattern redaction cannot recognize every secret somebody might paste into free
text, so the privacy notice asks visitors to keep confidential data out of the demo.
URL queries and fragments are removed before capture, except Google Fonts family
and display parameters needed to render replay.

Analytics preferences use the same visible controls as the rest of the site.
Waymode can open the menu, change the choice, or guide the visitor through it;
there is no separate analytics intent parser or tool.

Production uses the Waymode US PostHog project with 30-day replay retention.
Verify a consented session, an opted-out session, both demo frames, and a stopped
run after analytics changes. Browser blockers can prevent collection.

Cloudflare structured logs record API status, duration, request ID, quota failures,
and model usage. They contain no submitted prompt bodies, cookies, or raw IPs.
Invocation logging is disabled to avoid automatically retaining full request URLs.
Request IDs link API calls to model usage; Cloudflare retention and export settings
control how long those operational logs remain available. This release does not
configure uptime alerts, a provider dollar budget, or a log export destination.

### Baseline and scorecard

On 2026-09-19, the local copy and search metadata were updated. Cloudflare
dashboard access required sign-in. Analytics collection, Search Console, and
Bing Webmaster Tools were not verified. No traffic or ranking baseline is claimed.

| Outcome                | Source                                                        | Compare                                                                                                  |
| ---------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Search discovery       | Verified Google Search Console property                       | Non-branded impressions, clicks, queries, landing pages over matching 28-day windows                     |
| AI citations           | Available search-provider AI reports and a fixed prompt panel | Cited URL and answer accuracy, with model, date, locale, and sample size                                 |
| Visits and performance | Cloudflare Web Analytics                                      | Referrers, landing pages, device mix, and p75 Core Web Vitals; disclose sampling and regional exclusions |
| Install intent         | PostHog autocapture, once configured                          | Successful prompt copies and GitHub clicks; never label these completed installs                         |
| Product results        | Retained SDK/app eval runs                                    | Task success, policy failures, latency, cost, and exact versions; separate from marketing metrics        |

Use the same prompt panel before and after a content change: “How can I add AI
chat that takes actions in a React app?”, “How can external AI agents use my
app's existing actions?”, and “How does Waymode work with computer-use agents?”
Report each provider separately and keep the tested answers. A small panel
measures that sample, not all AI-search visibility. Avoid mass-produced keyword
pages and unsupported benchmark numbers.

## Public model access

The hosted gateway requires a Cloudflare Turnstile check before paid calls.
`TURNSTILE_SITE_KEY` is public; `TURNSTILE_SECRET` stays in Worker secrets.
The managed widget allows only `waymode.ai` and `www.waymode.ai`. Server validation
checks the hostname, action, and session nonce. Grants last at most 15 minutes
and are bound to the session and its network quota identity. Model reservation
rechecks the grant, including backend input resolution.

The decision endpoint rejects unknown controls and replaces client descriptions,
input schemas, state, context, history details, and model-facing handles with
site-owned values. `scripts/control-catalog.mjs` derives static control metadata
from the HTML during builds; the product API contract supplies backend controls.
Dynamic settings come from the visitor's bounded demo feature definition.
This limits reuse; it does not prove a human's intent or eliminate distributed
abuse. Existing request and model quotas remain in force.
