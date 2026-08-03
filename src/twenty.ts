/**
 * Twenty CRM client, scoped to what the Cal.com booking webhook needs:
 * create a Company + Opportunity for a new lead, with a Note carrying
 * whatever booking context doesn't fit a structured field.
 *
 * Field names and enum values below were confirmed live against
 * GET {TWENTY_API_URL}/metadata/objects (2026-08-03) — see
 * scripts/check-twenty-schema.ts to re-verify these haven't drifted:
 *   Company.leadSource     FOUNDER_NETWORK | REFERRAL | COLD_OUTREACH | INBOUND | OTHER | ORGANIC
 *   Company.lifecycleStage PROSPECT | ONBOARDING | ADOPTION | EXPANSION | RENEWED | CHURNED
 *   Opportunity.stage      AWARENESS | EDUCATION | SELECTION | COMMITMENT | WON | LOST
 *   Opportunity.dealType   APP_DEVELOPMENT | SOCIAL_MEDIA_MANAGEMENT | PILOT
 *
 * The mutation response envelope (`{ data: { create<Type>: {...} } }`) was
 * confirmed live too, via scripts/test-live-calcom-booking.ts (see
 * docs/_notes/webhooks-testing-shaping.md) — that script targets
 * TEST_PROJECT_ID instead of CLB_PROJECT_ID, so live end-to-end checks don't
 * touch real reporting: ceo/_scripts/crm.ts already filters everything to
 * `projectId === CLB_PROJECT_ID`, so Test-project records are invisible to
 * it by construction, not by remembering to delete them afterward.
 */

export const CLB_PROJECT_ID = "3aa6e453-b041-4891-8089-3f9c00b2a62c"; // see ceo/_scripts/crm.ts
export const TEST_PROJECT_ID = "e60f457f-cd37-467b-a493-8fdb91b4eb41"; // "Test" project, created 2026-08-03 for live-but-safe checks

export type LeadSource = "FOUNDER_NETWORK" | "REFERRAL" | "COLD_OUTREACH" | "INBOUND" | "OTHER" | "ORGANIC";
export type OpportunityStage = "AWARENESS" | "EDUCATION" | "SELECTION" | "COMMITMENT" | "WON" | "LOST";

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const url = `${process.env.TWENTY_API_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.TWENTY_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twenty API ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return res.json();
}

function extractCreated(res: any, mutationKey: string): { id: string } {
  const created = res?.data?.[mutationKey] ?? res?.data;
  if (!created?.id) {
    throw new Error(
      `Twenty API: couldn't find "${mutationKey}.id" (or "data.id") in response: ${JSON.stringify(res).slice(0, 500)}`,
    );
  }
  return created;
}

export async function createCompany(opts: {
  name: string;
  domain?: string;
  leadSource: LeadSource;
  projectId?: string; // defaults to CLB_PROJECT_ID — override only for live testing (TEST_PROJECT_ID)
}): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    name: opts.name,
    leadSource: opts.leadSource,
    lifecycleStage: "PROSPECT",
    projectId: opts.projectId ?? CLB_PROJECT_ID,
  };
  if (opts.domain) {
    body.domainName = { primaryLinkUrl: `https://${opts.domain}`, primaryLinkLabel: "" };
  }
  const res = await api("POST", "/companies", body);
  return extractCreated(res, "createCompany");
}

export async function createOpportunity(opts: {
  name: string;
  companyId: string;
  stage: OpportunityStage;
  projectId?: string; // defaults to CLB_PROJECT_ID — see createCompany; Opportunity has its own project relation, doesn't inherit from Company
}): Promise<{ id: string }> {
  const res = await api("POST", "/opportunities", {
    name: opts.name,
    companyId: opts.companyId,
    stage: opts.stage,
    projectId: opts.projectId ?? CLB_PROJECT_ID,
  });
  return extractCreated(res, "createOpportunity");
}

export async function createNoteForOpportunity(opts: {
  title: string;
  markdown: string;
  opportunityId: string;
}): Promise<{ id: string }> {
  const noteRes = await api("POST", "/notes", {
    title: opts.title,
    bodyV2: { markdown: opts.markdown },
  });
  const note = extractCreated(noteRes, "createNote");
  // Field name confirmed from ceo/_scripts/crm.ts's docstring: "Notes attached
  // to an opportunity (via noteTargets.targetOpportunityId)".
  await api("POST", "/noteTargets", {
    noteId: note.id,
    targetOpportunityId: opts.opportunityId,
  });
  return note;
}
