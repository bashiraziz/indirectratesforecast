"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Loader2,
  Save,
} from "lucide-react";
import {
  listRevenue,
  listScenarios,
  upsertRevenue,
  importRevenue,
} from "@/lib/api";
import type { FiscalYear, RevenueRow, Scenario } from "@/lib/types";
import { Dialog } from "@/app/components/Dialog";
import { FYSelector } from "@/app/components/FYSelector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PSRRow {
  period: string;
  project: string;
  direct_cost: number;
  indirect_cost: number;
  total_cost: number;
  revenue: number;
  fee: number;
  margin_pct: number;
}

interface PSRSummaryRow {
  project: string;
  direct_cost: number;
  indirect_cost: number;
  total_cost: number;
  revenue: number;
  fee: number;
  margin_pct: number;
}

interface PSRData {
  detail: PSRRow[];
  summary: PSRSummaryRow[];
  projects: string[];
  periods: string[];
}

// ---------------------------------------------------------------------------
// Helpers
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

function fmtPct(v: number): string {
  if (v === 0) return "—";
  return (v * 100).toFixed(1) + "%";
}

function marginClass(v: number): string {
  if (v === 0) return "text-muted-foreground";
  if (v < 0) return "text-destructive";
  if (v < 0.05) return "text-yellow-400";
  return "text-green-400";
}

function feeClass(v: number): string {
  if (v < 0) return "text-destructive";
  if (v > 0) return "text-green-400";
  return "";
}


// ---------------------------------------------------------------------------
// Revenue Entry Dialog
// ---------------------------------------------------------------------------

