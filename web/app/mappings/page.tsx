"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
} from "lucide-react";
import {
  listFiscalYears,
  listCostCategories,
  createCostCategory,
  updateCostCategory,
  deleteCostCategory,
} from "@/lib/api";
import type { FiscalYear, CostCategory } from "@/lib/types";
import NextStepHint from "@/app/components/NextStepHint";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_TYPES = ["Labor", "ODC", "Subk", "Travel", "Other"] as const;
type CategoryType = (typeof CATEGORY_TYPES)[number];

// ---------------------------------------------------------------------------
// Dialog
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
// FY Selector (shared pattern)
// ---------------------------------------------------------------------------

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
    if (fys.length > 0 && !selected) onSelect(fys[0]);
  }, [selected, onSelect]);

  useEffect(() => { load(); }, [load]);

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

// ---------------------------------------------------------------------------
// Category Row — inline editable
// ---------------------------------------------------------------------------

function CategoryRow({
  cat,
  onUpdated,
  onDeleted,
}: {
  cat: CostCategory;
  onUpdated: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(cat.category_name);
  const [editGL, setEditGL] = useState(cat.gl_account);
  const [editDirect, setEditDirect] = useState(!!cat.is_direct);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateCostCategory(cat.id, {
        category_name: editName,
        gl_account: editGL,
        is_direct: editDirect,
      });
      setEditing(false);
      onUpdated();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await deleteCostCategory(cat.id);
    onDeleted();
  }

  if (editing) {
    return (
      <tr className="border-b border-border/50">
        <td className="px-3 py-2">
          <input
            className="w-full text-xs px-2 py-1"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
        </td>
        <td className="px-3 py-2">
          <input
            className="w-full text-xs px-2 py-1 font-mono"
            value={editGL}
            onChange={(e) => setEditGL(e.target.value)}
            placeholder="e.g. 5000"
          />
        </td>
        <td className="px-3 py-2 text-center">
          <input
            type="checkbox"
            checked={editDirect}
            onChange={(e) => setEditDirect(e.target.checked)}
            className="w-4 h-4"
          />
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1 justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-transparent! border-none! p-1 hover:bg-accent rounded text-green-400"
              title="Save"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setEditName(cat.category_name);
                setEditGL(cat.gl_account);
                setEditDirect(!!cat.is_direct);
              }}
              className="bg-transparent! border-none! p-1 hover:bg-accent rounded"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border/50 hover:bg-accent/30 transition-colors">
      <td className="px-3 py-2 text-sm">{cat.category_name}</td>
      <td className="px-3 py-2 text-sm font-mono text-muted-foreground">
        {cat.gl_account || "—"}
      </td>
      <td className="px-3 py-2 text-center">
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            cat.is_direct
              ? "bg-green-500/15 text-green-400"
              : "bg-primary/15 text-primary"
          }`}
        >
          {cat.is_direct ? "Direct" : "Indirect"}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={() => setEditing(true)}
            className="bg-transparent! border-none! p-1 hover:bg-accent rounded"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDelete}
            className="bg-transparent! border-none! p-1 hover:bg-destructive/20 rounded text-destructive"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Category Type Tab Content
// ---------------------------------------------------------------------------

function CategoryTab({
  fyId,
  categoryType,
  categories,
  onRefresh,
}: {
  fyId: number;
  categoryType: CategoryType;
  categories: CostCategory[];
  onRefresh: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGL, setNewGL] = useState("");
  const [newDirect, setNewDirect] = useState(true);
  const [adding, setAdding] = useState(false);

  const filtered = categories.filter((c) => c.category_type === categoryType);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await createCostCategory(fyId, {
        category_type: categoryType,
        category_name: newName.trim(),
        gl_account: newGL.trim(),
        is_direct: newDirect,
      });
      setNewName("");
      setNewGL("");
      setNewDirect(true);
      setShowAdd(false);
      onRefresh();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">{filtered.length} categories</span>
        <button
          onClick={() => setShowAdd(true)}
          className="text-xs px-3 py-1.5 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add {categoryType}
        </button>
      </div>

      {filtered.length > 0 ? (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-accent/30">
                <th className="text-left px-3 py-2 font-medium">Category Name</th>
                <th className="text-left px-3 py-2 font-medium">GL Account</th>
                <th className="text-center px-3 py-2 font-medium">Type</th>
                <th className="text-right px-3 py-2 font-medium w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cat) => (
                <CategoryRow
                  key={cat.id}
                  cat={cat}
                  onUpdated={onRefresh}
                  onDeleted={onRefresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
          No {categoryType.toLowerCase()} categories defined yet.
        </div>
      )}

      <Dialog open={showAdd} onClose={() => setShowAdd(false)} title={`Add ${categoryType} Category`}>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs">Category Name</label>
            <input
              className="w-full mt-1"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={categoryType === "Labor" ? "e.g. Direct Engineer" : `e.g. ${categoryType} item`}
            />
          </div>
          <div>
            <label className="text-xs">GL Account (optional)</label>
            <input
              className="w-full mt-1 font-mono"
              value={newGL}
              onChange={(e) => setNewGL(e.target.value)}
              placeholder="e.g. 5100"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isDirect"
              checked={newDirect}
              onChange={(e) => setNewDirect(e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="isDirect" className="text-sm opacity-100!">Direct Cost</label>
          </div>
          <button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            className="mt-2 flex items-center justify-center gap-2"
          >
            {adding && <Loader2 className="w-4 h-4 animate-spin" />}
            Create
          </button>
        </div>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Mappings Page
// ---------------------------------------------------------------------------

export default function MappingsPage() {
  const [selectedFY, setSelectedFY] = useState<FiscalYear | null>(null);
  const [activeTab, setActiveTab] = useState<CategoryType>("Labor");
  const [categories, setCategories] = useState<CostCategory[]>([]);

  const loadCategories = useCallback(async () => {
    if (!selectedFY) {
      setCategories([]);
      return;
    }
    const cats = await listCostCategories(selectedFY.id);
    setCategories(cats);
  }, [selectedFY]);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  // Count badges per tab
  const countFor = (type: CategoryType) =>
    categories.filter((c) => c.category_type === type).length;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-bold mt-0 mb-1">Cost Category Mappings</h2>
      <p className="text-muted-foreground text-sm mb-4">
        Define cost categories for Labor, ODC, Subcontractor, Travel, and other cost types.
        Map GL accounts and mark each as direct or indirect.
      </p>
      <NextStepHint
        items={[
          { label: "Review pool account assignments", href: "/pools", detail: "Confirm mapped accounts appear in correct pools." },
          { label: "Run rates comparison", href: "/rates", detail: "Check actual vs budget/provisional outputs." },
        ]}
      />

      <FYSelector selected={selectedFY} onSelect={setSelectedFY} />

      {selectedFY && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 mb-4 border-b border-border pb-0">
            {CATEGORY_TYPES.map((type) => {
              const count = countFor(type);
              const active = activeTab === type;
              return (
                <button
                  key={type}
                  onClick={() => setActiveTab(type)}
                  className={`text-sm px-4 py-2 rounded-t-md border-b-0! transition-colors ${
                    active
                      ? "bg-accent! text-foreground font-medium border border-border"
                      : "bg-transparent! text-muted-foreground hover:text-foreground border-transparent!"
                  }`}
                >
                  {type}
                  {count > 0 && (
                    <span className="ml-2 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <CategoryTab
            fyId={selectedFY.id}
            categoryType={activeTab}
            categories={categories}
            onRefresh={loadCategories}
          />
        </>
      )}
    </div>
  );
}
