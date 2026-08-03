/**
 * CLAB Webhook Server
 *
 * POST /post
 *   Authorization: Bearer <WEBHOOK_SECRET>
 *   Content-Type: application/json
 *   { "title": "...", "body": "...", "home": "KlubKGB", "targets": ["r/Maribor"] }
 *
 * POST /calcom-booking
 *   X-Cal-Signature-256: <HMAC-SHA256 of raw body, using CALCOM_WEBHOOK_SECRET>
 *   Content-Type: application/json
 *   Cal.com "Booking created" webhook payload (blendor-clover/30-min event type)
 *   Creates a Company + Opportunity in Twenty CRM for the booking's attendee.
 *
 * Env vars:
 *   WEBHOOK_SECRET, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET,
 *   REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_HOME_SUBREDDIT,
 *   CALCOM_WEBHOOK_SECRET, TWENTY_API_URL, TWENTY_API_TOKEN
 */

import { loadEnv, getAccessToken, submitPost, crosspostTo } from "./reddit.ts";
import { verifySignature, extractCustomAnswers, type CalcomBookingPayload } from "./calcom.ts";
import { createCompany, createOpportunity, createNoteForOpportunity } from "./twenty.ts";

loadEnv();

const PORT = Number(process.env.PORT ?? 3000);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const CALCOM_WEBHOOK_SECRET = process.env.CALCOM_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  console.error("Error: WEBHOOK_SECRET must be set");
  process.exit(1);
}
// CALCOM_WEBHOOK_SECRET is checked per-request (not at startup) so the Reddit
// /post route keeps working even before Cal.com's webhook is configured.

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

    if (req.method === "POST" && pathname === "/post") return handleRedditPost(req);
    if (req.method === "POST" && pathname === "/calcom-booking") return handleCalcomBooking(req);
    return json(404, { ok: false, error: "not found" });
  },
});

console.log(`CLAB webhooks listening on :${PORT}`);

async function handleRedditPost(req: Request): Promise<Response> {
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
}

async function handleCalcomBooking(req: Request): Promise<Response> {
  if (!CALCOM_WEBHOOK_SECRET) {
    console.error("CALCOM_WEBHOOK_SECRET not set — rejecting /calcom-booking request");
    return json(503, { ok: false, error: "calcom integration not configured" });
  }

  // Must verify against the *raw* body text — re-serializing parsed JSON
  // before hashing would not match Cal.com's signature.
  const rawBody = await req.text();
  const signature = req.headers.get("x-cal-signature-256");
  if (!verifySignature(rawBody, signature, CALCOM_WEBHOOK_SECRET)) {
    console.error(`Calcom webhook: signature mismatch (header present: ${signature !== null})`);
    return json(401, { ok: false, error: "invalid signature" });
  }

  let payload: CalcomBookingPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { ok: false, error: "invalid JSON body" });
  }

  if (payload.triggerEvent !== "BOOKING_CREATED") {
    return json(200, { ok: true, skipped: `triggerEvent ${payload.triggerEvent} not handled` });
  }

  const attendee = payload.payload?.attendees?.[0];
  if (!attendee?.email || !attendee?.name) {
    return json(400, { ok: false, error: "booking payload missing attendee name/email" });
  }

  const domain = attendee.email.split("@")[1];

  try {
    const company = await createCompany({
      name: attendee.name,
      domain,
      // Booked through the public website widget with no referrer field on
      // the form — defaulting to INBOUND. Founders should reclassify to
      // REFERRAL or ORGANIC during Qualify once they know which it is; the
      // webhook has no way to tell those apart on its own.
      leadSource: "INBOUND",
    });

    const opportunity = await createOpportunity({
      name: `${attendee.name} — Free Consultation`,
      companyId: company.id,
      stage: "AWARENESS",
      // dealType intentionally left unset — the booking doesn't say which
      // service line this is; the founder sets it during Qualify.
    });

    const customAnswers = extractCustomAnswers(payload.payload.responses);
    const noteLines = [
      `Booked via cloverlabs.io: "${payload.payload.title}"`,
      `Start time: ${payload.payload.startTime}`,
      customAnswers,
    ].filter(Boolean);
    await createNoteForOpportunity({
      title: "Cal.com booking",
      markdown: noteLines.join("\n\n"),
      opportunityId: opportunity.id,
    });

    return json(200, { ok: true, companyId: company.id, opportunityId: opportunity.id });
  } catch (err) {
    console.error("Calcom booking -> Twenty CRM failed:", err);
    return json(502, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
