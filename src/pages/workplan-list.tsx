import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataErrorState } from "@/components/data-error-state";
import { ActionLoadingOverlay } from "@/components/action-loading-overlay";
import { usePlans, useUpdatePlan, useDeletePlan } from "@/hooks/use-sharepoint";
import { useCurrentUser } from "@/hooks/use-current-user";
import type { WorkPlan } from "@/types/sharepoint";
import { ChevronDown, ChevronUp, Megaphone } from "lucide-react";

function toLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
const today = new Date();

export default function WorkPlanListPage() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [startDate, setStartDate] = useState(toLocalDate(monthStart));
  const [endDate, setEndDate] = useState(toLocalDate(today));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editPlanDate, setEditPlanDate] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(true);

  const { data: plans = [], isLoading, isError, error } = usePlans(startDate, endDate || undefined);
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

  const handleEdit = (plan: WorkPlan) => {
    setEditingId(plan.id);
    setEditDescription(plan.workDescription);
    setEditPlanDate(plan.planDate);
  };

  const handleSave = (plan: WorkPlan) => {
    if (!editDescription.trim() || !editPlanDate) {
      alert("予定日と作業内容を入力してください。");
      return;
    }

    updateMutation.mutate({
      itemId: plan.id,
      fields: {
        PlanDate: `${editPlanDate}T00:00:00+09:00`,
        WorkDescription: editDescription,
      },
    });
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    setDeleteTargetId(id);
  };

  const handleDeleteTap = (id: string) => {
    if (deleteMutation.isPending) return;
    handleDelete(id);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return <DataErrorState title="作業予定を取得できませんでした" error={error} />;
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

      <Card className="mb-6 overflow-hidden">
        <CardHeader>
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
          <CardContent className="grid grid-cols-1 gap-3 pt-0 sm:grid-cols-2">
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
                    <TableCell>
                      {editingId === plan.id ? (
                        <input
                          type="date"
                          className="w-full rounded-md border border-input px-2 py-1 text-sm"
                          value={editPlanDate}
                          onChange={(e) => setEditPlanDate(e.target.value)}
                        />
                      ) : (
                        plan.planDate
                      )}
                    </TableCell>
                    <TableCell>{plan.customerName}</TableCell>
                    <TableCell>{plan.systemName}</TableCell>
                    <TableCell className="max-w-xs truncate" title={plan.workDescription}>
                      {editingId === plan.id ? (
                        <textarea
                          className="w-full rounded-md border border-input p-2 text-sm"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                        />
                      ) : (
                        plan.workDescription
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {editingId === plan.id ? (
                          <>
                            <Button size="sm" onClick={() => handleSave(plan)}>保存</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>キャンセル</Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => handleEdit(plan)}>編集</Button>
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
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
