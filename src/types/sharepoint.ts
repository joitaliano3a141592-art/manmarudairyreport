/**
 * SharePoint List データ型定義
 */

// ---------- SharePoint fields (raw) ----------

export type SPCustomerFields = {
  Title: string;
};

export type SPSystemFields = {
  Title: string;
  CustomerLookupId?: number;
  Description?: string;
};

export type SPWorkTypeFields = {
  Title: string;
  Category?: string;
};

export type SPReportFields = {
  Title: string;
  ReportDate?: string;
  CustomerLookupId?: number;
  SystemLookupId?: number;
  WorkTypeLookupId?: number;
  WorkDescription?: string;
  WorkHours?: number;
  ReporterLookupId?: number;
  ReporterName?: string;
  IsProject?: boolean;
};

export type SPPlanFields = {
  Title: string;
  PlanDate?: string;
  CustomerLookupId?: number;
  SystemLookupId?: number;
  WorkDescription?: string;
  AssigneeLookupId?: number;
  AssigneeName?: string;
};

// ---------- App-level types (resolved) ----------

export type Customer = {
  id: string;
  name: string;
};

export type System = {
  id: string;
  name: string;
  customerId: string;
  customerName: string;
  description: string;
};

export type WorkType = {
  id: string;
  name: string;
  category: string;
};

export type WorkReport = {
  id: string;
  title: string;
  reportDate: string;
  customerId: string;
  customerName: string;
  systemId: string;
  systemName: string;
  workTypeId: string;
  workTypeName: string;
  workDescription: string;
  workHours: number;
  userName: string;
  isProject: boolean;
};

export type WorkPlan = {
  id: string;
  title: string;
  planDate: string;
  customerId: string;
  customerName: string;
  systemId: string;
  systemName: string;
  workDescription: string;
  userName: string;
};
