import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCustomers, useSystems, useAddPlan } from "@/hooks/use-sharepoint";

export default function WorkPlanInputPage() {
  const navigate = useNavigate();
  const { data: customers = [] } = useCustomers();
  const { data: systems = [] } = useSystems();
  const addPlan = useAddPlan();

  const [formData, setFormData] = useState({
    planDate: (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })(),
    customerId: "",
    systemId: "",
    workDescription: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const customer = customers.find((c) => c.id === formData.customerId);
    addPlan.mutate(
      {
        Title: `予定-${customer?.name ?? ""}`,
        PlanDate: `${formData.planDate}T00:00:00+09:00`,
        CustomerLookupId: Number(formData.customerId),
        SystemLookupId: Number(formData.systemId),
        WorkDescription: formData.workDescription,
      },
      {
        onSuccess: () => navigate("/workplan-list"),
      }
    );
  };

  const filteredSystems = systems.filter(
    (system) => !formData.customerId || system.customerId === formData.customerId
  );

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">作業予定 - 入力</h1>
        <p className="text-muted-foreground">明日の作業予定を入力してください</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>作業予定</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="planDate">予定日</Label>
              <Input
                id="planDate"
                type="date"
                value={formData.planDate}
                onChange={(e) => setFormData({ ...formData, planDate: e.target.value })}
                required
              />
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
              <Label htmlFor="workDescription">作業内容</Label>
              <Textarea
                id="workDescription"
                placeholder="明日の作業内容を記載してください"
                value={formData.workDescription}
                onChange={(e) => setFormData({ ...formData, workDescription: e.target.value })}
                required
                rows={4}
              />
            </div>

            <div className="flex gap-4 pt-4">
              <Button type="submit" disabled={addPlan.isPending}>保存</Button>
              <Button type="button" variant="ghost" onClick={() => navigate("/dashboard")}>
                キャンセル
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
