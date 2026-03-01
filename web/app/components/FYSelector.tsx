"use client";

import { useCallback, useEffect, useState } from "react";
import { listFiscalYears } from "@/lib/api";
import type { FiscalYear } from "@/lib/types";

export function FYSelector({
  selected,
  onSelect,
  children,
  refreshKey,
}: {
  selected: FiscalYear | null;
  onSelect: (fy: FiscalYear) => void;
  children?: React.ReactNode;
  refreshKey?: number;
}) {
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);

  const load = useCallback(async () => {
    const fys = await listFiscalYears();
    setFiscalYears(fys);
    if (fys.length > 0 && !selected) onSelect(fys[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, onSelect, refreshKey]);

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
      {children}
    </div>
  );
}
