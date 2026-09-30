import { test, expect, describe, beforeEach } from "bun:test";
import { handleBrief, toMarkdown, renderPage, type Brief } from "./brief.ts";
import { southBend } from "./briefs/south-bend.ts";

const URL_BASE = "http://start.cloverlabs.dev";

function post(slug: string, body: unknown): Request {
  return new Request(`${URL_BASE}/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Tests never write to Twenty: without TWENTY_API_URL the handler dry-runs.
beforeEach(() => {
  delete process.env.TWENTY_API_URL;
});

// ── toMarkdown ──────────────────────────────────────────────────────────────

describe("toMarkdown", () => {
  test("lists every question, marking skipped ones — a missing answer must be visible in the CRM, not silently dropped", () => {
    const md = toMarkdown(southBend, { name: "Rocco", users: ["Our own team", "Their employees"] });
    for (const f of southBend.sections.flatMap((s) => s.fields)) expect(md).toContain(`**${f.label}**`);
    expect(md).toContain("Rocco");
    expect(md).toContain("Our own team, Their employees");
    expect(md).toContain("_skipped_");
  });

  test("groups answers under their section headings, so the note reads in the same order as the form", () => {
    const md = toMarkdown(southBend, {});
    const headings = southBend.sections.map((s) => md.indexOf(`## ${s.title}`));
    expect(headings.every((h) => h >= 0)).toBe(true);
    expect([...headings].sort((a, b) => a - b)).toEqual(headings);
  });
});

// ── handleBrief ─────────────────────────────────────────────────────────────

describe("handleBrief", () => {
  test("unknown client slug is a 404, so one client can't see another's link by guessing", async () => {
    const res = await handleBrief(new Request(`${URL_BASE}/someone-else`));
    expect(res.status).toBe(404);
  });

  test("GET serves the page with that client's questions", async () => {
    const res = await handleBrief(new Request(`${URL_BASE}/south-bend`));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("What does the app do?");
    expect(html).not.toContain("__CONFIG__");
  });

  test("rejects a submission without the required name — we need to know who answered", async () => {
    const res = await handleBrief(post("south-bend", { answers: { what: "x" } }));
    expect(res.status).toBe(400);
  });

  test("accepts a valid submission", async () => {
    const res = await handleBrief(post("south-bend", { answers: { name: "Rocco" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test("honeypot-filled submissions get a fake success, so bots don't retry", async () => {
    const res = await handleBrief(post("south-bend", { answers: {}, website: "spam.example" }));
    expect(res.status).toBe(200);
  });

  test("oversized bodies are refused", async () => {
    const res = await handleBrief(post("south-bend", { answers: { name: "x".repeat(70_000) } }));
    expect(res.status).toBe(413);
  });
});

// ── renderPage ──────────────────────────────────────────────────────────────

test("config text containing </script> can't break out of the inline script", async () => {
  const evil: Brief = { ...southBend, intro: "</script><script>alert(1)</script>" };
  const html = await renderPage(evil).text();
  expect(html).not.toContain("</script><script>alert(1)");
});

// ── resend after sending ───────────────────────────────────────────────────

describe("resend", () => {
  test("a resent submission is saved as a separate 'Updated answers' note, so the original answers stay in the CRM", async () => {
    process.env.TWENTY_API_URL = "https://twenty.test";
    const titles: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (String(url).endsWith("/notes")) titles.push(body.title);
      return new Response(JSON.stringify({ data: { id: "x" } }), { status: 200 });
    }) as typeof fetch;
    try {
      await handleBrief(post("south-bend", { answers: { name: "Rocco" } }));
      await handleBrief(post("south-bend", { answers: { name: "Rocco" }, update: true }));
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(titles).toEqual(["Questionnaire answers — Rocco", "Updated answers — Rocco"]);
  });
});

// ── email notification ─────────────────────────────────────────────────────

describe("email notification", () => {
  test("a failing email never fails the submission — the answers are already saved in Twenty", async () => {
    process.env.TWENTY_API_URL = "https://twenty.test";
    Object.assign(process.env, {
      BRIEF_NOTIFY_TO: "team@example.com",
      SES_ACCESS_KEY_ID: "AKIDEXAMPLE",
      SES_SECRET_ACCESS_KEY: "secret",
      SES_FROM_ADDRESS: "noreply@example.com",
    });
    const hits: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      hits.push(String(url));
      if (String(url).includes("amazonaws.com")) return new Response("throttled", { status: 500 });
      return new Response(JSON.stringify({ data: { id: "x" } }), { status: 200 });
    }) as typeof fetch;
    try {
      const res = await handleBrief(post("south-bend", { answers: { name: "Rocco" } }));
      expect(res.status).toBe(200);
      expect(hits.some((u) => u.endsWith("/notes"))).toBe(true);
      expect(hits.some((u) => u.includes("email.eu-central-1.amazonaws.com"))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      for (const k of ["BRIEF_NOTIFY_TO", "SES_ACCESS_KEY_ID", "SES_SECRET_ACCESS_KEY", "SES_FROM_ADDRESS"]) delete process.env[k];
    }
  });

  test("if Twenty fails, no email goes out claiming answers were saved", async () => {
    process.env.TWENTY_API_URL = "https://twenty.test";
    Object.assign(process.env, { BRIEF_NOTIFY_TO: "t@example.com", SES_ACCESS_KEY_ID: "a", SES_SECRET_ACCESS_KEY: "b", SES_FROM_ADDRESS: "c@example.com" });
    const hits: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      hits.push(String(url));
      return new Response("down", { status: 500 });
    }) as typeof fetch;
    try {
      const res = await handleBrief(post("south-bend", { answers: { name: "Rocco" } }));
      expect(res.status).toBe(502);
      expect(hits.some((u) => u.includes("amazonaws.com"))).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
      for (const k of ["BRIEF_NOTIFY_TO", "SES_ACCESS_KEY_ID", "SES_SECRET_ACCESS_KEY", "SES_FROM_ADDRESS"]) delete process.env[k];
    }
  });
});
