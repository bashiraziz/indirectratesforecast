"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Pencil,
  X,
} from "lucide-react";
import {
  listFiscalYears,
  createFiscalYear,
  listRateGroups,
  createRateGroup,
  deleteRateGroup,
  updateRateGroup,
  listPoolGroupsByRateGroup,
  listPoolGroups,
  createPoolGroup,
  deletePoolGroup,
  updatePoolGroup,
  listPools,
  createPool,
  deletePool,
  listGLMappings,
  createGLMapping,
  deleteGLMapping,
  getAvailableCostAccounts,
  getAvailableBaseAccounts,
  listBaseAccounts,
  createBaseAccount,
  deleteBaseAccount,
  copyFYSetup,
  listChartOfAccounts,
} from "@/lib/api";
import type { FiscalYear, RateGroup, PoolGroup, Pool, GLMapping, ChartAccount, BaseAccount } from "@/lib/types";
import NextStepHint from "@/app/components/NextStepHint";

interface AISuggestion {
  account: string;
  suggested_pool_id: number;
  suggested_pool_name: string;
  is_unallowable: boolean;
  reason: string;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white border border-border rounded-lg p-5 w-full max-w-md mx-4 shadow-lg"
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
// Fiscal Year Selector
// ---------------------------------------------------------------------------
function FYSelector({
  selected,
  onSelect,
}: {
  selected: FiscalYear | null;
  onSelect: (fy: FiscalYear) => void;
}) {
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("2024-10");
  const [newEnd, setNewEnd] = useState("2025-09");

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

  async function handleCreate() {
    if (!newName.trim()) return;
    const fy = await createFiscalYear({
      name: newName.trim(),
      start_month: newStart,
      end_month: newEnd,
    });
    setShowCreate(false);
    setNewName("");
    await load();
    onSelect(fy as FiscalYear);
  }

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
      <button
        onClick={() => setShowCreate(true)}
        className="bg-primary/80! text-xs px-3 py-1.5 flex items-center gap-1"
      >
        <Plus className="w-3 h-3" /> New FY
      </button>
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

// ---------------------------------------------------------------------------
// Account Shuttle Component
// ---------------------------------------------------------------------------
function AccountShuttle({
  title,
  available,
  assigned,
  onAssign,
  onUnassign,
  error,
  headerActions,
}: {
  title: string;
  available: ChartAccount[];
  assigned: { id: number; account: string; name?: string }[];
  onAssign: (accounts: ChartAccount[]) => Promise<void>;
  onUnassign: (ids: number[]) => Promise<void>;
  error?: string | null;
  headerActions?: React.ReactNode;
}) {
  const [selectedAvailable, setSelectedAvailable] = useState<Set<string>>(new Set());
  const [selectedAssigned, setSelectedAssigned] = useState<Set<number>>(new Set());
  const [filterAvailable, setFilterAvailable] = useState("");
  const [filterAssigned, setFilterAssigned] = useState("");

  const filteredAvailable = filterAvailable
    ? available.filter(
        (a) =>
          a.account.toLowerCase().includes(filterAvailable.toLowerCase()) ||
          a.name.toLowerCase().includes(filterAvailable.toLowerCase())
      )
    : available;

  const filteredAssigned = filterAssigned
    ? assigned.filter(
        (a) =>
          a.account.toLowerCase().includes(filterAssigned.toLowerCase()) ||
          (a.name || "").toLowerCase().includes(filterAssigned.toLowerCase())
      )
    : assigned;

  function toggleAvailable(account: string) {
    setSelectedAvailable((prev) => {
      const next = new Set(prev);
      if (next.has(account)) next.delete(account);
      else next.add(account);
      return next;
    });
  }

  function toggleAssigned(id: number) {
    setSelectedAssigned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function moveRight() {
    const toMove = available.filter((a) => selectedAvailable.has(a.account));
    if (toMove.length === 0) return;
    await onAssign(toMove);
    setSelectedAvailable(new Set());
  }

  async function moveLeft() {
    const ids = Array.from(selectedAssigned);
    if (ids.length === 0) return;
    await onUnassign(ids);
    setSelectedAssigned(new Set());
  }

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 flex items-center justify-between">
        <span>{title}</span>
        {headerActions}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5">
        {/* Available list */}
        <div className="border border-border rounded-md overflow-hidden">
          <div className="bg-sidebar px-2 py-1.5 border-b border-border">
            <input
              className="w-full text-xs bg-transparent border-none! outline-none p-0 m-0"
              placeholder="Filter available..."
              value={filterAvailable}
              onChange={(e) => setFilterAvailable(e.target.value)}
            />
          </div>
          <div className="h-32 overflow-y-auto">
            {filteredAvailable.length === 0 && (
              <div className="text-[10px] text-muted-foreground p-2 text-center">
                {available.length === 0 ? "No accounts available" : "No matches"}
              </div>
            )}
            {filteredAvailable.map((a) => (
              <div
                key={a.account}
                className={`flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer hover:bg-accent/50 ${
                  selectedAvailable.has(a.account) ? "bg-primary/15 text-primary" : ""
                }`}
                onClick={() => toggleAvailable(a.account)}
              >
                <span className="font-mono">{a.account}</span>
                {a.name && <span className="text-muted-foreground truncate text-[10px]">{a.name}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Shuttle buttons */}
        <div className="flex flex-col items-center justify-center gap-1">
          <button
            onClick={moveRight}
            disabled={selectedAvailable.size === 0}
            className="p-1 rounded border border-border hover:bg-accent disabled:opacity-30 bg-transparent!"
            title="Assign selected"
          >
            <ChevronRight className="w-3 h-3" />
          </button>
          <button
            onClick={moveLeft}
            disabled={selectedAssigned.size === 0}
            className="p-1 rounded border border-border hover:bg-accent disabled:opacity-30 bg-transparent!"
            title="Unassign selected"
          >
            <ChevronLeft className="w-3 h-3" />
          </button>
        </div>

        {/* Assigned list */}
        <div className="border border-border rounded-md overflow-hidden">
          <div className="bg-sidebar px-2 py-1.5 border-b border-border">
            <input
              className="w-full text-xs bg-transparent border-none! outline-none p-0 m-0"
              placeholder="Filter assigned..."
              value={filterAssigned}
              onChange={(e) => setFilterAssigned(e.target.value)}
            />
          </div>
          <div className="h-32 overflow-y-auto">
            {filteredAssigned.length === 0 && (
              <div className="text-[10px] text-muted-foreground p-2 text-center">
                {assigned.length === 0 ? "None assigned" : "No matches"}
              </div>
            )}
            {filteredAssigned.map((a) => (
              <div
                key={a.id}
                className={`flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer hover:bg-accent/50 ${
                  selectedAssigned.has(a.id) ? "bg-primary/15 text-primary" : ""
                }`}
                onClick={() => toggleAssigned(a.id)}
              >
                <span className="font-mono">{a.account}</span>
                {a.name && <span className="text-muted-foreground truncate text-[10px]">{a.name}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
      {error && (
        <div className="mt-1.5 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pool Group Accordion Item (Level 2 — inside a Rate Group)
// ---------------------------------------------------------------------------
function PoolGroupItem({
  pg,
  fyId,
  isExpanded,
  onToggle,
  onRefresh,
  poolCount,
}: {
  pg: PoolGroup;
  fyId: number;
  isExpanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  poolCount: number;
}) {
  // --- DB state (source of truth, loaded from server) ---
  const [pools, setPools] = useState<Pool[]>([]);
  const [dbCostMappings, setDbCostMappings] = useState<GLMapping[]>([]);
  const [dbBaseAccts, setDbBaseAccts] = useState<BaseAccount[]>([]);
  const [dbAvailableCost, setDbAvailableCost] = useState<ChartAccount[]>([]);
  const [dbAvailableBase, setDbAvailableBase] = useState<ChartAccount[]>([]);
  const [coaNameMap, setCoaNameMap] = useState<Record<string, string>>({});

  // --- Pending local changes (not yet saved) ---
  const [pendingCostAdds, setPendingCostAdds] = useState<ChartAccount[]>([]);
  const [pendingCostRemoves, setPendingCostRemoves] = useState<Set<number>>(new Set());
  const [pendingCostUnallowable, setPendingCostUnallowable] = useState<Set<string>>(new Set());
  const [pendingBaseAdds, setPendingBaseAdds] = useState<ChartAccount[]>([]);
  const [pendingBaseRemoves, setPendingBaseRemoves] = useState<Set<number>>(new Set());

  // --- AI Suggest state ---
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[] | null>(null);
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<string>>(new Set());
  const [showSuggestDialog, setShowSuggestDialog] = useState(false);
  const [aiToast, setAiToast] = useState<string | null>(null);

  const [showAddPool, setShowAddPool] = useState(false);
  const [newPoolName, setNewPoolName] = useState("");
  const [costError, setCostError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(pg.name);
  const [editBase, setEditBase] = useState(pg.base);
  const [editCascadeOrder, setEditCascadeOrder] = useState(pg.cascade_order ?? 0);

  const hasPendingChanges =
    pendingCostAdds.length > 0 ||
    pendingCostRemoves.size > 0 ||
    pendingBaseAdds.length > 0 ||
    pendingBaseRemoves.size > 0;

  function clearPending() {
    setPendingCostAdds([]);
    setPendingCostRemoves(new Set());
    setPendingCostUnallowable(new Set());
    setPendingBaseAdds([]);
    setPendingBaseRemoves(new Set());
    setCostError(null);
  }

  const loadDetails = useCallback(async () => {
    if (!isExpanded) return;

    const [poolsList, baseList, costAvail, baseAvail, coa] = await Promise.all([
      listPools(pg.id),
      listBaseAccounts(pg.id),
      getAvailableCostAccounts(fyId),
      getAvailableBaseAccounts(fyId),
      listChartOfAccounts(fyId),
    ]);

    setPools(poolsList);
    setDbBaseAccts(baseList);
    setDbAvailableCost(costAvail);
    setDbAvailableBase(baseAvail);

    // Build account number → name lookup from full COA
    const nameMap: Record<string, string> = {};
    for (const a of coa) {
      nameMap[a.account] = a.name;
    }
    setCoaNameMap(nameMap);

    // Load cost mappings from all pools
    const mappingPromises = poolsList.map((p) => listGLMappings(p.id));
    const mappingsArrays = await Promise.all(mappingPromises);
    setDbCostMappings(mappingsArrays.flat());
  }, [isExpanded, pg.id, fyId]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  async function handleAddPool() {
    if (!newPoolName.trim()) return;
    await createPool(pg.id, { name: newPoolName.trim() });
    setNewPoolName("");
    setShowAddPool(false);
    await loadDetails();
  }

  async function handleDeletePool(poolId: number) {
    await deletePool(poolId);
    await loadDetails();
  }

  async function handleUpdateGroup() {
    await updatePoolGroup(pg.id, { name: editName, base: editBase, cascade_order: editCascadeOrder });
    setEditing(false);
    onRefresh();
  }

  async function handleDeleteGroup() {
    await deletePoolGroup(pg.id);
    onRefresh();
  }

  // --- Shuttle handlers: modify local pending state only ---

  function handleAssignCost(accounts: ChartAccount[]) {
    setCostError(null);
    setPendingCostAdds((prev) => [...prev, ...accounts]);
  }

  function handleUnassignCost(ids: number[]) {
    setCostError(null);
    // Split into DB removals vs cancelling pending adds
    const dbIds = ids.filter((id) => id > 0);
    const pendingIds = ids.filter((id) => id < 0);

    if (dbIds.length > 0) {
      setPendingCostRemoves((prev) => {
        const next = new Set(prev);
        dbIds.forEach((id) => next.add(id));
        return next;
      });
    }
    if (pendingIds.length > 0) {
      // Pending adds use negative IDs; recover the index
      const removeAccounts = new Set(pendingIds.map((id) => {
        const item = effectiveCostItems.find((i) => i.id === id);
        return item?.account;
      }));
      setPendingCostAdds((prev) => prev.filter((a) => !removeAccounts.has(a.account)));
    }
  }

  function handleAssignBase(accounts: ChartAccount[]) {
    setPendingBaseAdds((prev) => [...prev, ...accounts]);
  }

  function handleUnassignBase(ids: number[]) {
    const dbIds = ids.filter((id) => id > 0);
    const pendingIds = ids.filter((id) => id < 0);

    if (dbIds.length > 0) {
      setPendingBaseRemoves((prev) => {
        const next = new Set(prev);
        dbIds.forEach((id) => next.add(id));
        return next;
      });
    }
    if (pendingIds.length > 0) {
      const removeAccounts = new Set(pendingIds.map((id) => {
        const item = effectiveBaseItems.find((i) => i.id === id);
        return item?.account;
      }));
      setPendingBaseAdds((prev) => prev.filter((a) => !removeAccounts.has(a.account)));
    }
  }

  // --- Save: persist all pending changes to DB ---
  async function handleSave() {
    setSaving(true);
    setCostError(null);
    try {
      // Ensure a pool exists for cost account mappings
      let targetPoolId: number;
      if (pools.length === 0 && pendingCostAdds.length > 0) {
        const result = await createPool(pg.id, { name: pg.name });
        targetPoolId = result.id;
      } else if (pools.length > 0) {
        targetPoolId = pools[0].id;
      } else {
        targetPoolId = 0; // no cost adds needed
      }

      // Remove cost mappings
      for (const id of pendingCostRemoves) {
        await deleteGLMapping(id);
      }
      // Add cost mappings
      for (const acct of pendingCostAdds) {
        try {
          await createGLMapping(targetPoolId, {
            account: acct.account,
            is_unallowable: pendingCostUnallowable.has(acct.account),
          });
        } catch (err: any) {
          let msg = err.message || "Failed to assign account";
          try {
            const parsed = JSON.parse(msg);
            if (parsed.detail) msg = parsed.detail;
          } catch {
            // already a plain string
          }
          setCostError(msg);
          // Reload to reflect partial saves and stop
          await loadDetails();
          clearPending();
          setSaving(false);
          return;
        }
      }
      // Remove base accounts
      for (const id of pendingBaseRemoves) {
        await deleteBaseAccount(id);
      }
      // Add base accounts
      for (const acct of pendingBaseAdds) {
        await createBaseAccount(pg.id, { account: acct.account });
      }

      clearPending();
      await loadDetails();
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    clearPending();
  }

  async function handleAISuggest() {
    if (availableCost.length === 0) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const allPGs = await listPoolGroups(fyId);
      const poolsData = allPGs.map((p) => ({
        id: p.id,
        name: p.name,
        base: p.base,
        cascade_order: p.cascade_order ?? 0,
      }));
      const accountsData = availableCost.map((a) => ({
        account: a.account,
        name: a.name || "",
        category: a.category || "",
      }));

      const resp = await fetch("/api/suggest-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: accountsData, pools: poolsData }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data: AISuggestion[] = await resp.json();

      // Show ALL unmapped accounts — don't filter by pool group.
      // Pre-check only the ones AI recommends for this pool or flags as unallowable.
      // Accounts suggested for other pools appear un-checked with a "→ Pool" label
      // so the user can see where they belong and choose accordingly.
      setAiSuggestions(data);
      const defaultAccepted = new Set(
        data
          .filter((s) => s.suggested_pool_id === pg.id || s.is_unallowable)
          .map((s) => s.account)
      );
      setAcceptedSuggestions(defaultAccepted);
      setShowSuggestDialog(true);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI suggestion failed");
    } finally {
      setAiLoading(false);
    }
  }

  function handleApplySuggestions() {
    const toApply = (aiSuggestions || []).filter((s) => acceptedSuggestions.has(s.account));
    const existingAccounts = new Set(pendingCostAdds.map((a) => a.account));

    const newAdds: ChartAccount[] = [];
    const newUnallowable = new Set(pendingCostUnallowable);

    for (const s of toApply) {
      if (existingAccounts.has(s.account)) continue;
      const acct = availableCost.find((a) => a.account === s.account);
      if (!acct) continue;
      newAdds.push(acct);
      if (s.is_unallowable) newUnallowable.add(s.account);
    }

    if (newAdds.length > 0) {
      setPendingCostAdds((prev) => [...prev, ...newAdds]);
      setPendingCostUnallowable(newUnallowable);
    }

    setShowSuggestDialog(false);
    setAiSuggestions(null);

    const count = toApply.length;
    if (count > 0) {
      setAiToast(`${count} account${count === 1 ? "" : "s"} added. Review and Save.`);
      setTimeout(() => setAiToast(null), 4000);
    }
  }

  const BASE_OPTIONS = ["DL", "TL", "TCI", "DLH"];

  // --- Compute effective lists (DB state + pending changes) ---
  const pendingAddAccounts = new Set(pendingCostAdds.map((a) => a.account));
  const pendingBaseAddAccounts = new Set(pendingBaseAdds.map((a) => a.account));

  // Effective cost items: DB items (minus removals) + pending adds (with negative temp IDs)
  const effectiveCostItems = [
    ...dbCostMappings
      .filter((m) => !pendingCostRemoves.has(m.id))
      .map((m) => ({ id: m.id, account: m.account, name: coaNameMap[m.account] || "" })),
    ...pendingCostAdds.map((a, i) => ({ id: -(i + 1), account: a.account, name: a.name || coaNameMap[a.account] || "" })),
  ];

  const effectiveBaseItems = [
    ...dbBaseAccts
      .filter((b) => !pendingBaseRemoves.has(b.id))
      .map((b) => ({ id: b.id, account: b.account, name: coaNameMap[b.account] || "" })),
    ...pendingBaseAdds.map((a, i) => ({ id: -(i + 1), account: a.account, name: a.name || coaNameMap[a.account] || "" })),
  ];

  // Effective available: DB available minus pending adds
  const effectiveAvailableCost = dbAvailableCost.filter(
    (a) => !pendingAddAccounts.has(a.account)
  );
  const effectiveAvailableBase = dbAvailableBase.filter(
    (a) => !pendingBaseAddAccounts.has(a.account)
  );

  // Re-add accounts that are pending removal back to available
  const removedCostAccounts = dbCostMappings
    .filter((m) => pendingCostRemoves.has(m.id))
    .map((m) => ({ id: 0, fiscal_year_id: 0, account: m.account, name: "", category: "" } as ChartAccount));
  const removedBaseAccounts = dbBaseAccts
    .filter((b) => pendingBaseRemoves.has(b.id))
    .map((b) => ({ id: 0, fiscal_year_id: 0, account: b.account, name: "", category: "" } as ChartAccount));

  const availableCost = [...effectiveAvailableCost, ...removedCostAccounts].sort(
    (a, b) => a.account.localeCompare(b.account)
  );
  const availableBase = [...effectiveAvailableBase, ...removedBaseAccounts].sort(
    (a, b) => a.account.localeCompare(b.account)
  );

  // Detect accounts that appear in both cost and base of the same pool group
  const costAcctSet = new Set(effectiveCostItems.map((m) => m.account));
  const baseAcctSet = new Set(effectiveBaseItems.map((b) => b.account));
  const overlapAccounts = [...costAcctSet].filter((a) => baseAcctSet.has(a));

  return (
    <div className="border border-border rounded-lg overflow-hidden ml-4">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={onToggle}
      >
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
        <span className="font-medium text-sm flex-1">{pg.name}</span>
        <span className="text-xs text-muted-foreground bg-accent px-2 py-0.5 rounded">
          base: {editBase}
        </span>
        <span className="text-xs text-muted-foreground bg-accent/60 px-2 py-0.5 rounded">
          cascade: {editCascadeOrder}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="bg-transparent! border-none! p-1 hover:bg-accent rounded"
          title="Edit"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteGroup();
          }}
          className="bg-transparent! border-none! p-1 hover:bg-destructive/20 rounded text-destructive"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-border px-3 py-3 bg-background/30">
          {/* Sub-pools */}
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
              Sub-pools
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {pools.map((pool) => (
                <div
                  key={pool.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-border"
                >
                  {pool.name}
                  <button
                    onClick={() => handleDeletePool(pool.id)}
                    className="bg-transparent! border-none! p-0 hover:text-destructive"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            {showAddPool ? (
              <div className="flex items-center gap-2">
                <input
                  className="text-xs px-2 py-1 flex-1"
                  placeholder="Sub-pool name"
                  value={newPoolName}
                  onChange={(e) => setNewPoolName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddPool()}
                  autoFocus
                />
                <button onClick={handleAddPool} className="text-xs px-2 py-1">
                  Add
                </button>
                <button onClick={() => setShowAddPool(false)} className="text-xs px-2 py-1 bg-transparent!">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddPool(true)}
                className="text-xs bg-transparent! border-dashed! border border-border hover:border-primary px-2 py-1 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add sub-pool
              </button>
            )}
          </div>

          {/* Shuttle UI: Cost Accounts and Base Accounts side by side */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <AccountShuttle
              title="Cost Accounts (Numerator)"
              available={availableCost}
              assigned={effectiveCostItems}
              onAssign={async (accts) => handleAssignCost(accts)}
              onUnassign={async (ids) => handleUnassignCost(ids)}
              error={costError}
              headerActions={
                availableCost.length > 0 ? (
                  <button
                    onClick={handleAISuggest}
                    disabled={aiLoading}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 border-none! disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Use AI to suggest account mappings for this pool"
                  >
                    {aiLoading
                      ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      : <Sparkles className="w-2.5 h-2.5" />}
                    {aiLoading ? "On it…" : "AI Suggest"}
                  </button>
                ) : undefined
              }
            />
            <AccountShuttle
              title="Base Accounts (Denominator)"
              available={availableBase}
              assigned={effectiveBaseItems}
              onAssign={async (accts) => handleAssignBase(accts)}
              onUnassign={async (ids) => handleUnassignBase(ids)}
            />
          </div>

          {/* AI loading strip */}
          {aiLoading && (
            <div className="flex items-center gap-2 text-[11px] text-primary px-2.5 py-1.5 rounded-md bg-primary/8 border border-primary/20 -mt-2">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              On it — classifying your accounts…
            </div>
          )}

          {/* AI error */}
          {aiError && (
            <div className="mt-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5 flex items-center justify-between">
              <span>{aiError}</span>
              <button onClick={() => setAiError(null)} className="bg-transparent! border-none! p-0 text-red-500 hover:text-red-700 ml-2">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* AI toast */}
          {aiToast && (
            <div className="mt-2 text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-md px-2.5 py-1.5 flex items-center gap-1.5">
              <Check className="w-3 h-3 shrink-0" />
              {aiToast}
            </div>
          )}

          {/* Overlap warning */}
          {overlapAccounts.length > 0 && (
            <div className="mt-2 flex items-start gap-2 text-[11px] rounded-md px-2.5 py-1.5 bg-amber-50 border border-amber-200 text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {overlapAccounts.length === 1 ? "Account" : "Accounts"}{" "}
                <strong>{overlapAccounts.join(", ")}</strong>{" "}
                {overlapAccounts.length === 1 ? "appears" : "appear"} in both the cost (numerator) and base (denominator) of this pool group. An account should not be in both sides of the same rate calculation.
              </span>
            </div>
          )}

          {/* Save / Cancel bar */}
          <div className="mt-3 flex items-center gap-2">
            {hasPendingChanges ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="text-xs px-4 py-1.5 flex items-center gap-1.5"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="text-xs px-4 py-1.5 bg-transparent! border border-border flex items-center gap-1.5"
                >
                  Cancel
                </button>
                <span className="text-[10px] text-muted-foreground ml-1">
                  Unsaved changes
                </span>
              </>
            ) : (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Check className="w-3 h-3 text-green-500" />
                All changes saved
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit Pool Group">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs">Name</label>
            <input className="w-full mt-1" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs">Base (fallback if no base accounts assigned)</label>
            <select className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm" value={editBase} onChange={(e) => setEditBase(e.target.value)}>
              {BASE_OPTIONS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs">Cascade Order</label>
            <select
              className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={editCascadeOrder}
              onChange={(e) => setEditCascadeOrder(Number(e.target.value))}
            >
              {Array.from({ length: poolCount }, (_, i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1 mb-0">
              Lower values cascade first (0 = computed first). Pools with the same order are computed independently at the same tier.
            </p>
          </div>
          <button onClick={handleUpdateGroup} className="mt-2">Save</button>
        </div>
      </Dialog>

      {/* AI Suggestions Dialog */}
      {showSuggestDialog && aiSuggestions !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowSuggestDialog(false)}>
          <div
            className="bg-sidebar border border-border rounded-lg p-5 w-full max-w-xl mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold m-0 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                AI Account Suggestions — {pg.name}
              </h3>
              <button onClick={() => setShowSuggestDialog(false)} className="p-1 rounded hover:bg-accent bg-transparent! border-none!">
                <X className="w-4 h-4" />
              </button>
            </div>
            {(() => {
              const forThisPool = aiSuggestions.filter(
                (s) => s.suggested_pool_id === pg.id || s.is_unallowable
              ).length;
              const forOtherPool = aiSuggestions.length - forThisPool;
              if (aiSuggestions.length === 0) {
                return <p className="text-[11px] text-muted-foreground mb-3">No unmapped accounts found.</p>;
              }
              return (
                <p className="text-[11px] text-muted-foreground mb-3">
                  {forThisPool > 0 && (
                    <><span className="text-green-600 font-medium">{forThisPool} account{forThisPool === 1 ? "" : "s"} recommended for {pg.name}</span> (pre-checked){forOtherPool > 0 ? " · " : "."}</>
                  )}
                  {forOtherPool > 0 && (
                    <>{forThisPool === 0 ? "No accounts recommended for this pool. " : ""}<span className="text-muted-foreground">{forOtherPool} suggested for other pools</span> — shown for reference, unchecked.</>
                  )}
                </p>
              );
            })()}
            {aiSuggestions.length > 0 && (
              <>
                <div className="border border-border rounded-md overflow-hidden mb-3">
                  <div className="grid grid-cols-[auto_1fr_1fr_1fr] text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-3 py-1.5 bg-accent/40 border-b border-border">
                    <span className="w-5" />
                    <span>Account</span>
                    <span>AI Suggestion</span>
                    <span>Reason</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {aiSuggestions.map((s) => {
                      const isThisPool = s.suggested_pool_id === pg.id;
                      const isOtherPool = !isThisPool && !s.is_unallowable && s.suggested_pool_id !== -1;
                      return (
                        <div
                          key={s.account}
                          className={`grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-2 px-3 py-1.5 text-xs border-b border-border/50 last:border-b-0 hover:bg-accent/20 ${isOtherPool ? "opacity-60" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={acceptedSuggestions.has(s.account)}
                            onChange={(e) => {
                              setAcceptedSuggestions((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(s.account);
                                else next.delete(s.account);
                                return next;
                              });
                            }}
                            className="w-3.5 h-3.5"
                          />
                          <span className="font-mono truncate">{s.account}</span>
                          <span className="truncate">
                            {s.is_unallowable ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
                                Unallowable
                              </span>
                            ) : isThisPool ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">
                                {pg.name} ✓
                              </span>
                            ) : s.suggested_pool_id === -1 ? (
                              <span className="text-[10px] text-muted-foreground">No match</span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">→ {s.suggested_pool_name}</span>
                            )}
                          </span>
                          <span className="text-[10px] text-muted-foreground truncate" title={s.reason}>{s.reason}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => setAcceptedSuggestions(new Set(aiSuggestions.map((s) => s.account)))}
                    className="text-xs bg-transparent! border border-border px-2 py-1"
                  >
                    Select all
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setShowSuggestDialog(false)} className="text-xs bg-transparent! border border-border px-3 py-1.5">
                      Cancel
                    </button>
                    <button
                      onClick={handleApplySuggestions}
                      disabled={acceptedSuggestions.size === 0}
                      className="text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" />
                      Apply to {pg.name} {acceptedSuggestions.size > 0 ? `(${acceptedSuggestions.size})` : ""}
                    </button>
                  </div>
                </div>
              </>
            )}
            {aiSuggestions.length === 0 && (
              <button onClick={() => setShowSuggestDialog(false)} className="w-full text-xs">
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rate Group Accordion Item (Level 1 — top level)
// ---------------------------------------------------------------------------
function RateGroupItem({
  rg,
  fyId,
  isExpanded,
  onToggle,
  expandedPG,
  setExpandedPG,
  onRefresh,
}: {
  rg: RateGroup;
  fyId: number;
  isExpanded: boolean;
  onToggle: () => void;
  expandedPG: number | null;
  setExpandedPG: (id: number | null) => void;
  onRefresh: () => void;
}) {
  const [poolGroups, setPoolGroups] = useState<PoolGroup[]>([]);
  const [showAddPool, setShowAddPool] = useState(false);
  const [newPoolName, setNewPoolName] = useState("");
  const [newPoolBase, setNewPoolBase] = useState("DL");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(rg.name);

  const loadPoolGroups = useCallback(async () => {
    if (isExpanded) {
      const pgs = await listPoolGroupsByRateGroup(rg.id);
      setPoolGroups(pgs);
    }
  }, [isExpanded, rg.id]);

  useEffect(() => {
    loadPoolGroups();
  }, [loadPoolGroups]);

  async function handleAddPool() {
    if (!newPoolName.trim()) return;
    await createPoolGroup(fyId, {
      name: newPoolName.trim(),
      base: newPoolBase,
      rate_group_id: rg.id,
    });
    setNewPoolName("");
    setNewPoolBase("DL");
    setShowAddPool(false);
    await loadPoolGroups();
  }

  async function handleUpdateGroup() {
    await updateRateGroup(rg.id, { name: editName });
    setEditing(false);
    onRefresh();
  }

  async function handleDeleteGroup() {
    await deleteRateGroup(rg.id);
    onRefresh();
  }

  const BASE_OPTIONS = ["DL", "TL", "TCI", "DLH"];

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={onToggle}
      >
        {isExpanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
        <span className="font-semibold text-sm flex-1">{rg.name}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="bg-transparent! border-none! p-1 hover:bg-accent rounded"
          title="Edit"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteGroup();
          }}
          className="bg-transparent! border-none! p-1 hover:bg-destructive/20 rounded text-destructive"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-border px-3 py-2 bg-background/30">
          <div className="flex flex-col gap-2 mb-2">
            {poolGroups.map((pg) => (
              <PoolGroupItem
                key={pg.id}
                pg={pg}
                fyId={fyId}
                isExpanded={expandedPG === pg.id}
                onToggle={() => setExpandedPG(expandedPG === pg.id ? null : pg.id)}
                onRefresh={loadPoolGroups}
                poolCount={poolGroups.length}
              />
            ))}
            {poolGroups.length === 0 && (
              <div className="text-xs text-muted-foreground py-2 ml-4">
                No pools in this group yet.
              </div>
            )}
          </div>
          {showAddPool ? (
            <div className="flex items-center gap-2 ml-4">
              <input
                className="text-xs px-2 py-1 flex-1"
                placeholder="Pool name (e.g. Fringe)"
                value={newPoolName}
                onChange={(e) => setNewPoolName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddPool()}
                autoFocus
              />
              <select
                className="text-xs rounded-md border border-input bg-background px-2 py-1"
                value={newPoolBase}
                onChange={(e) => setNewPoolBase(e.target.value)}
              >
                {BASE_OPTIONS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <button onClick={handleAddPool} className="text-xs px-2 py-1">
                Add
              </button>
              <button onClick={() => setShowAddPool(false)} className="text-xs px-2 py-1 bg-transparent!">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddPool(true)}
              className="text-xs bg-transparent! border-dashed! border border-border hover:border-primary px-2 py-1 flex items-center gap-1 ml-4"
            >
              <Plus className="w-3 h-3" /> Add Pool
            </button>
          )}
        </div>
      )}

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit Group">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs">Name</label>
            <input className="w-full mt-1" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <button onClick={handleUpdateGroup} className="mt-2">Save</button>
        </div>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Pool Setup Page
// ---------------------------------------------------------------------------
export default function PoolSetupPage() {
  const [selectedFY, setSelectedFY] = useState<FiscalYear | null>(null);
  const [allFYs, setAllFYs] = useState<FiscalYear[]>([]);
  const [rateGroups, setRateGroups] = useState<RateGroup[]>([]);
  const [expandedRG, setExpandedRG] = useState<number | null>(null);
  const [expandedPG, setExpandedPG] = useState<number | null>(null);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [showCopyFY, setShowCopyFY] = useState(false);
  const [sourceFYId, setSourceFYId] = useState<number | "">("");
  const [copyResult, setCopyResult] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  const loadGroups = useCallback(async () => {
    if (!selectedFY) {
      setRateGroups([]);
      return;
    }
    const [groups, fys] = await Promise.all([
      listRateGroups(selectedFY.id),
      listFiscalYears(),
    ]);
    setRateGroups(groups);
    setAllFYs(fys);
  }, [selectedFY]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  async function handleAddGroup() {
    if (!newGroupName.trim() || !selectedFY) return;
    await createRateGroup(selectedFY.id, { name: newGroupName.trim() });
    setNewGroupName("");
    setShowAddGroup(false);
    await loadGroups();
  }

  async function handleCopyFY() {
    if (!sourceFYId || !selectedFY) return;
    setCopying(true);
    setCopyResult(null);
    try {
      const result = await copyFYSetup(selectedFY.id, Number(sourceFYId));
      setCopyResult(
        `Copied from ${result.source}: ${result.rate_groups} rate groups, ${result.pool_groups} pool groups, ${result.pools} pools, ${result.gl_mappings} GL mappings, ${result.base_accounts} base accounts, ${result.chart_accounts} chart accounts.`
      );
      await loadGroups();
    } catch (err) {
      setCopyResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCopying(false);
    }
  }

  const otherFYs = allFYs.filter((fy) => fy.id !== selectedFY?.id);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-bold mt-0 mb-1">Pool Setup</h2>
      <p className="text-muted-foreground text-sm mb-4">
        Configure rate groups, indirect cost pools, and assign GL accounts from the Chart of Accounts as cost accounts (numerator) and base accounts (denominator).
      </p>
      <NextStepHint
        items={[
          { label: "Map cost categories", href: "/mappings", detail: "Align Labor/ODC/Subk category mappings." },
          { label: "Validate formulas", href: "/cost-structure", detail: "Review cascade formulas by category and GL." },
        ]}
      />

      <FYSelector selected={selectedFY} onSelect={setSelectedFY} />

      {selectedFY && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold m-0">Rate Structure</h3>
            <div className="flex items-center gap-2">
              {otherFYs.length > 0 && (
                <button
                  onClick={() => {
                    setShowCopyFY(true);
                    setCopyResult(null);
                    setSourceFYId("");
                  }}
                  className="text-xs px-3 py-1.5 flex items-center gap-1 bg-transparent! border border-border"
                >
                  <Copy className="w-3 h-3" /> Copy from FY
                </button>
              )}
              <button
                onClick={() => setShowAddGroup(true)}
                className="text-xs px-3 py-1.5 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Group
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {rateGroups.map((rg) => (
              <RateGroupItem
                key={rg.id}
                rg={rg}
                fyId={selectedFY.id}
                isExpanded={expandedRG === rg.id}
                onToggle={() => {
                  setExpandedRG(expandedRG === rg.id ? null : rg.id);
                  setExpandedPG(null);
                }}
                expandedPG={expandedPG}
                setExpandedPG={setExpandedPG}
                onRefresh={loadGroups}
              />
            ))}
            {rateGroups.length === 0 && (
              <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
                <p className="mb-2">No rate groups defined yet.</p>
                {otherFYs.length > 0 ? (
                  <p className="m-0">
                    Click &quot;Copy from FY&quot; to clone an existing setup, or &quot;Add Group&quot; to start fresh.
                  </p>
                ) : (
                  <p className="m-0">
                    Click &quot;Add Group&quot; to create a rate structure grouping (e.g. &quot;Division A&quot;, &quot;Primary Rate Structure&quot;).
                  </p>
                )}
              </div>
            )}
          </div>

          <Dialog open={showAddGroup} onClose={() => setShowAddGroup(false)} title="Add Rate Group">
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs">Group Name</label>
                <input
                  className="w-full mt-1"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Division A, Primary Rate Structure"
                />
              </div>
              <button onClick={handleAddGroup} className="mt-2">Create</button>
            </div>
          </Dialog>

          <Dialog open={showCopyFY} onClose={() => setShowCopyFY(false)} title="Copy Setup from Another FY">
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground m-0">
                Clone the entire pool structure (chart of accounts, rate groups, pool groups, pools, GL mappings, and base accounts) from another fiscal year into <strong>{selectedFY.name}</strong>.
              </p>
              <div>
                <label className="text-xs">Source Fiscal Year</label>
                <select
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={sourceFYId}
                  onChange={(e) => setSourceFYId(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">Select a fiscal year...</option>
                  {otherFYs.map((fy) => (
                    <option key={fy.id} value={fy.id}>
                      {fy.name} ({fy.start_month} — {fy.end_month})
                    </option>
                  ))}
                </select>
              </div>
              {copyResult && (
                <div className={`text-xs rounded-md px-3 py-2 ${
                  copyResult.startsWith("Error")
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-green-50 text-green-700 border border-green-200"
                }`}>
                  {copyResult}
                </div>
              )}
              <button
                onClick={handleCopyFY}
                disabled={!sourceFYId || copying}
                className="mt-2 disabled:opacity-50"
              >
                {copying ? "Copying..." : "Copy Setup"}
              </button>
            </div>
          </Dialog>
        </div>
      )}
    </div>
  );
}
