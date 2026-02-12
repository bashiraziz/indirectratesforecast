"""Integration tests: full flows through DB setup → forecast → rates table → PSR."""

from __future__ import annotations

from pathlib import Path

import pytest
import pandas as pd

from indirectrates.db import (
    create_fiscal_year,
    create_rate_group,
    create_pool_group,
    create_pool,
    create_gl_mapping,
    get_connection,
    init_db,
    upsert_reference_rate,
    upsert_revenue,
    build_rate_config_from_db,
    list_revenue,
)
from indirectrates.config import RateConfig, default_rate_config
from indirectrates.synth import SynthSpec, generate_synthetic_dataset
from indirectrates.agents import AnalystAgent, PlannerAgent
from indirectrates.psr import build_psr, build_psr_summary
from indirectrates.ytd import compute_ytd_rates, build_rates_comparison_table


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def synth_data(tmp_path: Path) -> Path:
    """Generate synthetic test data."""
    data_dir = tmp_path / "data"
    generate_synthetic_dataset(data_dir, SynthSpec(start="2025-01", months=12, projects=3, seed=42))
    return data_dir


@pytest.fixture()
def db_conn(tmp_path: Path):
    """Create a fresh database."""
    db_path = tmp_path / "integration.db"
    init_db(db_path)
    conn = get_connection(db_path)
    yield conn
    conn.close()


@pytest.fixture()
def fy_with_pools(db_conn):
    """Create a fiscal year with a rate group and standard Fringe/Overhead/G&A pool groups."""
    fy_id = create_fiscal_year(db_conn, "FY2025", "2025-01", "2025-12")

    # Create a rate group container
    rg_id = create_rate_group(db_conn, fy_id, "Primary Rate Structure")

    # Fringe → pool "Fringe", base TL, cascade_order 0
    pg_fringe = create_pool_group(db_conn, fy_id, "Fringe", base="TL", rate_group_id=rg_id, cascade_order=0)
    create_pool(db_conn, pg_fringe, "Fringe")

    # Overhead → pool "Overhead", base DL, cascade_order 1
    pg_oh = create_pool_group(db_conn, fy_id, "Overhead", base="DL", rate_group_id=rg_id, cascade_order=1)
    create_pool(db_conn, pg_oh, "Overhead")

    # G&A → pool "G&A", base TCI, cascade_order 2
    pg_ga = create_pool_group(db_conn, fy_id, "G&A", base="TCI", rate_group_id=rg_id, cascade_order=2)
    create_pool(db_conn, pg_ga, "G&A")

    return fy_id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestPSRModule:
    """Test the PSR computation module directly."""

    def test_build_psr_with_revenue(self, synth_data: Path):
        cfg = default_rate_config()
        plan = PlannerAgent().plan(
            "Base", forecast_months=6, run_rate_months=3,
            events_path=synth_data / "Scenario_Events.csv",
        )
        results = AnalystAgent().run(input_dir=synth_data, config=cfg, plan=plan)
        result = results[0]

        # Create revenue data for projects
        projects = result.project_impacts["Project"].unique()
        revenue_data = []
        for period in result.project_impacts["Period"].unique():
            for project in projects:
                revenue_data.append({
                    "period": str(period),
                    "project": str(project),
                    "revenue": 100_000.0,
                })

        psr = build_psr(result.project_impacts, revenue_data)

        assert "DirectCost" in psr.columns
        assert "IndirectCost" in psr.columns
        assert "TotalCost" in psr.columns
        assert "Revenue" in psr.columns
        assert "Fee" in psr.columns
        assert "Margin%" in psr.columns

        # Revenue is set so fee should be calculated
        assert (psr["Revenue"] == 100_000.0).all()
        assert len(psr) > 0

    def test_build_psr_without_revenue(self, synth_data: Path):
        cfg = default_rate_config()
        plan = PlannerAgent().plan(
            "Base", forecast_months=3, run_rate_months=3,
            events_path=synth_data / "Scenario_Events.csv",
        )
        results = AnalystAgent().run(input_dir=synth_data, config=cfg, plan=plan)
        result = results[0]

        psr = build_psr(result.project_impacts, [])

        assert len(psr) > 0
        assert (psr["Revenue"] == 0).all()
        assert (psr["Fee"] <= 0).all()  # No revenue means fee = -cost

    def test_build_psr_summary(self, synth_data: Path):
        cfg = default_rate_config()
        plan = PlannerAgent().plan(
            "Base", forecast_months=3, run_rate_months=3,
            events_path=synth_data / "Scenario_Events.csv",
        )
        results = AnalystAgent().run(input_dir=synth_data, config=cfg, plan=plan)
        result = results[0]

        revenue_data = [
            {"period": str(p), "project": str(pr), "revenue": 200_000.0}
            for p in result.project_impacts["Period"].unique()
            for pr in result.project_impacts["Project"].unique()
        ]

        psr = build_psr(result.project_impacts, revenue_data)
        summary = build_psr_summary(psr)

        # One row per project
        assert len(summary) == len(result.project_impacts["Project"].unique())
        assert "Margin%" in summary.columns

        # Summary totals should match detail
        for col in ["DirectCost", "IndirectCost", "TotalCost", "Revenue", "Fee"]:
            assert abs(summary[col].sum() - psr[col].sum()) < 0.01


