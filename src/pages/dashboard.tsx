import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DataErrorState } from "@/components/data-error-state";
import { Download, ChevronDown, ChevronUp } from "lucide-react";
import { useReports } from "@/hooks/use-sharepoint";
import type { WorkReport } from "@/types/sharepoint";

const toCsvValue = (value: string | number) => String(value).replace(/\"/g, '""');

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function DashboardPage() {
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [endDate, setEndDate] = useState(() => toLocalDateString(new Date()));
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);

  const { data: reports = [], isLoading, isError, error } = useReports(startDate, endDate);

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

  const customerBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filteredReports.forEach((report: WorkReport) => {
      map.set(report.customerName, (map.get(report.customerName) || 0) + report.workHours);
    });
    return Array.from(map.entries()).map(([customer, hours]) => ({ customer, hours }));
  }, [filteredReports]);

  const userColors = useMemo(() => {
    const users = Array.from(new Set(filteredReports.map((r: WorkReport) => r.userName)));
    return new Map(users.map((user, index) => [user, chartColors[index % chartColors.length]]));
  }, [filteredReports]);

  const systemStackData = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    filteredReports.forEach((report: WorkReport) => {
      const system = report.systemName || "(未設定)";
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

  const pieGradient = useMemo(() => {
    if (totalHours <= 0 || customerBreakdown.length === 0) {
      return "hsl(0 0% 92%)";
    }
    let start = 0;
    return `conic-gradient(${customerBreakdown
      .map((item, index) => {
        const percent = (item.hours / totalHours) * 100;
        const end = start + percent;
        const color = chartColors[index % chartColors.length];
        const segment = `${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
        start = end;
        return segment;
      })
      .join(", ")})`;
  }, [customerBreakdown, totalHours]);

  const downloadCsv = () => {
    const headers = ["報告日", "ユーザー", "顧客", "システム", "作業内容", "区分", "作業時間"];
    const rows = filteredReports.map((report: WorkReport) => [
      report.reportDate,
      report.userName,
      report.customerName,
      report.systemName,
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

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">SharePoint からデータを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return <DataErrorState title="ダッシュボードデータを取得できませんでした" error={error} />;
  }

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6 flex flex-col gap-2">
        <div>
          <h1 className="text-3xl font-bold">作業実績ダッシュボード</h1>
        </div>
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
          <CardContent className="p-4 text-sm">
            <div className="grid gap-4">
              <div className="space-y-2">
                <div className="font-medium">日付範囲</div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <Input className="h-9 min-w-0" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  <span className="text-sm text-muted-foreground">〜</span>
                  <Input className="h-9 min-w-0" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <div className="font-medium">ユーザー</div>
                  <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
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
              <div className="space-y-2">
                <div className="font-medium">顧客</div>
                <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
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
        <Card className="flex flex-col lg:h-[36rem]">
          <CardHeader>
            <CardTitle>顧客別 作業時間割合</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto">
            <div className="flex flex-col items-center gap-4 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
              <div
                className="h-64 w-64 rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950"
                style={{ background: pieGradient }}
              />
              <div className="w-full space-y-2">
                {customerBreakdown.map((item, index) => {
                  const percent = totalHours > 0 ? (item.hours / totalHours) * 100 : 0;
                  return (
                    <div key={item.customer} className="flex items-center gap-3">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: chartColors[index % chartColors.length] }}
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="font-medium">{item.customer}</div>
                        <div className="text-muted-foreground text-xs">
                          {item.hours.toFixed(1)}h / {percent.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col lg:h-[36rem]">
          <CardHeader>
            <CardTitle>システム ユーザー別作業時間</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 space-y-4 overflow-y-auto">
            {systemStackData.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground">フィルタ結果にデータがありません</div>
            ) : (
              <div className="space-y-4">
                {systemStackData.map((systemItem) => (
                  <div key={systemItem.system} className="space-y-2">
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span>{systemItem.system}</span>
                      <span>{systemItem.total.toFixed(1)}h</span>
                    </div>
                    <div className="h-8 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                      <div className="flex h-full">
                        {systemItem.users.map((userItem) => {
                          const width = systemItem.total > 0 ? (userItem.hours / systemItem.total) * 100 : 0;
                          return (
                            <div
                              key={`${systemItem.system}-${userItem.user}`}
                              className="h-full"
                              style={{
                                width: `${width}%`,
                                backgroundColor: userColors.get(userItem.user) ?? "#CBD5E1",
                              }}
                              title={`${userItem.user}: ${userItem.hours.toFixed(1)}h`}
                            />
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {systemItem.users.map((userItem) => (
                        <span key={`${systemItem.system}-label-${userItem.user}`} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: userColors.get(userItem.user) ?? "#CBD5E1" }}
                          />
                          {userItem.user} {userItem.hours.toFixed(1)}h
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReports.map((report: WorkReport) => (
                <TableRow key={report.id}>
                  <TableCell>{report.reportDate}</TableCell>
                  <TableCell>{report.userName}</TableCell>
                  <TableCell>{report.customerName}</TableCell>
                  <TableCell>{report.systemName}</TableCell>
                  <TableCell className="max-w-xs truncate" title={report.workDescription}>
                    {report.workDescription}
                  </TableCell>
                  <TableCell>{report.workTypeName}</TableCell>
                  <TableCell>{report.workHours.toFixed(1)}h</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
