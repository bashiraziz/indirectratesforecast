"""Tests for multi sub-pool support in the forecast engine."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from indirectrates.config import RateConfig
from indirectrates.model import (
    apply_scenario_events,
    build_baseline_projection,
    compute_actual_aggregates,
    compute_rates_and_impacts,
    Projection,
)


def _make_sub_pool_config() -> RateConfig:
    """Config where Fringe = Fringe1 + Fringe2 (both base TL)."""
    return RateConfig.from_mapping(
        {
            "base_definitions": {
                "DL": "DirectLabor$",
                "DLH": "DirectLaborHrs",
                "TL": "DirectLabor$",
                "TCI": {"sum": ["DirectLabor$", "Subk", "ODC", "Travel"]},
            },
            "rates": {
                "Fringe": {"pool": ["Fringe1", "Fringe2"], "base": "TL"},
                "Overhead": {"pool": ["IT SC", "Facilities SC"], "base": "DL"},
                "G&A": {"pool": ["G&A"], "base": "TCI"},
            },
            "unallowable_pool_names": ["Unallowable"],
        }
    )


def _make_gl_data() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Synthetic GL data with sub-pools."""
    periods = pd.period_range("2025-01", periods=6, freq="M")
    rng = np.random.default_rng(42)

    rows = []
    for p in periods:
        rows.append({"Period": p, "Account": "6001", "Pool": "Fringe1", "Amount": 50_000 + rng.normal(0, 2000), "IsUnallowable": False})
        rows.append({"Period": p, "Account": "6002", "Pool": "Fringe2", "Amount": 30_000 + rng.normal(0, 1500), "IsUnallowable": False})
        rows.append({"Period": p, "Account": "6101", "Pool": "IT SC", "Amount": 80_000 + rng.normal(0, 3000), "IsUnallowable": False})
        rows.append({"Period": p, "Account": "6102", "Pool": "Facilities SC", "Amount": 40_000 + rng.normal(0, 2000), "IsUnallowable": False})
        rows.append({"Period": p, "Account": "6200", "Pool": "G&A", "Amount": 100_000 + rng.normal(0, 5000), "IsUnallowable": False})
        rows.append({"Period": p, "Account": "6999", "Pool": "Unallowable", "Amount": 5_000, "IsUnallowable": True})

    gl_mapped = pd.DataFrame(rows)
    gl_mapped["Period"] = gl_mapped["Period"].astype("period[M]")

    direct_rows = []
    for p in periods:
        for proj in ["P001", "P002"]:
            direct_rows.append({
                "Period": p,
                "Project": proj,
                "DirectLabor$": 200_000 + rng.normal(0, 10000),
                "DirectLaborHrs": 1800 + rng.normal(0, 100),
                "Subk": 50_000,
                "ODC": 20_000,
                "Travel": 10_000,
            })
    direct = pd.DataFrame(direct_rows)
    direct["Period"] = direct["Period"].astype("period[M]")

    return gl_mapped, direct


def test_sub_pool_rates_sum_correctly():
    """Fringe rate = (Fringe1$ + Fringe2$) / TL, not just one sub-pool."""
    config = _make_sub_pool_config()
    gl_mapped, direct_costs = _make_gl_data()

    actual_pools, actual_bases, direct_by_project, warnings = compute_actual_aggregates(
        gl_mapped, direct_costs, config
    )
    assert "Fringe1" in actual_pools.columns
    assert "Fringe2" in actual_pools.columns

    projection = build_baseline_projection(
        actual_pools, actual_bases, direct_by_project,
        forecast_months=3, run_rate_months=3,
    )

    rates, impacts, _ = compute_rates_and_impacts(projection, config)

    # Verify Fringe rate = (Fringe1 + Fringe2) / TL
    for period in rates.index[:3]:
        fringe1 = float(projection.pools.loc[period, "Fringe1"])
        fringe2 = float(projection.pools.loc[period, "Fringe2"])
        tl = float(projection.bases.loc[period, "TL"])
        expected = (fringe1 + fringe2) / tl if tl != 0 else 0
        assert abs(float(rates.loc[period, "Fringe"]) - expected) < 1e-9

    # Verify Overhead rate = (IT SC + Facilities SC) / DL
    for period in rates.index[:3]:
        it_sc = float(projection.pools.loc[period, "IT SC"])
        fac = float(projection.pools.loc[period, "Facilities SC"])
        dl = float(projection.bases.loc[period, "DL"])
        expected = (it_sc + fac) / dl if dl != 0 else 0
        assert abs(float(rates.loc[period, "Overhead"]) - expected) < 1e-9


