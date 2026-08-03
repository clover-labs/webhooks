import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cal.com signs webhook bodies with HMAC-SHA256 (hex digest) of the raw request
 * body, sent in the `X-Cal-Signature-256` header. NOT independently verified
 * against a real Cal.com payload yet — confirm header name + digest format via
 * the "Ping test" button on the webhook (Settings > Webhooks) before relying on
 * this in production. If verification starts rejecting everything, log the
 * actual header name/value seen and compare against Cal.com's current docs.
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
