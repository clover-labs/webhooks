#!/usr/bin/env bun
/**
 * Read-only check that Twenty CRM's live schema still matches what
 * src/twenty.ts hardcodes. Catches drift (a renamed field, a changed enum
 * value) before it causes a silent failure in the webhook handler — this is
 * exactly the kind of bug a mocked unit test cannot catch, since a mock only
 * returns what you tell it to.
 *
 * Never writes anything — GET /metadata/objects only.
 *
 * Usage: bun scripts/check-twenty-schema.ts
 * Reads: docs/creds/twenty-crm.env (TWENTY_API_URL, TWENTY_API_TOKEN)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadCreds(): void {
  const envPath = resolve(import.meta.dir, "../../../docs/creds/twenty-crm.env");
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

type ExpectedField = {
  object: string; // nameSingular
  field: string;
  type?: string;
  options?: string[]; // required SELECT option values (subset check — extra live options are fine)
};

// What src/twenty.ts's field names + enum values assume are true right now.
// Keep this list in sync with the comment block at the top of src/twenty.ts.
const EXPECTED: ExpectedField[] = [
  { object: "company", field: "leadSource", type: "SELECT", options: ["FOUNDER_NETWORK", "REFERRAL", "COLD_OUTREACH", "INBOUND", "OTHER", "ORGANIC"] },
  { object: "company", field: "lifecycleStage", type: "SELECT", options: ["PROSPECT", "ONBOARDING", "ADOPTION", "EXPANSION", "RENEWED", "CHURNED"] },
  { object: "company", field: "project", type: "RELATION" },
  { object: "company", field: "domainName" },
  { object: "opportunity", field: "stage", type: "SELECT", options: ["AWARENESS", "EDUCATION", "SELECTION", "COMMITMENT", "WON", "LOST"] },
  { object: "opportunity", field: "dealType", type: "SELECT", options: ["APP_DEVELOPMENT", "SOCIAL_MEDIA_MANAGEMENT", "PILOT"] },
  { object: "opportunity", field: "company", type: "RELATION" },
  { object: "opportunity", field: "project", type: "RELATION" },
  { object: "note", field: "title" },
  { object: "note", field: "bodyV2" },
  { object: "noteTarget", field: "targetOpportunity" },
  { object: "project", field: "name" },
];

async function main() {
  loadCreds();
  const url = process.env.TWENTY_API_URL;
  const token = process.env.TWENTY_API_TOKEN;
  if (!url || !token) {
    console.error("TWENTY_API_URL / TWENTY_API_TOKEN not set — check docs/creds/twenty-crm.env");
    process.exit(2);
  }

  const res = await fetch(`${url}/metadata/objects?depth=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`Failed to fetch schema: ${res.status} ${await res.text()}`);
    process.exit(2);
  }
  const data = (await res.json()) as { data: any[] };
  const objects = data.data;

  const problems: string[] = [];

  for (const exp of EXPECTED) {
    const obj = objects.find((o) => o.nameSingular === exp.object);
    if (!obj) {
      problems.push(`object "${exp.object}" not found`);
      continue;
    }
    const field = (obj.fields ?? []).find((f: any) => f.name === exp.field);
    if (!field) {
      problems.push(`${exp.object}.${exp.field} not found`);
      continue;
    }
    if (exp.type && field.type !== exp.type) {
      problems.push(`${exp.object}.${exp.field} expected type ${exp.type}, got ${field.type}`);
    }
    if (exp.options) {
      const liveValues = new Set((field.options ?? []).map((o: any) => o.value));
      const missing = exp.options.filter((v) => !liveValues.has(v));
      if (missing.length > 0) {
        problems.push(`${exp.object}.${exp.field} missing expected option(s): ${missing.join(", ")}`);
      }
    }
  }

  if (problems.length === 0) {
    console.log(`OK — all ${EXPECTED.length} expected fields/enum values confirmed live`);
    process.exit(0);
  }

  console.error(`Schema drift detected (${problems.length} issue(s)):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

main();
