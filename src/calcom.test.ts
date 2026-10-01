import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { createHmac } from "node:crypto";
import { verifySignature, extractCustomAnswers, dealTypeFromResponses, handleCalcomBooking, companyDomain } from "./calcom.ts";

const SECRET = "test-secret-do-not-use-in-prod";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// ── verifySignature ─────────────────────────────────────────────────────────

describe("verifySignature", () => {
  test("accepts a correctly signed body", () => {
    const body = JSON.stringify({ hello: "world" });
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  test("rejects a signature computed with the wrong secret", () => {
    const body = JSON.stringify({ hello: "world" });
    expect(verifySignature(body, sign(body, "wrong-secret"), SECRET)).toBe(false);
  });

  test("rejects a missing signature header", () => {
    const body = JSON.stringify({ hello: "world" });
    expect(verifySignature(body, null, SECRET)).toBe(false);
  });

  test("rejects a garbage signature without throwing", () => {
    expect(verifySignature("body", "not-hex-and-wrong-length", SECRET)).toBe(false);
  });
});

// ── extractCustomAnswers ─────────────────────────────────────────────────────

describe("extractCustomAnswers", () => {
  test("returns empty string for undefined responses", () => {
    expect(extractCustomAnswers(undefined)).toBe("");
  });

  test("skips Cal.com's standard fields", () => {
    const answers = extractCustomAnswers({
      name: { label: "Your name", value: "Jane" },
      email: { label: "Email", value: "jane@example.com" },
      attendeePhoneNumber: { label: "Phone", value: "+1234" },
    });
    expect(answers).toBe("");
  });

  test("includes a custom question by label, skipping empty values", () => {
    const answers = extractCustomAnswers({
      name: { label: "Your name", value: "Jane" },
      whatIsThisMeetingAbout: { label: "What is this meeting about?", value: "MVP build" },
      notes: { label: "Additional notes", value: "" },
    });
    expect(answers).toBe("What is this meeting about?: MVP build");
  });

  test("falls back to the raw key when no label is present", () => {
    const answers = extractCustomAnswers({ someCustomField: { value: "42" } });
    expect(answers).toBe("someCustomField: 42");
  });
});

// ── dealTypeFromResponses ───────────────────────────────────────────────────

describe("dealTypeFromResponses", () => {
  // Each booking must land on the right service line, or the offer test
  // (AI apps vs. marketing vs. staff-aug) can't be read from the CRM.
  const answer = (value: unknown) => ({ service: { label: "What do you need help with?", value } });

  test("maps every build-type answer to APP_DEVELOPMENT", () => {
    for (const v of ["AI apps / fix a vibe-coded app", "Build a new product (MVP)", "Extend my dev team"]) {
      expect(dealTypeFromResponses(answer(v))).toBe("APP_DEVELOPMENT");
    }
  });

  test("maps the marketing answer to SOCIAL_MEDIA_MANAGEMENT", () => {
    expect(dealTypeFromResponses(answer("Market my product"))).toBe("SOCIAL_MEDIA_MANAGEMENT");
  });

  test("leaves 'Something else', unknown/renamed options and missing answers unset rather than guessing", () => {
    expect(dealTypeFromResponses(answer("Something else"))).toBeUndefined();
    expect(dealTypeFromResponses(answer("Social media management"))).toBeUndefined();
    expect(dealTypeFromResponses(answer(["Market my product"]))).toBeUndefined();
    expect(dealTypeFromResponses(undefined)).toBeUndefined();
    expect(dealTypeFromResponses({})).toBeUndefined();
  });
});

// ── handleCalcomBooking ──────────────────────────────────────────────────────

function bookingPayload(overrides: Partial<{ triggerEvent: string; attendees: unknown[]; service: string }> = {}) {
  return JSON.stringify({
    triggerEvent: overrides.triggerEvent ?? "BOOKING_CREATED",
    payload: {
      uid: "test-uid",
      title: "Free Consultation - Clover Labs between Blendor and Jane Doe",
      startTime: "2026-08-10T10:00:00Z",
      attendees: overrides.attendees ?? [{ email: "jane@example.com", name: "Jane Doe", timeZone: "UTC" }],
      responses: {
        name: { label: "Your name", value: "Jane Doe" },
        email: { label: "Email", value: "jane@example.com" },
        whatIsThisMeetingAbout: { label: "What is this meeting about?", value: "MVP build" },
        ...(overrides.service ? { service: { label: "What do you need help with?", value: overrides.service } } : {}),
      },
    },
  });
}

let originalFetch: typeof fetch;
let calls: { method: string; url: string; body: any }[];
// Companies the domain lookup (GET /companies?filter=…) returns — empty unless a test sets it.
let existingCompanies: { id: string; domainName: { primaryLinkUrl: string } }[];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls = [];
  existingCompanies = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Mocks the exact sequence of Twenty API calls a successful booking makes. */
function mockTwentySuccess() {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method: init?.method ?? "GET", url: String(url), body });
    if (String(url).includes("/companies?filter=")) {
      return jsonRes({ data: { companies: existingCompanies } });
    }
    if (String(url).endsWith("/companies")) {
      return jsonRes({ data: { createCompany: { id: "company-1" } } });
    }
    if (String(url).endsWith("/opportunities")) {
      return jsonRes({ data: { createOpportunity: { id: "opportunity-1" } } });
    }
    if (String(url).endsWith("/notes")) {
      return jsonRes({ data: { createNote: { id: "note-1" } } });
    }
    if (String(url).endsWith("/noteTargets")) {
      return jsonRes({ data: { createNoteTarget: { id: "notetarget-1" } } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("handleCalcomBooking", () => {
  test("rejects an invalid signature and makes no Twenty API calls", async () => {
    mockTwentySuccess();
    const body = bookingPayload();
    const req = new Request("http://localhost/calcom-booking", {
      method: "POST",
      body,
      headers: { "x-cal-signature-256": "deadbeef" },
    });
    const res = await handleCalcomBooking(req, { webhookSecret: SECRET });
    expect(res.status).toBe(401);
    expect(calls.length).toBe(0);
  });

  test("skips non-booking-created events without calling Twenty", async () => {
    mockTwentySuccess();
    const body = bookingPayload({ triggerEvent: "MEETING_ENDED" });
    const req = new Request("http://localhost/calcom-booking", {
      method: "POST",
      body,
      headers: { "x-cal-signature-256": sign(body) },
    });
    const res = await handleCalcomBooking(req, { webhookSecret: SECRET });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBeDefined();
    expect(calls.length).toBe(0);
  });

  test("rejects a booking with no attendee", async () => {
    mockTwentySuccess();
    const body = bookingPayload({ attendees: [] });
    const req = new Request("http://localhost/calcom-booking", {
      method: "POST",
      body,
      headers: { "x-cal-signature-256": sign(body) },
    });
    const res = await handleCalcomBooking(req, { webhookSecret: SECRET });
    expect(res.status).toBe(400);
    expect(calls.length).toBe(0);
  });

  test("creates Company + Opportunity + Note with correct fields on a valid booking", async () => {
    mockTwentySuccess();
    const body = bookingPayload();
    const req = new Request("http://localhost/calcom-booking", {
      method: "POST",
      body,
      headers: { "x-cal-signature-256": sign(body) },
    });
    const res = await handleCalcomBooking(req, { webhookSecret: SECRET });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, companyId: "company-1", opportunityId: "opportunity-1" });

    expect(calls.length).toBe(5);
    const [lookupCall, companyCall, opportunityCall, noteCall, noteTargetCall] = calls;

    expect(lookupCall.method).toBe("GET");
    expect(decodeURIComponent(lookupCall.url)).toContain("example.com");
    expect(companyCall.body).toMatchObject({ name: "Jane Doe", leadSource: "INBOUND", lifecycleStage: "PROSPECT" });
    expect(opportunityCall.body).toMatchObject({ companyId: "company-1", stage: "AWARENESS" });
    expect(opportunityCall.body).not.toHaveProperty("dealType");
    expect(noteCall.body.bodyV2.markdown).toContain("What is this meeting about?: MVP build");
    expect(noteTargetCall.body).toMatchObject({ noteId: "note-1", targetOpportunityId: "opportunity-1" });
  });

  test("sets dealType from the booking's service answer and keeps the answer in the note", async () => {
    mockTwentySuccess();
    const body = bookingPayload({ service: "Market my product" });
    const req = new Request("http://localhost/calcom-booking", {
      method: "POST",
      body,
      headers: { "x-cal-signature-256": sign(body) },
    });
    const res = await handleCalcomBooking(req, { webhookSecret: SECRET });
    expect(res.status).toBe(200);

    const [, , opportunityCall, noteCall] = calls; // [lookup, company, opportunity, note, …]
    expect(opportunityCall.body).toMatchObject({ stage: "AWARENESS", dealType: "SOCIAL_MEDIA_MANAGEMENT" });
    expect(noteCall.body.bodyV2.markdown).toContain("What do you need help with?: Market my product");
  });

  test("passes a projectId override through to Company and Opportunity when given", async () => {
    mockTwentySuccess();
    const body = bookingPayload();
    const req = new Request("http://localhost/calcom-booking", {
      method: "POST",
      body,
      headers: { "x-cal-signature-256": sign(body) },
    });
    await handleCalcomBooking(req, { webhookSecret: SECRET, projectId: "TEST_PROJECT" });

    const [, companyCall, opportunityCall] = calls; // [lookup, company, opportunity, …]
    expect(companyCall.body).toMatchObject({ projectId: "TEST_PROJECT" });
    expect(opportunityCall.body).toMatchObject({ projectId: "TEST_PROJECT" });
  });

  test("returns 502 with a clear message when Twenty API fails", async () => {
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    const body = bookingPayload();
    const req = new Request("http://localhost/calcom-booking", {
      method: "POST",
      body,
      headers: { "x-cal-signature-256": sign(body) },
    });
    const res = await handleCalcomBooking(req, { webhookSecret: SECRET });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});

// ── duplicate companies (bug: "A duplicate entry was detected") ────────────
// Twenty allows one Company per domain. Before this fix, the first gmail.com
// booker claimed "gmail.com" and every later gmail.com booking was lost, and a
// second booker from a known business domain was lost the same way.

function signedBooking(email: string, name = "Jane Doe"): Request {
  const body = bookingPayload({ attendees: [{ email, name, timeZone: "UTC" }] });
  return new Request("http://localhost/calcom-booking", {
    method: "POST",
    body,
    headers: { "x-cal-signature-256": sign(body) },
  });
}

describe("companyDomain", () => {
  test("free-mail addresses have no company domain", () => {
    expect(companyDomain("someone@gmail.com")).toBeUndefined();
    expect(companyDomain("someone@Outlook.com")).toBeUndefined();
  });

  test("country variants of free-mail providers have no company domain either (Alisha booked from outlook.in)", () => {
    expect(companyDomain("someone@outlook.in")).toBeUndefined();
    expect(companyDomain("someone@yahoo.co.uk")).toBeUndefined();
    expect(companyDomain("someone@hotmail.fr")).toBeUndefined();
  });

  test("a business whose name merely contains a provider name keeps its domain", () => {
    expect(companyDomain("jo@outlookstudio.com")).toBe("outlookstudio.com");
    expect(companyDomain("jo@mail.gmailtools.io")).toBe("mail.gmailtools.io");
  });

  test("business domains are kept, lowercased", () => {
    expect(companyDomain("rocco@SouthBendMgmt.com")).toBe("southbendmgmt.com");
  });
});

describe("handleCalcomBooking — duplicate companies", () => {
  test("a gmail.com booker gets a Company without a domain, so they can't block the next gmail.com booker", async () => {
    mockTwentySuccess();
    const res = await handleCalcomBooking(signedBooking("jane@gmail.com"), { webhookSecret: SECRET });
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.url.includes("/companies?filter="))).toBe(false);
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/companies"))!;
    expect(create.body).not.toHaveProperty("domainName");
  });

  test("a second booker from a known business domain reuses that Company instead of failing", async () => {
    mockTwentySuccess();
    existingCompanies = [{ id: "existing-co", domainName: { primaryLinkUrl: "https://www.acme.com" } }];
    const res = await handleCalcomBooking(signedBooking("bob@acme.com", "Bob"), { webhookSecret: SECRET });
    expect(res.status).toBe(200);
    expect((await res.json()).companyId).toBe("existing-co");
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/companies"))).toBe(false);
    const opp = calls.find((c) => c.url.endsWith("/opportunities"))!;
    expect(opp.body.companyId).toBe("existing-co");
  });

  test("a lookup hit on a look-alike domain (notacme.com) is not reused", async () => {
    mockTwentySuccess();
    existingCompanies = [{ id: "other-co", domainName: { primaryLinkUrl: "https://notacme.com" } }];
    const res = await handleCalcomBooking(signedBooking("bob@acme.com", "Bob"), { webhookSecret: SECRET });
    expect((await res.json()).companyId).toBe("company-1");
  });
});
