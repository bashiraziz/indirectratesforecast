"""Year-to-date rate computation and rates comparison table builder."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _safe_div(num: float | pd.Series, den: float | pd.Series) -> float | pd.Series:
    if isinstance(den, (int, float)):
        return num / den if den != 0 else 0.0
    den = pd.Series(den).replace(0, np.nan)
    return (num / den).fillna(0.0)


def compute_ytd_rates(
    pools: pd.DataFrame,
    bases: pd.DataFrame,
    rate_definitions: dict[str, dict[str, Any]],
    fy_start: pd.Period,
) -> pd.DataFrame:
    """Compute cumulative YTD rates from fiscal year start through each period.

    Args:
        pools: Period x PoolName with pool dollar amounts
        bases: Period x BaseKey with base dollar amounts
        rate_definitions: {rate_name: {"pool": [pool_names], "base": base_key}}
        fy_start: Fiscal year start period

    Returns:
        DataFrame with columns: Period, rate_name_ytd for each rate
    """
    fy_periods = pools.index[pools.index >= fy_start].sort_values()
    if len(fy_periods) == 0:
        return pd.DataFrame()

    records: list[dict[str, Any]] = []
    for i, period in enumerate(fy_periods):
        window = fy_periods[: i + 1]
        row: dict[str, Any] = {"Period": period}
        for rate_name, rate_def in rate_definitions.items():
            pool_names = rate_def["pool"]
            base_key = rate_def["base"]
            cum_pool = pools.reindex(window).reindex(columns=pool_names, fill_value=0.0).sum().sum()
            cum_base = bases.reindex(window)[base_key].sum() if base_key in bases.columns else 0.0
            row[rate_name] = float(_safe_div(cum_pool, cum_base))
        records.append(row)

    df = pd.DataFrame(records)
    if "Period" in df.columns:
        df = df.set_index("Period")
    return df


def build_rates_comparison_table(
    actual_rates: pd.DataFrame,
    ytd_rates: pd.DataFrame,
    budget_rates: dict[str, dict[str, float]],
    provisional_rates: dict[str, dict[str, float]],
    rate_names: list[str],
) -> dict[str, pd.DataFrame]:
    """Build a comparison table for each rate type.

    Args:
        actual_rates: Period-indexed DataFrame with rate columns (monthly actuals)
        ytd_rates: Period-indexed DataFrame with YTD rate columns
        budget_rates: {rate_name: {period_str: rate_value}}
        provisional_rates: {rate_name: {period_str: rate_value}}
        rate_names: list of rate names to include

    Returns:
        {rate_name: DataFrame with rows: Actual, YTD, Budget, Provisional, Var(Act-Bud), Var(Act-Prov)
         and columns: period strings}
    """
    result: dict[str, pd.DataFrame] = {}

    for rate_name in rate_names:
        periods = actual_rates.index.sort_values()
        period_strs = [str(p) for p in periods]

        rows: dict[str, list[float]] = {
            "Actual": [],
            "YTD": [],
            "Budget": [],
            "Provisional": [],
            "Var (Act-Bud)": [],
            "Var (Act-Prov)": [],
        }

        budget_for_rate = budget_rates.get(rate_name, {})
        prov_for_rate = provisional_rates.get(rate_name, {})

        for period in periods:
            ps = str(period)
            actual = float(actual_rates.loc[period, rate_name]) if rate_name in actual_rates.columns else 0.0
            ytd = float(ytd_rates.loc[period, rate_name]) if period in ytd_rates.index and rate_name in ytd_rates.columns else 0.0
            budget = budget_for_rate.get(ps, 0.0)
            prov = prov_for_rate.get(ps, 0.0)

            rows["Actual"].append(actual)
            rows["YTD"].append(ytd)
            rows["Budget"].append(budget)
            rows["Provisional"].append(prov)
            rows["Var (Act-Bud)"].append(actual - budget)
            rows["Var (Act-Prov)"].append(actual - prov)

        result[rate_name] = pd.DataFrame(rows, index=period_strs).T

    return result
