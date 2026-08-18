import { exitExpandedMode, showToast } from "@devvit/web/client";
import type { SettingsApiResponse, SettingsSaveRequest, SettingsSaveResponse } from "../shared/api.ts";
import { ApiEndpoint } from "../shared/api.ts";

const subredditsTextarea = document.getElementById("subreddits") as HTMLTextAreaElement;
const errorMsg = document.getElementById("error-msg") as HTMLDivElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;

async function loadSettings(): Promise<void> {
  try {
    const res = await fetch(ApiEndpoint.Settings);
    const data = (await res.json()) as SettingsApiResponse;
    subredditsTextarea.value = data.targetSubreddits.join("\n");
  } catch {
    errorMsg.textContent = "Failed to load settings.";
  }
}

cancelBtn.addEventListener("click", (e) => {
  exitExpandedMode(e);
});

saveBtn.addEventListener("click", async (e) => {
  errorMsg.textContent = "";

  const targetSubreddits = subredditsTextarea.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  saveBtn.disabled = true;
  try {
    const payload: SettingsSaveRequest = { targetSubreddits };
    const res = await fetch(ApiEndpoint.SettingsSave, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as SettingsSaveResponse;
    showToast(`Saved ${data.targetSubreddits.length} subreddit(s)`);
    exitExpandedMode(e);
  } catch {
    errorMsg.textContent = "Failed to save settings. Please try again.";
    saveBtn.disabled = false;
  }
});

loadSettings();
