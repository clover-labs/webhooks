import type { IncomingMessage, ServerResponse } from "node:http";
import { context, reddit, redis, scheduler } from "@devvit/web/server";
import type { PartialJsonValue, TriggerResponse, UiResponse } from "@devvit/web/shared";
import {
  ApiEndpoint,
  type ScheduleCancelRequest,
  type ScheduleCancelResponse,
  type ScheduleCreateRequest,
  type ScheduleCreateResponse,
  type ScheduledListResponse,
  type ScheduledPost,
  type SettingsApiResponse,
  type SettingsSaveRequest,
  type SettingsSaveResponse,
} from "../shared/api.ts";
import { once } from "node:events";

export async function serverOnRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  try {
    await onRequest(req, rsp);
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`;
    console.error(msg);
    writeJSON<ErrorResponse>(500, { error: msg, status: 500 }, rsp);
  }
}

async function onRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  const url = req.url;

  if (!url || url === "/") {
    writeJSON<ErrorResponse>(404, { error: "not found", status: 404 }, rsp);
    return;
  }

  const endpoint = url as ApiEndpoint;

  let body: ApiResponse | UiResponse | TriggerResponse | ErrorResponse;
  switch (endpoint) {
    case ApiEndpoint.Settings:
      body = await onSettings();
      break;
    case ApiEndpoint.SettingsSave:
      body = await onSettingsSave(req);
      break;
    case ApiEndpoint.ScheduledList:
      body = await onScheduledList();
      break;
    case ApiEndpoint.ScheduleCreate:
      body = await onScheduleCreate(req);
      break;
    case ApiEndpoint.ScheduleCancel:
      body = await onScheduleCancel(req);
      break;
    case ApiEndpoint.OnPostCreate:
      body = await onMenuNewPost();
      break;
    case ApiEndpoint.OnAppInstall:
      body = await onAppInstall();
      break;
    case ApiEndpoint.PostPublish:
      body = await onPostPublish(req);
      break;
    default:
      endpoint satisfies never;
      body = { error: "not found", status: 404 };
      break;
  }

  writeJSON<PartialJsonValue>("status" in body ? body.status : 200, body, rsp);
}

type ApiResponse =
  | SettingsApiResponse
  | SettingsSaveResponse
  | ScheduledListResponse
  | ScheduleCreateResponse
  | ScheduleCancelResponse;

type ErrorResponse = {
  error: string;
  status: number;
};

const SETTINGS_KEY = "settings:targetSubreddits";
const SCHEDULED_INDEX_KEY = "scheduled:index";

function scheduledKey(id: string): string {
  return `scheduled:${id}`;
}

async function getScheduledIndex(): Promise<string[]> {
  const raw = (await redis.get(SCHEDULED_INDEX_KEY)) ?? "[]";
  return JSON.parse(raw) as string[];
}

async function onSettings(): Promise<SettingsApiResponse> {
  const raw = (await redis.get(SETTINGS_KEY)) ?? "";
  const targetSubreddits = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return { type: "settings", targetSubreddits };
}

async function onSettingsSave(req: IncomingMessage): Promise<SettingsSaveResponse> {
  const { targetSubreddits } = await readJSON<SettingsSaveRequest>(req);
  await redis.set(SETTINGS_KEY, targetSubreddits.join("\n"));
  return { type: "settings-save", targetSubreddits };
}

async function onScheduledList(): Promise<ScheduledListResponse> {
  const ids = await getScheduledIndex();
  const posts = await Promise.all(
    ids.map(async (id) => {
      const raw = await redis.get(scheduledKey(id));
      return raw ? (JSON.parse(raw) as ScheduledPost) : null;
    }),
  );
  return {
    type: "scheduled-list",
    posts: posts.filter((p): p is ScheduledPost => p !== null),
  };
}

async function onScheduleCreate(req: IncomingMessage): Promise<ScheduleCreateResponse> {
  const { title, body, subreddits, scheduledAt } =
    await readJSON<ScheduleCreateRequest>(req);

  const id = crypto.randomUUID();
  const schedulerJobId = await scheduler.runJob({
    name: "postPublish",
    data: { id },
    runAt: new Date(scheduledAt),
  });

  const post: ScheduledPost = {
    id,
    schedulerJobId,
    title,
    body,
    subreddits,
    scheduledAt,
    createdBy: context.username ?? "unknown",
    status: "pending",
  };

  await redis.set(scheduledKey(id), JSON.stringify(post));
  const ids = await getScheduledIndex();
  ids.push(id);
  await redis.set(SCHEDULED_INDEX_KEY, JSON.stringify(ids));

  return { type: "schedule-create", post };
}

async function onScheduleCancel(req: IncomingMessage): Promise<ScheduleCancelResponse> {
  const { id } = await readJSON<ScheduleCancelRequest>(req);
  const raw = await redis.get(scheduledKey(id));
  if (!raw) throw new Error(`Post ${id} not found`);
  const post: ScheduledPost = JSON.parse(raw);
  await scheduler.cancelJob(post.schedulerJobId);
  post.status = "cancelled";
  await redis.set(scheduledKey(id), JSON.stringify(post));
  return { type: "schedule-cancel", id };
}

async function onMenuNewPost(): Promise<UiResponse> {
  const post = await reddit.submitCustomPost({ title: context.appName });
  return {
    showToast: { text: "SubBridge panel created.", appearance: "success" },
    navigateTo: post.url,
  };
}

async function onAppInstall(): Promise<TriggerResponse> {
  await reddit.submitCustomPost({ title: "SubBridge" });
  return {};
}

async function onPostPublish(req: IncomingMessage): Promise<TriggerResponse> {
  const { data } = await readJSON<{ name: string; data: { id: string } }>(req);
  const { id } = data;

  const raw = await redis.get(scheduledKey(id));
  if (!raw) {
    console.error(`SubBridge: no scheduled post for id ${id}`);
    return {};
  }

  const post: ScheduledPost = JSON.parse(raw);
  if (post.status !== "pending") return {};

  try {
    // Step 1: post to the home subreddit (where app is installed)
    const homePost = await reddit.submitPost({
      subredditName: context.subredditName,
      title: post.title,
      text: post.body,
    });

    // Step 2: crosspost to each target subreddit as the installing user
    const homeName = context.subredditName.toLowerCase();
    const targets = post.subreddits
      .map((s) => s.replace(/^r\//, ""))
      .filter((s) => s.toLowerCase() !== homeName);

    for (const subreddit of targets) {
      await reddit.crosspost({
        subredditName: subreddit,
        postId: homePost.id,
        title: post.title,
        runAs: "USER",
      });
    }

    post.status = "published";
  } catch (err) {
    post.status = "failed";
    post.error = err instanceof Error ? err.message : String(err);
  }

  await redis.set(scheduledKey(id), JSON.stringify(post));
  return {};
}

function writeJSON<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json);
  const len = Buffer.byteLength(body);
  rsp.writeHead(status, {
    "Content-Length": len,
    "Content-Type": "application/json",
  });
  rsp.end(body);
}

async function readJSON<T>(req: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  await once(req, "end");
  return JSON.parse(`${Buffer.concat(chunks)}`);
}
