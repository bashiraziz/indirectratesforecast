from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from .config import RateConfig


@dataclass(frozen=True)
class Projection:
    pools: pd.DataFrame  # Period x PoolName
    bases: pd.DataFrame  # Period x BaseKey
    direct_by_project: pd.DataFrame  # Period, Project, direct cost columns
    assumptions: dict[str, Any]
    warnings: list[str]


def _month_range(start: pd.Period, end: pd.Period) -> pd.PeriodIndex:
    return pd.period_range(start=start, end=end, freq="M")


def _safe_div(num: pd.Series, den: pd.Series) -> pd.Series:
    den = den.replace(0, np.nan)
    return (num / den).fillna(0.0)


def _bases_from_direct_costs(by_period: pd.DataFrame) -> pd.DataFrame:
    """Compute base DataFrame from aggregated direct costs by period."""
    bases = pd.DataFrame(index=by_period.index)
    bases["DL"] = by_period["DirectLabor$"]
    bases["DLH"] = by_period["DirectLaborHrs"]
    bases["TL"] = by_period["DirectLabor$"]
    bases["TCI"] = by_period[["DirectLabor$", "Subk", "ODC", "Travel"]].sum(axis=1)
    return bases.sort_index()


def compute_actual_aggregates(
    gl_mapped: pd.DataFrame,
    direct_costs: pd.DataFrame,
    config: RateConfig,
    entity: str | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, list[str]]:
    warnings: list[str] = []

    gl_valid = gl_mapped[~gl_mapped["IsUnallowable"]].copy()
    gl_valid = gl_valid[~gl_valid["Pool"].isin(config.unallowable_pool_names)]

    # Entity filtering: filter GL and direct costs to a single entity if specified
    if entity:
        if "Entity" in gl_valid.columns:
            gl_valid = gl_valid[gl_valid["Entity"].astype(str) == entity]
            if gl_valid.empty:
                warnings.append(f"No GL data found for entity '{entity}'.")
        else:
            warnings.append("Entity filter requested but GL_Actuals has no Entity column.")
        if "Entity" in direct_costs.columns:
            direct_costs = direct_costs[direct_costs["Entity"].astype(str) == entity].copy()
        # If direct_costs has no Entity column, keep all (can't filter)
    pools = (
        gl_valid.groupby(["Period", "Pool"], as_index=False)["Amount"]
        .sum()
        .pivot(index="Period", columns="Pool", values="Amount")
        .fillna(0.0)
        .sort_index()
    )

    direct = direct_costs.copy()
    for col in ["Project", "DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"]:
        if col not in direct.columns:
            if col == "Project":
                direct["Project"] = "UNKNOWN"
            else:
                direct[col] = 0.0
            warnings.append(f"Direct_Costs_By_Project.csv missing {col}; defaulting.")
        if col != "Project":
            direct[col] = pd.to_numeric(direct[col], errors="coerce").fillna(0.0)

    by_period = direct.groupby("Period", as_index=True)[
        ["DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"]
    ].sum()

    dc_bases = _bases_from_direct_costs(by_period)

    if config.base_account_map:
        # GL-primary: compute bases from GL trial balance accounts
        all_gl = gl_mapped.copy()
        all_gl["Amount"] = pd.to_numeric(all_gl["Amount"], errors="coerce").fillna(0.0)

        gl_bases = pd.DataFrame(index=pools.index)
        for base_key, accounts in config.base_account_map.items():
            mask = all_gl["Account"].isin(accounts)
            agg = all_gl[mask].groupby("Period")["Amount"].sum().reindex(pools.index, fill_value=0.0)
            gl_bases[base_key] = agg

        # Ensure standard derived keys exist
        if "DL" in gl_bases.columns and "TL" not in gl_bases.columns:
            gl_bases["TL"] = gl_bases["DL"]

        # DLH can't come from GL (dollar amounts only) — always use Direct_Costs
        gl_bases["DLH"] = dc_bases["DLH"].reindex(gl_bases.index, fill_value=0.0)

        bases = gl_bases

        # Reconciliation warning: compare GL-derived vs Direct_Costs-derived bases
        for key in ["DL", "TCI"]:
            if key in gl_bases.columns and key in dc_bases.columns:
                gl_total = gl_bases[key].sum()
                dc_total = dc_bases[key].sum()
                if dc_total > 0:
                    pct_diff = abs(gl_total - dc_total) / dc_total
                    if pct_diff > 0.05:
                        warnings.append(
                            f"GL-derived {key} base (${gl_total:,.0f}) differs from "
                            f"project ledger (${dc_total:,.0f}) by {pct_diff:.1%}. "
                            f"Reconcile GL direct accounts with project direct costs."
                        )
    else:
        # Fallback: bases from Direct_Costs_By_Project (legacy CSV-only mode)
        bases = dc_bases

    direct_by_project = direct[["Period", "Project", "DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"]].copy()
    return pools, bases, direct_by_project, warnings


