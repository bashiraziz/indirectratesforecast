import type {
  FiscalYear,
  RateGroup,
  PoolGroup,
  Pool,
  GLMapping,
  ReferenceRate,
  RevenueRow,
  CostCategory,
  ChartAccount,
  BaseAccount,
  Scenario,
  ScenarioEvent,
  ForecastRun,
  DashboardSummary,
  PSTData,
  UploadedFile,
  StorageUsage,
} from "./types";

const BASE = "";

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${url}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// Dashboard
export const getDashboardSummary = () => fetchJSON<DashboardSummary>("/api/dashboard-summary");

// Fiscal Years
export const listFiscalYears = () => fetchJSON<FiscalYear[]>("/api/fiscal-years");
export const createFiscalYear = (data: { name: string; start_month: string; end_month: string }) =>
  fetchJSON<FiscalYear & { id: number }>("/api/fiscal-years", { method: "POST", body: JSON.stringify(data) });
export const deleteFiscalYear = (id: number) =>
  fetchJSON<{ ok: boolean }>(`/api/fiscal-years/${id}`, { method: "DELETE" });
export const copyFYSetup = (targetFyId: number, sourceFyId: number) =>
  fetchJSON<{ ok: boolean; source: string; target: string; chart_accounts: number; rate_groups: number; pool_groups: number; pools: number; gl_mappings: number; base_accounts: number }>(
    `/api/fiscal-years/${targetFyId}/copy-setup`,
    { method: "POST", body: JSON.stringify({ source_fy_id: sourceFyId }) }
  );

// Rate Groups
export const listRateGroups = (fyId: number) => fetchJSON<RateGroup[]>(`/api/fiscal-years/${fyId}/rate-groups`);
export const createRateGroup = (fyId: number, data: { name: string; display_order?: number }) =>
  fetchJSON<RateGroup & { id: number }>(`/api/fiscal-years/${fyId}/rate-groups`, { method: "POST", body: JSON.stringify(data) });
