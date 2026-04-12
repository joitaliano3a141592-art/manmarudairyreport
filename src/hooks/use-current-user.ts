/**
 * ログインユーザー情報フック
 *
 * 本番: MSAL アカウントから名前・メールを取得
 * 開発: デフォルト値を返す
 */
import { useMemo } from "react";
import { getMsalInstance } from "@/providers/msal-provider";

const isDev = import.meta.env.DEV;

export type CurrentUser = {
  name: string;
  email: string;
};

export function useCurrentUser(): CurrentUser {
  return useMemo(() => {
    if (isDev) {
      return { name: "開発ユーザー", email: "dev@localhost" };
    }
    const instance = getMsalInstance();
    const account = instance.getActiveAccount();
    if (account) {
      return {
        name: account.name ?? account.username ?? "不明",
        email: account.username ?? "",
      };
    }
    return { name: "未ログイン", email: "" };
  }, []);
}