def build_baseline_projection(
    actual_pools: pd.DataFrame,
    actual_bases: pd.DataFrame,
    direct_by_project: pd.DataFrame,
    forecast_months: int,
    run_rate_months: int = 3,
) -> Projection:
    if len(actual_pools.index) == 0:
        raise ValueError("No pool actuals found after mapping/unallowables; cannot forecast.")
    last_actual: pd.Period = actual_pools.index.max()
    end = last_actual + forecast_months
    periods = _month_range(actual_pools.index.min(), end)

    pools = actual_pools.reindex(periods).copy()
    bases = actual_bases.reindex(periods).copy()

    rr_pools = actual_pools.tail(run_rate_months).mean()
    rr_bases = actual_bases.tail(run_rate_months).mean()

    for period in periods:
        if period <= last_actual:
            continue
        pools.loc[period] = rr_pools
        bases.loc[period] = rr_bases

    assumptions = {
        "forecast_months": forecast_months,
        "run_rate_months": run_rate_months,
        "method": "rolling_mean_run_rate",
        "run_rate_pool_means": rr_pools.to_dict(),
        "run_rate_base_means": rr_bases.to_dict(),
        "last_actual_period": str(last_actual),
    }

    warnings: list[str] = []
    if (bases[["DL", "TCI", "TL"]] < 0).any().any():
        warnings.append("Negative base values detected; rates may be distorted.")

    direct_proj = _project_direct_costs_run_rate(
        direct_by_project, periods=periods, last_actual=last_actual, run_rate_months=run_rate_months
    )

    return Projection(
        pools=pools.fillna(0.0),
        bases=bases.fillna(0.0),
        direct_by_project=direct_proj,
        assumptions=assumptions,
        warnings=warnings,
    )


def _project_direct_costs_run_rate(
    direct_by_project: pd.DataFrame,
    periods: pd.PeriodIndex,
    last_actual: pd.Period,
    run_rate_months: int,
) -> pd.DataFrame:
    direct = direct_by_project.copy()
    direct["Period"] = direct["Period"].astype("period[M]")
    recent = direct[direct["Period"] > (last_actual - (run_rate_months - 1))]
    rr = recent.groupby("Project")[["DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"]].mean()

    all_idx = pd.MultiIndex.from_product([periods, rr.index], names=["Period", "Project"])
    existing = direct.set_index(["Period", "Project"]).reindex(all_idx)
    for col in ["DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"]:
        mapped = pd.Series(existing.index.get_level_values("Project").map(rr[col]).to_numpy(), index=existing.index)
        existing[col] = existing[col].fillna(mapped)
    return existing.reset_index()


