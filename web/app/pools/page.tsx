"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
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
} from "@/lib/api";
import type { FiscalYear, RateGroup, PoolGroup, Pool, GLMapping } from "@/lib/types";

// ---------------------------------------------------------------------------
// Small dialog component (no shadcn dependency needed)
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
            className="p-1 rounded hover:bg-accent !bg-transparent !border-none"
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
      <label className="text-sm font-medium !opacity-100">Fiscal Year:</label>
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
        className="!bg-primary/80 text-xs px-3 py-1.5 flex items-center gap-1"
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
// Pool Group Accordion Item (Level 2 — inside a Rate Group)
// ---------------------------------------------------------------------------
function PoolGroupItem({
  pg,
  isExpanded,
  onToggle,
  onSelectPool,
  selectedPoolId,
  onRefresh,
}: {
  pg: PoolGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectPool: (pool: Pool) => void;
  selectedPoolId: number | null;
  onRefresh: () => void;
}) {
  const [pools, setPools] = useState<Pool[]>([]);
  const [showAddPool, setShowAddPool] = useState(false);
  const [newPoolName, setNewPoolName] = useState("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(pg.name);
  const [editBase, setEditBase] = useState(pg.base);
  const [editCascadeOrder, setEditCascadeOrder] = useState(pg.cascade_order ?? 0);

  useEffect(() => {
    if (isExpanded) {
      listPools(pg.id).then(setPools);
    }
  }, [isExpanded, pg.id]);

  async function handleAddPool() {
    if (!newPoolName.trim()) return;
    await createPool(pg.id, { name: newPoolName.trim() });
    setNewPoolName("");
    setShowAddPool(false);
    const updated = await listPools(pg.id);
    setPools(updated);
  }

  async function handleDeletePool(poolId: number) {
    await deletePool(poolId);
    const updated = await listPools(pg.id);
    setPools(updated);
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

  const BASE_OPTIONS = ["DL", "TL", "TCI", "DLH"];

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
          className="!bg-transparent !border-none p-1 hover:bg-accent rounded"
          title="Edit"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteGroup();
          }}
          className="!bg-transparent !border-none p-1 hover:bg-destructive/20 rounded text-destructive"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-border px-3 py-3 bg-background/30">
          <div className="grid grid-cols-[1fr_auto] gap-4">
            {/* Left: Pool Costs (Numerator) */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                Pool Costs (Numerator)
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {pools.map((pool) => (
                  <div
                    key={pool.id}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border cursor-pointer transition-colors ${
                      selectedPoolId === pool.id
                        ? "bg-primary/20 border-primary text-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                    onClick={() => onSelectPool(pool)}
                  >
                    {pool.name}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePool(pool.id);
                      }}
                      className="!bg-transparent !border-none p-0 hover:text-destructive"
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
                  <button onClick={() => setShowAddPool(false)} className="text-xs px-2 py-1 !bg-transparent">
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddPool(true)}
                  className="text-xs !bg-transparent !border-dashed border border-border hover:border-primary px-2 py-1 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add sub-pool
                </button>
              )}
            </div>
            {/* Right: Allocation Base (Denominator) */}
            <div className="border-l border-border pl-4 min-w-[160px]">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                Allocation Base (Denominator)
              </div>
              <div className="text-sm font-medium">{pg.base}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {pg.base === "DL" && "Direct Labor $"}
                {pg.base === "TL" && "Total Labor $ (= DL)"}
                {pg.base === "TCI" && "Total Cost Input (DL + Subk + ODC + Travel)"}
                {pg.base === "DLH" && "Direct Labor Hours"}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Cascade: {pg.cascade_order === 0 ? "1st (raw directs)" : pg.cascade_order === 1 ? "2nd (includes prior)" : "3rd (includes all prior)"}
              </div>
            </div>
          </div>
        </div>
      )}

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit Pool">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs">Name</label>
            <input className="w-full mt-1" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs">Base</label>
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
  onSelectPool,
  selectedPoolId,
  expandedPG,
  setExpandedPG,
  onRefresh,
}: {
  rg: RateGroup;
  fyId: number;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectPool: (pool: Pool) => void;
  selectedPoolId: number | null;
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
          className="!bg-transparent !border-none p-1 hover:bg-accent rounded"
          title="Edit"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteGroup();
          }}
          className="!bg-transparent !border-none p-1 hover:bg-destructive/20 rounded text-destructive"
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
                isExpanded={expandedPG === pg.id}
                onToggle={() => {
                  setExpandedPG(expandedPG === pg.id ? null : pg.id);
                  onSelectPool(null as unknown as Pool);
                }}
                onSelectPool={onSelectPool}
                selectedPoolId={selectedPoolId}
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
              <button onClick={() => setShowAddPool(false)} className="text-xs px-2 py-1 !bg-transparent">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddPool(true)}
              className="text-xs !bg-transparent !border-dashed border border-border hover:border-primary px-2 py-1 flex items-center gap-1 ml-4"
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
// GL Account Picker (right panel)
// ---------------------------------------------------------------------------
function GLAccountPicker({ pool }: { pool: Pool | null }) {
  const [mappings, setMappings] = useState<GLMapping[]>([]);
  const [newAccount, setNewAccount] = useState("");
  const [newNotes, setNewNotes] = useState("");

  useEffect(() => {
    if (pool) {
      listGLMappings(pool.id).then(setMappings);
    } else {
      setMappings([]);
    }
  }, [pool]);

  if (!pool) {
    return (
      <div className="text-muted-foreground text-sm p-4">
        Select a sub-pool to manage GL account mappings.
      </div>
    );
  }

  async function handleAdd() {
    if (!newAccount.trim() || !pool) return;
    await createGLMapping(pool.id, { account: newAccount.trim(), notes: newNotes.trim() });
    setNewAccount("");
    setNewNotes("");
    const updated = await listGLMappings(pool.id);
    setMappings(updated);
  }

  async function handleDelete(mappingId: number) {
    if (!pool) return;
    await deleteGLMapping(mappingId);
    const updated = await listGLMappings(pool.id);
    setMappings(updated);
  }

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3 mt-0">
        GL Accounts → {pool.name}
      </h3>

      {/* Existing mappings */}
      <div className="flex flex-col gap-1 mb-3">
        {mappings.length === 0 && (
          <div className="text-xs text-muted-foreground py-2">No accounts assigned yet.</div>
        )}
        {mappings.map((m) => (
          <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 border border-border rounded text-xs">
            <span className="font-mono font-medium">{m.account}</span>
            {m.notes && <span className="text-muted-foreground flex-1 truncate">{m.notes}</span>}
            {m.is_unallowable ? (
              <span className="text-destructive/80 text-[10px] bg-destructive/10 px-1.5 rounded">UNAL</span>
            ) : null}
            <button
              onClick={() => handleDelete(m.id)}
              className="!bg-transparent !border-none p-0 hover:text-destructive ml-auto"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Add new */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-xs">Account #</label>
          <input
            className="w-full mt-1 text-xs"
            value={newAccount}
            onChange={(e) => setNewAccount(e.target.value)}
            placeholder="e.g. 6000"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
        </div>
        <div className="flex-1">
          <label className="text-xs">Notes</label>
          <input
            className="w-full mt-1 text-xs"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="Description"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
        </div>
        <button onClick={handleAdd} className="text-xs px-3 py-[9px]">
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Pool Setup Page
// ---------------------------------------------------------------------------
export default function PoolSetupPage() {
  const [selectedFY, setSelectedFY] = useState<FiscalYear | null>(null);
  const [rateGroups, setRateGroups] = useState<RateGroup[]>([]);
  const [expandedRG, setExpandedRG] = useState<number | null>(null);
  const [expandedPG, setExpandedPG] = useState<number | null>(null);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const loadGroups = useCallback(async () => {
    if (!selectedFY) {
      setRateGroups([]);
      return;
    }
    const groups = await listRateGroups(selectedFY.id);
    setRateGroups(groups);
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-bold mt-0 mb-1">Pool Setup</h2>
      <p className="text-muted-foreground text-sm mb-4">
        Configure rate groups, indirect cost pools (Fringe, Overhead, G&amp;A, etc.), their sub-pools, and GL account mappings for each fiscal year.
      </p>

      <FYSelector selected={selectedFY} onSelect={setSelectedFY} />

      {selectedFY && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
          {/* Left panel: Rate Groups → Pool Groups → Pools */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold m-0">Rate Structure</h3>
              <button
                onClick={() => setShowAddGroup(true)}
                className="text-xs px-3 py-1.5 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Group
              </button>
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
                    setSelectedPool(null);
                  }}
                  onSelectPool={setSelectedPool}
                  selectedPoolId={selectedPool?.id ?? null}
                  expandedPG={expandedPG}
                  setExpandedPG={setExpandedPG}
                  onRefresh={loadGroups}
                />
              ))}
              {rateGroups.length === 0 && (
                <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
                  No rate groups defined yet. Click &quot;Add Group&quot; to create a rate structure grouping (e.g. &quot;Division A&quot;, &quot;Primary Rate Structure&quot;).
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
          </div>

          {/* Right panel: GL Account Mappings */}
          <div className="border border-border rounded-lg p-4 bg-card">
            <GLAccountPicker pool={selectedPool} />
          </div>
        </div>
      )}
    </div>
  );
}
