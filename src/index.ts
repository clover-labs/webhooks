/**
 * CLAB Webhook Server
 *
 * POST /post
 *   Authorization: Bearer <WEBHOOK_SECRET>
 *   Content-Type: application/json
 *   { "title": "...", "body": "...", "home": "KlubKGB", "targets": ["r/Maribor"] }
 *
 * Env vars:
 *   WEBHOOK_SECRET, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET,
 *   REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_HOME_SUBREDDIT
 */

import { loadEnv, getAccessToken, submitPost, crosspostTo } from "./reddit.ts";

loadEnv();

const PORT = Number(process.env.PORT ?? 3000);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  console.error("Error: WEBHOOK_SECRET must be set");
  process.exit(1);
}

type PostRequest = {
  title: string;
  body?: string;
  home?: string;
  targets: string[];
};

type CrosspostResult = { subreddit: string; url: string } | { subreddit: string; error: string };

Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (req.method !== "POST" || pathname !== "/post") {
      return json(404, { ok: false, error: "not found" });
    }

    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${WEBHOOK_SECRET}`) {
      return json(401, { ok: false, error: "unauthorized" });
    }

    let payload: PostRequest;
    try {
      payload = (await req.json()) as PostRequest;
    } catch {
      return json(400, { ok: false, error: "invalid JSON body" });
    }

    const { title, body = "", targets } = payload;
    const home = payload.home ?? process.env.REDDIT_HOME_SUBREDDIT;

    if (!title) return json(400, { ok: false, error: "title is required" });
    if (!home) return json(400, { ok: false, error: "home is required (or set REDDIT_HOME_SUBREDDIT)" });
    if (!Array.isArray(targets) || targets.length === 0) {
      return json(400, { ok: false, error: "targets must be a non-empty array" });
    }

    const cleanTargets = targets.map((s) => s.replace(/^r\//, "")).filter(Boolean);

    try {
      const token = await getAccessToken();
      const { fullname, url: postUrl } = await submitPost(token, home, title, body);

      const crossposts: CrosspostResult[] = [];
      for (const subreddit of cleanTargets) {
        try {
          const url = await crosspostTo(token, subreddit, fullname, title);
          crossposts.push({ subreddit, url });
        } catch (err) {
          crossposts.push({ subreddit, error: err instanceof Error ? err.message : String(err) });
        }
      }

      return json(200, { ok: true, postUrl, crossposts });
    } catch (err) {
      return json(502, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
});

console.log(`CLAB webhooks listening on :${PORT}`);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
