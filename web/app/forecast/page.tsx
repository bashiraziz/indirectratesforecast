"use client";

import JSZip from "jszip";
import { useEffect, useState, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import * as XLSX from "xlsx";

import { ChatPanel } from "../components/ChatPanel";
import {
  listScenarios,
  listForecastRuns,
  deleteForecastRun,
  downloadForecastRun,
  listEntities,
  parseApiError,
} from "@/lib/api";
import type { Scenario, ForecastRun } from "@/lib/types";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

interface GridData {
  headers: string[];
  rows: (string | number)[][];
}

type FileCheck = {
  status: "missing" | "validating" | "valid" | "error";
  issues: string[];
};

function fmtCell(val: string | number, header: string, isRatesTable: boolean): string {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "string") return val;
  if (isRatesTable && header !== "Period") {
    return (val * 100).toFixed(2) + "%";
  }
  if (header.endsWith("$") || header.endsWith("$_ytd") || header.includes("Dollar") || header.includes("$ (")) {
    return "$" + val.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  if (typeof val === "number" && !Number.isInteger(val)) {
    return val.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return String(val);
}

function exportGridCsv(headers: string[], rows: (string | number)[][], filename: string) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) {
    lines.push(row.map(escape).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function statusPill(check: FileCheck | undefined, required: boolean): { label: string; bg: string; fg: string } {
  if (!check || check.status === "missing") {
    return required
      ? { label: "Required", bg: "rgba(239,68,68,0.12)", fg: "rgb(220,60,60)" }
      : { label: "Optional", bg: "rgba(148,163,184,0.18)", fg: "var(--color-muted-foreground)" };
  }
  if (check.status === "validating") {
    return { label: "Validating", bg: "rgba(59,130,246,0.14)", fg: "rgb(59,130,246)" };
  }
  if (check.status === "valid") {
    return { label: "Valid", bg: "rgba(34,197,94,0.15)", fg: "rgb(22,163,74)" };
  }
  return { label: "Issues", bg: "rgba(239,68,68,0.15)", fg: "rgb(220,60,60)" };
}

function FileDropField({
  id,
  label,
  accept,
  file,
  required,
  helper,
  check,
  onFile,
  onTemplateDownload,
}: {
  id: string;
  label: string;
  accept: string;
  file: File | null;
  required: boolean;
  helper?: string;
  check?: FileCheck;
  onFile: (f: File | null) => void;
  onTemplateDownload?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const pill = statusPill(check, required);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    onFile(e.dataTransfer.files?.[0] ?? null);
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <label className="muted" style={{ fontSize: 13, margin: 0 }}>{label}</label>
        <span
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 999,
            background: pill.bg,
            color: pill.fg,
          }}
        >
          {pill.label}
        </span>
        {onTemplateDownload && (
          <button
            type="button"
            className="btn btn-outline"
            style={{ marginLeft: "auto", fontSize: 11, padding: "2px 8px" }}
            onClick={onTemplateDownload}
          >
            Template
          </button>
        )}
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
        aria-label={`Upload ${label}`}
        style={{
          border: `1px dashed ${dragging ? "var(--color-primary)" : "var(--color-border)"}`,
          borderRadius: 8,
          padding: "10px 12px",
          cursor: "pointer",
          background: dragging ? "color-mix(in srgb, var(--color-primary) 8%, transparent)" : "transparent",
        }}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          style={{ display: "none" }}
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <div style={{ fontSize: 12 }}>
          {file ? (
            <span>{file.name}</span>
          ) : (
            <span className="muted">Drop file here, or click to browse.</span>
          )}
        </div>
        {helper && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{helper}</div>}
      </div>
      {check?.status === "error" && check.issues.length > 0 && (
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          {check.issues.slice(0, 2).join(" ")}
        </div>
      )}
    </div>
  );
}

function aggregateYearly(data: GridData, isRatesTable: boolean): GridData {
  const yearMap = new Map<string, { values: (number | string)[][]; count: number }>();
  for (const row of data.rows) {
    const period = String(row[0] ?? "");
    const year = period.length >= 4 ? period.substring(0, 4) : period;
    if (!yearMap.has(year)) yearMap.set(year, { values: [], count: 0 });
    yearMap.get(year)!.values.push(row);
    yearMap.get(year)!.count++;
  }
  const rows: (number | string)[][] = [];
  for (const [year, { values }] of yearMap) {
    const agg: (number | string)[] = [year];
    for (let ci = 1; ci < data.headers.length; ci++) {
      const nums = values.map((r) => r[ci]).filter((v) => typeof v === "number") as number[];
      if (nums.length === 0) { agg.push("—"); continue; }
      // Rates: average; dollar amounts: sum
      agg.push(isRatesTable ? nums.reduce((a, b) => a + b, 0) / nums.length : nums.reduce((a, b) => a + b, 0));
    }
    rows.push(agg);
  }
  return { headers: data.headers, rows };
}

function GridTable({ title, data, isRatesTable, budgetRates, thresholdRates, onCellClick, compact = false }: { title: string; data: GridData; isRatesTable: boolean; budgetRates?: Record<string, Record<string, number>> | null; thresholdRates?: Record<string, Record<string, number>> | null; onCellClick?: (period: string, header: string, value: string | number) => void; compact?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [yearlyView, setYearlyView] = useState(false);
  const displayData = yearlyView ? aggregateYearly(data, isRatesTable) : data;
  return (
    <div className="border border-border rounded-lg overflow-hidden mb-4">
      <div
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors bg-card"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span style={{ fontSize: 12, fontFamily: "monospace" }}>{collapsed ? "\u25B6" : "\u25BC"}</span>
        <span className="font-semibold text-sm">{title}</span>
        <span className="text-xs text-muted-foreground ml-auto">{displayData.rows.length} rows</span>
        <button
          onClick={(e) => { e.stopPropagation(); setYearlyView((v) => !v); }}
          style={{ fontSize: 11, padding: "2px 8px", marginLeft: 8 }}
          className="bg-secondary!"
          title={yearlyView ? "Switch to monthly view" : "Switch to yearly view"}
        >
          {yearlyView ? "Monthly" : "Yearly"}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); exportGridCsv(displayData.headers, displayData.rows, `${title.toLowerCase().replace(/\s+/g, "_")}.csv`); }}
          style={{ fontSize: 11, padding: "2px 8px", marginLeft: 4 }}
          className="bg-secondary!"
        >
          Export CSV
        </button>
      </div>
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-accent/30">
                {displayData.headers.map((h, i) => {
                  const isYtd = h.endsWith("(YTD)");
                  const isMtdGroup = h.endsWith("(MTD)");
                  return (
                    <th
                      key={i}
                      className={`${compact ? "px-2 py-1.5" : "px-3 py-2"} font-medium min-w-20 ${
                        i === 0 ? "text-left sticky left-0 bg-accent/30 min-w-30" : "text-right"
                      } `}
                      style={{
                        fontFamily: "monospace",
                        borderLeft: isMtdGroup ? "2px solid var(--border)" : undefined,
                        backgroundColor: isYtd ? "rgba(99,140,255,0.15)" : undefined,
                      }}
                    >
                      {h}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayData.rows.map((row, ri) => {
                const period = String(row[0] ?? "");
                return (
                  <tr key={ri} className="border-b border-border/50">
                    {row.map((cell, ci) => {
                      const hdr = displayData.headers[ci];
                      const isYtd = hdr.endsWith("(YTD)");
                      const isMtdGroup = hdr.endsWith("(MTD)");
                      // Budget comparison for rate cells
                      let bgColor: string | undefined = isYtd ? "rgba(99,140,255,0.08)" : undefined;
                      if (isRatesTable && ci > 0 && typeof cell === "number") {
                        const rateName = hdr.replace(" (MTD)", "").replace(" (YTD)", "");
                        if (budgetRates) {
                          const budgetVal = budgetRates[rateName]?.[period];
                          if (budgetVal !== undefined) {
                            if (cell > budgetVal) bgColor = "rgba(239,68,68,0.18)";      // over budget — red
                            else if (cell < budgetVal * 0.9) bgColor = "rgba(34,197,94,0.15)"; // >10% under — green
                          }
                        }
                        // Threshold breach overrides budget highlighting with stronger red
                        if (thresholdRates) {
                          const threshVal = thresholdRates[rateName]?.[period];
                          if (threshVal !== undefined && cell > threshVal) {
                            bgColor = "rgba(239,68,68,0.30)";
                          }
                        }
                      }
                      const clickable = onCellClick && ci > 0 && typeof cell === "number";
                      return (
                        <td
                          key={ci}
                          className={`${compact ? "px-2 py-1.5" : "px-3 py-2"} ${
                            ci === 0
                              ? "font-medium sticky left-0 bg-background/80"
                              : "text-right font-mono"
                          }`}
                          style={{
                            borderLeft: isMtdGroup ? "2px solid var(--border)" : undefined,
                            backgroundColor: bgColor,
                            cursor: clickable ? "pointer" : undefined,
                          }}
                          onClick={clickable ? () => onCellClick(period, hdr, cell) : undefined}
                          title={clickable ? "Click to see pool/base breakdown" : undefined}
                        >
                          {fmtCell(cell, hdr, isRatesTable)}
                        </td>
                      );
                    })}
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

function ScenarioComparisonTable({ data, baseScenario, compact = false }: { data: Map<string, GridData>; baseScenario: string; compact?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const scenarioNames = Array.from(data.keys());
  const base = data.get(baseScenario) ?? data.get(scenarioNames[0])!;
  const baseName = data.has(baseScenario) ? baseScenario : scenarioNames[0];
  const rateNames = base.headers.filter(h => h !== "Period");
  const otherScenarios = scenarioNames.filter(s => s !== baseName);

  // Build merged headers: Period | Rate(Base) | Rate(Scen2) | Rate(Δ) | ...
  const headers: string[] = ["Period"];
  for (const rn of rateNames) {
    headers.push(`${rn} (${baseName})`);
    for (const os of otherScenarios) {
      headers.push(`${rn} (${os})`);
      headers.push(`${rn} (Δ ${os})`);
    }
  }

  // Build rows aligned by period
  const periodIdx = base.headers.indexOf("Period");
  const scenLookups = new Map<string, Map<string, (string | number)[]>>();
  for (const [sn, gd] of data) {
    const pIdx = gd.headers.indexOf("Period");
    const lookup = new Map<string, (string | number)[]>();
    for (const row of gd.rows) lookup.set(String(row[pIdx]), row);
    scenLookups.set(sn, lookup);
  }

  const rows: (string | number)[][] = base.rows.map(baseRow => {
    const period = String(baseRow[periodIdx]);
    const row: (string | number)[] = [period];
    for (const rn of rateNames) {
      const baseRateIdx = base.headers.indexOf(rn);
      const baseVal = typeof baseRow[baseRateIdx] === "number" ? (baseRow[baseRateIdx] as number) : 0;
      row.push(baseVal);
      for (const os of otherScenarios) {
        const osData = data.get(os)!;
        const osRow = scenLookups.get(os)?.get(period);
        const osRateIdx = osData.headers.indexOf(rn);
        const osVal = osRow && typeof osRow[osRateIdx] === "number" ? (osRow[osRateIdx] as number) : 0;
        row.push(osVal);
        row.push(osVal - baseVal);
      }
    }
    return row;
  });

  const gridData: GridData = { headers, rows };

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-4">
      <div
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors bg-card"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span style={{ fontSize: 12, fontFamily: "monospace" }}>{collapsed ? "\u25B6" : "\u25BC"}</span>
        <span className="font-semibold text-sm">Scenario Comparison</span>
        <span className="text-xs text-muted-foreground ml-auto">{scenarioNames.length} scenarios, {rows.length} periods</span>
        <button
          onClick={(e) => { e.stopPropagation(); exportGridCsv(headers, rows, "scenario_comparison.csv"); }}
          style={{ fontSize: 11, padding: "2px 8px", marginLeft: 8 }}
          className="bg-secondary!"
        >
          Export CSV
        </button>
      </div>
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-accent/30">
                {headers.map((h, i) => {
                  const isDelta = h.includes("(Δ ");
                  return (
                    <th
                      key={i}
                      className={`${compact ? "px-2 py-1.5" : "px-3 py-2"} font-medium min-w-20 ${i === 0 ? "text-left sticky left-0 bg-accent/30 min-w-30" : "text-right"}`}
                      style={{
                        fontFamily: "monospace",
                        backgroundColor: isDelta ? "rgba(99,140,255,0.12)" : undefined,
                      }}
                    >
                      {h}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-border/50">
                  {row.map((cell, ci) => {
                    const hdr = headers[ci];
                    const isDelta = hdr.includes("(Δ ");
                    let bgColor: string | undefined;
                    if (isDelta && typeof cell === "number" && cell !== 0) {
                      bgColor = cell > 0 ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)";
                    }
                    return (
                      <td
                        key={ci}
                        className={`${compact ? "px-2 py-1.5" : "px-3 py-2"} ${ci === 0 ? "font-medium sticky left-0 bg-background/80" : "text-right font-mono"}`}
                        style={{ backgroundColor: bgColor }}
                      >
                        {ci === 0 ? String(cell) : typeof cell === "number"
                          ? (isDelta ? (cell >= 0 ? "+" : "") : "") + (cell * 100).toFixed(2) + "%"
                          : String(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const FY_START_OPTIONS = [
  { value: 1, label: "January (Calendar Year)" },
  { value: 4, label: "April (UK / India)" },
  { value: 7, label: "July (Australia / NY State)" },
  { value: 10, label: "October (US Federal)" },
];

/**
 * Derive fiscal year label from a YYYY-MM period string.
 * fyStartMonth: 1=Jan (calendar year), 7=Jul, 10=Oct (US govt), etc.
 * E.g. fyStartMonth=10: Oct 2025 → FY2026, Sep 2025 → FY2025.
 */
function fiscalYearOf(period: string, fyStartMonth: number): string {
  const [yyyy, mm] = period.split("-").map(Number);
  const fy = mm >= fyStartMonth ? yyyy + (fyStartMonth === 1 ? 0 : 1) : yyyy;
  return `FY${fy}`;
}

/**
 * Impacts table with FY total rows and a toggle to collapse project detail.
 * Expects headers like: Period, Project, DirectLabor$, Subk, ...
 */
/** overBudgetKeys: Set of "RateName|Period" strings where the actual rate exceeds budget */
function ImpactsTable({ data, fyStartMonth, overBudgetKeys, compact = false }: { data: GridData; fyStartMonth: number; overBudgetKeys?: Set<string>; compact?: boolean }) {
  const [sectionCollapsed, setSectionCollapsed] = useState(false);
  const [showDetail, setShowDetail] = useState(true);
  const [showMtd, setShowMtd] = useState(true);
  const [showYtd, setShowYtd] = useState(true);
  const [yearlyOnly, setYearlyOnly] = useState(false);
  const [collapsedFYs, setCollapsedFYs] = useState<Set<string>>(new Set());

  const periodIdx = data.headers.indexOf("Period");
  const projectIdx = data.headers.indexOf("Project");

  // Classify columns: base (Period, Project, direct costs), MTD, YTD
  const hasMtdCols = data.headers.some((h) => h.includes("(MTD)"));
  const hasYtdCols = data.headers.some((h) => h.includes("(YTD)"));
  const visibleColIndices = data.headers
    .map((h, i) => {
      if (h.includes("(MTD)") && !showMtd) return -1;
      if (h.includes("(YTD)") && !showYtd) return -1;
      return i;
    })
    .filter((i) => i >= 0);

  // Map column index → rate name for indirect $ columns
  const colToRateName = new Map<number, string>();
  data.headers.forEach((h, i) => {
    if (h.includes("$ (MTD)") || h.includes("$ (YTD)")) {
      const rateName = h.replace("$ (MTD)", "").replace("$ (YTD)", "");
      if (rateName !== "LoadedCost" && rateName !== "TotalIndirect") {
        colToRateName.set(i, rateName);
      }
    }
  });

  // Build display rows: group by FY, insert total rows + grand total
  const displayRows: { row: (string | number)[]; isTotalRow: boolean; isGrandTotal: boolean; fy: string }[] = [];
  const fyOrder: string[] = [];
  const fyGroups = new Map<string, (string | number)[][]>();

  for (const row of data.rows) {
    const period = String(row[periodIdx] ?? "");
    const fy = fiscalYearOf(period, fyStartMonth);
    if (!fyGroups.has(fy)) {
      fyGroups.set(fy, []);
      fyOrder.push(fy);
    }
    fyGroups.get(fy)!.push(row);
  }

  function sumRows(rows: (string | number)[][], periodLabel: string): (string | number)[] {
    return data.headers.map((h, ci) => {
      if (ci === periodIdx) return periodLabel;
      if (ci === projectIdx) return "TOTAL";
      let sum = 0;
      let hasNum = false;
      for (const r of rows) {
        const v = r[ci];
        if (typeof v === "number") { sum += v; hasNum = true; }
      }
      return hasNum ? sum : "";
    });
  }

  // Per-project yearly aggregation: (FY, Project) → summed row
  const fyProjectRows = new Map<string, Map<string, (string | number)[][]>>();
  for (const row of data.rows) {
    const period = String(row[periodIdx] ?? "");
    const fy = fiscalYearOf(period, fyStartMonth);
    const project = String(row[projectIdx] ?? "");
    if (!fyProjectRows.has(fy)) fyProjectRows.set(fy, new Map());
    const pm = fyProjectRows.get(fy)!;
    if (!pm.has(project)) pm.set(project, []);
    pm.get(project)!.push(row);
  }

  const yearlyRows: { row: (string | number)[]; isTotalRow: boolean; isGrandTotal: boolean; fy: string }[] = [];
  for (const fy of fyOrder) {
    const pm = fyProjectRows.get(fy)!;
    for (const [project, rows] of pm) {
      const aggRow = data.headers.map((h, ci) => {
        if (ci === periodIdx) return fy;
        if (ci === projectIdx) return project;
        let sum = 0; let hasNum = false;
        for (const r of rows) { const v = r[ci]; if (typeof v === "number") { sum += v; hasNum = true; } }
        return hasNum ? sum : "";
      });
      yearlyRows.push({ row: aggRow, isTotalRow: false, isGrandTotal: false, fy });
    }
    yearlyRows.push({ row: sumRows(fyGroups.get(fy)!, fy), isTotalRow: true, isGrandTotal: false, fy });
  }
  yearlyRows.push({ row: sumRows(data.rows, "GRAND"), isTotalRow: true, isGrandTotal: true, fy: "" });

  // Flat list for yearly view: FY header entries interleaved with data rows
  type YearlyItem =
    | { kind: "fyHeader"; fy: string }
    | { kind: "data"; d: (typeof yearlyRows)[0] };
  const yearlyDisplayItems: YearlyItem[] = [];
  for (const fy of fyOrder) {
    yearlyDisplayItems.push({ kind: "fyHeader", fy });
    const isCollapsed = collapsedFYs.has(fy);
    for (const d of yearlyRows.filter((r) => r.fy === fy)) {
      if (d.isTotalRow) {
        yearlyDisplayItems.push({ kind: "data", d }); // always show FY total
      } else if (!isCollapsed && showDetail) {
        yearlyDisplayItems.push({ kind: "data", d });
      }
    }
  }
  const grandTotalEntry = yearlyRows.find((r) => r.isGrandTotal);
  if (grandTotalEntry) yearlyDisplayItems.push({ kind: "data", d: grandTotalEntry });

  for (const fy of fyOrder) {
    const rows = fyGroups.get(fy)!;
    for (const r of rows) {
      displayRows.push({ row: r, isTotalRow: false, isGrandTotal: false, fy });
    }
    displayRows.push({ row: sumRows(rows, fy), isTotalRow: true, isGrandTotal: false, fy });
  }

  // Grand total across all rows
  displayRows.push({ row: sumRows(data.rows, "GRAND"), isTotalRow: true, isGrandTotal: true, fy: "" });

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-4">
      <div
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors bg-card"
        onClick={() => setSectionCollapsed(!sectionCollapsed)}
      >
        <span style={{ fontSize: 12, fontFamily: "monospace" }}>{sectionCollapsed ? "\u25B6" : "\u25BC"}</span>
        <span className="font-semibold text-sm">Project Impacts</span>
        <span className="text-xs text-muted-foreground ml-auto">{data.rows.length} rows</span>
        <button
          onClick={(e) => { e.stopPropagation(); setYearlyOnly((v) => !v); }}
          style={{ fontSize: 11, padding: "2px 8px", marginLeft: 8 }}
          className="bg-secondary!"
          title={yearlyOnly ? "Switch to monthly view" : "Show yearly totals only"}
        >
          {yearlyOnly ? "Monthly" : "Yearly"}
        </button>
        {yearlyOnly && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const allCollapsed = fyOrder.every((fy) => collapsedFYs.has(fy));
              setCollapsedFYs(allCollapsed ? () => new Set() : () => new Set(fyOrder));
            }}
            style={{ fontSize: 11, padding: "2px 8px", marginLeft: 4 }}
            className="bg-secondary!"
            title={fyOrder.every((fy) => collapsedFYs.has(fy)) ? "Expand all years" : "Collapse all years"}
          >
            {fyOrder.every((fy) => collapsedFYs.has(fy)) ? "Expand All" : "Collapse All"}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); exportGridCsv(data.headers, data.rows, "project_impacts.csv"); }}
          style={{ fontSize: 11, padding: "2px 8px", marginLeft: 4 }}
          className="bg-secondary!"
        >
          Export CSV
        </button>
      </div>
      {!sectionCollapsed && (
        <>
          <div className="px-4 py-2 border-b border-border bg-card flex items-center gap-3 flex-wrap">
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12 }}>
              <input
                type="checkbox"
                checked={showDetail}
                onChange={() => setShowDetail(!showDetail)}
              />
              Show project detail
            </label>
            {hasMtdCols && hasYtdCols && (
              <>
                <span style={{ fontSize: 11, opacity: 0.5, margin: "0 2px" }}>|</span>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: showMtd && !showYtd ? "not-allowed" : "pointer", opacity: showMtd && !showYtd ? 0.5 : 1 }}
                  title={showMtd && !showYtd ? "At least one column group must be visible" : ""}
                >
                  <input
                    type="checkbox"
                    checked={showMtd}
                    disabled={showMtd && !showYtd}
                    onChange={() => setShowMtd(!showMtd)}
                  />
                  MTD columns
                </label>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: showYtd && !showMtd ? "not-allowed" : "pointer", opacity: showYtd && !showMtd ? 0.5 : 1, backgroundColor: "rgba(99,140,255,0.10)", padding: "2px 8px", borderRadius: 4 }}
                  title={showYtd && !showMtd ? "At least one column group must be visible" : ""}
                >
                  <input
                    type="checkbox"
                    checked={showYtd}
                    disabled={showYtd && !showMtd}
                    onChange={() => setShowYtd(!showYtd)}
                  />
                  YTD columns
                </label>
              </>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-accent/30">
                  {visibleColIndices.map((i) => {
                    const h = data.headers[i];
                    const isYtd = h.includes("(YTD)");
                    const isMtdGroup = h.includes("(MTD)");
                    return (
                      <th
                        key={i}
                        className={`${compact ? "px-2 py-1.5" : "px-3 py-2"} font-medium min-w-20 ${
                          i <= 1 ? "text-left sticky bg-accent/30 min-w-30" : "text-right"
                        }`}
                        style={{
                          fontFamily: "monospace",
                          left: i === 0 ? 0 : i === 1 ? "7.5rem" : undefined,
                          zIndex: i === 0 ? 3 : i === 1 ? 2 : 0,
                          borderLeft: isMtdGroup ? "2px solid var(--border)" : undefined,
                          backgroundColor: isYtd ? "rgba(99,140,255,0.15)" : undefined,
                        }}
                      >
                        {h}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {yearlyOnly ? (
                  yearlyDisplayItems.map((item, ri) => {
                    if (item.kind === "fyHeader") {
                      const isCollapsed = collapsedFYs.has(item.fy);
                      return (
                        <tr
                          key={`fy-hdr-${item.fy}`}
                          className="border-b border-border bg-accent/40 cursor-pointer hover:bg-accent/60 select-none"
                          onClick={() =>
                            setCollapsedFYs((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.fy)) next.delete(item.fy);
                              else next.add(item.fy);
                              return next;
                            })
                          }
                        >
                          <td
                            colSpan={visibleColIndices.length}
                            style={{ padding: "5px 12px", fontWeight: 700, fontSize: 12 }}
                          >
                            <span style={{ fontFamily: "monospace", marginRight: 6 }}>
                              {isCollapsed ? "▶" : "▼"}
                            </span>
                            {item.fy}
                          </td>
                        </tr>
                      );
                    }
                    const { d } = item;
                    return (
                      <tr
                        key={`yr-${ri}`}
                        className={`border-b ${
                          d.isGrandTotal
                            ? "border-border border-t-2 bg-accent/40 font-bold"
                            : d.isTotalRow
                              ? "border-border bg-accent/20 font-semibold"
                              : "border-border/50"
                        }`}
                      >
                        {visibleColIndices.map((ci) => {
                          const hdr = data.headers[ci];
                          const isYtd = hdr.includes("(YTD)");
                          const isMtdGroup = hdr.includes("(MTD)");
                          const period = String(d.row[periodIdx] ?? "");
                          const rateName = colToRateName.get(ci);
                          const isOver = !d.isTotalRow && rateName && overBudgetKeys?.has(`${rateName}|${period}`);
                          let bgColor: string | undefined;
                          if (d.isGrandTotal) {
                            bgColor = isYtd ? "rgba(99,140,255,0.22)" : "rgba(130,130,160,0.18)";
                          } else if (d.isTotalRow) {
                            bgColor = isYtd ? "rgba(99,140,255,0.15)" : "rgba(130,130,160,0.10)";
                          } else {
                            bgColor = isYtd ? "rgba(99,140,255,0.08)" : undefined;
                          }
                          if (isOver) bgColor = "rgba(239,68,68,0.18)";
                          return (
                            <td
                              key={ci}
                              className={`${compact ? "px-2 py-1.5" : "px-3 py-2"} ${
                                ci <= 1
                                  ? `sticky font-medium ${d.isTotalRow ? "" : "bg-background/80"}`
                                  : "text-right font-mono"
                              } ${d.isTotalRow ? "font-semibold" : ""} ${d.isGrandTotal ? "font-bold" : ""}`}
                              style={{
                                left: ci === 0 ? 0 : ci === 1 ? "7.5rem" : undefined,
                                zIndex: ci === 0 ? 3 : ci === 1 ? 2 : 0,
                                borderLeft: isMtdGroup ? "2px solid var(--border)" : undefined,
                                backgroundColor: ci <= 1 && d.isTotalRow
                                  ? (d.isGrandTotal ? "rgba(130,130,160,0.22)" : "rgba(130,130,160,0.14)")
                                  : bgColor,
                              }}
                            >
                              {fmtCell(d.row[ci], hdr, false)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                ) : (
                  displayRows
                    .filter((d) => showDetail || d.isTotalRow)
                    .map((d, ri) => (
                      <tr
                        key={ri}
                        className={`border-b ${
                          d.isGrandTotal
                            ? "border-border border-t-2 bg-accent/40 font-bold"
                            : d.isTotalRow
                              ? "border-border bg-accent/20 font-semibold"
                              : "border-border/50"
                        }`}
                      >
                        {visibleColIndices.map((ci) => {
                          const hdr = data.headers[ci];
                          const isYtd = hdr.includes("(YTD)");
                          const isMtdGroup = hdr.includes("(MTD)");
                          const period = String(d.row[periodIdx] ?? "");
                          const rateName = colToRateName.get(ci);
                          const isOver = !d.isTotalRow && rateName && overBudgetKeys?.has(`${rateName}|${period}`);
                          let bgColor: string | undefined;
                          if (d.isGrandTotal) {
                            bgColor = isYtd ? "rgba(99,140,255,0.22)" : "rgba(130,130,160,0.18)";
                          } else if (d.isTotalRow) {
                            bgColor = isYtd ? "rgba(99,140,255,0.15)" : "rgba(130,130,160,0.10)";
                          } else {
                            bgColor = isYtd ? "rgba(99,140,255,0.08)" : undefined;
                          }
                          if (isOver) bgColor = "rgba(239,68,68,0.18)";
                          return (
                            <td
                              key={ci}
                              className={`${compact ? "px-2 py-1.5" : "px-3 py-2"} ${
                                ci <= 1
                                  ? `sticky font-medium ${d.isTotalRow ? "" : "bg-background/80"}`
                                  : "text-right font-mono"
                              } ${d.isTotalRow ? "font-semibold" : ""} ${d.isGrandTotal ? "font-bold" : ""}`}
                              style={{
                                left: ci === 0 ? 0 : ci === 1 ? "7.5rem" : undefined,
                                zIndex: ci === 0 ? 3 : ci === 1 ? 2 : 0,
                                borderLeft: isMtdGroup ? "2px solid var(--border)" : undefined,
                                backgroundColor: ci <= 1 && d.isTotalRow
                                  ? (d.isGrandTotal ? "rgba(130,130,160,0.22)" : "rgba(130,130,160,0.14)")
                                  : bgColor,
                              }}
                            >
                              {fmtCell(d.row[ci], hdr, false)}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

interface FiscalYear {
  id: number;
  name: string;
  start_month: string;
  end_month: string;
}

type InputMode = "upload" | "db";

/** Guess the data directory from the FY name. */
function guessDataDir(fyName: string): string {
  if (fyName.startsWith("DEMO-")) return "data_demo";
  if (fyName.includes("TEST")) return "data_test";
  return "data";
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type CsvRule = {
  required: string[];
  numeric?: string[];
  period?: string[];
};

const CSV_RULES: Record<string, CsvRule> = {
  "GL_Actuals.csv": {
    required: ["Period", "Account", "Amount"],
    numeric: ["Amount"],
    period: ["Period"],
  },
  "Account_Map.csv": {
    required: ["Account", "Pool", "BaseCategory", "IsUnallowable"],
  },
  "Direct_Costs_By_Project.csv": {
    required: ["Period", "Project", "DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"],
    numeric: ["DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"],
    period: ["Period"],
  },
  "Scenario_Events.csv": {
    required: ["Scenario", "EffectivePeriod", "Type"],
    numeric: [
      "DeltaDirectLabor$",
      "DeltaDirectLaborHrs",
      "DeltaSubk",
      "DeltaODC",
      "DeltaTravel",
      "DeltaPoolFringe",
      "DeltaPoolOverhead",
      "DeltaPoolGA",
    ],
    period: ["EffectivePeriod"],
  },
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function parseCsvAoaFromArrayBuffer(buf: ArrayBuffer): string[][] {
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { header: 1, defval: "" }) as unknown[][];
  return aoa.map((row) => row.map((cell) => String(cell ?? "").trim()));
}

function parseCsvAoaFromText(text: string): string[][] {
  const wb = XLSX.read(text, { type: "string" });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { header: 1, defval: "" }) as unknown[][];
  return aoa.map((row) => row.map((cell) => String(cell ?? "").trim()));
}

function validateCsvRows(canonicalName: string, rows: string[][]): string[] {
  const rule = CSV_RULES[canonicalName];
  if (!rule) return [];

  const issues: string[] = [];
  const pushIssue = (message: string) => {
    if (issues.length < 12) issues.push(message);
  };

  if (!rows.length) {
    pushIssue(`${canonicalName}: file is empty.`);
    return issues;
  }

  const headers = rows[0] ?? [];
  const headerToIndex = new Map<string, number>();
  headers.forEach((h, i) => headerToIndex.set(normalizeHeader(h), i));

  const missing = rule.required.filter((h) => !headerToIndex.has(normalizeHeader(h)));
  if (missing.length > 0) {
    pushIssue(`${canonicalName}: missing required columns: ${missing.join(", ")}.`);
    return issues;
  }

  let dataRows = 0;
  for (let i = 1; i < rows.length && dataRows < 200; i++) {
    const row = rows[i] ?? [];
    const hasData = row.some((cell) => cell.trim() !== "");
    if (!hasData) continue;
    dataRows += 1;

    for (const periodCol of rule.period ?? []) {
      const idx = headerToIndex.get(normalizeHeader(periodCol));
      if (idx === undefined) continue;
      const value = row[idx]?.trim() ?? "";
      if (!value) {
        pushIssue(`${canonicalName} row ${i + 1}: ${periodCol} is blank.`);
      } else if (!PERIOD_RE.test(value)) {
        pushIssue(`${canonicalName} row ${i + 1}: ${periodCol} must be YYYY-MM (got '${value}').`);
      }
    }

    for (const numericCol of rule.numeric ?? []) {
      const idx = headerToIndex.get(normalizeHeader(numericCol));
      if (idx === undefined) continue;
      const raw = row[idx]?.trim() ?? "";
      if (!raw) continue;
      const num = Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(num)) {
        pushIssue(`${canonicalName} row ${i + 1}: ${numericCol} must be numeric (got '${raw}').`);
      }
    }

    if (issues.length >= 12) break;
  }

  if (!dataRows) {
    pushIssue(`${canonicalName}: no data rows found.`);
  }
  return issues;
}

async function validateCsvFile(canonicalName: string, file: File): Promise<string[]> {
  try {
    const buf = await file.arrayBuffer();
    const rows = parseCsvAoaFromArrayBuffer(buf);
    return validateCsvRows(canonicalName, rows);
  } catch {
    return [`${canonicalName}: could not parse CSV.`];
  }
}

async function validateInputZip(zipFile: File): Promise<string[]> {
  try {
    const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
    const files = Object.values(zip.files).filter((f) => !f.dir);
    const byBaseName = new Map<string, JSZip.JSZipObject>();
    for (const file of files) {
      const baseName = file.name.split("/").pop() ?? file.name;
      byBaseName.set(baseName.toLowerCase(), file);
    }

    const issues: string[] = [];
    for (const requiredName of Object.keys(CSV_RULES)) {
      const entry = byBaseName.get(requiredName.toLowerCase());
      if (!entry) {
        issues.push(`ZIP is missing ${requiredName}.`);
        continue;
      }
      const text = await entry.async("string");
      const rows = parseCsvAoaFromText(text);
      issues.push(...validateCsvRows(requiredName, rows));
      if (issues.length >= 12) break;
    }
    return issues.slice(0, 12);
  } catch {
    return ["Selected ZIP could not be read."];
  }
}

export default function ForecastPage() {
  const { data: session } = authClient.useSession();
  const [demoMode, setDemoMode] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("upload");
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [selectedFyId, setSelectedFyId] = useState<number | null>(null);

  const [zipFile, setZipFile] = useState<File | null>(null);
  const [gl, setGl] = useState<File | null>(null);
  const [map, setMap] = useState<File | null>(null);
  const [direct, setDirect] = useState<File | null>(null);
  const [events, setEvents] = useState<File | null>(null);
  const [config, setConfig] = useState<File | null>(null);

  const [scenario, setScenario] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [forecastMonths, setForecastMonths] = useState(12);
  const [runRateMonths, setRunRateMonths] = useState(3);
  const [dataDir, setDataDir] = useState("data");
  const [compareMode, setCompareMode] = useState(false);
  const [allScenariosRates, setAllScenariosRates] = useState<Map<string, GridData> | null>(null);
  const [forecastRuns, setForecastRuns] = useState<ForecastRun[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [selectedEntity, setSelectedEntity] = useState("");
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [fileChecks, setFileChecks] = useState<Record<string, FileCheck>>({});
  const [compactTables, setCompactTables] = useState(false);
  const [compareRunA, setCompareRunA] = useState<number | "">("");
  const [compareRunB, setCompareRunB] = useState<number | "">("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDemoMode(params.get("mode") === "demo");
  }, []);

  useEffect(() => {
    if (demoMode) {
      setInputMode("upload");
      setFiscalYears([]);
      setSelectedFyId(null);
      return;
    }
    fetch("/api/fiscal-years")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: FiscalYear[]) => {
        setFiscalYears(data);
        if (data.length > 0) setSelectedFyId(data[0].id);
      })
      .catch(() => {});
  }, [demoMode]);

  useEffect(() => {
    if (demoMode && inputMode !== "upload") {
      setInputMode("upload");
    }
  }, [demoMode, inputMode]);

  useEffect(() => {
    setFileChecks({});
    setValidationIssues([]);
  }, [inputMode, demoMode]);

  useEffect(() => {
    if (forecastRuns.length >= 2) {
      setCompareRunA(forecastRuns[0].id);
      setCompareRunB(forecastRuns[1].id);
    } else if (forecastRuns.length === 1) {
      setCompareRunA(forecastRuns[0].id);
      setCompareRunB("");
    } else {
      setCompareRunA("");
      setCompareRunB("");
    }
  }, [forecastRuns]);

  // Load scenarios when FY changes (in DB mode)
  const loadScenarios = useCallback(async () => {
    if (!selectedFyId || inputMode !== "db") {
      setScenarios([]);
      return;
    }
    try {
      const s = await listScenarios(selectedFyId);
      setScenarios(s);
    } catch {
      setScenarios([]);
    }
  }, [selectedFyId, inputMode]);

  useEffect(() => { loadScenarios(); }, [loadScenarios]);

  // Load forecast run history when FY changes (in DB mode)
  const loadForecastRuns = useCallback(async () => {
    if (!selectedFyId || inputMode !== "db") {
      setForecastRuns([]);
      return;
    }
    try {
      setForecastRuns(await listForecastRuns(selectedFyId));
    } catch {
      setForecastRuns([]);
    }
  }, [selectedFyId, inputMode]);

  useEffect(() => { loadForecastRuns(); }, [loadForecastRuns]);

  // Load entities when FY changes (in DB mode)
  const loadEntities = useCallback(async () => {
    if (!selectedFyId || inputMode !== "db") {
      setEntities([]);
      return;
    }
    try {
      setEntities(await listEntities(selectedFyId, dataDir));
    } catch {
      setEntities([]);
    }
  }, [selectedFyId, inputMode, dataDir]);

  useEffect(() => { loadEntities(); }, [loadEntities]);

  // Auto-set data dir when FY changes
  useEffect(() => {
    if (selectedFyId && inputMode === "db") {
      const fy = fiscalYears.find((f) => f.id === selectedFyId);
      if (fy) setDataDir(guessDataDir(fy.name));
    }
  }, [selectedFyId, inputMode, fiscalYears]);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [narratives, setNarratives] = useState<{ scenario: string; text: string }[]>([]);
  const [chartUrls, setChartUrls] = useState<string[]>([]);

  const [zipDownloadUrl, setZipDownloadUrl] = useState<string | null>(null);
  const [excelDownloadUrl, setExcelDownloadUrl] = useState<string | null>(null);
  const [ratesGrid, setRatesGrid] = useState<GridData | null>(null);
  const [impactsGrid, setImpactsGrid] = useState<GridData | null>(null);
  const [loadingRunId, setLoadingRunId] = useState<number | null>(null);

  // Nav warning when results exist
  const router = useRouter();
  const [showNavWarning, setShowNavWarning] = useState(false);
  const [pendingNavUrl, setPendingNavUrl] = useState<string | null>(null);
  const bypassWarning = useRef(false);
  const [fyStartMonth, setFyStartMonth] = useState(1);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // Budget rates from DB: {rateName: {period: decimalValue}}
  const [budgetRates, setBudgetRates] = useState<Record<string, Record<string, number>> | null>(null);
  // Rate thresholds from DB: {rateName: {period: decimalValue}}
  const [thresholdRates, setThresholdRates] = useState<Record<string, Record<string, number>> | null>(null);
  // Pools and bases grids for drill-down
  const [poolsGrid, setPoolsGrid] = useState<GridData | null>(null);
  const [basesGrid, setBasesGrid] = useState<GridData | null>(null);
  const [drilldown, setDrilldown] = useState<{
    rateName: string;
    period: string;
    rateValue: number;
  } | null>(null);

  // Derive FY start month from selected fiscal year in DB mode
  useEffect(() => {
    if (inputMode === "db" && selectedFyId) {
      const fy = fiscalYears.find((f) => f.id === selectedFyId);
      if (fy?.start_month) {
        const mm = parseInt(fy.start_month.split("-")[1], 10);
        if (mm >= 1 && mm <= 12) setFyStartMonth(mm);
      }
    }
  }, [inputMode, selectedFyId, fiscalYears]);

  const hasResults = !!(ratesGrid || impactsGrid);

  // Warn on browser refresh / tab close / external navigation
  useEffect(() => {
    if (!hasResults) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasResults]);

  // Intercept in-app link clicks (capture phase, before Next.js routing fires)
  useEffect(() => {
    if (!hasResults) return;
    const handleClick = (e: MouseEvent) => {
      if (bypassWarning.current) return;
      const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      // Only intercept internal navigation links
      if (!href || href.startsWith("http") || href.startsWith("//") || href.startsWith("#") || href.startsWith("mailto:")) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingNavUrl(href);
      setShowNavWarning(true);
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [hasResults]);

  function proceedNavigation() {
    setShowNavWarning(false);
    if (pendingNavUrl) {
      bypassWarning.current = true;
      router.push(pendingNavUrl);
      setPendingNavUrl(null);
      setTimeout(() => { bypassWarning.current = false; }, 200);
    }
  }

  function cancelNavigation() {
    setShowNavWarning(false);
    setPendingNavUrl(null);
  }

  function setCheck(key: string, status: FileCheck["status"], issues: string[] = []) {
    setFileChecks((prev) => ({ ...prev, [key]: { status, issues } }));
  }

  async function validateAndSetFile(
    key: string,
    setter: (f: File | null) => void,
    file: File | null,
    options?: { zip?: boolean; canonicalName?: string }
  ) {
    setter(file);
    if (!file) {
      setCheck(key, "missing", []);
      return;
    }
    setCheck(key, "validating", []);
    const issues = options?.zip
      ? await validateInputZip(file)
      : await validateCsvFile(options?.canonicalName || key, file);
    setCheck(key, issues.length ? "error" : "valid", issues.slice(0, 8));
  }

  async function handleGLFileChange(file: File | null, setter: (f: File | null) => void) {
    await validateAndSetFile("GL_Actuals.csv", setter, file, { canonicalName: "GL_Actuals.csv" });
    if (!file) {
      setEntities([]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const lines = text.split("\n");
      const headers = lines[0]?.split(",").map((h) => h.trim());
      const entityIdx = headers?.indexOf("Entity") ?? -1;
      if (entityIdx >= 0) {
        const ents = new Set<string>();
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i]?.split(",");
          const val = cols?.[entityIdx]?.trim();
          if (val) ents.add(val);
        }
        setEntities(Array.from(ents).sort());
      } else {
        setEntities([]);
      }
    };
    reader.readAsText(file);
  }

  async function loadZipResults(blob: Blob) {
    if (zipDownloadUrl) URL.revokeObjectURL(zipDownloadUrl);
    const newZipUrl = URL.createObjectURL(blob);
    setZipDownloadUrl(newZipUrl);

    const zip = await JSZip.loadAsync(blob);
    const excelFile = zip.file("rate_pack.xlsx");

    const narrs: { scenario: string; text: string }[] = [];
    for (const name of Object.keys(zip.files)) {
      const match = name.match(/^(.+)\/narrative\.md$/);
      if (match) {
        const file = zip.file(name);
        if (file) narrs.push({ scenario: match[1], text: await file.async("string") });
      }
    }
    if (narrs.length === 0) {
      const rootNarr = zip.file("narrative.md");
      if (rootNarr) narrs.push({ scenario: "", text: await rootNarr.async("string") });
    }
    setNarratives(narrs);

    if (excelFile) {
      const excelBlob = await excelFile.async("blob");
      if (excelDownloadUrl) URL.revokeObjectURL(excelDownloadUrl);
      setExcelDownloadUrl(URL.createObjectURL(excelBlob));

      try {
        const excelBuf = await excelFile.async("arraybuffer");
        const wb = XLSX.read(excelBuf, { type: "array" });

        function parseSheet(sheetSuffix: string): GridData | null {
          const sheetName = wb.SheetNames.find((n) => n.endsWith(sheetSuffix));
          if (!sheetName) return null;
          const aoa: (string | number)[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
          if (aoa.length < 2) return null;
          return { headers: aoa[0].map(String), rows: aoa.slice(1) };
        }

        const mtd = parseSheet(" - Rates");
        const ytd = parseSheet(" - YTD Rates");
        if (mtd && ytd) {
          const rateNames = mtd.headers.slice(1);
          const mergedHeaders = ["Period"];
          for (const r of rateNames) mergedHeaders.push(`${r} (MTD)`, `${r} (YTD)`);
          const ytdByPeriod = new Map<string, (string | number)[]>();
          const ytdPeriodIdx = ytd.headers.indexOf("Period");
          for (const row of ytd.rows) ytdByPeriod.set(String(row[ytdPeriodIdx]), row);
          const mergedRows = mtd.rows.map((mtdRow) => {
            const period = String(mtdRow[0]);
            const ytdRow = ytdByPeriod.get(period);
            const merged: (string | number)[] = [period];
            for (let i = 1; i < mtd.headers.length; i++) {
              merged.push(mtdRow[i] ?? "");
              const ytdColIdx = ytd.headers.indexOf(mtd.headers[i]);
              merged.push(ytdRow && ytdColIdx >= 0 ? (ytdRow[ytdColIdx] ?? "") : "");
            }
            return merged;
          });
          setRatesGrid({ headers: mergedHeaders, rows: mergedRows });
        } else {
          setRatesGrid(mtd);
        }

        const impacts = parseSheet(" - Impacts");
        if (impacts) {
          const rawHeaders = impacts.headers;
          const ytdSuffixCols = new Set(rawHeaders.filter((h) => h.endsWith("$_ytd")).map((h) => h.replace("$_ytd", "$")));
          const hasYtd = ytdSuffixCols.size > 0;
          const directCols = ["DirectLabor$", "Subk", "ODC", "Travel"];
          const directColIndices = directCols.map((c) => rawHeaders.indexOf(c)).filter((i) => i >= 0);
          const mtdIndirectIndices = rawHeaders.map((h, i) => {
            if (h.endsWith("$_ytd") || h === "LoadedCost$" || h === "LoadedCost$_ytd") return -1;
            if (directCols.includes(h) || h === "Period" || h === "Project") return -1;
            return h.endsWith("$") ? i : -1;
          }).filter((i) => i >= 0);
          const ytdIndirectIndices = rawHeaders.map((h, i) => (h.endsWith("$_ytd") && h !== "LoadedCost$_ytd" ? i : -1)).filter((i) => i >= 0);
          impacts.headers = rawHeaders.map((h) => {
            if (h.endsWith("$_ytd")) return h.replace("$_ytd", "$ (YTD)");
            if (ytdSuffixCols.has(h)) return `${h} (MTD)`;
            if (h === "LoadedCost$" && hasYtd) return "LoadedCost$ (MTD)";
            return h;
          });
          function sumIdx(row: (string | number)[], indices: number[]): number {
            let s = 0; for (const i of indices) { const v = row[i]; if (typeof v === "number") s += v; } return s;
          }
          const lastDirectIdx = Math.max(...directColIndices);
          const insertAt = lastDirectIdx + 1;
          const newHeaders = [...impacts.headers];
          newHeaders.splice(insertAt, 0, "TotalDirect$");
          if (mtdIndirectIndices.length > 0) newHeaders.push("TotalIndirect$ (MTD)");
          if (ytdIndirectIndices.length > 0) newHeaders.push("TotalIndirect$ (YTD)");
          impacts.rows = impacts.rows.map((row) => {
            const newRow = [...row];
            newRow.splice(insertAt, 0, sumIdx(row, directColIndices));
            if (mtdIndirectIndices.length > 0) newRow.push(sumIdx(row, mtdIndirectIndices));
            if (ytdIndirectIndices.length > 0) newRow.push(sumIdx(row, ytdIndirectIndices));
            return newRow;
          });
          impacts.headers = newHeaders;
        }
        setImpactsGrid(impacts);
        setPoolsGrid(parseSheet(" - Pools"));
        setBasesGrid(parseSheet(" - Bases"));

        if (compareMode) {
          const scenMap = new Map<string, GridData>();
          for (const sn of wb.SheetNames) {
            const m = sn.match(/^(.+) - Rates$/);
            if (m) {
              const aoa: (string | number)[][] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1 });
              if (aoa.length >= 2) scenMap.set(m[1], { headers: aoa[0].map(String), rows: aoa.slice(1) });
            }
          }
          setAllScenariosRates(scenMap.size > 1 ? scenMap : null);
        }
      } catch {
        // Non-fatal: tables just won't show
      }
    } else {
      setExcelDownloadUrl(null);
    }

    const charts: string[] = [];
    await Promise.all(
      Object.keys(zip.files).map(async (name) => {
        if (!name.startsWith("charts/") || !name.endsWith(".png")) return;
        const file = zip.file(name);
        if (!file) return;
        charts.push(URL.createObjectURL(await file.async("blob")));
      })
    );
    charts.sort();
    setChartUrls(charts);

    try {
      const assumFile = zip.file("assumptions.json")
        ?? Object.keys(zip.files).filter((n) => n.endsWith("/assumptions.json")).map((n) => zip.file(n)).find(Boolean);
      if (assumFile) {
        const assumJson = JSON.parse(await assumFile.async("string"));
        if (assumJson.fy_start) {
          const startMonth = parseInt(assumJson.fy_start.split("-")[1], 10);
          if (startMonth >= 1 && startMonth <= 12) setFyStartMonth(startMonth);
        }
        if (assumJson.budget_rates) setBudgetRates(assumJson.budget_rates);
        if (assumJson.rate_thresholds) setThresholdRates(assumJson.rate_thresholds);
      }
    } catch {
      // Non-fatal
    }
  }

  async function runForecast() {
    setRunning(true);
    setError(null);
    setValidationIssues([]);
    setNarratives([]);
    setChartUrls([]);
    setRatesGrid(null);
    setImpactsGrid(null);
    setBudgetRates(null);
    setThresholdRates(null);
    setPoolsGrid(null);
    setBasesGrid(null);
    setDrilldown(null);
    setAllScenariosRates(null);

    try {
      const issues: string[] = [];
      if (inputMode === "upload") {
        if (zipFile) {
          issues.push(...(await validateInputZip(zipFile)));
        } else {
          if (gl) issues.push(...(await validateCsvFile("GL_Actuals.csv", gl)));
          if (map) issues.push(...(await validateCsvFile("Account_Map.csv", map)));
          if (direct) issues.push(...(await validateCsvFile("Direct_Costs_By_Project.csv", direct)));
          if (events) issues.push(...(await validateCsvFile("Scenario_Events.csv", events)));
        }
      } else {
        // DB mode allows optional upload overrides; validate only provided files.
        if (gl) issues.push(...(await validateCsvFile("GL_Actuals.csv", gl)));
        if (direct) issues.push(...(await validateCsvFile("Direct_Costs_By_Project.csv", direct)));
        if (events) issues.push(...(await validateCsvFile("Scenario_Events.csv", events)));
      }
      if (issues.length) {
        setValidationIssues(issues.slice(0, 12));
        throw new Error("Input validation failed. Fix the CSV issues below and run again.");
      }

      const form = new FormData();
      if (!compareMode && scenario.trim()) form.set("scenario", scenario.trim());
      form.set("forecast_months", String(forecastMonths));
      form.set("run_rate_months", String(runRateMonths));
      if (selectedEntity) form.set("entity", selectedEntity);

      if (inputMode === "db") {
        if (!selectedFyId) throw new Error("Select a fiscal year.");
        form.set("fiscal_year_id", String(selectedFyId));
        form.set("input_dir_path", dataDir);
        // Optional file overrides
        if (gl) form.set("gl_actuals", gl, "GL_Actuals.csv");
        if (direct) form.set("direct_costs", direct, "Direct_Costs_By_Project.csv");
        if (events) form.set("scenario_events", events, "Scenario_Events.csv");
      } else if (zipFile) {
        form.set("inputs_zip", zipFile, zipFile.name);
      } else {
        if (!gl || !map || !direct || !events) {
          throw new Error("Upload either a ZIP, or all 4 required CSV files.");
        }
        form.set("gl_actuals", gl, "GL_Actuals.csv");
        form.set("account_map", map, "Account_Map.csv");
        form.set("direct_costs", direct, "Direct_Costs_By_Project.csv");
        form.set("scenario_events", events, "Scenario_Events.csv");
      }
      if (config && inputMode !== "db") {
        form.set("config_yaml", config, config.name);
      }

      const resp = await fetch("/api/forecast", { method: "POST", body: form });
      if (!resp.ok) {
        throw new Error(await parseApiError(resp));
      }

      const blob = await resp.blob();
      await loadZipResults(blob);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      loadForecastRuns();
    }
  }

  function downloadTemplate(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const templates: Record<string, string> = {
    "GL_Actuals.csv": "Period,Account,Amount\n2025-01,6000,100000.00\n",
    "Account_Map.csv": "Account,Pool,BaseCategory,IsUnallowable,Notes\n6000,Fringe,TL,False,Benefits/Fringe\n",
    "Direct_Costs_By_Project.csv": "Period,Project,DirectLabor$,DirectLaborHrs,Subk,ODC,Travel\n2025-01,P001,250000,2200,60000,20000,10000\n",
    "Scenario_Events.csv": "Scenario,EffectivePeriod,Type,Project,DeltaDirectLabor$,DeltaDirectLaborHrs,DeltaSubk,DeltaODC,DeltaTravel,DeltaPoolFringe,DeltaPoolOverhead,DeltaPoolGA,Notes\nBase,2025-07,ADJUST,,0,0,0,0,0,0,0,0,No changes\n",
  };

  const requiredCsvKeys = ["GL_Actuals.csv", "Account_Map.csv", "Direct_Costs_By_Project.csv", "Scenario_Events.csv"];
  const uploadReady = zipFile
    ? fileChecks["ZIP"]?.status === "valid"
    : requiredCsvKeys.every((k) => fileChecks[k]?.status === "valid");

  // Compute which rate/period combos exceed budget (for highlighting both tables)
  const overBudgetKeys: Set<string> = (() => {
    if (!budgetRates || !ratesGrid) return new Set<string>();
    const keys = new Set<string>();
    const pIdx: number = ratesGrid.headers.indexOf("Period");
    for (const row of ratesGrid.rows) {
      const period: string = String(row[pIdx] ?? "");
      for (let ci = 1; ci < ratesGrid.headers.length; ci++) {
        const hdr: string = ratesGrid.headers[ci];
        const val: string | number = row[ci];
        if (typeof val !== "number") continue;
        const rateName: string = hdr.replace(" (MTD)", "").replace(" (YTD)", "");
        const budgetVal: number | undefined = budgetRates[rateName]?.[period];
        if (budgetVal !== undefined && val > budgetVal) {
          keys.add(`${rateName}|${period}`);
        }
      }
    }
    return keys;
  })();

  // Compute threshold breaches for alert banner
  const thresholdBreaches: { rateName: string; period: string; actual: number; threshold: number }[] = (() => {
    if (!thresholdRates || !ratesGrid) return [];
    const breaches: { rateName: string; period: string; actual: number; threshold: number }[] = [];
    const pIdx: number = ratesGrid.headers.indexOf("Period");
    for (const row of ratesGrid.rows) {
      const period: string = String(row[pIdx] ?? "");
      for (let ci = 1; ci < ratesGrid.headers.length; ci++) {
        const hdr: string = ratesGrid.headers[ci];
        if (!hdr.endsWith("(MTD)") && ratesGrid.headers.some(h => h.endsWith("(MTD)"))) continue; // only check MTD when both exist
        const val: string | number = row[ci];
        if (typeof val !== "number") continue;
        const rateName: string = hdr.replace(" (MTD)", "").replace(" (YTD)", "");
        const threshVal: number | undefined = thresholdRates[rateName]?.[period];
        if (threshVal !== undefined && val > threshVal) {
          breaches.push({ rateName, period, actual: val, threshold: threshVal });
        }
      }
    }
    return breaches;
  })();

  // Build forecast context string for the chat panel
  const forecastContext: string | undefined = (() => {
    if (!ratesGrid && !impactsGrid) return undefined;
    const lines: string[] = [];

    if (ratesGrid) {
      lines.push("## RATES BY PERIOD (rate = pool$ / base$)");
      lines.push(ratesGrid.headers.join("\t"));
      // Include all rate rows (typically ~50 periods, manageable)
      for (const row of ratesGrid.rows) {
        lines.push(row.map((v) => typeof v === "number" ? (v * 100).toFixed(2) + "%" : String(v)).join("\t"));
      }
    }

    if (budgetRates) {
      lines.push("\n## BUDGET RATES (target rates by period)");
      for (const [rateName, periods] of Object.entries(budgetRates)) {
        for (const [period, val] of Object.entries(periods)) {
          lines.push(`${rateName}\t${period}\t${(val * 100).toFixed(2)}%`);
        }
      }
    }

    if (overBudgetKeys.size > 0) {
      lines.push("\n## OVER-BUDGET ALERTS (actual rate exceeds budget rate)");
      for (const key of overBudgetKeys) {
        const [rateName, period] = key.split("|");
        lines.push(`${rateName} in ${period} exceeds budget`);
      }
    }

    if (thresholdBreaches.length > 0) {
      lines.push("\n## THRESHOLD BREACHES (rate exceeds max acceptable threshold)");
      for (const b of thresholdBreaches) {
        lines.push(`${b.rateName} in ${b.period}: actual ${(b.actual * 100).toFixed(2)}% exceeds threshold ${(b.threshold * 100).toFixed(2)}%`);
      }
    }

    if (impactsGrid) {
      // Summarize impacts: just the FY totals, not every row
      lines.push("\n## PROJECT IMPACTS SUMMARY (FY totals)");
      lines.push(impactsGrid.headers.join("\t"));
      const periodIdx = impactsGrid.headers.indexOf("Period");
      const projectIdx = impactsGrid.headers.indexOf("Project");
      // Build FY totals inline
      const fyGroups = new Map<string, (string | number)[][]>();
      const fyOrder: string[] = [];
      for (const row of impactsGrid.rows) {
        const period = String(row[periodIdx] ?? "");
        const fy = fiscalYearOf(period, fyStartMonth);
        if (!fyGroups.has(fy)) { fyGroups.set(fy, []); fyOrder.push(fy); }
        fyGroups.get(fy)!.push(row);
      }
      for (const fy of fyOrder) {
        const rows = fyGroups.get(fy)!;
        const totals = impactsGrid.headers.map((h, ci) => {
          if (ci === periodIdx) return fy;
          if (ci === projectIdx) return "TOTAL";
          let sum = 0;
          for (const r of rows) { const v = r[ci]; if (typeof v === "number") sum += v; }
          return "$" + Math.round(sum).toLocaleString("en-US");
        });
        lines.push(totals.join("\t"));
      }
      // Grand total
      const grand = impactsGrid.headers.map((h, ci) => {
        if (ci === periodIdx) return "GRAND";
        if (ci === projectIdx) return "TOTAL";
        let sum = 0;
        for (const r of impactsGrid.rows) { const v = r[ci]; if (typeof v === "number") sum += v; }
        return "$" + Math.round(sum).toLocaleString("en-US");
      });
      lines.push(grand.join("\t"));
    }

    return lines.join("\n");
  })();

  const runA = forecastRuns.find((r) => r.id === compareRunA) || null;
  const runB = forecastRuns.find((r) => r.id === compareRunB) || null;
  const runDelta = runA && runB
    ? {
        months: runB.forecast_months - runA.forecast_months,
        runRate: runB.run_rate_months - runA.run_rate_months,
        sizeKb: Math.round((runB.zip_size - runA.zip_size) / 1024),
        hoursBetween: Math.round((new Date(runB.created_at).getTime() - new Date(runA.created_at).getTime()) / (1000 * 60 * 60)),
      }
    : null;

  return (
    <>
    <main className="container">
      {!session?.user && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            marginBottom: 16,
            borderRadius: 8,
            background: "color-mix(in srgb, var(--color-primary) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)",
            fontSize: 13,
          }}
        >
          <span>
            {demoMode
              ? "Try Demo mode: upload your CSVs, run forecast, and download results without creating an account."
              : "Guest mode - results won't be saved."}
          </span>
          <a href="/auth/signin" style={{ marginLeft: "auto", fontWeight: 600, color: "var(--color-primary)" }}>
            Sign in to save
          </a>
        </div>
      )}
      <h1 style={{ marginTop: 0, marginBottom: 6 }}>Indirect Rate Forecasting Agent</h1>
      <div className="muted" style={{ marginBottom: 16 }}>
        Upload inputs → run → download the pack. (The forecasting engine runs in the Python API; this UI can be hosted on
        Vercel.)
      </div>

      <div className="top-grid">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Ask the Rate Analyst</h2>
          <div className="muted" style={{ marginBottom: 10 }}>
            Chat with Gemini about indirect rates, pool structures, and cost forecasting.
          </div>
          <ChatPanel forecastContext={forecastContext} />
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>1) Upload inputs</h2>

          <div className="field">
            <label>Input mode</label>
            {demoMode ? (
              <div className="muted" style={{ fontSize: 12 }}>
                Try Demo uses upload mode only.
              </div>
            ) : (
              <div style={{ display: "flex", gap: 16 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input type="radio" name="inputMode" checked={inputMode === "upload"} onChange={() => setInputMode("upload")} />
                  Upload CSVs
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input type="radio" name="inputMode" checked={inputMode === "db"} onChange={() => setInputMode("db")} disabled={fiscalYears.length === 0} />
                  Use DB configuration
                  {fiscalYears.length === 0 && <span className="muted" style={{ fontSize: 11 }}>(no fiscal years configured)</span>}
                </label>
              </div>
            )}
          </div>
          {inputMode === "db" && (
            <>
              <div className="field">
                <label>Fiscal year</label>
                <select
                  value={selectedFyId ?? ""}
                  onChange={(e) => setSelectedFyId(Number(e.target.value))}
                  style={{ width: "100%" }}
                >
                  {fiscalYears.map((fy) => (
                    <option key={fy.id} value={fy.id}>
                      {fy.name} ({fy.start_month} – {fy.end_month})
                    </option>
                  ))}
                </select>
                <div className="muted" style={{ fontSize: 12 }}>
                  Account mappings, rate config, and scenarios will be loaded from the database.
                </div>
              </div>

              <div className="field">
                <label>Data directory</label>
                <input
                  value={dataDir}
                  onChange={(e) => setDataDir(e.target.value)}
                  placeholder="data_demo"
                />
                <div className="muted" style={{ fontSize: 12 }}>
                  Server-side directory containing GL_Actuals.csv and Direct_Costs_By_Project.csv.
                  Auto-detected from fiscal year name. Override with file uploads below if needed.
                </div>
              </div>

              <div className="field">
                <label>Optional: Override data files</label>
                <FileDropField
                  id="db-gl-actuals"
                  label="GL_Actuals.csv"
                  accept=".csv"
                  file={gl}
                  required={false}
                  check={fileChecks["GL_Actuals.csv"]}
                  onTemplateDownload={() => downloadTemplate("GL_Actuals.csv", templates["GL_Actuals.csv"])}
                  onFile={(f) => handleGLFileChange(f, setGl)}
                />
                <FileDropField
                  id="db-direct-costs"
                  label="Direct_Costs_By_Project.csv"
                  accept=".csv"
                  file={direct}
                  required={false}
                  check={fileChecks["Direct_Costs_By_Project.csv"]}
                  onTemplateDownload={() => downloadTemplate("Direct_Costs_By_Project.csv", templates["Direct_Costs_By_Project.csv"])}
                  onFile={(f) => validateAndSetFile("Direct_Costs_By_Project.csv", setDirect, f, { canonicalName: "Direct_Costs_By_Project.csv" })}
                />
                <FileDropField
                  id="db-scenario-events"
                  label="Scenario_Events.csv"
                  accept=".csv"
                  file={events}
                  required={false}
                  check={fileChecks["Scenario_Events.csv"]}
                  onTemplateDownload={() => downloadTemplate("Scenario_Events.csv", templates["Scenario_Events.csv"])}
                  onFile={(f) => validateAndSetFile("Scenario_Events.csv", setEvents, f, { canonicalName: "Scenario_Events.csv" })}
                />
              </div>
            </>
          )}

          {inputMode === "upload" && (
            <>
              <div className="field">
                <label>Option A: Upload a ZIP containing the 4 CSVs</label>
                <FileDropField
                  id="upload-zip"
                  label="Forecast Inputs ZIP"
                  accept=".zip"
                  file={zipFile}
                  required={true}
                  check={fileChecks["ZIP"]}
                  helper="ZIP should include GL_Actuals.csv, Account_Map.csv, Direct_Costs_By_Project.csv, Scenario_Events.csv."
                  onFile={(f) => validateAndSetFile("ZIP", setZipFile, f, { zip: true })}
                />
                <div className="muted">ZIP should include: GL_Actuals.csv, Account_Map.csv, Direct_Costs_By_Project.csv, Scenario_Events.csv</div>
              </div>

              <div className="field">
                <label>Option B: Upload each CSV</label>
                <FileDropField
                  id="upload-gl-actuals"
                  label="GL_Actuals.csv"
                  accept=".csv"
                  file={gl}
                  required={!zipFile}
                  check={fileChecks["GL_Actuals.csv"]}
                  onTemplateDownload={() => downloadTemplate("GL_Actuals.csv", templates["GL_Actuals.csv"])}
                  onFile={(f) => handleGLFileChange(f, setGl)}
                />
                <FileDropField
                  id="upload-account-map"
                  label="Account_Map.csv"
                  accept=".csv"
                  file={map}
                  required={!zipFile}
                  check={fileChecks["Account_Map.csv"]}
                  onTemplateDownload={() => downloadTemplate("Account_Map.csv", templates["Account_Map.csv"])}
                  onFile={(f) => validateAndSetFile("Account_Map.csv", setMap, f, { canonicalName: "Account_Map.csv" })}
                />
                <FileDropField
                  id="upload-direct-costs"
                  label="Direct_Costs_By_Project.csv"
                  accept=".csv"
                  file={direct}
                  required={!zipFile}
                  check={fileChecks["Direct_Costs_By_Project.csv"]}
                  onTemplateDownload={() => downloadTemplate("Direct_Costs_By_Project.csv", templates["Direct_Costs_By_Project.csv"])}
                  onFile={(f) => validateAndSetFile("Direct_Costs_By_Project.csv", setDirect, f, { canonicalName: "Direct_Costs_By_Project.csv" })}
                />
                <FileDropField
                  id="upload-scenario-events"
                  label="Scenario_Events.csv"
                  accept=".csv"
                  file={events}
                  required={!zipFile}
                  check={fileChecks["Scenario_Events.csv"]}
                  onTemplateDownload={() => downloadTemplate("Scenario_Events.csv", templates["Scenario_Events.csv"])}
                  onFile={(f) => validateAndSetFile("Scenario_Events.csv", setEvents, f, { canonicalName: "Scenario_Events.csv" })}
                />
              </div>

              <div className="field">
                <label>Optional: Upload a rates config YAML</label>
                <input type="file" accept=".yaml,.yml" onChange={(e) => setConfig(e.target.files?.[0] || null)} />
              </div>
              <div
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontSize: 12,
                  background: uploadReady
                    ? "color-mix(in srgb, var(--color-primary) 8%, transparent)"
                    : "transparent",
                }}
              >
                <strong>Upload readiness:</strong>{" "}
                {uploadReady
                  ? "Ready to run forecast."
                  : zipFile
                    ? "Fix ZIP validation issues before running."
                    : "Provide all four CSV files (or a valid ZIP)."}
              </div>
            </>
          )}

          <h2>2) Run</h2>
          <div className="field">
            <label>Scenario {inputMode === "db" ? "" : "(blank runs all scenarios found)"}</label>
            {inputMode === "db" && scenarios.length > 0 ? (
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">(All scenarios)</option>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}{s.description ? ` — ${s.description}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input value={scenario} onChange={(e) => setScenario(e.target.value)} placeholder="Base / Win / Lose" />
            )}
          </div>
          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={compareMode} onChange={() => setCompareMode(!compareMode)} />
              Compare all scenarios side-by-side
            </label>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              Runs all scenarios and shows rate deltas between them.
            </div>
          </div>
          {entities.length > 0 && (
            <div className="field">
              <label>Entity</label>
              <select value={selectedEntity} onChange={(e) => setSelectedEntity(e.target.value)} style={{ width: "100%" }}>
                <option value="">(Consolidated — all entities)</option>
                {entities.map((ent) => (
                  <option key={ent} value={ent}>{ent}</option>
                ))}
              </select>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                Filter forecast to a specific entity, or leave as Consolidated.
              </div>
            </div>
          )}
          <div className="field">
            <label>Forecast months</label>
            <input
              type="number"
              min={1}
              max={36}
              value={forecastMonths}
              onChange={(e) => setForecastMonths(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>Run-rate months</label>
            <input
              type="number"
              min={1}
              max={12}
              value={runRateMonths}
              onChange={(e) => setRunRateMonths(Number(e.target.value))}
            />
          </div>

          <button onClick={runForecast} disabled={running} aria-label="Run forecast">
            {running ? "Running..." : "Run forecast"}
          </button>

          {validationIssues.length > 0 && (
            <div className="error" style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>CSV validation issues</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {validationIssues.map((issue, idx) => (
                  <li key={`${issue}-${idx}`}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div style={{ marginTop: 12 }} className="error">
              {error}
            </div>
          )}

          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            {zipDownloadUrl && (
              <button
                style={{ width: "100%" }}
                disabled={running}
                onClick={() => { const a = document.createElement("a"); a.href = zipDownloadUrl; a.download = "rate_pack_output.zip"; a.click(); }}
              >
                Download output ZIP
              </button>
            )}
            {excelDownloadUrl && (
              <button
                style={{ width: "100%" }}
                disabled={running}
                onClick={() => { const a = document.createElement("a"); a.href = excelDownloadUrl; a.download = "rate_pack.xlsx"; a.click(); }}
              >
                Download rate_pack.xlsx
              </button>
            )}
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Results preview</h2>
          <div className="muted" style={{ marginBottom: 10 }}>
            Narrative + assumptions are read from the generated ZIP so you can quickly sanity-check the run.
          </div>

          {narratives.length > 0 ? (
            narratives.map((n) => (
              <div key={n.scenario} className="narrative">
                <ReactMarkdown>{n.text}</ReactMarkdown>
              </div>
            ))
          ) : (
            <div className="muted">Run a forecast to see the narrative here.</div>
          )}
        </section>
      </div>

      {(ratesGrid || impactsGrid) && (
        <>
          <div style={{ height: 16 }} />
          <section className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style={{ marginTop: 0, marginBottom: 0 }}>Forecast Data</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={compactTables}
                    onChange={() => setCompactTables((v) => !v)}
                  />
                  Compact tables
                </label>
              {inputMode === "upload" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <label style={{ opacity: 0.7 }}>FY starts:</label>
                  <select
                    value={fyStartMonth}
                    onChange={(e) => setFyStartMonth(Number(e.target.value))}
                    style={{ fontSize: 12, padding: "2px 6px" }}
                  >
                    {FY_START_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}
              </div>
            </div>
            {thresholdBreaches.length > 0 && (
              <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: "rgb(220,60,60)" }}>
                  Rate Threshold Alerts ({thresholdBreaches.length} breach{thresholdBreaches.length > 1 ? "es" : ""})
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {thresholdBreaches.slice(0, 12).map((b, i) => (
                    <span key={i} style={{ fontSize: 11, padding: "2px 8px", background: "rgba(239,68,68,0.15)", borderRadius: 4, fontFamily: "monospace" }}>
                      {b.rateName} {b.period}: {(b.actual * 100).toFixed(2)}% &gt; {(b.threshold * 100).toFixed(2)}%
                    </span>
                  ))}
                  {thresholdBreaches.length > 12 && (
                    <span style={{ fontSize: 11, opacity: 0.7, padding: "2px 8px" }}>...and {thresholdBreaches.length - 12} more</span>
                  )}
                </div>
              </div>
            )}
            {compareMode && allScenariosRates && allScenariosRates.size > 1 && (
              <ScenarioComparisonTable data={allScenariosRates} baseScenario="Base" compact={compactTables} />
            )}
            {ratesGrid && <GridTable title="Rates" data={ratesGrid} isRatesTable={true} budgetRates={budgetRates} thresholdRates={thresholdRates}
              onCellClick={poolsGrid || basesGrid ? (period, header, value) => {
                const rateName = header.replace(" (MTD)", "").replace(" (YTD)", "");
                setDrilldown({ rateName, period, rateValue: typeof value === "number" ? value : 0 });
              } : undefined}
              compact={compactTables}
            />}
            {impactsGrid && <ImpactsTable data={impactsGrid} fyStartMonth={fyStartMonth} overBudgetKeys={overBudgetKeys} compact={compactTables} />}
          </section>
        </>
      )}

      <div style={{ height: 16 }} />

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Charts</h2>
        {chartUrls.length ? (
          <>
            <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Click a chart to expand.</div>
            <div className="charts">
              {chartUrls.map((u) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={u}
                  src={u}
                  alt="Rate chart"
                  onClick={() => setLightboxUrl(u)}
                  style={{ width: "100%", borderRadius: 10, cursor: "pointer" }}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="muted">Charts will appear here after a run.</div>
        )}
      </section>

      {/* Forecast History (DB mode only) */}
      {inputMode === "db" && forecastRuns.length > 0 && (
        <>
          <div style={{ height: 16 }} />
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Forecast History</h2>
            <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
              Past runs are saved automatically. <strong>Load</strong> restores results into the view above; <strong>Download</strong> saves the ZIP to disk.
            </div>
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Compare runs</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                <select value={compareRunA} onChange={(e) => setCompareRunA(Number(e.target.value))}>
                  {forecastRuns.map((r) => (
                    <option key={`a-${r.id}`} value={r.id}>
                      #{r.id} {r.scenario || "(all)"} {new Date(r.created_at + "Z").toLocaleDateString()}
                    </option>
                  ))}
                </select>
                <span className="muted">vs</span>
                <select value={compareRunB} onChange={(e) => setCompareRunB(Number(e.target.value))}>
                  {forecastRuns.map((r) => (
                    <option key={`b-${r.id}`} value={r.id}>
                      #{r.id} {r.scenario || "(all)"} {new Date(r.created_at + "Z").toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </div>
              {runA && runB && runDelta && (
                <div className="muted" style={{ fontSize: 12 }}>
                  Forecast months Delta: {runDelta.months >= 0 ? "+" : ""}{runDelta.months} | Run-rate Delta: {runDelta.runRate >= 0 ? "+" : ""}{runDelta.runRate} | ZIP size Delta: {runDelta.sizeKb >= 0 ? "+" : ""}{runDelta.sizeKb} KB | Time gap: {runDelta.hoursBetween}h
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border bg-accent/30">
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Scenario</th>
                    <th className="px-3 py-2 text-left font-medium">Origin</th>
                    <th className="px-3 py-2 text-right font-medium">Months</th>
                    <th className="px-3 py-2 text-right font-medium">Run-rate</th>
                    <th className="px-3 py-2 text-right font-medium">Size</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {forecastRuns.map((run) => (
                    <tr key={run.id} className="border-b border-border/50">
                      <td className="px-3 py-2">{new Date(run.created_at + "Z").toLocaleString()}</td>
                      <td className="px-3 py-2">{run.scenario || "(all)"}</td>
                      <td className="px-3 py-2">
                        {run.trigger === "auto" ? (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(99,102,241,0.15)", color: "rgb(99,102,241)", fontWeight: 600, letterSpacing: "0.03em" }}>
                            Auto
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, color: "var(--color-muted-foreground)" }}>Manual</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{run.forecast_months}</td>
                      <td className="px-3 py-2 text-right font-mono">{run.run_rate_months}</td>
                      <td className="px-3 py-2 text-right font-mono">{run.zip_size ? (run.zip_size / 1024).toFixed(0) + " KB" : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          style={{ fontSize: 11, padding: "2px 8px", marginRight: 4 }}
                          aria-label={`Load forecast run ${run.id} into view`}
                          disabled={loadingRunId === run.id}
                          onClick={async () => {
                            try {
                              setLoadingRunId(run.id);
                              setError(null);
                              const blob = await downloadForecastRun(run.id);
                              await loadZipResults(blob);
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            } catch (e) {
                              setError(e instanceof Error ? e.message : String(e));
                            } finally {
                              setLoadingRunId(null);
                            }
                          }}
                        >
                          {loadingRunId === run.id ? "Loading…" : "Load"}
                        </button>
                        <button
                          style={{ fontSize: 11, padding: "2px 8px", marginRight: 4 }}
                          aria-label={`Download forecast run ${run.id}`}
                          onClick={async () => {
                            try {
                              const blob = await downloadForecastRun(run.id);
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `forecast_run_${run.id}.zip`;
                              a.click();
                              URL.revokeObjectURL(url);
                            } catch (e) {
                              alert(e instanceof Error ? e.message : String(e));
                            }
                          }}
                        >
                          Download
                        </button>
                        <button
                          style={{ fontSize: 11, padding: "2px 8px", opacity: 0.6 }}
                          aria-label={`Delete forecast run ${run.id}`}
                          onClick={async () => {
                            if (!confirm("Delete this forecast run?")) return;
                            try {
                              await deleteForecastRun(run.id);
                              loadForecastRuns();
                            } catch (e) {
                              alert(e instanceof Error ? e.message : String(e));
                            }
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.80)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
            padding: 24,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Rate chart (expanded)"
            style={{ maxWidth: "95vw", maxHeight: "92vh", borderRadius: 10 }}
          />
        </div>
      )}

      {/* Rate drill-down modal */}
      {drilldown && (poolsGrid || basesGrid) && (() => {
        const pIdx = poolsGrid ? poolsGrid.headers.indexOf("Period") : -1;
        const bIdx = basesGrid ? basesGrid.headers.indexOf("Period") : -1;
        const poolRow = poolsGrid && pIdx >= 0 ? poolsGrid.rows.find(r => String(r[pIdx]) === drilldown.period) : null;
        const baseRow = basesGrid && bIdx >= 0 ? basesGrid.rows.find(r => String(r[bIdx]) === drilldown.period) : null;
        const poolColIdx = poolsGrid ? poolsGrid.headers.indexOf(drilldown.rateName) : -1;
        const poolValue = poolRow && poolColIdx >= 0 ? poolRow[poolColIdx] : null;

        return (
          <div
            onClick={() => setDrilldown(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 90,
              background: "rgba(0,0,0,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 24,
            }}
          >
            <div onClick={e => e.stopPropagation()} className="card" style={{ maxWidth: 520, width: "100%", padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>{drilldown.rateName} — {drilldown.period}</h3>
                <button onClick={() => setDrilldown(null)} style={{ fontSize: 18, lineHeight: 1, opacity: 0.5 }}>✕</button>
              </div>

              <div style={{ fontSize: 13, marginBottom: 12, padding: "8px 12px", background: "var(--accent)", borderRadius: 6 }}>
                <strong>Rate = Pool $ / Base $</strong>
                <span style={{ float: "right", fontFamily: "monospace" }}>
                  {(drilldown.rateValue * 100).toFixed(2)}%
                </span>
              </div>

              {poolsGrid && poolRow && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, marginBottom: 4 }}>POOL DOLLARS (numerator)</div>
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <tbody>
                      {poolsGrid.headers.map((h, i) => {
                        if (h === "Period" || i === pIdx) return null;
                        const val = poolRow[i];
                        const isMatch = h === drilldown.rateName;
                        return (
                          <tr key={h} style={{ background: isMatch ? "rgba(99,140,255,0.12)" : undefined }}>
                            <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--border)" }}>{h}{isMatch ? " ←" : ""}</td>
                            <td style={{ padding: "3px 8px", textAlign: "right", fontFamily: "monospace", borderBottom: "1px solid var(--border)" }}>
                              {typeof val === "number" ? "$" + val.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(val ?? "—")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {basesGrid && baseRow && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, marginBottom: 4 }}>BASE DOLLARS (denominator)</div>
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <tbody>
                      {basesGrid.headers.map((h, i) => {
                        if (h === "Period" || i === bIdx) return null;
                        const val = baseRow[i];
                        return (
                          <tr key={h}>
                            <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--border)" }}>{h}</td>
                            <td style={{ padding: "3px 8px", textAlign: "right", fontFamily: "monospace", borderBottom: "1px solid var(--border)" }}>
                              {typeof val === "number" ? "$" + val.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(val ?? "—")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {typeof poolValue === "number" && baseRow && (
                <div style={{ fontSize: 12, opacity: 0.7, textAlign: "center", marginTop: 8 }}>
                  ${poolValue.toLocaleString("en-US", { maximumFractionDigits: 0 })} (pool) / base = {(drilldown.rateValue * 100).toFixed(2)}%
                </div>
              )}
            </div>
          </div>
        );
      })()}

    </main>

    {/* Navigation warning modal */}
    {showNavWarning && (
      <div style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          background: "var(--color-sidebar, #1e1e2e)",
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          padding: "24px 28px",
          maxWidth: 420,
          width: "90%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Forecast results will be lost</h3>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-foreground, #e2e8f0)", lineHeight: 1.5 }}>
            Forecast results will be lost if you navigate away from this page. Download your output before continuing.
          </p>
          <p style={{ margin: "0 0 20px", fontSize: 12, color: "#e2e8f0", lineHeight: 1.5 }}>
            💡 Tip: open a new browser tab to navigate elsewhere and keep your results available here.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {zipDownloadUrl && (
              <button
                onClick={() => { const a = document.createElement("a"); a.href = zipDownloadUrl; a.download = "rate_pack_output.zip"; a.click(); }}
                style={{ width: "100%" }}
              >
                Download output ZIP first
              </button>
            )}
            {excelDownloadUrl && (
              <button
                onClick={() => { const a = document.createElement("a"); a.href = excelDownloadUrl; a.download = "rate_pack.xlsx"; a.click(); }}
                style={{ width: "100%" }}
              >
                Download rate_pack.xlsx first
              </button>
            )}
            <button
              onClick={proceedNavigation}
              style={{ width: "100%", background: "transparent", border: "1px solid var(--color-border)", color: "var(--color-muted, #888)", marginTop: 4 }}
            >
              Leave anyway (results will be lost)
            </button>
            <button
              onClick={cancelNavigation}
              style={{ width: "100%", background: "var(--color-primary, #3b82f6)", color: "#fff", border: "none" }}
            >
              Stay on page
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}


