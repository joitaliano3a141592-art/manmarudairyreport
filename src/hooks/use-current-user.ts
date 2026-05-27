/**
 * ログインユーザー情報フック
 *
 * 本番: MSAL アカウントから名前・メールを取得
 * 開発: デフォルト値を返す
 */
import { useMemo } from "react";
import { useEffect, useState } from "react";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";

const isDev = import.meta.env.DEV;
const USER_OVERRIDE_KEY = "dailyreport.userNameOverride";
const USER_OVERRIDE_EVENT = "dailyreport-user-override-changed";

export type CurrentUser = {
  name: string;
  email: string;
};

function getStoredUserNameOverride(): string {
  if (typeof window === "undefined") return "";
  return (window.localStorage.getItem(USER_OVERRIDE_KEY) || "").trim();
}

export function setCurrentUserNameOverride(name: string) {
  if (typeof window === "undefined") return;
  const next = name.trim();
  if (next) {
    window.localStorage.setItem(USER_OVERRIDE_KEY, next);
  } else {
    window.localStorage.removeItem(USER_OVERRIDE_KEY);
  }
  window.dispatchEvent(new Event(USER_OVERRIDE_EVENT));
}

export function clearCurrentUserNameOverride() {
  setCurrentUserNameOverride("");
}

export function useCurrentUser(): CurrentUser {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [overrideVersion, setOverrideVersion] = useState(0);

  useEffect(() => {
    const handleOverrideChanged = () => setOverrideVersion((current) => current + 1);
    window.addEventListener(USER_OVERRIDE_EVENT, handleOverrideChanged);
    window.addEventListener("storage", handleOverrideChanged);
    return () => {
      window.removeEventListener(USER_OVERRIDE_EVENT, handleOverrideChanged);
      window.removeEventListener("storage", handleOverrideChanged);
    };
  }, []);

  return useMemo(() => {
    const overrideName = getStoredUserNameOverride();

    if (isDev) {
      return { name: overrideName || "開発ユーザー", email: "dev@localhost" };
    }

    if (!isAuthenticated) {
      return { name: overrideName || "未ログイン", email: "" };
    }

    const account = instance.getActiveAccount() ?? accounts[0];
    if (account) {
      return {
        name: overrideName || account.name || account.username || "不明",
        email: account.username ?? "",
      };
    }

    return { name: overrideName || "未ログイン", email: "" };
  }, [accounts, instance, isAuthenticated, overrideVersion]);
}
