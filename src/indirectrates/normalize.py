from __future__ import annotations

import pandas as pd

from .io import normalize_period_column


def normalize_inputs(
    gl_actuals: pd.DataFrame,
    account_map: pd.DataFrame,
    direct_costs: pd.DataFrame,
    scenario_events: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, list[str]]:
    warnings: list[str] = []

    gl_actuals = normalize_period_column(gl_actuals, "Period")
    direct_costs = normalize_period_column(direct_costs, "Period")

    scenario_events = scenario_events.copy()
    if "EffectivePeriod" in scenario_events.columns:
        scenario_events["EffectivePeriod"] = pd.PeriodIndex(
            pd.to_datetime(scenario_events["EffectivePeriod"]).dt.to_period("M"), freq="M"
        )
    else:
        warnings.append("Scenario_Events.csv missing EffectivePeriod; no events will apply.")

    account_map = account_map.copy()
    if "IsUnallowable" not in account_map.columns:
        account_map["IsUnallowable"] = False

    for required in ["Account", "Pool"]:
        if required not in account_map.columns:
            raise ValueError(f"Account_Map.csv missing required column: {required}")
    for required in ["Account", "Amount"]:
        if required not in gl_actuals.columns:
            raise ValueError(f"GL_Actuals.csv missing required column: {required}")

    return gl_actuals, account_map, direct_costs, scenario_events, warnings
