# SubBridge

A Devvit mod panel for scheduling and cross-posting content across multiple subreddits.

Mods compose posts with a scheduled time and a list of target subreddits. At the scheduled time SubBridge posts to the home subreddit (where the app is installed), then crossposts to each target as the installing mod's account — no app installation required on target subs.

## Features

- Schedule posts with a future date/time
- Cross-post to any subreddit the installing mod is a member of
- Configure target subreddits in-panel (stored per installation)
- Dashboard shows pending, published, failed, and cancelled posts
- Cancel pending scheduled posts

## Prerequisites

- [Bun](https://bun.sh/) runtime
- Node 22.6.0 (see `.nvmrc`)
- A Reddit account connected to [Reddit Developers](https://developers.reddit.com/)

## Getting Started

```bash
bun install
bun run login          # Reddit OAuth — once per machine
bun run dev            # live playtest against r/sub_bridge_dev
```

Create `r/sub_bridge_dev` on Reddit before running `dev` for the first time.

## Commands

```bash
bun run login          # Authenticate CLI with Reddit
bun run dev            # Playtest with live reload → r/sub_bridge_dev
bun run type-check     # TypeScript type checking (no bundling)
bun run build          # Production build (minified)
bun run deploy         # Build + upload new version
bun run launch         # Build + upload + submit for review
```

## Using the App

1. In your subreddit, go to **Mod Tools → SubBridge → Open SubBridge** to create the panel post
2. Click ⚙ to open Settings — enter one target subreddit per line, then Save
3. Click **+ Schedule Post** to compose a post — set title, body, select targets, pick a time
4. The dashboard shows all scheduled posts; click Cancel to stop a pending one

The home subreddit always receives the original post automatically — don't add it to the settings list.

## Tech Stack

- [Devvit](https://developers.reddit.com/) — Reddit's developer platform
- TypeScript, Bun, esbuild
- Devvit Redis for state, Devvit Scheduler for job timing
