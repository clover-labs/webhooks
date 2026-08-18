# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## What This App Does

**SubBridge** — a general-purpose Devvit mod panel for creating, scheduling, and cross-posting content
across multiple subreddits. Mods interact via a panel embedded in Reddit (no external dashboard).
Target subreddits are configured per installation via Devvit app settings.

Feature roadmap:
- **Phase 1 ✓:** Scheduled posting — compose + schedule posts to configurable subreddits
- **Phase 2 ✓:** Cross-posting — `submitPost` to home sub, then `crosspost({ runAs: 'USER' })` to targets
- **Phase 3 ✓:** In-app settings screen — target subreddits stored in Redis, editable via ⚙ panel
- Phase 4: Interactive posts — polls, Q&A, game templates

## Build & Development

```bash
# Authenticate once
bun run login               # devvit login (Reddit OAuth)

# Local development (live reload against test subreddit)
bun run dev                 # devvit playtest → uses r/sub_bridge_dev

# Type-check only (no bundling)
bun run type-check          # tsc --build

# Production build (minified)
bun run build               # esbuild client + server with --minify

# Upload new version (build + upload)
bun run deploy              # build → devvit upload

# Full publish (build + upload + submit for review)
bun run launch              # build → upload → devvit publish
```

## Architecture

```
src/
  client/         Browser scripts (bundled to public/*.js via esbuild)
  server/         Node.js HTTP server (bundled to dist/server/index.js)
  shared/         Types and API endpoint constants shared by both sides
public/           Static HTML + CSS + compiled JS (dashboard.html, compose.html)
tools/            esbuild build script + per-target tsconfig files
dist/             Server build output (gitignored)
```

**Client–server split:**
- Client: plain TypeScript → ESM, runs in the Reddit iframe (`public/`)
- Server: TypeScript → CJS, runs as a Node process inside Devvit (`dist/server/`)
- Shared: `src/shared/api.ts` holds all API route constants and request/response types

**Devvit entry points (devvit.json):**
- `dashboard.html` — default inline view (lists scheduled posts)
- `compose.html` — expanded view (compose form, opens via `requestExpandedMode(e, "compose")`)
- `settings.html` — expanded view (target subreddit config, opens via `requestExpandedMode(e, "settings")`)
- Server: `dist/server/index.js`
- Menu action: `POST /internal/menu/post-create` (mod-only)
- Trigger: `POST /internal/on-app-install`
- Scheduler: `POST /internal/scheduler/post-publish` (fires at scheduled time)

**State:** Redis, module-level singleton imported from `@devvit/web/server`.
- `scheduled:{id}` — JSON `ScheduledPost`
- `scheduled:index` — JSON `string[]` of all post IDs
- `settings:targetSubreddits` — newline-separated list of target subreddit names

**Test subreddit:** `r/sub_bridge_dev` (set in devvit.json `dev.subreddit`)

## Key APIs

All Devvit server-side APIs are module-level singletons from `@devvit/web/server`:
- `redis` — persistent KV store (`redis.get`, `redis.set`, `redis.incrBy`)
- `reddit` — Reddit API (`reddit.submitPost`, `reddit.submitCustomPost`, `reddit.crosspost`)
- `scheduler` — job scheduling (`scheduler.runJob({ name, data, runAt })`, `scheduler.cancelJob(id)`)
- `context` — request context (`context.postId`, `context.username`, `context.appName`, `context.subredditName`)

Client-side APIs from `@devvit/web/client`:
- `requestExpandedMode(event, entryName)` — open expanded view
- `exitExpandedMode(event)` — close expanded view (requires trusted MouseEvent)
- `showToast(text)` — show a toast notification
- `navigateTo(url)` — navigate to a URL
- `context.username` — current Reddit username

## Adding Features

When adding new API endpoints:
1. Add the route constant + types to `src/shared/api.ts`
2. Add the handler case in `src/server/server.ts` (exhaustiveness check via `satisfies never`)
3. Add the fetch call in the relevant `src/client/*.ts`

When adding new views:
1. Create `public/<view>.html` + `public/<view>.css`
2. Create `src/client/<view>.ts`
3. Register the HTML file in `devvit.json` under `post.entrypoints`
4. Update `tools/build.ts` `clientOpts.entryPoints` to include `src/client/<view>.ts`
5. Call `requestExpandedMode(e, "<view>")` from the triggering view

## TypeScript Rules

Strict mode is enforced (see `tools/tsconfig.base.json`):
- `noUnusedLocals`, `noImplicitOverride`, `isolatedDeclarations`
- Type-only imports must use `import type`
- Extensions must be included in imports (`import ... from './foo.ts'`)
- Node version pinned to 22.6.0 (`.nvmrc`); `engine-strict=true` in `.npmrc`
