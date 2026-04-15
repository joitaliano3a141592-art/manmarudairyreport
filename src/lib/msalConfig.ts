import type { Configuration } from "@azure/msal-browser";
import { LogLevel } from "@azure/msal-browser";

const TENANT_ID = "32d919c2-817c-42d0-9a25-9fc597ea17fb";
const CLIENT_ID = "3d550d7e-db2f-4d35-baa8-df96b0ae64eb";

export const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    // BASE_URL は vite.config.ts の base に連動（GitHub Pages: /manmarudairyreport/, サーバ: /）
    redirectUri: window.location.origin + import.meta.env.BASE_URL,
  },
  cache: {
    cacheLocation: "localStorage",
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
    },
  },
};

export const graphScopes = [
  "Sites.ReadWrite.All",
  "Sites.Manage.All",
  "User.Read",
];

// Teams チャネルへのメッセージ投稿用スコープ（発報ボタン）
export const teamsScopes = [
  ...graphScopes,
  "ChannelMessage.Send",
];
