#!/usr/bin/env bun
/**
 * SubBridge CLI — post to home subreddit + crosspost to targets immediately.
 *
 * Credentials in .env:
 *   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
 *   REDDIT_HOME_SUBREDDIT (default home sub, overridable with --home)
 *
 * Usage:
 *   bun tools/post.ts --title "My post" --body "Optional body" --targets "r/Maribor,r/Slovenia"
 *   bun tools/post.ts --title "My post" --home OtherSub --targets "r/Maribor"
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(): void {
  try {
    const lines = readFileSync(resolve(process.cwd(), ".env"), "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch { /* .env optional */ }
}

async function getAccessToken(): Promise<string> {
  const { REDDIT_CLIENT_ID: id, REDDIT_CLIENT_SECRET: secret,
          REDDIT_USERNAME: user, REDDIT_PASSWORD: pass } = process.env;
  if (!id || !secret || !user || !pass) {
    throw new Error("REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD must be set");
  }
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "sub-bridge/1.0",
    },
    body: new URLSearchParams({ grant_type: "password", username: user, password: pass }),
  });
  if (!res.ok) throw new Error(`Auth failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Auth error: ${data.error ?? "no access_token"}`);
  return data.access_token;
}

async function submitPost(token: string, sub: string, title: string, body: string) {
  const res = await fetch("https://oauth.reddit.com/api/submit", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "sub-bridge/1.0" },
    body: new URLSearchParams({ kind: "self", sr: sub, title, text: body, resubmit: "true" }),
  });
  const data = (await res.json()) as { json?: { errors?: [string,string,string][]; data?: { name: string; url: string } } };
  const errs = data.json?.errors;
  if (errs?.length) throw new Error(errs.map(e => e[1]).join(", "));
  const post = data.json?.data;
  if (!post) throw new Error("Submit returned no post data");
  return { fullname: post.name, url: post.url };
}

async function crosspostTo(token: string, target: string, fullname: string, title: string): Promise<string> {
  const res = await fetch("https://oauth.reddit.com/api/crosspost", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "sub-bridge/1.0" },
    body: new URLSearchParams({ sr: target, kind: "crosspost", title, crosspost_fullname: fullname, resubmit: "true" }),
  });
  const data = (await res.json()) as { json?: { errors?: [string,string,string][]; data?: { url: string } } };
  const errs = data.json?.errors;
  if (errs?.length) throw new Error(errs.map(e => e[1]).join(", "));
  const url = data.json?.data?.url;
  if (!url) throw new Error("Crosspost returned no URL");
  return url;
}

// --- Main ---

loadEnv();

const args = process.argv.slice(2);
const get = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };

const title = get("--title");
if (!title) { console.error("Error: --title is required"); process.exit(1); }

const targetsRaw = get("--targets");
if (!targetsRaw) { console.error("Error: --targets is required (e.g. r/Maribor,r/Slovenia)"); process.exit(1); }

const home = get("--home") ?? process.env.REDDIT_HOME_SUBREDDIT;
if (!home) { console.error("Error: --home or REDDIT_HOME_SUBREDDIT env var is required"); process.exit(1); }

const targets = targetsRaw.split(",").map(s => s.trim().replace(/^r\//, "")).filter(Boolean);
const body = get("--body") ?? "";

console.log(`\nPosting to r/${home}...`);
const token = await getAccessToken();
const { fullname, url } = await submitPost(token, home, title, body);
console.log(`✓ Posted: ${url}`);

for (const target of targets) {
  process.stdout.write(`  Crossposting to r/${target}... `);
  try {
    console.log(`✓ ${await crosspostTo(token, target, fullname, title)}`);
  } catch (err) {
    console.log(`✗ ${err instanceof Error ? err.message : err}`);
  }
}
