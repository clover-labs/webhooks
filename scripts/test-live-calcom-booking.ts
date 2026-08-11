#!/usr/bin/env bun
/**
 * Live end-to-end check of the deployed /calcom-booking endpoint — replaces
 * the one-off hand-signed curl from 2026-08-03. Sends a real signed
 * BOOKING_CREATED payload to the live production URL, tagged with
 * X-Test-Project-Id so it lands in Twenty's "Test" project instead of
 * Clover Labs (code/tools/crm/crm.ts already excludes anything not tagged
 * CLB_PROJECT_ID from real reporting, so this is safe even if cleanup below
 * fails to run). Deletes the created records afterward regardless, to keep
 * the Test project tidy.
 *
 * Usage: bun scripts/test-live-calcom-booking.ts
 * Reads: docs/creds/calcom.env (CALCOM_WEBHOOK_SECRET)
 *        docs/creds/twenty-crm.env (TWENTY_API_URL, TWENTY_API_TOKEN — to verify + clean up)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";

const ENDPOINT = "https://post.cloverlabs.dev/calcom-booking";
const TEST_PROJECT_ID = "e60f457f-cd37-467b-a493-8fdb91b4eb41"; // keep in sync with src/twenty.ts

function loadCreds(...files: string[]): void {
  for (const file of files) {
    const envPath = resolve(import.meta.dir, "../../../docs/creds", file);
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
  }
}

async function twentyApi(method: string, path: string): Promise<any> {
  const res = await fetch(`${process.env.TWENTY_API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.TWENTY_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Twenty API ${method} ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function main() {
  loadCreds("calcom.env", "twenty-crm.env");
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  if (!secret) throw new Error("CALCOM_WEBHOOK_SECRET not set — check docs/creds/calcom.env");

  const stamp = new Date().toISOString();
  const attendeeName = `TEST - Live Webhook Check (${stamp})`;
  const payload = JSON.stringify({
    triggerEvent: "BOOKING_CREATED",
    payload: {
      uid: "live-test-" + Date.now(),
      title: `${attendeeName} between Blendor Sefaj and Test Lead`,
      startTime: "2026-08-10T10:00:00Z",
      attendees: [{ email: "test-lead@example.com", name: attendeeName, timeZone: "UTC" }],
      responses: {
        name: { label: "Your name", value: attendeeName },
        email: { label: "Email address", value: "test-lead@example.com" },
        whatIsThisMeetingAbout: {
          label: "What is this meeting about?",
          value: "Automated live check of the Cal.com -> Twenty CRM webhook — safe to delete.",
        },
      },
    },
  });
  const signature = createHmac("sha256", secret).update(payload).digest("hex");

  console.log(`POST ${ENDPOINT} (Test project) ...`);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cal-Signature-256": signature,
      "X-Test-Project-Id": TEST_PROJECT_ID,
    },
    body: payload,
  });
  const body = await res.json();
  console.log(`  status ${res.status}:`, body);

  if (!res.ok || !body.companyId || !body.opportunityId) {
    throw new Error("Webhook call did not report success — nothing to verify or clean up");
  }

  let ok = true;
  try {
    console.log("Verifying Company/Opportunity fields ...");
    const company = (await twentyApi("GET", `/companies/${body.companyId}`)).data.company;
    check(company.name === attendeeName, `Company.name mismatch: ${company.name}`);
    check(company.leadSource === "INBOUND", `Company.leadSource: ${company.leadSource}`);
    check(company.lifecycleStage === "PROSPECT", `Company.lifecycleStage: ${company.lifecycleStage}`);
    check(company.projectId === TEST_PROJECT_ID, `Company.projectId not Test project: ${company.projectId}`);

    const opportunity = (await twentyApi("GET", `/opportunities/${body.opportunityId}`)).data.opportunity;
    check(opportunity.stage === "AWARENESS", `Opportunity.stage: ${opportunity.stage}`);
    check(opportunity.companyId === body.companyId, "Opportunity.companyId mismatch");
    check(opportunity.projectId === TEST_PROJECT_ID, `Opportunity.projectId not Test project: ${opportunity.projectId}`);

    console.log("All checks passed.");
  } catch (err) {
    ok = false;
    console.error("VERIFICATION FAILED:", err instanceof Error ? err.message : err);
  } finally {
    console.log("Cleaning up test records ...");
    await cleanup(body.companyId, body.opportunityId);
  }

  process.exit(ok ? 0 : 1);
}

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function cleanup(companyId: string, opportunityId: string) {
  const noteTargets = (await twentyApi("GET", "/noteTargets?limit=200")).data.noteTargets;
  const target = noteTargets.find((t: any) => t.targetOpportunityId === opportunityId);
  if (target) {
    await twentyApi("DELETE", `/notes/${target.noteId}`);
    console.log(`  deleted note ${target.noteId}`);
  }
  await twentyApi("DELETE", `/opportunities/${opportunityId}`);
  console.log(`  deleted opportunity ${opportunityId}`);
  await twentyApi("DELETE", `/companies/${companyId}`);
  console.log(`  deleted company ${companyId}`);
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
