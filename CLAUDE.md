# webhooks/

CLAB Webhook Server — a single Bun HTTP server (deployed to `post.cloverlabs.dev`
via Coolify, GitHub `clover-labs/webhooks`) plus the Reddit-specific Devvit
community apps that share its OAuth accounts. Despite the directory's history,
this is not Reddit-only: `src/` is a generic webhook server that happens to
have started with a Reddit integration and now also handles CRM lead intake.

## Projects

| Path | Description |
|------|-------------|
| `src/` | Webhook server — `POST /post` (Reddit cross-post bridge, submits/crossposts to Reddit), `POST /calcom-booking` (Cal.com "Booking created" → creates a Company + Opportunity in Twenty CRM), and client questionnaires on `start.cloverlabs.dev/<client>` (`brief.ts` + `brief.html`, one data file per client in `briefs/`; answers → Note on the client's Opportunity + email via SES, `ses.ts`). One deployable unit; each concern gets its own file, `index.ts` is a thin router (routes `start.cloverlabs.dev` by Host). |
| [`apps/sub-bridge/`](apps/sub-bridge/CLAUDE.md) | SubBridge — Devvit mod panel for scheduling and cross-posting across subreddits |
| `apps/klub-kgb/` | Klub KGB Reddit presence (placeholder — no code yet) |

## Deployment

Coolify app `webhooks` (project `clawd`, clab-app Coolify on 95.216.156.14 — `clab` CLI
`default` profile via SSH tunnel `localhost:18000`) builds `src/` directly from
`clover-labs/webhooks@main` → `post.cloverlabs.dev` + `start.cloverlabs.dev`
(DNS: the `*.cloverlabs.dev` wildcard). Pushing to `main` does NOT deploy:
trigger it in Coolify (Redeploy, or API `GET /deploy?uuid=ogwgs4wgkkccssscg4kgk40g`).
No separate build step. Env vars (`WEBHOOK_SECRET`, `REDDIT_CLIENT_ID`,
`REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`,
`REDDIT_HOME_SUBREDDIT`, `CALCOM_WEBHOOK_SECRET`, `TWENTY_API_URL`,
`TWENTY_API_TOKEN`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_REGION`,
`SES_FROM_ADDRESS`, `BRIEF_NOTIFY_TO`) are set in Coolify, not committed anywhere.
SES keys: IAM user `cloverlabs-smtp` (cloverlabs.dev identity only), Infisical
`clab-ops` `/cloverlabs-ses`. `BRIEF_HOST=localhost` serves the briefs locally.

## Shared Context

Reddit-specific projects (`apps/`) target the same Reddit accounts used by
CLAB brands. Reddit OAuth credentials live in `$CLAB_CREDS_DIR/reddit.env` (Infisical mirror, see `infra/bin/creds-pull`) or project-local
`.env` files. Twenty CRM credentials for the `/calcom-booking` route are
documented in `docs/creds/twenty-crm.env`.

## History

This directory used to be named `reddit/`, matching its original Reddit-only
scope — renamed to `webhooks/` 2026-08-03 to match the GitHub repo
(`clover-labs/webhooks`) and Coolify resource name, which were already
correctly named. See `docs/github-org/shaping.md`'s "reddit vs. webhooks"
section for the fuller naming-cleanup context (R1.1).
