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
  listScenarios,
  upsertReferenceRate,
  bulkUpsertReferenceRates,
  uploadReferenceRates,
} from "@/lib/api";
import type { FiscalYear, PoolGroup, ReferenceRate, Scenario } from "@/lib/types";
import NextStepHint from "@/app/components/NextStepHint";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RateTableEntry {
  periods: string[];
  rows: { [rowName: string]: number[] };
}

interface RatesTableData {
  [rateName: string]: RateTableEntry;
}

interface PoolBaseData {
  [colName: string]: { [period: string]: number };
}

interface RateDef {
  pool: string[];
  base: string;
}

interface DrilldownInfo {
  rateName: string;
  period: string;
  rateValue: number;
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
            className="p-1 rounded hover:bg-accent bg-transparent! border-none!"
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
      <label className="text-sm font-medium opacity-100!">Fiscal Year:</label>
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
  const [rateType, setRateType] = useState<"budget" | "provisional" | "threshold">("budget");
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
              onChange={(e) => setRateType(e.target.value as "budget" | "provisional" | "threshold")}
            >
              <option value="budget">Budget</option>
              <option value="provisional">Provisional</option>
              <option value="threshold">Threshold (max acceptable)</option>
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
// Bulk Upload Dialog
// ---------------------------------------------------------------------------

const RATE_UPLOAD_TEMPLATE = `pool_group_name,period,rate_type,rate_value
Fringe,2025-01,budget,25.50
Overhead,2025-01,budget,45.00
G&A,2025-01,budget,15.00`;

function RateUploadDialog({
  open,
  onClose,
  fyId,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  fyId: number;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string[][] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(f: File | null) {
    setFile(f);
    setPreview(null);
    setResult(null);
    setError(null);
    if (!f) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lines = text.trim().split("\n").map((l) => l.split(",").map((c) => c.trim()));
      setPreview(lines.slice(0, 21)); // header + up to 20 rows
    };
    reader.readAsText(f);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const res = await uploadReferenceRates(fyId, file);
      setResult(`Successfully imported ${res.imported} rates.`);
      onUploaded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([RATE_UPLOAD_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reference_rates_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Bulk Upload Reference Rates">
      <div className="flex flex-col gap-4">
        <div className="text-xs text-muted-foreground">
          Upload a CSV with columns: <code>pool_group_name, period, rate_type, rate_value</code>.
          Rate values should be in percentage (e.g. 25.50 for 25.50%).
        </div>

        <div className="flex gap-2">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            className="flex-1 text-sm"
          />
          <button
            onClick={downloadTemplate}
            className="text-xs px-3 py-1 border border-input rounded-md"
          >
            Download Template
          </button>
        </div>

        {preview && (
          <div className="border border-border rounded-md overflow-auto max-h-48">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-accent/30">
                  {preview[0]?.map((h, i) => (
                    <th key={i} className="px-2 py-1 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(1).map((row, ri) => (
                  <tr key={ri} className="border-t border-border/50">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2 py-1">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 20 && (
              <div className="text-xs text-muted-foreground px-2 py-1">Showing first 20 rows...</div>
            )}
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3 whitespace-pre-wrap max-h-40 overflow-auto">
            {error}
          </div>
        )}

        {result && (
          <div className="text-xs text-green-500 bg-green-500/10 border border-green-500/20 rounded-md p-3">
            {result}
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={uploading || !file}
          className="flex items-center justify-center gap-2"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Upload Rates
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
  onCellClick,
}: {
  rateName: string;
  data: RateTableEntry;
  onCellClick?: (period: string, rateValue: number) => void;
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
                <th className="text-left px-3 py-2 font-medium sticky left-0 bg-accent/30 min-w-30">
                  Metric
                </th>
                {data.periods.map((p) => (
                  <th key={p} className="text-right px-3 py-2 font-mono font-medium min-w-20">
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowNames.map((row) => {
                const isVariance = row.startsWith("Var");
                const isClickable = row === "Actual" && onCellClick;
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
                        className={`text-right px-3 py-2 font-mono ${isVariance ? varianceClass(val) : ""} ${isClickable ? "cursor-pointer hover:bg-primary/10 transition-colors" : ""}`}
                        onClick={isClickable ? () => onCellClick(data.periods[i], val) : undefined}
                        title={isClickable ? "Click to see pool $ / base $ breakdown" : undefined}
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
// Rate Drilldown Modal
// ---------------------------------------------------------------------------
function fmtDollar(v: number): string {
  if (v === 0) return "—";
  const neg = v < 0;
  const abs = Math.abs(v);
  const formatted = abs >= 1000
    ? "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : "$" + abs.toFixed(2);
  return neg ? `(${formatted})` : formatted;
}

function RateDrilldownModal({
  drilldown,
  pools,
  bases,
  rateDefs,
  onClose,
}: {
  drilldown: DrilldownInfo;
  pools: PoolBaseData;
  bases: PoolBaseData;
  rateDefs: { [rateName: string]: RateDef };
  onClose: () => void;
}) {
  const def = rateDefs[drilldown.rateName];
  if (!def) return null;

  const poolCols = def.pool;
  const baseCol = def.base;
  const period = drilldown.period;

  // Sum pool $ for this rate
  const poolValues = poolCols.map((col) => ({
    name: col,
    value: pools[col]?.[period] ?? 0,
  }));
  const totalPool = poolValues.reduce((s, p) => s + p.value, 0);
  const baseValue = bases[baseCol]?.[period] ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-sidebar border border-border rounded-lg w-full max-w-md mx-4 p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold m-0">
            {drilldown.rateName} — {period}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent bg-transparent! border-none!"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs text-muted-foreground mb-3">
          <strong>Rate = Pool $ / Base $</strong>
          <span className="float-right font-mono">
            {(drilldown.rateValue * 100).toFixed(2)}%
          </span>
        </div>

        {/* Pool $ breakdown */}
        <div className="mb-4">
          <div className="text-xs font-semibold mb-2 text-muted-foreground">
            Pool $ (numerator)
          </div>
          <div className="space-y-1">
            {poolValues.map((p) => (
              <div
                key={p.name}
                className="flex justify-between text-xs px-2 py-1 rounded bg-accent/30"
              >
                <span>{p.name}</span>
                <span className="font-mono">{fmtDollar(p.value)}</span>
              </div>
            ))}
            {poolValues.length > 1 && (
              <div className="flex justify-between text-xs px-2 py-1 rounded bg-accent/60 font-semibold">
                <span>Total Pool</span>
                <span className="font-mono">{fmtDollar(totalPool)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Base $ */}
        <div className="mb-4">
          <div className="text-xs font-semibold mb-2 text-muted-foreground">
            Base $ (denominator)
          </div>
          <div className="flex justify-between text-xs px-2 py-1 rounded bg-accent/30">
            <span>{baseCol}</span>
            <span className="font-mono">{fmtDollar(baseValue)}</span>
          </div>
        </div>

        {/* Calculation */}
        <div className="border-t border-border pt-3 text-xs font-mono text-center text-muted-foreground">
          {fmtDollar(totalPool)} / {fmtDollar(baseValue)} = {(drilldown.rateValue * 100).toFixed(2)}%
        </div>
      </div>
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
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [ratesData, setRatesData] = useState<RatesTableData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showRateEntry, setShowRateEntry] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [poolsData, setPoolsData] = useState<PoolBaseData | null>(null);
  const [basesData, setBasesData] = useState<PoolBaseData | null>(null);
  const [rateDefs, setRateDefs] = useState<{ [name: string]: RateDef }>({});
  const [drilldown, setDrilldown] = useState<DrilldownInfo | null>(null);

  // Input dir for running forecast (user configurable)
  const [inputDir, setInputDir] = useState("data");
  const [scenario, setScenario] = useState("Base");

  const loadMeta = useCallback(async () => {
    if (!selectedFY) return;
    const [pgs, rates, scens] = await Promise.all([
      listPoolGroups(selectedFY.id),
      listReferenceRates(selectedFY.id),
      listScenarios(selectedFY.id),
    ]);
    setPoolGroups(pgs);
    setRefRates(rates);
    setScenarios(scens);
    // Auto-detect data dir from FY name
    if (selectedFY.name.startsWith("DEMO-")) {
      setInputDir("data_demo");
    } else if (selectedFY.name.includes("TEST")) {
      setInputDir("data_test");
    }
  }, [selectedFY]);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  async function loadRatesTable() {
    if (!selectedFY) return;
    setLoading(true);
    setError("");
    setRatesData(null);
    setPoolsData(null);
    setBasesData(null);
    setRateDefs({});
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
      const raw = await resp.json() as Record<string, unknown>;

      // Extract pool/base/rateDef metadata
      const pools = raw._pools as PoolBaseData | undefined;
      const bases = raw._bases as PoolBaseData | undefined;
      const defs = raw._rate_defs as { [name: string]: RateDef } | undefined;
      delete raw._pools;
      delete raw._bases;
      delete raw._rate_defs;

      setRatesData(raw as RatesTableData);
      if (pools) setPoolsData(pools);
      if (bases) setBasesData(bases);
      if (defs) setRateDefs(defs);
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
  const thresholdSummary = refRates.filter((r) => r.rate_type === "threshold");

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h2 className="text-lg font-bold mt-0 mb-1">Rates Comparison</h2>
      <p className="text-muted-foreground text-sm mb-4">
        Actual vs Budget vs Provisional rates with YTD tracking.
      </p>
      <NextStepHint
        items={[
          { label: "Review category mappings", href: "/mappings", detail: "Ensure cost categories are mapped correctly." },
          { label: "Run full forecast", href: "/forecast", detail: "Use rates output to generate final forecast pack." },
        ]}
      />

      <FYSelector selected={selectedFY} onSelect={setSelectedFY} />

      {selectedFY && (
        <>
          {/* Reference Rates Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
            <div className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold m-0">Threshold Rates</h3>
                <span className="text-xs text-muted-foreground">
                  {thresholdSummary.length} entries
                </span>
              </div>
              {thresholdSummary.length === 0 ? (
                <p className="text-xs text-muted-foreground">No threshold rates set.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[...new Set(thresholdSummary.map((r) => r.pool_group_name))].map((pg) => {
                    const count = thresholdSummary.filter((r) => r.pool_group_name === pg).length;
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
              <label className="text-xs">Scenario</label>
              <select
                className="mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
              >
                {scenarios.length === 0 && <option value="Base">Base</option>}
                {scenarios.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
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
              className="flex items-center gap-2 text-sm px-4 py-1.5 bg-secondary!"
            >
              <Plus className="w-3 h-3" /> Edit Reference Rates
            </button>
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 text-sm px-4 py-1.5 bg-secondary!"
            >
              <Plus className="w-3 h-3" /> Bulk Upload
            </button>
          </div>

          {error && <div className="error mb-4">{error}</div>}

          {/* Rate Tables */}
          {ratesData && rateNames.length > 0 && (
            <div>
              {rateNames.map((name) => (
                <RateTable
                  key={name}
                  rateName={name}
                  data={ratesData[name]}
                  onCellClick={poolsData ? (period, rateValue) => {
                    setDrilldown({ rateName: name, period, rateValue });
                  } : undefined}
                />
              ))}
            </div>
          )}

          {/* Rate Drilldown Modal */}
          {drilldown && poolsData && basesData && (
            <RateDrilldownModal
              drilldown={drilldown}
              pools={poolsData}
              bases={basesData}
              rateDefs={rateDefs}
              onClose={() => setDrilldown(null)}
            />
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
          <RateUploadDialog
            open={showUpload}
            onClose={() => setShowUpload(false)}
            fyId={selectedFY.id}
            onUploaded={() => {
              loadMeta();
              setShowUpload(false);
            }}
          />
        </>
      )}
    </div>
  );
}
