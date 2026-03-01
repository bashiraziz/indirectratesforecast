"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { ConfirmDialog } from "@/app/components/Dialog";
import {
  listFiscalYears,
  listDirectCostEntries,
  countDirectCostEntries,
  createDirectCostEntry,
  updateDirectCostEntry,
  deleteDirectCostEntry,
  importDirectCostEntries,
  deleteAllDirectCostEntries,
  exportDirectCostEntriesUrl,
  type DirectCostEntry,
} from "@/lib/api";
import type { FiscalYear } from "@/lib/types";
import NextStepHint from "@/app/components/NextStepHint";

const PAGE_SIZE = 100;

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div
      className={`fixed bottom-4 right-4 z-50 flex items-start gap-2 px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm ${
        type === "success" ? "bg-green-700 text-white" : "bg-red-700 text-white"
      }`}
    >
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="bg-transparent! border-none! p-0 text-white/80 hover:text-white">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}


type EntryDraft = Omit<DirectCostEntry, "id" | "created_at">;

function numInput(
  val: string,
  set: (v: string) => void,
  onKeyDown: (e: React.KeyboardEvent) => void,
  placeholder = "0.00"
) {
  return (
    <input
      className="input w-24 text-xs py-0.5 text-right"
      value={val}
      onChange={(e) => set(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      type="number"
      step="0.01"
    />
  );
}

function EditableRow({
  entry,
  onSave,
  onCancel,
  onDelete,
}: {
  entry: DirectCostEntry;
  onSave: (data: EntryDraft) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [period, setPeriod] = useState(entry.period);
  const [project, setProject] = useState(entry.project);
  const [dl, setDl] = useState(String(entry.direct_labor));
  const [dlh, setDlh] = useState(String(entry.direct_labor_hrs));
  const [subk, setSubk] = useState(String(entry.subk));
  const [odc, setOdc] = useState(String(entry.odc));
  const [travel, setTravel] = useState(String(entry.travel));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!period) return;
    setSaving(true);
    try {
      await onSave({
        period, project,
        direct_labor: parseFloat(dl) || 0,
        direct_labor_hrs: parseFloat(dlh) || 0,
        subk: parseFloat(subk) || 0,
        odc: parseFloat(odc) || 0,
        travel: parseFloat(travel) || 0,
      });
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") save();
    if (e.key === "Escape") onCancel();
  }

  return (
    <tr className="bg-accent/20">
      <td><input className="input w-24 text-xs py-0.5" value={period} onChange={(e) => setPeriod(e.target.value)} onKeyDown={handleKeyDown} placeholder="YYYY-MM" /></td>
      <td><input className="input w-28 text-xs py-0.5" value={project} onChange={(e) => setProject(e.target.value)} onKeyDown={handleKeyDown} placeholder="Project" /></td>
      <td>{numInput(dl, setDl, handleKeyDown)}</td>
      <td>{numInput(dlh, setDlh, handleKeyDown)}</td>
      <td>{numInput(subk, setSubk, handleKeyDown)}</td>
      <td>{numInput(odc, setOdc, handleKeyDown)}</td>
      <td>{numInput(travel, setTravel, handleKeyDown)}</td>
      <td>
        <div className="flex gap-1">
          <button className="btn btn-primary py-0.5 px-2 text-xs" onClick={save} disabled={saving}>{saving ? "…" : "Save"}</button>
          <button className="btn btn-outline py-0.5 px-2 text-xs" onClick={onCancel}>Cancel</button>
          <button className="btn py-0.5 px-2 text-xs text-destructive bg-transparent! border-none! hover:bg-destructive/10" onClick={onDelete}><Trash2 className="w-3 h-3" /></button>
        </div>
      </td>
    </tr>
  );
}

function NewRow({ onSave, onCancel }: { onSave: (data: EntryDraft) => Promise<void>; onCancel: () => void }) {
  const [period, setPeriod] = useState("");
  const [project, setProject] = useState("");
  const [dl, setDl] = useState("");
  const [dlh, setDlh] = useState("");
  const [subk, setSubk] = useState("");
  const [odc, setOdc] = useState("");
  const [travel, setTravel] = useState("");
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function save() {
    if (!period) return;
    setSaving(true);
    try {
      await onSave({
        period, project,
        direct_labor: parseFloat(dl) || 0,
        direct_labor_hrs: parseFloat(dlh) || 0,
        subk: parseFloat(subk) || 0,
        odc: parseFloat(odc) || 0,
        travel: parseFloat(travel) || 0,
      });
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") save();
    if (e.key === "Escape") onCancel();
  }

  return (
    <tr className="bg-blue-500/10">
      <td><input ref={firstRef} className="input w-24 text-xs py-0.5" value={period} onChange={(e) => setPeriod(e.target.value)} onKeyDown={handleKeyDown} placeholder="YYYY-MM" /></td>
      <td><input className="input w-28 text-xs py-0.5" value={project} onChange={(e) => setProject(e.target.value)} onKeyDown={handleKeyDown} placeholder="Project" /></td>
      <td>{numInput(dl, setDl, handleKeyDown)}</td>
      <td>{numInput(dlh, setDlh, handleKeyDown)}</td>
      <td>{numInput(subk, setSubk, handleKeyDown)}</td>
      <td>{numInput(odc, setOdc, handleKeyDown)}</td>
      <td>{numInput(travel, setTravel, handleKeyDown)}</td>
      <td>
        <div className="flex gap-1">
          <button className="btn btn-primary py-0.5 px-2 text-xs" onClick={save} disabled={saving || !period}>{saving ? "…" : "Add"}</button>
          <button className="btn btn-outline py-0.5 px-2 text-xs" onClick={onCancel}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}

function fmt(n: number) {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DirectCostsPage() {
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [selectedFyId, setSelectedFyId] = useState<number | null>(null);
  const [entries, setEntries] = useState<DirectCostEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filterPeriod, setFilterPeriod] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showNewRow, setShowNewRow] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listFiscalYears()
      .then((fys) => {
        setFiscalYears(fys);
        if (fys.length > 0) setSelectedFyId(fys[0].id);
      })
      .catch(() => setError("Could not load fiscal years. Make sure the Python backend is running."));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilterProject(projectSearch);
      setPage(0);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [projectSearch]);

  const load = useCallback(async () => {
    if (!selectedFyId) return;
    setLoading(true);
    setError(null);
    try {
      const [rows, countRes] = await Promise.all([
        listDirectCostEntries(selectedFyId, {
          period: filterPeriod || undefined,
          project: filterProject || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
        countDirectCostEntries(selectedFyId, {
          period: filterPeriod || undefined,
          project: filterProject || undefined,
        }),
      ]);
      setEntries(rows);
      setTotal(countRes.count);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedFyId, filterPeriod, filterProject, page]);

  useEffect(() => { load(); }, [load]);

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ message, type });
  }

  async function handleSaveEdit(entry: DirectCostEntry, data: EntryDraft) {
    try {
      await updateDirectCostEntry(entry.id, data);
      setEditingId(null);
      await load();
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteDirectCostEntry(id);
      await load();
      showToast("Entry deleted");
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  async function handleAdd(data: EntryDraft) {
    if (!selectedFyId) return;
    try {
      await createDirectCostEntry(selectedFyId, data);
      setShowNewRow(false);
      setPage(0);
      await load();
      showToast("Entry added");
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedFyId) return;
    setImporting(true);
    try {
      const result = await importDirectCostEntries(selectedFyId, file);
      showToast(
        `${result.imported} rows imported${result.errors.length > 0 ? `, ${result.errors.length} errors` : ""}`,
        result.errors.length > 0 ? "error" : "success"
      );
      setPage(0);
      await load();
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleClearAll() {
    if (!selectedFyId) return;
    setShowClearConfirm(false);
    try {
      const result = await deleteAllDirectCostEntries(selectedFyId);
      showToast(`${result.deleted} entries deleted`);
      setPage(0);
      await load();
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const uniquePeriods = [...new Set(entries.map((e) => e.period))].sort();

  return (
    <main className="container" style={{ maxWidth: 1200 }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={showClearConfirm}
        title="Delete All Direct Cost Entries"
        message={`This will permanently delete all ${total} direct cost entries for this fiscal year.`}
        onConfirm={handleClearAll}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Direct Costs by Project</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Fiscal Year:</label>
          <select
            className="input text-xs py-1"
            value={selectedFyId ?? ""}
            onChange={(e) => { setSelectedFyId(Number(e.target.value)); setPage(0); setFilterPeriod(""); setProjectSearch(""); }}
            style={{ minWidth: 180 }}
          >
            {fiscalYears.map((fy) => (
              <option key={fy.id} value={fy.id}>{fy.name} ({fy.start_month} – {fy.end_month})</option>
            ))}
          </select>
        </div>
      </div>

      <NextStepHint
        items={[
          { label: "Run forecast", href: "/forecast", detail: "Generate rate projections using direct labor as the allocation base." },
          { label: "Review PSR", href: "/psr", detail: "Compare direct costs against budget and provisional rates." },
        ]}
      />

      {error && <div className="card" style={{ color: "var(--color-destructive)", marginBottom: 8, fontSize: 13 }}>{error}</div>}

      {/* Toolbar */}
      <div className="card" style={{ marginBottom: 8, padding: "10px 14px" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="input text-xs py-1"
            value={filterPeriod}
            onChange={(e) => { setFilterPeriod(e.target.value); setPage(0); }}
            style={{ minWidth: 120 }}
          >
            <option value="">All periods</option>
            {uniquePeriods.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input
            className="input text-xs py-1"
            placeholder="Search project…"
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
            style={{ minWidth: 140 }}
          />
          <div className="flex-1" />
          <button className="btn btn-outline text-xs py-1 px-3 flex items-center gap-1" onClick={() => load()}><RefreshCw className="w-3 h-3" /></button>
          <button className="btn btn-outline text-xs py-1 px-3 flex items-center gap-1" onClick={() => setShowNewRow(true)}><Plus className="w-3 h-3" /> Add Entry</button>
          <label className={`btn btn-outline text-xs py-1 px-3 flex items-center gap-1 cursor-pointer ${importing ? "opacity-50" : ""}`}>
            <Upload className="w-3 h-3" /> Import CSV
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} disabled={importing || !selectedFyId} />
          </label>
          {selectedFyId && (
            <a href={exportDirectCostEntriesUrl(selectedFyId)} download="Direct_Costs_By_Project.csv" className="btn btn-outline text-xs py-1 px-3 flex items-center gap-1 no-underline">
              <Download className="w-3 h-3" /> Export CSV
            </a>
          )}
          <button
            className="btn text-xs py-1 px-3 flex items-center gap-1 text-destructive bg-transparent! border border-destructive/40 hover:bg-destructive/10"
            onClick={() => setShowClearConfirm(true)}
            disabled={total === 0 || !selectedFyId}
          >
            <Trash2 className="w-3 h-3" /> Clear All
          </button>
        </div>
      </div>

      {total > 0 && (
        <div className="flex gap-4 text-xs text-muted-foreground" style={{ marginBottom: 6, paddingLeft: 2 }}>
          <span>{total.toLocaleString()} entries</span>
          <span>Projects: {new Set(entries.map((e) => e.project)).size}</span>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Period</th>
                <th style={{ width: 130 }}>Project</th>
                <th style={{ width: 110, textAlign: "right" }}>Direct Labor $</th>
                <th style={{ width: 110, textAlign: "right" }}>DL Hours</th>
                <th style={{ width: 100, textAlign: "right" }}>Subk $</th>
                <th style={{ width: 100, textAlign: "right" }}>ODC $</th>
                <th style={{ width: 100, textAlign: "right" }}>Travel $</th>
                <th style={{ width: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {showNewRow && <NewRow onSave={handleAdd} onCancel={() => setShowNewRow(false)} />}
              {loading && entries.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--color-muted-foreground)" }}>Loading…</td></tr>
              ) : entries.length === 0 && !showNewRow ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--color-muted-foreground)" }}>
                    No direct cost entries found.{" "}
                    {!filterPeriod && !filterProject ? "Use 'Add Entry' or 'Import CSV' to add data." : "Try clearing the filters."}
                  </td>
                </tr>
              ) : (
                entries.map((entry) =>
                  editingId === entry.id ? (
                    <EditableRow
                      key={entry.id}
                      entry={entry}
                      onSave={(data) => handleSaveEdit(entry, data)}
                      onCancel={() => setEditingId(null)}
                      onDelete={() => handleDelete(entry.id)}
                    />
                  ) : (
                    <tr key={entry.id} className="cursor-pointer hover:bg-accent/30" onClick={() => setEditingId(entry.id)} title="Click to edit">
                      <td>{entry.period}</td>
                      <td>{entry.project || <span className="text-muted-foreground">—</span>}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(entry.direct_labor)}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Number(entry.direct_labor_hrs).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(entry.subk)}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(entry.odc)}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(entry.travel)}</td>
                      <td>
                        <button
                          className="btn text-xs py-0.5 px-2 text-destructive bg-transparent! border-none! hover:bg-destructive/10"
                          onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground">
            <button className="btn btn-outline py-0.5 px-2 text-xs" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>← Prev</button>
            <span>Page {page + 1} of {totalPages} ({total.toLocaleString()} total)</span>
            <button className="btn btn-outline py-0.5 px-2 text-xs" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next →</button>
          </div>
        )}
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Click any row to edit inline. Press Enter to save, Escape to cancel.
        CSV format: Period, Project, DirectLabor$, DirectLaborHrs, Subk, ODC, Travel.
        These entries are used as the primary direct costs source when running a forecast in DB mode.
      </p>
    </main>
  );
}
