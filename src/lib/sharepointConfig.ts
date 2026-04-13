/**
 * SharePoint サイト / リスト ID 設定
 * 環境変数 (VITE_SP_*) から読み込み。
 * .env.local に設定すること（.gitignore 済み）。
 */
export const SP_SITE_ID = import.meta.env.VITE_SP_SITE_ID ?? "";

export const SP_LISTS = {
  customers: import.meta.env.VITE_SP_LIST_CUSTOMERS ?? "",
  systems: import.meta.env.VITE_SP_LIST_SYSTEMS ?? "",
  workTypes: import.meta.env.VITE_SP_LIST_WORKTYPES ?? "",
  reports: import.meta.env.VITE_SP_LIST_REPORTS ?? "",
  plans: import.meta.env.VITE_SP_LIST_PLANS ?? "",
} as const;

const DEFAULT_TEAMS_TEAM_ID = "eda7e379-69e8-4a6a-8c73-91052212128f";
const DEFAULT_TEAMS_CHANNEL_ID = "19:a8b3abf429ec4ec7975e7f32aadc2460@thread.skype";

export const TEAMS_CONFIG = {
  teamId: import.meta.env.VITE_TEAMS_TEAM_ID ?? DEFAULT_TEAMS_TEAM_ID,
  channelId: import.meta.env.VITE_TEAMS_CHANNEL_ID ?? DEFAULT_TEAMS_CHANNEL_ID,
} as const;
