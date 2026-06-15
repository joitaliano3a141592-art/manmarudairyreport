/**
 * SharePoint List データ型定義
 */

// ---------- SharePoint fields (raw) ----------

export type SPCustomerFields = {
  Title: string;
  SortOrder?: number;
};

export type SPSystemFields = {
  Title: string;
  CustomerLookupId?: number;
  Description?: string;
  SortOrder?: number;
};

export type SPWorkTypeFields = {
  Title: string;
  Category?: string;
  SortOrder?: number;
};

export type SPReportFields = {
  Title: string;
  ReportDate?: string;
  RegistrationDate?: string;
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
  WorkTypeLookupId?: number;
  WorkDescription?: string;
  PlannedHours?: number;
  IsProject?: boolean;
  AssigneeLookupId?: number;
  AssigneeName?: string;
};

// ---------- App-level types (resolved) ----------

export type Customer = {
  id: string;
  name: string;
  sortOrder: number;
};

export type System = {
  id: string;
  name: string;
  customerId: string;
  customerName: string;
  description: string;
  sortOrder: number;
};

export type WorkType = {
  id: string;
  name: string;
  category: string;
  sortOrder: number;
};

export type WorkReport = {
  id: string;
  title: string;
  reportDate: string;
  registrationDate: string;
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
  workTypeId: string;
  workTypeName: string;
  workDescription: string;
  plannedHours: number;
  isProject: boolean;
  userName: string;
};
