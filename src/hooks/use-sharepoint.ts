/**
 * SharePoint List 用 React Query hooks
 *
 * マスタデータ（顧客・システム・作業種別）を先にフェッチし、
 * Lookup ID → 名前解決をクライアント側で行う。
 */
import { useMemo } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { SP_LISTS } from "@/lib/sharepointConfig";

/**
 * SharePoint の UTC 日時文字列をブラウザのローカルタイムゾーン（JST等）で
 * YYYY-MM-DD に変換する。undefined / 不正値は "" を返す。
 */
function toLocalDateStr(utcDateStr?: string): string {
  if (!utcDateStr) return "";
  const d = new Date(utcDateStr);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isBrokenDisplayName(value?: string | null): boolean {
  if (!value) return true;
  return /^[?\s]+$/.test(value);
}

function deriveNameFromTitle(title?: string): string {
  if (!title) return "";
  const [prefix] = title.split("-");
  const candidate = prefix?.trim() ?? "";
  if (!candidate || candidate === "日報" || candidate === "予定" || candidate.startsWith("migrated")) {
    return "";
  }
  return candidate;
}

function resolveUserDisplayName(primaryName: string | undefined, fallbackTitle: string | undefined, createdByName: string | undefined): string {
  if (!isBrokenDisplayName(primaryName)) {
    return primaryName ?? "";
  }

  const nameFromTitle = deriveNameFromTitle(fallbackTitle);
  if (nameFromTitle) {
    return nameFromTitle;
  }

  return createdByName ?? fallbackTitle ?? "";
}

import {
  fetchListItems,
  createListItem,
  updateListItem,
  deleteListItem,
} from "@/lib/graphClient";
import type {
  SPCustomerFields,
  SPSystemFields,
  SPWorkTypeFields,
  SPReportFields,
  SPPlanFields,
  Customer,
  System,
  WorkType,
  WorkReport,
  WorkPlan,
} from "@/types/sharepoint";

// ==================== 顧客マスタ ====================

export function useCustomers(): UseQueryResult<Customer[]> {
  return useQuery({
    queryKey: ["sp", "customers"],
    queryFn: async () => {
      const items = await fetchListItems<SPCustomerFields>(SP_LISTS.customers);
      return items.map((item) => ({
        id: item.id,
        name: item.fields.Title,
      }));
    },
  });
}

// ==================== システムマスタ ====================

export function useSystems(): UseQueryResult<System[]> {
  const { data: customers } = useCustomers();

  return useQuery({
    queryKey: ["sp", "systems"],
    queryFn: async () => {
      const items = await fetchListItems<SPSystemFields>(SP_LISTS.systems);
      return items;
    },
    select: (items) => {
      const custMap = new Map(
        (customers ?? []).map((c) => [c.id, c.name])
      );
      return items.map((item) => ({
        id: item.id,
        name: item.fields.Title,
        customerId: String(item.fields.CustomerLookupId ?? ""),
        customerName: custMap.get(String(item.fields.CustomerLookupId ?? "")) ?? "",
        description: item.fields.Description ?? "",
      }));
    },
    enabled: !!customers,
  });
}

// ==================== 作業種別マスタ ====================

export function useWorkTypes(): UseQueryResult<WorkType[]> {
  return useQuery({
    queryKey: ["sp", "workTypes"],
    queryFn: async () => {
      const items = await fetchListItems<SPWorkTypeFields>(SP_LISTS.workTypes);
      return items.map((item) => ({
        id: item.id,
        name: item.fields.Title,
        category: item.fields.Category ?? "",
      }));
    },
  });
}

// ==================== Lookup Maps ====================

type LookupMaps = {
  customerMap: Map<string, string>;
  systemMap: Map<string, string>;
  workTypeMap: Map<string, string>;
};

export function useLookupMaps(): LookupMaps {
  const { data: customers } = useCustomers();
  const { data: systems } = useSystems();
  const { data: workTypes } = useWorkTypes();

  return useMemo(
    () => ({
      customerMap: new Map((customers ?? []).map((c) => [c.id, c.name])),
      systemMap: new Map((systems ?? []).map((s) => [s.id, s.name])),
      workTypeMap: new Map((workTypes ?? []).map((w) => [w.id, w.name])),
    }),
    [customers, systems, workTypes]
  );
}

// ==================== 作業報告 ====================

export function useReports(startDate?: string, endDate?: string) {
  const maps = useLookupMaps();

  return useQuery({
    queryKey: ["sp", "reports", startDate, endDate],
    queryFn: async () => {
      const items = await fetchListItems<SPReportFields>(SP_LISTS.reports);
      return items;
    },
    select: (items): WorkReport[] => {
      // クライアント側で日付フィルタリング
      const filtered = startDate && endDate
        ? items.filter((item) => {
            const d = toLocalDateStr(item.fields.ReportDate);
            return d >= startDate && d <= endDate;
          })
        : items;
      return filtered.map((item) => {
        const f = item.fields;
        const custId = String(f.CustomerLookupId ?? "");
        const sysId = String(f.SystemLookupId ?? "");
        const wtId = String(f.WorkTypeLookupId ?? "");
        return {
          id: item.id,
          title: f.Title,
          reportDate: toLocalDateStr(f.ReportDate),
          customerId: custId,
          customerName: maps.customerMap.get(custId) ?? "",
          systemId: sysId,
          systemName: maps.systemMap.get(sysId) ?? "",
          workTypeId: wtId,
          workTypeName: maps.workTypeMap.get(wtId) ?? "",
          workDescription: f.WorkDescription ?? "",
          workHours: f.WorkHours ?? 0,
          userName: resolveUserDisplayName(f.ReporterName, f.Title, item.createdByName),
          isProject: f.IsProject !== false,
        };
      }).sort((left, right) => {
        const dateCompare = left.reportDate.localeCompare(right.reportDate);
        if (dateCompare !== 0) {
          return dateCompare;
        }
        return Number(left.id) - Number(right.id);
      });
    },

  });
}

export function useAddReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fields: Record<string, unknown>) => {
      return createListItem(SP_LISTS.reports, fields);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "reports"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      alert(`作業実績の登録に失敗しました。\n${message}`);
    },
  });
}

