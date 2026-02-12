from __future__ import annotations

from pathlib import Path

import pandas as pd

from .types import Inputs


def _read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Missing required input: {path}")
    return pd.read_csv(path)


def load_inputs(input_dir: str | Path) -> Inputs:
    input_dir = Path(input_dir)
    return Inputs(
        gl_actuals=_read_csv(input_dir / "GL_Actuals.csv"),
        account_map=_read_csv(input_dir / "Account_Map.csv"),
        direct_costs=_read_csv(input_dir / "Direct_Costs_By_Project.csv"),
        scenario_events=_read_csv(input_dir / "Scenario_Events.csv"),
    )


def normalize_period_column(df: pd.DataFrame, col: str = "Period") -> pd.DataFrame:
    out = df.copy()
    if col not in out.columns:
        raise ValueError(f"Missing required column: {col}")
    out[col] = pd.PeriodIndex(pd.to_datetime(out[col]).dt.to_period("M"), freq="M")
    return out
