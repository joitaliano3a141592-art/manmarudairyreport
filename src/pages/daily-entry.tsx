import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormModal } from "@/components/form-modal";
import { DataErrorState } from "@/components/data-error-state";
import { ActionLoadingOverlay } from "@/components/action-loading-overlay";
import { Pencil, Plus, Send, Trash2 } from "lucide-react";
import {
  useCustomers,
  useSystems,
  useWorkNumbers,
  useWorkTypes,
  useReportsByDateField,
  useAddReport,
  useUpdateReport,
  useDeleteReport,
  usePlans,
  useAddPlan,
  useUpdatePlan,
  useDeletePlan,
  useWorkDays,
  useAddWorkDay,
  useUpdateWorkDay,
} from "@/hooks/use-sharepoint";
import { useCurrentUser } from "@/hooks/use-current-user";
import { postTeamsChannelMessage } from "@/lib/graphClient";
import { TEAMS_CONFIG } from "@/lib/sharepointConfig";
import { formatWorkHours } from "@/lib/utils";
import * as microsoftTeams from "@microsoft/teams-js";
import { toast } from "sonner";
import type { Achievement, WorkPlan } from "@/types/sharepoint";

function toLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeInlineText(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function stripCustomerNumberPrefix(value: string): string {
  return value.replace(/^\s*\d+\s*[：:]\s*/, "").trim();
}

const today = toLocalDate(new Date());
const tomorrow = (() => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return toLocalDate(date);
})();
const EMPTY_LOOKUP_SELECT_VALUE = "__empty_lookup__";
const EMPTY_ACHIEVEMENT_SELECT_VALUE = "__empty_achievement__";
const ACHIEVEMENT_OPTIONS: Exclude<Achievement, null>[] = ["○", "△", "✕"];

type TeamsPublishTarget = {
  teamId: string;
  channelId: string;
};

type ReportFormState = {
  reportDate: string;
  customerId: string;
  systemId: string;
  workNumberId: string;
  workTypeId: string;
  workDescription: string;
  plannedHours: string;
  workTime: string;
  isProject: boolean;
  achievement: Achievement;
};

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

type WorkDayFormState = {
  workDate: string;
  workStartTime: string;
  workEndTime: string;
  breakHours: string;
  todayNote: string;
};

type ReportTableRow = {
  rowKey: string;
  source: "report" | "today-plan";
  sourceId: string;
  displayType: "予定" | "予定外";
  reportDate: string;
  customerId: string;
  customerName: string;
  systemId: string;
  systemName: string;
  workTypeId: string;
  workTypeName: string;
  workNumberId: string;
  workNumber: string;
  plannedHours: number;
  workHours: number;
  achievement: Achievement;
  isProject: boolean;
  workDescription: string;
};

type InlineEditState = {
  rowKey: string;
  source: "report" | "today-plan";
  sourceId: string;
  reportDate: string;
  customerId: string;
  systemId: string;
  workNumberId: string;
  workTypeId: string;
  plannedHours: string;
  workTime: string;
  achievement: Achievement;
  isProject: boolean;
  workDescription: string;
};

type InlinePlanEditState = {
  planId: string;
  planDate: string;
  customerId: string;
  systemId: string;
  workNumberId: string;
  workTypeId: string;
  plannedHours: string;
  isProject: boolean;
  workDescription: string;
};

function emptyReportForm(): ReportFormState {
  return {
    reportDate: today,
    customerId: "",
    systemId: "",
    workNumberId: "",
    workTypeId: "",
    workDescription: "",
    plannedHours: "0",
    workTime: "0",
    isProject: true,
    achievement: null,
  };
}

function emptyPlanForm(): PlanFormState {
  return {
    planDate: tomorrow,
    customerId: "",
    systemId: "",
    workNumberId: "",
    workTypeId: "",
    workDescription: "",
    plannedHours: "0",
    isProject: true,
  };
}

function toLookupSelectValue(value: string): string {
  return value || EMPTY_LOOKUP_SELECT_VALUE;
}

function toAchievementSelectValue(value: Achievement): string {
  return value ?? EMPTY_ACHIEVEMENT_SELECT_VALUE;
}

function fromAchievementSelectValue(value: string): Achievement {
  return value === EMPTY_ACHIEVEMENT_SELECT_VALUE ? null : value as Exclude<Achievement, null>;
}

function applySystemSelection<T extends { systemId: string; workNumberId: string; isProject: boolean }>(prev: T, rawValue: string): T {
  const systemId = rawValue === EMPTY_LOOKUP_SELECT_VALUE ? "" : rawValue;
  return {
    ...prev,
    systemId,
    workNumberId: "",
    isProject: false,
  };
}

function applyWorkNumberSelection<T extends { systemId: string; workNumberId: string; isProject: boolean }>(prev: T, rawValue: string): T {
  const workNumberId = rawValue === EMPTY_LOOKUP_SELECT_VALUE ? "" : rawValue;
  return {
    ...prev,
    workNumberId,
    isProject: !!workNumberId,
  };
}

function emptyWorkDayForm(): WorkDayFormState {
  return {
    workDate: today,
    workStartTime: "08:45",
    workEndTime: "17:15",
    breakHours: "1",
    todayNote: "",
  };
}

async function resolveTeamsPublishTarget(): Promise<TeamsPublishTarget> {
  if (TEAMS_CONFIG.teamId && TEAMS_CONFIG.channelId) {
    return { teamId: TEAMS_CONFIG.teamId, channelId: TEAMS_CONFIG.channelId };
  }

  try {
    await microsoftTeams.app.initialize();
    const context = await microsoftTeams.app.getContext();
    const teamId = context.team?.groupId?.trim();
    const channelId = context.channel?.id?.trim();
    if (teamId && channelId) {
      return { teamId, channelId };
    }
  } catch {
    // Teams 外では環境変数フォールバックを使う。
  }

  return { teamId: TEAMS_CONFIG.teamId, channelId: TEAMS_CONFIG.channelId };
}

