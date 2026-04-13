import { useEffect, useState } from "react";
import * as microsoftTeams from "@microsoft/teams-js";

const PAGES = [
  { id: "dashboard",        label: "ダッシュボード" },
  { id: "daily-entry",      label: "日次入力" },
  { id: "workreport-input", label: "作業報告 入力" },
  { id: "workreport-list",  label: "作業報告 一覧" },
  { id: "workplan-input",   label: "作業予定 入力" },
  { id: "workplan-list",    label: "作業予定 一覧" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

export default function TeamsConfigPage() {
  const [selectedPage, setSelectedPage] = useState<PageId>("dashboard");
  const [ready, setReady] = useState(false);

  // Teams SDK 初期化
  useEffect(() => {
    microsoftTeams.app.initialize().then(() => {
      setReady(true);
      microsoftTeams.pages.config.setValidityState(true);
    });
  }, []);

  // 選択変更時に有効状態を維持 & 保存ハンドラを登録
  useEffect(() => {
    if (!ready) return;

    microsoftTeams.pages.config.registerOnSaveHandler((saveEvent) => {
      // ベース URL を動的に取得（例: https://host/manmarudairyreport/）
      const baseUrl =
        window.location.origin +
        new URL(".", window.location.href).pathname;

      const page = PAGES.find((p) => p.id === selectedPage)!;

      microsoftTeams.pages.config.setConfig({
        entityId: page.id,
        contentUrl: `${baseUrl}${page.id}`,
        suggestedDisplayName: page.label,
        websiteUrl: baseUrl,
      });

      saveEvent.notifySuccess();
    });
  }, [ready, selectedPage]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            業務日報 — タブ設定
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            このチャネルに表示するページを選択してください。
          </p>
        </div>

        <div className="space-y-2">
          {PAGES.map((page) => (
            <label
              key={page.id}
              className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-accent transition-colors"
            >
              <input
                type="radio"
                name="page"
                value={page.id}
                checked={selectedPage === page.id}
                onChange={() => setSelectedPage(page.id)}
                className="accent-primary"
              />
              <span className="text-sm font-medium text-foreground">
                {page.label}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
