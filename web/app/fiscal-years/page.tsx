"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { listFiscalYears, createFiscalYear, deleteFiscalYear } from "@/lib/api";
import type { FiscalYear } from "@/lib/types";

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
        className="bg-sidebar border border-border rounded-lg p-5 w-full max-w-md mx-4"
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

export default function FiscalYearsPage() {
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("2024-10");
  const [newEnd, setNewEnd] = useState("2025-09");

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

  async function handleCreate() {
    if (!newName.trim()) return;
    await createFiscalYear({
      name: newName.trim(),
      start_month: newStart,
      end_month: newEnd,
    });
    setShowCreate(false);
    setNewName("");
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
          <button onClick={handleCreate} className="mt-2">
            Create
          </button>
        </div>
      </Dialog>
    </div>
  );
}
