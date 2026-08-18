import { requestExpandedMode, showToast } from "@devvit/web/client";
import type {
  ScheduledListResponse,
  ScheduledPost,
} from "../shared/api.ts";
import { ApiEndpoint } from "../shared/api.ts";

const scheduleBtn = document.getElementById("schedule-btn") as HTMLButtonElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const postList = document.getElementById("post-list") as HTMLDivElement;

async function loadPosts(): Promise<void> {
  try {
    const res = await fetch(ApiEndpoint.ScheduledList);
    const data = (await res.json()) as ScheduledListResponse;
    renderPosts(data.posts);
  } catch {
    postList.innerHTML = '<div class="empty-state">Failed to load posts.</div>';
  }
}

function renderPosts(posts: ScheduledPost[]): void {
  if (posts.length === 0) {
    postList.innerHTML =
      '<div class="empty-state">No scheduled posts. Click + to create one.</div>';
    return;
  }

  const sorted = [...posts].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return a.scheduledAt - b.scheduledAt;
  });

  postList.innerHTML = sorted.map(renderPost).join("");

  for (const post of sorted.filter((p) => p.status === "pending")) {
    document
      .getElementById(`cancel-${post.id}`)
      ?.addEventListener("click", () => cancelPost(post.id));
  }
}

function renderPost(post: ScheduledPost): string {
  const date = new Date(post.scheduledAt).toLocaleString();
  const subs = post.subreddits.map(escapeHtml).join(", ");
  const cancelBtn =
    post.status === "pending"
      ? `<button id="cancel-${escapeHtml(post.id)}" class="cancel-btn">Cancel</button>`
      : "";
  const errorLine =
    post.status === "failed" && post.error
      ? `<div class="post-error">${escapeHtml(post.error)}</div>`
      : "";
  return `<div class="post-item">
    <div class="post-title">${escapeHtml(post.title)}</div>
    <div class="post-meta">
      <span class="status-badge status-${escapeHtml(post.status)}">${escapeHtml(post.status)}</span>
      <span>${date}</span>
      <span>${subs}</span>
      ${cancelBtn}
    </div>
    ${errorLine}
  </div>`;
}

async function cancelPost(id: string): Promise<void> {
  try {
    await fetch(ApiEndpoint.ScheduleCancel, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await loadPosts();
  } catch {
    showToast("Failed to cancel post.");
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

scheduleBtn.addEventListener("click", (e) => {
  requestExpandedMode(e, "compose");
});

settingsBtn.addEventListener("click", (e) => {
  requestExpandedMode(e, "settings");
});

window.addEventListener("focus", () => {
  loadPosts();
});

loadPosts();
