import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  try {
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env optional — fall through to env vars already set
  }
}

export async function getAccessToken(): Promise<string> {
  const { REDDIT_CLIENT_ID: clientId, REDDIT_CLIENT_SECRET: clientSecret,
          REDDIT_USERNAME: username, REDDIT_PASSWORD: password } = process.env;

  if (!clientId || !clientSecret || !username || !password) {
    throw new Error(
      "REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD must be set"
    );
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "clab-webhooks/1.0",
    },
    body: new URLSearchParams({ grant_type: "password", username, password }),
  });

  if (!res.ok) throw new Error(`Auth failed (${res.status}): ${await res.text()}`);

  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Auth error: ${data.error ?? "no access_token"}`);
  return data.access_token;
}

export async function submitPost(
  token: string,
  subreddit: string,
  title: string,
  body: string,
): Promise<{ fullname: string; url: string }> {
  const res = await fetch("https://oauth.reddit.com/api/submit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "clab-webhooks/1.0",
    },
    body: new URLSearchParams({ kind: "self", sr: subreddit, title, text: body, resubmit: "true" }),
  });

  const data = (await res.json()) as {
    json?: { errors?: [string, string, string][]; data?: { name: string; url: string } };
  };
  const errors = data.json?.errors;
  if (errors && errors.length > 0) throw new Error(errors.map((e) => e[1]).join(", "));
  const postData = data.json?.data;
  if (!postData) throw new Error("Submit returned no post data");
  return { fullname: postData.name, url: postData.url };
}

export async function crosspostTo(
  token: string,
  targetSubreddit: string,
  sourceFullname: string,
  title: string,
): Promise<string> {
  const res = await fetch("https://oauth.reddit.com/api/crosspost", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "clab-webhooks/1.0",
    },
    body: new URLSearchParams({
      sr: targetSubreddit,
      kind: "crosspost",
      title,
      crosspost_fullname: sourceFullname,
      resubmit: "true",
    }),
  });

  const data = (await res.json()) as {
    json?: { errors?: [string, string, string][]; data?: { url: string } };
  };
  const errors = data.json?.errors;
  if (errors && errors.length > 0) throw new Error(errors.map((e) => e[1]).join(", "));
  const url = data.json?.data?.url;
  if (!url) throw new Error("Crosspost returned no URL");
  return url;
}
