from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class SynthSpec:
    start: str  # YYYY-MM
    months: int
    projects: int
    seed: int


def generate_synthetic_dataset(out_dir: str | Path, spec: SynthSpec) -> Path:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(spec.seed)
    periods = pd.period_range(spec.start, periods=spec.months, freq="M")
    projects = [f"P{idx:03d}" for idx in range(1, spec.projects + 1)]

    rows = []
    for period in periods:
        season = 1.0 + 0.08 * np.sin((period.month - 1) / 12 * 2 * np.pi)
        for project in projects:
            direct_labor = float(rng.normal(250_000, 35_000) * season)
            direct_labor = max(direct_labor, 50_000)
            direct_hours = direct_labor / float(rng.normal(110, 10))
            subk = float(rng.normal(60_000, 15_000))
            odc = float(rng.normal(20_000, 5_000))
            travel = float(rng.normal(10_000, 4_000))
            rows.append([str(period), project, direct_labor, direct_hours, max(subk, 0), max(odc, 0), max(travel, 0)])
    direct = pd.DataFrame(
        rows, columns=["Period", "Project", "DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"]
    )
    direct.to_csv(out_dir / "Direct_Costs_By_Project.csv", index=False)

    by_period = direct.groupby("Period", as_index=False)[["DirectLabor$", "Subk", "ODC", "Travel"]].sum()
    by_period["Fringe"] = by_period["DirectLabor$"] * 0.28 + rng.normal(0, 12_000, size=len(by_period))
    by_period["Overhead"] = by_period["DirectLabor$"] * 0.55 + rng.normal(0, 18_000, size=len(by_period))
    by_period["G&A"] = (by_period[["DirectLabor$", "Subk", "ODC", "Travel"]].sum(axis=1)) * 0.12 + rng.normal(
        0, 10_000, size=len(by_period)
    )
    by_period["Unallowable"] = rng.normal(4_000, 1_000, size=len(by_period))

    acct_map = pd.DataFrame(
        [
            ["6000", "Fringe", "TL", False, "Benefits/Fringe"],
            ["6100", "Overhead", "DL", False, "Indirect ops"],
            ["6200", "G&A", "TCI", False, "Admin"],
            ["6999", "Unallowable", "", True, "Unallowables"],
        ],
        columns=["Account", "Pool", "BaseCategory", "IsUnallowable", "Notes"],
    )
    acct_map.to_csv(out_dir / "Account_Map.csv", index=False)

    gl_rows = []
    for _, row in by_period.iterrows():
        period = row["Period"]
        gl_rows.append([period, "6000", float(row["Fringe"])])
        gl_rows.append([period, "6100", float(row["Overhead"])])
        gl_rows.append([period, "6200", float(row["G&A"])])
        gl_rows.append([period, "6999", float(row["Unallowable"])])
    gl = pd.DataFrame(gl_rows, columns=["Period", "Account", "Amount"])
    gl.to_csv(out_dir / "GL_Actuals.csv", index=False)

    eff = str(periods[int(len(periods) * 0.6)])
    scenario = pd.DataFrame(
        [
            ["Base", eff, "ADJUST", "", 0, 0, 0, 0, 0, 0, 0, 0, "No changes"],
            [
                "Win",
                eff,
                "WIN",
                projects[0],
                90_000,
                800,
                25_000,
                8_000,
                3_000,
                4_000,
                6_000,
                2_000,
                "New award adds base with small pool lift",
            ],
            [
                "Lose",
                eff,
                "LOSE",
                projects[1],
                -110_000,
                -900,
                -30_000,
                -10_000,
                -4_000,
                0,
                0,
                0,
                "Loss reduces base; pools sticky → rates up",
            ],
        ],
        columns=[
            "Scenario",
            "EffectivePeriod",
            "Type",
            "Project",
            "DeltaDirectLabor$",
            "DeltaDirectLaborHrs",
            "DeltaSubk",
            "DeltaODC",
            "DeltaTravel",
            "DeltaPoolFringe",
            "DeltaPoolOverhead",
            "DeltaPoolGA",
            "Notes",
        ],
    )
    scenario.to_csv(out_dir / "Scenario_Events.csv", index=False)

    return out_dir
