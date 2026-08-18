export type ScheduledPost = {
  id: string;
  schedulerJobId: string;
  title: string;
  body: string;
  subreddits: string[];
  scheduledAt: number;
  createdBy: string;
  status: "pending" | "published" | "failed" | "cancelled";
  error?: string;
};

export type ScheduleCreateRequest = {
  title: string;
  body: string;
  subreddits: string[];
  scheduledAt: number;
};

export type ScheduleCancelRequest = {
  id: string;
};

export type SettingsSaveRequest = {
  targetSubreddits: string[];
};

export type SettingsApiResponse = {
  type: "settings";
  targetSubreddits: string[];
};

export type SettingsSaveResponse = {
  type: "settings-save";
  targetSubreddits: string[];
};

export type ScheduledListResponse = {
  type: "scheduled-list";
  posts: ScheduledPost[];
};

export type ScheduleCreateResponse = {
  type: "schedule-create";
  post: ScheduledPost;
};

export type ScheduleCancelResponse = {
  type: "schedule-cancel";
  id: string;
};

export const ApiEndpoint = {
  Settings: "/api/settings",
  SettingsSave: "/api/settings/save",
  ScheduledList: "/api/scheduled",
  ScheduleCreate: "/api/schedule/create",
  ScheduleCancel: "/api/schedule/cancel",
  OnPostCreate: "/internal/menu/post-create",
  OnAppInstall: "/internal/on-app-install",
  PostPublish: "/internal/scheduler/post-publish",
} as const;

export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];
