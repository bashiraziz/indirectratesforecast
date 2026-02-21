"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
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
} from "@/lib/api";
import type { FiscalYear, RateGroup, PoolGroup, Pool, GLMapping, ChartAccount, BaseAccount } from "@/lib/types";

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
}: {
  title: string;
  available: ChartAccount[];
  assigned: { id: number; account: string; name?: string }[];
  onAssign: (accounts: ChartAccount[]) => Promise<void>;
  onUnassign: (ids: number[]) => Promise<void>;
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
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
        {title}
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
}: {
  pg: PoolGroup;
  fyId: number;
  isExpanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}) {
  const [pools, setPools] = useState<Pool[]>([]);
  const [costMappings, setCostMappings] = useState<GLMapping[]>([]);
  const [baseAccts, setBaseAccts] = useState<BaseAccount[]>([]);
  const [availableCost, setAvailableCost] = useState<ChartAccount[]>([]);
  const [availableBase, setAvailableBase] = useState<ChartAccount[]>([]);
  const [showAddPool, setShowAddPool] = useState(false);
  const [newPoolName, setNewPoolName] = useState("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(pg.name);
  const [editBase, setEditBase] = useState(pg.base);
  const [editCascadeOrder, setEditCascadeOrder] = useState(pg.cascade_order ?? 0);

  const loadDetails = useCallback(async () => {
    if (!isExpanded) return;

    const [poolsList, baseList, costAvail, baseAvail] = await Promise.all([
      listPools(pg.id),
      listBaseAccounts(pg.id),
      getAvailableCostAccounts(fyId),
      getAvailableBaseAccounts(fyId),
    ]);

    setPools(poolsList);
    setBaseAccts(baseList);
    setAvailableCost(costAvail);
    setAvailableBase(baseAvail);

    // Load cost mappings from all pools
    const mappingPromises = poolsList.map((p) => listGLMappings(p.id));
    const mappingsArrays = await Promise.all(mappingPromises);
    setCostMappings(mappingsArrays.flat());
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

  // Cost account shuttle handlers
  async function handleAssignCost(accounts: ChartAccount[]) {
    // Assign to the first pool (or create a default one if none exist)
    let targetPoolId: number;
    if (pools.length === 0) {
      const result = await createPool(pg.id, { name: pg.name });
      targetPoolId = result.id;
    } else {
      targetPoolId = pools[0].id;
    }
    for (const acct of accounts) {
      await createGLMapping(targetPoolId, { account: acct.account });
    }
    await loadDetails();
  }

  async function handleUnassignCost(ids: number[]) {
    for (const id of ids) {
      await deleteGLMapping(id);
    }
    await loadDetails();
  }

  // Base account shuttle handlers
  async function handleAssignBase(accounts: ChartAccount[]) {
    for (const acct of accounts) {
      await createBaseAccount(pg.id, { account: acct.account });
    }
    await loadDetails();
  }

  async function handleUnassignBase(ids: number[]) {
    for (const id of ids) {
      await deleteBaseAccount(id);
    }
    await loadDetails();
  }

  const BASE_OPTIONS = ["DL", "TL", "TCI", "DLH"];

  // Build assigned cost accounts with names from available data
  const assignedCostItems = costMappings.map((m) => ({
    id: m.id,
    account: m.account,
    name: "",
  }));

  const assignedBaseItems = baseAccts.map((b) => ({
    id: b.id,
    account: b.account,
    name: "",
  }));

  return (
    <div className="border border-border rounded-lg overflow-hidden ml-4">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={onToggle}
      >
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
        <span className="font-medium text-sm flex-1">{pg.name}</span>
        <span className="text-xs text-muted-foreground bg-accent px-2 py-0.5 rounded">
          base: {pg.base}
        </span>
        <span className="text-xs text-muted-foreground bg-accent/60 px-2 py-0.5 rounded">
          {pg.cascade_order === 0 ? "1st" : pg.cascade_order === 1 ? "2nd" : "3rd"}
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
              assigned={assignedCostItems}
              onAssign={handleAssignCost}
              onUnassign={handleUnassignCost}
            />
            <AccountShuttle
              title="Base Accounts (Denominator)"
              available={availableBase}
              assigned={assignedBaseItems}
              onAssign={handleAssignBase}
              onUnassign={handleUnassignBase}
            />
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
              <option value={0}>0 — 1st (uses raw direct costs)</option>
              <option value={1}>1 — 2nd (includes 1st-tier indirect)</option>
              <option value={2}>2 — 3rd (includes all prior indirect)</option>
            </select>
          </div>
          <button onClick={handleUpdateGroup} className="mt-2">Save</button>
        </div>
      </Dialog>
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
                    ? "bg-destructive/10 text-destructive border border-destructive/30"
                    : "bg-green-500/10 text-green-400 border border-green-500/30"
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
