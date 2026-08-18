import { exitExpandedMode, showToast } from "@devvit/web/client";
import type {
  ScheduleCreateRequest,
  ScheduleCreateResponse,
  SettingsApiResponse,
} from "../shared/api.ts";
import { ApiEndpoint } from "../shared/api.ts";

const titleInput = document.getElementById("title") as HTMLInputElement;
const bodyTextarea = document.getElementById("body") as HTMLTextAreaElement;
const datetimeInput = document.getElementById("scheduled-at") as HTMLInputElement;
const subredditsContainer = document.getElementById("subreddits") as HTMLDivElement;
const errorMsg = document.getElementById("error-msg") as HTMLDivElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;

async function loadSettings(): Promise<void> {
  try {
    const res = await fetch(ApiEndpoint.Settings);
    const data = (await res.json()) as SettingsApiResponse;
    renderSubreddits(data.targetSubreddits);
  } catch {
    subredditsContainer.innerHTML =
      '<p class="hint">Failed to load subreddits.</p>';
  }
}

function renderSubreddits(subreddits: string[]): void {
  if (subreddits.length === 0) {
    subredditsContainer.innerHTML =
      '<p class="hint">No target subreddits configured. Add them in app settings.</p>';
    return;
  }
  subredditsContainer.innerHTML = subreddits
    .map(
      (sub) =>
        `<label class="checkbox-item">
          <input type="checkbox" name="subreddit" value="${sub}" checked />
          ${sub}
        </label>`,
    )
    .join("");
}

cancelBtn.addEventListener("click", (e) => {
  exitExpandedMode(e);
});

submitBtn.addEventListener("click", async (e) => {
  errorMsg.textContent = "";

  const title = titleInput.value.trim();
  const body = bodyTextarea.value.trim();
  const scheduledAt = new Date(datetimeInput.value).getTime();
  const checked = subredditsContainer.querySelectorAll<HTMLInputElement>(
    'input[name="subreddit"]:checked',
  );
  const subreddits = Array.from(checked).map((cb) => cb.value);

  if (!title) {
    errorMsg.textContent = "Title is required.";
    return;
  }
  if (isNaN(scheduledAt)) {
    errorMsg.textContent = "Please select a schedule time.";
    return;
  }
  if (scheduledAt <= Date.now()) {
    errorMsg.textContent = "Schedule time must be in the future.";
    return;
  }
  if (subreddits.length === 0) {
    errorMsg.textContent = "Select at least one subreddit.";
    return;
  }

  submitBtn.disabled = true;
  try {
    const payload: ScheduleCreateRequest = {
      title,
      body,
      subreddits,
      scheduledAt,
    };
    const res = await fetch(ApiEndpoint.ScheduleCreate, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ScheduleCreateResponse;
    showToast(
      `Scheduled for ${new Date(data.post.scheduledAt).toLocaleString()}`,
    );
    exitExpandedMode(e);
  } catch {
    errorMsg.textContent = "Failed to schedule post. Please try again.";
    submitBtn.disabled = false;
  }
});

datetimeInput.min = new Date().toISOString().slice(0, 16);

loadSettings();