export const updateRateGroup = (rgId: number, data: { name?: string; display_order?: number }) =>
  fetchJSON<{ ok: boolean }>(`/api/rate-groups/${rgId}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteRateGroup = (rgId: number) =>
  fetchJSON<{ ok: boolean }>(`/api/rate-groups/${rgId}`, { method: "DELETE" });
export const listPoolGroupsByRateGroup = (rgId: number) =>
  fetchJSON<PoolGroup[]>(`/api/rate-groups/${rgId}/pool-groups`);

// Pool Groups
export const listPoolGroups = (fyId: number) => fetchJSON<PoolGroup[]>(`/api/fiscal-years/${fyId}/pool-groups`);
export const createPoolGroup = (fyId: number, data: { name: string; base?: string; display_order?: number; rate_group_id?: number; cascade_order?: number }) =>
  fetchJSON<PoolGroup & { id: number }>(`/api/fiscal-years/${fyId}/pool-groups`, { method: "POST", body: JSON.stringify(data) });
export const updatePoolGroup = (pgId: number, data: { name?: string; base?: string; display_order?: number; rate_group_id?: number; cascade_order?: number }) =>
  fetchJSON<{ ok: boolean }>(`/api/pool-groups/${pgId}`, { method: "PUT", body: JSON.stringify(data) });
export const deletePoolGroup = (pgId: number) =>
  fetchJSON<{ ok: boolean }>(`/api/pool-groups/${pgId}`, { method: "DELETE" });

// Pools
export const listPools = (pgId: number) => fetchJSON<Pool[]>(`/api/pool-groups/${pgId}/pools`);
export const createPool = (pgId: number, data: { name: string; display_order?: number }) =>
  fetchJSON<Pool & { id: number }>(`/api/pool-groups/${pgId}/pools`, { method: "POST", body: JSON.stringify(data) });
export const updatePool = (poolId: number, data: { name?: string; display_order?: number }) =>
  fetchJSON<{ ok: boolean }>(`/api/pools/${poolId}`, { method: "PUT", body: JSON.stringify(data) });
export const deletePool = (poolId: number) =>
  fetchJSON<{ ok: boolean }>(`/api/pools/${poolId}`, { method: "DELETE" });

// GL Mappings
export const listGLMappings = (poolId: number) => fetchJSON<GLMapping[]>(`/api/pools/${poolId}/gl-mappings`);
export const createGLMapping = (poolId: number, data: { account: string; is_unallowable?: boolean; notes?: string }) =>
  fetchJSON<GLMapping & { id: number }>(`/api/pools/${poolId}/gl-mappings`, { method: "POST", body: JSON.stringify(data) });
export const deleteGLMapping = (mappingId: number) =>
  fetchJSON<{ ok: boolean }>(`/api/gl-mappings/${mappingId}`, { method: "DELETE" });

// Reference Rates
export const listReferenceRates = (fyId: number, rateType?: string) => {
  const qs = rateType ? `?rate_type=${rateType}` : "";
  return fetchJSON<ReferenceRate[]>(`/api/fiscal-years/${fyId}/reference-rates${qs}`);
};
export const upsertReferenceRate = (fyId: number, data: { rate_type: string; pool_group_name: string; period: string; rate_value: number }) =>
  fetchJSON<ReferenceRate>(`/api/fiscal-years/${fyId}/reference-rates`, { method: "PUT", body: JSON.stringify(data) });
export const bulkUpsertReferenceRates = (fyId: number, data: { rate_type: string; pool_group_name: string; period: string; rate_value: number }[]) =>
  fetchJSON<{ ids: number[] }>(`/api/fiscal-years/${fyId}/reference-rates/bulk`, { method: "PUT", body: JSON.stringify(data) });

export async function uploadReferenceRates(fyId: number, file: File): Promise<{ imported: number }> {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`/api/fiscal-years/${fyId}/reference-rates/upload`, { method: "POST", body: form });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail));
  }
  return resp.json();
}

// Revenue
export const listRevenue = (fyId: number, project?: string) => {
  const qs = project ? `?project=${encodeURIComponent(project)}` : "";
  return fetchJSON<RevenueRow[]>(`/api/fiscal-years/${fyId}/revenue${qs}`);
};
export const upsertRevenue = (fyId: number, data: { period: string; project: string; revenue: number }) =>
  fetchJSON<RevenueRow>(`/api/fiscal-years/${fyId}/revenue`, { method: "POST", body: JSON.stringify(data) });
export const importRevenue = (fyId: number, data: { period: string; project: string; revenue: number }[]) =>
  fetchJSON<{ imported: number }>(`/api/fiscal-years/${fyId}/revenue/import`, { method: "POST", body: JSON.stringify(data) });

// Cost Categories
export const listCostCategories = (fyId: number, categoryType?: string) => {
  const qs = categoryType ? `?category_type=${encodeURIComponent(categoryType)}` : "";
  return fetchJSON<CostCategory[]>(`/api/fiscal-years/${fyId}/cost-categories${qs}`);
};
export const createCostCategory = (fyId: number, data: { category_type: string; category_name: string; gl_account?: string; is_direct?: boolean }) =>
  fetchJSON<CostCategory & { id: number }>(`/api/fiscal-years/${fyId}/cost-categories`, { method: "POST", body: JSON.stringify(data) });
export const updateCostCategory = (ccId: number, data: { category_name?: string; gl_account?: string; is_direct?: boolean }) =>
  fetchJSON<{ ok: boolean }>(`/api/cost-categories/${ccId}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteCostCategory = (ccId: number) =>
  fetchJSON<{ ok: boolean }>(`/api/cost-categories/${ccId}`, { method: "DELETE" });

// Chart of Accounts
export const listChartOfAccounts = (fyId: number) =>
  fetchJSON<ChartAccount[]>(`/api/fiscal-years/${fyId}/chart-of-accounts`);
export const createChartAccount = (fyId: number, data: { account: string; name?: string; category?: string }) =>
  fetchJSON<ChartAccount & { id: number }>(`/api/fiscal-years/${fyId}/chart-of-accounts`, { method: "POST", body: JSON.stringify(data) });
export const bulkCreateChartAccounts = (fyId: number, accounts: { account: string; name?: string; category?: string }[]) =>
  fetchJSON<{ ids: number[]; imported: number }>(`/api/fiscal-years/${fyId}/chart-of-accounts/bulk`, { method: "POST", body: JSON.stringify({ accounts }) });
export const deleteChartAccount = (caId: number) =>
  fetchJSON<{ ok: boolean }>(`/api/chart-of-accounts/${caId}`, { method: "DELETE" });

// Base Accounts
export const listBaseAccounts = (pgId: number) =>
  fetchJSON<BaseAccount[]>(`/api/pool-groups/${pgId}/base-accounts`);
export const createBaseAccount = (pgId: number, data: { account: string; notes?: string }) =>
  fetchJSON<BaseAccount & { id: number }>(`/api/pool-groups/${pgId}/base-accounts`, { method: "POST", body: JSON.stringify(data) });
export const deleteBaseAccount = (baId: number) =>
  fetchJSON<{ ok: boolean }>(`/api/base-accounts/${baId}`, { method: "DELETE" });

// Available Accounts (for shuttle UI)
export const getAvailableCostAccounts = (fyId: number) =>
  fetchJSON<ChartAccount[]>(`/api/fiscal-years/${fyId}/available-cost-accounts`);
export const getAvailableBaseAccounts = (fyId: number) =>
  fetchJSON<ChartAccount[]>(`/api/fiscal-years/${fyId}/available-base-accounts`);

// Scenarios
export const listScenarios = (fyId: number) =>
  fetchJSON<Scenario[]>(`/api/fiscal-years/${fyId}/scenarios`);
export const createScenario = (fyId: number, data: { name: string; description?: string }) =>
  fetchJSON<Scenario & { id: number }>(`/api/fiscal-years/${fyId}/scenarios`, { method: "POST", body: JSON.stringify(data) });
export const getScenario = (scenarioId: number) =>
  fetchJSON<Scenario>(`/api/scenarios/${scenarioId}`);
export const updateScenario = (scenarioId: number, data: { name?: string; description?: string }) =>
  fetchJSON<{ ok: boolean }>(`/api/scenarios/${scenarioId}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteScenario = (scenarioId: number) =>
  fetchJSON<{ ok: boolean }>(`/api/scenarios/${scenarioId}`, { method: "DELETE" });

// Scenario Events
export const listScenarioEvents = (scenarioId: number) =>
  fetchJSON<ScenarioEvent[]>(`/api/scenarios/${scenarioId}/events`);
export const createScenarioEvent = (scenarioId: number, data: {
  effective_period: string; event_type?: string; project?: string;
  delta_direct_labor?: number; delta_direct_labor_hrs?: number;
  delta_subk?: number; delta_odc?: number; delta_travel?: number;
  pool_deltas?: Record<string, number>; notes?: string;
}) =>
  fetchJSON<ScenarioEvent & { id: number }>(`/api/scenarios/${scenarioId}/events`, { method: "POST", body: JSON.stringify(data) });
export const updateScenarioEvent = (eventId: number, data: Record<string, unknown>) =>
  fetchJSON<{ ok: boolean }>(`/api/scenario-events/${eventId}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteScenarioEvent = (eventId: number) =>
  fetchJSON<{ ok: boolean }>(`/api/scenario-events/${eventId}`, { method: "DELETE" });

// Seed / Clear Test Data
export const seedTestData = () =>
  fetchJSON<{ fiscal_year: string; fiscal_year_id: number; chart_accounts: number; rate_groups: number; pool_groups: number; pools: number; gl_mappings: number; base_accounts: number; csv_files: number }>(
    "/api/seed-test-data", { method: "POST" }
  );
export const clearTestData = () =>
  fetchJSON<{ deleted_fy: boolean; csv_files_removed: number }>(
    "/api/seed-test-data", { method: "DELETE" }
  );

// Seed / Clear Demo Data (enterprise-scale)
export const seedDemoData = () =>
  fetchJSON<{ fiscal_years: number; fiscal_year_names: string[]; chart_accounts: number; pool_groups: number; pools: number; gl_mappings: number; base_accounts: number; scenarios: number; projects: number; periods: number; csv_files: number }>(
    "/api/seed-demo-data", { method: "POST" }
  );
export const clearDemoData = () =>
  fetchJSON<{ deleted_fiscal_years: number; csv_files_removed: number }>(
    "/api/seed-demo-data", { method: "DELETE" }
  );

// Entities
export const listEntities = (fyId: number, dataDir?: string) => {
  const qs = dataDir ? `?data_dir=${encodeURIComponent(dataDir)}` : "";
  return fetchJSON<string[]>(`/api/fiscal-years/${fyId}/entities${qs}`);
};

// Forecast Runs
export const listForecastRuns = (fyId: number) =>
  fetchJSON<ForecastRun[]>(`/api/fiscal-years/${fyId}/forecast-runs`);
export const deleteForecastRun = (runId: number) =>
  fetchJSON<{ ok: boolean }>(`/api/forecast-runs/${runId}`, { method: "DELETE" });
export async function downloadForecastRun(runId: number): Promise<Blob> {
  const resp = await fetch(`/api/forecast-runs/${runId}/download`);
  if (!resp.ok) throw new Error(`Download failed: ${resp.statusText}`);
  return resp.blob();
}

// PST Report
export const getPSTReport = (fyId: number, selectedPeriod: string, scenario?: string) => {
  const qs = new URLSearchParams({ selected_period: selectedPeriod });
  if (scenario) qs.set("scenario", scenario);
  return fetchJSON<PSTData>(`/api/fiscal-years/${fyId}/pst?${qs}`);
};

// Uploaded Files
export const listUploadedFiles = (fyId: number) =>
  fetchJSON<UploadedFile[]>(`/api/fiscal-years/${fyId}/files`);

export async function uploadFYFile(fyId: number, fileType: string, file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  form.append("file_type", fileType);
  const resp = await fetch(`/api/fiscal-years/${fyId}/files`, { method: "POST", body: form });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail));
  }
  return resp.json();
}

export const deleteUploadedFile = (fileId: number) =>
  fetchJSON<{ ok: boolean }>(`/api/files/${fileId}`, { method: "DELETE" });

export async function downloadUploadedFile(fileId: number, fileName: string): Promise<void> {
  const resp = await fetch(`/api/files/${fileId}/download`);
  if (!resp.ok) throw new Error(`Download failed: ${resp.statusText}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export const getStorageUsage = () =>
  fetchJSON<StorageUsage>("/api/storage-usage");
