"""FastAPI APIRouter with CRUD endpoints for pool setup, rates, revenue, and cost categories."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import db

router = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DB_PATH = db.DEFAULT_DB_PATH


def _conn():
    return db.get_connection(DB_PATH)


def _404(item: str):
    raise HTTPException(status_code=404, detail=f"{item} not found")


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------

class FiscalYearCreate(BaseModel):
    name: str
    start_month: str
    end_month: str


class RateGroupCreate(BaseModel):
    name: str
    display_order: int = 0


class RateGroupUpdate(BaseModel):
    name: str | None = None
    display_order: int | None = None


class PoolGroupCreate(BaseModel):
    name: str
    base: str = "DL"
    display_order: int = 0
    rate_group_id: int | None = None
    cascade_order: int = 0


class PoolGroupUpdate(BaseModel):
    name: str | None = None
    base: str | None = None
    display_order: int | None = None
    rate_group_id: int | None = None
    cascade_order: int | None = None


class PoolCreate(BaseModel):
    name: str
    display_order: int = 0


class PoolUpdate(BaseModel):
    name: str | None = None
    display_order: int | None = None


class GLMappingCreate(BaseModel):
    account: str
    is_unallowable: bool = False
    notes: str = ""


class ReferenceRateUpsert(BaseModel):
    rate_type: str  # budget, provisional, forward_pricing
    pool_group_name: str
    period: str
    rate_value: float


class RevenueUpsert(BaseModel):
    period: str
    project: str
    revenue: float


class CostCategoryCreate(BaseModel):
    category_type: str
    category_name: str
    gl_account: str = ""
    is_direct: bool = True


class CostCategoryUpdate(BaseModel):
    category_name: str | None = None
    gl_account: str | None = None
    is_direct: bool | None = None


class CopyFYSetup(BaseModel):
    source_fy_id: int


class ChartAccountCreate(BaseModel):
    account: str
    name: str = ""
    category: str = ""


class ChartAccountBulk(BaseModel):
    accounts: list[ChartAccountCreate]


class BaseAccountCreate(BaseModel):
    account: str
    notes: str = ""


# ---------------------------------------------------------------------------
# Fiscal Years
# ---------------------------------------------------------------------------

@router.get("/fiscal-years")
def list_fiscal_years():
    conn = _conn()
    try:
        return db.list_fiscal_years(conn)
    finally:
        conn.close()


@router.post("/fiscal-years", status_code=201)
def create_fiscal_year(body: FiscalYearCreate):
    conn = _conn()
    try:
        fy_id = db.create_fiscal_year(conn, body.name, body.start_month, body.end_month)
        return {"id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.get("/fiscal-years/{fy_id}")
def get_fiscal_year(fy_id: int):
    conn = _conn()
    try:
        fy = db.get_fiscal_year(conn, fy_id)
        if not fy:
            _404("Fiscal year")
        return fy
    finally:
        conn.close()


@router.delete("/fiscal-years/{fy_id}")
def delete_fiscal_year(fy_id: int):
    conn = _conn()
    try:
        if not db.delete_fiscal_year(conn, fy_id):
            _404("Fiscal year")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Copy FY Setup
# ---------------------------------------------------------------------------

@router.post("/fiscal-years/{fy_id}/copy-setup", status_code=201)
def copy_fy_setup(fy_id: int, body: CopyFYSetup):
    conn = _conn()
    try:
        # Verify both FYs exist
        target = db.get_fiscal_year(conn, fy_id)
        if not target:
            _404("Target fiscal year")
        source = db.get_fiscal_year(conn, body.source_fy_id)
        if not source:
            _404("Source fiscal year")
        counts = db.copy_fy_setup(conn, body.source_fy_id, fy_id)
        return {"ok": True, "source": source["name"], "target": target["name"], **counts}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Rate Groups
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/rate-groups")
def list_rate_groups(fy_id: int):
    conn = _conn()
    try:
        return db.list_rate_groups(conn, fy_id)
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/rate-groups", status_code=201)
def create_rate_group(fy_id: int, body: RateGroupCreate):
    conn = _conn()
    try:
        rg_id = db.create_rate_group(conn, fy_id, body.name, body.display_order)
        return {"id": rg_id, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.put("/rate-groups/{rg_id}")
def update_rate_group(rg_id: int, body: RateGroupUpdate):
    conn = _conn()
    try:
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        if not db.update_rate_group(conn, rg_id, **updates):
            _404("Rate group")
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/rate-groups/{rg_id}")
def delete_rate_group(rg_id: int):
    conn = _conn()
    try:
        if not db.delete_rate_group(conn, rg_id):
            _404("Rate group")
        return {"ok": True}
    finally:
        conn.close()


@router.get("/rate-groups/{rg_id}/pool-groups")
def list_pool_groups_by_rate_group(rg_id: int):
    conn = _conn()
    try:
        # Look up the rate group to get its fiscal_year_id
        row = conn.execute("SELECT fiscal_year_id FROM rate_groups WHERE id = ?", (rg_id,)).fetchone()
        if not row:
            _404("Rate group")
        return db.list_pool_groups(conn, row["fiscal_year_id"], rate_group_id=rg_id)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Pool Groups
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/pool-groups")
def list_pool_groups(fy_id: int):
    conn = _conn()
    try:
        return db.list_pool_groups(conn, fy_id)
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/pool-groups", status_code=201)
def create_pool_group(fy_id: int, body: PoolGroupCreate):
    conn = _conn()
    try:
        pg_id = db.create_pool_group(
            conn, fy_id, body.name, body.base, body.display_order,
            rate_group_id=body.rate_group_id, cascade_order=body.cascade_order,
        )
        return {"id": pg_id, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.put("/pool-groups/{pg_id}")
def update_pool_group(pg_id: int, body: PoolGroupUpdate):
    conn = _conn()
    try:
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        if not db.update_pool_group(conn, pg_id, **updates):
            _404("Pool group")
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/pool-groups/{pg_id}")
def delete_pool_group(pg_id: int):
    conn = _conn()
    try:
        if not db.delete_pool_group(conn, pg_id):
            _404("Pool group")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Pools
# ---------------------------------------------------------------------------

@router.get("/pool-groups/{pg_id}/pools")
def list_pools(pg_id: int):
    conn = _conn()
    try:
        return db.list_pools(conn, pg_id)
    finally:
        conn.close()


@router.post("/pool-groups/{pg_id}/pools", status_code=201)
def create_pool(pg_id: int, body: PoolCreate):
    conn = _conn()
    try:
        pool_id = db.create_pool(conn, pg_id, body.name, body.display_order)
        return {"id": pool_id, "pool_group_id": pg_id, **body.model_dump()}
    finally:
        conn.close()


@router.put("/pools/{pool_id}")
def update_pool(pool_id: int, body: PoolUpdate):
    conn = _conn()
    try:
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        if not db.update_pool(conn, pool_id, **updates):
            _404("Pool")
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/pools/{pool_id}")
def delete_pool(pool_id: int):
    conn = _conn()
    try:
        if not db.delete_pool(conn, pool_id):
            _404("Pool")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# GL Account Mappings
# ---------------------------------------------------------------------------

@router.get("/pools/{pool_id}/gl-mappings")
def list_gl_mappings(pool_id: int):
    conn = _conn()
    try:
        return db.list_gl_mappings(conn, pool_id)
    finally:
        conn.close()


@router.post("/pools/{pool_id}/gl-mappings", status_code=201)
def create_gl_mapping(pool_id: int, body: GLMappingCreate):
    conn = _conn()
    try:
        conflict = db.check_cost_account_conflict(conn, pool_id, body.account)
        if conflict:
            rg_label = conflict["rate_group"] or "this rate structure"
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Account {conflict['account']} is already assigned as a cost account "
                    f"in pool \"{conflict['existing_pool']}\" (pool group \"{conflict['existing_pool_group']}\") "
                    f"within rate group \"{rg_label}\". "
                    f"A cost account can only appear in the numerator of one pool within a rate structure group."
                ),
            )
        m_id = db.create_gl_mapping(conn, pool_id, body.account, body.is_unallowable, body.notes)
        return {"id": m_id, "pool_id": pool_id, **body.model_dump()}
    finally:
        conn.close()


@router.delete("/gl-mappings/{mapping_id}")
def delete_gl_mapping(mapping_id: int):
    conn = _conn()
    try:
        if not db.delete_gl_mapping(conn, mapping_id):
            _404("GL mapping")
        return {"ok": True}
    finally:
        conn.close()


@router.get("/fiscal-years/{fy_id}/unassigned-accounts")
def get_unassigned_accounts(fy_id: int):
    conn = _conn()
    try:
        return db.get_unassigned_accounts(conn, fy_id)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Reference Rates (Budget / Provisional / Forward Pricing)
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/reference-rates")
def list_reference_rates(fy_id: int, rate_type: str | None = None):
    conn = _conn()
    try:
        return db.list_reference_rates(conn, fy_id, rate_type)
    finally:
        conn.close()


@router.put("/fiscal-years/{fy_id}/reference-rates")
def upsert_reference_rate(fy_id: int, body: ReferenceRateUpsert):
    conn = _conn()
    try:
        rid = db.upsert_reference_rate(
            conn, fy_id, body.rate_type, body.pool_group_name, body.period, body.rate_value
        )
        return {"id": rid, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.put("/fiscal-years/{fy_id}/reference-rates/bulk")
def bulk_upsert_reference_rates(fy_id: int, body: list[ReferenceRateUpsert]):
    conn = _conn()
    try:
        ids = []
        for item in body:
            rid = db.upsert_reference_rate(
                conn, fy_id, item.rate_type, item.pool_group_name, item.period, item.rate_value
            )
            ids.append(rid)
        return {"ids": ids}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Revenue
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/revenue")
def list_revenue(fy_id: int, project: str | None = None):
    conn = _conn()
    try:
        return db.list_revenue(conn, fy_id, project)
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/revenue", status_code=201)
def upsert_revenue(fy_id: int, body: RevenueUpsert):
    conn = _conn()
    try:
        rid = db.upsert_revenue(conn, fy_id, body.period, body.project, body.revenue)
        return {"id": rid, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/revenue/import", status_code=201)
def import_revenue(fy_id: int, body: list[RevenueUpsert]):
    conn = _conn()
    try:
        ids = []
        for item in body:
            rid = db.upsert_revenue(conn, fy_id, item.period, item.project, item.revenue)
            ids.append(rid)
        return {"imported": len(ids)}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Cost Category Mappings
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/cost-categories")
def list_cost_categories(fy_id: int, category_type: str | None = None):
    conn = _conn()
    try:
        return db.list_cost_categories(conn, fy_id, category_type)
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/cost-categories", status_code=201)
def create_cost_category(fy_id: int, body: CostCategoryCreate):
    conn = _conn()
    try:
        cc_id = db.create_cost_category(
            conn, fy_id, body.category_type, body.category_name, body.gl_account, body.is_direct
        )
        return {"id": cc_id, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.put("/cost-categories/{cc_id}")
def update_cost_category(cc_id: int, body: CostCategoryUpdate):
    conn = _conn()
    try:
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        if not db.update_cost_category(conn, cc_id, **updates):
            _404("Cost category")
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/cost-categories/{cc_id}")
def delete_cost_category(cc_id: int):
    conn = _conn()
    try:
        if not db.delete_cost_category(conn, cc_id):
            _404("Cost category")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Chart of Accounts
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/chart-of-accounts")
def list_chart_of_accounts(fy_id: int):
    conn = _conn()
    try:
        return db.list_chart_of_accounts(conn, fy_id)
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/chart-of-accounts", status_code=201)
def create_chart_account(fy_id: int, body: ChartAccountCreate):
    conn = _conn()
    try:
        ca_id = db.create_chart_account(conn, fy_id, body.account, body.name, body.category)
        return {"id": ca_id, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/chart-of-accounts/bulk", status_code=201)
def bulk_create_chart_accounts(fy_id: int, body: ChartAccountBulk):
    conn = _conn()
    try:
        ids = db.bulk_create_chart_accounts(conn, fy_id, [a.model_dump() for a in body.accounts])
        return {"ids": ids, "imported": len(ids)}
    finally:
        conn.close()


@router.delete("/chart-of-accounts/{ca_id}")
def delete_chart_account(ca_id: int):
    conn = _conn()
    try:
        if not db.delete_chart_account(conn, ca_id):
            _404("Chart account")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Pool Group Base Accounts
# ---------------------------------------------------------------------------

@router.get("/pool-groups/{pg_id}/base-accounts")
def list_base_accounts(pg_id: int):
    conn = _conn()
    try:
        return db.list_base_accounts(conn, pg_id)
    finally:
        conn.close()


@router.post("/pool-groups/{pg_id}/base-accounts", status_code=201)
def create_base_account(pg_id: int, body: BaseAccountCreate):
    conn = _conn()
    try:
        ba_id = db.create_base_account(conn, pg_id, body.account, body.notes)
        return {"id": ba_id, "pool_group_id": pg_id, **body.model_dump()}
    finally:
        conn.close()


@router.delete("/base-accounts/{ba_id}")
def delete_base_account(ba_id: int):
    conn = _conn()
    try:
        if not db.delete_base_account(conn, ba_id):
            _404("Base account")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Available Accounts (for shuttle UI)
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/available-cost-accounts")
def get_available_cost_accounts(fy_id: int):
    conn = _conn()
    try:
        return db.get_available_cost_accounts(conn, fy_id)
    finally:
        conn.close()


@router.get("/fiscal-years/{fy_id}/available-base-accounts")
def get_available_base_accounts(fy_id: int):
    conn = _conn()
    try:
        return db.get_available_base_accounts(conn, fy_id)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Seed / Clear Test Data
# ---------------------------------------------------------------------------

@router.post("/seed-test-data", status_code=201)
def seed_test_data(data_dir: str = "data_test"):
    from .seed import seed_test_data as _seed
    conn = _conn()
    try:
        result = _seed(conn, Path(data_dir))
        if "error" in result:
            raise HTTPException(status_code=409, detail=result["error"])
        return result
    finally:
        conn.close()


@router.delete("/seed-test-data")
def clear_test_data(data_dir: str = "data_test"):
    from .seed import clear_test_data as _clear
    conn = _conn()
    try:
        return _clear(conn, Path(data_dir))
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Rates Table (comparison view)
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/rates-table")
def get_rates_table(
    fy_id: int,
    scenario: str = "Base",
    forecast_months: int = 12,
    run_rate_months: int = 3,
    input_dir: str | None = None,
):
    """Return rates comparison data: Actual vs YTD vs Budget vs Provisional."""
    from .agents import AnalystAgent, PlannerAgent
    from .config import RateConfig, default_rate_config
    from .ytd import compute_ytd_rates, build_rates_comparison_table

    conn = _conn()
    try:
        fy = db.get_fiscal_year(conn, fy_id)
        if not fy:
            _404("Fiscal year")

        # Try DB config first, fall back to default
        raw_config = db.build_rate_config_from_db(conn, fy_id)
        if raw_config["rates"]:
            cfg = RateConfig.from_mapping(raw_config)
        else:
            cfg = default_rate_config()

        # Load reference rates
        ref_rates = db.list_reference_rates(conn, fy_id)
        budget_rates: dict[str, dict[str, float]] = {}
        prov_rates: dict[str, dict[str, float]] = {}
        for rr in ref_rates:
            target = budget_rates if rr["rate_type"] == "budget" else prov_rates if rr["rate_type"] == "provisional" else None
            if target is not None:
                target.setdefault(rr["pool_group_name"], {})[rr["period"]] = rr["rate_value"]
    finally:
        conn.close()

    if not input_dir:
        raise HTTPException(status_code=400, detail="input_dir is required")

    input_path = Path(input_dir)
    if not input_path.exists():
        raise HTTPException(status_code=400, detail=f"Input directory not found: {input_dir}")

    import pandas as pd

    plan = PlannerAgent().plan(
        scenario=scenario,
        forecast_months=forecast_months,
        run_rate_months=run_rate_months,
        events_path=input_path / "Scenario_Events.csv",
    )
    results = AnalystAgent().run(input_dir=input_path, config=cfg, plan=plan)
    result = next((r for r in results if r.scenario == scenario), results[0])

    fy_start = pd.Period(fy["start_month"], freq="M")
    rate_defs = {name: {"pool": rd.pool, "base": rd.base} for name, rd in cfg.rates.items()}
    ytd = compute_ytd_rates(result.pools, result.bases, rate_defs, fy_start)

    rate_names = list(cfg.rates.keys())
    comparison = build_rates_comparison_table(
        result.rates, ytd, budget_rates, prov_rates, rate_names
    )

    # Convert to JSON-serializable format
    output: dict[str, Any] = {}
    for rate_name, table_df in comparison.items():
        output[rate_name] = {
            "periods": list(table_df.columns),
            "rows": {row_name: [float(v) for v in table_df.loc[row_name]] for row_name in table_df.index},
        }
    return output


# ---------------------------------------------------------------------------
# Project Status Report
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/psr")
def get_psr(
    fy_id: int,
    scenario: str = "Base",
    forecast_months: int = 12,
    run_rate_months: int = 3,
    input_dir: str | None = None,
):
    """Return Project Status Report: profitability per project with indirect allocation."""
    from .agents import AnalystAgent, PlannerAgent
    from .config import RateConfig, default_rate_config
    from .psr import build_psr, build_psr_summary

    conn = _conn()
    try:
        fy = db.get_fiscal_year(conn, fy_id)
        if not fy:
            _404("Fiscal year")

        # Rate config from DB or default
        raw_config = db.build_rate_config_from_db(conn, fy_id)
        if raw_config["rates"]:
            cfg = RateConfig.from_mapping(raw_config)
        else:
            cfg = default_rate_config()

        # Load revenue data
        revenue_data = db.list_revenue(conn, fy_id)
    finally:
        conn.close()

    if not input_dir:
        raise HTTPException(status_code=400, detail="input_dir is required")

    input_path = Path(input_dir)
    if not input_path.exists():
        raise HTTPException(status_code=400, detail=f"Input directory not found: {input_dir}")

    plan = PlannerAgent().plan(
        scenario=scenario,
        forecast_months=forecast_months,
        run_rate_months=run_rate_months,
        events_path=input_path / "Scenario_Events.csv",
    )
    results = AnalystAgent().run(input_dir=input_path, config=cfg, plan=plan)
    result = next((r for r in results if r.scenario == scenario), results[0])

    psr = build_psr(result.project_impacts, revenue_data)
    summary = build_psr_summary(psr)

    # Convert to JSON-serializable
    detail_records = []
    for _, row in psr.iterrows():
        detail_records.append({
            "period": str(row["Period"]),
            "project": str(row["Project"]),
            "direct_cost": round(float(row["DirectCost"]), 2),
            "indirect_cost": round(float(row["IndirectCost"]), 2),
            "total_cost": round(float(row["TotalCost"]), 2),
            "revenue": round(float(row["Revenue"]), 2),
            "fee": round(float(row["Fee"]), 2),
            "margin_pct": round(float(row["Margin%"]), 4),
        })

    summary_records = []
    for _, row in summary.iterrows():
        summary_records.append({
            "project": str(row["Project"]),
            "direct_cost": round(float(row["DirectCost"]), 2),
            "indirect_cost": round(float(row["IndirectCost"]), 2),
            "total_cost": round(float(row["TotalCost"]), 2),
            "revenue": round(float(row["Revenue"]), 2),
            "fee": round(float(row["Fee"]), 2),
            "margin_pct": round(float(row["Margin%"]), 4),
        })

    return {
        "detail": detail_records,
        "summary": summary_records,
        "projects": sorted(psr["Project"].unique().tolist()),
        "periods": sorted(psr["Period"].unique().tolist()),
    }


# ---------------------------------------------------------------------------
# DB-based Forecast (runs existing engine with DB config)
# ---------------------------------------------------------------------------

@router.post("/fiscal-years/{fy_id}/forecast")
def forecast_from_db(
    fy_id: int,
    scenario: str | None = None,
    forecast_months: int = 12,
    run_rate_months: int = 3,
    input_dir: str | None = None,
):
    """Run forecast using pool config from DB. Still requires CSV inputs (via input_dir or prior upload)."""
    from .agents import AnalystAgent, PlannerAgent, ReporterAgent
    from .config import RateConfig

    conn = _conn()
    try:
        fy = db.get_fiscal_year(conn, fy_id)
        if not fy:
            _404("Fiscal year")

        raw_config = db.build_rate_config_from_db(conn, fy_id)
        if not raw_config["rates"]:
            raise HTTPException(status_code=400, detail="No pool groups configured for this fiscal year")

        cfg = RateConfig.from_mapping(raw_config)
    finally:
        conn.close()

    # For now, require input_dir to be provided
    if not input_dir:
        raise HTTPException(status_code=400, detail="input_dir is required for DB-based forecast")

    import io as _io
    import tempfile
    import zipfile

    input_path = Path(input_dir)
    if not input_path.exists():
        raise HTTPException(status_code=400, detail=f"Input directory not found: {input_dir}")

    plan = PlannerAgent().plan(
        scenario=scenario,
        forecast_months=forecast_months,
        run_rate_months=run_rate_months,
        events_path=input_path / "Scenario_Events.csv",
    )
    results = AnalystAgent().run(input_dir=input_path, config=cfg, plan=plan)

    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp) / "out"
        ReporterAgent().package(out_dir=out_dir, results=results)

        buf = _io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for path in out_dir.rglob("*"):
                if path.is_file():
                    zf.write(path, arcname=str(path.relative_to(out_dir)))

        from fastapi.responses import Response
        return Response(
            content=buf.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="rate_pack_output.zip"'},
        )
