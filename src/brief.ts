import { createNoteForOpportunity } from "./twenty.ts";
import { sendEmail, sesConfigured } from "./ses.ts";
import { southBend } from "./briefs/south-bend.ts";

/**
 * Client questionnaires ("briefs") on start.cloverlabs.dev — a Typeform-style
 * page per client, one question per screen. Answers land as a Note on that
 * client's existing Opportunity in Twenty.
 *
 * GET  /:slug  → the page (brief.html with the brief's config inlined)
 * POST /:slug  → { answers: { [fieldId]: string | string[] }, update?: boolean, website?: string }
 *               update = resent after an earlier submission; lands as a separate
 *               "Updated answers" note so the original stays intact.
 *
 * After saving, an email goes to BRIEF_NOTIFY_TO (best effort — the answers
 * are already safe in Twenty, so a failed email never fails the submission).
 *
 * New client = one data file in briefs/ + one line in BRIEFS. The page itself
 * is shared.
 */

export type Field = {
  id: string;
  type: "text" | "long" | "url" | "single" | "multi";
  label: string;
  help?: string;
  placeholder?: string;
  options?: string[];
  required?: boolean;
};

export type Brief = {
  slug: string;
  company: string;
  opportunityId: string;
  title: string;
  intro: string;
  sections: { title: string; fields: Field[] }[];
};

export type Answers = Record<string, string | string[]>;

const BRIEFS: Record<string, Brief> = {
  [southBend.slug]: southBend,
};

const MAX_BODY_BYTES = 64 * 1024;
const PAGE = await Bun.file(new URL("./brief.html", import.meta.url)).text();

export async function handleBrief(req: Request): Promise<Response> {
  const slug = new URL(req.url).pathname.replace(/^\/|\/$/g, "");
  const brief = BRIEFS[slug];
  if (!brief) return new Response("Not found", { status: 404 });

  if (req.method === "GET") return renderPage(brief);
  if (req.method === "POST") return submit(req, brief);
  return new Response("Method not allowed", { status: 405 });
}

export function renderPage(brief: Brief): Response {
  // "<" escaped so text in the config can't close the <script> tag early.
  const config = JSON.stringify(brief).replace(/</g, "\\u003c");
  // Function replacers: a string replacement would interpret "$&" etc. inside the config.
  const html = PAGE.replace("__TITLE__", () => escapeHtml(`${brief.title} · Clover Labs`)).replace(
    "__CONFIG__",
    () => config,
  );
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function submit(req: Request, brief: Brief): Promise<Response> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { ok: false, error: "too large" });

  let body: { answers?: Answers; update?: boolean; website?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "invalid JSON body" });
  }
  // Honeypot: a hidden field real people never see. Pretend success so bots don't retry.
  if (body.website) return json(200, { ok: true });

  const answers = body.answers ?? {};
  const missing = allFields(brief).filter((f) => f.required && isEmpty(answers[f.id]));
  if (missing.length) return json(400, { ok: false, error: `missing: ${missing.map((f) => f.id).join(", ")}` });

  const markdown = toMarkdown(brief, answers);
  const title = `${body.update ? "Updated answers" : "Questionnaire answers"} — ${answers.name ?? brief.company}`;
  const dryRun = !process.env.TWENTY_API_URL;
  if (dryRun) {
    // Local dev only — prod always has TWENTY_API_URL set in Coolify.
    console.warn(`[brief] TWENTY_API_URL not set — not saving. Would have written:\n${markdown}`);
  } else {
    try {
      await createNoteForOpportunity({ title, markdown, opportunityId: brief.opportunityId });
    } catch (err) {
      console.error(`[brief] ${brief.slug}: Twenty write failed`, err);
      return json(502, { ok: false, error: "could not save answers" });
    }
  }

  await notify(brief, title, markdown);
  return json(200, dryRun ? { ok: true, dryRun } : { ok: true });
}

async function notify(brief: Brief, title: string, markdown: string): Promise<void> {
  const to = process.env.BRIEF_NOTIFY_TO;
  if (!to || !sesConfigured()) {
    console.error(`[brief] ${brief.slug}: email not sent — BRIEF_NOTIFY_TO or SES_* env missing`);
    return;
  }
  try {
    await sendEmail({
      to,
      subject: `${brief.company}: ${title}`,
      text: `${markdown}\n\n---\nSaved in Twenty: https://crm.cloverlabs.dev/object/opportunity/${brief.opportunityId}`,
    });
  } catch (err) {
    console.error(`[brief] ${brief.slug}: email failed (answers are saved in Twenty)`, err);
  }
}

export function toMarkdown(brief: Brief, answers: Answers): string {
  const out: string[] = [];
  for (const section of brief.sections) {
    out.push(`## ${section.title}`, "");
    for (const f of section.fields) {
      const a = answers[f.id];
      const text = isEmpty(a) ? "_skipped_" : Array.isArray(a) ? a.join(", ") : String(a).trim();
      out.push(`**${f.label}**`, text, "");
    }
  }
  return out.join("\n").trim();
}

function allFields(brief: Brief): Field[] {
  return brief.sections.flatMap((s) => s.fields);
}

function isEmpty(a: string | string[] | undefined): boolean {
  return a === undefined || (Array.isArray(a) ? a.length === 0 : String(a).trim() === "");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
