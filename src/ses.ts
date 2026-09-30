import { createHash, createHmac } from "node:crypto";

/**
 * Minimal AWS SES v2 SendEmail over HTTPS, signed with SigV4 by hand — keeps
 * the server dependency-free (no AWS SDK, no SMTP client, no Dockerfile install step).
 *
 * Credentials: IAM user `cloverlabs-smtp` (code/infra `aws-manage provision`),
 * scoped to the cloverlabs.dev SES identity. Infisical: clab-ops /cloverlabs-ses.
 *
 * Env: SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_REGION, SES_FROM_ADDRESS
 */

export function sesConfigured(): boolean {
  return Boolean(process.env.SES_ACCESS_KEY_ID && process.env.SES_SECRET_ACCESS_KEY && process.env.SES_FROM_ADDRESS);
}

export async function sendEmail(opts: { to: string; subject: string; text: string; from?: string }): Promise<void> {
  const region = process.env.SES_REGION ?? "eu-central-1";
  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const body = JSON.stringify({
    FromEmailAddress: opts.from ?? process.env.SES_FROM_ADDRESS,
    Destination: { ToAddresses: [opts.to] },
    Content: { Simple: { Subject: { Data: opts.subject }, Body: { Text: { Data: opts.text } } } },
  });

  const headers = signV4({
    method: "POST",
    host,
    path,
    body,
    region,
    service: "ses",
    accessKeyId: process.env.SES_ACCESS_KEY_ID!,
    secretAccessKey: process.env.SES_SECRET_ACCESS_KEY!,
  });

  const res = await fetch(`https://${host}${path}`, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`SES SendEmail failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
}

export function signV4(r: {
  method: string;
  host: string;
  path: string;
  body: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  now?: Date;
}): Record<string, string> {
  const amzDate = (r.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${r.region}/${r.service}/aws4_request`;
  const signedHeaders = "content-type;host;x-amz-date";

  const canonical = [
    r.method,
    r.path,
    "",
    `content-type:application/json\nhost:${r.host}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    sha256(r.body),
  ].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");

  let key: Buffer = hmac(`AWS4${r.secretAccessKey}`, date);
  for (const part of [r.region, r.service, "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");

  return {
    "Content-Type": "application/json",
    "X-Amz-Date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${r.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}
