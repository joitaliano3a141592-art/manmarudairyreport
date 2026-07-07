import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { DataErrorState } from "@/components/data-error-state";
import { ActionLoadingOverlay } from "@/components/action-loading-overlay";
import {
  useCustomers, useAddCustomer, useUpdateCustomer, useDeleteCustomer,
  useSystems, useWorkNumbers, useAddSystem, useUpdateSystem, useDeleteSystem, useAddWorkNumber, useUpdateWorkNumber, useDeleteWorkNumber,
  useWorkTypes, useAddWorkType, useUpdateWorkType, useDeleteWorkType,
} from "@/hooks/use-sharepoint";
import type { Customer, System, WorkNumber, WorkType } from "@/types/sharepoint";

type CustomerFormData = {
  name: string;
  customerNumber: number;
  isDisabled: boolean;
  isDirectSales: boolean;
};

type SystemFormData = {
  name: string;
  customerId: string;
  description: string;
  sortOrder: number;
  isDisabled: boolean;
  workNumbers: Array<{
    id?: string;
    workNumber: string;
    workNumberName: string;
    isDisabled: boolean;
    orderSourceCustomerId: string;
  }>;
};

type WorkTypeFormData = {
  name: string;
  sortOrder: number;
};

type DeleteTarget = {
  type: "customer" | "system" | "workType";
  id: string;
  label: string;
};

function isGraphItemNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("itemNotFound");
}

