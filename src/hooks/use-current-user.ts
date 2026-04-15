/**
 * ログインユーザー情報フック
 *
 * 本番: MSAL アカウントから名前・メールを取得
 * 開発: デフォルト値を返す
 */
import { useMemo } from "react";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";

const isDev = import.meta.env.DEV;

export type CurrentUser = {
  name: string;
  email: string;
};

export function useCurrentUser(): CurrentUser {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  return useMemo(() => {
    if (isDev) {
      return { name: "開発ユーザー", email: "dev@localhost" };
    }

    if (!isAuthenticated) {
      return { name: "未ログイン", email: "" };
    }

    const account = instance.getActiveAccount() ?? accounts[0];
    if (account) {
      return {
        name: account.name ?? account.username ?? "不明",
        email: account.username ?? "",
      };
    }

    return { name: "未ログイン", email: "" };
  }, [accounts, instance, isAuthenticated]);
}
