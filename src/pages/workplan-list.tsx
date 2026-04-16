import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataErrorState } from "@/components/data-error-state";
import { usePlans, useDeletePlan } from "@/hooks/use-sharepoint";
import type { WorkPlan } from "@/types/sharepoint";

function toLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
const today = new Date();
const todayString = toLocalDate(today);

export default function WorkPlanListPage() {
  const { data: allPlans = [], isLoading, isError, error } = usePlans(todayString);
  const deleteMutation = useDeletePlan();

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleDeleteTap = (id: string) => {
    if (deleteMutation.isPending) return;
    handleDelete(id);
  };

  const renderPlansTable = (plansToRender: WorkPlan[], emptyLabel: string) => {
    if (plansToRender.length === 0) {
      return <p className="text-muted-foreground">{emptyLabel}</p>;
    }

    return (
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
          {plansToRender.map((plan: WorkPlan) => (
            <TableRow key={plan.id}>
              <TableCell>{plan.planDate}</TableCell>
              <TableCell>{plan.customerName}</TableCell>
              <TableCell>{plan.systemName}</TableCell>
              <TableCell className="max-w-xs truncate" title={plan.workDescription}>
                {plan.workDescription}
              </TableCell>
              <TableCell>
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
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
      <div className="mb-6">
        <h1 className="text-3xl font-bold">作業予定 - 一覧</h1>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>今日以降の作業予定</CardTitle>
          </CardHeader>
          <CardContent>
            {renderPlansTable(allPlans, "今後の作業予定はありません")}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