export default function MastersPage() {
  const { data: customers = [], isLoading: custLoading, isError: custError, error: customersError } = useCustomers({ includeDisabled: true });
  const { data: systems = [], isLoading: sysLoading, isError: sysError, error: systemsError } = useSystems({ includeDisabled: true });
  const { data: workNumbers = [], isLoading: wnLoading, isError: wnError, error: workNumbersError } = useWorkNumbers();
  const { data: workTypes = [], isLoading: wtLoading, isError: wtError, error: workTypesError } = useWorkTypes();
  const customerNameMap = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  );

  const addCustomer = useAddCustomer();
  const updateCustomer = useUpdateCustomer();
  const deleteCustomerMut = useDeleteCustomer();
  const addSystem = useAddSystem();
  const updateSystem = useUpdateSystem();
  const deleteSystemMut = useDeleteSystem();
  const addWorkNumber = useAddWorkNumber();
  const updateWorkNumber = useUpdateWorkNumber();
  const deleteWorkNumber = useDeleteWorkNumber();
  const addWorkType = useAddWorkType();
  const updateWorkType = useUpdateWorkType();
  const deleteWorkTypeMut = useDeleteWorkType();

  const [customerDialog, setCustomerDialog] = useState(false);
  const [systemDialog, setSystemDialog] = useState(false);
  const [workTypeDialog, setWorkTypeDialog] = useState(false);

  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editingSystem, setEditingSystem] = useState<System | null>(null);
  const [editingWorkNumbers, setEditingWorkNumbers] = useState<WorkNumber[]>([]);
  const [editingWorkType, setEditingWorkType] = useState<WorkType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
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
              : addWorkNumber.isPending
                ? "工事番号を登録しています..."
                : updateWorkNumber.isPending
                  ? "工事番号を更新しています..."
                  : deleteWorkNumber.isPending
                   ? "工事番号を削除しています..."
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
    || addWorkNumber.isPending
    || updateWorkNumber.isPending
    || deleteWorkNumber.isPending
    || addWorkType.isPending
    || updateWorkType.isPending
    || deleteWorkTypeMut.isPending;

  const handleSaveCustomer = (data: CustomerFormData) => {
    if (editingCustomer) {
      updateCustomer.mutate({
        itemId: editingCustomer.id,
        name: data.name,
        customerNumber: data.customerNumber,
        isDisabled: data.isDisabled,
        isDirectSales: data.isDirectSales,
      });
    } else {
      addCustomer.mutate({
        name: data.name,
        customerNumber: data.customerNumber,
        isDisabled: data.isDisabled,
        isDirectSales: data.isDirectSales,
      });
    }
    setCustomerDialog(false);
    setEditingCustomer(null);
  };

  const handleDeleteCustomer = (id: string) => {
    setDeleteTarget({ type: "customer", id, label: "この顧客を削除しますか？" });
  };

  const openEditCustomerDialog = (customer: Customer) => {
    setEditingCustomer(customer);
    setCustomerDialog(true);
  };

  const closeSystemDialog = () => {
    setSystemDialog(false);
    setEditingSystem(null);
    setEditingWorkNumbers([]);
  };

  const handleSaveSystem = async (data: SystemFormData) => {
    const normalizedWorkNumbers = data.workNumbers
      .map((item) => ({
        id: item.id,
        workNumber: item.workNumber.trim(),
        workNumberName: item.workNumberName.trim(),
        isDisabled: item.isDisabled,
        orderSourceCustomerId: item.orderSourceCustomerId,
      }))
      .filter((item) => item.workNumber || item.workNumberName);

    const systemFields = {
      Title: data.name,
      CustomerLookupId: Number(data.customerId),
      Description: data.description,
      SortOrder: data.sortOrder,
      IsDisabled: data.isDisabled,
    };

    try {
      const systemId = editingSystem
        ? (
            await updateSystem.mutateAsync({
              itemId: editingSystem.id,
              fields: systemFields,
            }),
            Number(editingSystem.id)
          )
        : Number((await addSystem.mutateAsync(systemFields)).id);

      const nextWorkNumberIds = new Set(
        normalizedWorkNumbers
          .map((item) => item.id)
          .filter((item): item is string => !!item),
      );

      for (const existingWorkNumber of editingWorkNumbers) {
        if (nextWorkNumberIds.has(existingWorkNumber.id)) {
          continue;
        }
        try {
          await deleteWorkNumber.mutateAsync(existingWorkNumber.id);
        } catch (error) {
          if (!isGraphItemNotFoundError(error)) {
            throw error;
          }
        }
      }

      for (const workNumber of normalizedWorkNumbers) {
        if (workNumber.id) {
          try {
            await updateWorkNumber.mutateAsync({
              itemId: workNumber.id,
              fields: {
                workNumber: workNumber.workNumber,
                workNumberName: workNumber.workNumberName,
                systemId,
                isDisabled: workNumber.isDisabled,
                orderSourceCustomerId: workNumber.orderSourceCustomerId ? Number(workNumber.orderSourceCustomerId) : null,
              },
            });
          } catch (error) {
            if (!isGraphItemNotFoundError(error)) {
              throw error;
            }
            await addWorkNumber.mutateAsync({
              workNumber: workNumber.workNumber,
              workNumberName: workNumber.workNumberName,
              systemId,
              isDisabled: workNumber.isDisabled,
              orderSourceCustomerId: workNumber.orderSourceCustomerId ? Number(workNumber.orderSourceCustomerId) : null,
            });
          }
        } else {
          await addWorkNumber.mutateAsync({
            workNumber: workNumber.workNumber,
            workNumberName: workNumber.workNumberName,
            systemId,
            isDisabled: workNumber.isDisabled,
            orderSourceCustomerId: workNumber.orderSourceCustomerId ? Number(workNumber.orderSourceCustomerId) : null,
          });
        }
      }

      closeSystemDialog();
    } catch {
      // Individual mutations already show user-facing errors.
    }
  };

  const handleDeleteSystem = (id: string) => {
    setDeleteTarget({ type: "system", id, label: "このシステムを削除しますか？" });
  };

  const openEditSystemDialog = (system: System, relatedWorkNumbers: WorkNumber[]) => {
    setEditingSystem(system);
    setEditingWorkNumbers(relatedWorkNumbers);
    setSystemDialog(true);
  };

  const handleSaveWorkType = (data: WorkTypeFormData) => {
    if (editingWorkType) {
      updateWorkType.mutate({
        itemId: editingWorkType.id,
        fields: { Title: data.name, SortOrder: data.sortOrder },
      });
    } else {
      addWorkType.mutate({ Title: data.name, SortOrder: data.sortOrder });
    }
    setWorkTypeDialog(false);
    setEditingWorkType(null);
  };

  const handleDeleteWorkType = (id: string) => {
    setDeleteTarget({ type: "workType", id, label: "この作業区分を削除しますか？" });
  };

  const openEditWorkTypeDialog = (workType: WorkType) => {
    setEditingWorkType(workType);
    setWorkTypeDialog(true);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "customer") deleteCustomerMut.mutate(deleteTarget.id);
    if (deleteTarget.type === "system") deleteSystemMut.mutate(deleteTarget.id);
    if (deleteTarget.type === "workType") deleteWorkTypeMut.mutate(deleteTarget.id);
    setDeleteTarget(null);
  };

  if (custLoading || sysLoading || wnLoading || wtLoading) {
    return (
      <div className="container mx-auto py-6 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (custError || sysError || wtError || wnError) {
    return (
      <DataErrorState
        title="マスタデータを取得できませんでした"
        error={customersError ?? systemsError ?? workTypesError ?? workNumbersError}
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
              <div className="max-h-[28rem] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">顧客番号</TableHead>
                      <TableHead>顧客名</TableHead>
                      <TableHead className="w-24">直販</TableHead>
                      <TableHead className="w-24">無効</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((customer) => (
                      <TableRow key={customer.id} onDoubleClick={() => openEditCustomerDialog(customer)} className="cursor-pointer">
                        <TableCell className="text-center">{customer.customerNumber}</TableCell>
                        <TableCell>{customer.name}</TableCell>
                        <TableCell>{customer.isDirectSales ? "✓" : ""}</TableCell>
                        <TableCell>{customer.isDisabled ? "✓" : ""}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => openEditCustomerDialog(customer)}>編集</Button>
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
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="systems">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>システムマスタ</CardTitle>
                <Dialog
                  open={systemDialog}
                  onOpenChange={(open) => {
                    setSystemDialog(open);
                    if (!open) {
                      setEditingSystem(null);
                      setEditingWorkNumbers([]);
                    }
                  }}
                >
                  <DialogTrigger asChild>
                    <Button onClick={() => { setEditingSystem(null); setEditingWorkNumbers([]); }}>新規追加</Button>
                  </DialogTrigger>
                  <DialogContent className="h-[85vh] w-[50vw] max-w-[50vw] overflow-y-auto sm:max-w-[50vw]">
                    <DialogHeader>
                      <DialogTitle>{editingSystem ? "システム編集" : "システム追加"}</DialogTitle>
                    </DialogHeader>
                    <SystemForm
                      key={`${editingSystem?.id ?? "new"}-${editingWorkNumbers.map((item) => item.id).join("-")}`}
                      system={editingSystem}
                      workNumbers={editingWorkNumbers}
                      customers={customers}
                      onSave={handleSaveSystem}
                      onCancel={closeSystemDialog}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-[28rem] overflow-auto">
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">表示順</TableHead>
                    <TableHead>顧客名</TableHead>
                    <TableHead>システム名</TableHead>
                    <TableHead>工事番号</TableHead>
                    <TableHead>工事番号名</TableHead>
                    <TableHead>説明</TableHead>
                    <TableHead>無効</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {systems.map((system) => {
                    const relatedWorkNumbers = workNumbers.filter((item) => item.systemId === system.id);
                    return (
                      <TableRow key={system.id} onDoubleClick={() => openEditSystemDialog(system, relatedWorkNumbers)} className="cursor-pointer">
                        <TableCell className="text-center">{system.sortOrder}</TableCell>
                        <TableCell>{customerNameMap.get(system.customerId) ?? ""}</TableCell>
                        <TableCell>{system.name}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {relatedWorkNumbers.length > 0
                              ? relatedWorkNumbers.map((workNumber) => (
                                  <span key={workNumber.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                                    {workNumber.workNumber}{workNumber.isDisabled ? " (無効)" : ""}
                                  </span>
                                ))
                              : "―"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {relatedWorkNumbers.length > 0
                              ? relatedWorkNumbers.map((workNumber) => (
                                  <span key={workNumber.id} className="rounded bg-sky-100 px-2 py-0.5 text-xs dark:bg-sky-950">
                                    {workNumber.workNumberName}{workNumber.isDisabled ? " (無効)" : ""}
                                  </span>
                                ))
                              : "―"}
                          </div>
                        </TableCell>
                        <TableCell>{system.description}</TableCell>
                        <TableCell className="text-center">{system.isDisabled ? "○" : "―"}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => openEditSystemDialog(system, relatedWorkNumbers)}>編集</Button>
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
                    );
                  })}
                </TableBody>
                </Table>
              </div>
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
              <div className="max-h-[28rem] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">表示順</TableHead>
                      <TableHead>区分名</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workTypes.map((workType) => (
                      <TableRow key={workType.id} onDoubleClick={() => openEditWorkTypeDialog(workType)} className="cursor-pointer">
                        <TableCell className="text-center">{workType.sortOrder}</TableCell>
                        <TableCell>{workType.name}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => openEditWorkTypeDialog(workType)}>編集</Button>
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
              </div>
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

type SystemWorkNumberInput = {
  id?: string;
  workNumber: string;
  workNumberName: string;
  isDisabled: boolean;
  orderSourceCustomerId: string;
};

function createEmptySystemWorkNumber(): SystemWorkNumberInput {
  return {
    workNumber: "",
    workNumberName: "",
    isDisabled: false,
    orderSourceCustomerId: "",
  };
}

function SystemForm({
  system,
  workNumbers,
  customers,
  onSave,
  onCancel,
}: {
  system: System | null;
  workNumbers: WorkNumber[];
  customers: Customer[];
  onSave: (data: SystemFormData) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState<SystemFormData>({
    name: system?.name || "",
    customerId: system?.customerId || "",
    description: system?.description || "",
    sortOrder: system?.sortOrder ?? 10,
    isDisabled: system?.isDisabled ?? false,
    workNumbers: workNumbers.map((workNumber) => ({
      id: workNumber.id,
      workNumber: workNumber.workNumber,
      workNumberName: workNumber.workNumberName,
      isDisabled: workNumber.isDisabled,
      orderSourceCustomerId: workNumber.orderSourceCustomerId,
    })),
  });
  const [submitError, setSubmitError] = useState("");
  const selectedCustomer = customers.find((customer) => customer.id === formData.customerId) ?? null;
  const showOrderSource = selectedCustomer !== null && !selectedCustomer.isDirectSales;

  const updateWorkNumberRow = (index: number, nextRow: SystemWorkNumberInput) => {
    setFormData((prev) => ({
      ...prev,
      workNumbers: prev.workNumbers.map((row, rowIndex) => (rowIndex === index ? nextRow : row)),
    }));
  };

  const removeWorkNumberRow = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      workNumbers: prev.workNumbers.filter((_, rowIndex) => rowIndex !== index),
    }));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const normalizedWorkNumbers = formData.workNumbers
          .map((item) => ({
            ...item,
            workNumber: item.workNumber.trim(),
            workNumberName: item.workNumberName.trim(),
            isDisabled: item.isDisabled,
            orderSourceCustomerId: item.orderSourceCustomerId,
          }))
          .filter((item) => item.workNumber || item.workNumberName);

        if (normalizedWorkNumbers.some((item) => !item.workNumber || !item.workNumberName)) {
          setSubmitError("工事番号と工事番号名はセットで入力してください。");
          return;
        }

        setSubmitError("");
        onSave({ ...formData, workNumbers: normalizedWorkNumbers });
      }}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="sysSortOrder">表示順（小さいほど上位。99=最下位）</Label>
        <Input id="sysSortOrder" type="number" min={1} max={999} value={formData.sortOrder} onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })} required />
      </div>
      <div>
        <Label htmlFor="custId">顧客名</Label>
        <select id="custId" className="w-full p-2 border rounded" value={formData.customerId} onChange={(e) => setFormData({ ...formData, customerId: e.target.value })} required>
          <option value="">顧客を選択</option>
          {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="sysName">システム名</Label>
        <Input id="sysName" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
      </div>
      <div>
        <Label htmlFor="desc">説明</Label>
        <Input id="desc" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
      </div>
      <div>
        <Label>無効</Label>
        <div className="flex h-10 items-center gap-2">
          <Checkbox checked={formData.isDisabled} onCheckedChange={(checked) => setFormData({ ...formData, isDisabled: checked === true })} />
          <span className="text-sm">このシステムを通常画面で非表示にする</span>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>工事番号一覧</Label>
            <p className="text-sm text-muted-foreground"></p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSubmitError("");
              setFormData((prev) => ({
                ...prev,
                workNumbers: [
                  ...prev.workNumbers,
                  {
                    ...createEmptySystemWorkNumber(),
                    orderSourceCustomerId: showOrderSource ? prev.customerId : "",
                  },
                ],
              }));
            }}
          >
            工事番号を追加
          </Button>
        </div>
        {formData.workNumbers.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            登録済みの工事番号はありません。
          </div>
        ) : (
          formData.workNumbers.map((workNumber, index) => (
            <div key={workNumber.id ?? `new-${index}`} className="rounded-md border p-3">
              <div className={`grid gap-3 ${showOrderSource ? "md:grid-cols-[1fr_1fr_1fr_auto_auto]" : "md:grid-cols-[1fr_1fr_auto_auto]"} md:items-end`}>
                <div>
                  <Label htmlFor={`workNumber-${index}`}>工事番号</Label>
                  <Input
                    id={`workNumber-${index}`}
                    value={workNumber.workNumber}
                    onChange={(e) => updateWorkNumberRow(index, { ...workNumber, workNumber: e.target.value })}
                    placeholder="工事番号を入力"
                  />
                </div>
                <div>
                  <Label htmlFor={`workNumberName-${index}`}>工事番号名</Label>
                  <Input
                    id={`workNumberName-${index}`}
                    value={workNumber.workNumberName}
                    onChange={(e) => updateWorkNumberRow(index, { ...workNumber, workNumberName: e.target.value })}
                    placeholder="工事番号名を入力"
                  />
                </div>
                {showOrderSource && (
                  <div>
                    <Label htmlFor={`orderSource-${index}`}>発注元</Label>
                    <select
                      id={`orderSource-${index}`}
                      className="w-full p-2 border rounded"
                      value={workNumber.orderSourceCustomerId}
                      onChange={(e) => updateWorkNumberRow(index, { ...workNumber, orderSourceCustomerId: e.target.value })}
                    >
                      <option value="">発注元なし</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex h-10 items-center gap-2">
                  <Checkbox
                    checked={workNumber.isDisabled}
                    onCheckedChange={(checked) => updateWorkNumberRow(index, { ...workNumber, isDisabled: checked === true })}
                  />
                  <span className="text-sm">無効</span>
                </div>
                <Button type="button" variant="destructive" onClick={() => removeWorkNumberRow(index)}>
                  削除
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      {submitError && <p className="text-sm text-destructive">{submitError}</p>}
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>キャンセル</Button>
        <Button type="submit">保存</Button>
      </div>
    </form>
  );
}

function CustomerForm({
  customer,
  onSave,
  onCancel,
}: {
  customer: Customer | null;
  onSave: (data: CustomerFormData) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(customer?.name || "");
  const [customerNumber, setCustomerNumber] = useState<number>(customer?.customerNumber ?? 10);
  const [isDisabled, setIsDisabled] = useState<boolean>(customer?.isDisabled ?? false);
  const [isDirectSales, setIsDirectSales] = useState<boolean>(customer?.isDirectSales ?? false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ name, customerNumber, isDisabled, isDirectSales }); }} className="space-y-4">
      <div>
        <Label htmlFor="name">顧客名</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="custCustomerNumber">顧客番号</Label>
        <Input id="custCustomerNumber" type="number" min={1} max={99999} value={customerNumber} onChange={(e) => setCustomerNumber(Number(e.target.value))} required />
      </div>
      <div className="flex items-center gap-6">
        <div className="flex h-10 items-center gap-2">
          <Checkbox checked={isDirectSales} onCheckedChange={(checked) => setIsDirectSales(checked === true)} />
          <span className="text-sm">直販</span>
        </div>
        <div className="flex h-10 items-center gap-2">
          <Checkbox checked={isDisabled} onCheckedChange={(checked) => setIsDisabled(checked === true)} />
          <span className="text-sm">無効（通常画面で非表示）</span>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>キャンセル</Button>
        <Button type="submit">保存</Button>
      </div>
    </form>
  );
}

function WorkTypeForm({
  workType,
  onSave,
  onCancel,
}: {
  workType: WorkType | null;
  onSave: (data: WorkTypeFormData) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    name: workType?.name || "",
    sortOrder: workType?.sortOrder ?? 10,
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }} className="space-y-4">
      <div>
        <Label htmlFor="wtName">区分名</Label>
        <Input id="wtName" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
      </div>
      <div>
        <Label htmlFor="wtSortOrder">表示順（小さいほど上位。99=最下位）</Label>
        <Input id="wtSortOrder" type="number" min={1} max={999} value={formData.sortOrder} onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })} required />
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>キャンセル</Button>
        <Button type="submit">保存</Button>
      </div>
    </form>
  );
}
