import { useEffect } from "react";
import { getMsalInstance } from "@/providers/msal-provider";
import { graphScopes } from "@/lib/msalConfig";

/**
 * Teams チャネルタブ認証ポップアップの開始ページ。
 * microsoftTeams.authentication.authenticate() から開かれ、
 * MSAL の loginRedirect を起動する。
 * リダイレクト先 (BASE_URL) は Azure AD に登録済みの redirectUri と一致する。
 */
export default function TeamsAuthStart() {
  useEffect(() => {
    getMsalInstance()
      .initialize()
      .then(() => {
        getMsalInstance().loginRedirect({
          scopes: graphScopes,
          // Azure AD に登録済みの redirectUri (BASE_URL) へ戻す
          redirectUri: window.location.origin + import.meta.env.BASE_URL,
        });
      });
  }, []);

  return (
    <div className="flex h-screen items-center justify-center">
      <p className="text-muted-foreground text-sm">認証中…</p>
    </div>
  );
}
