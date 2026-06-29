import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataErrorState } from "@/components/data-error-state";
import { ActionLoadingOverlay } from "@/components/action-loading-overlay";
import { FormModal } from "@/components/form-modal";
import {
  useCustomers,
  useSystems,
  useWorkNumbers,
  useWorkTypes,
  useReports,
  useUpdateReport,
  useDeleteReport,
} from "@/hooks/use-sharepoint";
import { useCurrentUser } from "@/hooks/use-current-user";
import type { WorkReport } from "@/types/sharepoint";
import { ChevronDown, ChevronUp, Megaphone } from "lucide-react";
import { formatWorkHours } from "@/lib/utils";
import { toast } from "sonner";
import type { Achievement } from "@/types/sharepoint";

const EMPTY_LOOKUP_SELECT_VALUE = "__empty_lookup__";
const EMPTY_ACHIEVEMENT_SELECT_VALUE = "__empty_achievement__";
const ACHIEVEMENT_OPTIONS: Exclude<Achievement, null>[] = ["○", "△", "✕"];

type ReportFormState = {
  reportDate: string;
  customerId: string;
  systemId: string;
  workNumberId: string;
  workTypeId: string;
  workDescription: string;
  workTime: string;
  isProject: boolean;
  achievement: Achievement;
};

function toLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyReportForm(): ReportFormState {
  return {
    reportDate: toLocalDate(new Date()),
    customerId: "",
    systemId: "",
    workNumberId: "",
    workTypeId: "",
    workDescription: "",
    workTime: "0",
    isProject: false,
    achievement: null,
  };
}

function toLookupSelectValue(value: string): string {
  return value || EMPTY_LOOKUP_SELECT_VALUE;
}

function toAchievementSelectValue(value: Achievement): string {
  return value ?? EMPTY_ACHIEVEMENT_SELECT_VALUE;
}

function fromAchievementSelectValue(value: string): Achievement {
  return value === EMPTY_ACHIEVEMENT_SELECT_VALUE ? null : value as Exclude<Achievement, null>;
}

function applySystemSelection<T extends { systemId: string; workNumberId: string }>(prev: T, rawValue: string): T {
  const systemId = rawValue === EMPTY_LOOKUP_SELECT_VALUE ? "" : rawValue;
  return {
    ...prev,
    systemId,
    workNumberId: "",
  };
}

function applyWorkNumberSelection<T extends { systemId: string; workNumberId: string }>(prev: T, rawValue: string): T {
  const workNumberId = rawValue === EMPTY_LOOKUP_SELECT_VALUE ? "" : rawValue;
  return {
    ...prev,
    workNumberId,
  };
}

