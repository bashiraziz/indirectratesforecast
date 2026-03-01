"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { ConfirmDialog } from "@/app/components/Dialog";
import {
  listFiscalYears,
  listGLEntries,
  countGLEntries,
  createGLEntry,
  updateGLEntry,
  deleteGLEntry,
  importGLEntries,
  deleteAllGLEntries,
  exportGLEntriesUrl,
  type GLEntry,
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


interface EditableRowProps {
  entry: GLEntry;
  onSave: (data: Omit<GLEntry, "id" | "created_at">) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}

function EditableRow({ entry, onSave, onCancel, onDelete }: EditableRowProps) {
  const [period, setPeriod] = useState(entry.period);
  const [account, setAccount] = useState(entry.account);
  const [amount, setAmount] = useState(String(entry.amount));
  const [entity, setEntity] = useState(entry.entity);
  const [saving, setSaving] = useState(false);

  async function save() {
    const num = parseFloat(amount);
    if (!period || !account || isNaN(num)) return;
    setSaving(true);
    try {
      await onSave({ period, account, amount: num, entity });
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
      <td>
        <input
          className="input w-28 text-xs py-0.5"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="YYYY-MM"
          pattern="\d{4}-\d{2}"
        />
      </td>
      <td>
        <input
          className="input w-32 text-xs py-0.5"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Account"
        />
      </td>
      <td>
        <input
          className="input w-32 text-xs py-0.5 text-right"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="0.00"
          type="number"
          step="0.01"
        />
      </td>
      <td>
        <input
          className="input w-28 text-xs py-0.5"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Entity"
        />
      </td>
      <td>
        <div className="flex gap-1">
          <button
            className="btn btn-primary py-0.5 px-2 text-xs"
            onClick={save}
            disabled={saving}
          >
            {saving ? "…" : "Save"}
          </button>
          <button className="btn btn-outline py-0.5 px-2 text-xs" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn py-0.5 px-2 text-xs text-destructive bg-transparent! border-none! hover:bg-destructive/10"
            onClick={onDelete}
            title="Delete entry"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}

interface NewRowProps {
  onSave: (data: Omit<GLEntry, "id" | "created_at">) => Promise<void>;
  onCancel: () => void;
}

function NewRow({ onSave, onCancel }: NewRowProps) {
  const [period, setPeriod] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [entity, setEntity] = useState("");
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function save() {
    const num = parseFloat(amount);
    if (!period || !account || isNaN(num)) return;
    setSaving(true);
    try {
      await onSave({ period, account, amount: num, entity });
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
      <td>
        <input
          ref={firstRef}
          className="input w-28 text-xs py-0.5"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="YYYY-MM"
        />
      </td>
      <td>
        <input
          className="input w-32 text-xs py-0.5"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Account"
        />
      </td>
      <td>
        <input
          className="input w-32 text-xs py-0.5 text-right"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="0.00"
          type="number"
          step="0.01"
        />
      </td>
      <td>
        <input
          className="input w-28 text-xs py-0.5"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Entity"
        />
      </td>
      <td>
        <div className="flex gap-1">
          <button
            className="btn btn-primary py-0.5 px-2 text-xs"
            onClick={save}
            disabled={saving || !period || !account || !amount}
          >
            {saving ? "…" : "Add"}
          </button>
          <button className="btn btn-outline py-0.5 px-2 text-xs" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function GLLedgerPage() {
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [selectedFyId, setSelectedFyId] = useState<number | null>(null);
  const [entries, setEntries] = useState<GLEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filterPeriod, setFilterPeriod] = useState("");
  const [filterAccount, setFilterAccount] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showNewRow, setShowNewRow] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const accountDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [accountSearch, setAccountSearch] = useState("");

  // Load fiscal years on mount
  useEffect(() => {
    listFiscalYears()
      .then((fys) => {
        setFiscalYears(fys);
        if (fys.length > 0) setSelectedFyId(fys[0].id);
      })
      .catch(() => setError("Could not load fiscal years. Make sure the Python backend is running."));
  }, []);

  // Debounce account search
  useEffect(() => {
    if (accountDebounceRef.current) clearTimeout(accountDebounceRef.current);
    accountDebounceRef.current = setTimeout(() => {
      setFilterAccount(accountSearch);
      setPage(0);
    }, 300);
    return () => { if (accountDebounceRef.current) clearTimeout(accountDebounceRef.current); };
  }, [accountSearch]);

  const load = useCallback(async () => {
    if (!selectedFyId) return;
    setLoading(true);
    setError(null);
    try {
      const [rows, countRes] = await Promise.all([
        listGLEntries(selectedFyId, {
          period: filterPeriod || undefined,
          account: filterAccount || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
        countGLEntries(selectedFyId, {
          period: filterPeriod || undefined,
          account: filterAccount || undefined,
        }),
      ]);
      setEntries(rows);
      setTotal(countRes.count);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedFyId, filterPeriod, filterAccount, page]);

  useEffect(() => {
    load();
  }, [load]);

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ message, type });
  }

  async function handleSaveEdit(entry: GLEntry, data: Omit<GLEntry, "id" | "created_at">) {
    try {
      await updateGLEntry(entry.id, data);
      setEditingId(null);
      await load();
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteGLEntry(id);
      await load();
      showToast("Entry deleted");
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  async function handleAddEntry(data: Omit<GLEntry, "id" | "created_at">) {
    if (!selectedFyId) return;
    try {
      await createGLEntry(selectedFyId, data);
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
      const result = await importGLEntries(selectedFyId, file);
      const msg = `${result.imported} rows imported${result.errors.length > 0 ? `, ${result.errors.length} errors` : ""}`;
      showToast(msg, result.errors.length > 0 ? "error" : "success");
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
      const result = await deleteAllGLEntries(selectedFyId);
      showToast(`${result.deleted} entries deleted`);
      setPage(0);
      await load();
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const uniquePeriods = [...new Set(entries.map((e) => e.period))].sort();

  const periodMin = entries.length > 0 ? entries.reduce((a, b) => (a.period < b.period ? a : b)).period : "";
  const periodMax = entries.length > 0 ? entries.reduce((a, b) => (a.period > b.period ? a : b)).period : "";
  const uniqueAccounts = new Set(entries.map((e) => e.account)).size;

  return (
    <main className="container" style={{ maxWidth: 1100 }}>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
      <ConfirmDialog
        open={showClearConfirm}
        title="Delete All GL Entries"
        message={`This will permanently delete all ${total} GL entries for this fiscal year. This cannot be undone.`}
        onConfirm={handleClearAll}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>GL Ledger</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Fiscal Year:</label>
          <select
            className="input text-xs py-1"
            value={selectedFyId ?? ""}
            onChange={(e) => {
              setSelectedFyId(Number(e.target.value));
              setPage(0);
              setFilterPeriod("");
              setAccountSearch("");
            }}
            style={{ minWidth: 180 }}
          >
            {fiscalYears.map((fy) => (
              <option key={fy.id} value={fy.id}>
                {fy.name} ({fy.start_month} – {fy.end_month})
              </option>
            ))}
          </select>
        </div>
      </div>

      <NextStepHint
        items={[
          { label: "Map GL accounts to pools", href: "/mappings", detail: "Assign accounts to Fringe, Overhead, or G&A pools." },
          { label: "Run forecast", href: "/forecast", detail: "Generate rate projections once actuals are loaded." },
        ]}
      />

      {error && (
        <div className="card" style={{ color: "var(--color-destructive)", marginBottom: 8, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="card" style={{ marginBottom: 8, padding: "10px 14px" }}>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filters */}
          <select
            className="input text-xs py-1"
            value={filterPeriod}
            onChange={(e) => { setFilterPeriod(e.target.value); setPage(0); }}
            style={{ minWidth: 120 }}
          >
            <option value="">All periods</option>
            {uniquePeriods.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <input
            className="input text-xs py-1"
            placeholder="Search account…"
            value={accountSearch}
            onChange={(e) => setAccountSearch(e.target.value)}
            style={{ minWidth: 140 }}
          />

          <div className="flex-1" />

          {/* Actions */}
          <button
            className="btn btn-outline text-xs py-1 px-3 flex items-center gap-1"
            onClick={() => load()}
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            className="btn btn-outline text-xs py-1 px-3 flex items-center gap-1"
            onClick={() => { setShowNewRow(true); }}
            title="Add entry"
          >
            <Plus className="w-3 h-3" /> Add Entry
          </button>
          <label
            className={`btn btn-outline text-xs py-1 px-3 flex items-center gap-1 cursor-pointer ${importing ? "opacity-50" : ""}`}
            title="Import CSV"
          >
            <Upload className="w-3 h-3" /> Import CSV
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleImport}
              disabled={importing || !selectedFyId}
            />
          </label>
          {selectedFyId && (
            <a
              href={exportGLEntriesUrl(selectedFyId)}
              download="GL_Actuals.csv"
              className="btn btn-outline text-xs py-1 px-3 flex items-center gap-1 no-underline"
              title="Export CSV"
            >
              <Download className="w-3 h-3" /> Export CSV
            </a>
          )}
          <button
            className="btn text-xs py-1 px-3 flex items-center gap-1 text-destructive bg-transparent! border border-destructive/40 hover:bg-destructive/10"
            onClick={() => setShowClearConfirm(true)}
            disabled={total === 0 || !selectedFyId}
            title="Clear all entries"
          >
            <Trash2 className="w-3 h-3" /> Clear All
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {total > 0 && (
        <div className="flex gap-4 text-xs text-muted-foreground" style={{ marginBottom: 6, paddingLeft: 2 }}>
          <span>{total.toLocaleString()} entries</span>
          {periodMin && <span>Periods: {periodMin} – {periodMax}</span>}
          <span>Accounts: {uniqueAccounts}</span>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Period</th>
                <th style={{ width: 140 }}>Account</th>
                <th style={{ width: 140, textAlign: "right" }}>Amount</th>
                <th style={{ width: 120 }}>Entity</th>
                <th style={{ width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {showNewRow && (
                <NewRow
                  onSave={handleAddEntry}
                  onCancel={() => setShowNewRow(false)}
                />
              )}
              {loading && entries.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 24, color: "var(--color-muted-foreground)" }}>
                    Loading…
                  </td>
                </tr>
              ) : entries.length === 0 && !showNewRow ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 24, color: "var(--color-muted-foreground)" }}>
                    No GL entries found.{" "}
                    {!filterPeriod && !filterAccount
                      ? "Use 'Add Entry' or 'Import CSV' to add data."
                      : "Try clearing the filters."}
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
                    <tr
                      key={entry.id}
                      className="cursor-pointer hover:bg-accent/30"
                      onClick={() => setEditingId(entry.id)}
                      title="Click to edit"
                    >
                      <td>{entry.period}</td>
                      <td>{entry.account}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {Number(entry.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="text-muted-foreground">{entry.entity || "—"}</td>
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground">
            <button
              className="btn btn-outline py-0.5 px-2 text-xs"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              ← Prev
            </button>
            <span>
              Page {page + 1} of {totalPages} ({total.toLocaleString()} total)
            </span>
            <button
              className="btn btn-outline py-0.5 px-2 text-xs"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Click any row to edit inline. Press Enter to save, Escape to cancel.
        GL Ledger entries are used as the primary GL actuals source when running a forecast in DB mode.
      </p>
    </main>
  );
}