export function useUpdateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      fields,
    }: {
      itemId: string;
      fields: Record<string, unknown>;
    }) => {
      return updateListItem(SP_LISTS.reports, itemId, fields);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "reports"] });
    },
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      return deleteListItem(SP_LISTS.reports, itemId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "reports"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      alert(`作業実績の削除に失敗しました。\n${message}`);
    },
  });
}

// ==================== 作業予定 ====================

export function usePlans(startDate?: string, endDate?: string) {
  const maps = useLookupMaps();

  return useQuery({
    queryKey: ["sp", "plans", startDate, endDate],
    queryFn: async () => {
      const items = await fetchListItems<SPPlanFields>(SP_LISTS.plans);
      return items;
    },
    select: (items): WorkPlan[] => {
      const filtered = items.filter((item) => {
        const d = toLocalDateStr(item.fields.PlanDate);
        if (startDate && d < startDate) {
          return false;
        }
        if (endDate && d > endDate) {
          return false;
        }
        return true;
      });
      return filtered.map((item) => {
        const f = item.fields;
        const custId = String(f.CustomerLookupId ?? "");
        const sysId = String(f.SystemLookupId ?? "");
        return {
          id: item.id,
          title: f.Title,
          planDate: toLocalDateStr(f.PlanDate),
          customerId: custId,
          customerName: maps.customerMap.get(custId) ?? "",
          systemId: sysId,
          systemName: maps.systemMap.get(sysId) ?? "",
          workDescription: f.WorkDescription ?? "",
          userName: resolveUserDisplayName(f.AssigneeName, f.Title, item.createdByName),
        };
      }).sort((left, right) => {
        const dateCompare = left.planDate.localeCompare(right.planDate);
        if (dateCompare !== 0) {
          return dateCompare;
        }
        return Number(left.id) - Number(right.id);
      });
    },
  });
}

export function useAddPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fields: Record<string, unknown>) => {
      return createListItem(SP_LISTS.plans, fields);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "plans"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      alert(`作業予定の登録に失敗しました。\n${message}`);
    },
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      fields,
    }: {
      itemId: string;
      fields: Record<string, unknown>;
    }) => {
      return updateListItem(SP_LISTS.plans, itemId, fields);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "plans"] });
    },
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      return deleteListItem(SP_LISTS.plans, itemId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "plans"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      alert(`作業予定の削除に失敗しました。\n${message}`);
    },
  });
}

// ==================== マスタ CRUD ====================

export function useAddCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      return createListItem(SP_LISTS.customers, { Title: name });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "customers"] });
    },
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, name }: { itemId: string; name: string }) => {
      return updateListItem(SP_LISTS.customers, itemId, { Title: name });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "customers"] });
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      return deleteListItem(SP_LISTS.customers, itemId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "customers"] });
      qc.invalidateQueries({ queryKey: ["sp", "systems"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      alert(`顧客マスタの削除に失敗しました。\n${message}`);
    },
  });
}

export function useAddSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fields: {
      Title: string;
      CustomerLookupId: number;
      Description?: string;
    }) => {
      return createListItem(SP_LISTS.systems, fields);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "systems"] });
    },
  });
}

export function useUpdateSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      fields,
    }: {
      itemId: string;
      fields: Record<string, unknown>;
    }) => {
      return updateListItem(SP_LISTS.systems, itemId, fields);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "systems"] });
    },
  });
}

export function useDeleteSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      return deleteListItem(SP_LISTS.systems, itemId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "systems"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      alert(`システムマスタの削除に失敗しました。\n${message}`);
    },
  });
}

export function useAddWorkType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fields: { Title: string; Category?: string }) => {
      return createListItem(SP_LISTS.workTypes, fields);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "workTypes"] });
    },
  });
}

export function useUpdateWorkType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      fields,
    }: {
      itemId: string;
      fields: Record<string, unknown>;
    }) => {
      return updateListItem(SP_LISTS.workTypes, itemId, fields);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "workTypes"] });
    },
  });
}

export function useDeleteWorkType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      return deleteListItem(SP_LISTS.workTypes, itemId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "workTypes"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      alert(`作業区分マスタの削除に失敗しました。\n${message}`);
    },
  });
}