def test_sub_pool_impacts_have_dynamic_columns():
    """Impact columns should be generated from config, not hardcoded."""
    config = _make_sub_pool_config()
    gl_mapped, direct_costs = _make_gl_data()

    actual_pools, actual_bases, direct_by_project, _ = compute_actual_aggregates(
        gl_mapped, direct_costs, config
    )
    projection = build_baseline_projection(
        actual_pools, actual_bases, direct_by_project,
        forecast_months=3, run_rate_months=3,
    )
    rates, impacts, _ = compute_rates_and_impacts(projection, config)

    assert "Fringe$" in impacts.columns
    assert "Overhead$" in impacts.columns
    assert "G&A$" in impacts.columns
    assert "LoadedCost$" in impacts.columns


def test_scenario_events_auto_detect_delta_pool_columns():
    """apply_scenario_events should auto-detect DeltaPoolXxx columns."""
    config = _make_sub_pool_config()
    gl_mapped, direct_costs = _make_gl_data()

    actual_pools, actual_bases, direct_by_project, _ = compute_actual_aggregates(
        gl_mapped, direct_costs, config
    )
    baseline = build_baseline_projection(
        actual_pools, actual_bases, direct_by_project,
        forecast_months=3, run_rate_months=3,
    )

    # Create events with dynamic DeltaPool columns
    events = pd.DataFrame([
        {
            "Scenario": "Test",
            "EffectivePeriod": pd.Period("2025-05", freq="M"),
            "Type": "ADJUST",
            "Project": "",
            "DeltaDirectLabor$": 0,
            "DeltaDirectLaborHrs": 0,
            "DeltaSubk": 0,
            "DeltaODC": 0,
            "DeltaTravel": 0,
            "DeltaPoolFringe1": 10_000,
            "DeltaPoolFringe2": 5_000,
            "DeltaPoolIT SC": 8_000,
        }
    ])

    proj = apply_scenario_events(baseline, events, scenario="Test")

    # Pool values should be modified from effective period onward
    eff = pd.Period("2025-05", freq="M")
    after = proj.pools.index[proj.pools.index >= eff]
    before = proj.pools.index[proj.pools.index < eff]

    for period in after:
        assert float(proj.pools.loc[period, "Fringe1"]) > float(baseline.pools.loc[period, "Fringe1"])

    # Before effective period should be unchanged
    for period in before:
        assert float(proj.pools.loc[period, "Fringe1"]) == pytest.approx(
            float(baseline.pools.loc[period, "Fringe1"]), abs=1e-9
        )


def test_legacy_delta_pool_ga_maps_to_g_and_a():
    """DeltaPoolGA should map to 'G&A' pool for backward compatibility."""
    config = _make_sub_pool_config()
    gl_mapped, direct_costs = _make_gl_data()

    actual_pools, actual_bases, direct_by_project, _ = compute_actual_aggregates(
        gl_mapped, direct_costs, config
    )
    baseline = build_baseline_projection(
        actual_pools, actual_bases, direct_by_project,
        forecast_months=3, run_rate_months=3,
    )

    events = pd.DataFrame([
        {
            "Scenario": "Legacy",
            "EffectivePeriod": pd.Period("2025-04", freq="M"),
            "Type": "ADJUST",
            "Project": "",
            "DeltaPoolGA": 15_000,
        }
    ])

    proj = apply_scenario_events(baseline, events, scenario="Legacy")

    eff = pd.Period("2025-04", freq="M")
    after = proj.pools.index[proj.pools.index >= eff]
    for period in after:
        assert float(proj.pools.loc[period, "G&A"]) > float(baseline.pools.loc[period, "G&A"])
