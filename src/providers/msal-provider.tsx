import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  MsalProvider as MsalReactProvider,
  useIsAuthenticated,
  useMsal,
} from "@azure/msal-react";
import {
  EventType,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
} from "@azure/msal-browser";
import { graphScopes, msalConfig, teamsScopes } from "@/lib/msalConfig";
import { clearTeamsSessionReady, markTeamsSessionReady } from "@/lib/teamsAuthSession";
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

type TeamsContext = Awaited<ReturnType<typeof microsoftTeams.app.getContext>>;

function setActiveAccount(account: AccountInfo | null | undefined): void {
  if (account) {
    msalInstance.setActiveAccount(account);
  }
}

function isTeamsHostContext(context: TeamsContext | null): context is TeamsContext {
  return Boolean(context?.app?.host);
}

function getTeamsLoginHint(context: TeamsContext | null): string | undefined {
  return context?.user?.userPrincipalName || context?.user?.loginHint || undefined;
}

async function detectTeamsContext(): Promise<TeamsContext | null> {
  try {
    await microsoftTeams.app.initialize();
    return await microsoftTeams.app.getContext();
  } catch (err) {
    console.warn("Teams context detection failed:", err);
    return null;
  }
}

async function acquireTeamsSsoResult(
  scopes: string[],
  context: TeamsContext,
): Promise<AuthenticationResult> {
  const loginHint = getTeamsLoginHint(context);
  if (!loginHint) {
    throw new Error("Teams login hint is unavailable.");
  }

  const result = await msalInstance.ssoSilent({
    scopes,
    loginHint,
  });
  setActiveAccount(result.account);
  return result;
}

async function acquireTokenInternal(scopes: string[]): Promise<string> {
  const account = msalInstance.getActiveAccount();
  if (account) {
    try {
      const res = await msalInstance.acquireTokenSilent({
        scopes,
        account,
      });
      return res.accessToken;
    } catch (err) {
      console.warn("Silent token acquisition failed, attempting interaction:", err);
    }
  }

  if (isInIframe) {
    const teamsContext = await detectTeamsContext();
    if (isTeamsHostContext(teamsContext)) {
      try {
        const result = await acquireTeamsSsoResult(scopes, teamsContext);
        return result.accessToken;
      } catch (err) {
        console.error("Teams SSO token acquisition failed:", err);
        throw new Error(
          "Teams タブの SSO 認証に失敗しました。Teams のサインイン状態と必要な同意設定を確認してください。",
        );
      }
    }
  }

  const res = await msalInstance.acquireTokenPopup({ scopes });
  setActiveAccount(res.account);
  return res.accessToken;
}

/** Acquires a Graph API access token, preferring Teams SSO inside Teams tabs. */
export async function acquireGraphToken(): Promise<string> {
  return acquireTokenInternal(graphScopes);
}

/** Acquires a token with Teams channel message send permission (for 発報). */
export async function acquireTeamsToken(): Promise<string> {
  return acquireTokenInternal(teamsScopes);
}

/** Auto-login wrapper shown while MSAL initializes / user is unauthenticated */
function AutoLogin({ children }: { children: ReactNode }) {
  const { instance, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [graphReady, setGraphReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (inProgress !== "none") {
      return () => {
        cancelled = true;
      };
    }

    if (inProgress === "none" && !isAuthenticated) {
      const accounts = instance.getAllAccounts();
      if (accounts.length > 0) {
        setActiveAccount(accounts[0]);
        return;
      }

      setGraphReady(false);
      setAuthError(null);
      if (isInIframe) {
        void detectTeamsContext().then(async (teamsContext) => {
          if (isTeamsHostContext(teamsContext)) {
            try {
              const silentRes = await acquireTeamsSsoResult(
                graphScopes,
                teamsContext,
              );
              if (!cancelled) {
                setActiveAccount(silentRes.account);
              }
            } catch (err) {
              console.error("Teams SSO failed:", err);
              if (!cancelled) {
                setAuthError(
                  "Teams のサインイン情報を取得できませんでした。Teams にログイン済みか確認してから開き直してください。",
                );
              }
            }
            return;
          }

          instance.loginPopup({ scopes: graphScopes }).catch((err) => {
            console.error("Popup auth failed:", err);
            if (!cancelled) {
              setAuthError("認証に失敗しました。もう一度サインインしてください。");
            }
          });
        });
      } else {
        instance.loginRedirect({ scopes: graphScopes }).catch((err) => {
          console.error("Redirect auth failed:", err);
          if (!cancelled) {
            setAuthError("認証に失敗しました。ブラウザを再読み込みして再試行してください。");
          }
        });
      }

      return () => {
        cancelled = true;
      };
    }

    if (isAuthenticated) {
      setGraphReady(false);
      setAuthError(null);
      acquireGraphToken()
        .then(() => {
          if (!cancelled) {
            markTeamsSessionReady();
            setGraphReady(true);
          }
        })
        .catch((err) => {
          console.error("Graph token bootstrap failed:", err);
          if (!cancelled) {
            setAuthError("認証トークンの取得に失敗しました。再度サインインしてください。");
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [inProgress, isAuthenticated, instance]);

  if (authError) {
    return (
      <div className="flex h-screen items-center justify-center px-6">
        <div className="max-w-md rounded-lg border border-border bg-background p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-foreground">認証エラー</p>
          <p className="mt-2 text-sm text-muted-foreground">{authError}</p>
          <div className="mt-4 flex justify-center">
            <Button type="button" onClick={() => window.location.reload()}>
              再読み込み
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    if (isDev) {
      setReady(true);
      return;
    }

    msalInstance
      .initialize()
      .then(() => {
        const promise = isInIframe
          ? Promise.resolve(null)
          : msalInstance.handleRedirectPromise();

        promise
          .then((result) => {
            setActiveAccount(result?.account);
            const accounts = msalInstance.getAllAccounts();
            if (accounts.length > 0) {
              setActiveAccount(accounts[0]);
              markTeamsSessionReady();
            }
            setReady(true);
          })
          .catch((err) => {
            console.error("MSAL redirect handling failed:", err);
            setInitError("認証の初期化に失敗しました。ブラウザを再読み込みしてください。");
          });
      })
      .catch((err) => {
        console.error("MSAL initialization failed:", err);
        setInitError("認証の初期化に失敗しました。ブラウザを再読み込みしてください。");
      });
  }, []);

  useEffect(() => {
    return () => {
      clearTeamsSessionReady();
    };
  }, []);

  if (initError) {
    return (
      <div className="flex h-screen items-center justify-center px-6">
        <div className="max-w-md rounded-lg border border-border bg-background p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-foreground">認証エラー</p>
          <p className="mt-2 text-sm text-muted-foreground">{initError}</p>
          <div className="mt-4 flex justify-center">
            <Button type="button" onClick={() => window.location.reload()}>
              再読み込み
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