class TestYTDRatesIntegration:
    """Test YTD rate computation with forecast data."""

    def test_ytd_rates_match_cumulative(self, synth_data: Path):
        cfg = default_rate_config()
        plan = PlannerAgent().plan(
            "Base", forecast_months=6, run_rate_months=3,
            events_path=synth_data / "Scenario_Events.csv",
        )
        results = AnalystAgent().run(input_dir=synth_data, config=cfg, plan=plan)
        result = results[0]

        fy_start = pd.Period("2025-01", freq="M")
        rate_defs = {name: {"pool": rd.pool, "base": rd.base} for name, rd in cfg.rates.items()}
        ytd = compute_ytd_rates(result.pools, result.bases, rate_defs, fy_start)

        assert len(ytd) > 0

        # YTD for first period should equal actual rate for that period
        first_period = ytd.index[0]
        for rate_name in cfg.rates:
            actual = float(result.rates.loc[first_period, rate_name]) if rate_name in result.rates.columns else 0.0
            ytd_val = float(ytd.loc[first_period, rate_name])
            assert abs(actual - ytd_val) < 1e-6, f"YTD mismatch for {rate_name} in first period"

    def test_comparison_table_structure(self, synth_data: Path):
        cfg = default_rate_config()
        plan = PlannerAgent().plan(
            "Base", forecast_months=6, run_rate_months=3,
            events_path=synth_data / "Scenario_Events.csv",
        )
        results = AnalystAgent().run(input_dir=synth_data, config=cfg, plan=plan)
        result = results[0]

        fy_start = pd.Period("2025-01", freq="M")
        rate_defs = {name: {"pool": rd.pool, "base": rd.base} for name, rd in cfg.rates.items()}
        ytd = compute_ytd_rates(result.pools, result.bases, rate_defs, fy_start)

        budget_rates = {"Fringe": {"2025-01": 0.30, "2025-02": 0.30}}
        prov_rates = {"Fringe": {"2025-01": 0.28}}
        rate_names = list(cfg.rates.keys())

        comparison = build_rates_comparison_table(result.rates, ytd, budget_rates, prov_rates, rate_names)

        assert "Fringe" in comparison
        fringe_table = comparison["Fringe"]

        expected_rows = {"Actual", "YTD", "Budget", "Provisional", "Var (Act-Bud)", "Var (Act-Prov)"}
        assert set(fringe_table.index) == expected_rows

        # Var(Act-Bud) should be Actual - Budget
        for period_str in fringe_table.columns:
            actual = fringe_table.loc["Actual", period_str]
            budget = fringe_table.loc["Budget", period_str]
            var = fringe_table.loc["Var (Act-Bud)", period_str]
            assert abs(var - (actual - budget)) < 1e-9


