import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, CheckCircle2, Trash2 } from "lucide-react";
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

function toLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const today = toLocalDate(new Date());
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return toLocalDate(d); })();

export default function DailyEntryPage() {
  const { data: customers = [] } = useCustomers();
  const { data: systems = [] } = useSystems();
  const { data: workTypes = [] } = useWorkTypes();
  const { data: reports = [], isLoading: reportsLoading } = useReports(today, today);
  const { data: plans = [], isLoading: plansLoading } = usePlans(tomorrow, tomorrow);

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
  });

  const [planForm, setPlanForm] = useState({
    customerId: "",
    systemId: "",
    workDescription: "",
    planDate: tomorrow,
  });

  const filteredReportSystems = systems.filter(
    (system) => !reportForm.customerId || system.customerId === reportForm.customerId,
  );
  const filteredPlanSystems = systems.filter(
    (system) => !planForm.customerId || system.customerId === planForm.customerId,
  );

  const addReportToStore = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (
      !reportForm.customerId ||
      !reportForm.systemId ||
      !reportForm.workTypeId ||
      !reportForm.workDescription.trim() ||
      !reportForm.workTime.trim()
    ) {
      alert("本日の作業報告の必須項目を入力してください。");
      return;
    }

    const workTime = parseFloat(reportForm.workTime);
    if (Number.isNaN(workTime) || workTime <= 0) {
      alert("正しい作業時間を入力してください。");
      return;
    }

    const customer = customers.find((c) => c.id === reportForm.customerId);

    addReportMutation.mutate({
      Title: `日報-${customer?.name ?? ""}`,
      ReportDate: `${reportForm.reportDate}T00:00:00+09:00`,
      CustomerLookupId: Number(reportForm.customerId),
      SystemLookupId: Number(reportForm.systemId),
      WorkTypeLookupId: Number(reportForm.workTypeId),
      WorkDescription: reportForm.workDescription,
      WorkHours: workTime,
      ReporterName: currentUser.name,
    });

    setReportForm({ ...reportForm, customerId: "", systemId: "", workTypeId: "", workDescription: "", workTime: "" });
  };

  const addPlan = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!planForm.customerId || !planForm.systemId || !planForm.workDescription.trim()) {
      alert("明日の作業予定の必須項目を入力してください。");
      return;
    }

    const customer = customers.find((c) => c.id === planForm.customerId);

    addPlanMutation.mutate({
      Title: `予定-${customer?.name ?? ""}`,
      PlanDate: `${planForm.planDate}T00:00:00+09:00`,
      CustomerLookupId: Number(planForm.customerId),
      SystemLookupId: Number(planForm.systemId),
      WorkDescription: planForm.workDescription,
      AssigneeName: currentUser.name,
    });

    setPlanForm({ ...planForm, customerId: "", systemId: "", workDescription: "" });
  };

  const removeReport = (id: string) => {
    if (!confirm("この作業報告を削除しますか？")) return;
    deleteReportMutation.mutate(id);
  };

  const removePlan = (id: string) => {
    deletePlanMutation.mutate(id);
  };

  const [publishing, setPublishing] = useState(false);

  const handlePublish = async () => {
    if (reports.length === 0 && plans.length === 0) {
      alert("送信する作業報告・予定がありません。");
      return;
    }
    if (!TEAMS_CONFIG.teamId || !TEAMS_CONFIG.channelId) {
      alert("Teams チャネルが設定されていません。管理者に連絡してください。");
      return;
    }
    if (!confirm(`本日の作業報告 ${reports.length} 件、明日の予定 ${plans.length} 件を Teams に送信しますか？`)) {
      return;
    }

    setPublishing(true);
    try {
      const userName = currentUser.name;
      const reportRows = reports
        .map((r) => `<tr><td>${r.customerName}</td><td>${r.systemName}</td><td>${r.workTypeName}</td><td style="text-align:right">${r.workHours.toFixed(1)}h</td><td>${r.workDescription}</td></tr>`)
        .join("");
      const planRows = plans
        .map((p) => `<tr><td>${p.customerName}</td><td>${p.systemName}</td><td>${p.workDescription}</td></tr>`)
        .join("");

      const totalHours = reports.reduce((sum, r) => sum + r.workHours, 0);

      const html = `
<h3>📋 日次報告 — ${userName}（${today}）</h3>
<h4>■ 本日の作業報告（${reports.length} 件 / ${totalHours.toFixed(1)}h）</h4>
${reports.length > 0 ? `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%">
<tr style="background:#f0f0f0"><th>顧客</th><th>システム</th><th>区分</th><th>時間</th><th>作業内容</th></tr>
${reportRows}
</table>` : "<p>（なし）</p>"}
<br/>
<h4>■ 明日の作業予定（${plans.length} 件）</h4>
${plans.length > 0 ? `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%">
<tr style="background:#f0f0f0"><th>顧客</th><th>システム</th><th>作業内容</th></tr>
${planRows}
</table>` : "<p>（なし）</p>"}
      `.trim();

      await postTeamsChannelMessage(TEAMS_CONFIG.teamId, TEAMS_CONFIG.channelId, html);
      alert("Teams チャネルに送信しました。");
    } catch (err) {
      console.error("Teams 送信エラー:", err);
      alert(`Teams への送信に失敗しました。\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPublishing(false);
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
      <div className="mb-6 flex flex-col gap-3 min-w-0">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">日次入力</h1>
            <p className="text-muted-foreground">今日の作業報告と明日の予定を入力します。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={handlePublish} disabled={publishing}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> {publishing ? "送信中..." : "発報"}
            </Button>
          </div>
        </div>
      </div>

      {/* ── 入力フォーム ── */}
      <div className="grid gap-6 lg:grid-cols-2 min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>本日の作業報告</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addReportToStore} className="space-y-4">
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
                  <Label>報告日</Label>
                  <input
                    type="date"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                    value={reportForm.reportDate}
                    onChange={(e) => setReportForm({ ...reportForm, reportDate: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>作業時間</Label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                    value={reportForm.workTime}
                    onChange={(e) => setReportForm({ ...reportForm, workTime: e.target.value })}
                    placeholder="8.0"
                  />
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
                  <Plus className="mr-2 h-4 w-4" /> 作業を追加
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setReportForm({ ...reportForm, customerId: "", systemId: "", workTypeId: "", workDescription: "", workTime: "" })
                  }
                >
                  クリア
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>明日の予定</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addPlan} className="space-y-4">
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
              <div className="space-y-1.5">
                <Label>作業内容</Label>
                <Textarea
                  value={planForm.workDescription}
                  onChange={(e) => setPlanForm({ ...planForm, workDescription: e.target.value })}
                  placeholder="明日の予定作業を入力..."
                  rows={3}
                />
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={addPlanMutation.isPending}>予定を追加</Button>
                <Button type="button" variant="outline" onClick={() => setPlanForm({ ...planForm, customerId: "", systemId: "", workDescription: "" })}>
                  クリア
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* ── 一覧テーブル ── */}
      <div className="grid gap-6 lg:grid-cols-2 mt-6 min-w-0">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>本日の作業報告一覧</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">まだ作業報告がありません。</p>
            ) : (
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>顧客</TableHead>
                  <TableHead>システム</TableHead>
                  <TableHead>区分</TableHead>
                  <TableHead className="text-right">時間</TableHead>
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
                    <TableCell className="max-w-[16rem] truncate" title={report.workDescription}>
                      {report.workDescription}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="destructive" onClick={() => removeReport(report.id)}>
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
            <CardTitle>明日の予定一覧</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">まだ作業予定がありません。</p>
            ) : (
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>顧客</TableHead>
                  <TableHead>システム</TableHead>
                  <TableHead>作業内容</TableHead>
                  <TableHead className="w-20">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell className="whitespace-nowrap">{plan.customerName}</TableCell>
                    <TableCell className="whitespace-nowrap">{plan.systemName}</TableCell>
                    <TableCell className="max-w-[16rem] truncate" title={plan.workDescription}>{plan.workDescription}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={deletePlanMutation.isPending}
                        onClick={() => removePlan(plan.id)}
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
    </div>
  );
}
