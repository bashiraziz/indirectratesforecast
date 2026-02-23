"""Project Status by Time (PST) report computation.

Produces a cost-category breakdown with Selected Period, YTD, ITD,
Budget, and Variance columns.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _safe_div(num: float | pd.Series, den: float | pd.Series) -> float | pd.Series:
    if isinstance(den, pd.Series):
        return (num / den.replace(0, np.nan)).fillna(0.0)
    return (num / den) if den != 0 else 0.0


def build_pst_report(
    pools: pd.DataFrame,
    bases: pd.DataFrame,
    project_impacts: pd.DataFrame,
    budget_rates: dict[str, dict[str, float]],
    selected_period: str,
    fy_start: str,
) -> pd.DataFrame:
    """Build a Project Status by Time report.

    Args:
        pools: Period-indexed DataFrame of pool dollar amounts (cols = pool group names)
        bases: Period-indexed DataFrame of base dollar amounts (cols = DL, TCI, etc.)
        project_impacts: DataFrame with Period, Project, DirectLabor$, Subk, ODC, Travel,
                         LoadedCost$ (and indirect $ columns)
        budget_rates: {pool_group_name: {period: rate_decimal}}
        selected_period: YYYY-MM string for the "Selected Period" column
        fy_start: YYYY-MM start of fiscal year

    Returns:
        DataFrame with columns:
            Category, Selected_Period, YTD, ITD, Budget, Variance
    """
    pools = pools.copy()
    bases = bases.copy()
    impacts = project_impacts.copy()

    pools.index = pools.index.astype(str)
    bases.index = bases.index.astype(str)
    if "Period" in impacts.columns:
        impacts["Period"] = impacts["Period"].astype(str)

    all_periods = sorted(pools.index.tolist())
    ytd_periods = [p for p in all_periods if fy_start <= p <= selected_period]

    def _period_val(df: pd.DataFrame, period: str, col: str) -> float:
        if col not in df.columns or period not in df.index:
            return 0.0
        return float(df.loc[period, col])

    def _ytd_val(df: pd.DataFrame, col: str) -> float:
        if col not in df.columns:
            return 0.0
        return float(df.loc[df.index.isin(ytd_periods), col].sum())

    def _itd_val(df: pd.DataFrame, col: str) -> float:
        if col not in df.columns:
            return 0.0
        return float(df[col].sum())

    # --- Direct cost categories from project_impacts ---
    direct_cols = {
        "Direct Labor": "DirectLabor$",
        "Subcontractors": "Subk",
        "ODC": "ODC",
        "Travel": "Travel",
    }

    rows: list[dict[str, Any]] = []

    # Direct cost rows aggregated across all projects by period
    direct_by_period: dict[str, pd.Series] = {}
    if not impacts.empty and "Period" in impacts.columns:
        grp = impacts.groupby("Period")
        for col_label, col_name in direct_cols.items():
            if col_name in impacts.columns:
                s = grp[col_name].sum()
                direct_by_period[col_name] = s

    for label, col_name in direct_cols.items():
        s = direct_by_period.get(col_name, pd.Series(dtype=float))

        sel = float(s.get(selected_period, 0.0))
        ytd = float(s[s.index.isin(ytd_periods)].sum()) if not s.empty else 0.0
        itd = float(s.sum()) if not s.empty else 0.0
        # Budget for direct: not stored by pool, so use 0
        budget = 0.0
        variance = budget - ytd

        rows.append({
            "Category": label,
            "Type": "Direct",
            "Selected_Period": round(sel, 2),
            "YTD": round(ytd, 2),
            "ITD": round(itd, 2),
            "Budget": round(budget, 2),
            "Variance": round(variance, 2),
        })

    # Total Direct row
    total_direct_sel = sum(r["Selected_Period"] for r in rows if r["Type"] == "Direct")
    total_direct_ytd = sum(r["YTD"] for r in rows if r["Type"] == "Direct")
    total_direct_itd = sum(r["ITD"] for r in rows if r["Type"] == "Direct")
    rows.append({
        "Category": "Total Direct",
        "Type": "Subtotal",
        "Selected_Period": round(total_direct_sel, 2),
        "YTD": round(total_direct_ytd, 2),
        "ITD": round(total_direct_itd, 2),
        "Budget": 0.0,
        "Variance": 0.0,
    })

    # --- Indirect cost rows from pools ---
    pool_names = [c for c in pools.columns]
    for pool_name in pool_names:
        sel = _period_val(pools, selected_period, pool_name)
        ytd = _ytd_val(pools, pool_name)
        itd = _itd_val(pools, pool_name)

        # Budget: budget_rate * base for YTD periods
        budget = 0.0
        if pool_name in budget_rates:
            # Find base column for this pool — try matching by name, fall back to first
            for period in ytd_periods:
                rate_val = budget_rates[pool_name].get(period, 0.0)
                # Use first available base column
                if not bases.empty and period in bases.index:
                    base_val = float(bases.loc[period].iloc[0]) if len(bases.columns) > 0 else 0.0
                else:
                    base_val = 0.0
                budget += rate_val * base_val

        variance = budget - ytd
        rows.append({
            "Category": pool_name,
            "Type": "Indirect",
            "Selected_Period": round(sel, 2),
            "YTD": round(ytd, 2),
            "ITD": round(itd, 2),
            "Budget": round(budget, 2),
            "Variance": round(variance, 2),
        })

    total_indirect_sel = sum(r["Selected_Period"] for r in rows if r["Type"] == "Indirect")
    total_indirect_ytd = sum(r["YTD"] for r in rows if r["Type"] == "Indirect")
    total_indirect_itd = sum(r["ITD"] for r in rows if r["Type"] == "Indirect")
    total_indirect_budget = sum(r["Budget"] for r in rows if r["Type"] == "Indirect")
    rows.append({
        "Category": "Total Indirect",
        "Type": "Subtotal",
        "Selected_Period": round(total_indirect_sel, 2),
        "YTD": round(total_indirect_ytd, 2),
        "ITD": round(total_indirect_itd, 2),
        "Budget": round(total_indirect_budget, 2),
        "Variance": round(total_indirect_budget - total_indirect_ytd, 2),
    })

    # Grand Total
    rows.append({
        "Category": "Grand Total",
        "Type": "GrandTotal",
        "Selected_Period": round(total_direct_sel + total_indirect_sel, 2),
        "YTD": round(total_direct_ytd + total_indirect_ytd, 2),
        "ITD": round(total_direct_itd + total_indirect_itd, 2),
        "Budget": round(total_indirect_budget, 2),
        "Variance": round(total_indirect_budget - (total_direct_ytd + total_indirect_ytd), 2),
    })

    return pd.DataFrame(rows)
