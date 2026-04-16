import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataErrorState } from "@/components/data-error-state";
import { ActionLoadingOverlay } from "@/components/action-loading-overlay";
import {
  useCustomers, useAddCustomer, useUpdateCustomer, useDeleteCustomer,
  useSystems, useAddSystem, useUpdateSystem, useDeleteSystem,
  useWorkTypes, useAddWorkType, useUpdateWorkType, useDeleteWorkType,
} from "@/hooks/use-sharepoint";

export default function MastersPage() {
  const { data: customers = [], isLoading: custLoading, isError: custError, error: customersError } = useCustomers();
  const { data: systems = [], isLoading: sysLoading, isError: sysError, error: systemsError } = useSystems();
  const { data: workTypes = [], isLoading: wtLoading, isError: wtError, error: workTypesError } = useWorkTypes();

  const addCustomer = useAddCustomer();
  const updateCustomer = useUpdateCustomer();
  const deleteCustomerMut = useDeleteCustomer();
  const addSystem = useAddSystem();
  const updateSystem = useUpdateSystem();
  const deleteSystemMut = useDeleteSystem();
  const addWorkType = useAddWorkType();
  const updateWorkType = useUpdateWorkType();
  const deleteWorkTypeMut = useDeleteWorkType();

  const [customerDialog, setCustomerDialog] = useState(false);
  const [systemDialog, setSystemDialog] = useState(false);
  const [workTypeDialog, setWorkTypeDialog] = useState(false);

  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [editingSystem, setEditingSystem] = useState<any>(null);
  const [editingWorkType, setEditingWorkType] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<null | { type: "customer" | "system" | "workType"; id: string; label: string }>(null);
  const actionLoadingMessage = addCustomer.isPending
    ? "顧客を登録しています..."
    : updateCustomer.isPending
      ? "顧客を更新しています..."
      : deleteCustomerMut.isPending
        ? "顧客を削除しています..."
        : addSystem.isPending
          ? "システムを登録しています..."
          : updateSystem.isPending
            ? "システムを更新しています..."
            : deleteSystemMut.isPending
              ? "システムを削除しています..."
              : addWorkType.isPending
                ? "作業区分を登録しています..."
                : updateWorkType.isPending
                  ? "作業区分を更新しています..."
                  : deleteWorkTypeMut.isPending
                    ? "作業区分を削除しています..."
                    : "処理中...";
  const actionLoadingOpen = addCustomer.isPending
    || updateCustomer.isPending
    || deleteCustomerMut.isPending
    || addSystem.isPending
    || updateSystem.isPending
    || deleteSystemMut.isPending
    || addWorkType.isPending
    || updateWorkType.isPending
    || deleteWorkTypeMut.isPending;

  const handleSaveCustomer = (data: { name: string }) => {
    if (editingCustomer) {
      updateCustomer.mutate({ itemId: editingCustomer.id, name: data.name });
    } else {
      addCustomer.mutate(data.name);
    }
    setCustomerDialog(false);
    setEditingCustomer(null);
  };

  const handleDeleteCustomer = (id: string) => {
    setDeleteTarget({ type: "customer", id, label: "この顧客を削除しますか？" });
  };

  const handleSaveSystem = (data: { name: string; customerId: string; description: string }) => {
    if (editingSystem) {
      updateSystem.mutate({
        itemId: editingSystem.id,
        fields: { Title: data.name, CustomerLookupId: Number(data.customerId), Description: data.description },
      });
    } else {
      addSystem.mutate({ Title: data.name, CustomerLookupId: Number(data.customerId), Description: data.description });
    }
    setSystemDialog(false);
    setEditingSystem(null);
  };

  const handleDeleteSystem = (id: string) => {
    setDeleteTarget({ type: "system", id, label: "このシステムを削除しますか？" });
  };

  const handleSaveWorkType = (data: { name: string; category: string }) => {
    if (editingWorkType) {
      updateWorkType.mutate({
        itemId: editingWorkType.id,
        fields: { Title: data.name, Category: data.category },
      });
    } else {
      addWorkType.mutate({ Title: data.name, Category: data.category });
    }
    setWorkTypeDialog(false);
    setEditingWorkType(null);
  };

  const handleDeleteWorkType = (id: string) => {
    setDeleteTarget({ type: "workType", id, label: "この作業区分を削除しますか？" });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "customer") deleteCustomerMut.mutate(deleteTarget.id);
    if (deleteTarget.type === "system") deleteSystemMut.mutate(deleteTarget.id);
    if (deleteTarget.type === "workType") deleteWorkTypeMut.mutate(deleteTarget.id);
    setDeleteTarget(null);
  };

  if (custLoading || sysLoading || wtLoading) {
    return (
      <div className="container mx-auto py-6 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (custError || sysError || wtError) {
    return (
      <DataErrorState
        title="マスタデータを取得できませんでした"
        error={customersError ?? systemsError ?? workTypesError}
      />
    );
  }

  return (
    <div className="container mx-auto py-6">
      <ActionLoadingOverlay open={actionLoadingOpen} message={actionLoadingMessage} />
      <div className="mb-6">
        <h1 className="text-3xl font-bold">マスタ管理</h1>
        <p className="text-muted-foreground">顧客・システム・作業区分のマスタデータを管理します</p>
      </div>

      <Tabs defaultValue="customers" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="customers">顧客マスタ</TabsTrigger>
          <TabsTrigger value="systems">システムマスタ</TabsTrigger>
          <TabsTrigger value="worktypes">作業区分マスタ</TabsTrigger>
        </TabsList>

        <TabsContent value="customers">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>顧客マスタ</CardTitle>
                <Dialog open={customerDialog} onOpenChange={setCustomerDialog}>
                  <DialogTrigger asChild>
                    <Button onClick={() => setEditingCustomer(null)}>新規追加</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingCustomer ? "顧客編集" : "顧客追加"}</DialogTitle>
                    </DialogHeader>
                    <CustomerForm
                      customer={editingCustomer}
                      onSave={handleSaveCustomer}
                      onCancel={() => setCustomerDialog(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>顧客名</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>{customer.name}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => { setEditingCustomer(customer); setCustomerDialog(true); }}>編集</Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={deleteCustomerMut.isPending}
                            onClick={() => handleDeleteCustomer(customer.id)}
                            onTouchEnd={(e) => {
                              e.preventDefault();
                              handleDeleteCustomer(customer.id);
                            }}
                          >削除</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="systems">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>システムマスタ</CardTitle>
                <Dialog open={systemDialog} onOpenChange={setSystemDialog}>
                  <DialogTrigger asChild>
                    <Button onClick={() => setEditingSystem(null)}>新規追加</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingSystem ? "システム編集" : "システム追加"}</DialogTitle>
                    </DialogHeader>
                    <SystemForm
                      system={editingSystem}
                      customers={customers}
                      onSave={handleSaveSystem}
                      onCancel={() => setSystemDialog(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>システム名</TableHead>
                    <TableHead>所有顧客</TableHead>
                    <TableHead>説明</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {systems.map((system) => (
                    <TableRow key={system.id}>
                      <TableCell>{system.name}</TableCell>
                      <TableCell>{system.customerName}</TableCell>
                      <TableCell>{system.description}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => { setEditingSystem(system); setSystemDialog(true); }}>編集</Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={deleteSystemMut.isPending}
                            onClick={() => handleDeleteSystem(system.id)}
                            onTouchEnd={(e) => {
                              e.preventDefault();
                              handleDeleteSystem(system.id);
                            }}
                          >削除</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="worktypes">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>作業区分マスタ</CardTitle>
                <Dialog open={workTypeDialog} onOpenChange={setWorkTypeDialog}>
                  <DialogTrigger asChild>
                    <Button onClick={() => setEditingWorkType(null)}>新規追加</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingWorkType ? "作業区分編集" : "作業区分追加"}</DialogTitle>
                    </DialogHeader>
                    <WorkTypeForm
                      workType={editingWorkType}
                      onSave={handleSaveWorkType}
                      onCancel={() => setWorkTypeDialog(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>区分名</TableHead>
                    <TableHead>カテゴリ</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workTypes.map((workType) => (
                    <TableRow key={workType.id}>
                      <TableCell>{workType.name}</TableCell>
                      <TableCell>{workType.category}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => { setEditingWorkType(workType); setWorkTypeDialog(true); }}>編集</Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={deleteWorkTypeMut.isPending}
                            onClick={() => handleDeleteWorkType(workType.id)}
                            onTouchEnd={(e) => {
                              e.preventDefault();
                              handleDeleteWorkType(workType.id);
                            }}
                          >削除</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="マスタデータを削除しますか？"
        description={deleteTarget?.label ?? "この操作は元に戻せません。"}
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function CustomerForm({ customer, onSave, onCancel }: any) {
  const [name, setName] = useState(customer?.name || "");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ name }); }} className="space-y-4">
      <div>
        <Label htmlFor="name">顧客名</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>キャンセル</Button>
        <Button type="submit">保存</Button>
      </div>
    </form>
  );
}

function SystemForm({ system, customers, onSave, onCancel }: any) {
  const [formData, setFormData] = useState({
    name: system?.name || "",
    customerId: system?.customerId || "",
    description: system?.description || "",
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }} className="space-y-4">
      <div>
        <Label htmlFor="sysName">システム名</Label>
        <Input id="sysName" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
      </div>
      <div>
        <Label htmlFor="custId">所有顧客</Label>
        <select id="custId" className="w-full p-2 border rounded" value={formData.customerId} onChange={(e) => setFormData({ ...formData, customerId: e.target.value })} required>
          <option value="">顧客を選択</option>
          {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="desc">説明</Label>
        <Input id="desc" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>キャンセル</Button>
        <Button type="submit">保存</Button>
      </div>
    </form>
  );
}

function WorkTypeForm({ workType, onSave, onCancel }: any) {
  const [formData, setFormData] = useState({
    name: workType?.name || "",
    category: workType?.category || "",
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }} className="space-y-4">
      <div>
        <Label htmlFor="wtName">区分名</Label>
        <Input id="wtName" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
      </div>
      <div>
        <Label htmlFor="wtCat">カテゴリ</Label>
        <Input id="wtCat" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} />
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>キャンセル</Button>
        <Button type="submit">保存</Button>
      </div>
    </form>
  );
}
