from __future__ import annotations

from pathlib import Path

import pandas as pd

from indirectrates.agents import AnalystAgent, PlannerAgent, ReporterAgent
from indirectrates.config import RateConfig
from indirectrates.synth import SynthSpec, generate_synthetic_dataset


def test_end_to_end_base(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    out_dir = tmp_path / "out"
    generate_synthetic_dataset(data_dir, SynthSpec(start="2025-01", months=12, projects=3, seed=7))

    cfg = RateConfig.from_yaml(Path("configs/default_rates.yaml"))
    plan = PlannerAgent().plan(
        "Base", forecast_months=6, run_rate_months=3, events_path=data_dir / "Scenario_Events.csv"
    )
    results = AnalystAgent().run(input_dir=data_dir, config=cfg, plan=plan)
    ReporterAgent().package(out_dir=out_dir, results=results)

    assert (out_dir / "rate_pack.xlsx").exists()
    assert (out_dir / "narrative.md").exists()
    assert (out_dir / "assumptions.json").exists()
    assert (out_dir / "charts").exists()

    base = results[0]
    assert "Fringe" in base.rates.columns
    assert (base.bases["DL"] >= 0).all()

    period = base.rates.index[0]
    fringe_pool = float(base.pools.loc[period, "Fringe"])
    tl = float(base.bases.loc[period, "TL"])
    expected = 0.0 if tl == 0 else fringe_pool / tl
    assert abs(float(base.rates.loc[period, "Fringe"]) - expected) < 1e-9


def test_scenario_win_vs_lose_direction(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    generate_synthetic_dataset(data_dir, SynthSpec(start="2025-01", months=18, projects=4, seed=11))

    cfg = RateConfig.from_yaml(Path("configs/default_rates.yaml"))
    plan = PlannerAgent().plan(None, forecast_months=6, run_rate_months=3, events_path=data_dir / "Scenario_Events.csv")
    results = {r.scenario: r for r in AnalystAgent().run(input_dir=data_dir, config=cfg, plan=plan)}

    eff = pd.Period(pd.read_csv(data_dir / "Scenario_Events.csv")["EffectivePeriod"].iloc[0], freq="M")
    win = results["Win"].rates
    lose = results["Lose"].rates
    mask = win.index >= eff
    assert float(lose.loc[mask, "Overhead"].mean()) >= float(win.loc[mask, "Overhead"].mean())
    assert float(lose.loc[mask, "G&A"].mean()) >= float(win.loc[mask, "G&A"].mean())
