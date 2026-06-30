import { useEffect } from "react";
import { graphScopes } from "@/lib/msalConfig";
import { getMsalInstance } from "@/providers/msal-provider";

/**
 * Teams タブの認証フォールバック開始ページ。
 * Teams SSO が取得できない場合のみ microsoftTeams.authentication.authenticate() から開かれる。
 */
export default function TeamsAuthStart() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedScopes = params
      .get("scopes")
      ?.split(" ")
      .map((scope) => scope.trim())
      .filter(Boolean);
    const scopes = requestedScopes && requestedScopes.length > 0
      ? requestedScopes
      : graphScopes;

    getMsalInstance()
      .initialize()
      .then(() => {
        getMsalInstance().loginRedirect({
          scopes,
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
