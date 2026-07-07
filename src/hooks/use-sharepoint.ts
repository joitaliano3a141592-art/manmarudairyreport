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
import { formatCustomerDisplay, formatWorkNumberDisplay } from "@/lib/master-display";

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

function toJstIsoAtStartOfDay(localDate: string): string {
  return `${localDate}T00:00:00+09:00`;
}

function toJstIsoAtStartOfNextDay(localDate: string): string {
  const [y, m, d] = localDate.split("-").map((v) => Number(v));
  const nextDay = new Date(y, (m || 1) - 1, d || 1);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextYear = nextDay.getFullYear();
  const nextMonth = String(nextDay.getMonth() + 1).padStart(2, "0");
  const nextDate = String(nextDay.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDate}T00:00:00+09:00`;
}

function buildDateRangeQuery(fieldName: "ReportDate" | "PlanDate" | "RegistrationDate" | "WorkDate", startDate?: string, endDate?: string): string {
  const params = new URLSearchParams();
  const filters: string[] = [];

  if (startDate) {
    filters.push(`fields/${fieldName} ge '${toJstIsoAtStartOfDay(startDate)}'`);
  }
  if (endDate) {
    filters.push(`fields/${fieldName} lt '${toJstIsoAtStartOfNextDay(endDate)}'`);
  }

  if (filters.length > 0) {
    params.set("$filter", filters.join(" and "));
  }
  params.set("$orderby", `fields/${fieldName} desc`);
  params.set("$top", "999");
  return params.toString();
}

function isNonIndexedQueryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("cannot be referenced in filter or orderby") ||
    error.message.includes("HonorNonIndexedQueriesWarningMayFailRandomly") ||
    error.message.includes("invalidRequest")
  );
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
import { toast } from "sonner";
import type {
  SPCustomerFields,
  SPSystemFields,
  SPWorkNumberFields,
  SPWorkTypeFields,
  SPReportFields,
  SPPlanFields,
  SPWorkDayFields,
  Customer,
  System,
  WorkNumber,
  WorkType,
  WorkReport,
  WorkPlan,
  WorkDay,
} from "@/types/sharepoint";

const WORK_NUMBER_SYSTEM_ID_FIELD = "_x30b7__x30b9__x30c6__x30e0_ID";
const WORK_NUMBER_NAME_FIELD = "WorkNumberName";
const WORK_NUMBER_ORDER_SOURCE_LOOKUP_ID_FIELD = "_x767a__x6ce8__x5143_LookupId";
const CUSTOMER_DISABLED_FIELD = "_x7121__x52b9_";
const CUSTOMER_DIRECT_SALES_FIELD = "_x76f4__x8ca9_";

function toNullableInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numericValue = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(numericValue)) return null;
  return Math.trunc(numericValue);
}

function formatWorkNumber(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function resolveAchievement(fields: SPReportFields): "○" | "△" | "✕" | null {
  if (fields.Achievement === "○" || fields.Achievement === "△" || fields.Achievement === "✕") {
    return fields.Achievement;
  }
  if (fields.IsComplete === true) {
    return "○";
  }
  if (fields.IsComplete === false) {
    return "✕";
  }
  return null;
}

// ==================== 顧客マスタ ====================

type UseCustomersOptions = {
  includeDisabled?: boolean;
};

export function useCustomers(options: UseCustomersOptions = {}): UseQueryResult<Customer[]> {
  const includeDisabled = options.includeDisabled ?? true;

  return useQuery({
    queryKey: ["sp", "customers", includeDisabled],
    queryFn: async () => {
      const items = await fetchListItems<SPCustomerFields>(SP_LISTS.customers);
      return items
        .map((item) => ({
          id: item.id,
          name: item.fields.Title,
          customerNumber: item.fields.SortOrder ?? 10,
          displayName: formatCustomerDisplay(item.fields.SortOrder ?? 10, item.fields.Title),
          isDisabled: item.fields[CUSTOMER_DISABLED_FIELD] === true || item.fields.IsDisabled === true,
          isDirectSales: item.fields[CUSTOMER_DIRECT_SALES_FIELD] === true,
        }))
        .filter((customer) => includeDisabled || !customer.isDisabled)
        .sort((a, b) => a.customerNumber - b.customerNumber || a.name.localeCompare(b.name, "ja"));
    },
  });
}

// ==================== システムマスタ ====================

type UseSystemsOptions = {
  includeDisabled?: boolean;
};

export function useSystems(options: UseSystemsOptions = {}): UseQueryResult<System[]> {
  const { data: customers } = useCustomers();
  const includeDisabled = options.includeDisabled ?? true;

  return useQuery({
    queryKey: ["sp", "systems", includeDisabled],
    queryFn: async () => {
      const items = await fetchListItems<SPSystemFields>(SP_LISTS.systems);
      return items;
    },
    select: (items) => {
      const custMap = new Map(
        (customers ?? []).map((c) => [c.id, c.displayName])
      );
      return items
        .map((item) => ({
          id: item.id,
          name: item.fields.Title,
          customerId: String(item.fields.CustomerLookupId ?? ""),
          customerName: custMap.get(String(item.fields.CustomerLookupId ?? "")) ?? "",
          description: item.fields.Description ?? "",
          sortOrder: item.fields.SortOrder ?? 10,
          isDisabled: item.fields.IsDisabled === true,
        }))
        .filter((system) => includeDisabled || !system.isDisabled)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
    },
    enabled: !!customers,
  });
}

// ==================== 工事番号マスタ ====================

type UseWorkNumbersOptions = {
  includeDisabled?: boolean;
};

export function useWorkNumbers(options: UseWorkNumbersOptions = {}): UseQueryResult<WorkNumber[]> {
  const { data: systems } = useSystems({ includeDisabled: true });
  const includeDisabled = options.includeDisabled ?? true;

  return useQuery({
    queryKey: ["sp", "workNumbers", includeDisabled],
    queryFn: async () => {
      if (!SP_LISTS.workNumbers) return [];
      return fetchListItems<SPWorkNumberFields>(SP_LISTS.workNumbers);
    },
    select: (items) => {
      const systemMap = new Map((systems ?? []).map((system) => [system.id, system]));
      return items
        .map((item) => {
          const systemId = String(toNullableInteger(item.fields[WORK_NUMBER_SYSTEM_ID_FIELD]) ?? "");
          const linkedSystem = systemMap.get(systemId);
          const workNumber = formatWorkNumber(item.fields.Title);
          const workNumberName = formatWorkNumber(item.fields.WorkNumberName) || workNumber;
          return {
            id: item.id,
            workNumber,
            workNumberName,
            displayName: formatWorkNumberDisplay(workNumber, workNumberName),
            systemId,
            systemName: linkedSystem?.name ?? workNumber,
            sortOrder: linkedSystem?.sortOrder ?? 10,
            isDisabled: item.fields.IsDisabled === true,
            orderSourceCustomerId: String(toNullableInteger(item.fields[WORK_NUMBER_ORDER_SOURCE_LOOKUP_ID_FIELD]) ?? ""),
          };
        })
        .filter((workNumber) => includeDisabled || !workNumber.isDisabled)
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder
            || a.systemName.localeCompare(b.systemName, "ja")
            || a.workNumberName.localeCompare(b.workNumberName, "ja")
            || a.workNumber.localeCompare(b.workNumber, "ja", { numeric: true }),
        );
    },
  });
}

// ==================== 作業種別マスタ ====================

export function useWorkTypes(): UseQueryResult<WorkType[]> {
  return useQuery({
    queryKey: ["sp", "workTypes"],
    queryFn: async () => {
      const items = await fetchListItems<SPWorkTypeFields>(SP_LISTS.workTypes);
      return items
        .map((item) => ({
          id: item.id,
          name: item.fields.Title,
          sortOrder: item.fields.SortOrder ?? 10,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
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
  const { data: systems } = useSystems({ includeDisabled: true });
  const { data: workTypes } = useWorkTypes();

  return useMemo(
    () => ({
      customerMap: new Map((customers ?? []).map((c) => [c.id, c.displayName])),
      systemMap: new Map((systems ?? []).map((s) => [s.id, s.name])),
      workTypeMap: new Map((workTypes ?? []).map((w) => [w.id, w.name])),
    }),
    [customers, systems, workTypes]
  );
}

// ==================== 作業報告 ====================

export function useReports(startDate?: string, endDate?: string) {
  return useReportsByDateField("ReportDate", startDate, endDate);
}

function resolveReportFilterDate(
  item: { fields: SPReportFields; createdDateTime?: string },
  dateField: "ReportDate" | "RegistrationDate",
): string {
  if (dateField === "RegistrationDate") {
    return toLocalDateStr(item.fields.RegistrationDate) || toLocalDateStr(item.createdDateTime);
  }
  return toLocalDateStr(item.fields.ReportDate);
}

function resolveWorkDayFilterDate(item: { fields: SPWorkDayFields; createdDateTime?: string }): string {
  return toLocalDateStr(item.fields.WorkDate) || toLocalDateStr(item.createdDateTime);
}

export function useReportsByDateField(
  dateField: "ReportDate" | "RegistrationDate",
  startDate?: string,
  endDate?: string,
) {
  const maps = useLookupMaps();
  const { data: workNumbers } = useWorkNumbers();

  return useQuery({
    queryKey: ["sp", "reports", dateField, startDate, endDate],
    queryFn: async () => {
      const query = buildDateRangeQuery(dateField, startDate, endDate);
      try {
        return await fetchListItems<SPReportFields>(SP_LISTS.reports, query);
      } catch (error) {
        if (!isNonIndexedQueryError(error)) {
          throw error;
        }
        console.warn("[useReportsByDateField] Non-indexed query fallback: fetch all then filter client-side", error);
        return fetchListItems<SPReportFields>(SP_LISTS.reports);
      }
    },
    select: (items): WorkReport[] => {
      const workNumberMap = new Map((workNumbers ?? []).map((workNumber) => [workNumber.id, workNumber]));
      const filtered = startDate && endDate
        ? items.filter((item) => {
            const d = resolveReportFilterDate(item, dateField);
            return d >= startDate && d <= endDate;
          })
        : items;
      return filtered.map((item) => {
        const f = item.fields;
        const custId = String(f.CustomerLookupId ?? "");
        const workNumberId = String(f.WorkNumberLookupId ?? "");
        const linkedWorkNumber = workNumberMap.get(workNumberId);
        const systemId = String(f.SystemLookupId ?? "");
        const wtId = String(f.WorkTypeLookupId ?? "");
        return {
          id: item.id,
          title: f.Title,
          reportDate: toLocalDateStr(f.ReportDate),
          registrationDate: toLocalDateStr(f.RegistrationDate) || toLocalDateStr(item.createdDateTime),
          plannedHours: f.PlannedHours ?? 0,
          customerId: custId,
          customerName: maps.customerMap.get(custId) ?? "",
          systemId,
          systemName: maps.systemMap.get(systemId) ?? "",
          workTypeId: wtId,
          workTypeName: maps.workTypeMap.get(wtId) ?? "",
          workNumberId,
          workNumber: formatWorkNumber(linkedWorkNumber?.workNumber),
          workDescription: f.WorkDescription ?? "",
          workHours: f.WorkHours ?? 0,
          userName: resolveUserDisplayName(f.ReporterName, f.Title, item.createdByName),
          isProject: f.IsProject !== false,
          achievement: resolveAchievement(f),
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
      toast.error(`作業実績の登録に失敗しました。\n${message}`);
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
      toast.error(`作業実績の削除に失敗しました。\n${message}`);
    },
  });
}

// ==================== 作業日 ====================

export function useWorkDays(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["sp", "workDays", startDate, endDate],
    queryFn: async () => {
      if (!SP_LISTS.workDays) {
        return [] as Array<{ id: string; fields: SPWorkDayFields; createdDateTime?: string; createdByName?: string }>;
      }
      const query = buildDateRangeQuery("WorkDate", startDate, endDate);
      try {
        return await fetchListItems<SPWorkDayFields>(SP_LISTS.workDays, query);
      } catch (error) {
        if (!isNonIndexedQueryError(error)) {
          throw error;
        }
        console.warn("[useWorkDays] Non-indexed query fallback: fetch all then filter client-side", error);
        return fetchListItems<SPWorkDayFields>(SP_LISTS.workDays);
      }
    },
    select: (items): WorkDay[] => {
      const filtered = startDate && endDate
        ? items.filter((item) => {
            const d = resolveWorkDayFilterDate(item);
            return d >= startDate && d <= endDate;
          })
        : items;
      return filtered.map((item) => {
        const f = item.fields;
        return {
          id: item.id,
          title: f.Title,
          workDate: toLocalDateStr(f.WorkDate) || toLocalDateStr(item.createdDateTime),
          workStartTime: f.WorkStartTime ?? "",
          workEndTime: f.WorkEndTime ?? "",
          breakHours: f.BreakHours ?? 0,
          todayNote: f.TodayNote ?? "",
          userName: resolveUserDisplayName(f.ReporterName, f.Title, item.createdByName),
        };
      }).sort((left, right) => right.workDate.localeCompare(left.workDate) || Number(right.id) - Number(left.id));
    },
  });
}

export function useAddWorkDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fields: Record<string, unknown>) => {
      if (!SP_LISTS.workDays) {
        throw new Error("作業日リストが未設定です。");
      }
      return createListItem(SP_LISTS.workDays, fields);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "workDays"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`作業日の登録に失敗しました。\n${message}`);
    },
  });
}

export function useUpdateWorkDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, fields }: { itemId: string; fields: Record<string, unknown> }) => {
      if (!SP_LISTS.workDays) {
        throw new Error("作業日リストが未設定です。");
      }

      return updateListItem(SP_LISTS.workDays, itemId, fields);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "workDays"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`作業日の更新に失敗しました。\n${message}`);
    },
  });
}

// ==================== 工事番号マスタ CRUD ====================

export function useAddWorkNumber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fields: { workNumber: string; workNumberName: string; systemId: number; isDisabled?: boolean; orderSourceCustomerId?: number | null }) => {
      if (!SP_LISTS.workNumbers) {
        throw new Error("工事番号マスタリストが未設定です。");
      }
      return createListItem(SP_LISTS.workNumbers, {
        Title: fields.workNumber,
        [WORK_NUMBER_NAME_FIELD]: fields.workNumberName,
        [WORK_NUMBER_SYSTEM_ID_FIELD]: fields.systemId,
        IsDisabled: fields.isDisabled === true,
        [WORK_NUMBER_ORDER_SOURCE_LOOKUP_ID_FIELD]: fields.orderSourceCustomerId ?? null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "workNumbers"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`工事番号マスタの登録に失敗しました。\n${message}`);
    },
  });
}

export function useUpdateWorkNumber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      fields,
    }: {
      itemId: string;
      fields: { workNumber: string; workNumberName: string; systemId: number; isDisabled?: boolean; orderSourceCustomerId?: number | null };
    }) => {
      if (!SP_LISTS.workNumbers) {
        throw new Error("工事番号マスタリストが未設定です。");
      }
      return updateListItem(SP_LISTS.workNumbers, itemId, {
        Title: fields.workNumber,
        [WORK_NUMBER_NAME_FIELD]: fields.workNumberName,
        [WORK_NUMBER_SYSTEM_ID_FIELD]: fields.systemId,
        IsDisabled: fields.isDisabled === true,
        [WORK_NUMBER_ORDER_SOURCE_LOOKUP_ID_FIELD]: fields.orderSourceCustomerId ?? null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "workNumbers"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`工事番号マスタの更新に失敗しました。\n${message}`);
    },
  });
}

export function useDeleteWorkNumber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      if (!SP_LISTS.workNumbers) {
        throw new Error("工事番号マスタリストが未設定です。");
      }
      return deleteListItem(SP_LISTS.workNumbers, itemId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "workNumbers"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`工事番号マスタの削除に失敗しました。\n${message}`);
    },
  });
}

// ==================== 作業予定 ====================

export function usePlans(startDate?: string, endDate?: string) {
  const maps = useLookupMaps();
  const { data: workNumbers } = useWorkNumbers();

  return useQuery({
    queryKey: ["sp", "plans", startDate, endDate],
    queryFn: async () => {
      const query = buildDateRangeQuery("PlanDate", startDate, endDate);
      try {
        return await fetchListItems<SPPlanFields>(SP_LISTS.plans, query);
      } catch (error) {
        if (!isNonIndexedQueryError(error)) {
          throw error;
        }
        console.warn("[usePlans] Non-indexed query fallback: fetch all then filter client-side", error);
        return fetchListItems<SPPlanFields>(SP_LISTS.plans);
      }
    },
    select: (items): WorkPlan[] => {
      const workNumberMap = new Map((workNumbers ?? []).map((workNumber) => [workNumber.id, workNumber]));
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
        const workNumberId = String(f.WorkNumberLookupId ?? "");
        const linkedWorkNumber = workNumberMap.get(workNumberId);
        const systemId = String(f.SystemLookupId ?? "");
        const workTypeId = String(f.WorkTypeLookupId ?? "");
        return {
          id: item.id,
          title: f.Title,
          planDate: toLocalDateStr(f.PlanDate),
          customerId: custId,
          customerName: maps.customerMap.get(custId) ?? "",
          systemId,
          systemName: maps.systemMap.get(systemId) ?? "",
          workTypeId: workTypeId,
          workTypeName: maps.workTypeMap.get(workTypeId) ?? "",
          workNumberId,
          workNumber: formatWorkNumber(linkedWorkNumber?.workNumber),
          workDescription: f.WorkDescription ?? "",
          plannedHours: f.PlannedHours ?? 0,
          isProject: f.IsProject ?? true,
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
      toast.error(`作業予定の登録に失敗しました。\n${message}`);
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
      toast.error(`作業予定の削除に失敗しました。\n${message}`);
    },
  });
}

// ==================== マスタ CRUD ====================

export function useAddCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, customerNumber, isDisabled, isDirectSales }: { name: string; customerNumber: number; isDisabled: boolean; isDirectSales: boolean }) => {
      return createListItem(SP_LISTS.customers, {
        Title: name,
        SortOrder: customerNumber,
        [CUSTOMER_DISABLED_FIELD]: isDisabled === true,
        [CUSTOMER_DIRECT_SALES_FIELD]: isDirectSales === true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sp", "customers"] });
    },
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, name, customerNumber, isDisabled, isDirectSales }: { itemId: string; name: string; customerNumber: number; isDisabled: boolean; isDirectSales: boolean }) => {
      return updateListItem(SP_LISTS.customers, itemId, {
        Title: name,
        SortOrder: customerNumber,
        [CUSTOMER_DISABLED_FIELD]: isDisabled === true,
        [CUSTOMER_DIRECT_SALES_FIELD]: isDirectSales === true,
      });
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
      SortOrder?: number;
      IsDisabled?: boolean;
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
    mutationFn: async (fields: { Title: string; SortOrder?: number }) => {
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
