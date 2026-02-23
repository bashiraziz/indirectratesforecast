"""Tests for DCAA-correct cascading rate application in compute_rates_and_impacts."""

from __future__ import annotations

import pandas as pd
import pytest

from indirectrates.config import RateConfig, RateDefinition
from indirectrates.model import Projection, compute_rates_and_impacts


def _make_projection(
    dl: float = 100_000.0,
    subk: float = 50_000.0,
    fringe_pool: float = 25_000.0,
    oh_pool: float = 12_500.0,
    ga_pool: float = 28_125.0,
) -> Projection:
    """Build a single-period, single-project Projection for testing."""
    period = pd.Period("2025-01", freq="M")
    pools = pd.DataFrame(
        {"Fringe": [fringe_pool], "Overhead": [oh_pool], "G&A": [ga_pool]},
        index=pd.PeriodIndex([period], freq="M"),
    )
    bases = pd.DataFrame(
        {"DL": [dl], "TL": [dl], "TCI": [dl + subk], "DLH": [1000.0]},
        index=pd.PeriodIndex([period], freq="M"),
    )
    direct = pd.DataFrame(
        {
            "Period": [period],
            "Project": ["P-1"],
            "DirectLabor$": [dl],
            "DirectLaborHrs": [1000.0],
            "Subk": [subk],
            "ODC": [0.0],
            "Travel": [0.0],
        }
    )
    return Projection(
        pools=pools,
        bases=bases,
        direct_by_project=direct,
        assumptions={"test": True},
        warnings=[],
    )


def _cascaded_config() -> RateConfig:
    """RateConfig with cascade_order: Fringe=0, Overhead=1, G&A=2."""
    return RateConfig(
        base_definitions={"DL": "DirectLabor$", "TL": "DirectLabor$", "TCI": {"sum": ["DirectLabor$", "Subk", "ODC", "Travel"]}},
        rates={
            "Fringe": RateDefinition(pool=["Fringe"], base="TL", cascade_order=0),
            "Overhead": RateDefinition(pool=["Overhead"], base="DL", cascade_order=1),
            "G&A": RateDefinition(pool=["G&A"], base="TCI", cascade_order=2),
        },
        unallowable_pool_names=set(),
    )


def _flat_config() -> RateConfig:
    """RateConfig with all cascade_order=0 (flat, no cascading)."""
    return RateConfig(
        base_definitions={"DL": "DirectLabor$", "TL": "DirectLabor$", "TCI": {"sum": ["DirectLabor$", "Subk", "ODC", "Travel"]}},
        rates={
            "Fringe": RateDefinition(pool=["Fringe"], base="TL", cascade_order=0),
            "Overhead": RateDefinition(pool=["Overhead"], base="DL", cascade_order=0),
            "G&A": RateDefinition(pool=["G&A"], base="TCI", cascade_order=0),
        },
        unallowable_pool_names=set(),
    )


