import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataErrorState } from "@/components/data-error-state";
import { ActionLoadingOverlay } from "@/components/action-loading-overlay";
import { Plus, Send, Trash2 } from "lucide-react";
import {
  useCustomers,
  useSystems,
  useWorkTypes,
  useReports,
  useAddReport,
  useDeleteReport,
  usePlans,
  useAddPlan,
  useDeletePlan,
} from "@/hooks/use-sharepoint";
import { useCurrentUser } from "@/hooks/use-current-user";
import { postTeamsChannelMessage } from "@/lib/graphClient";
import { TEAMS_CONFIG } from "@/lib/sharepointConfig";
import * as microsoftTeams from "@microsoft/teams-js";

function toLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const today = toLocalDate(new Date());
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return toLocalDate(d); })();

type TeamsPublishTarget = {
  teamId: string;
  channelId: string;
};

async function resolveTeamsPublishTarget(): Promise<TeamsPublishTarget> {
  if (TEAMS_CONFIG.teamId && TEAMS_CONFIG.channelId) {
    return {
      teamId: TEAMS_CONFIG.teamId,
      channelId: TEAMS_CONFIG.channelId,
    };
  }

  try {
    await microsoftTeams.app.initialize();
    const context = await microsoftTeams.app.getContext();
    const teamId = context.team?.groupId?.trim();
    const channelId = context.channel?.id?.trim();

    if (teamId && channelId) {
      return {
        teamId,
        channelId,
      };
    }
  } catch {
    // Teams 外では既存の環境変数フォールバックを使う。
  }

  return {
    teamId: TEAMS_CONFIG.teamId,
    channelId: TEAMS_CONFIG.channelId,
  };
}

