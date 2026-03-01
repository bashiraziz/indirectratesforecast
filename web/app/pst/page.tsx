"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { listScenarios, getPSTReport } from "@/lib/api";
import type { FiscalYear, Scenario, PSTData } from "@/lib/types";
import { FYSelector } from "@/app/components/FYSelector";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDollar(v: number): string {
  if (v === 0) return "—";
  const neg = v < 0;
  const abs = Math.abs(v);
  const formatted =
    abs >= 1000
      ? "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      : "$" + abs.toFixed(2);
  return neg ? `(${formatted})` : formatted;
}

function varianceClass(v: number, type: string): string {
  if (type === "Subtotal" || type === "GrandTotal") return "";
  if (v === 0) return "text-muted-foreground";
  return v > 0 ? "text-green-400" : "text-destructive";
}

function rowBg(type: string): string {
  if (type === "GrandTotal") return "bg-accent/60 font-bold border-t-2 border-border";
  if (type === "Subtotal") return "bg-accent/30 font-semibold border-t border-border";
  return "hover:bg-accent/20";
}

function generatePeriods(start: string, end: string): string[] {
  const periods: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy,
    m = sm;
  while (y < ey || (y === ey && m <= em)) {
    periods.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return periods;
}

function exportCSV(data: PSTData, fyName: string) {
  const cols = ["Category", "Type", "Selected_Period", "YTD", "ITD", "Budget", "Variance"];
  const rows = data.categories.map((r) =>
    [r.Category, r.Type, r.Selected_Period, r.YTD, r.ITD, r.Budget, r.Variance].join(",")
  );
  const csv = [cols.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `PST_${fyName}_${data.selected_period}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

function SummaryCards({ data }: { data: PSTData }) {
  const grand = data.categories.find((r) => r.Type === "GrandTotal");
  const totalDirect = data.categories.find((r) => r.Category === "Total Direct");
  const totalIndirect = data.categories.find((r) => r.Category === "Total Indirect");

  const cards = [
    { label: "Grand Total YTD", value: grand?.YTD ?? 0 },
    { label: "Direct YTD", value: totalDirect?.YTD ?? 0 },
    { label: "Indirect YTD", value: totalIndirect?.YTD ?? 0 },
    { label: "Variance (Budget − Actual)", value: grand?.Variance ?? 0, colored: true },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {cards.map((c) => (
        <div key={c.label} className="border border-border rounded-lg p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-1">{c.label}</div>
          <div
            className={`text-lg font-bold font-mono ${
              c.colored
                ? c.value > 0
                  ? "text-green-400"
                  : c.value < 0
                  ? "text-destructive"
                  : ""
                : ""
            }`}
          >
            {fmtDollar(c.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main PST Page
// ---------------------------------------------------------------------------

export default function PSTPage() {
  const [selectedFY, setSelectedFY] = useState<FiscalYear | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenario, setScenario] = useState("Base");
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [pstData, setPstData] = useState<PSTData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // When FY changes, default period to end_month
  useEffect(() => {
    if (selectedFY) {
      setSelectedPeriod(selectedFY.end_month);
      setPstData(null);
    }
  }, [selectedFY]);

  const loadScenarios = useCallback(async () => {
    if (!selectedFY) return;
    try {
      const sc = await listScenarios(selectedFY.id);
      setScenarios(sc);
      const base = sc.find((s) => s.name === "Base");
      setScenario(base ? base.name : sc.length > 0 ? sc[0].name : "Base");
    } catch {
      setScenarios([]);
      setScenario("Base");
    }
  }, [selectedFY]);

  useEffect(() => {
    loadScenarios();
  }, [loadScenarios]);

  async function loadPST() {
    if (!selectedFY || !selectedPeriod) return;
    setLoading(true);
    setError("");
    setPstData(null);
    try {
      const data = await getPSTReport(selectedFY.id, selectedPeriod, scenario);
      setPstData(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const periods = selectedFY ? generatePeriods(selectedFY.start_month, selectedFY.end_month) : [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-bold mt-0 mb-1">Project Status by Time</h2>
      <p className="text-muted-foreground text-sm mb-4">
        Cost category breakdown by selected period, YTD, ITD, budget, and variance.
      </p>

      <FYSelector selected={selectedFY} onSelect={setSelectedFY} />

      {selectedFY && (
        <>
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-3 mb-6">
            <div>
              <label className="text-xs block mb-1">As-of Period</label>
              <select
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono"
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
              >
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1">Scenario</label>
              <select
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
              >
                {scenarios.length === 0 && <option value="Base">Base</option>}
                {scenarios.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={loadPST}
              disabled={loading || !selectedPeriod}
              className="flex items-center gap-2 text-sm px-4 py-1.5"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Generate PST
            </button>
            {pstData && (
              <button
                onClick={() => exportCSV(pstData, selectedFY.name)}
                className="flex items-center gap-2 text-sm px-4 py-1.5 bg-secondary!"
              >
                <Download className="w-4 h-4" /> Export CSV
              </button>
            )}
          </div>

          {error && <div className="error mb-4">{error}</div>}

          {pstData && (
            <>
              <SummaryCards data={pstData} />

              <div className="border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-card border-b border-border flex items-center justify-between">
                  <span className="font-semibold text-sm">
                    PST — As of {pstData.selected_period}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    FY: {selectedFY.start_month} — {selectedFY.end_month} · Scenario: {scenario}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-accent/30">
                        <th className="text-left px-4 py-2 font-medium">Cost Category</th>
                        <th className="text-right px-4 py-2 font-medium">Sel. Period</th>
                        <th className="text-right px-4 py-2 font-medium">YTD</th>
                        <th className="text-right px-4 py-2 font-medium">ITD</th>
                        <th className="text-right px-4 py-2 font-medium">Budget (YTD)</th>
                        <th className="text-right px-4 py-2 font-medium">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pstData.categories.map((row, i) => (
                        <tr key={i} className={`${rowBg(row.Type)}`}>
                          <td className="px-4 py-2">
                            {row.Type === "Direct" || row.Type === "Indirect" ? (
                              <span className="ml-4">{row.Category}</span>
                            ) : (
                              row.Category
                            )}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {fmtDollar(row.Selected_Period)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">{fmtDollar(row.YTD)}</td>
                          <td className="px-4 py-2 text-right font-mono">{fmtDollar(row.ITD)}</td>
                          <td className="px-4 py-2 text-right font-mono">
                            {fmtDollar(row.Budget)}
                          </td>
                          <td
                            className={`px-4 py-2 text-right font-mono ${varianceClass(
                              row.Variance,
                              row.Type
                            )}`}
                          >
                            {fmtDollar(row.Variance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-xs text-muted-foreground mt-3">
                Variance = Budget − Actual YTD. Positive (green) = under budget (favorable).
                Negative (red) = over budget (unfavorable).
              </p>
            </>
          )}

          {!pstData && !loading && !error && (
            <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
              Select a period and scenario, then click &quot;Generate PST&quot; to view the cost
              category breakdown with YTD, ITD, and budget variance.
            </div>
          )}
        </>
      )}
    </div>
  );
}
