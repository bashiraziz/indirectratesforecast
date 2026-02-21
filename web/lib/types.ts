export interface FiscalYear {
  id: number;
  name: string;
  start_month: string;
  end_month: string;
  created_at: string;
}

export interface RateGroup {
  id: number;
  fiscal_year_id: number;
  name: string;
  display_order: number;
}

export interface PoolGroup {
  id: number;
  fiscal_year_id: number;
  rate_group_id: number | null;
  name: string;
  base: string;
  display_order: number;
  cascade_order: number;
}

export interface Pool {
  id: number;
  pool_group_id: number;
  name: string;
  display_order: number;
}

export interface GLMapping {
  id: number;
  pool_id: number;
  account: string;
  is_unallowable: number;
  notes: string;
}

export interface ReferenceRate {
  id: number;
  fiscal_year_id: number;
  rate_type: string;
  pool_group_name: string;
  period: string;
  rate_value: number;
}

export interface RevenueRow {
  id: number;
  fiscal_year_id: number;
  period: string;
  project: string;
  revenue: number;
}

export interface CostCategory {
  id: number;
  fiscal_year_id: number;
  category_type: string;
  category_name: string;
  gl_account: string;
  is_direct: number;
}

export interface ChartAccount {
  id: number;
  fiscal_year_id: number;
  account: string;
  name: string;
  category: string;
}

export interface BaseAccount {
  id: number;
  pool_group_id: number;
  account: string;
  notes: string;
}