export default function DailyEntryPage() {
  const { data: customers = [], isError: custError, error: customersError } = useCustomers();
  const { data: systems = [], isError: sysError, error: systemsError } = useSystems();
  const { data: workTypes = [], isError: wtError, error: workTypesError } = useWorkTypes();
  const { data: reports = [], isLoading: reportsLoading, isError: reportsErrorState, error: reportsError } = useReports(today, today);
  const { data: allUpcomingPlans = [], isLoading: plansLoading, isError: plansErrorState, error: plansError } = usePlans(tomorrow);

  const addReportMutation = useAddReport();
  const deleteReportMutation = useDeleteReport();
  const addPlanMutation = useAddPlan();
  const deletePlanMutation = useDeletePlan();
  const currentUser = useCurrentUser();

  const [reportForm, setReportForm] = useState({
    reportDate: today,
    customerId: "",
    systemId: "",
    workTypeId: "",
    workDescription: "",
    workTime: "",
    isProject: true,
  });

  const [planForm, setPlanForm] = useState({
    customerId: "",
    systemId: "",
    workDescription: "",
    planDate: tomorrow,
  });
  const [reportSubmitError, setReportSubmitError] = useState("");
  const [planSubmitError, setPlanSubmitError] = useState("");
  const [reportDeleteTargetId, setReportDeleteTargetId] = useState<string | null>(null);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<TeamsPublishTarget | null>(null);

  const filteredReportSystems = systems.filter(
    (system) => !reportForm.customerId || system.customerId === reportForm.customerId,
  );
  const filteredPlanSystems = systems.filter(
    (system) => !planForm.customerId || system.customerId === planForm.customerId,
  );
  const plans = allUpcomingPlans;
  const publishReports = useMemo(
    () => reports.filter((report) => report.userName === currentUser.name && report.reportDate >= today),
    [currentUser.name, reports],
  );
  const publishReportGroups = useMemo(() => {
    const groups = new Map<string, typeof publishReports>();
    for (const report of publishReports) {
      const existing = groups.get(report.reportDate);
      if (existing) {
        existing.push(report);
        continue;
      }
      groups.set(report.reportDate, [report]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [publishReports]);
  const nextPlanDate = useMemo(
    () => plans.reduce<string | null>((nearest, plan) => {
      if (!nearest || plan.planDate < nearest) {
        return plan.planDate;
      }
      return nearest;
    }, null),
    [plans],
  );
  const publishPlans = useMemo(
    () => (nextPlanDate ? plans.filter((plan) => plan.planDate === nextPlanDate) : []),
    [nextPlanDate, plans],
  );

  if (custError || sysError || wtError || reportsErrorState || plansErrorState) {
    return (
      <DataErrorState
        title="日次入力に必要なデータを取得できませんでした"
        error={customersError ?? systemsError ?? workTypesError ?? reportsError ?? plansError}
      />
    );
  }

  const addReportToStore = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (
      !reportForm.customerId ||
      !reportForm.systemId ||
      !reportForm.workTypeId ||
      !reportForm.workDescription.trim() ||
      !reportForm.workTime.trim()
    ) {
      alert("本日の作業実績の必須項目を入力してください。");
      return;
    }

    const workTime = parseFloat(reportForm.workTime);
    if (Number.isNaN(workTime) || workTime <= 0) {
      alert("正しい作業時間を入力してください。");
      return;
    }

    const customer = customers.find((c) => c.id === reportForm.customerId);

    setReportSubmitError("");
    addReportMutation.mutate({
      Title: `日報-${customer?.name ?? ""}`,
      ReportDate: `${reportForm.reportDate}T00:00:00+09:00`,
      CustomerLookupId: Number(reportForm.customerId),
      SystemLookupId: Number(reportForm.systemId),
      WorkTypeLookupId: Number(reportForm.workTypeId),
      WorkDescription: reportForm.workDescription,
      WorkHours: workTime,
      ReporterName: currentUser.name,
      IsProject: reportForm.isProject,
    }, {
      onSuccess: () => {
        setReportForm({ ...reportForm, customerId: "", systemId: "", workTypeId: "", workDescription: "", workTime: "", isProject: true });
      },
      onError: (error) => {
        setReportSubmitError(error instanceof Error ? error.message : String(error));
      },
    });
  };

  const addPlan = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!planForm.customerId || !planForm.systemId || !planForm.workDescription.trim()) {
      alert("次回の作業予定の必須項目を入力してください。");
      return;
    }

    const customer = customers.find((c) => c.id === planForm.customerId);

    setPlanSubmitError("");
    addPlanMutation.mutate({
      Title: `予定-${customer?.name ?? ""}`,
      PlanDate: `${planForm.planDate}T00:00:00+09:00`,
      CustomerLookupId: Number(planForm.customerId),
      SystemLookupId: Number(planForm.systemId),
      WorkDescription: planForm.workDescription,
      AssigneeName: currentUser.name,
    }, {
      onSuccess: () => {
        setPlanForm({ ...planForm, customerId: "", systemId: "", workDescription: "" });
      },
      onError: (error) => {
        setPlanSubmitError(error instanceof Error ? error.message : String(error));
      },
    });
  };

  const removeReport = (id: string) => {
    setReportDeleteTargetId(id);
  };

  const removePlan = (id: string) => {
    deletePlanMutation.mutate(id);
  };

  const removePlanTap = (id: string) => {
    if (deletePlanMutation.isPending) return;
    removePlan(id);
  };

  const [publishing, setPublishing] = useState(false);
  const actionLoadingMessage = publishing
    ? "Teams に発報しています..."
    : addReportMutation.isPending
      ? "作業実績を登録しています..."
      : addPlanMutation.isPending
        ? "作業予定を登録しています..."
        : deleteReportMutation.isPending
          ? "作業実績を削除しています..."
          : deletePlanMutation.isPending
            ? "作業予定を削除しています..."
            : "処理中...";
  const actionLoadingOpen = publishing
    || addReportMutation.isPending
    || addPlanMutation.isPending
    || deleteReportMutation.isPending
    || deletePlanMutation.isPending;

  const requestPublish = async () => {
    if (reportsLoading || plansLoading) {
      alert("発報対象データを読み込み中です。しばらくしてから再度お試しください。");
      return;
    }

    if (publishReports.length === 0 && publishPlans.length === 0) {
      alert("送信する作業実績・予定がありません。");
      return;
    }
    const nextPublishTarget = await resolveTeamsPublishTarget();

    if (!nextPublishTarget.teamId || !nextPublishTarget.channelId) {
      alert("Teams チャネルが設定されていません。管理者に連絡してください。");
      return;
    }

    if (publishing) {
      return;
    }

    setPublishTarget(nextPublishTarget);
    setPublishConfirmOpen(true);
  };

  const handlePublish = async () => {
    if (!publishTarget) return;
    setPublishing(true);
    try {
      const formatMonthDay = (date: string) => {
        const [, month, day] = date.split("-");
        return `${Number(month)}/${Number(day)}`;
      };
      const reportSections = publishReportGroups
        .map(([reportDate, groupedReports]) => {
          const reportRows = groupedReports
            .map((r) => `<tr><td>${r.customerName}</td><td>${r.systemName}</td><td>${r.workDescription}</td></tr>`)
            .join("");

          return `
    <p>■ ${formatMonthDay(reportDate)} の作業実績</p>
    <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%">
      <tr style="background:#f0f0f0"><th>顧客</th><th>システム</th><th>作業内容</th></tr>
      ${reportRows}
    </table>`;
        })
        .join("<br/>");
      const planRows = publishPlans
        .map((p) => `<tr><td>${p.customerName}</td><td>${p.systemName}</td><td>${p.workDescription}</td></tr>`)
        .join("");
      const nextPlanSection = nextPlanDate
        ? `
    <p>■ 次回の作業予定（${formatMonthDay(nextPlanDate)}）</p>
    ${publishPlans.length > 0 ? `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%">
      <tr style="background:#f0f0f0"><th>顧客</th><th>システム</th><th>作業内容</th></tr>
      ${planRows}
    </table>` : "<p>（なし）</p>"}`
        : "<p>■ 次回の作業予定</p><p>（なし）</p>";

      const html = `
        <p><span style="font-size:1.2em;font-weight:bold;">${formatMonthDay(today)}</span></p>
    ${publishReportGroups.length > 0 ? reportSections : "<p>■ 作業実績</p><p>（なし）</p>"}
    <br/>
    ${nextPlanSection}
      `.trim();

      await postTeamsChannelMessage(publishTarget.teamId, publishTarget.channelId, html);
      alert("Teams チャネルに送信しました。");
    } catch (err) {
      console.error("Teams 送信エラー:", err);
      alert(`Teams への送信に失敗しました。\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPublishing(false);
      setPublishTarget(null);
    }
  };

  if (reportsLoading || plansLoading) {
    return (
      <div className="container mx-auto py-6 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">SharePoint からデータを読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-screen-xl py-6 overflow-x-hidden">
      <ActionLoadingOverlay open={actionLoadingOpen} message={actionLoadingMessage} />
      <div className="mb-6 flex flex-col gap-3 min-w-0">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">日次入力</h1>
            <p className="text-muted-foreground">今日の作業実績と次回予定を入力します。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              size="lg"
              onClick={requestPublish}
              onTouchEnd={(e) => {
                e.preventDefault();
                void requestPublish();
              }}
              disabled={publishing}
            >
              <Send className="mr-2 h-4 w-4" /> {publishing ? "送信中..." : "発報"}
            </Button>
          </div>
        </div>
      </div>

      {/* ── 入力フォーム ── */}
      <div className="grid gap-6 lg:grid-cols-2 min-w-0">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>本日の作業実績</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addReportToStore} className="space-y-4">
              <div className="space-y-1.5">
                <Label>報告日</Label>
                <input
                  type="date"
                  className="flex h-9 w-full max-w-[10rem] rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                  value={reportForm.reportDate}
                  onChange={(e) => setReportForm({ ...reportForm, reportDate: e.target.value })}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>顧客</Label>
                  <Select
                    value={reportForm.customerId}
                    onValueChange={(value) => setReportForm({ ...reportForm, customerId: value, systemId: "" })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="顧客を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>システム</Label>
                  <Select
                    value={reportForm.systemId}
                    onValueChange={(value) => setReportForm({ ...reportForm, systemId: value })}
                    disabled={!reportForm.customerId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="システムを選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredReportSystems.map((system) => (
                        <SelectItem key={system.id} value={system.id}>{system.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>作業区分</Label>
                  <Select
                    value={reportForm.workTypeId}
                    onValueChange={(value) => setReportForm({ ...reportForm, workTypeId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="区分を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {workTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>作業時間</Label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                    value={reportForm.workTime}
                    onChange={(e) => setReportForm({ ...reportForm, workTime: e.target.value })}
                    placeholder="8.0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>案件</Label>
                  <div className="flex h-9 items-center">
                    <label className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
                      <input
                        type="checkbox"
                        checked={reportForm.isProject}
                        onChange={(e) => setReportForm({ ...reportForm, isProject: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      案件
                    </label>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>作業内容</Label>
                <Textarea
                  value={reportForm.workDescription}
                  onChange={(e) => setReportForm({ ...reportForm, workDescription: e.target.value })}
                  placeholder="本日の作業内容を入力..."
                  rows={3}
                />
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={addReportMutation.isPending}>
                  <Plus className="mr-2 h-4 w-4" /> 実績追加
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setReportForm({ ...reportForm, customerId: "", systemId: "", workTypeId: "", workDescription: "", workTime: "", isProject: true })
                  }
                >
                  クリア
                </Button>
              </div>
              {reportSubmitError && <p className="text-sm text-destructive">登録できませんでした: {reportSubmitError}</p>}
            </form>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardTitle>次回の予定</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addPlan} className="space-y-4">
              <div className="space-y-1.5">
                <Label>予定日</Label>
                <input
                  type="date"
                  className="flex h-9 w-full max-w-[10rem] rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                  value={planForm.planDate}
                  onChange={(e) => setPlanForm({ ...planForm, planDate: e.target.value })}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>顧客</Label>
                  <Select
                    value={planForm.customerId}
                    onValueChange={(value) => setPlanForm({ ...planForm, customerId: value, systemId: "" })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="顧客を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>システム</Label>
                  <Select
                    value={planForm.systemId}
                    onValueChange={(value) => setPlanForm({ ...planForm, systemId: value })}
                    disabled={!planForm.customerId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="システムを選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredPlanSystems.map((system) => (
                        <SelectItem key={system.id} value={system.id}>{system.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 実績側の「作業区分/作業時間/案件」行と高さを揃えるスペーサ */}
              <div className="h-[3.75rem]" />

              <div className="space-y-1.5">
                <Label>作業内容</Label>
                <Textarea
                  value={planForm.workDescription}
                  onChange={(e) => setPlanForm({ ...planForm, workDescription: e.target.value })}
                  placeholder="次回予定の作業を入力..."
                  rows={3}
                />
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={addPlanMutation.isPending}><Plus className="mr-2 h-4 w-4" />予定追加</Button>
                <Button type="button" variant="outline" onClick={() => setPlanForm({ ...planForm, customerId: "", systemId: "", workDescription: "" })}>
                  クリア
                </Button>
              </div>
              {planSubmitError && <p className="text-sm text-destructive">登録できませんでした: {planSubmitError}</p>}
            </form>
          </CardContent>
        </Card>
      </div>

      {/* ── 一覧テーブル ── */}
      <div className="grid gap-6 lg:grid-cols-2 mt-6 min-w-0">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>作業実績一覧</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">まだ作業実績がありません。</p>
            ) : (
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>顧客</TableHead>
                  <TableHead>システム</TableHead>
                  <TableHead>区分</TableHead>
                  <TableHead className="text-right">時間</TableHead>
                  <TableHead>案件</TableHead>
                  <TableHead>作業内容</TableHead>
                  <TableHead className="w-20">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="whitespace-nowrap">{report.customerName}</TableCell>
                    <TableCell className="whitespace-nowrap">{report.systemName}</TableCell>
                    <TableCell className="whitespace-nowrap">{report.workTypeName}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{report.workHours.toFixed(1)}h</TableCell>
                    <TableCell className="text-center">{report.isProject ? "○" : "―"}</TableCell>
                    <TableCell className="max-w-[16rem] truncate" title={report.workDescription}>
                      {report.workDescription}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => removeReport(report.id)}
                        onTouchEnd={(e) => {
                          e.preventDefault();
                          removeReport(report.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>明日以降の予定一覧</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">今後の作業予定がありません。</p>
            ) : (
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>予定日</TableHead>
                  <TableHead>顧客</TableHead>
                  <TableHead>システム</TableHead>
                  <TableHead>作業内容</TableHead>
                  <TableHead className="w-20">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell className="whitespace-nowrap">{plan.planDate}</TableCell>
                    <TableCell className="whitespace-nowrap">{plan.customerName}</TableCell>
                    <TableCell className="whitespace-nowrap">{plan.systemName}</TableCell>
                    <TableCell className="max-w-[16rem] truncate" title={plan.workDescription}>{plan.workDescription}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={deletePlanMutation.isPending}
                        onClick={() => removePlanTap(plan.id)}
                        onTouchEnd={(e) => {
                          e.preventDefault();
                          removePlanTap(plan.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={publishConfirmOpen}
        onOpenChange={setPublishConfirmOpen}
        title="Teams に発報しますか？"
        description={`作業実績 ${publishReports.length} 件、次回予定 ${publishPlans.length} 件を Teams に送信します。`}
        confirmLabel={publishing ? "送信中..." : "発報する"}
        cancelLabel="キャンセル"
        onConfirm={() => {
          void handlePublish();
        }}
      />

      <ConfirmDialog
        open={reportDeleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setReportDeleteTargetId(null);
        }}
        title="作業実績を削除しますか？"
        description="この作業実績を一覧から削除します。元に戻せません。"
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        variant="destructive"
        onConfirm={() => {
          if (!reportDeleteTargetId) return;
          deleteReportMutation.mutate(reportDeleteTargetId);
          setReportDeleteTargetId(null);
        }}
      />
    </div>
  );
}
