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
  usePlans,
  useUpdatePlan,
  useDeletePlan,
} from "@/hooks/use-sharepoint";
import { useCurrentUser } from "@/hooks/use-current-user";
import type { WorkPlan } from "@/types/sharepoint";
import { ChevronDown, ChevronUp, Megaphone } from "lucide-react";
import { toast } from "sonner";

const EMPTY_LOOKUP_SELECT_VALUE = "__empty_lookup__";

type PlanFormState = {
  planDate: string;
  customerId: string;
  systemId: string;
  workNumberId: string;
  workTypeId: string;
  workDescription: string;
  plannedHours: string;
  isProject: boolean;
};

function toLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function emptyPlanForm(): PlanFormState {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    planDate: toLocalDate(tomorrow),
    customerId: "",
    systemId: "",
    workNumberId: "",
    workTypeId: "",
    workDescription: "",
    plannedHours: "0",
    isProject: false,
  };
}

function toLookupSelectValue(value: string): string {
  return value || EMPTY_LOOKUP_SELECT_VALUE;
}

function applySystemSelection<T extends { systemId: string; workNumberId: string }>(prev: T, rawValue: string): T {
  const systemId = rawValue === EMPTY_LOOKUP_SELECT_VALUE ? "" : rawValue;
  return {
    ...prev,
    systemId,
    workNumberId: systemId ? "" : prev.workNumberId,
  };
}

function applyWorkNumberSelection<T extends { systemId: string; workNumberId: string }>(prev: T, rawValue: string): T {
  const workNumberId = rawValue === EMPTY_LOOKUP_SELECT_VALUE ? "" : rawValue;
  return {
    ...prev,
    systemId: workNumberId ? "" : prev.systemId,
    workNumberId,
  };
}

