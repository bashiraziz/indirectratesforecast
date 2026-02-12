import type {
  FiscalYear,
  RateGroup,
  PoolGroup,
  Pool,
  GLMapping,
  ReferenceRate,
  RevenueRow,
  CostCategory,
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

// Fiscal Years
export const listFiscalYears = () => fetchJSON<FiscalYear[]>("/api/fiscal-years");
export const createFiscalYear = (data: { name: string; start_month: string; end_month: string }) =>
  fetchJSON<FiscalYear & { id: number }>("/api/fiscal-years", { method: "POST", body: JSON.stringify(data) });
export const deleteFiscalYear = (id: number) =>
  fetchJSON<{ ok: boolean }>(`/api/fiscal-years/${id}`, { method: "DELETE" });

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
