"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Save,
  X,
  Loader2,
} from "lucide-react";
import {
  listFiscalYears,
  listPoolGroups,
  listReferenceRates,
  upsertReferenceRate,
  bulkUpsertReferenceRates,
} from "@/lib/api";
import type { FiscalYear, PoolGroup, ReferenceRate } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RatesTableData {
  [rateName: string]: {
    periods: string[];
    rows: { [rowName: string]: number[] };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPct(v: number): string {
  if (v === 0) return "—";
  return (v * 100).toFixed(2) + "%";
}

function varianceClass(v: number): string {
  if (v === 0) return "";
  return v > 0 ? "text-destructive" : "text-green-400";
}

// ---------------------------------------------------------------------------
// Small dialog component
// ---------------------------------------------------------------------------
function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-sidebar border border-border rounded-lg p-5 w-full max-w-lg mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold m-0">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent !bg-transparent !border-none"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FY Selector (shared pattern)
// ---------------------------------------------------------------------------
function FYSelector({
  selected,
  onSelect,
}: {
  selected: FiscalYear | null;
  onSelect: (fy: FiscalYear) => void;
}) {
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);

  const load = useCallback(async () => {
    const fys = await listFiscalYears();
    setFiscalYears(fys);
    if (fys.length > 0 && !selected) onSelect(fys[0]);
  }, [selected, onSelect]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex items-center gap-3 mb-4">
      <label className="text-sm font-medium !opacity-100">Fiscal Year:</label>
      <select
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        value={selected?.id ?? ""}
        onChange={(e) => {
          const fy = fiscalYears.find((f) => f.id === Number(e.target.value));
          if (fy) onSelect(fy);
        }}
      >
        {fiscalYears.map((fy) => (
          <option key={fy.id} value={fy.id}>
            {fy.name} ({fy.start_month} — {fy.end_month})
          </option>
        ))}
        {fiscalYears.length === 0 && <option value="">No fiscal years</option>}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rate Entry Dialog — edit budget/provisional rates for a pool group
// ---------------------------------------------------------------------------
function RateEntryDialog({
  open,
  onClose,
  fyId,
  poolGroups,
  existingRates,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  fyId: number;
  poolGroups: PoolGroup[];
  existingRates: ReferenceRate[];
  onSaved: () => void;
}) {
  const [rateType, setRateType] = useState<"budget" | "provisional">("budget");
  const [selectedPG, setSelectedPG] = useState("");
  const [period, setPeriod] = useState("");
  const [rateValue, setRateValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Build a lookup for existing values
  const existing = existingRates
    .filter((r) => r.rate_type === rateType && r.pool_group_name === selectedPG)
    .sort((a, b) => a.period.localeCompare(b.period));

  useEffect(() => {
    if (poolGroups.length > 0 && !selectedPG) {
      setSelectedPG(poolGroups[0].name);
    }
  }, [poolGroups, selectedPG]);

  async function handleSave() {
    if (!period || !rateValue || !selectedPG) return;
    setSaving(true);
    try {
      await upsertReferenceRate(fyId, {
        rate_type: rateType,
        pool_group_name: selectedPG,
        period,
        rate_value: parseFloat(rateValue) / 100, // input as %, store as decimal
      });
      setRateValue("");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Manage Reference Rates">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs">Rate Type</label>
            <select
              className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={rateType}
              onChange={(e) => setRateType(e.target.value as "budget" | "provisional")}
            >
              <option value="budget">Budget</option>
              <option value="provisional">Provisional</option>
            </select>
          </div>
          <div>
            <label className="text-xs">Pool Group</label>
            <select
              className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedPG}
              onChange={(e) => setSelectedPG(e.target.value)}
            >
              {poolGroups.map((pg) => (
                <option key={pg.id} value={pg.name}>{pg.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Existing rates for selection */}
        {existing.length > 0 && (
          <div>
            <label className="text-xs mb-1 block">
              Existing {rateType} rates for {selectedPG}:
            </label>
            <div className="grid grid-cols-3 gap-1 max-h-32 overflow-y-auto">
              {existing.map((r) => (
                <div key={r.id} className="text-xs px-2 py-1 bg-accent rounded flex justify-between">
                  <span className="font-mono">{r.period}</span>
                  <span>{(r.rate_value * 100).toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs">Period (YYYY-MM)</label>
            <input
              className="w-full mt-1 text-sm"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="2025-01"
            />
          </div>
          <div>
            <label className="text-xs">Rate (%)</label>
            <input
              className="w-full mt-1 text-sm"
              type="number"
              step="0.01"
              value={rateValue}
              onChange={(e) => setRateValue(e.target.value)}
              placeholder="35.50"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !period || !rateValue}
          className="flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Rate
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Rate Comparison Table
// ---------------------------------------------------------------------------
function RateTable({
  rateName,
  data,
}: {
  rateName: string;
  data: { periods: string[]; rows: { [rowName: string]: number[] } };
}) {
  const [collapsed, setCollapsed] = useState(false);
  const ROW_ORDER = ["Actual", "YTD", "Budget", "Provisional", "Var (Act-Bud)", "Var (Act-Prov)"];
  const rowNames = ROW_ORDER.filter((r) => r in data.rows);

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-4">
      <div
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors bg-card"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        <span className="font-semibold text-sm">{rateName} Rate</span>
      </div>
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-accent/30">
                <th className="text-left px-3 py-2 font-medium sticky left-0 bg-accent/30 min-w-[120px]">
                  Metric
                </th>
                {data.periods.map((p) => (
                  <th key={p} className="text-right px-3 py-2 font-mono font-medium min-w-[80px]">
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowNames.map((row) => {
                const isVariance = row.startsWith("Var");
                return (
                  <tr
                    key={row}
                    className={`border-b border-border/50 ${isVariance ? "bg-accent/10" : ""}`}
                  >
                    <td className="px-3 py-2 font-medium sticky left-0 bg-background/80">
                      {row}
                    </td>
                    {data.rows[row].map((val, i) => (
                      <td
                        key={i}
                        className={`text-right px-3 py-2 font-mono ${isVariance ? varianceClass(val) : ""}`}
                      >
                        {fmtPct(val)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Rates Page
// ---------------------------------------------------------------------------
export default function RatesPage() {
  const [selectedFY, setSelectedFY] = useState<FiscalYear | null>(null);
  const [poolGroups, setPoolGroups] = useState<PoolGroup[]>([]);
  const [refRates, setRefRates] = useState<ReferenceRate[]>([]);
  const [ratesData, setRatesData] = useState<RatesTableData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showRateEntry, setShowRateEntry] = useState(false);

  // Input dir for running forecast (user configurable)
  const [inputDir, setInputDir] = useState("data");
  const [scenario, setScenario] = useState("Base");

  const loadMeta = useCallback(async () => {
    if (!selectedFY) return;
    const [pgs, rates] = await Promise.all([
      listPoolGroups(selectedFY.id),
      listReferenceRates(selectedFY.id),
    ]);
    setPoolGroups(pgs);
    setRefRates(rates);
  }, [selectedFY]);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  async function loadRatesTable() {
    if (!selectedFY) return;
    setLoading(true);
    setError("");
    setRatesData(null);
    try {
      const params = new URLSearchParams({
        scenario,
        input_dir: inputDir,
      });
      const resp = await fetch(`/api/fiscal-years/${selectedFY.id}/rates-table?${params}`);
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const data: RatesTableData = await resp.json();
      setRatesData(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const rateNames = ratesData ? Object.keys(ratesData) : [];

  // Summary cards from reference rates
  const budgetSummary = refRates.filter((r) => r.rate_type === "budget");
  const provSummary = refRates.filter((r) => r.rate_type === "provisional");

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h2 className="text-lg font-bold mt-0 mb-1">Rates Comparison</h2>
      <p className="text-muted-foreground text-sm mb-4">
        Actual vs Budget vs Provisional rates with YTD tracking.
      </p>

      <FYSelector selected={selectedFY} onSelect={setSelectedFY} />

      {selectedFY && (
        <>
          {/* Reference Rates Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold m-0">Budget Rates</h3>
                <span className="text-xs text-muted-foreground">
                  {budgetSummary.length} entries
                </span>
              </div>
              {budgetSummary.length === 0 ? (
                <p className="text-xs text-muted-foreground">No budget rates set.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[...new Set(budgetSummary.map((r) => r.pool_group_name))].map((pg) => {
                    const count = budgetSummary.filter((r) => r.pool_group_name === pg).length;
                    return (
                      <span key={pg} className="text-xs px-2 py-1 bg-accent rounded">
                        {pg}: {count} periods
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold m-0">Provisional Rates</h3>
                <span className="text-xs text-muted-foreground">
                  {provSummary.length} entries
                </span>
              </div>
              {provSummary.length === 0 ? (
                <p className="text-xs text-muted-foreground">No provisional rates set.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[...new Set(provSummary.map((r) => r.pool_group_name))].map((pg) => {
                    const count = provSummary.filter((r) => r.pool_group_name === pg).length;
                    return (
                      <span key={pg} className="text-xs px-2 py-1 bg-accent rounded">
                        {pg}: {count} periods
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-end gap-3 mb-6">
            <div>
              <label className="text-xs">Input Directory</label>
              <input
                className="mt-1 text-sm px-3 py-1.5 w-40"
                value={inputDir}
                onChange={(e) => setInputDir(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs">Scenario</label>
              <input
                className="mt-1 text-sm px-3 py-1.5 w-28"
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
              />
            </div>
            <button
              onClick={loadRatesTable}
              disabled={loading}
              className="flex items-center gap-2 text-sm px-4 py-1.5"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Compute Rates
            </button>
            <button
              onClick={() => setShowRateEntry(true)}
              className="flex items-center gap-2 text-sm px-4 py-1.5 !bg-secondary"
            >
              <Plus className="w-3 h-3" /> Edit Reference Rates
            </button>
          </div>

          {error && <div className="error mb-4">{error}</div>}

          {/* Rate Tables */}
          {ratesData && rateNames.length > 0 && (
            <div>
              {rateNames.map((name) => (
                <RateTable key={name} rateName={name} data={ratesData[name]} />
              ))}
            </div>
          )}

          {ratesData && rateNames.length === 0 && (
            <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
              No rate data returned. Check that pool groups are configured and input data exists.
            </div>
          )}

          {!ratesData && !loading && !error && (
            <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
              Click &quot;Compute Rates&quot; to generate the Actual vs Budget vs Provisional comparison table.
            </div>
          )}

          {/* Rate Entry Dialog */}
          <RateEntryDialog
            open={showRateEntry}
            onClose={() => setShowRateEntry(false)}
            fyId={selectedFY.id}
            poolGroups={poolGroups}
            existingRates={refRates}
            onSaved={() => {
              loadMeta();
            }}
          />
        </>
      )}
    </div>
  );
}
