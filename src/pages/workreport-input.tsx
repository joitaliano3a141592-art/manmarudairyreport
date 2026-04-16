import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataErrorState } from "@/components/data-error-state";
import { ActionLoadingOverlay } from "@/components/action-loading-overlay";
import { useCustomers, useSystems, useWorkTypes, useAddReport } from "@/hooks/use-sharepoint";
import { useCurrentUser } from "@/hooks/use-current-user";

export default function WorkReportInputPage() {
  const navigate = useNavigate();
  const { data: customers = [], isError: custError, error: customersError } = useCustomers();
  const { data: systems = [], isError: sysError, error: systemsError } = useSystems();
  const { data: workTypes = [], isError: wtError, error: workTypesError } = useWorkTypes();
  const addReport = useAddReport();
  const currentUser = useCurrentUser();

  const [formData, setFormData] = useState({
    reportDate: (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; })(),
    customerId: "",
    systemId: "",
    workDescription: "",
    workTypeId: "",
    workTime: "",
  });
  const [submitError, setSubmitError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customerId || !formData.systemId || !formData.workTypeId || !formData.workDescription.trim()) {
      setSubmitError("必須項目を入力してください。");
      return;
    }
    const workTime = parseFloat(formData.workTime);
    if (Number.isNaN(workTime) || workTime <= 0) {
      setSubmitError("正しい作業時間を入力してください。");
      return;
    }
    setSubmitError("");
    const customer = customers.find((c) => c.id === formData.customerId);
    addReport.mutate(
      {
        Title: `日報-${customer?.name ?? ""}`,
        ReportDate: `${formData.reportDate}T00:00:00+09:00`,
        CustomerLookupId: Number(formData.customerId),
        SystemLookupId: Number(formData.systemId),
        WorkTypeLookupId: Number(formData.workTypeId),
        WorkDescription: formData.workDescription,
        WorkHours: workTime,
        ReporterName: currentUser.name,
      },
      {
        onSuccess: () => navigate("/workreport-list"),
        onError: (error) => {
          setSubmitError(error instanceof Error ? error.message : String(error));
        },
      }
    );
  };

  const filteredSystems = systems.filter(
    (system) => !formData.customerId || system.customerId === formData.customerId
  );

  if (custError || sysError || wtError) {
    return (
      <DataErrorState
        title="入力に必要なマスタデータを取得できませんでした"
        error={customersError ?? systemsError ?? workTypesError}
      />
    );
  }

  return (
    <div className="container mx-auto py-6">
      <ActionLoadingOverlay open={addReport.isPending} message="作業実績を登録しています..." />
      <div className="mb-6">
        <h1 className="text-3xl font-bold">作業実績 - 入力</h1>
        <p className="text-muted-foreground">本日の作業内容を入力してください</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>作業実績</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="reportDate">報告日</Label>
                <Input
                  id="reportDate"
                  type="date"
                  value={formData.reportDate}
                  onChange={(e) => setFormData({ ...formData, reportDate: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="workTime">作業時間（時間）</Label>
                <Input
                  id="workTime"
                  type="number"
                  step="0.5"
                  placeholder="8.0"
                  value={formData.workTime}
                  onChange={(e) => setFormData({ ...formData, workTime: e.target.value })}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="customer">顧客</Label>
              <Select
                value={formData.customerId}
                onValueChange={(value) => setFormData({ ...formData, customerId: value, systemId: "" })}
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

            <div>
              <Label htmlFor="system">システム</Label>
              <Select
                value={formData.systemId}
                onValueChange={(value) => setFormData({ ...formData, systemId: value })}
                disabled={!formData.customerId}
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

            <div>
              <Label htmlFor="workType">作業区分</Label>
              <Select
                value={formData.workTypeId}
                onValueChange={(value) => setFormData({ ...formData, workTypeId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="作業区分を選択" />
                </SelectTrigger>
                <SelectContent>
                  {workTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="workDescription">作業内容</Label>
              <Textarea
                id="workDescription"
                placeholder="作業内容を詳細に記載してください"
                value={formData.workDescription}
                onChange={(e) => setFormData({ ...formData, workDescription: e.target.value })}
                required
                rows={4}
              />
            </div>

            <div className="flex gap-4 pt-4">
              <Button type="submit" disabled={addReport.isPending}>保存</Button>
              <Button type="button" variant="ghost" onClick={() => navigate("/dashboard")}>
                キャンセル
              </Button>
            </div>
            {submitError && <p className="text-sm text-destructive">登録できませんでした: {submitError}</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