def apply_scenario_events(
    projection: Projection,
    scenario_events: pd.DataFrame,
    scenario: str,
    config: RateConfig | None = None,
) -> Projection:
    events = scenario_events.copy()
    if len(events.index) == 0 or "EffectivePeriod" not in events.columns:
        return projection

    if "Scenario" in events.columns:
        events = events[(events["Scenario"].fillna("Base").astype(str) == scenario)]

    if len(events.index) == 0:
        return projection

    pools = projection.pools.copy()
    direct = projection.direct_by_project.copy()

    def _num(col: str) -> pd.Series:
        if col not in events.columns:
            return pd.Series([0.0] * len(events.index), index=events.index)
        return pd.to_numeric(events[col], errors="coerce").fillna(0.0)

    events = events.copy()
    events["Project"] = events.get("Project", "").fillna("").astype(str)

    # Direct cost delta columns (fixed)
    direct_delta_cols = [
        "DeltaDirectLabor$",
        "DeltaDirectLaborHrs",
        "DeltaSubk",
        "DeltaODC",
        "DeltaTravel",
    ]
    for col in direct_delta_cols:
        events[col] = _num(col)

    # Auto-detect pool delta columns: DeltaPool<Name> → pool <Name>
    # Supports both legacy (DeltaPoolFringe, DeltaPoolGA) and new (DeltaPoolHealth Insurance)
    pool_delta_map: dict[str, str] = {}  # delta_col -> pool_name
    for col in events.columns:
        if col.startswith("DeltaPool"):
            pool_name = col[len("DeltaPool"):]
            # Legacy mapping: "GA" → "G&A" for backward compatibility
            if pool_name == "GA":
                pool_name = "G&A"
            pool_delta_map[col] = pool_name
            events[col] = _num(col)

    for _, event in events.iterrows():
        eff: pd.Period = event["EffectivePeriod"]
        applicable_periods = pools.index[pools.index >= eff]
        if len(applicable_periods) == 0:
            continue

        for delta_col, pool_name in pool_delta_map.items():
            if pool_name not in pools.columns:
                pools[pool_name] = 0.0
            pools.loc[applicable_periods, pool_name] += float(event[delta_col])

        project = str(event["Project"] or "").strip()
        if project:
            mask = (direct["Project"] == project) & (direct["Period"] >= eff)
            for col, delta_col in [
                ("DirectLabor$", "DeltaDirectLabor$"),
                ("DirectLaborHrs", "DeltaDirectLaborHrs"),
                ("Subk", "DeltaSubk"),
                ("ODC", "DeltaODC"),
                ("Travel", "DeltaTravel"),
            ]:
                direct.loc[mask, col] = pd.to_numeric(direct.loc[mask, col], errors="coerce").fillna(0.0) + float(
                    event[delta_col]
                )

    # Recompute bases so impacts and rates reconcile.
    use_gl_bases = config is not None and bool(config.base_account_map)

    if use_gl_bases:
        # GL-primary mode: apply aggregate direct cost deltas to the GL-derived bases
        # rather than recomputing entirely from direct_by_project.
        bases = projection.bases.copy()
        orig_by_period = (
            projection.direct_by_project.groupby("Period", as_index=True)[
                ["DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"]
            ].sum().sort_index()
        )
        new_by_period = (
            direct.groupby("Period", as_index=True)[
                ["DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"]
            ].sum().sort_index()
        )
        for idx in bases.index:
            if idx in new_by_period.index and idx in orig_by_period.index:
                dl_delta = new_by_period.loc[idx, "DirectLabor$"] - orig_by_period.loc[idx, "DirectLabor$"]
                hrs_delta = new_by_period.loc[idx, "DirectLaborHrs"] - orig_by_period.loc[idx, "DirectLaborHrs"]
                subk_delta = new_by_period.loc[idx, "Subk"] - orig_by_period.loc[idx, "Subk"]
                odc_delta = new_by_period.loc[idx, "ODC"] - orig_by_period.loc[idx, "ODC"]
                travel_delta = new_by_period.loc[idx, "Travel"] - orig_by_period.loc[idx, "Travel"]
                if "DL" in bases.columns:
                    bases.loc[idx, "DL"] += dl_delta
                if "TL" in bases.columns:
                    bases.loc[idx, "TL"] += dl_delta
                if "DLH" in bases.columns:
                    bases.loc[idx, "DLH"] += hrs_delta
                if "TCI" in bases.columns:
                    bases.loc[idx, "TCI"] += dl_delta + subk_delta + odc_delta + travel_delta
    else:
        # Fallback: recompute bases entirely from direct-by-project
        by_period = (
            direct.groupby("Period", as_index=True)[
                ["DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"]
            ].sum().sort_index()
        )
        bases = projection.bases.copy()
        for idx in bases.index:
            if idx in by_period.index:
                bases.loc[idx, "DL"] = by_period.loc[idx, "DirectLabor$"]
                bases.loc[idx, "DLH"] = by_period.loc[idx, "DirectLaborHrs"]
                bases.loc[idx, "TL"] = by_period.loc[idx, "DirectLabor$"]
                bases.loc[idx, "TCI"] = by_period.loc[idx, ["DirectLabor$", "Subk", "ODC", "Travel"]].sum()

    assumptions = dict(projection.assumptions)
    assumptions["scenario"] = scenario
    assumptions["events_applied"] = int(len(events.index))
    return Projection(
        pools=pools.fillna(0.0),
        bases=bases.fillna(0.0),
        direct_by_project=direct,
        assumptions=assumptions,
        warnings=projection.warnings,
    )


