export type WorkReport = {
  id: string;
  reportDate: string;
  customerId: string;
  customerName: string;
  systemId: string;
  systemName: string;
  workTypeId: string;
  workTypeName: string;
  workDescription: string;
  workTime: number;
  userName: string;
};

const STORAGE_KEY = "dailyWorkReports";

const DEFAULT_REPORTS: WorkReport[] = generateDefaultReports();

function formatDate(date: Date) {
  return date.toISOString().split("T")[0];
}

function generateDefaultReports(): WorkReport[] {
  const users = [
    "山田 太郎",
    "佐藤 花子",
    "鈴木 一郎",
    "高橋 美咲",
    "伊藤 健",
    "渡辺 香織",
    "中村 翼",
    "小林 愛",
    "加藤 大輔",
    "吉田 裕子",
  ];

  const customers = [
    { id: "1", name: "ABC 株式会社" },
    { id: "2", name: "XYZ 工業" },
    { id: "3", name: "テックス合同会社" },
    { id: "4", name: "グリーンソリューションズ" },
    { id: "5", name: "オフィスリンク" },
    { id: "6", name: "スマート物流" },
    { id: "7", name: "イノベイトワークス" },
    { id: "8", name: "プレミアムファクトリー" },
    { id: "9", name: "シルバーベル社" },
    { id: "10", name: "クリエイトウェブ" },
  ];

  const systems = [
    { id: "1", name: "システムA", customerId: "1" },
    { id: "2", name: "システムB", customerId: "1" },
    { id: "3", name: "システムC", customerId: "2" },
    { id: "4", name: "システムD", customerId: "3" },
    { id: "5", name: "営業支援システム", customerId: "2" },
    { id: "6", name: "受注管理システム", customerId: "4" },
    { id: "7", name: "倉庫管理システム", customerId: "6" },
    { id: "8", name: "勤怠連携システム", customerId: "5" },
    { id: "9", name: "経費精算システム", customerId: "7" },
    { id: "10", name: "CRMプラットフォーム", customerId: "8" },
    { id: "11", name: "内部ポータル", customerId: "1" },
    { id: "12", name: "サービス監視システム", customerId: "3" },
    { id: "13", name: "販売管理システム", customerId: "9" },
    { id: "14", name: "サポートデスク", customerId: "10" },
  ];

  const workTypes = [
    { id: "1", name: "開発" },
    { id: "2", name: "保守" },
    { id: "3", name: "運用" },
    { id: "4", name: "テスト" },
  ];

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 90);

  const reports: WorkReport[] = [];
  let counter = 1;

  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    const reportDate = formatDate(new Date(date));
    users.forEach((user, userIndex) => {
      const customer = customers[userIndex % customers.length];
      const system = systems[(userIndex + Math.floor((date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))) % systems.length];
      const workType = workTypes[(userIndex + date.getDate()) % workTypes.length];
      const description = `${customer.name} 向け ${system.name} の ${workType.name} 作業。日次対応として 7.5h 稼働。`;

      reports.push({
        id: `${reportDate}-${userIndex + 1}`,
        reportDate,
        customerId: customer.id,
        customerName: customer.name,
        systemId: system.id,
        systemName: system.name,
        workTypeId: workType.id,
        workTypeName: workType.name,
        workDescription: description,
        workTime: 7.5,
        userName: user,
      });
      counter += 1;
    });
  }

  return reports;
}

const isBrowser = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

function parseReports(value: string | null): WorkReport[] {
  if (!value) return DEFAULT_REPORTS;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        ...item,
        workTime: Number(item.workTime) || 0,
      })) as WorkReport[];
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_REPORTS;
}

export function getReports(): WorkReport[] {
  if (!isBrowser) return DEFAULT_REPORTS;
  return parseReports(window.localStorage.getItem(STORAGE_KEY));
}

export function saveReports(reports: WorkReport[]): WorkReport[] {
  if (isBrowser) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  }
  return reports;
}

export function addReport(report: WorkReport): WorkReport[] {
  const reports = getReports();
  const next = [...reports, report];
  saveReports(next);
  return next;
}

export function updateReport(report: WorkReport): WorkReport[] {
  const reports = getReports().map((item) => (item.id === report.id ? report : item));
  saveReports(reports);
  return reports;
}

export function deleteReport(id: string): WorkReport[] {
  const reports = getReports().filter((item) => item.id !== id);
  saveReports(reports);
  return reports;
}
