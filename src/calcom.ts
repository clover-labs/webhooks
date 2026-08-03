import { createHmac, timingSafeEqual } from "node:crypto";
import { createCompany, createOpportunity, createNoteForOpportunity } from "./twenty.ts";

/**
 * Cal.com signs webhook bodies with HMAC-SHA256 (hex digest) of the raw request
 * body, sent in the `X-Cal-Signature-256` header. Confirmed live 2026-08-03 via
 * Cal.com's own "Ping test" (passed, status 200) and a real signed test payload
 * against the production endpoint (docs/_notes/webhooks-testing-shaping.md) —
 * not just assumed from docs anymore.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const givenBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}

export type CalcomAttendee = {
  email: string;
  name: string;
  timeZone?: string;
};

export type CalcomResponseValue = {
  label?: string;
  value: unknown;
};

export type CalcomBookingPayload = {
  triggerEvent: string;
  payload: {
    uid: string;
    title: string;
    startTime: string;
    attendees: CalcomAttendee[];
    responses?: Record<string, CalcomResponseValue>;
  };
};

// Cal.com's built-in system fields — anything else in `responses` is a custom
// question configured on the event type (e.g. "What is this meeting about?").
const STANDARD_RESPONSE_KEYS = new Set([
  "name",
  "email",
  "location",
  "guests",
  "notes",
  "attendeePhoneNumber",
  "rescheduleReason",
]);

/**
 * Pulls out only the custom (non-standard) booking-question answers as
 * "Label: value" lines, for dropping into a CRM note. Deliberately generic
 * rather than hardcoding a specific question's response key — the exact key
 * Cal.com uses for a given custom question hasn't been confirmed against a
 * real payload, so scanning for "whatever isn't a known standard field" is
 * more robust than guessing one key name and silently missing the answer.
 */
export function extractCustomAnswers(responses: Record<string, CalcomResponseValue> | undefined): string {
  if (!responses) return "";
  const lines: string[] = [];
  for (const [key, resp] of Object.entries(responses)) {
    if (STANDARD_RESPONSE_KEYS.has(key)) continue;
    const value = resp?.value;
    if (value === undefined || value === null || value === "") continue;
    lines.push(`${resp.label ?? key}: ${value}`);
  }
  return lines.join("\n");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Pure request handler — takes its config as parameters rather than reading
 * process.env directly, so it's directly unit-testable (see calcom.test.ts)
 * without needing index.ts's Bun.serve() to be running.
 */
export async function handleCalcomBooking(
  req: Request,
  config: { webhookSecret: string; projectId?: string },
): Promise<Response> {
  // Must verify against the *raw* body text — re-serializing parsed JSON
  // before hashing would not match Cal.com's signature.
  const rawBody = await req.text();
  const signature = req.headers.get("x-cal-signature-256");
  if (!verifySignature(rawBody, signature, config.webhookSecret)) {
    console.error(`Calcom webhook: signature mismatch (header present: ${signature !== null})`);
    return jsonResponse(401, { ok: false, error: "invalid signature" });
  }

  let payload: CalcomBookingPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid JSON body" });
  }

  if (payload.triggerEvent !== "BOOKING_CREATED") {
    return jsonResponse(200, { ok: true, skipped: `triggerEvent ${payload.triggerEvent} not handled` });
  }

  const attendee = payload.payload?.attendees?.[0];
  if (!attendee?.email || !attendee?.name) {
    return jsonResponse(400, { ok: false, error: "booking payload missing attendee name/email" });
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
      projectId: config.projectId,
    });

    const opportunity = await createOpportunity({
      name: `${attendee.name} — Free Consultation`,
      companyId: company.id,
      stage: "AWARENESS",
      projectId: config.projectId,
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

    return jsonResponse(200, { ok: true, companyId: company.id, opportunityId: opportunity.id });
  } catch (err) {
    console.error("Calcom booking -> Twenty CRM failed:", err);
    return jsonResponse(502, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
