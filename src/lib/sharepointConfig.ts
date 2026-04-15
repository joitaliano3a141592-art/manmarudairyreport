/**
 * SharePoint / Teams 設定
 * 一時的にコードへ固定値を保持する。
 */
export const SP_SITE_ID = "manmarusystem.sharepoint.com,789d9920-9e6e-43d4-873b-cfa4bc46e432,4b0ea1ab-eca6-462b-83a1-7995f4187abd";

export const SP_LISTS = {
  customers: "81a8d0e3-4a8a-4545-86da-a83f83fa119f",
  systems: "a92d8237-ef04-4afc-b39a-b7bea69b0412",
  workTypes: "6ef3dd68-9c04-41fa-a16d-998d86d25355",
  reports: "b289a27a-a815-472f-8a12-9297589a5096",
  plans: "662c83d4-b2c1-44e1-ac79-b2d9dd8f92c9",
} as const;

export const TEAMS_CONFIG = {
  teamId: "eda7e379-69e8-4a6a-8c73-91052212128f",
  channelId: "19:a8b3abf429ec4ec7975e7f32aadc2460@thread.skype",
} as const;
