import { useEffect, useState, type ReactNode } from "react";
import {
  MsalProvider as MsalReactProvider,
  useMsal,
  useIsAuthenticated,
} from "@azure/msal-react";
import {
  PublicClientApplication,
  EventType,
  type AuthenticationResult,
} from "@azure/msal-browser";
import { msalConfig, graphScopes, teamsScopes } from "@/lib/msalConfig";
import * as microsoftTeams from "@microsoft/teams-js";

const msalInstance = new PublicClientApplication(msalConfig);

// Set the first account as active after login
msalInstance.addEventCallback((event) => {
  if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
    const result = event.payload as AuthenticationResult;
    msalInstance.setActiveAccount(result.account);
  }
});

export function getMsalInstance() {
  return msalInstance;
}

// iframe 内（Teams タブ・Power Apps 埋め込み等）かどうかを検出
const isInIframe = window.self !== window.top;

// Teams の auth-end ポップアップとして動作しているかを検出
// （loginRedirect 後に BASE_URL へリダイレクトされた際、window.opener が設定される）
const isTeamsAuthPopup =
  window.opener !== null &&
  window.opener !== window &&
  (location.search.includes("code=") || location.hash.length > 1);

async function ensureActiveAccount(scopes: string[]): Promise<void> {
  if (msalInstance.getActiveAccount()) return;

  const existing = msalInstance.getAllAccounts();
  if (existing.length > 0) {
    msalInstance.setActiveAccount(existing[0]);
    return;
  }

  if (isInIframe) {
    try {
      await microsoftTeams.app.initialize();
      const ctx = await microsoftTeams.app.getContext();
      if (ctx?.app?.host) {
        const baseUrl = window.location.origin + import.meta.env.BASE_URL;
        await microsoftTeams.authentication.authenticate({
          url: `${baseUrl}teams-auth-start`,
          width: 600,
          height: 535,
        });
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
          msalInstance.setActiveAccount(accounts[0]);
          return;
        }
      }
    } catch {
      // Fall through to popup login below.
    }
  }

  const res = await msalInstance.loginPopup({ scopes });
  msalInstance.setActiveAccount(res.account);
}

/** Acquires a Graph API access token silently (falls back to popup in iframe, redirect otherwise). */
export async function acquireGraphToken(): Promise<string> {
  await ensureActiveAccount(graphScopes);
  const account = msalInstance.getActiveAccount();
  if (!account) throw new Error("MSAL account is not available after authentication.");
  try {
    const res = await msalInstance.acquireTokenSilent({
      scopes: graphScopes,
      account,
    });
    return res.accessToken;
  } catch {
    const res = await msalInstance.acquireTokenPopup({ scopes: graphScopes });
    return res.accessToken;
  }
}

/** Acquires a token with Teams channel message send permission (for 発報). */
export async function acquireTeamsToken(): Promise<string> {
  await ensureActiveAccount(teamsScopes);
  const account = msalInstance.getActiveAccount();
  if (!account) throw new Error("MSAL account is not available after authentication.");
  try {
    const res = await msalInstance.acquireTokenSilent({
      scopes: teamsScopes,
      account,
    });
    return res.accessToken;
  } catch {
    const res = await msalInstance.acquireTokenPopup({ scopes: teamsScopes });
    return res.accessToken;
  }
}

/** Auto-login wrapper shown while MSAL initializes / user is unauthenticated */
function AutoLogin({ children }: { children: ReactNode }) {
  const { instance, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [graphReady, setGraphReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (inProgress !== "none") {
      return () => {
        cancelled = true;
      };
    }

    if (inProgress === "none" && !isAuthenticated) {
      setGraphReady(false);
      if (isInIframe) {
        // iframe 内: Teams か否かを判別して認証方法を分岐
        microsoftTeams.app
          .initialize()
          .then(() => microsoftTeams.app.getContext())
          .then((ctx) => {
            if (ctx?.app?.host) {
              // Teams タブ内 → Teams 管理ポップアップ経由で認証
              const baseUrl =
                window.location.origin + import.meta.env.BASE_URL;
              microsoftTeams.authentication
                .authenticate({
                  url: `${baseUrl}teams-auth-start`,
                  width: 600,
                  height: 535,
                })
                .then(() => {
                  // ポップアップ側の MSAL が localStorage にトークンを保存済み
                  const accounts = msalInstance.getAllAccounts();
                  if (accounts.length > 0) {
                    instance.setActiveAccount(accounts[0]);
                  }
                })
                .catch((err) => {
                  console.error("Teams auth failed:", err);
                });
            } else {
              // Power Apps などの非 Teams iframe → ポップアップ
              instance.loginPopup({ scopes: graphScopes }).catch(() => {});
            }
          })
          .catch(() => {
            instance.loginPopup({ scopes: graphScopes }).catch(() => {});
          });
      } else {
        instance.loginRedirect({ scopes: graphScopes });
      }

      return () => {
        cancelled = true;
      };
    }

    if (isAuthenticated) {
      setGraphReady(false);
      acquireGraphToken()
        .then(() => {
          if (!cancelled) {
            setGraphReady(true);
          }
        })
        .catch((err) => {
          console.error("Graph token bootstrap failed:", err);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [inProgress, isAuthenticated, instance]);

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">サインイン中…</p>
      </div>
    );
  }

  if (!graphReady) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">認証を確認中…</p>
      </div>
    );
  }

  return <>{children}</>;
}

/** Use in dev mode — no auth, just render children */
function DevPassthrough({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const isDev = import.meta.env.DEV;

export function MsalAuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isDev) {
      setReady(true);
      return;
    }
    msalInstance.initialize().then(async () => {
      // Teams auth-end ポップアップとして動作している場合:
      // handleRedirectPromise でトークンを処理し、Teams に成功を通知してポップアップを閉じる
      if (isTeamsAuthPopup) {
        try {
          const result = await msalInstance.handleRedirectPromise();
          if (result?.account) {
            msalInstance.setActiveAccount(result.account);
          }
          await microsoftTeams.app.initialize();
          microsoftTeams.authentication.notifySuccess("ok");
        } catch (err) {
          try {
            await microsoftTeams.app.initialize();
            microsoftTeams.authentication.notifyFailure(String(err));
          } catch { /* ignore */ }
        }
        return; // ポップアップはここで終了（setReady しない）
      }

      // 通常起動: iframe 内ではリダイレクトハンドリングをスキップ
      const promise = isInIframe
        ? Promise.resolve(null)
        : msalInstance.handleRedirectPromise();
      promise.then(() => {
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
          msalInstance.setActiveAccount(accounts[0]);
        }
        setReady(true);
      });
    });
  }, []);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">読み込み中…</p>
      </div>
    );
  }

  if (isDev) {
    return <DevPassthrough>{children}</DevPassthrough>;
  }

  return (
    <MsalReactProvider instance={msalInstance}>
      <AutoLogin>{children}</AutoLogin>
    </MsalReactProvider>
  );
}
