/**
 * Twenty CRM client. Started as just what the Cal.com booking webhook needs
 * (create a Company + Opportunity for a new lead, with a Note carrying
 * whatever booking context doesn't fit a structured field); now also covers
 * updating an already-existing lead — company fields, a linked Person, and
 * follow-up Tasks — the shape a lead takes on *after* first contact.
 *
 * Field names and enum values below were confirmed live against
 * GET {TWENTY_API_URL}/metadata/objects (2026-08-03) — see
 * scripts/check-twenty-schema.ts to re-verify these haven't drifted:
 *   Company.leadSource     FOUNDER_NETWORK | REFERRAL | COLD_OUTREACH | INBOUND | OTHER | ORGANIC
 *   Company.lifecycleStage PROSPECT | ONBOARDING | ADOPTION | EXPANSION | RENEWED | CHURNED
 *   Opportunity.stage      AWARENESS | EDUCATION | SELECTION | COMMITMENT | WON | LOST
 *   Opportunity.dealType   APP_DEVELOPMENT | SOCIAL_MEDIA_MANAGEMENT | PILOT
 *   Opportunity.pointOfContact  RELATION → People (write as pointOfContactId)
 *   Person.name             FULL_NAME composite → { firstName, lastName }
 *   Person.emails           EMAILS composite → { primaryEmail }
 *   Person.jobTitle         TEXT
 *   Person.company          RELATION → write as companyId
 *   Task.status             SELECT: TODO | IN_PROGRESS | DONE
 *   Task.dueAt               DATE_TIME (ISO 8601)
 *   Task.assignee            RELATION → write as assigneeId
 *   TaskTarget.task / .targetOpportunity  same join-object shape as NoteTarget — write as taskId / targetOpportunityId
 *   Opportunity.situation / .pain / .decision  RICH_TEXT composite → { markdown }, same shape as Note.bodyV2
 *
 * The mutation response envelope (`{ data: { create<Type>: {...} } }`) was
 * confirmed live too, via scripts/test-live-calcom-booking.ts (see
 * docs/_notes/webhooks-testing-shaping.md) — that script targets
 * TEST_PROJECT_ID instead of CLB_PROJECT_ID, so live end-to-end checks don't
 * touch real reporting: code/tools/crm/crm.ts already filters everything to
 * `projectId === CLB_PROJECT_ID`, so Test-project records are invisible to
 * it by construction, not by remembering to delete them afterward.
 */

export const CLB_PROJECT_ID = "3aa6e453-b041-4891-8089-3f9c00b2a62c"; // see code/tools/crm/crm.ts
export const TEST_PROJECT_ID = "e60f457f-cd37-467b-a493-8fdb91b4eb41"; // "Test" project, created 2026-08-03 for live-but-safe checks

export type LeadSource = "FOUNDER_NETWORK" | "REFERRAL" | "COLD_OUTREACH" | "INBOUND" | "OTHER" | "ORGANIC";
export type LifecycleStage = "PROSPECT" | "ONBOARDING" | "ADOPTION" | "EXPANSION" | "RENEWED" | "CHURNED";
export type OpportunityStage = "AWARENESS" | "EDUCATION" | "SELECTION" | "COMMITMENT" | "WON" | "LOST";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

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
  // Field name confirmed from code/tools/crm/crm.ts's docstring: "Notes attached
  // to an opportunity (via noteTargets.targetOpportunityId)".
  await api("POST", "/noteTargets", {
    noteId: note.id,
    targetOpportunityId: opts.opportunityId,
  });
  return note;
}

export async function updateCompany(
  id: string,
  fields: Partial<{
    leadSource: LeadSource;
    lifecycleStage: LifecycleStage;
    accountOwnerId: string;
    domain: string;
  }>,
): Promise<{ id: string }> {
  const body: Record<string, unknown> = {};
  if (fields.leadSource) body.leadSource = fields.leadSource;
  if (fields.lifecycleStage) body.lifecycleStage = fields.lifecycleStage;
  if (fields.accountOwnerId) body.accountOwnerId = fields.accountOwnerId;
  if (fields.domain) body.domainName = { primaryLinkUrl: `https://${fields.domain}`, primaryLinkLabel: "" };
  const res = await api("PATCH", `/companies/${id}`, body);
  return extractCreated(res, "updateCompany");
}

// Creates a Person and links it as the Opportunity's Point of Contact — mirrors
// createNoteForOpportunity's "create then link" shape, since the two calls are
// always needed together (an unlinked Point of Contact isn't useful on its own).
export async function createPersonForOpportunity(opts: {
  firstName: string;
  lastName: string;
  opportunityId: string;
  companyId?: string;
  email?: string;
  jobTitle?: string;
}): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    name: { firstName: opts.firstName, lastName: opts.lastName },
  };
  if (opts.companyId) body.companyId = opts.companyId;
  if (opts.email) body.emails = { primaryEmail: opts.email };
  if (opts.jobTitle) body.jobTitle = opts.jobTitle;

  const personRes = await api("POST", "/people", body);
  const person = extractCreated(personRes, "createPerson");
  await api("PATCH", `/opportunities/${opts.opportunityId}`, { pointOfContactId: person.id });
  return person;
}

export async function updatePerson(
  id: string,
  fields: Partial<{ email: string; jobTitle: string }>,
): Promise<{ id: string }> {
  const body: Record<string, unknown> = {};
  if (fields.email) body.emails = { primaryEmail: fields.email };
  if (fields.jobTitle) body.jobTitle = fields.jobTitle;
  const res = await api("PATCH", `/people/${id}`, body);
  return extractCreated(res, "updatePerson");
}

// situation/pain/decision are RICH_TEXT fields, same composite shape as
// Note.bodyV2 — write as { markdown }, not a plain string.
export async function updateOpportunity(
  id: string,
  fields: Partial<{ situation: string; pain: string; decision: string }>,
): Promise<{ id: string }> {
  const body: Record<string, unknown> = {};
  if (fields.situation) body.situation = { markdown: fields.situation };
  if (fields.pain) body.pain = { markdown: fields.pain };
  if (fields.decision) body.decision = { markdown: fields.decision };
  const res = await api("PATCH", `/opportunities/${id}`, body);
  return extractCreated(res, "updateOpportunity");
}

export async function createTaskForOpportunity(opts: {
  title: string;
  opportunityId: string;
  dueAt?: string; // ISO 8601
  assigneeId?: string;
}): Promise<{ id: string }> {
  const body: Record<string, unknown> = { title: opts.title, status: "TODO" as TaskStatus };
  if (opts.dueAt) body.dueAt = opts.dueAt;
  if (opts.assigneeId) body.assigneeId = opts.assigneeId;

  const taskRes = await api("POST", "/tasks", body);
  const task = extractCreated(taskRes, "createTask");
  // Field name confirmed live: TaskTarget mirrors NoteTarget's join shape
  // (task / targetOpportunity), write as taskId / targetOpportunityId.
  await api("POST", "/taskTargets", {
    taskId: task.id,
    targetOpportunityId: opts.opportunityId,
  });
  return task;
}
