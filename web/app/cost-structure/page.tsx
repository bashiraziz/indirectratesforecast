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
import NextStepHint from "@/app/components/NextStepHint";

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

// ---------------------------------------------------------------------------
// Cost Build-Up Calculator
// ---------------------------------------------------------------------------

const CALC_DEFAULTS = {
  directLabor: 10000,
  dlHours: 150,
  subcontract: 25000,
  odc: 5000,
  travel: 2500,
  fringeRate: 32,
  overheadRate: 55,
  gaRate: 18,
};

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function pct(n: number) {
  return n.toFixed(2) + "%";
}

function CascadeRow({
  label,
  value,
  indent = 0,
  color,
  separator,
  dimmed,
  bold,
}: {
  label: string;
  value: number;
  indent?: number;
  color?: string;
  separator?: boolean;
  dimmed?: boolean;
  bold?: boolean;
}) {
  const textClass = `${color ?? (dimmed ? "text-muted-foreground" : "text-foreground")} ${bold ? "font-semibold" : ""}`;
  return (
    <div className={`flex justify-between items-baseline gap-4 ${separator ? "border-t border-border pt-1.5 mt-1" : ""}`}>
      <span className={`text-xs ${textClass}`} style={{ paddingLeft: indent * 16 }}>
        {label}
      </span>
      <span className={`text-xs font-mono tabular-nums shrink-0 ${textClass}`}>
        {fmt(value)}
      </span>
    </div>
  );
}

function CostBuildUpCalculator() {
  const [vals, setVals] = useState({ ...CALC_DEFAULTS });

  const set = (k: keyof typeof CALC_DEFAULTS) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setVals((prev) => ({ ...prev, [k]: parseFloat(e.target.value) || 0 }));
  };

  // DCAA cascade
  const fringe    = vals.directLabor * (vals.fringeRate / 100);
  const ohBase    = vals.directLabor + fringe;
  const overhead  = ohBase * (vals.overheadRate / 100);
  const tci       = vals.directLabor + vals.subcontract + vals.odc + vals.travel + overhead;
  const ga        = tci * (vals.gaRate / 100);
  const totalDirect   = vals.directLabor + vals.subcontract + vals.odc + vals.travel;
  const totalIndirect = fringe + overhead + ga;
  const totalLoaded   = totalDirect + totalIndirect;
  const indirectPct   = totalDirect > 0 ? (totalIndirect / totalDirect) * 100 : 0;

  const inputCls = "w-28 text-right text-xs border border-input rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold m-0">Cost Build-Up Calculator</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            The Pool is the content (what you spend). The Structure is the math (how you apply it to contracts).
            Edit any field — the cascade recalculates instantly.
          </p>
          {/* Formula legend */}
          <div className="grid grid-cols-3 gap-3 mt-3 text-[11px]">
            <div>
              <span className="text-orange-400 font-semibold">Fringe</span>
              <span className="text-muted-foreground"> = Fringe Rate × Direct Labor</span>
            </div>
            <div>
              <span className="text-blue-400 font-semibold">Overhead</span>
              <span className="text-muted-foreground"> = OH Rate × (DL + Fringe)</span>
            </div>
            <div>
              <span className="text-green-400 font-semibold">G&A</span>
              <span className="text-muted-foreground"> = G&A Rate × TCI</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setVals({ ...CALC_DEFAULTS })}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors bg-transparent! border-none! px-2 py-1 rounded hover:bg-accent shrink-0"
        >
          ↺ Reset
        </button>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 gap-4 mt-4 mb-5">
        {/* Direct costs */}
        <div className="border border-border rounded-lg p-4">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">
            Direct Costs — Project Input
          </div>
          <div className="flex flex-col gap-2.5">
            {([
              { label: "Direct Labor $",   key: "directLabor",  prefix: "$" },
              { label: "DL Hours",         key: "dlHours",      prefix: ""  },
              { label: "Subcontract $",    key: "subcontract",  prefix: "$" },
              { label: "ODC $",            key: "odc",          prefix: "$" },
              { label: "Travel $",         key: "travel",       prefix: "$" },
            ] as const).map(({ label, key, prefix }) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <label className="text-xs text-muted-foreground">{label}</label>
                <div className="flex items-center gap-1">
                  {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
                  <input type="number" min="0" value={vals[key]} onChange={set(key)} className={inputCls} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Rates + summary */}
        <div className="border border-border rounded-lg p-4 flex flex-col">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">
            Indirect Rates
          </div>
          <div className="flex flex-col gap-2.5">
            {([
              { label: "Fringe Rate",   key: "fringeRate",   tier: "1st tier · base: DL",          color: "text-orange-400" },
              { label: "Overhead Rate", key: "overheadRate", tier: "2nd tier · base: DL + Fringe",  color: "text-blue-400"   },
              { label: "G&A Rate",      key: "gaRate",       tier: "3rd tier · base: TCI",          color: "text-green-400"  },
            ] as const).map(({ label, key, tier, color }) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <div className={`text-[10px] ${color}`}>{tier}</div>
                </div>
                <div className="flex items-center gap-1">
                  <input type="number" min="0" max="999" step="0.01" value={vals[key]} onChange={set(key)}
                    className="w-20 text-right text-xs border border-input rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="mt-auto pt-4 border-t border-border">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Summary</div>
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Direct Costs</span>
                <span className="font-mono">{fmt(totalDirect)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Indirect Costs</span>
                <span className="font-mono">{fmt(totalIndirect)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1">
                <span>Total Loaded Cost</span>
                <span className="font-mono text-primary">{fmt(totalLoaded)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Indirect burden on Direct</span>
                <span className="font-mono">{pct(indirectPct)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cascade waterfall */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="bg-sidebar px-4 py-2 border-b border-border flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Build-Up Cascade — DCAA Correct Order
          </span>
          <span className="text-[10px] text-muted-foreground">Pool Rate × Base = Allocation</span>
        </div>
        <div className="p-4 space-y-1">
          <CascadeRow label="Direct Labor" value={vals.directLabor} />
          <CascadeRow
            label={`+ Fringe  (${pct(vals.fringeRate)} × DL ${fmt(vals.directLabor)})`}
            value={fringe} indent={1} color="text-orange-400"
          />
          <CascadeRow label="= Overhead Base  (DL + Fringe)" value={ohBase} separator dimmed />
          <CascadeRow
            label={`+ Overhead  (${pct(vals.overheadRate)} × overhead base ${fmt(ohBase)})`}
            value={overhead} indent={1} color="text-blue-400"
          />
          <CascadeRow label="+ Subcontract" value={vals.subcontract} indent={1} />
          <CascadeRow label="+ ODC" value={vals.odc} indent={1} />
          <CascadeRow label="+ Travel" value={vals.travel} indent={1} />
          <CascadeRow label="= Total Cost Input (TCI)" value={tci} separator dimmed />
          <CascadeRow
            label={`+ G&A  (${pct(vals.gaRate)} × TCI ${fmt(tci)})`}
            value={ga} indent={1} color="text-green-400"
          />
          <CascadeRow label="= Total Loaded Cost" value={totalLoaded} separator bold color="text-primary" />
        </div>
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
      <NextStepHint
        items={[
          { label: "Adjust pool setup", href: "/pools", detail: "Update pool/base assignments if formulas look off." },
          { label: "Validate with rates", href: "/rates", detail: "Compute rates and confirm expected trends." },
        ]}
      />

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

      <CostBuildUpCalculator />
    </div>
  );
}
