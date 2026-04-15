/**
 * SharePoint サイト / リスト ID 設定
 * 環境変数 (VITE_SP_*) から読み込み。
 * .env.local に設定すること（.gitignore 済み）。
 */
function normalizeRuntimeConfigValue(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/\\\./g, ".")
    .replace(/\\\//g, "/")
    .replace(/\\:/g, ":")
    .replace(/\\@/g, "@");
}

export const SP_SITE_ID = normalizeRuntimeConfigValue(import.meta.env.VITE_SP_SITE_ID);

export const SP_LISTS = {
  customers: normalizeRuntimeConfigValue(import.meta.env.VITE_SP_LIST_CUSTOMERS),
  systems: normalizeRuntimeConfigValue(import.meta.env.VITE_SP_LIST_SYSTEMS),
  workTypes: normalizeRuntimeConfigValue(import.meta.env.VITE_SP_LIST_WORKTYPES),
  reports: normalizeRuntimeConfigValue(import.meta.env.VITE_SP_LIST_REPORTS),
  plans: normalizeRuntimeConfigValue(import.meta.env.VITE_SP_LIST_PLANS),
} as const;

export const TEAMS_CONFIG = {
  teamId: normalizeRuntimeConfigValue(import.meta.env.VITE_TEAMS_TEAM_ID),
  channelId: normalizeRuntimeConfigValue(import.meta.env.VITE_TEAMS_CHANNEL_ID),
} as const;
