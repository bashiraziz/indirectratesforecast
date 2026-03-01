"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  listScenarios,
  createScenario,
  updateScenario,
  deleteScenario,
  listScenarioEvents,
  createScenarioEvent,
  updateScenarioEvent,
  deleteScenarioEvent,
  listPoolGroups,
} from "@/lib/api";
import type { FiscalYear, Scenario, ScenarioEvent, PoolGroup } from "@/lib/types";
import NextStepHint from "@/app/components/NextStepHint";
import { Dialog } from "@/app/components/Dialog";
import { FYSelector } from "@/app/components/FYSelector";

const EVENT_TYPES = ["ADJUST", "WIN", "LOSE", "HIRE", "RIF", "OTHER"];

// ---------------------------------------------------------------------------
// Format currency
// ---------------------------------------------------------------------------
function fmtDelta(v: number): string {
  if (v === 0) return "-";
  const sign = v > 0 ? "+" : "";
  return `${sign}$${v.toLocaleString()}`;
}

// ---------------------------------------------------------------------------
// Event Form (create / edit)
// ---------------------------------------------------------------------------
function EventForm({
  initial,
  poolGroups,
  onSave,
  onCancel,
}: {
  initial?: ScenarioEvent;
  poolGroups: PoolGroup[];
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [period, setPeriod] = useState(initial?.effective_period ?? "");
  const [type, setType] = useState(initial?.event_type ?? "ADJUST");
  const [project, setProject] = useState(initial?.project ?? "");
  const [dl, setDl] = useState(initial?.delta_direct_labor ?? 0);
  const [dlh, setDlh] = useState(initial?.delta_direct_labor_hrs ?? 0);
  const [subk, setSubk] = useState(initial?.delta_subk ?? 0);
  const [odc, setOdc] = useState(initial?.delta_odc ?? 0);
  const [travel, setTravel] = useState(initial?.delta_travel ?? 0);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [poolDeltas, setPoolDeltas] = useState<Record<string, number>>(
    initial?.pool_deltas ?? Object.fromEntries(poolGroups.map((pg) => [pg.name, 0]))
  );
  const [saving, setSaving] = useState(false);

  function setPoolDelta(name: string, val: number) {
    setPoolDeltas((prev) => ({ ...prev, [name]: val }));
  }

  async function handleSubmit() {
    if (!period) return;
    setSaving(true);
    try {
      await onSave({
        effective_period: period,
        event_type: type,
        project,
        delta_direct_labor: dl,
        delta_direct_labor_hrs: dlh,
        delta_subk: subk,
        delta_odc: odc,
        delta_travel: travel,
        pool_deltas: poolDeltas,
        notes,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs">Effective Period</label>
          <input
            className="w-full mt-1"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="YYYY-MM"
          />
        </div>
        <div>
          <label className="text-xs">Type</label>
          <select
            className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs">Project (optional)</label>
        <input className="w-full mt-1" value={project} onChange={(e) => setProject(e.target.value)} placeholder="e.g. PROJ-ALPHA" />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Direct Cost Deltas</div>
        <div className="grid grid-cols-5 gap-2">
          <div>
            <label className="text-[10px]">DL$</label>
            <input className="w-full mt-0.5 text-xs" type="number" value={dl} onChange={(e) => setDl(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-[10px]">DL Hrs</label>
            <input className="w-full mt-0.5 text-xs" type="number" value={dlh} onChange={(e) => setDlh(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-[10px]">Subk</label>
            <input className="w-full mt-0.5 text-xs" type="number" value={subk} onChange={(e) => setSubk(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-[10px]">ODC</label>
            <input className="w-full mt-0.5 text-xs" type="number" value={odc} onChange={(e) => setOdc(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-[10px]">Travel</label>
            <input className="w-full mt-0.5 text-xs" type="number" value={travel} onChange={(e) => setTravel(Number(e.target.value))} />
          </div>
        </div>
      </div>

      {poolGroups.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Pool Deltas</div>
          <div className="grid grid-cols-3 gap-2">
            {poolGroups.map((pg) => (
              <div key={pg.id}>
                <label className="text-[10px]">{pg.name}</label>
                <input
                  className="w-full mt-0.5 text-xs"
                  type="number"
                  value={poolDeltas[pg.name] ?? 0}
                  onChange={(e) => setPoolDelta(pg.name, Number(e.target.value))}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs">Notes</label>
        <input className="w-full mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex items-center gap-2 mt-1">
        <button onClick={handleSubmit} disabled={saving || !period} className="text-xs px-4 py-1.5 disabled:opacity-50">
          {saving ? "Saving..." : initial ? "Update" : "Add Event"}
        </button>
        <button onClick={onCancel} className="text-xs px-4 py-1.5 bg-transparent! border border-border">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Scenarios Page
// ---------------------------------------------------------------------------
export default function ScenariosPage() {
  const [selectedFY, setSelectedFY] = useState<FiscalYear | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [events, setEvents] = useState<ScenarioEvent[]>([]);
  const [poolGroups, setPoolGroups] = useState<PoolGroup[]>([]);

  // Create scenario dialog
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // Edit scenario dialog
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Event dialogs
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ScenarioEvent | null>(null);

  const loadScenarios = useCallback(async () => {
    if (!selectedFY) {
      setScenarios([]);
      setSelectedScenario(null);
      return;
    }
    const [scns, pgs] = await Promise.all([
      listScenarios(selectedFY.id),
      listPoolGroups(selectedFY.id),
    ]);
    setScenarios(scns);
    setPoolGroups(pgs);
    // Keep selected if still valid
    if (selectedScenario) {
      const still = scns.find((s) => s.id === selectedScenario.id);
      if (!still) setSelectedScenario(null);
    }
  }, [selectedFY, selectedScenario]);

  useEffect(() => { loadScenarios(); }, [loadScenarios]);

  const loadEvents = useCallback(async () => {
    if (!selectedScenario) {
      setEvents([]);
      return;
    }
    const evts = await listScenarioEvents(selectedScenario.id);
    setEvents(evts);
  }, [selectedScenario]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  async function handleCreateScenario() {
    if (!newName.trim() || !selectedFY) return;
    const result = await createScenario(selectedFY.id, { name: newName.trim(), description: newDesc.trim() });
    setShowCreate(false);
    setNewName("");
    setNewDesc("");
    await loadScenarios();
    setSelectedScenario({ ...result, event_count: 0 } as Scenario);
  }

  async function handleUpdateScenario() {
    if (!editingScenario) return;
    await updateScenario(editingScenario.id, { name: editName, description: editDesc });
    setEditingScenario(null);
    await loadScenarios();
  }

  async function handleDeleteScenario(id: number) {
    await deleteScenario(id);
    if (selectedScenario?.id === id) setSelectedScenario(null);
    await loadScenarios();
  }

  async function handleCreateEvent(data: Record<string, unknown>) {
    if (!selectedScenario) return;
    await createScenarioEvent(selectedScenario.id, data as Parameters<typeof createScenarioEvent>[1]);
    setShowAddEvent(false);
    await loadEvents();
    await loadScenarios();
  }

  async function handleUpdateEvent(data: Record<string, unknown>) {
    if (!editingEvent) return;
    await updateScenarioEvent(editingEvent.id, data);
    setEditingEvent(null);
    await loadEvents();
  }

  async function handleDeleteEvent(id: number) {
    await deleteScenarioEvent(id);
    await loadEvents();
    await loadScenarios();
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-bold mt-0 mb-1">Scenarios</h2>
      <p className="text-muted-foreground text-sm mb-4">
        Define scenario events (Win, Lose, Hire, etc.) that apply cost deltas to the forecast. Each scenario can have multiple events with effective periods.
      </p>
      <NextStepHint
        items={[
          { label: "Compare scenario rates", href: "/rates", detail: "Inspect differences by scenario before forecasting." },
          { label: "Run forecast pack", href: "/forecast", detail: "Generate outputs for one or all scenarios." },
        ]}
      />

      <FYSelector selected={selectedFY} onSelect={setSelectedFY} />

      {selectedFY && (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          {/* Left panel: scenario list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold m-0">Scenarios</h3>
              <button
                onClick={() => setShowCreate(true)}
                className="text-xs px-3 py-1.5 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              {scenarios.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                    selectedScenario?.id === s.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent/50"
                  }`}
                  onClick={() => setSelectedScenario(s)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{s.name}</div>
                    {s.description && (
                      <div className="text-[11px] text-muted-foreground truncate">{s.description}</div>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground bg-accent px-1.5 py-0.5 rounded shrink-0">
                    {s.event_count} {s.event_count === 1 ? "event" : "events"}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingScenario(s);
                      setEditName(s.name);
                      setEditDesc(s.description);
                    }}
                    className="bg-transparent! border-none! p-1 hover:bg-accent rounded shrink-0"
                    title="Edit"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteScenario(s.id);
                    }}
                    className="bg-transparent! border-none! p-1 hover:bg-destructive/20 rounded text-destructive shrink-0"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {scenarios.length === 0 && (
                <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-4 text-center">
                  No scenarios yet. Click &quot;Add&quot; to create one.
                </div>
              )}
            </div>
          </div>

          {/* Right panel: events table */}
          <div>
            {selectedScenario ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold m-0">
                    Events for &ldquo;{selectedScenario.name}&rdquo;
                  </h3>
                  <button
                    onClick={() => setShowAddEvent(true)}
                    className="text-xs px-3 py-1.5 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Event
                  </button>
                </div>

                {events.length === 0 ? (
                  <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
                    No events in this scenario. Click &quot;Add Event&quot; to create one.
                  </div>
                ) : (
                  <div className="border border-border rounded-lg overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-sidebar border-b border-border">
                          <th className="text-left px-3 py-2 font-medium">Period</th>
                          <th className="text-left px-3 py-2 font-medium">Type</th>
                          <th className="text-left px-3 py-2 font-medium">Project</th>
                          <th className="text-right px-3 py-2 font-medium">DL$</th>
                          <th className="text-right px-3 py-2 font-medium">DL Hrs</th>
                          <th className="text-right px-3 py-2 font-medium">Subk</th>
                          <th className="text-right px-3 py-2 font-medium">ODC</th>
                          <th className="text-right px-3 py-2 font-medium">Travel</th>
                          <th className="text-left px-3 py-2 font-medium">Pool Deltas</th>
                          <th className="text-left px-3 py-2 font-medium">Notes</th>
                          <th className="px-3 py-2 w-16"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((evt) => (
                          <tr key={evt.id} className="border-b border-border last:border-b-0 hover:bg-accent/30">
                            <td className="px-3 py-2 font-mono">{evt.effective_period}</td>
                            <td className="px-3 py-2">
                              <span className="bg-accent px-1.5 py-0.5 rounded text-[10px]">{evt.event_type}</span>
                            </td>
                            <td className="px-3 py-2">{evt.project || "-"}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmtDelta(evt.delta_direct_labor)}</td>
                            <td className="px-3 py-2 text-right font-mono">{evt.delta_direct_labor_hrs !== 0 ? (evt.delta_direct_labor_hrs > 0 ? "+" : "") + evt.delta_direct_labor_hrs : "-"}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmtDelta(evt.delta_subk)}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmtDelta(evt.delta_odc)}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmtDelta(evt.delta_travel)}</td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(evt.pool_deltas || {})
                                  .filter(([, v]) => v !== 0)
                                  .map(([pool, val]) => (
                                    <span
                                      key={pool}
                                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                                        val > 0 ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                                      }`}
                                    >
                                      {pool}: {fmtDelta(val)}
                                    </span>
                                  ))}
                                {(!evt.pool_deltas || Object.values(evt.pool_deltas).every((v) => v === 0)) && (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">{evt.notes || "-"}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setEditingEvent(evt)}
                                  className="bg-transparent! border-none! p-1 hover:bg-accent rounded"
                                  title="Edit"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => handleDeleteEvent(evt.id)}
                                  className="bg-transparent! border-none! p-1 hover:bg-destructive/20 rounded text-destructive"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-8 text-center">
                Select a scenario from the left to view and manage its events.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Scenario Dialog */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title="Create Scenario" size="lg" scrollable>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs">Name</label>
            <input
              className="w-full mt-1"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Win, Lose, Hiring Surge"
            />
          </div>
          <div>
            <label className="text-xs">Description</label>
            <input
              className="w-full mt-1"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Brief description of this scenario"
            />
          </div>
          <button onClick={handleCreateScenario} disabled={!newName.trim()} className="mt-2 disabled:opacity-50">
            Create
          </button>
        </div>
      </Dialog>

      {/* Edit Scenario Dialog */}
      <Dialog open={!!editingScenario} onClose={() => setEditingScenario(null)} title="Edit Scenario" size="lg" scrollable>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs">Name</label>
            <input className="w-full mt-1" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs">Description</label>
            <input className="w-full mt-1" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
          </div>
          <button onClick={handleUpdateScenario} className="mt-2">Save</button>
        </div>
      </Dialog>

      {/* Add Event Dialog */}
      <Dialog open={showAddEvent} onClose={() => setShowAddEvent(false)} title="Add Scenario Event" size="lg" scrollable>
        <EventForm
          poolGroups={poolGroups}
          onSave={handleCreateEvent}
          onCancel={() => setShowAddEvent(false)}
        />
      </Dialog>

      {/* Edit Event Dialog */}
      <Dialog open={!!editingEvent} onClose={() => setEditingEvent(null)} title="Edit Scenario Event" size="lg" scrollable>
        {editingEvent && (
          <EventForm
            initial={editingEvent}
            poolGroups={poolGroups}
            onSave={handleUpdateEvent}
            onCancel={() => setEditingEvent(null)}
          />
        )}
      </Dialog>
    </div>
  );
}