export default function WorkReportListPage() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [endDate, setEndDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(true);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [reportForm, setReportForm] = useState<ReportFormState>(emptyReportForm());
  const [reportSubmitError, setReportSubmitError] = useState("");

  const { data: customers = [], isLoading: customersLoading, isError: customersErrorState, error: customersError } = useCustomers();
  const { data: systems = [], isLoading: systemsLoading, isError: systemsErrorState, error: systemsError } = useSystems();
  const { data: workNumbers = [], isLoading: workNumbersLoading, isError: workNumbersErrorState, error: workNumbersError } = useWorkNumbers();
  const { data: workTypes = [], isLoading: workTypesLoading, isError: workTypesErrorState, error: workTypesError } = useWorkTypes();
  const { data: reports = [], isLoading: reportsLoading, isError: reportsErrorState, error: reportsError } = useReports(startDate, endDate);
  const updateMutation = useUpdateReport();
  const deleteMutation = useDeleteReport();
  const actionLoadingMessage = updateMutation.isPending
    ? "作業実績を更新しています..."
    : deleteMutation.isPending
      ? "作業実績を削除しています..."
      : "処理中...";
  const actionLoadingOpen = updateMutation.isPending || deleteMutation.isPending;

  const filteredReports = useMemo(
    () => reports.filter((report) => report.userName === currentUser.name),
    [currentUser.name, reports],
  );
  const activeSystems = useMemo(
    () => systems.filter((system) => !system.isDisabled),
    [systems],
  );

  const filteredSystems = useMemo(
    () => activeSystems.filter((system) => !reportForm.customerId || system.customerId === reportForm.customerId),
    [activeSystems, reportForm.customerId],
  );

  const workNumberMap = useMemo(
    () => new Map(workNumbers.map((workNumber) => [workNumber.id, workNumber])),
    [workNumbers],
  );
  const filteredWorkNumbers = useMemo(() => {
    if (!reportForm.systemId) {
      return [];
    }
    return workNumbers.filter((workNumber) => workNumber.systemId === reportForm.systemId);
  }, [reportForm.systemId, workNumbers]);

  const workNumberSystemNameMap = useMemo(
    () => new Map(workNumbers.map((workNumber) => [workNumber.id, workNumber.systemName])),
    [workNumbers],
  );
  const resolveLinkedSystemId = (systemId: string, workNumberId: string) =>
    systemId || workNumberMap.get(workNumberId)?.systemId || "";

  const totalWorkHours = useMemo(
    () => filteredReports.reduce((sum, report) => sum + report.workHours, 0),
    [filteredReports],
  );

  const resolveSystemDisplayName = (report: WorkReport) =>
    report.systemName
    || workNumberSystemNameMap.get(report.workNumberId)
    || "―";

  const closeReportModal = () => {
    setReportModalOpen(false);
    setEditingReportId(null);
    setReportForm(emptyReportForm());
    setReportSubmitError("");
  };

  const openEditReportModal = (report: WorkReport) => {
    setEditingReportId(report.id);
    setReportForm({
      reportDate: report.reportDate,
      customerId: report.customerId,
      systemId: resolveLinkedSystemId(report.systemId, report.workNumberId),
      workNumberId: report.workNumberId,
      workTypeId: report.workTypeId,
      workDescription: report.workDescription,
      workTime: String(report.workHours ?? 0),
      isProject: report.isProject,
      achievement: report.achievement,
    });
    setReportSubmitError("");
    setReportModalOpen(true);
  };

  const saveReport = async () => {
    if (!editingReportId) return;
    if (!reportForm.customerId || !reportForm.systemId || !reportForm.workTypeId) {
      setReportSubmitError("必須項目を入力してください。");
      return;
    }

    const workHours = Number(reportForm.workTime);
    if (Number.isNaN(workHours) || workHours < 0) {
      setReportSubmitError("作業時間は 0 以上で入力してください。");
      return;
    }

    const customer = customers.find((item) => item.id === reportForm.customerId);
    const workNumber = filteredWorkNumbers.find((item) => item.id === reportForm.workNumberId) ?? null;
    const fields = {
      Title: `日報-${customer?.name ?? ""}`,
      ReportDate: `${reportForm.reportDate}T00:00:00+09:00`,
      CustomerLookupId: Number(reportForm.customerId),
      SystemLookupId: reportForm.systemId ? Number(reportForm.systemId) : null,
      WorkTypeLookupId: Number(reportForm.workTypeId),
      WorkNumberLookupId: workNumber ? Number(workNumber.id) : null,
      WorkDescription: reportForm.workDescription,
      WorkHours: workHours,
      ReporterName: currentUser.name,
      IsProject: reportForm.isProject,
      Achievement: reportForm.achievement,
    };

    try {
      await updateMutation.mutateAsync({ itemId: editingReportId, fields });
      toast.success("作業実績を更新しました。", { duration: 2200 });
      closeReportModal();
    } catch (error) {
      setReportSubmitError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDeleteTap = (id: string) => {
    if (deleteMutation.isPending) return;
    setDeleteTargetId(id);
  };

  if (reportsLoading || customersLoading || systemsLoading || workNumbersLoading || workTypesLoading) {
    return (
      <div className="container mx-auto py-6 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (reportsErrorState || customersErrorState || systemsErrorState || workNumbersErrorState || workTypesErrorState) {
    return (
      <DataErrorState
        title="作業実績を取得できませんでした"
        error={reportsError ?? customersError ?? systemsError ?? workNumbersError ?? workTypesError}
      />
    );
  }

  return (
    <div className="container mx-auto py-6">
      <ActionLoadingOverlay open={actionLoadingOpen} message={actionLoadingMessage} />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">作業実績 - 一覧</h1>
          <p className="text-muted-foreground">ログインユーザーの作業実績を日付範囲で絞り込んで編集・削除できます。</p>
        </div>
        <Button onClick={() => navigate("/daily-entry")}><Megaphone className="mr-2 h-4 w-4" />日次入力へ戻る</Button>
      </div>

      <Card className="mb-6 gap-0 overflow-hidden py-0">
        <CardHeader className="px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium leading-none">検索条件</div>
            <Button size="sm" className="h-8 px-3" variant="outline" onClick={() => setFilterOpen((prev) => !prev)}>
              {filterOpen ? (
                <>
                  <ChevronUp className="mr-2 h-4 w-4" />
                  隠す
                </>
              ) : (
                <>
                  <ChevronDown className="mr-2 h-4 w-4" />
                  表示
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        {filterOpen && (
          <CardContent className="grid grid-cols-1 gap-3 px-2 pb-2 pt-0 sm:grid-cols-2">
            <Input className="h-8" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input className="h-8" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>対象作業実績</CardTitle>
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">合計: {formatWorkHours(totalWorkHours)}h</div>
              <Badge variant="outline">{filteredReports.length} 件</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredReports.length === 0 ? (
            <p className="text-sm text-muted-foreground">指定期間にログインユーザーの作業実績はありません。</p>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>報告日</TableHead>
                    <TableHead>顧客</TableHead>
                    <TableHead>システム</TableHead>
                    <TableHead>作業内容</TableHead>
                    <TableHead>区分</TableHead>
                    <TableHead>時間</TableHead>
                    <TableHead>案件</TableHead>
                    <TableHead>達成度</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReports.map((report) => (
                    <TableRow key={report.id} onDoubleClick={() => openEditReportModal(report)} className="cursor-pointer">
                      <TableCell>{report.reportDate}</TableCell>
                      <TableCell>{report.customerName}</TableCell>
                      <TableCell>{resolveSystemDisplayName(report)}</TableCell>
                      <TableCell className="max-w-xs truncate" title={report.workDescription}>
                        {report.workDescription}
                      </TableCell>
                      <TableCell>{report.workTypeName || "―"}</TableCell>
                      <TableCell>{formatWorkHours(report.workHours)}h</TableCell>
                      <TableCell className="text-center">{report.isProject ? "○" : "―"}</TableCell>
                      <TableCell className="text-center">{report.achievement ?? "―"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => openEditReportModal(report)}>編集</Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={deleteMutation.isPending}
                            onClick={() => handleDeleteTap(report.id)}
                            onTouchEnd={(e) => {
                              e.preventDefault();
                              handleDeleteTap(report.id);
                            }}
                          >
                            削除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <FormModal
        open={reportModalOpen}
        onOpenChange={(open) => {
          if (!open) closeReportModal();
        }}
        title="作業実績を編集"
        description=""
        onCancel={closeReportModal}
        onSave={() => {
          void saveReport();
        }}
        saveLabel="更新"
        isSaving={updateMutation.isPending}
      >
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-1">
            <div className="space-y-1.5">
              <Label>報告日</Label>
              <Input type="date" value={reportForm.reportDate} onChange={(e) => setReportForm({ ...reportForm, reportDate: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-1">
            <div className="space-y-1.5">
              <Label>顧客</Label>
              <Select value={reportForm.customerId} onValueChange={(value) => setReportForm({ ...reportForm, customerId: value, systemId: "", workNumberId: "" })}>
                <SelectTrigger>
                  <SelectValue placeholder="顧客を選択" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>{customer.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>システム</Label>
              <Select
                value={reportForm.systemId}
                onValueChange={(value) => setReportForm((prev) => applySystemSelection(prev, value))}
                disabled={!reportForm.customerId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="システムを選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSystems.map((system) => (
                      <SelectItem key={system.id} value={system.id}>{system.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>工事番号</Label>
              <Select
                value={toLookupSelectValue(reportForm.workNumberId)}
                onValueChange={(value) => setReportForm((prev) => applyWorkNumberSelection(prev, value))}
                disabled={!reportForm.systemId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="工事番号を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_LOOKUP_SELECT_VALUE}>工事番号なし</SelectItem>
                  {filteredWorkNumbers.map((workNumber) => (
                    <SelectItem key={workNumber.id} value={workNumber.id}>{workNumber.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>作業区分</Label>
              <Select value={reportForm.workTypeId} onValueChange={(value) => setReportForm({ ...reportForm, workTypeId: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="作業区分を選択" />
                </SelectTrigger>
                <SelectContent>
                  {workTypes.map((workType) => (
                    <SelectItem key={workType.id} value={workType.id}>{workType.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>作業時間</Label>
              <Input type="number" min="0" step="0.25" value={reportForm.workTime} onChange={(e) => setReportForm({ ...reportForm, workTime: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>案件</Label>
              <div className="flex h-10 items-center gap-2">
                <Checkbox checked={reportForm.isProject} onCheckedChange={(checked) => setReportForm({ ...reportForm, isProject: checked === true })} />
                <span className="text-sm">案件</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>達成度</Label>
              <Select value={toAchievementSelectValue(reportForm.achievement)} onValueChange={(value) => setReportForm({ ...reportForm, achievement: fromAchievementSelectValue(value) })}>
                <SelectTrigger>
                  <SelectValue placeholder="達成度を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_ACHIEVEMENT_SELECT_VALUE}>達成度を選択</SelectItem>
                  {ACHIEVEMENT_OPTIONS.map((achievement) => (
                    <SelectItem key={achievement} value={achievement}>{achievement}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>作業内容</Label>
            <Textarea value={reportForm.workDescription} onChange={(e) => setReportForm({ ...reportForm, workDescription: e.target.value })} rows={4} />
          </div>
          {reportSubmitError && <p className="text-sm text-destructive">登録できませんでした: {reportSubmitError}</p>}
        </div>
      </FormModal>

      <ConfirmDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null);
        }}
        title="作業実績を削除しますか？"
        description="この作業実績を削除します。元に戻せません。"
        confirmLabel={deleteMutation.isPending ? "削除中..." : "削除する"}
        cancelLabel="キャンセル"
        variant="destructive"
        onConfirm={() => {
          if (!deleteTargetId) return;
          deleteMutation.mutate(deleteTargetId);
          setDeleteTargetId(null);
        }}
      />
    </div>
  );
}