def compute_rates_and_impacts(
    projection: Projection,
    config: RateConfig,
    fy_start: pd.Period | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame | None]:
    rates = pd.DataFrame(index=projection.pools.index)
    for rate_name, rate_def in config.rates.items():
        pool_total = projection.pools.reindex(columns=rate_def.pool, fill_value=0.0).sum(axis=1)
        if rate_def.base not in projection.bases.columns:
            raise ValueError(f"Base '{rate_def.base}' not available. Known: {list(projection.bases.columns)}")
        base = projection.bases[rate_def.base]
        rates[rate_name] = _safe_div(pool_total, base)

    direct = projection.direct_by_project.copy()
    direct["TCI"] = direct[["DirectLabor$", "Subk", "ODC", "Travel"]].sum(axis=1)
    direct = direct.merge(rates.reset_index().rename(columns={"index": "Period"}), on="Period", how="left")

    # Dynamically compute loaded costs from config rate definitions
    _base_column_map = {
        "DL": "DirectLabor$",
        "TL": "DirectLabor$",
        "DLH": "DirectLaborHrs",
        "TCI": "TCI",
    }

    # Sort rates by cascade_order for cascaded application
    sorted_rates = sorted(config.rates.items(), key=lambda x: x[1].cascade_order)

    indirect_dollar_cols: list[str] = []
    # Track which indirect $ cols belong to each cascade tier
    cols_by_tier: dict[int, list[str]] = {}

    for rate_name, rate_def in sorted_rates:
        base_col = _base_column_map.get(rate_def.base, rate_def.base)
        dollar_col = f"{rate_name}$"

        if rate_def.cascade_order == 0:
            # First tier: use raw direct cost column
            apply_to = direct[base_col]
        else:
            # Later tiers: base includes raw directs + all prior-tier indirect $
            prior_cols = []
            for tier, tier_cols in cols_by_tier.items():
                if tier < rate_def.cascade_order:
                    prior_cols.extend(tier_cols)
            if prior_cols:
                prior_indirect = direct[prior_cols].sum(axis=1)
                apply_to = direct[base_col] + prior_indirect
            else:
                apply_to = direct[base_col]

        direct[dollar_col] = apply_to * direct.get(rate_name, 0.0)
        indirect_dollar_cols.append(dollar_col)
        cols_by_tier.setdefault(rate_def.cascade_order, []).append(dollar_col)

    direct["LoadedCost$"] = direct["TCI"] + direct[indirect_dollar_cols].sum(axis=1)

    # --- YTD-based allocation ---
    ytd_rates_df: pd.DataFrame | None = None
    ytd_indirect_dollar_cols: list[str] = []

    if fy_start is not None:
        from .ytd import compute_ytd_rates

        rate_defs = {name: {"pool": rd.pool, "base": rd.base} for name, rd in config.rates.items()}
        ytd_rates_df = compute_ytd_rates(projection.pools, projection.bases, rate_defs, fy_start)

        if not ytd_rates_df.empty:
            # Merge YTD rates into direct (suffix _ytd_rate to avoid collision with monthly)
            ytd_for_merge = ytd_rates_df.copy()
            ytd_for_merge.columns = [f"{c}_ytd_rate" for c in ytd_for_merge.columns]
            direct = direct.merge(
                ytd_for_merge.reset_index().rename(columns={"index": "Period"}),
                on="Period", how="left",
            )

            # Apply cascading with YTD rates
            ytd_cols_by_tier: dict[int, list[str]] = {}
            for rate_name, rate_def in sorted_rates:
                base_col = _base_column_map.get(rate_def.base, rate_def.base)
                ytd_dollar_col = f"{rate_name}$_ytd"
                ytd_rate_col = f"{rate_name}_ytd_rate"

                if ytd_rate_col not in direct.columns:
                    direct[ytd_dollar_col] = 0.0
                else:
                    if rate_def.cascade_order == 0:
                        apply_to = direct[base_col]
                    else:
                        prior_cols = []
                        for tier, tier_cols in ytd_cols_by_tier.items():
                            if tier < rate_def.cascade_order:
                                prior_cols.extend(tier_cols)
                        if prior_cols:
                            prior_indirect = direct[prior_cols].sum(axis=1)
                            apply_to = direct[base_col] + prior_indirect
                        else:
                            apply_to = direct[base_col]

                    direct[ytd_dollar_col] = apply_to * direct[ytd_rate_col].fillna(0.0)

                ytd_indirect_dollar_cols.append(ytd_dollar_col)
                ytd_cols_by_tier.setdefault(rate_def.cascade_order, []).append(ytd_dollar_col)

            direct["LoadedCost$_ytd"] = direct["TCI"] + direct[ytd_indirect_dollar_cols].sum(axis=1)

    base_direct_cols = ["DirectLabor$", "Subk", "ODC", "Travel"]
    impact_cols = base_direct_cols + indirect_dollar_cols + ["LoadedCost$"]
    if ytd_indirect_dollar_cols:
        impact_cols = impact_cols + ytd_indirect_dollar_cols + ["LoadedCost$_ytd"]
    impacts = (
        direct.groupby(["Period", "Project"], as_index=False)[impact_cols]
        .sum()
        .sort_values(["Period", "Project"])
    )
    return rates, impacts, ytd_rates_df
