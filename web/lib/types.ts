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

export interface Scenario {
  id: number;
  fiscal_year_id: number;
  name: string;
  description: string;
  event_count: number;
}

export interface ScenarioEvent {
  id: number;
  scenario_id: number;
  effective_period: string;
  event_type: string;
  project: string;
  delta_direct_labor: number;
  delta_direct_labor_hrs: number;
  delta_subk: number;
  delta_odc: number;
  delta_travel: number;
  pool_deltas: Record<string, number>;
  notes: string;
}

export interface ForecastRun {
  id: number;
  fiscal_year_id: number;
  scenario: string;
  forecast_months: number;
  run_rate_months: number;
  created_at: string;
  zip_size: number;
  trigger: string;
}

export interface FYSummary {
  id: number;
  name: string;
  start_month: string;
  end_month: string;
  rate_groups: number;
  pool_groups: number;
  gl_mappings: number;
  chart_accounts: number;
  scenarios: number;
  forecast_runs: number;
  latest_run: string | null;
  reference_rates: { budget: number; provisional: number; threshold: number };
  revenue_entries: number;
}

export interface RecentRun {
  id: number;
  fiscal_year_id: number;
  fiscal_year_name: string;
  scenario: string;
  forecast_months: number;
  created_at: string;
  zip_size: number;
}

export interface DashboardSummary {
  fiscal_years: FYSummary[];
  recent_runs: RecentRun[];
}

export interface PSTRow {
  Category: string;
  Type: "Direct" | "Indirect" | "Subtotal" | "GrandTotal";
  Selected_Period: number;
  YTD: number;
  ITD: number;
  Budget: number;
  Variance: number;
}

export interface PSTData {
  categories: PSTRow[];
  periods: string[];
  selected_period: string;
}

export interface UploadedFile {
  id: number;
  fiscal_year_id: number;
  file_type: string;
  file_name: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface StorageUsage {
  user_id: string;
  used_bytes: number;
  max_bytes: number;
  used_mb: number;
  max_mb: number;
  pct_used: number;
}
