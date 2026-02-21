"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listFiscalYears,
  listRateGroups,
  listPoolGroupsByRateGroup,
  listPoolGroups,
  listPools,
  listGLMappings,
  listBaseAccounts,
} from "@/lib/api";
import type {
  FiscalYear,
  RateGroup,
  PoolGroup,
  Pool,
  GLMapping,
  BaseAccount,
} from "@/lib/types";

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
    <div className="flex items-center gap-3">
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

interface PoolGroupDetail {
  poolGroup: PoolGroup;
  pools: Pool[];
  costAccounts: GLMapping[];
  baseAccounts: BaseAccount[];
}

function cascadeLabel(order: number): string {
  return order === 0 ? "1st" : order === 1 ? "2nd" : order === 2 ? "3rd" : `${order + 1}th`;
}

function FormulaCard({ detail }: { detail: PoolGroupDetail }) {
  const { poolGroup, costAccounts, baseAccounts } = detail;

  const costAccountNums = costAccounts.map((c) => c.account);
  const baseAccountNums = baseAccounts.map((b) => b.account);

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-sm font-semibold m-0">{poolGroup.name}</h4>
        <span className="text-[10px] bg-accent px-2 py-0.5 rounded text-muted-foreground">
          {cascadeLabel(poolGroup.cascade_order)} tier
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
        {/* Numerator */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
            Pool Costs (Numerator)
          </div>
          {costAccountNums.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {costAccountNums.map((a) => (
                <span key={a} className="font-mono text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                  {a}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No cost accounts assigned</span>
          )}
        </div>

        {/* Divider */}
        <div className="flex items-center justify-center text-lg text-muted-foreground font-light pt-4">
          /
        </div>

        {/* Denominator */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
            Base (Denominator)
          </div>
          {baseAccountNums.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {baseAccountNums.map((a) => (
                <span key={a} className="font-mono text-xs bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">
                  {a}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              Base: {poolGroup.base} (category-based)
            </span>
          )}
        </div>
      </div>

      {/* Formula display */}
      <div className="mt-3 pt-3 border-t border-border">
        <div className="font-mono text-xs bg-background/50 rounded p-2">
          <span className="text-primary font-semibold">{poolGroup.name} Rate</span>
          <span className="text-muted-foreground"> = </span>
          <span className="text-primary/80">
            {costAccountNums.length > 0
              ? `Sum(${costAccountNums.join(", ")})`
              : `${poolGroup.name} Pool $`}
          </span>
          <span className="text-muted-foreground"> / </span>
          <span className="text-blue-400/80">
            {baseAccountNums.length > 0
              ? `Sum(${baseAccountNums.join(", ")})`
              : poolGroup.base}
          </span>
        </div>
      </div>
    </div>
  );
}

function CategoryView({ details }: { details: PoolGroupDetail[] }) {
  const sorted = [...details].sort((a, b) => a.poolGroup.cascade_order - b.poolGroup.cascade_order);

  if (sorted.length === 0) {
    return (
      <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-8 text-center">
        No pool groups configured for this rate group. Set up pools in Pool Setup first.
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3 mt-0">Allocation Formulas</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Rates are applied in cascade order. Each tier includes prior tier indirect costs in its base.
      </p>
      <div className="flex flex-col gap-3">
        {sorted.map((d) => (
          <div key={d.poolGroup.id} className="border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-sm font-semibold m-0">{d.poolGroup.name}</h4>
              <span className="text-[10px] bg-accent px-2 py-0.5 rounded text-muted-foreground">
                {cascadeLabel(d.poolGroup.cascade_order)} tier
              </span>
              <span className="text-[10px] bg-accent/60 px-2 py-0.5 rounded text-muted-foreground">
                base: {d.poolGroup.base}
              </span>
            </div>
            <div className="font-mono text-xs bg-background/50 rounded p-2">
              <span className="text-primary font-semibold">{d.poolGroup.name} Rate</span>
              <span className="text-muted-foreground"> = </span>
              <span className="text-primary/80">{d.poolGroup.name} Pool $</span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-blue-400/80">
                {d.poolGroup.base === "DL" && "Direct Labor $"}
                {d.poolGroup.base === "TL" && "Total Labor $"}
                {d.poolGroup.base === "TCI" && "Total Cost Input (DL + Subk + ODC + Travel)"}
                {d.poolGroup.base === "DLH" && "Direct Labor Hours"}
                {!["DL", "TL", "TCI", "DLH"].includes(d.poolGroup.base) && d.poolGroup.base}
              </span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Pools: {d.pools.length > 0 ? d.pools.map((p) => p.name).join(", ") : "(none)"}
              {" | "}
              Cost accounts: {d.costAccounts.length}
            </div>
          </div>
        ))}
      </div>

      {/* Cascade Flow */}
      <h3 className="text-sm font-semibold mb-3 mt-6">Cascade Flow</h3>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        {sorted.map((d, i) => (
          <div key={d.poolGroup.id} className="flex items-center gap-2">
            <div className="border border-primary/30 bg-primary/5 rounded px-3 py-1.5 font-medium">
              {d.poolGroup.name}
            </div>
            {i < sorted.length - 1 && (
              <span className="text-muted-foreground">→</span>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Earlier tiers are applied first. Later tiers include prior indirect costs in their allocation base.
      </p>
    </div>
  );
}

function GLAccountView({ details }: { details: PoolGroupDetail[] }) {
  const sorted = [...details].sort((a, b) => a.poolGroup.cascade_order - b.poolGroup.cascade_order);

  if (sorted.length === 0) {
    return (
      <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-8 text-center">
        No pool groups configured for this rate group. Set up pools in Pool Setup first.
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3 mt-0">GL Account Formulas</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Rate formulas expressed in terms of specific GL accounts.
      </p>
      <div className="flex flex-col gap-3">
        {sorted.map((d) => (
          <FormulaCard key={d.poolGroup.id} detail={d} />
        ))}
      </div>

      {/* All Accounts Summary */}
      <h3 className="text-sm font-semibold mb-3 mt-6">All Assigned GL Accounts</h3>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-sidebar">
              <th className="text-left px-4 py-2 font-semibold">Account #</th>
              <th className="text-left px-4 py-2 font-semibold">Assignment</th>
              <th className="text-left px-4 py-2 font-semibold">Pool Group</th>
              <th className="text-left px-4 py-2 font-semibold">Role</th>
            </tr>
          </thead>
          <tbody>
            {sorted.flatMap((d) => [
              ...d.costAccounts.map((ca) => ({
                account: ca.account,
                poolGroup: d.poolGroup.name,
                pool: d.pools.find((p) => p.id === ca.pool_id)?.name || "",
                role: "Cost (Numerator)" as const,
              })),
              ...d.baseAccounts.map((ba) => ({
                account: ba.account,
                poolGroup: d.poolGroup.name,
                pool: "",
                role: "Base (Denominator)" as const,
              })),
            ]).sort((a, b) => a.account.localeCompare(b.account)).map((row, i) => (
              <tr key={`${row.account}-${row.poolGroup}-${i}`} className="border-b border-border last:border-b-0 hover:bg-accent/30 transition-colors">
                <td className="px-4 py-2 font-mono font-medium">{row.account}</td>
                <td className="px-4 py-2 text-xs">{row.pool || row.poolGroup}</td>
                <td className="px-4 py-2 text-xs">{row.poolGroup}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    row.role === "Cost (Numerator)"
                      ? "bg-primary/10 text-primary"
                      : "bg-blue-500/10 text-blue-400"
                  }`}>
                    {row.role}
                  </span>
                </td>
              </tr>
            ))}
            {sorted.every((d) => d.costAccounts.length === 0 && d.baseAccounts.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No GL accounts assigned to any pools yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CostStructurePage() {
  const [selectedFY, setSelectedFY] = useState<FiscalYear | null>(null);
  const [rateGroups, setRateGroups] = useState<RateGroup[]>([]);
  const [selectedRG, setSelectedRG] = useState<RateGroup | null>(null);
  const [details, setDetails] = useState<PoolGroupDetail[]>([]);
  const [tab, setTab] = useState<"category" | "gl">("category");
  const [loading, setLoading] = useState(false);

  // Load rate groups when FY changes
  const loadRateGroups = useCallback(async () => {
    if (!selectedFY) {
      setRateGroups([]);
      setSelectedRG(null);
      return;
    }
    const rgs = await listRateGroups(selectedFY.id);
    setRateGroups(rgs);
    if (rgs.length > 0) {
      setSelectedRG(rgs[0]);
    } else {
      setSelectedRG(null);
    }
  }, [selectedFY]);

  useEffect(() => {
    loadRateGroups();
  }, [loadRateGroups]);

  // Load pool group details when rate group changes
  const loadData = useCallback(async () => {
    if (!selectedFY || !selectedRG) {
      setDetails([]);
      return;
    }
    setLoading(true);
    try {
      // Load pool groups for the selected rate group only
      const poolGroups = await listPoolGroupsByRateGroup(selectedRG.id);

      const detailPromises = poolGroups.map(async (pg) => {
        const pools = await listPools(pg.id);
        const baseAccounts = await listBaseAccounts(pg.id);

        const mappingPromises = pools.map((p) => listGLMappings(p.id));
        const mappingsArrays = await Promise.all(mappingPromises);
        const costAccounts = mappingsArrays.flat();

        return {
          poolGroup: pg,
          pools,
          costAccounts,
          baseAccounts,
        } satisfies PoolGroupDetail;
      });

      const results = await Promise.all(detailPromises);
      setDetails(results);
    } finally {
      setLoading(false);
    }
  }, [selectedFY, selectedRG]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-bold mt-0 mb-1">Cost Structure</h2>
      <p className="text-muted-foreground text-sm mb-4">
        View indirect rate allocation formulas and cost structure for the selected fiscal year and rate group.
      </p>

      {/* FY + Rate Group selectors */}
      <div className="flex items-center gap-6 mb-4 flex-wrap">
        <FYSelector selected={selectedFY} onSelect={setSelectedFY} />

        {selectedFY && rateGroups.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium opacity-100!">Rate Group:</label>
            <select
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              value={selectedRG?.id ?? ""}
              onChange={(e) => {
                const rg = rateGroups.find((r) => r.id === Number(e.target.value));
                if (rg) setSelectedRG(rg);
              }}
            >
              {rateGroups.map((rg) => (
                <option key={rg.id} value={rg.id}>
                  {rg.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {selectedFY && rateGroups.length === 0 && (
        <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-8 text-center">
          No rate groups defined for this fiscal year. Create rate groups in Pool Setup first.
        </div>
      )}

      {selectedFY && selectedRG && (
        <>
          {/* Tab Switcher */}
          <div className="flex gap-1 mb-4 border border-border rounded-lg p-1 w-fit">
            <button
              onClick={() => setTab("category")}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                tab === "category"
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent! hover:bg-accent"
              }`}
            >
              By Cost Category
            </button>
            <button
              onClick={() => setTab("gl")}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                tab === "gl"
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent! hover:bg-accent"
              }`}
            >
              By GL Account
            </button>
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
          ) : tab === "category" ? (
            <CategoryView details={details} />
          ) : (
            <GLAccountView details={details} />
          )}
        </>
      )}
    </div>
  );
}
