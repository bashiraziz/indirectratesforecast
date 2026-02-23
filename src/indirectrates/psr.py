"""Project Status Report computation.

Combines forecast project impacts with revenue data to produce
per-project profitability analysis with indirect cost allocation.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _safe_div(num: pd.Series, den: pd.Series) -> pd.Series:
    den = den.replace(0, np.nan)
    return (num / den).fillna(0.0)


def build_psr(
    project_impacts: pd.DataFrame,
    revenue_data: list[dict[str, Any]],
    fy_start: str | None = None,
    fy_end: str | None = None,
    allowed_projects: list[str] | None = None,
) -> pd.DataFrame:
    """Build a Project Status Report from forecast impacts and revenue.

    Args:
        project_impacts: DataFrame with columns:
            Period, Project, DirectLabor$, Subk, ODC, Travel,
            <rate>$ columns (indirect dollars), LoadedCost$
        revenue_data: list of dicts with keys: period, project, revenue
        fy_start: Optional FY start period (YYYY-MM) to scope results
        fy_end: Optional FY end period (YYYY-MM) to scope results
        allowed_projects: Optional list of projects to include (filters out
            run-rate projections for projects not active in this FY)

    Returns:
        DataFrame with columns:
            Period, Project, DirectCost, IndirectCost, TotalCost,
            Revenue, Fee, Margin%
    """
    impacts = project_impacts.copy()

    # Ensure Period is string for merging
    impacts["Period"] = impacts["Period"].astype(str)

    # Scope to FY date range if provided
    if fy_start and fy_end:
        impacts = impacts[(impacts["Period"] >= fy_start) & (impacts["Period"] <= fy_end)]

    # Filter to allowed projects (e.g. only those with actuals in this FY)
    if allowed_projects is not None:
        impacts = impacts[impacts["Project"].isin(allowed_projects)]

    # Build revenue DataFrame
    if revenue_data:
        rev_df = pd.DataFrame(revenue_data)
        rev_df = rev_df.rename(columns={"period": "Period", "project": "Project", "revenue": "Revenue"})
        rev_df["Revenue"] = pd.to_numeric(rev_df["Revenue"], errors="coerce").fillna(0.0)
    else:
        rev_df = pd.DataFrame(columns=["Period", "Project", "Revenue"])

    # Aggregate impacts by period+project
    direct_cols = ["DirectLabor$", "Subk", "ODC", "Travel"]
    for col in direct_cols:
        if col not in impacts.columns:
            impacts[col] = 0.0

    impacts["DirectCost"] = impacts[direct_cols].sum(axis=1)

    if "LoadedCost$" in impacts.columns:
        impacts["TotalCost"] = impacts["LoadedCost$"]
    else:
        impacts["TotalCost"] = impacts["DirectCost"]

    impacts["IndirectCost"] = impacts["TotalCost"] - impacts["DirectCost"]

    # Merge revenue
    psr = impacts[["Period", "Project", "DirectCost", "IndirectCost", "TotalCost"]].copy()

    if len(rev_df) > 0:
        psr = psr.merge(rev_df[["Period", "Project", "Revenue"]], on=["Period", "Project"], how="left")
    else:
        psr["Revenue"] = 0.0

    psr["Revenue"] = psr["Revenue"].fillna(0.0)
    psr["Fee"] = psr["Revenue"] - psr["TotalCost"]
    psr["Margin%"] = _safe_div(psr["Fee"], psr["Revenue"])

    psr = psr.sort_values(["Project", "Period"]).reset_index(drop=True)
    return psr


def build_psr_summary(psr: pd.DataFrame) -> pd.DataFrame:
    """Aggregate PSR data into a per-project summary (all periods combined).

    Returns:
        DataFrame with one row per project, columns:
            Project, DirectCost, IndirectCost, TotalCost, Revenue, Fee, Margin%
    """
    num_cols = ["DirectCost", "IndirectCost", "TotalCost", "Revenue", "Fee"]
    summary = psr.groupby("Project", as_index=False)[num_cols].sum()
    summary["Margin%"] = _safe_div(summary["Fee"], summary["Revenue"])
    return summary.sort_values("Project").reset_index(drop=True)