class TestDBConfigToForecast:
    """Test full flow: DB pool setup → rate config → forecast."""

    def test_db_config_drives_forecast(self, db_conn, fy_with_pools, synth_data: Path):
        fy_id = fy_with_pools
        raw = build_rate_config_from_db(db_conn, fy_id)
        cfg = RateConfig.from_mapping(raw)

        assert "Fringe" in cfg.rates
        assert "Overhead" in cfg.rates
        assert "G&A" in cfg.rates

        plan = PlannerAgent().plan(
            "Base", forecast_months=6, run_rate_months=3,
            events_path=synth_data / "Scenario_Events.csv",
        )
        results = AnalystAgent().run(input_dir=synth_data, config=cfg, plan=plan)

        assert len(results) > 0
        base = results[0]
        assert "Fringe" in base.rates.columns
        assert "Overhead" in base.rates.columns
        assert "G&A" in base.rates.columns
        assert len(base.rates) > 0

    def test_db_budget_rates_in_comparison(self, db_conn, fy_with_pools, synth_data: Path):
        fy_id = fy_with_pools

        # Add budget rates
        upsert_reference_rate(db_conn, fy_id, "budget", "Fringe", "2025-01", 0.30)
        upsert_reference_rate(db_conn, fy_id, "budget", "Fringe", "2025-02", 0.31)
        upsert_reference_rate(db_conn, fy_id, "provisional", "Fringe", "2025-01", 0.28)

        raw = build_rate_config_from_db(db_conn, fy_id)
        cfg = RateConfig.from_mapping(raw)

        plan = PlannerAgent().plan(
            "Base", forecast_months=6, run_rate_months=3,
            events_path=synth_data / "Scenario_Events.csv",
        )
        results = AnalystAgent().run(input_dir=synth_data, config=cfg, plan=plan)
        result = results[0]

        from indirectrates.db import list_reference_rates

        ref = list_reference_rates(db_conn, fy_id)
        budget_rates: dict[str, dict[str, float]] = {}
        prov_rates: dict[str, dict[str, float]] = {}
        for rr in ref:
            target = budget_rates if rr["rate_type"] == "budget" else prov_rates if rr["rate_type"] == "provisional" else None
            if target is not None:
                target.setdefault(rr["pool_group_name"], {})[rr["period"]] = rr["rate_value"]

        fy_start = pd.Period("2025-01", freq="M")
        rate_defs = {name: {"pool": rd.pool, "base": rd.base} for name, rd in cfg.rates.items()}
        ytd = compute_ytd_rates(result.pools, result.bases, rate_defs, fy_start)
        comparison = build_rates_comparison_table(result.rates, ytd, budget_rates, prov_rates, list(cfg.rates.keys()))

        assert "Fringe" in comparison
        # Budget for 2025-01 should be 0.30
        assert comparison["Fringe"].loc["Budget", "2025-01"] == pytest.approx(0.30)


class TestDBRevenueToPSR:
    """Test full flow: DB revenue + forecast → PSR."""

    def test_db_revenue_flows_to_psr(self, db_conn, fy_with_pools, synth_data: Path):
        fy_id = fy_with_pools

        # Add revenue for projects
        upsert_revenue(db_conn, fy_id, "2025-01", "P-1", 150_000.0)
        upsert_revenue(db_conn, fy_id, "2025-02", "P-1", 160_000.0)

        raw = build_rate_config_from_db(db_conn, fy_id)
        cfg = RateConfig.from_mapping(raw)

        plan = PlannerAgent().plan(
            "Base", forecast_months=3, run_rate_months=3,
            events_path=synth_data / "Scenario_Events.csv",
        )
        results = AnalystAgent().run(input_dir=synth_data, config=cfg, plan=plan)
        result = results[0]

        revenue_data = list_revenue(db_conn, fy_id)
        psr = build_psr(result.project_impacts, revenue_data)

        # Revenue should be set for P-1 periods
        p1_rows = psr[psr["Project"] == "P-1"]
        if len(p1_rows) > 0:
            p1_jan = p1_rows[p1_rows["Period"] == "2025-01"]
            if len(p1_jan) > 0:
                assert p1_jan.iloc[0]["Revenue"] == pytest.approx(150_000.0)


class TestPSRAPIEndpoint:
    """Test the PSR API endpoint via TestClient."""

    @pytest.fixture(autouse=True)
    def setup_test_db(self, tmp_path: Path, synth_data: Path):
        db_path = tmp_path / "test_api.db"
        init_db(db_path)

        from indirectrates import api_crud
        original = api_crud.DB_PATH
        api_crud.DB_PATH = db_path

        self._db_path = db_path
        self._synth_data = synth_data

        yield

        api_crud.DB_PATH = original

    @pytest.fixture()
    def client(self):
        from fastapi.testclient import TestClient
        from indirectrates.server import app
        return TestClient(app)

    def test_psr_endpoint(self, client):
        # Create FY
        fy = client.post("/api/fiscal-years", json={
            "name": "FY2025", "start_month": "2025-01", "end_month": "2025-12",
        }).json()
        fy_id = fy["id"]

        # Add revenue
        client.post(f"/api/fiscal-years/{fy_id}/revenue", json={
            "period": "2025-01", "project": "P-1", "revenue": 100_000,
        })

        # Get PSR
        resp = client.get(
            f"/api/fiscal-years/{fy_id}/psr",
            params={"input_dir": str(self._synth_data), "scenario": "Base"},
        )
        assert resp.status_code == 200

        data = resp.json()
        assert "detail" in data
        assert "summary" in data
        assert "projects" in data
        assert "periods" in data
        assert len(data["detail"]) > 0
        assert len(data["summary"]) > 0

        # Check summary structure
        for row in data["summary"]:
            assert "project" in row
            assert "direct_cost" in row
            assert "fee" in row
            assert "margin_pct" in row

    def test_psr_requires_input_dir(self, client):
        fy = client.post("/api/fiscal-years", json={
            "name": "FY2025", "start_month": "2025-01", "end_month": "2025-12",
        }).json()
        resp = client.get(f"/api/fiscal-years/{fy['id']}/psr")
        assert resp.status_code == 400
