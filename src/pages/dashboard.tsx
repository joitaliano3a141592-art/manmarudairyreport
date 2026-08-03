import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DataErrorState } from "@/components/data-error-state";
import { Download, ChevronDown, ChevronUp, Medal, ExternalLink } from "lucide-react";
import { useCustomers, useReports, useWorkNumbers } from "@/hooks/use-sharepoint";
import type { WorkReport } from "@/types/sharepoint";
import { formatWorkHours } from "@/lib/utils";

const toCsvValue = (value: string | number) => String(value).replace(/\"/g, '""');

type CustomerPieSlice = {
  label: string;
  hours: number;
  percent: number;
  color: string;
  startAngle: number;
  endAngle: number;
};

type PieTooltipState = {
  label: string;
  hours: number;
  percent: number;
  color: string;
  x: number;
  y: number;
};

type BarTooltipState = {
  label: string;
  hours: number;
  x: number;
  y: number;
};

type PieGroupBy = "customer" | "workType" | "project";
type DatePreset = "thisYear" | "lastMonth" | "thisMonth" | "lastWeek" | "thisWeek";

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getStartOfWeekMonday(date: Date): Date {
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = current.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  current.setDate(current.getDate() + diff);
  return current;
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function buildPieSlicePath(startAngle: number, endAngle: number) {
  const start = polarToCartesian(50, 50, 50, endAngle);
  const end = polarToCartesian(50, 50, 50, startAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M 50 50`,
    `L ${start.x} ${start.y}`,
    `A 50 50 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function getWikipediaDayTitle(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function getWikipediaPageUrl(date: Date) {
  return `https://ja.wikipedia.org/wiki/${encodeURIComponent(getWikipediaDayTitle(date))}`;
}

function getWikipediaSectionListApiUrl(date: Date) {
  const title = getWikipediaDayTitle(date);
  return `https://ja.wikipedia.org/w/api.php?action=parse&format=json&prop=sections&redirects=1&origin=*&page=${encodeURIComponent(title)}`;
}

function getWikipediaSectionTextApiUrl(date: Date, sectionIndex: string) {
  const title = getWikipediaDayTitle(date);
  return `https://ja.wikipedia.org/w/api.php?action=parse&format=json&prop=text&redirects=1&origin=*&page=${encodeURIComponent(title)}&section=${encodeURIComponent(sectionIndex)}`;
}

function buildWikipediaAiOverview(dateTitle: string, summary: string | null) {
  if (!summary) {
    return `${dateTitle}の出来事を要約できませんでした。詳しい内容については、${dateTitle} - Wikipedia をご覧ください。`;
  }

  const cleaned = summary.replace(/\s+/g, " ").trim();
  return `${cleaned}\n\n詳しい内容については、${dateTitle} - Wikipedia をご覧ください。`;
}

function normalizeSectionTitle(title: string) {
  return title.replace(/\s+/g, "").replace(/（.*?）/g, "");
}

function normalizeLabelText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s*[（(].*?[)）]\s*$/, "")
    .trim();
}

function extractSectionBullets(sectionHtml: string) {
  const parser = new DOMParser();
  const document = parser.parseFromString(sectionHtml, "text/html");
  return Array.from(document.querySelectorAll("li"))
    .map((item) => item.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean)
    .slice(0, 3);
}

function selectJapaneseCommemorativeLabel(items: string[]) {
  const preferredRaw = items.find((item) => {
    return (item.includes("日本の旗") || item.includes("日本")) && !item.includes("英語版");
  });
  if (preferredRaw) {
    return normalizeLabelText(preferredRaw);
  }

  const commemorativeRaw = items.find((item) => /の日/.test(item) && !item.includes("英語版"));
  if (commemorativeRaw) {
    return normalizeLabelText(commemorativeRaw);
  }

  const normalizedItems = items.map(normalizeLabelText).filter(Boolean);
  return normalizedItems[0] ?? null;
}

function extractEventSummaryFromSectionHtml(sectionHtml: string) {
  const items = extractSectionBullets(sectionHtml);

  if (items.length > 0) {
    return {
      highlight: items[0],
      summary: `主な出来事として、${items.join("、")}などがあります。`,
    };
  }

  const text = document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return text
    ? {
        highlight: null,
        summary: text,
      }
    : null;
}

export default function DashboardPage() {
  const today = useMemo(() => new Date(), []);
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [endDate, setEndDate] = useState(() => toLocalDateString(new Date()));
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [projectOnly, setProjectOnly] = useState(false);
  const [pieTooltip, setPieTooltip] = useState<PieTooltipState | null>(null);
  const [barTooltip, setBarTooltip] = useState<BarTooltipState | null>(null);
  const [pieGroupBy, setPieGroupBy] = useState<PieGroupBy>("customer");
  const [activeDatePreset, setActiveDatePreset] = useState<DatePreset | null>("thisMonth");
  const [wikipediaSummary, setWikipediaSummary] = useState<string | null>(null);
  const [wikipediaHighlight, setWikipediaHighlight] = useState<string | null>(null);
  const [wikipediaLoading, setWikipediaLoading] = useState(true);
  const [wikipediaError, setWikipediaError] = useState<string | null>(null);

  const { data: customers = [] } = useCustomers();
  const { data: reports = [], isLoading, isError, error } = useReports(startDate, endDate);
  const {
    data: workNumbers = [],
    isLoading: workNumbersLoading,
    isError: workNumbersErrorState,
    error: workNumbersError,
  } = useWorkNumbers();

  const workNumberSystemNameMap = useMemo(
    () => new Map(workNumbers.map((workNumber) => [workNumber.id, workNumber.systemName])),
    [workNumbers],
  );
  const customerNameMap = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  );
  const wikipediaDayTitle = useMemo(() => getWikipediaDayTitle(today), [today]);
  const wikipediaPageUrl = useMemo(() => getWikipediaPageUrl(today), [today]);
  const wikipediaSectionListApiUrl = useMemo(() => getWikipediaSectionListApiUrl(today), [today]);
  const wikipediaAiOverview = useMemo(
    () => buildWikipediaAiOverview(wikipediaDayTitle, wikipediaSummary),
    [wikipediaDayTitle, wikipediaSummary],
  );
  const workNumberNameMap = useMemo(
    () => new Map(workNumbers.map((workNumber) => [workNumber.id, workNumber.displayName])),
    [workNumbers],
  );

  const resolveSystemAggregationName = (report: WorkReport): string => {
    return report.systemName || workNumberSystemNameMap.get(report.workNumberId) || report.workNumber || "(未設定)";
  };

  const resolveSystemTableDisplayName = (report: WorkReport): string => {
    return report.systemName || workNumberNameMap.get(report.workNumberId) || report.workNumber || "(未設定)";
  };
  const resolveCustomerTableDisplayName = (report: WorkReport): string => {
    return customerNameMap.get(report.customerId) || report.customerName || "(未設定)";
  };
  const resolveCustomerCsvDisplayName = (report: WorkReport): string => {
    const resolved = customerNameMap.get(report.customerId);
    if (resolved) {
      return resolved;
    }
    const fallback = report.customerName || "";
    const separatorIndex = fallback.indexOf("：");
    if (separatorIndex <= 0) {
      return fallback || "(未設定)";
    }
    const prefix = fallback.slice(0, separatorIndex).trim();
    const suffix = fallback.slice(separatorIndex + 1).trim();
    return /^\d+$/.test(prefix) && suffix ? suffix : fallback;
  };

  useEffect(() => {
    const controller = new AbortController();

    const loadWikipediaSummary = async () => {
      setWikipediaLoading(true);
      setWikipediaError(null);
      try {
        const sectionsResponse = await fetch(wikipediaSectionListApiUrl, { signal: controller.signal });
        if (!sectionsResponse.ok) {
          throw new Error(`Wikipedia API request failed with ${sectionsResponse.status}`);
        }

        const sectionsData = (await sectionsResponse.json()) as {
          parse?: {
            sections?: Array<{ index: string; line: string }>;
          };
        };

        const eventSection = sectionsData.parse?.sections?.find((section) => {
          const title = normalizeSectionTitle(section.line);
          return title.includes("できごと") || title.includes("出来事") || title.includes("主な出来事");
        });
        const commemorativeSection = sectionsData.parse?.sections?.find((section) => {
          const title = normalizeSectionTitle(section.line);
          return title.includes("記念日") || title.includes("年中行事");
        });

        if (!eventSection) {
          throw new Error("Event section not found");
        }

        let nextHighlight: string | null = null;
        if (commemorativeSection) {
          const commemorativeResponse = await fetch(
            getWikipediaSectionTextApiUrl(today, commemorativeSection.index),
            { signal: controller.signal },
          );
          if (commemorativeResponse.ok) {
            const commemorativeData = (await commemorativeResponse.json()) as {
              parse?: {
                text?: { "*": string };
              };
            };
            const commemorativeHtml = commemorativeData.parse?.text?.["*"] ?? "";
            nextHighlight = selectJapaneseCommemorativeLabel(extractSectionBullets(commemorativeHtml));
          }
        }

        const sectionResponse = await fetch(getWikipediaSectionTextApiUrl(today, eventSection.index), {
          signal: controller.signal,
        });
        if (!sectionResponse.ok) {
          throw new Error(`Wikipedia section request failed with ${sectionResponse.status}`);
        }

        const sectionData = (await sectionResponse.json()) as {
          parse?: {
            text?: { "*": string };
          };
        };

        const sectionHtml = sectionData.parse?.text?.["*"] ?? "";
        const result = extractEventSummaryFromSectionHtml(sectionHtml);
        setWikipediaSummary(result?.summary ?? null);
        setWikipediaHighlight(nextHighlight ?? result?.highlight ?? null);
      } catch (error) {
        if (!controller.signal.aborted) {
          setWikipediaError(error instanceof Error ? error.message : "Wikipedia API request failed");
          setWikipediaSummary(null);
          setWikipediaHighlight(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setWikipediaLoading(false);
        }
      }
    };

    void loadWikipediaSummary();
    return () => controller.abort();
  }, [today, wikipediaSectionListApiUrl]);

  const setDatePreset = (preset: DatePreset) => {
    const today = new Date();
    let nextStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let nextEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    switch (preset) {
      case "thisYear":
        nextStart = new Date(today.getFullYear(), 0, 1);
        break;
      case "lastMonth":
        nextStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        nextEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case "thisMonth":
        nextStart = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case "lastWeek": {
        const thisWeekStart = getStartOfWeekMonday(today);
        nextStart = new Date(thisWeekStart);
        nextStart.setDate(nextStart.getDate() - 7);
        nextEnd = new Date(thisWeekStart);
        nextEnd.setDate(nextEnd.getDate() - 1);
        break;
      }
      case "thisWeek":
        nextStart = getStartOfWeekMonday(today);
        break;
    }

    setStartDate(toLocalDateString(nextStart));
    setEndDate(toLocalDateString(nextEnd));
    setActiveDatePreset(preset);
  };

  const uniqueUsers = useMemo(
    () => Array.from(new Set(reports.map((report) => report.userName))),
    [reports],
  );

  const uniqueCustomers = useMemo(
    () => Array.from(new Set(reports.map((report) => report.customerName))),
    [reports],
  );

  const filteredReports = useMemo(() => {
    return reports.filter((report: WorkReport) => {
      const isUserMatch = selectedUsers.length === 0 || selectedUsers.includes(report.userName);
      const isCustomerMatch = selectedCustomers.length === 0 || selectedCustomers.includes(report.customerName);
      const isProjectMatch = !projectOnly || report.isProject;
      return isUserMatch && isCustomerMatch && isProjectMatch;
    });
  }, [reports, selectedUsers, selectedCustomers, projectOnly]);

  const reportsWithoutProjectFilter = useMemo(() => {
    return reports.filter((report: WorkReport) => {
      const isUserMatch = selectedUsers.length === 0 || selectedUsers.includes(report.userName);
      const isCustomerMatch = selectedCustomers.length === 0 || selectedCustomers.includes(report.customerName);
      return isUserMatch && isCustomerMatch;
    });
  }, [reports, selectedUsers, selectedCustomers]);

  const totalHours = useMemo(
    () => filteredReports.reduce((sum: number, r: WorkReport) => sum + r.workHours, 0),
    [filteredReports],
  );

  const chartColors = [
    "#0EA5E9",
    "#22C55E",
    "#F97316",
    "#A855F7",
    "#F43F5E",
    "#EAB308",
  ];

  const pieBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filteredReports.forEach((report: WorkReport) => {
      const label = pieGroupBy === "customer"
        ? (report.customerName || "(未設定)")
        : (report.workTypeName || "(未設定)");
      map.set(label, (map.get(label) || 0) + report.workHours);
    });
    return Array.from(map.entries())
      .map(([label, hours]) => ({ label, hours }))
      .sort((a, b) => b.hours - a.hours);
  }, [filteredReports, pieGroupBy]);

  const customerPieSlices = useMemo(() => {
    if (totalHours <= 0 || pieBreakdown.length === 0) {
      return [] as CustomerPieSlice[];
    }

    let currentAngle = 0;
    return pieBreakdown.map((item, index) => {
      const percent = (item.hours / totalHours) * 100;
      const angleSpan = (percent / 100) * 360;
      const slice: CustomerPieSlice = {
        label: item.label,
        hours: item.hours,
        percent,
        color: chartColors[index % chartColors.length],
        startAngle: currentAngle,
        endAngle: currentAngle + angleSpan,
      };
      currentAngle += angleSpan;
      return slice;
    });
  }, [chartColors, pieBreakdown, totalHours]);

  const projectRatioTotalHours = useMemo(
    () => reportsWithoutProjectFilter.reduce((sum: number, r: WorkReport) => sum + r.workHours, 0),
    [reportsWithoutProjectFilter],
  );

  const projectRatioBreakdown = useMemo(() => {
    const map = new Map<string, number>();

    reportsWithoutProjectFilter.forEach((report: WorkReport) => {
      let label = "";
      if (report.isProject) {
        label = "案件";
      } else {
        label = report.customerName || "社内事";
      }
      map.set(label, (map.get(label) || 0) + report.workHours);
    });

    return Array.from(map.entries())
      .map(([label, hours]) => ({
        label,
        hours,
        color: label === "案件" ? "#0EA5E9" : "" // 後で動的に割り当てるか、固定色を使う
      }))
      .sort((a, b) => {
        // "案件"を一番上に、それ以外を時間順にする
        if (a.label === "案件") return -1;
        if (b.label === "案件") return 1;
        return b.hours - a.hours;
      });
  }, [reportsWithoutProjectFilter]);

  const projectRatioPieSlices = useMemo(() => {
    if (projectRatioTotalHours <= 0) {
      return [] as CustomerPieSlice[];
    }

    let currentAngle = 0;
    return projectRatioBreakdown.map((item, index) => {
      const percent = (item.hours / projectRatioTotalHours) * 100;
      const angleSpan = (percent / 100) * 360;
      
      // 案件以外は chartColors から割り当て（案件と色が被らないように調整）
      const color = item.label === "案件" 
        ? "#0EA5E9" 
        : chartColors[(index + 2) % chartColors.length]; // +2して案件色(#0EA5E9)との重複を避ける

      const slice: CustomerPieSlice = {
        label: item.label,
        hours: item.hours,
        percent,
        color: color,
        startAngle: currentAngle,
        endAngle: currentAngle + angleSpan,
      };
      currentAngle += angleSpan;
      return slice;
    });
  }, [chartColors, projectRatioBreakdown, projectRatioTotalHours]);

  const activePieTitle = pieGroupBy === "customer"
    ? "顧客別 作業時間割合"
    : pieGroupBy === "workType"
      ? "作業別 作業時間割合"
      : "案件別 作業時間割合";

  const activePieTotalHours = pieGroupBy === "project" ? projectRatioTotalHours : totalHours;
  const activePieBreakdown = pieGroupBy === "project" ? projectRatioBreakdown : pieBreakdown;
  const activePieSlices = pieGroupBy === "project" ? projectRatioPieSlices : customerPieSlices;

  const userColors = useMemo(() => {
    const users = Array.from(new Set(filteredReports.map((r: WorkReport) => r.userName)));
    return new Map(users.map((user, index) => [user, chartColors[index % chartColors.length]]));
  }, [filteredReports]);

  const systemStackData = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    filteredReports.forEach((report: WorkReport) => {
      const system = resolveSystemAggregationName(report);
      if (!map.has(system)) {
        map.set(system, new Map());
      }
      const userMap = map.get(system)!;
      userMap.set(report.userName, (userMap.get(report.userName) || 0) + report.workHours);
    });
    return Array.from(map.entries())
      .map(([system, userMap]) => ({
        system,
        total: Array.from(userMap.values()).reduce((sum, value) => sum + value, 0),
        users: Array.from(userMap.entries()).map(([user, hours]) => ({ user, hours })),
      }))
      .sort((a, b) => b.total - a.total);
  }, [filteredReports]);

  const systemMaxTotal = useMemo(
    () => systemStackData.reduce((max, item) => Math.max(max, item.total), 0),
    [systemStackData],
  );

  const systemChartUsers = useMemo(() => {
    const users = new Set<string>();
    systemStackData.forEach((item) => {
      item.users.forEach((userItem) => users.add(userItem.user));
    });
    return Array.from(users);
  }, [systemStackData]);

  const systemTopBottomLists = useMemo(() => {
    const top = systemStackData.slice(0, 5);
    const worst = [...systemStackData].sort((a, b) => a.total - b.total).slice(0, 5);
    return { top, worst };
  }, [systemStackData]);

  const systemChartLayout = useMemo(() => {
    const width = 760;
    const height = 260;
    const margin = { top: 10, right: 10, bottom: 52, left: 36 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const count = systemStackData.length;

    if (count === 0) {
      return { width, height, margin, plotWidth, plotHeight, bars: [], labelStep: 1 };
    }

    const gap = Math.max(1, Math.min(4, Math.floor(plotWidth / (count * 10))));
    const barWidth = Math.max(2, (plotWidth - gap * (count - 1)) / count);
    const labelStep = Math.max(1, Math.ceil(count / 8));

    const bars = systemStackData.map((item, index) => {
      const x = margin.left + index * (barWidth + gap);
      const userHoursMap = new Map(item.users.map((userItem) => [userItem.user, userItem.hours]));
      let accumulated = 0;
      const segments = systemChartUsers.flatMap((user) => {
        const userHours = userHoursMap.get(user) || 0;
        if (userHours <= 0 || systemMaxTotal <= 0) {
          return [] as Array<{ user: string; y: number; h: number; color: string; hours: number }>;
        }
        const h = (userHours / systemMaxTotal) * plotHeight;
        const y = margin.top + plotHeight - accumulated - h;
        accumulated += h;
        return [{
          user,
          y,
          h,
          color: userColors.get(user) ?? "#CBD5E1",
          hours: userHours,
        }];
      });

      return {
        system: item.system,
        total: item.total,
        x,
        barWidth,
        segments,
      };
    });

    return { width, height, margin, plotWidth, plotHeight, bars, labelStep };
  }, [systemChartUsers, systemMaxTotal, systemStackData, userColors]);

  const systemYAxisTicks = useMemo(() => {
    const tickCount = 4;
    const maxHours = systemMaxTotal;
    return Array.from({ length: tickCount + 1 }, (_, i) => {
      const ratio = i / tickCount;
      const value = maxHours * ratio;
      const y = systemChartLayout.margin.top + systemChartLayout.plotHeight - (systemChartLayout.plotHeight * ratio);
      return {
        key: i,
        value,
        y,
      };
    });
  }, [systemChartLayout.margin.top, systemChartLayout.plotHeight, systemMaxTotal]);

  const handlePieTooltipMove = (event: React.MouseEvent<SVGPathElement>, slice: CustomerPieSlice) => {
    setPieTooltip({
      label: slice.label,
      hours: slice.hours,
      percent: slice.percent,
      color: slice.color,
      x: event.clientX + 14,
      y: event.clientY + 14,
    });
  };

  const handleBarTooltipMove = (event: React.MouseEvent<SVGRectElement>, label: string, hours: number, systemName?: string) => {
    const title = systemName ? `${systemName} / ${label}` : label;
    setBarTooltip({
      label: title,
      hours,
      x: event.clientX + 14,
      y: event.clientY + 14,
    });
  };

  const downloadCsv = () => {
    const headers = ["報告日", "ユーザー", "顧客", "システム", "作業内容", "区分", "作業時間"];
    const rows = filteredReports.map((report: WorkReport) => [
      report.reportDate,
      report.userName,
      resolveCustomerCsvDisplayName(report),
      resolveSystemAggregationName(report),
      report.workDescription,
      report.workTypeName,
      report.workHours,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${toCsvValue(value)}"`).join(","))
      .join("\r\n");
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const blob = new Blob([bom, csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workreports_${startDate}_${endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isLoading || workNumbersLoading) {
    return (
      <div className="container mx-auto py-6 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">SharePoint からデータを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (isError || workNumbersErrorState) {
    return <DataErrorState title="ダッシュボードデータを取得できませんでした" error={error ?? workNumbersError} />;
  }

  return (
    <div className="container mx-auto py-6">
      {pieTooltip && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          style={{ left: pieTooltip.x, top: pieTooltip.y }}
        >
          <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">{pieTooltip.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {pieTooltip.hours.toFixed(1)}h / {pieTooltip.percent.toFixed(1)}%
          </div>
        </div>
      )}
      {barTooltip && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          style={{ left: barTooltip.x, top: barTooltip.y }}
        >
          <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">{barTooltip.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {barTooltip.hours.toFixed(1)}h
          </div>
        </div>
      )}
      <div className="mb-6 flex flex-col gap-2">
        <div>
          <h1 className="text-3xl font-bold">作業実績ダッシュボード</h1>
        </div>
      </div>

      <Card className="mb-6 gap-0 overflow-hidden py-0">
        <CardHeader className="px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium leading-none">検索条件</div>
            <Button
              size="sm"
              className="h-8 px-3"
              variant="outline"
              onClick={(event) => {
                event.preventDefault();
                setFilterOpen((prev) => !prev);
              }}
            >
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
          <CardContent className="px-2 pb-2 pt-0 text-sm">
            <div className="grid gap-3">
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="font-medium">日付範囲</div>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <Input
                      className="h-8 min-w-0"
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        setActiveDatePreset(null);
                      }}
                    />
                    <span className="text-sm text-muted-foreground">〜</span>
                    <Input
                      className="h-8 min-w-0"
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value);
                        setActiveDatePreset(null);
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant={activeDatePreset === "thisYear" ? "default" : "outline"} className="h-8" onClick={() => setDatePreset("thisYear")}>今年</Button>
                    <Button type="button" size="sm" variant={activeDatePreset === "lastMonth" ? "default" : "outline"} className="h-8" onClick={() => setDatePreset("lastMonth")}>先月</Button>
                    <Button type="button" size="sm" variant={activeDatePreset === "thisMonth" ? "default" : "outline"} className="h-8" onClick={() => setDatePreset("thisMonth")}>今月</Button>
                    <Button type="button" size="sm" variant={activeDatePreset === "lastWeek" ? "default" : "outline"} className="h-8" onClick={() => setDatePreset("lastWeek")}>先週</Button>
                    <Button type="button" size="sm" variant={activeDatePreset === "thisWeek" ? "default" : "outline"} className="h-8" onClick={() => setDatePreset("thisWeek")}>今週</Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="font-medium">案件</div>
                  <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                    <input
                      type="checkbox"
                      checked={projectOnly}
                      onChange={(e) => setProjectOnly(e.target.checked)}
                    />
                    案件のみ表示
                  </label>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="font-medium">ユーザー</div>
                  <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto pr-1">
                  {uniqueUsers.map((user) => (
                    <label
                      key={user}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(user)}
                        onChange={(e) => {
                          setSelectedUsers((current) =>
                            e.target.checked ? [...current, user] : current.filter((value) => value !== user),
                          );
                        }}
                      />
                      {user}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="font-medium">顧客</div>
                <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto pr-1">
                  {uniqueCustomers.map((customer) => (
                    <label
                      key={customer}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCustomers.includes(customer)}
                        onChange={(e) => {
                          setSelectedCustomers((current) =>
                            e.target.checked ? [...current, customer] : current.filter((value) => value !== customer),
                          );
                        }}
                      />
                      {customer}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
        )}
      </Card>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col lg:h-[40rem]">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>{activePieTitle}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={pieGroupBy === "customer" ? "default" : "outline"}
                  onClick={(event) => {
                    event.preventDefault();
                    setPieGroupBy("customer");
                  }}
                >
                  顧客別
                </Button>
                <Button
                  size="sm"
                  variant={pieGroupBy === "workType" ? "default" : "outline"}
                  onClick={(event) => {
                    event.preventDefault();
                    setPieGroupBy("workType");
                  }}
                >
                  作業別
                </Button>
                <Button
                  size="sm"
                  variant={pieGroupBy === "project" ? "default" : "outline"}
                  onClick={(event) => {
                    event.preventDefault();
                    setPieGroupBy("project");
                  }}
                >
                  案件
                </Button>
                <Badge variant="outline">合計 {activePieTotalHours.toFixed(1)}h</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto">
            <div className="flex flex-col items-center gap-4 lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start">
              <div className="flex h-72 w-72 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950">
                {activePieSlices.length === 0 ? (
                  <div className="h-64 w-64 rounded-full bg-slate-200 dark:bg-slate-700" />
                ) : (
                  <svg viewBox="0 0 100 100" className="h-64 w-64">
                    {activePieSlices.map((slice) => (
                      slice.percent >= 100 ? (
                        <circle
                          key={slice.label}
                          cx="50"
                          cy="50"
                          r="50"
                          fill={slice.color}
                          onMouseMove={(event) => handlePieTooltipMove(event, slice)}
                          onMouseLeave={() => setPieTooltip(null)}
                        />
                      ) : (
                        <path
                          key={slice.label}
                          d={buildPieSlicePath(slice.startAngle, slice.endAngle)}
                          fill={slice.color}
                          onMouseMove={(event) => handlePieTooltipMove(event, slice)}
                          onMouseLeave={() => setPieTooltip(null)}
                        />
                      )
                    ))}
                  </svg>
                )}
              </div>
              <div className="w-full space-y-2">
                {activePieBreakdown.map((item, index) => {
                  const percent = activePieTotalHours > 0 ? (item.hours / activePieTotalHours) * 100 : 0;
                  const color = pieGroupBy === "project"
                    ? (activePieSlices.find((slice) => slice.label === item.label)?.color ?? "#CBD5E1")
                    : chartColors[index % chartColors.length];
                  return (
                    <div key={item.label} className="flex items-center gap-3">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="font-medium">{item.label}</div>
                        <div className="text-muted-foreground text-xs">
                          {item.hours.toFixed(1)}h / {percent.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {pieGroupBy === "project" && (
              <p className="mt-4 text-xs text-muted-foreground">
                ※ このグラフは「案件のみ表示」の影響を受けません。
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col lg:h-[40rem]">
          <CardHeader>
            <CardTitle>システム ユーザー別作業時間</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-3">
            {systemStackData.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground">フィルタ結果にデータがありません</div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                  <svg viewBox={`0 0 ${systemChartLayout.width} ${systemChartLayout.height}`} className="h-44 w-full">
                    {systemYAxisTicks.map((tick) => (
                      <g key={`y-tick-${tick.key}`}>
                        <line
                          x1={systemChartLayout.margin.left}
                          y1={tick.y}
                          x2={systemChartLayout.margin.left + systemChartLayout.plotWidth}
                          y2={tick.y}
                          stroke="#E2E8F0"
                          strokeWidth="1"
                        />
                        <text
                          x={systemChartLayout.margin.left - 4}
                          y={tick.y + 3}
                          textAnchor="end"
                          fontSize="8"
                          fill="#64748B"
                        >
                          {tick.value.toFixed(1)}h
                        </text>
                      </g>
                    ))}
                    <line
                      x1={systemChartLayout.margin.left}
                      y1={systemChartLayout.margin.top}
                      x2={systemChartLayout.margin.left}
                      y2={systemChartLayout.margin.top + systemChartLayout.plotHeight}
                      stroke="#94A3B8"
                      strokeWidth="1"
                    />
                    <line
                      x1={systemChartLayout.margin.left}
                      y1={systemChartLayout.margin.top + systemChartLayout.plotHeight}
                      x2={systemChartLayout.margin.left + systemChartLayout.plotWidth}
                      y2={systemChartLayout.margin.top + systemChartLayout.plotHeight}
                      stroke="#94A3B8"
                      strokeWidth="1"
                    />
                    {systemChartLayout.bars.map((bar, index) => (
                      <g key={bar.system}>
                        {bar.segments.map((segment) => (
                          <rect
                            key={`${bar.system}-${segment.user}`}
                            x={bar.x}
                            y={segment.y}
                            width={bar.barWidth}
                            height={segment.h}
                            fill={segment.color}
                            onMouseMove={(event) => handleBarTooltipMove(event, segment.user, segment.hours, bar.system)}
                            onMouseLeave={() => setBarTooltip(null)}
                          >
                            <title>{`${bar.system} / ${segment.user}: ${segment.hours.toFixed(1)}h`}</title>
                          </rect>
                        ))}
                        <text
                          x={bar.x + bar.barWidth / 2}
                          y={systemChartLayout.margin.top + systemChartLayout.plotHeight + 10}
                          textAnchor="middle"
                          fontSize="8"
                          fill="#475569"
                        >
                          {index % systemChartLayout.labelStep === 0 ? bar.system : ""}
                        </text>
                      </g>
                    ))}
                  </svg>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                  {systemChartUsers.map((user) => (
                    <span key={`legend-${user}`} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: userColors.get(user) ?? "#CBD5E1" }}
                      />
                      {user}
                    </span>
                  ))}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                    <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Top 5</div>
                    <div className="space-y-1.5">
                      {systemTopBottomLists.top.map((item, index) => {
                        const bgColors = ["bg-yellow-100/60", "bg-slate-200/60", "bg-orange-200/60", "bg-emerald-100/60", "bg-sky-100/60"];
                        const medalColors = ["text-yellow-500", "text-slate-400", "text-orange-500"];
                        return (
                          <div
                            key={`top-${item.system}`}
                            className={`flex items-center justify-between gap-3 text-sm p-1.5 rounded ${bgColors[index] || ""}`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {index < 3 && <Medal className={`shrink-0 w-4 h-4 ${medalColors[index]}`} />}
                              <span className="truncate">{item.system}</span>
                            </div>
                            <span className="shrink-0 font-medium">{formatWorkHours(item.total)}h</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <a
                    href={wikipediaPageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group block h-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <Card className="flex h-full flex-col overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-accent/10 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md dark:from-primary/15 dark:via-card dark:to-accent/15">
                      <CardContent className="flex h-full flex-col space-y-4 pt-0">
                        <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {wikipediaDayTitle}
                          </div>
                          {wikipediaHighlight && (
                            <div className="rounded-full border border-border/70 bg-background/70 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                              {wikipediaHighlight}
                            </div>
                          )}
                        </div>
                        <div className="h-36 overflow-y-auto rounded-xl border border-border/70 bg-muted/40 p-4 shadow-sm">
                          <div className="mt-2 text-sm leading-6 text-foreground">
                            {wikipediaLoading
                              ? "Wikipedia から読み込み中..."
                              : wikipediaError || wikipediaAiOverview}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm font-medium text-primary">
                          <span>クリックで Wikipedia を開く</span>
                          <ExternalLink className="h-4 w-4" />
                        </div>
                      </CardContent>
                    </Card>
                  </a>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>フィルタ結果</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={downloadCsv}>
                <Download className="w-3.5 h-3.5" /> CSV
              </Button>
              <Badge variant="outline">合計 {totalHours.toFixed(1)}h</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[28rem] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>報告日</TableHead>
                  <TableHead>ユーザー</TableHead>
                  <TableHead>顧客</TableHead>
                  <TableHead>システム</TableHead>
                  <TableHead>作業内容</TableHead>
                  <TableHead>区分</TableHead>
                  <TableHead>時間</TableHead>
                  <TableHead>案件</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReports.map((report: WorkReport) => (
                  <TableRow key={report.id}>
                    <TableCell>{report.reportDate}</TableCell>
                    <TableCell>{report.userName}</TableCell>
                    <TableCell>{resolveCustomerTableDisplayName(report)}</TableCell>
                    <TableCell>{resolveSystemTableDisplayName(report)}</TableCell>
                    <TableCell className="max-w-xs truncate" title={report.workDescription}>
                      {report.workDescription}
                    </TableCell>
                    <TableCell>{report.workTypeName}</TableCell>
                    <TableCell>{formatWorkHours(report.workHours)}h</TableCell>
                    <TableCell className="text-center">{report.isProject ? "○" : "―"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
