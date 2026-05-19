import { useEffect, useState } from "react"
import { Outlet } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"
import { Sidebar } from "@/components/sidebar"
import { SidebarProvider, useSidebarContext } from "@/components/sidebar-layout"
import { Menu } from "lucide-react"
import { useCurrentUser } from "@/hooks/use-current-user"

type LayoutProps = { showHeader?: boolean }

function LayoutContent({ showHeader = true }: LayoutProps) {
  const [isMobileView, setIsMobileView] = useState(false)
  const { isCollapsed, toggleSidebar, toggleMobile, isMobileOpen } = useSidebarContext()

  useEffect(() => {
    const updateIsMobile = () => setIsMobileView(window.innerWidth < 768)
    updateIsMobile()
    window.addEventListener("resize", updateIsMobile)
    return () => window.removeEventListener("resize", updateIsMobile)
  }, [])

  useEffect(() => {
    const now = new Date()
    const month = now.getMonth() + 1
    const day = now.getDate()

    // 1月末（25日〜31日）は、前年データの年次移行を必ず案内する。
    if (month !== 1 || day < 25) {
      return
    }

    const key = `annual-archive-reminder-${now.getFullYear()}-${day}`
    if (sessionStorage.getItem(key) === "shown") {
      return
    }
    sessionStorage.setItem(key, "shown")

    const prevYear = now.getFullYear() - 1
    alert(
      [
        "【年次データ移行のご案内】",
        `前年度（${prevYear}年）の作業実績・予定データを年別テーブルへ移行してください。`,
        "本システムでは自動実行は行いません。必ず手動実行をお願いします。",
        "",
        "手順（安全確認 → 移行）",
        `1) python scripts/migrate_previous_year_data.py --year ${prevYear} --export-only`,
        `2) python scripts/migrate_previous_year_data.py --year ${prevYear} --delete-source`,
      ].join("\n")
    )
  }, [])

  const handleMenuToggle = () => {
    if (isMobileView) {
      toggleMobile()
    } else {
      toggleSidebar()
    }
  }

  const currentUser = useCurrentUser();

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      {/* ヘッダー */}
      {showHeader && (
        <header className="sticky top-0 z-30 w-full border-b border-border bg-[var(--header-bg)] backdrop-blur supports-[backdrop-filter]:bg-[var(--header-bg)]/80 shadow-sm">
          <div className="px-4 flex items-center justify-between h-16">
            {/* 左側: メニューボタンとアプリ名 */}
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleMenuToggle}
                className="flex h-10 w-10 items-center justify-center"
                aria-label={isMobileView
                  ? (isMobileOpen ? "メニューを閉じる" : "メニューを開く")
                  : (isCollapsed ? "サイドバーを展開" : "サイドバーを折りたたむ")}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-lg font-bold text-primary">
                  日次作業実績
                </h1>
                <p className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                  <span>Daily Work Report</span>
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] leading-none">
                    1.0.1
                  </span>
                </p>
              </div>
            </div>

            {/* 右側: テーマ切替とユーザー */}
            <div className="flex items-center gap-3">
              <ModeToggle />
              <div className="rounded-full border border-border bg-muted px-3 py-1 text-sm text-foreground">
                {currentUser.name}
              </div>
            </div>
          </div>
        </header>
      )}

      <div className="flex flex-1">
        {/* サイドバー */}
        <Sidebar />

        {/* メインコンテンツエリア */}
        <div className={`flex-1 flex flex-col transition-all duration-300 relative z-0 ${isCollapsed ? 'md:ml-16' : 'md:ml-64'}`}>
          <main className="flex-1 flex flex-col overflow-visible">
            <div className="flex-1 p-6 max-w-full">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default function Layout(props: LayoutProps) {
  return (
    <SidebarProvider>
      <LayoutContent {...props} />
    </SidebarProvider>
  )
}