class TestCascadingRates:
    """Verify cascaded vs flat rate application with known numbers.

    Example: DL=$100K, Subk=$50K, Fringe=25%, OH=10%, G&A=15%

    Cascaded:
      Fringe$ = $100K * 25% = $25K (cascade_order=0, on raw TL)
      OH$ = ($100K + $25K) * 10% = $12.5K (cascade_order=1, base DL + prior indirect)
      G&A$ = ($150K + $25K + $12.5K) * 15% = $28.125K (cascade_order=2, base TCI + all prior)
      LoadedCost$ = $150K + $25K + $12.5K + $28.125K = $215.625K
    """

    def test_cascade_order_0_uses_raw_base(self):
        """Fringe at cascade_order=0 should use raw direct cost base."""
        # Fringe rate = 25K / 100K = 0.25
        proj = _make_projection(dl=100_000, subk=50_000, fringe_pool=25_000, oh_pool=10_000, ga_pool=22_500)
        cfg = _cascaded_config()
        rates, impacts, _ = compute_rates_and_impacts(proj, cfg)

        # Fringe$ on the project: raw TL ($100K) * 0.25 = $25K
        fringe_dollars = impacts["Fringe$"].iloc[0]
        assert fringe_dollars == pytest.approx(25_000.0, rel=1e-6)

    def test_cascade_order_1_includes_prior_indirect(self):
        """OH at cascade_order=1 should include Fringe$ in its base."""
        # OH rate = 10K / 100K = 0.10, Fringe rate = 25K/100K = 0.25
        proj = _make_projection(dl=100_000, subk=50_000, fringe_pool=25_000, oh_pool=10_000, ga_pool=22_500)
        cfg = _cascaded_config()
        rates, impacts, _ = compute_rates_and_impacts(proj, cfg)

        # OH$ should be (DL + Fringe$) * OH_rate = ($100K + $25K) * 0.10 = $12.5K
        oh_dollars = impacts["Overhead$"].iloc[0]
        assert oh_dollars == pytest.approx(12_500.0, rel=1e-6)

    def test_cascade_order_2_includes_all_prior(self):
        """G&A at cascade_order=2 should include both Fringe$ and OH$ in its base."""
        # G&A rate = 22.5K / 150K = 0.15
        proj = _make_projection(dl=100_000, subk=50_000, fringe_pool=25_000, oh_pool=10_000, ga_pool=22_500)
        cfg = _cascaded_config()
        rates, impacts, _ = compute_rates_and_impacts(proj, cfg)

        # G&A$ should be (TCI + Fringe$ + OH$) * G&A_rate
        # = ($150K + $25K + $12.5K) * 0.15 = $187.5K * 0.15 = $28,125
        ga_dollars = impacts["G&A$"].iloc[0]
        assert ga_dollars == pytest.approx(28_125.0, rel=1e-6)

    def test_loaded_cost_cascaded(self):
        """LoadedCost$ with cascading should be TCI + all indirect $."""
        proj = _make_projection(dl=100_000, subk=50_000, fringe_pool=25_000, oh_pool=10_000, ga_pool=22_500)
        cfg = _cascaded_config()
        rates, impacts, _ = compute_rates_and_impacts(proj, cfg)

        loaded = impacts["LoadedCost$"].iloc[0]
        # $150K + $25K + $12.5K + $28.125K = $215.625K
        assert loaded == pytest.approx(215_625.0, rel=1e-6)

    def test_flat_vs_cascaded_difference(self):
        """Flat (all cascade_order=0) should give lower loaded costs than cascaded."""
        proj = _make_projection(dl=100_000, subk=50_000, fringe_pool=25_000, oh_pool=10_000, ga_pool=22_500)

        _, impacts_flat, _ = compute_rates_and_impacts(proj, _flat_config())
        _, impacts_cascade, _ = compute_rates_and_impacts(proj, _cascaded_config())

        flat_loaded = impacts_flat["LoadedCost$"].iloc[0]
        cascade_loaded = impacts_cascade["LoadedCost$"].iloc[0]

        # Flat: Fringe$=25K, OH$=10K, G&A$=22.5K → Loaded=207.5K
        assert flat_loaded == pytest.approx(207_500.0, rel=1e-6)
        # Cascaded: Fringe$=25K, OH$=12.5K, G&A$=28.125K → Loaded=215.625K
        assert cascade_loaded == pytest.approx(215_625.0, rel=1e-6)
        assert cascade_loaded > flat_loaded

    def test_same_cascade_order_independent(self):
        """Rates at the same cascade_order should NOT include each other's indirect $."""
        cfg = RateConfig(
            base_definitions={"DL": "DirectLabor$", "TL": "DirectLabor$", "TCI": {"sum": ["DirectLabor$", "Subk", "ODC", "Travel"]}},
            rates={
                "PoolA": RateDefinition(pool=["Fringe"], base="DL", cascade_order=0),
                "PoolB": RateDefinition(pool=["Overhead"], base="DL", cascade_order=0),
            },
            unallowable_pool_names=set(),
        )
        proj = _make_projection(dl=100_000, subk=50_000, fringe_pool=20_000, oh_pool=10_000, ga_pool=0)
        rates, impacts, _ = compute_rates_and_impacts(proj, cfg)

        # Both at cascade_order=0, so both use raw DL=$100K
        # PoolA rate = 20K/100K = 0.20 → PoolA$ = $100K * 0.20 = $20K
        # PoolB rate = 10K/100K = 0.10 → PoolB$ = $100K * 0.10 = $10K (NOT $120K * 0.10)
        assert impacts["PoolA$"].iloc[0] == pytest.approx(20_000.0, rel=1e-6)
        assert impacts["PoolB$"].iloc[0] == pytest.approx(10_000.0, rel=1e-6)

    def test_rates_themselves_unchanged(self):
        """Pool-level rates (pool$/base$) should be the same for flat and cascaded.

        Cascading only affects how rates are *applied* to projects (impact$), not the rates themselves.
        """
        proj = _make_projection(dl=100_000, subk=50_000, fringe_pool=25_000, oh_pool=10_000, ga_pool=22_500)

        rates_flat, _, _ = compute_rates_and_impacts(proj, _flat_config())
        rates_cascade, _, _ = compute_rates_and_impacts(proj, _cascaded_config())

        for rate_name in ["Fringe", "Overhead", "G&A"]:
            assert rates_flat[rate_name].iloc[0] == pytest.approx(
                rates_cascade[rate_name].iloc[0], rel=1e-6
            ), f"Rate {rate_name} should be identical for flat and cascaded"
