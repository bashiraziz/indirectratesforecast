from __future__ import annotations

from pathlib import Path

import pandas as pd

from .types import Inputs


def _read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Missing required input: {path}")
    # Force Account column to string so codes like "7100.10" aren't truncated to 7100.1
    return pd.read_csv(path, dtype={"Account": str})


def load_inputs(input_dir: str | Path) -> Inputs:
    input_dir = Path(input_dir)
    return Inputs(
        gl_actuals=_read_csv(input_dir / "GL_Actuals.csv"),
        account_map=_read_csv(input_dir / "Account_Map.csv"),
        direct_costs=_read_csv(input_dir / "Direct_Costs_By_Project.csv"),
        scenario_events=_read_csv(input_dir / "Scenario_Events.csv"),
    )


def get_entities(inputs: Inputs) -> list[str]:
    """Return sorted unique entity names from GL_Actuals, or empty list if no Entity column."""
    if "Entity" not in inputs.gl_actuals.columns:
        return []
    entities = inputs.gl_actuals["Entity"].dropna().astype(str).unique().tolist()
    return sorted(entities)


def normalize_period_column(df: pd.DataFrame, col: str = "Period") -> pd.DataFrame:
    out = df.copy()
    if col not in out.columns:
        raise ValueError(f"Missing required column: {col}")
    out[col] = pd.PeriodIndex(pd.to_datetime(out[col]).dt.to_period("M"), freq="M")
    return out
