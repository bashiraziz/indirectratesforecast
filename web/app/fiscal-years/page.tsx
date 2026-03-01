"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { listFiscalYears, createFiscalYear, deleteFiscalYear, copyFYSetup } from "@/lib/api";
import type { FiscalYear } from "@/lib/types";
import NextStepHint from "@/app/components/NextStepHint";
import { Dialog } from "@/app/components/Dialog";

export default function FiscalYearsPage() {
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("2024-10");
  const [newEnd, setNewEnd] = useState("2025-09");
  const [copyEnabled, setCopyEnabled] = useState(true);
  const [copySourceId, setCopySourceId] = useState<number | "">("");
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const fys = await listFiscalYears();
      setFiscalYears(fys);
    } catch (err) {
      setError("Could not load fiscal years. Make sure the Python backend is running (indirectrates serve).");
      console.error(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // When dialog opens, pre-select the most recently created FY as copy source
  useEffect(() => {
    if (showCreate && fiscalYears.length > 0) {
      setCopySourceId(fiscalYears[0].id);
      setCopyEnabled(true);
    }
  }, [showCreate, fiscalYears]);

  // Auto-dismiss toast after 5s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleCreate() {
    if (!newName.trim()) return;
    const newFY = await createFiscalYear({
      name: newName.trim(),
      start_month: newStart,
      end_month: newEnd,
    });
    setShowCreate(false);
    setNewName("");
    if (copyEnabled && copySourceId) {
      try {
        const result = await copyFYSetup(newFY.id, Number(copySourceId));
        const sourceName = fiscalYears.find((fy) => fy.id === Number(copySourceId))?.name ?? String(copySourceId);
        setToast(`Created ${newFY.name}. Copied ${result.pool_groups} pool groups + ${result.gl_mappings} mappings from ${sourceName}.`);
      } catch {
        setToast(`Created ${newFY.name}. (Copy failed — configure pools manually.)`);
      }
    } else {
      setToast(`Created ${newFY.name}.`);
    }
    await load();
  }

  async function handleDelete(id: number) {
    await deleteFiscalYear(id);
    await load();
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold mt-0 mb-0">Fiscal Years</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="text-xs px-3 py-1.5 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> New Fiscal Year
        </button>
      </div>
      <p className="text-muted-foreground text-sm mb-4">
        Manage fiscal year definitions used across pool setup, forecasting, and reporting.
      </p>
      <NextStepHint
        items={[
          { label: "Load chart of accounts", href: "/chart-of-accounts", detail: "Add GL accounts for this fiscal year." },
          { label: "Configure pools", href: "/pools", detail: "Set up rate groups, pool groups, and mappings." },
        ]}
      />

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-sidebar">
              <th className="text-left px-4 py-2.5 font-semibold">Name</th>
              <th className="text-left px-4 py-2.5 font-semibold">Start Month</th>
              <th className="text-left px-4 py-2.5 font-semibold">End Month</th>
              <th className="text-left px-4 py-2.5 font-semibold">Created</th>
              <th className="w-12 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {fiscalYears.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No fiscal years defined yet. Click &quot;New Fiscal Year&quot; to create one.
                </td>
              </tr>
            )}
            {fiscalYears.map((fy) => (
              <tr key={fy.id} className="border-b border-border last:border-b-0 hover:bg-accent/30 transition-colors">
                <td className="px-4 py-2.5 font-medium">{fy.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{fy.start_month}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{fy.end_month}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">
                  {new Date(fy.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => handleDelete(fy.id)}
                    className="bg-transparent! border-none! p-1 hover:bg-destructive/20 rounded text-destructive"
                    title="Delete fiscal year"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title="Create Fiscal Year">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs">Name</label>
            <input
              className="w-full mt-1"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="FY2025"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs">Start Month</label>
              <input className="w-full mt-1" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
            </div>
            <div>
              <label className="text-xs">End Month</label>
              <input className="w-full mt-1" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
            </div>
          </div>
          {fiscalYears.length > 0 && (
            <div className="border border-border rounded-md p-3 bg-accent/20">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="copy-config"
                  checked={copyEnabled}
                  onChange={(e) => setCopyEnabled(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <label htmlFor="copy-config" className="text-xs font-medium cursor-pointer">
                  Copy configuration from existing FY
                </label>
              </div>
              {copyEnabled && (
                <select
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                  value={copySourceId}
                  onChange={(e) => setCopySourceId(e.target.value ? Number(e.target.value) : "")}
                >
                  {fiscalYears.map((fy) => (
                    <option key={fy.id} value={fy.id}>
                      {fy.name} ({fy.start_month} — {fy.end_month})
                    </option>
                  ))}
                </select>
              )}
              <p className="text-[10px] text-muted-foreground mt-1.5 mb-0">
                Clones pool groups, GL mappings, and chart accounts.
              </p>
            </div>
          )}
          <button onClick={handleCreate} className="mt-2">
            Create
          </button>
        </div>
      </Dialog>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-sidebar border border-border rounded-lg px-4 py-2.5 text-sm shadow-lg flex items-center gap-3 min-w-72 max-w-lg">
          <Check className="w-4 h-4 text-green-500 shrink-0" />
          <span className="flex-1">{toast}</span>
          <button onClick={() => setToast(null)} className="bg-transparent! border-none! p-0 text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