function RevenueDialog({
  open,
  onClose,
  fyId,
  existingRevenue,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  fyId: number;
  existingRevenue: RevenueRow[];
  onSaved: () => void;
}) {
  const [period, setPeriod] = useState("");
  const [project, setProject] = useState("");
  const [revenue, setRevenue] = useState("");
  const [saving, setSaving] = useState(false);

  const uniqueProjects = [...new Set(existingRevenue.map((r) => r.project))].sort();

  async function handleSave() {
    if (!period || !project || !revenue) return;
    setSaving(true);
    try {
      await upsertRevenue(fyId, {
        period,
        project: project.trim(),
        revenue: parseFloat(revenue),
      });
      setRevenue("");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Manage Revenue Data">
      <div className="flex flex-col gap-4">
        {/* Show existing entries */}
        {existingRevenue.length > 0 && (
          <div>
            <label className="text-xs mb-1 block">Existing revenue entries ({existingRevenue.length}):</label>
            <div className="max-h-40 overflow-y-auto border border-border rounded p-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left px-1 py-0.5">Period</th>
                    <th className="text-left px-1 py-0.5">Project</th>
                    <th className="text-right px-1 py-0.5">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {existingRevenue.slice(0, 50).map((r) => (
                    <tr key={r.id} className="border-t border-border/30">
                      <td className="px-1 py-0.5 font-mono">{r.period}</td>
                      <td className="px-1 py-0.5">{r.project}</td>
                      <td className="px-1 py-0.5 text-right font-mono">{fmtDollar(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs">Period</label>
            <input
              className="w-full mt-1 text-sm"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="2025-01"
            />
          </div>
          <div>
            <label className="text-xs">Project</label>
            <input
              className="w-full mt-1 text-sm"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="Project name"
              list="project-suggestions"
            />
            <datalist id="project-suggestions">
              {uniqueProjects.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-xs">Revenue ($)</label>
            <input
              className="w-full mt-1 text-sm"
              type="number"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
              placeholder="100000"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !period || !project || !revenue}
          className="flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Revenue
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Project Summary Cards
// ---------------------------------------------------------------------------

function SummaryCards({ summary }: { summary: PSRSummaryRow[] }) {
  const totals = summary.reduce(
    (acc, row) => ({
      direct_cost: acc.direct_cost + row.direct_cost,
      indirect_cost: acc.indirect_cost + row.indirect_cost,
      total_cost: acc.total_cost + row.total_cost,
      revenue: acc.revenue + row.revenue,
      fee: acc.fee + row.fee,
    }),
    { direct_cost: 0, indirect_cost: 0, total_cost: 0, revenue: 0, fee: 0 }
  );
  const totalMargin = totals.revenue ? totals.fee / totals.revenue : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div className="border border-border rounded-lg p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-1">Total Revenue</div>
        <div className="text-lg font-bold font-mono">{fmtDollar(totals.revenue)}</div>
      </div>
      <div className="border border-border rounded-lg p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-1">Total Cost</div>
        <div className="text-lg font-bold font-mono">{fmtDollar(totals.total_cost)}</div>
      </div>
      <div className="border border-border rounded-lg p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-1">Total Fee</div>
        <div className={`text-lg font-bold font-mono ${feeClass(totals.fee)}`}>
          {fmtDollar(totals.fee)}
        </div>
      </div>
      <div className="border border-border rounded-lg p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-1">Overall Margin</div>
        <div className={`text-lg font-bold font-mono ${marginClass(totalMargin)}`}>
          {fmtPct(totalMargin)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project Summary Table
// ---------------------------------------------------------------------------

function SummaryTable({ summary }: { summary: PSRSummaryRow[] }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden mb-6">
      <div className="px-4 py-2.5 bg-card border-b border-border">
        <span className="font-semibold text-sm">Project Summary</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border bg-accent/30">
              <th className="text-left px-3 py-2 font-medium">Project</th>
              <th className="text-right px-3 py-2 font-medium">Direct Cost</th>
              <th className="text-right px-3 py-2 font-medium">Indirect Cost</th>
              <th className="text-right px-3 py-2 font-medium">Total Cost</th>
              <th className="text-right px-3 py-2 font-medium">Revenue</th>
              <th className="text-right px-3 py-2 font-medium">Fee</th>
              <th className="text-right px-3 py-2 font-medium">Margin</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((row) => (
              <tr key={row.project} className="border-b border-border/50 hover:bg-accent/30">
                <td className="px-3 py-2 font-medium">{row.project}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtDollar(row.direct_cost)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtDollar(row.indirect_cost)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtDollar(row.total_cost)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtDollar(row.revenue)}</td>
                <td className={`px-3 py-2 text-right font-mono ${feeClass(row.fee)}`}>
                  {fmtDollar(row.fee)}
                </td>
                <td className={`px-3 py-2 text-right font-mono ${marginClass(row.margin_pct)}`}>
                  {fmtPct(row.margin_pct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project Detail Table (expandable per project)
// ---------------------------------------------------------------------------

function ProjectDetailTable({
  project,
  rows,
}: {
  project: string;
  rows: PSRRow[];
}) {
  const [collapsed, setCollapsed] = useState(true);

  const total = rows.reduce(
    (acc, r) => ({
      direct_cost: acc.direct_cost + r.direct_cost,
      indirect_cost: acc.indirect_cost + r.indirect_cost,
      total_cost: acc.total_cost + r.total_cost,
      revenue: acc.revenue + r.revenue,
      fee: acc.fee + r.fee,
    }),
    { direct_cost: 0, indirect_cost: 0, total_cost: 0, revenue: 0, fee: 0 }
  );
  const margin = total.revenue ? total.fee / total.revenue : 0;

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-3">
      <div
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors bg-card"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        <span className="font-semibold text-sm flex-1">{project}</span>
        <span className={`text-xs font-mono ${feeClass(total.fee)}`}>
          Fee: {fmtDollar(total.fee)}
        </span>
        <span className={`text-xs font-mono ml-3 ${marginClass(margin)}`}>
          {fmtPct(margin)}
        </span>
      </div>
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-accent/30">
                <th className="text-left px-3 py-2 font-medium">Period</th>
                <th className="text-right px-3 py-2 font-medium">Direct</th>
                <th className="text-right px-3 py-2 font-medium">Indirect</th>
                <th className="text-right px-3 py-2 font-medium">Total Cost</th>
                <th className="text-right px-3 py-2 font-medium">Revenue</th>
                <th className="text-right px-3 py-2 font-medium">Fee</th>
                <th className="text-right px-3 py-2 font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.period} className="border-b border-border/50">
                  <td className="px-3 py-2 font-mono">{row.period}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtDollar(row.direct_cost)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtDollar(row.indirect_cost)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtDollar(row.total_cost)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtDollar(row.revenue)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${feeClass(row.fee)}`}>
                    {fmtDollar(row.fee)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${marginClass(row.margin_pct)}`}>
                    {fmtPct(row.margin_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main PSR Page
// ---------------------------------------------------------------------------

export default function PSRPage() {
  const [selectedFY, setSelectedFY] = useState<FiscalYear | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueRow[]>([]);
  const [psrData, setPsrData] = useState<PSRData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showRevenue, setShowRevenue] = useState(false);

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenario, setScenario] = useState("Base");
  const [filterProject, setFilterProject] = useState("");

  const loadRevenue = useCallback(async () => {
    if (!selectedFY) return;
    const rev = await listRevenue(selectedFY.id);
    setRevenueData(rev);
  }, [selectedFY]);

  useEffect(() => { loadRevenue(); }, [loadRevenue]);

  // Load scenarios for dropdown
  const loadScenarios = useCallback(async () => {
    if (!selectedFY) return;
    try {
      const sc = await listScenarios(selectedFY.id);
      setScenarios(sc);
      // Default to "Base" if available, else first scenario
      if (sc.length > 0) {
        const base = sc.find((s) => s.name === "Base");
        setScenario(base ? base.name : sc[0].name);
      } else {
        setScenario("Base");
      }
    } catch {
      setScenarios([]);
      setScenario("Base");
    }
  }, [selectedFY]);

  useEffect(() => { loadScenarios(); }, [loadScenarios]);

  async function loadPSR() {
    if (!selectedFY) return;
    setLoading(true);
    setError("");
    setPsrData(null);
    try {
      const params = new URLSearchParams({ scenario });
      const resp = await fetch(`/api/fiscal-years/${selectedFY.id}/psr?${params}`);
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const data: PSRData = await resp.json();
      setPsrData(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Filter detail rows by project
  const filteredDetail = psrData
    ? psrData.detail.filter(
        (r) => !filterProject || r.project === filterProject
      )
    : [];

  // Group by project
  const projectGroups: { [project: string]: PSRRow[] } = {};
  for (const row of filteredDetail) {
    if (!projectGroups[row.project]) projectGroups[row.project] = [];
    projectGroups[row.project].push(row);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h2 className="text-lg font-bold mt-0 mb-1">Project Status Report</h2>
      <p className="text-muted-foreground text-sm mb-4">
        Full project profitability with indirect cost allocation, revenue, and margin analysis.
      </p>

      <FYSelector selected={selectedFY} onSelect={setSelectedFY} />

      {selectedFY && (
        <>
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
              onClick={loadPSR}
              disabled={loading}
              className="flex items-center gap-2 text-sm px-4 py-1.5"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Generate PSR
            </button>
            <button
              onClick={() => setShowRevenue(true)}
              className="flex items-center gap-2 text-sm px-4 py-1.5 bg-secondary!"
            >
              <Plus className="w-3 h-3" /> Revenue Data
              {revenueData.length > 0 && (
                <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                  {revenueData.length}
                </span>
              )}
            </button>
          </div>

          {error && <div className="error mb-4">{error}</div>}

          {/* PSR Results */}
          {psrData && (
            <>
              <SummaryCards summary={psrData.summary} />

              {/* Project filter */}
              {psrData.projects.length > 1 && (
                <div className="flex items-center gap-3 mb-4">
                  <label className="text-xs text-muted-foreground">Filter:</label>
                  <select
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                    value={filterProject}
                    onChange={(e) => setFilterProject(e.target.value)}
                  >
                    <option value="">All Projects</option>
                    {psrData.projects.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              )}

              <SummaryTable
                summary={
                  filterProject
                    ? psrData.summary.filter((s) => s.project === filterProject)
                    : psrData.summary
                }
              />

              {/* Per-project detail */}
              <h3 className="text-sm font-semibold mb-3">Period Detail</h3>
              {Object.entries(projectGroups)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([project, rows]) => (
                  <ProjectDetailTable key={project} project={project} rows={rows} />
                ))}
            </>
          )}

          {!psrData && !loading && !error && (
            <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
              Click &quot;Generate PSR&quot; to compute project profitability with indirect cost allocation.
              Add revenue data first for margin analysis.
            </div>
          )}

          {/* Revenue Dialog */}
          <RevenueDialog
            open={showRevenue}
            onClose={() => setShowRevenue(false)}
            fyId={selectedFY.id}
            existingRevenue={revenueData}
            onSaved={loadRevenue}
          />
        </>
      )}
    </div>
  );
}
