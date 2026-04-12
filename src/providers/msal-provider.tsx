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

/** Acquires a Graph API access token silently (falls back to popup in iframe, redirect otherwise). */
export async function acquireGraphToken(): Promise<string> {
  const account = msalInstance.getActiveAccount();
  if (!account) {
    // iframe 内ではリダイレクトが使えないのでポップアップを使用
    const res = await msalInstance.loginPopup({ scopes: graphScopes });
    msalInstance.setActiveAccount(res.account);
    return res.accessToken;
  }
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
  const account = msalInstance.getActiveAccount();
  if (!account) {
    const res = await msalInstance.loginPopup({ scopes: teamsScopes });
    msalInstance.setActiveAccount(res.account);
    return res.accessToken;
  }
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

  useEffect(() => {
    if (inProgress === "none" && !isAuthenticated) {
      // iframe 内ではポップアップ、通常時はリダイレクト
      if (isInIframe) {
        instance.loginPopup({ scopes: graphScopes }).catch(() => {});
      } else {
        instance.loginRedirect({ scopes: graphScopes });
      }
    }
  }, [inProgress, isAuthenticated, instance]);

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">サインイン中…</p>
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
    msalInstance.initialize().then(() => {
      // iframe 内ではリダイレクトハンドリングをスキップ（ポップアップ認証のみ）
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
