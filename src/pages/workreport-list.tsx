import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useReports, useUpdateReport, useDeleteReport } from "@/hooks/use-sharepoint";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ChevronDown, ChevronUp } from "lucide-react";

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editWorkTime, setEditWorkTime] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(true);

  const { data: reports = [], isLoading } = useReports(startDate, endDate);
  const updateMutation = useUpdateReport();
  const deleteMutation = useDeleteReport();

  const filteredReports = useMemo(
    () => reports.filter((report) => report.userName === currentUser.name),
    [currentUser.name, reports],
  );

  const handleEdit = (report: typeof reports[0]) => {
    setEditingId(report.id);
    setEditDescription(report.workDescription);
    setEditWorkTime(String(report.workHours));
  };

  const handleSave = (report: typeof reports[0]) => {
    const workTime = parseFloat(editWorkTime);
    if (!editDescription.trim() || Number.isNaN(workTime) || workTime <= 0) {
      alert("作業内容と正しい作業時間を入力してください。");
      return;
    }
    updateMutation.mutate({
      itemId: report.id,
      fields: { WorkDescription: editDescription, WorkHours: workTime },
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

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">作業報告 - 一覧</h1>
          <p className="text-muted-foreground">ログインユーザーの作業報告を日付範囲で絞り込んで編集・削除できます。</p>
        </div>
        <Button onClick={() => navigate("/daily-entry")}>日次入力へ戻る</Button>
      </div>

      <Card className="mb-6">
        <CardHeader className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">検索条件</div>
            <Button size="sm" variant="outline" onClick={() => setFilterOpen((prev) => !prev)}>
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
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>対象作業報告</CardTitle>
            <Badge variant="outline">{filteredReports.length} 件</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {filteredReports.length === 0 ? (
            <p className="text-sm text-muted-foreground">指定期間にログインユーザーの作業報告はありません。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>報告日</TableHead>
                  <TableHead>顧客</TableHead>
                  <TableHead>システム</TableHead>
                  <TableHead>作業内容</TableHead>
                  <TableHead>区分</TableHead>
                  <TableHead>時間</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell>{report.reportDate}</TableCell>
                    <TableCell>{report.customerName}</TableCell>
                    <TableCell>{report.systemName}</TableCell>
                    <TableCell className="max-w-xs truncate" title={report.workDescription}>
                      {editingId === report.id ? (
                        <textarea
                          className="w-full rounded-md border border-input p-2 text-sm"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                        />
                      ) : (
                        report.workDescription
                      )}
                    </TableCell>
                    <TableCell>{report.workTypeName}</TableCell>
                    <TableCell>
                      {editingId === report.id ? (
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          className="w-20 rounded-md border border-input px-2 py-1 text-sm"
                          value={editWorkTime}
                          onChange={(e) => setEditWorkTime(e.target.value)}
                        />
                      ) : (
                        `${report.workHours.toFixed(1)}h`
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {editingId === report.id ? (
                          <>
                            <Button size="sm" onClick={() => handleSave(report)}>保存</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>キャンセル</Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => handleEdit(report)}>編集</Button>
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
        title="作業報告を削除しますか？"
        description="この作業報告を削除します。元に戻せません。"
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
