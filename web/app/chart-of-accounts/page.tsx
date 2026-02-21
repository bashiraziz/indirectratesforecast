"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Upload, X } from "lucide-react";
import {
  listFiscalYears,
  listChartOfAccounts,
  createChartAccount,
  bulkCreateChartAccounts,
  deleteChartAccount,
} from "@/lib/api";
import type { FiscalYear, ChartAccount } from "@/lib/types";

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
          <button onClick={onClose} className="p-1 rounded hover:bg-accent bg-transparent! border-none!">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

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
    if (fys.length > 0 && !selected) {
      onSelect(fys[0]);
    }
  }, [selected, onSelect]);

  useEffect(() => {
    load();
  }, [load]);

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

export default function ChartOfAccountsPage() {
  const [selectedFY, setSelectedFY] = useState<FiscalYear | null>(null);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [newAccount, setNewAccount] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    if (!selectedFY) {
      setAccounts([]);
      return;
    }
    const accts = await listChartOfAccounts(selectedFY.id);
    setAccounts(accts);
  }, [selectedFY]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    if (!newAccount.trim() || !selectedFY) return;
    await createChartAccount(selectedFY.id, {
      account: newAccount.trim(),
      name: newName.trim(),
      category: newCategory.trim(),
    });
    setNewAccount("");
    setNewName("");
    setNewCategory("");
    setShowAdd(false);
    await load();
  }

  async function handleBulkImport() {
    if (!bulkText.trim() || !selectedFY) return;
    const lines = bulkText.trim().split("\n").filter((l) => l.trim());
    const parsed = lines.map((line) => {
      const parts = line.split(",").map((s) => s.trim());
      return {
        account: parts[0] || "",
        name: parts[1] || "",
        category: parts[2] || "",
      };
    }).filter((a) => a.account);
    if (parsed.length > 0) {
      await bulkCreateChartAccounts(selectedFY.id, parsed);
    }
    setBulkText("");
    setShowBulk(false);
    await load();
  }

  async function handleDelete(id: number) {
    await deleteChartAccount(id);
    await load();
  }

  const filtered = filter
    ? accounts.filter(
        (a) =>
          a.account.toLowerCase().includes(filter.toLowerCase()) ||
          a.name.toLowerCase().includes(filter.toLowerCase()) ||
          a.category.toLowerCase().includes(filter.toLowerCase())
      )
    : accounts;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold mt-0 mb-0">Chart of Accounts</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBulk(true)}
            className="text-xs px-3 py-1.5 flex items-center gap-1 bg-transparent! border border-border"
          >
            <Upload className="w-3 h-3" /> Bulk Import
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs px-3 py-1.5 flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add Account
          </button>
        </div>
      </div>
      <p className="text-muted-foreground text-sm mb-4">
        Master GL account list for this fiscal year. These accounts are available for assignment to pools.
      </p>

      <FYSelector selected={selectedFY} onSelect={setSelectedFY} />

      {selectedFY && (
        <>
          <div className="mb-3">
            <input
              className="w-full max-w-xs text-sm"
              placeholder="Filter accounts..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-sidebar">
                  <th className="text-left px-4 py-2.5 font-semibold">Account #</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Name</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Category</th>
                  <th className="w-12 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      {accounts.length === 0
                        ? 'No accounts defined yet. Click "Add Account" or "Bulk Import" to add GL accounts.'
                        : "No accounts match the filter."}
                    </td>
                  </tr>
                )}
                {filtered.map((acct) => (
                  <tr key={acct.id} className="border-b border-border last:border-b-0 hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-2.5 font-mono font-medium">{acct.account}</td>
                    <td className="px-4 py-2.5">{acct.name}</td>
                    <td className="px-4 py-2.5">
                      {acct.category && (
                        <span className="text-xs bg-accent px-2 py-0.5 rounded">{acct.category}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => handleDelete(acct.id)}
                        className="bg-transparent! border-none! p-1 hover:bg-destructive/20 rounded text-destructive"
                        title="Delete account"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 text-xs text-muted-foreground">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""} total
          </div>
        </>
      )}

      {/* Add Single Account Dialog */}
      <Dialog open={showAdd} onClose={() => setShowAdd(false)} title="Add GL Account">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs">Account Number</label>
            <input
              className="w-full mt-1"
              value={newAccount}
              onChange={(e) => setNewAccount(e.target.value)}
              placeholder="e.g. 5001.1"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs">Name</label>
            <input
              className="w-full mt-1"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Direct Labor - Engineers"
            />
          </div>
          <div>
            <label className="text-xs">Category</label>
            <input
              className="w-full mt-1"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="e.g. Labor, Travel, ODC"
            />
          </div>
          <button onClick={handleAdd} className="mt-2">
            Add
          </button>
        </div>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={showBulk} onClose={() => setShowBulk(false)} title="Bulk Import Accounts">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground m-0">
            Paste one account per line in CSV format: <code>account, name, category</code>
          </p>
          <textarea
            className="w-full h-48 font-mono text-xs rounded-md border border-input bg-background p-2"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={`5001.1, Direct Labor - Engineers, Labor\n5001.2, Direct Labor - Admin, Labor\n6100, Travel, Travel\n6200, Subcontracts, Subk`}
          />
          <button onClick={handleBulkImport} className="mt-2">
            Import
          </button>
        </div>
      </Dialog>
    </div>
  );
}
