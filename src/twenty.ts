/**
 * Twenty CRM client, scoped to what the Cal.com booking webhook needs:
 * create a Company + Opportunity for a new lead, with a Note carrying
 * whatever booking context doesn't fit a structured field.
 *
 * Field names and enum values below were confirmed live against
 * GET {TWENTY_API_URL}/metadata/objects (2026-08-03), NOT guessed:
 *   Company.leadSource     FOUNDER_NETWORK | REFERRAL | COLD_OUTREACH | INBOUND | OTHER | ORGANIC
 *   Company.lifecycleStage PROSPECT | ONBOARDING | ADOPTION | EXPANSION | RENEWED | CHURNED
 *   Opportunity.stage      AWARENESS | EDUCATION | SELECTION | COMMITMENT | WON | LOST
 *   Opportunity.dealType   APP_DEVELOPMENT | SOCIAL_MEDIA_MANAGEMENT | PILOT
 *
 * One thing NOT verified live: the exact JSON envelope a POST mutation
 * returns (assumed to mirror Twenty's documented `{ data: { create<Type>: {...} } }`
 * shape, matching how GETs already work in ceo/_scripts/crm.ts and
 * code/gtm/src/twenty.ts). Deliberately not tested with a real POST here —
 * that would create throwaway records in the live production CRM. The first
 * real webhook delivery is the real test; parsing below throws a clear,
 * debuggable error (including the raw response) if the shape doesn't match
 * rather than silently returning `undefined`.
 */

const CLB_PROJECT_ID = "3aa6e453-b041-4891-8089-3f9c00b2a62c"; // see ceo/_scripts/crm.ts

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
}): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    name: opts.name,
    leadSource: opts.leadSource,
    lifecycleStage: "PROSPECT",
    projectId: CLB_PROJECT_ID,
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
}): Promise<{ id: string }> {
  const res = await api("POST", "/opportunities", {
    name: opts.name,
    companyId: opts.companyId,
    stage: opts.stage,
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
