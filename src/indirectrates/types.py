from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd


@dataclass(frozen=True)
class Inputs:
    gl_actuals: pd.DataFrame
    account_map: pd.DataFrame
    direct_costs: pd.DataFrame
    scenario_events: pd.DataFrame


@dataclass(frozen=True)
class ForecastResult:
    scenario: str
    periods: pd.PeriodIndex
    pools: pd.DataFrame
    bases: pd.DataFrame
    rates: pd.DataFrame
    project_impacts: pd.DataFrame
    assumptions: dict[str, Any]
    warnings: list[str]
    # Optional Phase 3+ fields
    ytd_rates: pd.DataFrame | None = None
    budget_rates: dict[str, dict[str, float]] | None = None
    provisional_rates: dict[str, dict[str, float]] | None = None