export default function WorkPlanListPage() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const nextDay = new Date(today);
  nextDay.setDate(nextDay.getDate() + 1);
  const [startDate, setStartDate] = useState(toLocalDate(monthStart));
  const [endDate, setEndDate] = useState(toLocalDate(nextDay));
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(true);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlanForm());
  const [planSubmitError, setPlanSubmitError] = useState("");

  const { data: customers = [], isLoading: customersLoading, isError: customersErrorState, error: customersError } = useCustomers();
  const { data: systems = [], isLoading: systemsLoading, isError: systemsErrorState, error: systemsError } = useSystems();
  const { data: workNumbers = [], isLoading: workNumbersLoading, isError: workNumbersErrorState, error: workNumbersError } = useWorkNumbers();
  const { data: workTypes = [], isLoading: workTypesLoading, isError: workTypesErrorState, error: workTypesError } = useWorkTypes();
  const { data: plans = [], isLoading: plansLoading, isError: plansErrorState, error: plansError } = usePlans(startDate, endDate || undefined);
  const updateMutation = useUpdatePlan();
  const deleteMutation = useDeletePlan();
  const actionLoadingMessage = updateMutation.isPending
    ? "作業予定を更新しています..."
    : deleteMutation.isPending
      ? "作業予定を削除しています..."
      : "処理中...";
  const actionLoadingOpen = updateMutation.isPending || deleteMutation.isPending;

  const filteredPlans = useMemo(
    () => plans.filter((plan) => plan.userName === currentUser.name),
    [currentUser.name, plans],
  );

  const filteredSystems = useMemo(
    () => systems.filter((system) => !planForm.customerId || system.customerId === planForm.customerId),
    [planForm.customerId, systems],
  );

  const filteredWorkNumbers = useMemo(() => {
    if (!planForm.customerId) {
      return [];
    }

    const customerSystemIds = new Set(
      systems
        .filter((system) => system.customerId === planForm.customerId)
        .map((system) => system.id),
    );

    return workNumbers.filter((workNumber) => customerSystemIds.has(workNumber.systemId));
  }, [planForm.customerId, systems, workNumbers]);

  const workNumberDisplayMap = useMemo(
    () => new Map(
      workNumbers.map((workNumber) => [
        workNumber.id,
        workNumber.systemName || workNumber.workNumber || "",
      ]),
    ),
    [workNumbers],
  );

  const resolveSystemDisplayName = (plan: WorkPlan) =>
    plan.systemName
    || workNumberDisplayMap.get(plan.workNumberId)
    || plan.workNumber
    || "―";

  const closePlanModal = () => {
    setPlanModalOpen(false);
    setEditingPlanId(null);
    setPlanForm(emptyPlanForm());
    setPlanSubmitError("");
  };

  const openEditPlanModal = (plan: WorkPlan) => {
    setEditingPlanId(plan.id);
    setPlanForm({
      planDate: plan.planDate,
      customerId: plan.customerId,
      systemId: plan.workNumberId ? "" : plan.systemId,
      workNumberId: plan.workNumberId,
      workTypeId: plan.workTypeId,
      workDescription: plan.workDescription,
      plannedHours: String(plan.plannedHours ?? 0),
      isProject: plan.isProject,
    });
    setPlanSubmitError("");
    setPlanModalOpen(true);
  };

  const savePlan = async () => {
    if (!editingPlanId) return;
    if (!planForm.customerId) {
      setPlanSubmitError("必須項目を入力してください。");
      return;
    }

    const plannedHours = Number(planForm.plannedHours);
    if (Number.isNaN(plannedHours) || plannedHours < 0) {
      setPlanSubmitError("予定時間は 0 以上で入力してください。");
      return;
    }

    const customer = customers.find((item) => item.id === planForm.customerId);
    const workNumber = filteredWorkNumbers.find((item) => item.id === planForm.workNumberId) ?? null;
    const fields = {
      Title: `予定-${customer?.name ?? ""}`,
      PlanDate: `${planForm.planDate}T00:00:00+09:00`,
      CustomerLookupId: Number(planForm.customerId),
      SystemLookupId: planForm.systemId ? Number(planForm.systemId) : null,
      WorkTypeLookupId: planForm.workTypeId ? Number(planForm.workTypeId) : null,
      WorkNumberLookupId: workNumber ? Number(workNumber.id) : null,
      WorkDescription: planForm.workDescription,
      PlannedHours: plannedHours,
      IsProject: planForm.isProject,
      AssigneeName: currentUser.name,
    };

    try {
      await updateMutation.mutateAsync({ itemId: editingPlanId, fields });
      toast.success("作業予定を更新しました。", { duration: 2200 });
      closePlanModal();
    } catch (error) {
      setPlanSubmitError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDeleteTap = (id: string) => {
    if (deleteMutation.isPending) return;
    setDeleteTargetId(id);
  };

  if (plansLoading || customersLoading || systemsLoading || workNumbersLoading || workTypesLoading) {
    return (
      <div className="container mx-auto py-6 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (plansErrorState || customersErrorState || systemsErrorState || workNumbersErrorState || workTypesErrorState) {
    return (
      <DataErrorState
        title="作業予定を取得できませんでした"
        error={plansError ?? customersError ?? systemsError ?? workNumbersError ?? workTypesError}
      />
    );
  }

  return (
    <div className="container mx-auto py-6">
      <ActionLoadingOverlay open={actionLoadingOpen} message={actionLoadingMessage} />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">作業予定 - 一覧</h1>
          <p className="text-muted-foreground">ログインユーザーの作業予定を日付範囲で絞り込んで編集・削除できます。</p>
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
            <CardTitle>対象作業予定</CardTitle>
            <Badge variant="outline">{filteredPlans.length} 件</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {filteredPlans.length === 0 ? (
            <p className="text-sm text-muted-foreground">指定期間にログインユーザーの作業予定はありません。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>予定日</TableHead>
                  <TableHead>顧客</TableHead>
                  <TableHead>システム</TableHead>
                  <TableHead>作業内容</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPlans.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell>{plan.planDate}</TableCell>
                    <TableCell>{plan.customerName}</TableCell>
                    <TableCell>{resolveSystemDisplayName(plan)}</TableCell>
                    <TableCell className="max-w-xs truncate" title={plan.workDescription}>
                      {plan.workDescription}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEditPlanModal(plan)}>編集</Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={deleteMutation.isPending}
                          onClick={() => handleDeleteTap(plan.id)}
                          onTouchEnd={(e) => {
                            e.preventDefault();
                            handleDeleteTap(plan.id);
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
          )}
        </CardContent>
      </Card>

      <FormModal
        open={planModalOpen}
        onOpenChange={(open) => {
          if (!open) closePlanModal();
        }}
        title="作業予定を編集"
        description=""
        onCancel={closePlanModal}
        onSave={() => {
          void savePlan();
        }}
        saveLabel="更新"
        isSaving={updateMutation.isPending}
      >
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-1">
            <div className="space-y-1.5">
              <Label>予定日</Label>
              <Input type="date" value={planForm.planDate} onChange={(e) => setPlanForm({ ...planForm, planDate: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-1">
            <div className="space-y-1.5">
              <Label>顧客</Label>
              <Select value={planForm.customerId} onValueChange={(value) => setPlanForm({ ...planForm, customerId: value, systemId: "", workNumberId: "" })}>
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
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>システム</Label>
              <Select
                value={toLookupSelectValue(planForm.systemId)}
                onValueChange={(value) => setPlanForm((prev) => applySystemSelection(prev, value))}
                disabled={!planForm.customerId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="システムを選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_LOOKUP_SELECT_VALUE}>未選択</SelectItem>
                  {filteredSystems.map((system) => (
                    <SelectItem key={system.id} value={system.id}>{system.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>工番</Label>
              <Select
                value={toLookupSelectValue(planForm.workNumberId)}
                onValueChange={(value) => setPlanForm((prev) => applyWorkNumberSelection(prev, value))}
                disabled={!planForm.customerId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="工番を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_LOOKUP_SELECT_VALUE}>未選択</SelectItem>
                  {filteredWorkNumbers.map((workNumber) => (
                    <SelectItem key={workNumber.id} value={workNumber.id}>{workNumber.systemName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>作業区分</Label>
              <Select value={toLookupSelectValue(planForm.workTypeId)} onValueChange={(value) => setPlanForm({ ...planForm, workTypeId: value === EMPTY_LOOKUP_SELECT_VALUE ? "" : value })}>
                <SelectTrigger>
                  <SelectValue placeholder="作業区分を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_LOOKUP_SELECT_VALUE}>未選択</SelectItem>
                  {workTypes.map((workType) => (
                    <SelectItem key={workType.id} value={workType.id}>{workType.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>予定時間</Label>
              <Input type="number" min="0" step="0.25" value={planForm.plannedHours} onChange={(e) => setPlanForm({ ...planForm, plannedHours: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>案件</Label>
              <div className="flex h-10 items-center gap-2">
                <Checkbox checked={planForm.isProject} onCheckedChange={(checked) => setPlanForm({ ...planForm, isProject: checked === true })} />
                <span className="text-sm">案件</span>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>作業内容</Label>
            <Textarea value={planForm.workDescription} onChange={(e) => setPlanForm({ ...planForm, workDescription: e.target.value })} rows={4} />
          </div>
          {planSubmitError && <p className="text-sm text-destructive">登録できませんでした: {planSubmitError}</p>}
        </div>
      </FormModal>

      <ConfirmDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null);
        }}
        title="作業予定を削除しますか？"
        description="この作業予定を削除します。元に戻せません。"
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