export default function DailyEntryPage() {
  const { data: customers = [], isError: custError, error: customersError } = useCustomers();
  const { data: systems = [], isError: sysError, error: systemsError } = useSystems();
  const { data: workNumbers = [] } = useWorkNumbers();
  const { data: activeWorkNumbers = [] } = useWorkNumbers({ includeDisabled: false });
  const { data: workTypes = [], isError: wtError, error: workTypesError } = useWorkTypes();
  const { data: reportItems = [], isLoading: reportsLoading, isError: reportsErrorState, error: reportsError } = useReportsByDateField("RegistrationDate", today, today);
  const { data: todayPlanItems = [], isLoading: todayPlansLoading, isError: todayPlansErrorState, error: todayPlansError } = usePlans(today, today);
  const { data: planItems = [], isLoading: plansLoading, isError: plansErrorState, error: plansError } = usePlans(tomorrow);
  const { data: workDayItems = [], isLoading: workDaysLoading, isError: workDaysErrorState, error: workDaysError } = useWorkDays(today, today);

  const addReportMutation = useAddReport();
  const updateReportMutation = useUpdateReport();
  const deleteReportMutation = useDeleteReport();
  const addPlanMutation = useAddPlan();
  const updatePlanMutation = useUpdatePlan();
  const deletePlanMutation = useDeletePlan();
  const addWorkDayMutation = useAddWorkDay();
  const updateWorkDayMutation = useUpdateWorkDay();
  const currentUser = useCurrentUser();

  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [workDayModalOpen, setWorkDayModalOpen] = useState(false);
  const [reportEditingId, setReportEditingId] = useState<string | null>(null);
  const [planEditingId, setPlanEditingId] = useState<string | null>(null);
  const [workDayId, setWorkDayId] = useState<string | null>(null);
  const [reportForm, setReportForm] = useState<ReportFormState>(emptyReportForm());
  const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlanForm());
  const [workDayForm, setWorkDayForm] = useState<WorkDayFormState>(emptyWorkDayForm());
  const [reportSubmitError, setReportSubmitError] = useState("");
  const [planSubmitError, setPlanSubmitError] = useState("");
  const [workDaySubmitError, setWorkDaySubmitError] = useState("");
  const [reportDeleteTargetId, setReportDeleteTargetId] = useState<string | null>(null);
  const [planDeleteTargetId, setPlanDeleteTargetId] = useState<string | null>(null);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<TeamsPublishTarget | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [inlinePlanEdit, setInlinePlanEdit] = useState<InlinePlanEditState | null>(null);

  const currentUserName = currentUser.name.trim();
  const currentUserEmail = currentUser.email.trim();
  const currentUserKeys = useMemo(() => {
    const keys = [currentUserName, currentUserEmail]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return new Set(keys);
  }, [currentUserName, currentUserEmail]);
  const isCurrentUserRecord = (userName: string) => {
    const normalized = userName.trim().toLowerCase();
    return !!normalized && currentUserKeys.has(normalized);
  };
  const reports = useMemo(
    () => reportItems.filter((report) => isCurrentUserRecord(report.userName)),
    [reportItems, currentUserKeys],
  );
  const plans = useMemo(
    () => planItems.filter((plan) => isCurrentUserRecord(plan.userName)),
    [planItems, currentUserKeys],
  );
  const todayPlans = useMemo(
    () => todayPlanItems.filter((plan) => isCurrentUserRecord(plan.userName)),
    [todayPlanItems, currentUserKeys],
  );
  const currentWorkDay = useMemo(
    () => workDayItems.find((item) => item.workDate === today && isCurrentUserRecord(item.userName)) ?? null,
    [workDayItems, currentUserKeys],
  );
  const customerNameMap = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  );
  const customerSortOrderMap = useMemo(
    () => new Map(customers.map((customer, index) => [customer.id, index])),
    [customers],
  );

  useEffect(() => {
    if (!currentWorkDay) {
      setWorkDayId(null);
      return;
    }

    setWorkDayForm({
      workDate: currentWorkDay.workDate || today,
      workStartTime: currentWorkDay.workStartTime,
      workEndTime: currentWorkDay.workEndTime,
      breakHours: String(currentWorkDay.breakHours ?? 1),
      todayNote: currentWorkDay.todayNote,
    });
    setWorkDayId(currentWorkDay.id);
  }, [currentWorkDay]);

  const activeSystems = useMemo(() => systems.filter((system) => !system.isDisabled), [systems]);
  const filteredReportSystems = activeSystems.filter((system) => !reportForm.customerId || system.customerId === reportForm.customerId);
  const filteredPlanSystems = activeSystems.filter((system) => !planForm.customerId || system.customerId === planForm.customerId);
  const workNumberMap = useMemo(
    () => new Map(workNumbers.map((workNumber) => [workNumber.id, workNumber])),
    [workNumbers],
  );
  const filteredReportWorkNumbers = useMemo(
    () => {
      if (!reportForm.systemId) {
        return [];
      }
      return activeWorkNumbers.filter((workNumber) => workNumber.systemId === reportForm.systemId);
    },
    [activeWorkNumbers, reportForm.systemId],
  );
  const filteredPlanWorkNumbers = useMemo(
    () => {
      if (!planForm.systemId) {
        return [];
      }
      return activeWorkNumbers.filter((workNumber) => workNumber.systemId === planForm.systemId);
    },
    [activeWorkNumbers, planForm.systemId],
  );
  const workNumberSystemNameMap = useMemo(
    () => new Map(workNumbers.map((workNumber) => [workNumber.id, workNumber.systemName])),
    [workNumbers],
  );
  const workNumberNameMap = useMemo(
    () => new Map(
      workNumbers.map((workNumber) => [
        workNumber.id,
        workNumber.displayName,
      ]),
    ),
    [workNumbers],
  );
  const resolveLinkedSystemId = (systemId: string, workNumberId: string) =>
    systemId || workNumberMap.get(workNumberId)?.systemId || "";
  const resolveReportRowSystemDisplayName = (row: ReportTableRow) =>
    row.systemName
    || workNumberSystemNameMap.get(row.workNumberId)
    || "―";
  const resolveReportRowCustomerDisplayName = (row: ReportTableRow) =>
    customerNameMap.get(row.customerId)
    || row.customerName
    || "―";
  const resolveReportRowWorkNumberDisplayName = (row: ReportTableRow) =>
    workNumberNameMap.get(row.workNumberId)
    || row.workNumber
    || "―";
  const resolvePlanSystemDisplayName = (plan: WorkPlan) =>
    plan.systemName
    || workNumberSystemNameMap.get(plan.workNumberId)
    || "―";
  const resolvePlanCustomerDisplayName = (plan: WorkPlan) =>
    customerNameMap.get(plan.customerId)
    || plan.customerName
    || "―";
  const resolvePlanWorkNumberDisplayName = (plan: WorkPlan) =>
    workNumberNameMap.get(plan.workNumberId)
    || plan.workNumber
    || "―";
  const totalWorkHours = useMemo(() => reports.reduce((sum, report) => sum + report.workHours, 0), [reports]);
  const nextPlanDate = useMemo(
    () => plans.reduce<string | null>((nearest, plan) => (!nearest || plan.planDate < nearest ? plan.planDate : nearest), null),
    [plans],
  );
  const publishPlans = useMemo(
    () => (nextPlanDate ? plans.filter((plan) => plan.planDate === nextPlanDate) : []),
    [nextPlanDate, plans],
  );
  const reportTableRows = useMemo<ReportTableRow[]>(() => {
    const buildKey = (parts: Array<string | null | undefined>) => parts.map((part) => (part == null ? "__missing__" : part)).join("|");
    const buildPlanMatchKey = (
      item: {
        reportDate?: string;
        planDate?: string;
        customerId: string;
        systemId: string;
        workTypeId: string;
        workNumberId: string;
        workDescription?: string;
      },
      options?: { ignoreWorkNumber?: boolean },
    ) => buildKey([
      item.reportDate ?? item.planDate ?? "",
      item.customerId,
      resolveLinkedSystemId(item.systemId, item.workNumberId),
      item.workTypeId,
      options?.ignoreWorkNumber ? "" : item.workNumberId,
      normalizeInlineText(item.workDescription ?? ""),
    ]);
    const planQueueByKey = new Map<string, WorkPlan[]>();
    const enqueuePlan = (key: string, plan: WorkPlan) => {
      const existing = planQueueByKey.get(key);
      if (existing) {
        existing.push(plan);
      } else {
        planQueueByKey.set(key, [plan]);
      }
    };
    const matchedPlanIds = new Set<string>();
    const matchedReportIds = new Set<string>();
    const consumeMatchedPlan = (keys: string[]) => {
      for (const key of keys) {
        const queue = planQueueByKey.get(key);
        while (queue && queue.length > 0) {
          const plan = queue.shift();
          if (plan && !matchedPlanIds.has(plan.id)) {
            return plan;
          }
        }
      }
      return null;
    };
    todayPlans.forEach((plan) => {
      enqueuePlan(buildPlanMatchKey(plan), plan);
      enqueuePlan(buildPlanMatchKey(plan, { ignoreWorkNumber: true }), plan);
    });
    reports.forEach((report) => {
      const matchedPlan = consumeMatchedPlan([
        buildPlanMatchKey(report),
        buildPlanMatchKey(report, { ignoreWorkNumber: true }),
      ]);
      if (matchedPlan) {
        matchedPlanIds.add(matchedPlan.id);
        matchedReportIds.add(report.id);
      }
    });
    const visibleTodayPlans = todayPlans.filter((plan) => !matchedPlanIds.has(plan.id));

    const reportRows: ReportTableRow[] = reports.map((report) => ({
      rowKey: `report-${report.id}`,
      source: "report",
      sourceId: report.id,
      displayType: matchedReportIds.has(report.id) && report.plannedHours > 0 ? "予定" : "予定外",
      reportDate: report.reportDate,
      customerId: report.customerId,
      customerName: report.customerName,
      systemId: report.systemId,
      systemName: report.systemName,
      workTypeId: report.workTypeId,
      workTypeName: report.workTypeName,
      workNumberId: report.workNumberId,
      workNumber: report.workNumber,
      plannedHours: report.plannedHours,
      workHours: report.workHours,
      achievement: report.achievement,
      isProject: report.isProject,
      workDescription: report.workDescription,
    }));
    const planRows: ReportTableRow[] = visibleTodayPlans.map((plan) => ({
      rowKey: `today-plan-${plan.id}`,
      source: "today-plan",
      sourceId: plan.id,
      displayType: "予定",
      reportDate: plan.planDate,
      customerId: plan.customerId,
      customerName: plan.customerName,
      systemId: plan.systemId,
      systemName: plan.systemName,
      workTypeId: plan.workTypeId,
      workTypeName: plan.workTypeName,
      workNumberId: plan.workNumberId,
      workNumber: plan.workNumber,
      plannedHours: plan.plannedHours,
      workHours: 0,
      achievement: null,
      isProject: plan.isProject,
      workDescription: plan.workDescription,
    }));
    return [...reportRows, ...planRows].sort((left, right) => {
      const dateCompare = left.reportDate.localeCompare(right.reportDate);
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return left.rowKey.localeCompare(right.rowKey);
    });
  }, [reports, resolveLinkedSystemId, todayPlans]);
  const publishReportGroups = useMemo(() => {
    const groups = new Map<string, typeof reports>();
    for (const report of reports) {
      const existing = groups.get(report.reportDate);
      if (existing) {
        existing.push(report);
      } else {
        groups.set(report.reportDate, [report]);
      }
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [reports]);

  if (custError || sysError || wtError || reportsErrorState || todayPlansErrorState || plansErrorState || workDaysErrorState) {
    return (
      <DataErrorState
        title="日次入力に必要なデータを取得できませんでした"
        error={customersError ?? systemsError ?? workTypesError ?? reportsError ?? todayPlansError ?? plansError ?? workDaysError}
      />
    );
  }

  const actionLoadingMessage = publishing
    ? "Teams に発報しています..."
    : addReportMutation.isPending || updateReportMutation.isPending
      ? "作業実績を保存しています..."
      : addPlanMutation.isPending || updatePlanMutation.isPending
        ? "作業予定を保存しています..."
        : addWorkDayMutation.isPending || updateWorkDayMutation.isPending
          ? "作業日を保存しています..."
          : deleteReportMutation.isPending
            ? "作業実績を削除しています..."
            : deletePlanMutation.isPending
              ? "作業予定を削除しています..."
              : "処理中...";
  const actionLoadingOpen = publishing
    || addReportMutation.isPending
    || updateReportMutation.isPending
    || addPlanMutation.isPending
    || updatePlanMutation.isPending
    || addWorkDayMutation.isPending
    || updateWorkDayMutation.isPending
    || deleteReportMutation.isPending
    || deletePlanMutation.isPending;

  const cancelInlineEdit = () => {
    setInlineEdit(null);
  };

  const saveInlineEdit = async () => {
    if (!inlineEdit) return;
    if (!inlineEdit.customerId || !inlineEdit.systemId || !inlineEdit.workTypeId) {
      toast.error("必須項目を入力してください。", { duration: 2200 });
      return;
    }

    const plannedHours = Number(inlineEdit.plannedHours);
    const workHours = Number(inlineEdit.workTime);
    if (Number.isNaN(plannedHours) || plannedHours < 0 || Number.isNaN(workHours) || workHours < 0) {
      toast.error("時間は 0 以上で入力してください。", { duration: 2200 });
      return;
    }

    const customer = customers.find((item) => item.id === inlineEdit.customerId);
    const workNumber = workNumberMap.get(inlineEdit.workNumberId);
    const systemLookupId = inlineEdit.systemId ? Number(inlineEdit.systemId) : null;
    const workNumberLookupId = workNumber ? Number(workNumber.id) : null;

    try {
      if (inlineEdit.source === "report") {
        await updateReportMutation.mutateAsync({
          itemId: inlineEdit.sourceId,
          fields: {
            Title: `日報-${customer?.name ?? ""}`,
            ReportDate: `${inlineEdit.reportDate}T00:00:00+09:00`,
            RegistrationDate: `${today}T00:00:00+09:00`,
            PlannedHours: plannedHours,
            CustomerLookupId: Number(inlineEdit.customerId),
            SystemLookupId: systemLookupId,
            WorkTypeLookupId: Number(inlineEdit.workTypeId),
            WorkNumberLookupId: workNumberLookupId,
            WorkDescription: inlineEdit.workDescription,
            WorkHours: workHours,
            ReporterName: currentUser.name,
            IsProject: inlineEdit.isProject,
            Achievement: inlineEdit.achievement,
          },
        });
        toast.success("作業実績を更新しました。", { duration: 2200 });
      } else {
        await addReportMutation.mutateAsync({
          Title: `日報-${customer?.name ?? ""}`,
          ReportDate: `${inlineEdit.reportDate}T00:00:00+09:00`,
          RegistrationDate: `${today}T00:00:00+09:00`,
          PlannedHours: plannedHours,
          CustomerLookupId: Number(inlineEdit.customerId),
          SystemLookupId: systemLookupId,
          WorkTypeLookupId: Number(inlineEdit.workTypeId),
          WorkNumberLookupId: workNumberLookupId,
          WorkDescription: inlineEdit.workDescription,
          WorkHours: workHours,
          ReporterName: currentUser.name,
          IsProject: inlineEdit.isProject,
          Achievement: inlineEdit.achievement,
        });
        toast.success("本日予定から作業実績を登録しました。", { duration: 2200 });
      }
      setInlineEdit(null);
    } catch (error) {
      toast.error(`保存に失敗しました。${error instanceof Error ? error.message : String(error)}`, { duration: 2500 });
    }
  };

  const cancelInlinePlanEdit = () => {
    setInlinePlanEdit(null);
  };

  const saveInlinePlanEdit = async () => {
    if (!inlinePlanEdit) return;
    if (!inlinePlanEdit.customerId || !inlinePlanEdit.systemId || !inlinePlanEdit.workTypeId) {
      toast.error("必須項目を入力してください。", { duration: 2200 });
      return;
    }

    const plannedHours = Number(inlinePlanEdit.plannedHours);
    if (Number.isNaN(plannedHours) || plannedHours < 0) {
      toast.error("予定時間は 0 以上で入力してください。", { duration: 2200 });
      return;
    }

    const customer = customers.find((item) => item.id === inlinePlanEdit.customerId);
    const workNumber = workNumberMap.get(inlinePlanEdit.workNumberId);
    const systemLookupId = inlinePlanEdit.systemId ? Number(inlinePlanEdit.systemId) : null;
    const workNumberLookupId = workNumber ? Number(workNumber.id) : null;

    try {
      await updatePlanMutation.mutateAsync({
        itemId: inlinePlanEdit.planId,
        fields: {
          Title: `予定-${customer?.name ?? ""}`,
          PlanDate: `${inlinePlanEdit.planDate}T00:00:00+09:00`,
          CustomerLookupId: Number(inlinePlanEdit.customerId),
          SystemLookupId: systemLookupId,
          WorkTypeLookupId: Number(inlinePlanEdit.workTypeId),
          WorkNumberLookupId: workNumberLookupId,
          WorkDescription: inlinePlanEdit.workDescription,
          PlannedHours: plannedHours,
          IsProject: inlinePlanEdit.isProject,
          AssigneeName: currentUser.name,
        },
      });
      toast.success("作業予定を更新しました。", { duration: 2200 });
      setInlinePlanEdit(null);
    } catch (error) {
      toast.error(`保存に失敗しました。${error instanceof Error ? error.message : String(error)}`, { duration: 2500 });
    }
  };

  const closeReportModal = () => {
    setReportModalOpen(false);
    setReportEditingId(null);
    setReportForm(emptyReportForm());
    setReportSubmitError("");
  };

  const closePlanModal = () => {
    setPlanModalOpen(false);
    setPlanEditingId(null);
    setPlanForm(emptyPlanForm());
    setPlanSubmitError("");
  };

  const closeWorkDayModal = () => {
    setWorkDayModalOpen(false);
    setWorkDayForm(currentWorkDay ? {
      workDate: currentWorkDay.workDate || today,
      workStartTime: currentWorkDay.workStartTime,
      workEndTime: currentWorkDay.workEndTime,
      breakHours: String(currentWorkDay.breakHours ?? 1),
      todayNote: currentWorkDay.todayNote,
    } : emptyWorkDayForm());
    setWorkDaySubmitError("");
  };

  const saveReport = async () => {
    if (!reportForm.customerId || !reportForm.systemId || !reportForm.workTypeId) {
      setReportSubmitError("必須項目を入力してください。");
      return;
    }

    const plannedHours = Number(reportForm.plannedHours);
    const workHours = Number(reportForm.workTime);
    if (Number.isNaN(plannedHours) || plannedHours < 0) {
      setReportSubmitError("予定時間は 0 以上で入力してください。");
      return;
    }
    if (Number.isNaN(workHours) || workHours < 0) {
      setReportSubmitError("作業時間は 0 以上で入力してください。");
      return;
    }

    const customer = customers.find((item) => item.id === reportForm.customerId);
    const workNumber = workNumberMap.get(reportForm.workNumberId) ?? null;
    const systemLookupId = reportForm.systemId ? Number(reportForm.systemId) : null;
    const workNumberLookupId = workNumber ? Number(workNumber.id) : null;
    const fields = {
      Title: `日報-${customer?.name ?? ""}`,
      ReportDate: `${reportForm.reportDate}T00:00:00+09:00`,
      RegistrationDate: `${today}T00:00:00+09:00`,
      PlannedHours: plannedHours,
      CustomerLookupId: Number(reportForm.customerId),
      SystemLookupId: systemLookupId,
      WorkTypeLookupId: Number(reportForm.workTypeId),
      WorkNumberLookupId: workNumberLookupId,
      WorkDescription: reportForm.workDescription,
      WorkHours: workHours,
      ReporterName: currentUser.name,
      IsProject: !!workNumber,
      Achievement: reportForm.achievement,
    };

    try {
      if (reportEditingId) {
        await updateReportMutation.mutateAsync({ itemId: reportEditingId, fields });
        toast.success("作業実績を更新しました。", { duration: 2200 });
      } else {
        await addReportMutation.mutateAsync(fields);
        toast.success("作業実績を保存しました。", { duration: 2200 });
      }
      closeReportModal();
    } catch (error) {
      setReportSubmitError(error instanceof Error ? error.message : String(error));
    }
  };

  const savePlan = async () => {
    if (!planForm.customerId || !planForm.systemId || !planForm.workTypeId) {
      setPlanSubmitError("必須項目を入力してください。");
      return;
    }

    const plannedHours = Number(planForm.plannedHours);
    if (Number.isNaN(plannedHours) || plannedHours < 0) {
      setPlanSubmitError("予定時間は 0 以上で入力してください。");
      return;
    }

    const customer = customers.find((item) => item.id === planForm.customerId);
    const workNumber = workNumberMap.get(planForm.workNumberId) ?? null;
    const systemLookupId = planForm.systemId ? Number(planForm.systemId) : null;
    const workNumberLookupId = workNumber ? Number(workNumber.id) : null;
    const fields = {
      Title: `予定-${customer?.name ?? ""}`,
      PlanDate: `${planForm.planDate}T00:00:00+09:00`,
      CustomerLookupId: Number(planForm.customerId),
      SystemLookupId: systemLookupId,
      WorkTypeLookupId: Number(planForm.workTypeId),
      WorkNumberLookupId: workNumberLookupId,
      WorkDescription: planForm.workDescription,
      PlannedHours: plannedHours,
      IsProject: !!workNumber,
      AssigneeName: currentUser.name,
    };

    try {
      if (planEditingId) {
        await updatePlanMutation.mutateAsync({ itemId: planEditingId, fields });
        toast.success("作業予定を更新しました。", { duration: 2200 });
      } else {
        await addPlanMutation.mutateAsync(fields);
        toast.success("作業予定を保存しました。", { duration: 2200 });
      }
      closePlanModal();
    } catch (error) {
      setPlanSubmitError(error instanceof Error ? error.message : String(error));
    }
  };

  const saveWorkDay = async () => {
    const breakHours = Number(workDayForm.breakHours);
    if (Number.isNaN(breakHours) || breakHours < 0) {
      setWorkDaySubmitError("休憩時間は 0 以上で入力してください。");
      return;
    }

    const fields = {
      Title: `作業日-${workDayForm.workDate}`,
      WorkDate: `${workDayForm.workDate}T00:00:00+09:00`,
      WorkStartTime: workDayForm.workStartTime,
      WorkEndTime: workDayForm.workEndTime,
      BreakHours: breakHours,
      TodayNote: workDayForm.todayNote,
      ReporterName: currentUserName,
    };

    try {
      if (workDayId) {
        await updateWorkDayMutation.mutateAsync({ itemId: workDayId, fields });
      } else {
        await addWorkDayMutation.mutateAsync(fields);
      }
      toast.success("本日のひとことを登録しました", { duration: 2200 });
      closeWorkDayModal();
    } catch (error) {
      setWorkDaySubmitError(error instanceof Error ? error.message : String(error));
    }
  };

  const openNewReportModal = () => {
    setReportEditingId(null);
    setReportForm(emptyReportForm());
    setReportSubmitError("");
    setReportModalOpen(true);
  };

  const openEditReportModal = (row: ReportTableRow) => {
    setReportEditingId(row.source === "report" ? row.sourceId : null);
    setReportForm({
      reportDate: row.reportDate,
      customerId: row.customerId,
      systemId: resolveLinkedSystemId(row.systemId, row.workNumberId),
      workNumberId: row.workNumberId,
      workTypeId: row.workTypeId,
      workDescription: row.workDescription,
      plannedHours: String(row.plannedHours ?? 0),
      workTime: String(row.workHours ?? 0),
      isProject: row.isProject,
      achievement: row.achievement,
    });
    setReportSubmitError("");
    setReportModalOpen(true);
  };

  const openNewPlanModal = () => {
    setPlanEditingId(null);
    setPlanForm(emptyPlanForm());
    setPlanSubmitError("");
    setPlanModalOpen(true);
  };

  const openEditPlanModal = (plan: WorkPlan) => {
    setPlanEditingId(plan.id);
    setPlanForm({
      planDate: plan.planDate,
      customerId: plan.customerId,
      systemId: resolveLinkedSystemId(plan.systemId, plan.workNumberId),
      workNumberId: plan.workNumberId,
      workTypeId: plan.workTypeId,
      workDescription: plan.workDescription,
      plannedHours: String(plan.plannedHours ?? 0),
      isProject: plan.isProject,
    });
    setPlanSubmitError("");
    setPlanModalOpen(true);
  };

  const requestPublish = async () => {
    if (reportsLoading || plansLoading) {
      toast.error("発報対象データを読み込み中です。しばらくしてから再度お試しください。", { duration: 2200 });
      return;
    }
    if (reports.length === 0 && publishPlans.length === 0) {
      toast.error("送信する作業実績・予定がありません。", { duration: 2200 });
      return;
    }

    const target = await resolveTeamsPublishTarget();
    if (!target.teamId || !target.channelId) {
      toast.error("Teams チャネルが設定されていません。管理者に連絡してください。", { duration: 2200 });
      return;
    }

    if (publishing) {
      return;
    }

    setPublishTarget(target);
    setPublishConfirmOpen(true);
  };

  const handlePublish = async () => {
    if (!publishTarget) return;
    setPublishing(true);
    try {
      const escapeHtml = (value: string) => value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
      const formatMonthDay = (date: string) => {
        const [, month, day] = date.split("-");
        return `${Number(month)}/${Number(day)}`;
      };
      const buildWorkSummary = (workTypeName: string, workDescription: string) => {
        const normalizedWorkTypeName = normalizeInlineText(workTypeName);
        const normalizedWorkDescription = normalizeInlineText(workDescription);
        return [normalizedWorkTypeName, normalizedWorkDescription].filter(Boolean).join(" ");
      };
      const resolveTeamsCustomerName = (customerId: string, customerName: string) => (
        customerNameMap.get(customerId)
        || stripCustomerNumberPrefix(customerName)
        || "未設定"
      );
      const comparePublishItems = (
        left: { customerId: string; customerName: string; workTypeName: string; workDescription: string },
        right: { customerId: string; customerName: string; workTypeName: string; workDescription: string },
      ) => {
        const leftOrder = customerSortOrderMap.get(left.customerId) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = customerSortOrderMap.get(right.customerId) ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        const customerNameCompare = resolveTeamsCustomerName(left.customerId, left.customerName)
          .localeCompare(resolveTeamsCustomerName(right.customerId, right.customerName), "ja");
        if (customerNameCompare !== 0) {
          return customerNameCompare;
        }

        const workTypeCompare = normalizeInlineText(left.workTypeName).localeCompare(normalizeInlineText(right.workTypeName), "ja");
        if (workTypeCompare !== 0) {
          return workTypeCompare;
        }

        return normalizeInlineText(left.workDescription).localeCompare(normalizeInlineText(right.workDescription), "ja");
      };
      const buildCustomerLines = (items: Array<{ customerId: string; customerName: string; workTypeName: string; workDescription: string }>) => {
        return [...items]
          .sort(comparePublishItems)
          .map((item) => `<p>【${escapeHtml(resolveTeamsCustomerName(item.customerId, item.customerName))}】：${escapeHtml(buildWorkSummary(item.workTypeName, item.workDescription) || "（内容未設定）")}</p>`)
          .join("");
      };
      const reportSections = publishReportGroups.map(([reportDate, groupedReports]) => `
    <p>■ ${formatMonthDay(reportDate)}</p>
    ${buildCustomerLines(groupedReports) || "<p>（なし）</p>"}`).join("<br/>");
      const nextPlanSection = nextPlanDate
        ? `
    <p>■ 次回の作業予定（${formatMonthDay(nextPlanDate)}）</p>
    ${publishPlans.length > 0 ? buildCustomerLines(publishPlans) : "<p>（なし）</p>"}`
        : "<p>■ 次回の作業予定</p><p>（なし）</p>";
      const note = workDayForm.todayNote.trim() || currentWorkDay?.todayNote?.trim() || "";
      const remarksSection = note
        ? `
    <br/>
    <p>■ 本日のひとこと</p>
    <p>${escapeHtml(note).replaceAll("\n", "<br/>")}</p>`
        : "";

      const html = `
        <p><span style="font-size:1.2em;font-weight:bold;">${formatMonthDay(today)}</span></p>
    ${publishReportGroups.length > 0 ? reportSections : "<p>■ 作業実績</p><p>（なし）</p>"}
    <br/>
    ${nextPlanSection}
    ${remarksSection}
      `.trim();

      await postTeamsChannelMessage(publishTarget.teamId, publishTarget.channelId, html);
      toast.success("Teams チャネルに送信しました。", { duration: 2200 });
    } catch (error) {
      console.error("Teams 送信エラー:", error);
      toast.error(`Teams への送信に失敗しました。${error instanceof Error ? error.message : String(error)}`, { duration: 2200 });
    } finally {
      setPublishing(false);
      setPublishTarget(null);
    }
  };

  if (reportsLoading || todayPlansLoading || plansLoading || workDaysLoading) {
    return (
      <div className="container mx-auto py-6 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">SharePoint からデータを読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-screen-xl py-6 overflow-x-hidden">
      <ActionLoadingOverlay open={actionLoadingOpen} message={actionLoadingMessage} />

      <div className="mb-6 flex flex-col gap-4 min-w-0">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">日次入力</h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={requestPublish} disabled={publishing}>
              <Send className="mr-2 h-4 w-4" /> {publishing ? "送信中..." : "発報"}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <Badge className="border-sky-300 bg-sky-200 text-black font-bold hover:bg-sky-200">作業実績 {reports.length} 件</Badge>
          <Badge className="border-emerald-300 bg-emerald-200 text-black font-bold hover:bg-emerald-200">作業予定 {plans.length} 件</Badge>
          <Badge className="border-amber-300 bg-amber-200 text-black font-bold hover:bg-amber-200">合計 {formatWorkHours(totalWorkHours)}h</Badge>
          <Badge className="border-violet-300 bg-violet-200 text-black font-bold hover:bg-violet-200">本日 {currentWorkDay ? "登録済み" : "未登録"}</Badge>
        </div>
      </div>

      <div className="grid gap-6 mt-6 min-w-0">
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle>本日の実績</CardTitle>
              <div className="flex items-center gap-3">
                <div className="text-sm font-medium">合計: {formatWorkHours(totalWorkHours)}h</div>
                <Button size="sm" onClick={openNewReportModal} className="bg-emerald-600 text-white hover:bg-emerald-700">
                  <Plus className="mr-2 h-4 w-4" />実績追加
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {reportTableRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">作業実績と本日予定データがありません。</p>
            ) : (
              <div className="max-h-[28rem] overflow-auto">
                <Table className="min-w-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <TableHeader className="bg-slate-200 dark:bg-slate-900">
                  <TableRow>
                    <TableHead>種別</TableHead>
                    <TableHead>報告日</TableHead>
                    <TableHead>顧客</TableHead>
                    <TableHead>システム</TableHead>
                    <TableHead>工事番号</TableHead>
                    <TableHead>区分</TableHead>
                    <TableHead>作業内容</TableHead>
                    <TableHead className="text-right">予定時間</TableHead>
                    <TableHead className="text-right">実績時間</TableHead>
                    <TableHead className="text-center">案件</TableHead>
                    <TableHead className="text-center">達成度</TableHead>
                    <TableHead className="w-[260px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportTableRows.map((row) => {
                    const isEditing = inlineEdit?.rowKey === row.rowKey;
                    const activeCustomerId = isEditing ? inlineEdit.customerId : row.customerId;
                    const systemOptions = activeSystems.filter((system) => !activeCustomerId || system.customerId === activeCustomerId);

                    return (
                      <TableRow
                        key={row.rowKey}
                        onDoubleClick={() => {
                          if (!isEditing) {
                            openEditReportModal(row);
                          }
                        }}
                        className={!isEditing ? "cursor-pointer" : undefined}
                      >
                        <TableCell className="whitespace-nowrap">
                          <span
                            className={row.source === "report"
                              ? row.displayType === "予定"
                               ? "inline-flex items-center rounded-full border border-sky-200 bg-sky-100 px-3 py-1 text-xs font-bold text-slate-900 dark:border-sky-900 dark:bg-sky-950 dark:text-slate-100"
                               : "inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-xs font-bold text-slate-900 dark:border-amber-900 dark:bg-amber-950 dark:text-slate-100"
                              : "inline-flex items-center rounded-full border border-sky-300 bg-transparent px-3 py-1 text-xs font-bold text-sky-700 dark:border-sky-800 dark:text-sky-300"}
                          >
                             {row.displayType}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{isEditing ? (
                          <Input type="date" value={inlineEdit.reportDate} onChange={(e) => setInlineEdit({ ...inlineEdit, reportDate: e.target.value })} className="min-w-[130px]" />
                        ) : row.reportDate}</TableCell>
                        <TableCell className="whitespace-nowrap">{isEditing ? (
                          <Select value={inlineEdit.customerId} onValueChange={(value) => setInlineEdit({ ...inlineEdit, customerId: value, systemId: "", workNumberId: "", isProject: false })}>
                            <SelectTrigger className="min-w-[140px]">
                              <SelectValue placeholder="顧客" />
                            </SelectTrigger>
                            <SelectContent>
                              {customers.map((customer) => (
                                <SelectItem key={customer.id} value={customer.id}>{customer.displayName}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : resolveReportRowCustomerDisplayName(row)}</TableCell>
                        <TableCell className="whitespace-nowrap">{isEditing ? (
                          <Select value={inlineEdit.systemId} onValueChange={(value) => setInlineEdit((prev) => prev ? applySystemSelection(prev, value) : prev)} disabled={!inlineEdit.customerId}>
                            <SelectTrigger className="min-w-[140px]">
                              <SelectValue placeholder="システム" />
                            </SelectTrigger>
                            <SelectContent>
                              {systemOptions.map((system) => (
                                <SelectItem key={system.id} value={system.id}>{system.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : resolveReportRowSystemDisplayName(row)}</TableCell>
                        <TableCell className="whitespace-nowrap">{isEditing ? (
                          <Select
                            value={toLookupSelectValue(inlineEdit.workNumberId)}
                            onValueChange={(value) => {
                              setInlineEdit((prev) => prev ? applyWorkNumberSelection(prev, value) : prev);
                            }}
                            disabled={!inlineEdit.systemId}
                          >
                            <SelectTrigger className="min-w-[140px]">
                              <SelectValue placeholder="工事番号" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={EMPTY_LOOKUP_SELECT_VALUE}>工事番号なし</SelectItem>
                              {workNumbers
                                .filter((workNumber) => workNumber.systemId === inlineEdit.systemId && !workNumber.isDisabled)
                                .map((workNumber) => (
                                  <SelectItem key={workNumber.id} value={workNumber.id}>{workNumber.displayName}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        ) : resolveReportRowWorkNumberDisplayName(row)}</TableCell>
                        <TableCell className="whitespace-nowrap">{isEditing ? (
                          <Select value={inlineEdit.workTypeId} onValueChange={(value) => setInlineEdit({ ...inlineEdit, workTypeId: value })}>
                            <SelectTrigger className="min-w-[130px]">
                              <SelectValue placeholder="区分" />
                            </SelectTrigger>
                            <SelectContent>
                              {workTypes.map((workType) => (
                                <SelectItem key={workType.id} value={workType.id}>{workType.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : row.workTypeName}</TableCell>
                        <TableCell className="max-w-[20rem]">{isEditing ? (
                          <Input value={inlineEdit.workDescription} onChange={(e) => setInlineEdit({ ...inlineEdit, workDescription: e.target.value })} />
                        ) : (
                          <div className="truncate" title={row.workDescription}>{row.workDescription}</div>
                        )}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{isEditing ? (
                          <Input type="number" min="0" step="0.25" value={inlineEdit.plannedHours} onChange={(e) => setInlineEdit({ ...inlineEdit, plannedHours: e.target.value })} className="w-[90px] ml-auto" />
                        ) : `${formatWorkHours(row.plannedHours)}h`}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{isEditing ? (
                          <Input type="number" min="0" step="0.25" value={inlineEdit.workTime} onChange={(e) => setInlineEdit({ ...inlineEdit, workTime: e.target.value })} className="w-[90px] ml-auto" />
                        ) : `${formatWorkHours(row.workHours)}h`}</TableCell>
                        <TableCell className="text-center">{isEditing ? (
                          <div className="flex justify-center">
                            <Checkbox checked={inlineEdit.isProject} onCheckedChange={(checked) => setInlineEdit({ ...inlineEdit, isProject: checked === true })} />
                          </div>
                        ) : row.isProject ? "○" : "―"}</TableCell>
                        <TableCell className="text-center">{isEditing ? (
                          <Select value={toAchievementSelectValue(inlineEdit.achievement)} onValueChange={(value) => setInlineEdit({ ...inlineEdit, achievement: fromAchievementSelectValue(value) })}>
                            <SelectTrigger className="min-w-[90px]">
                              <SelectValue placeholder="達成度" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={EMPTY_ACHIEVEMENT_SELECT_VALUE}>達成度を選択</SelectItem>
                              {ACHIEVEMENT_OPTIONS.map((achievement) => (
                                <SelectItem key={achievement} value={achievement}>{achievement}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (row.achievement ?? "―")}</TableCell>
                        <TableCell className="w-[260px]">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            {isEditing ? (
                              <>
                                <Button size="sm" onClick={() => void saveInlineEdit()} className="shrink-0 bg-sky-600 text-white hover:bg-sky-700">{row.source === "report" ? "保存" : "登録"}</Button>
                                <Button size="sm" variant="outline" onClick={cancelInlineEdit} className="shrink-0">キャンセル</Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" onClick={() => openEditReportModal(row)} className="shrink-0 bg-sky-600 text-white hover:bg-sky-700">
                                  <Pencil className="mr-1 h-4 w-4" />編集
                                </Button>
                                {row.source === "report" && (
                                  <Button size="sm" variant="destructive" onClick={() => setReportDeleteTargetId(row.sourceId)} disabled={deleteReportMutation.isPending} className="shrink-0">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle>次回の予定</CardTitle>
              <div className="flex items-center gap-3">
                <div className="text-sm font-medium">次回: {nextPlanDate ?? "-"}</div>
                <Button size="sm" onClick={openNewPlanModal} className="bg-emerald-600 text-white hover:bg-emerald-700">
                  <Plus className="mr-2 h-4 w-4" />予定追加
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">今後の作業予定がありません。</p>
            ) : (
              <div className="max-h-[28rem] overflow-auto">
                <Table className="min-w-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <TableHeader className="bg-slate-200 dark:bg-slate-900">
                  <TableRow>
                    <TableHead>予定日</TableHead>
                    <TableHead>顧客</TableHead>
                    <TableHead>システム</TableHead>
                    <TableHead>工事番号</TableHead>
                    <TableHead>区分</TableHead>
                    <TableHead className="text-right">予定時間</TableHead>
                    <TableHead>案件</TableHead>
                    <TableHead>作業内容</TableHead>
                    <TableHead className="w-[220px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((plan) => {
                    const isEditing = inlinePlanEdit?.planId === plan.id;
                    const activeCustomerId = isEditing ? inlinePlanEdit.customerId : plan.customerId;
                    const systemOptions = activeSystems.filter((system) => !activeCustomerId || system.customerId === activeCustomerId);

                    return (
                      <TableRow
                        key={plan.id}
                        onDoubleClick={() => {
                          if (!isEditing) {
                            openEditPlanModal(plan);
                          }
                        }}
                        className={!isEditing ? "cursor-pointer" : undefined}
                      >
                        <TableCell className="whitespace-nowrap">{isEditing ? (
                          <Input type="date" value={inlinePlanEdit.planDate} onChange={(e) => setInlinePlanEdit({ ...inlinePlanEdit, planDate: e.target.value })} className="min-w-[130px]" />
                        ) : plan.planDate}</TableCell>
                        <TableCell className="whitespace-nowrap">{isEditing ? (
                          <Select value={inlinePlanEdit.customerId} onValueChange={(value) => setInlinePlanEdit({ ...inlinePlanEdit, customerId: value, systemId: "", workNumberId: "", isProject: false })}>
                            <SelectTrigger className="min-w-[140px]">
                              <SelectValue placeholder="顧客" />
                            </SelectTrigger>
                            <SelectContent>
                              {customers.map((customer) => (
                                <SelectItem key={customer.id} value={customer.id}>{customer.displayName}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : resolvePlanCustomerDisplayName(plan)}</TableCell>
                        <TableCell className="whitespace-nowrap">{isEditing ? (
                          <Select value={inlinePlanEdit.systemId} onValueChange={(value) => setInlinePlanEdit((prev) => prev ? applySystemSelection(prev, value) : prev)} disabled={!inlinePlanEdit.customerId}>
                            <SelectTrigger className="min-w-[140px]">
                              <SelectValue placeholder="システム" />
                            </SelectTrigger>
                            <SelectContent>
                              {systemOptions.map((system) => (
                                <SelectItem key={system.id} value={system.id}>{system.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : resolvePlanSystemDisplayName(plan)}</TableCell>
                        <TableCell className="whitespace-nowrap">{isEditing ? (
                          <Select
                            value={toLookupSelectValue(inlinePlanEdit.workNumberId)}
                            onValueChange={(value) => {
                              setInlinePlanEdit((prev) => prev ? applyWorkNumberSelection(prev, value) : prev);
                            }}
                            disabled={!inlinePlanEdit.systemId}
                          >
                            <SelectTrigger className="min-w-[140px]">
                              <SelectValue placeholder="工事番号" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={EMPTY_LOOKUP_SELECT_VALUE}>工事番号なし</SelectItem>
                              {workNumbers
                                .filter((workNumber) => workNumber.systemId === inlinePlanEdit.systemId && !workNumber.isDisabled)
                                .map((workNumber) => (
                                  <SelectItem key={workNumber.id} value={workNumber.id}>{workNumber.displayName}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        ) : resolvePlanWorkNumberDisplayName(plan)}</TableCell>
                        <TableCell className="whitespace-nowrap">{isEditing ? (
                          <Select value={inlinePlanEdit.workTypeId} onValueChange={(value) => setInlinePlanEdit({ ...inlinePlanEdit, workTypeId: value })}>
                            <SelectTrigger className="min-w-[130px]">
                              <SelectValue placeholder="区分" />
                            </SelectTrigger>
                            <SelectContent>
                              {workTypes.map((workType) => (
                                <SelectItem key={workType.id} value={workType.id}>{workType.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : plan.workTypeName || "―"}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{isEditing ? (
                          <Input type="number" min="0" step="0.25" value={inlinePlanEdit.plannedHours} onChange={(e) => setInlinePlanEdit({ ...inlinePlanEdit, plannedHours: e.target.value })} className="w-[90px] ml-auto" />
                        ) : plan.plannedHours > 0 ? `${formatWorkHours(plan.plannedHours)}h` : "―"}</TableCell>
                        <TableCell className="text-center">{isEditing ? (
                          <div className="flex justify-center">
                            <Checkbox checked={inlinePlanEdit.isProject} onCheckedChange={(checked) => setInlinePlanEdit({ ...inlinePlanEdit, isProject: checked === true })} />
                          </div>
                        ) : plan.isProject ? "○" : "―"}</TableCell>
                        <TableCell className="max-w-[16rem]">{isEditing ? (
                          <Input value={inlinePlanEdit.workDescription} onChange={(e) => setInlinePlanEdit({ ...inlinePlanEdit, workDescription: e.target.value })} />
                        ) : (
                          <div className="truncate" title={plan.workDescription}>{plan.workDescription}</div>
                        )}</TableCell>
                        <TableCell className="w-[220px]">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            {isEditing ? (
                              <>
                                <Button size="sm" onClick={() => void saveInlinePlanEdit()} className="shrink-0 bg-sky-600 text-white hover:bg-sky-700">保存</Button>
                                <Button size="sm" variant="outline" onClick={cancelInlinePlanEdit} className="shrink-0">キャンセル</Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" onClick={() => openEditPlanModal(plan)} className="shrink-0 bg-sky-600 text-white hover:bg-sky-700">
                                  <Pencil className="mr-1 h-4 w-4" />編集
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => setPlanDeleteTargetId(plan.id)} disabled={deletePlanMutation.isPending} className="shrink-0">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>本日のひとこと</CardTitle>
            <Button
              variant="outline"
              onClick={() => {
                void saveWorkDay();
              }}
              disabled={addWorkDayMutation.isPending || updateWorkDayMutation.isPending}
            >
              <Pencil className="mr-2 h-4 w-4" /> 登録
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <p className="text-muted-foreground"></p>
            <Textarea value={workDayForm.todayNote} onChange={(e) => setWorkDayForm({ ...workDayForm, todayNote: e.target.value })} rows={4} />
            {workDaySubmitError && <p className="text-sm text-destructive">登録できませんでした: {workDaySubmitError}</p>}
          </div>
        </CardContent>
      </Card>

      <FormModal
        open={reportModalOpen}
        onOpenChange={(open) => {
          if (!open) closeReportModal();
        }}
        title={reportEditingId ? "作業実績を編集" : "作業実績を登録"}
        description=""
        onCancel={closeReportModal}
        onSave={() => {
          void saveReport();
        }}
        saveLabel={reportEditingId ? "更新" : "登録"}
        isSaving={addReportMutation.isPending || updateReportMutation.isPending}
        maxWidth="full"
      >
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-1">
            <div className="space-y-1.5">
              <Label>報告日</Label>
              <Input type="date" value={reportForm.reportDate} onChange={(e) => setReportForm({ ...reportForm, reportDate: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-1">
            <div className="space-y-1.5">
              <Label>顧客</Label>
              <Select value={reportForm.customerId} onValueChange={(value) => setReportForm({ ...reportForm, customerId: value, systemId: "", workNumberId: "" })}>
                <SelectTrigger>
                  <SelectValue placeholder="顧客を選択" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>{customer.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-1.5">
              <Label>システム</Label>
              <Select
                value={reportForm.systemId}
                onValueChange={(value) => setReportForm((prev) => applySystemSelection(prev, value))}
                disabled={!reportForm.customerId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="システムを選択" />
                </SelectTrigger>
                <SelectContent>
                  {filteredReportSystems.map((system) => (
                    <SelectItem key={system.id} value={system.id}>{system.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>工事番号</Label>
              <Select
                value={toLookupSelectValue(reportForm.workNumberId)}
                onValueChange={(value) => {
                  setReportForm((prev) => applyWorkNumberSelection(prev, value));
                }}
                disabled={!reportForm.systemId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="工事番号を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_LOOKUP_SELECT_VALUE}>工事番号なし</SelectItem>
                  {filteredReportWorkNumbers.map((workNumber) => (
                    <SelectItem key={workNumber.id} value={workNumber.id}>{workNumber.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>作業区分</Label>
              <Select value={reportForm.workTypeId} onValueChange={(value) => setReportForm({ ...reportForm, workTypeId: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="区分を選択" />
                </SelectTrigger>
                <SelectContent>
                  {workTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>作業時間</Label>
              <Input type="number" min="0" step="0.25" value={reportForm.workTime} onChange={(e) => setReportForm({ ...reportForm, workTime: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>達成度</Label>
              <Select value={toAchievementSelectValue(reportForm.achievement)} onValueChange={(value) => setReportForm({ ...reportForm, achievement: fromAchievementSelectValue(value) })}>
                <SelectTrigger>
                  <SelectValue placeholder="達成度を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_ACHIEVEMENT_SELECT_VALUE}>達成度を選択</SelectItem>
                  {ACHIEVEMENT_OPTIONS.map((achievement) => (
                    <SelectItem key={achievement} value={achievement}>{achievement}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>作業内容</Label>
            <Textarea value={reportForm.workDescription} onChange={(e) => setReportForm({ ...reportForm, workDescription: e.target.value })} rows={4} />
          </div>
          {reportSubmitError && <p className="text-sm text-destructive">登録できませんでした: {reportSubmitError}</p>}
        </div>
      </FormModal>

      <FormModal
        open={planModalOpen}
        onOpenChange={(open) => {
          if (!open) closePlanModal();
        }}
        title={planEditingId ? "作業予定を編集" : "作業予定を登録"}
        description=""
        onCancel={closePlanModal}
        onSave={() => {
          void savePlan();
        }}
        saveLabel={planEditingId ? "更新" : "登録"}
        isSaving={addPlanMutation.isPending || updatePlanMutation.isPending}
        maxWidth="full"
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
                    <SelectItem key={customer.id} value={customer.id}>{customer.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-1.5">
              <Label>システム</Label>
              <Select
                value={planForm.systemId}
                onValueChange={(value) => setPlanForm((prev) => applySystemSelection(prev, value))}
                disabled={!planForm.customerId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="システムを選択" />
                </SelectTrigger>
                <SelectContent>
                  {filteredPlanSystems.map((system) => (
                    <SelectItem key={system.id} value={system.id}>{system.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>工事番号</Label>
              <Select
                value={toLookupSelectValue(planForm.workNumberId)}
                onValueChange={(value) => {
                  setPlanForm((prev) => applyWorkNumberSelection(prev, value));
                }}
                disabled={!planForm.systemId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="工事番号を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_LOOKUP_SELECT_VALUE}>工事番号なし</SelectItem>
                  {filteredPlanWorkNumbers.map((workNumber) => (
                    <SelectItem key={workNumber.id} value={workNumber.id}>{workNumber.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>作業区分</Label>
              <Select value={planForm.workTypeId} onValueChange={(value) => setPlanForm({ ...planForm, workTypeId: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="区分を選択" />
                </SelectTrigger>
                <SelectContent>
                  {workTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>予定作業時間 (h)</Label>
              <Input type="number" min="0" step="0.25" value={planForm.plannedHours} onChange={(e) => setPlanForm({ ...planForm, plannedHours: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>作業内容</Label>
            <Textarea value={planForm.workDescription} onChange={(e) => setPlanForm({ ...planForm, workDescription: e.target.value })} rows={4} />
          </div>
          {planSubmitError && <p className="text-sm text-destructive">登録できませんでした: {planSubmitError}</p>}
        </div>
      </FormModal>

      <FormModal
        open={workDayModalOpen}
        onOpenChange={(open) => {
          if (!open) closeWorkDayModal();
        }}
        title={workDayId ? "本日の業務を編集" : "本日の業務を登録"}
        description=""
        onCancel={closeWorkDayModal}
        onSave={() => {
          void saveWorkDay();
        }}
        saveLabel={workDayId ? "更新" : "登録"}
        isSaving={addWorkDayMutation.isPending || updateWorkDayMutation.isPending}
        maxWidth="full"
      >
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>今日の実績</Label>
              <Input type="date" value={workDayForm.workDate} readOnly />
            </div>
            <div className="space-y-1.5">
              <Label>休憩時間</Label>
              <Input type="number" min="0" step="0.25" value={workDayForm.breakHours} onChange={(e) => setWorkDayForm({ ...workDayForm, breakHours: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>開始時刻</Label>
              <Input type="time" value={workDayForm.workStartTime} onChange={(e) => setWorkDayForm({ ...workDayForm, workStartTime: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>終了時刻</Label>
              <Input type="time" value={workDayForm.workEndTime} onChange={(e) => setWorkDayForm({ ...workDayForm, workEndTime: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>本日のひとこと</Label>
            <Textarea value={workDayForm.todayNote} onChange={(e) => setWorkDayForm({ ...workDayForm, todayNote: e.target.value })} rows={4} />
          </div>
          {workDaySubmitError && <p className="text-sm text-destructive">登録できませんでした: {workDaySubmitError}</p>}
        </div>
      </FormModal>

      <ConfirmDialog
        open={publishConfirmOpen}
        onOpenChange={setPublishConfirmOpen}
        title="Teams に発報しますか？"
        description={`作業実績 ${reports.length} 件、次回予定 ${publishPlans.length} 件を Teams に送信します。`}
        confirmLabel={publishing ? "送信中..." : "発報する"}
        cancelLabel="キャンセル"
        onConfirm={() => {
          void handlePublish();
        }}
      />

      <ConfirmDialog
        open={reportDeleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setReportDeleteTargetId(null);
        }}
        title="作業実績を削除しますか？"
        description="この作業実績を一覧から削除します。元に戻せません。"
        confirmLabel={deleteReportMutation.isPending ? "削除中..." : "削除する"}
        cancelLabel="キャンセル"
        variant="destructive"
        onConfirm={() => {
          if (!reportDeleteTargetId) return;
          deleteReportMutation.mutate(reportDeleteTargetId);
          setReportDeleteTargetId(null);
        }}
      />

      <ConfirmDialog
        open={planDeleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setPlanDeleteTargetId(null);
        }}
        title="作業予定を削除しますか？"
        description="この作業予定を一覧から削除します。元に戻せません。"
        confirmLabel={deletePlanMutation.isPending ? "削除中..." : "削除する"}
        cancelLabel="キャンセル"
        variant="destructive"
        onConfirm={() => {
          if (!planDeleteTargetId) return;
          deletePlanMutation.mutate(planDeleteTargetId);
          setPlanDeleteTargetId(null);
        }}
      />
    </div>
  );
}
