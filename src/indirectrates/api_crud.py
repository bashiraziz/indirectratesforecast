"""FastAPI APIRouter with CRUD endpoints for pool setup, rates, revenue, and cost categories."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import csv
import io
import re

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from . import db

router = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _conn():
    return db.get_connection()


def _404(item: str):
    raise HTTPException(status_code=404, detail=f"{item} not found")


def get_current_user(request: Request) -> str | None:
    """Extract user ID from X-User-ID header (set by Next.js middleware)."""
    return request.headers.get("X-User-ID") or None


def require_auth(request: Request) -> str:
    """Raise 401 if no authenticated user."""
    user_id = get_current_user(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


def _check_fy_ownership(conn, fy_id: int, user_id: str | None) -> dict[str, Any]:
    """Return FY or raise 404. If user_id given, also validates ownership."""
    fy = db.get_fiscal_year(conn, fy_id, user_id=user_id)
    if not fy:
        raise HTTPException(status_code=404, detail="Fiscal year not found")
    return fy


def _assert_fy_access(conn, request: Request, fy_id: int) -> tuple[str, dict[str, Any]]:
    user_id = require_auth(request)
    fy = _check_fy_ownership(conn, fy_id, user_id)
    return user_id, fy


def _resource_fy_id(conn, query: str, params: tuple[Any, ...], item: str) -> int:
    with conn.cursor() as cur:
        cur.execute(query, params)
        row = cur.fetchone()
    if not row:
        _404(item)
    fy_id = row["fiscal_year_id"]
    if fy_id is None:
        raise HTTPException(status_code=403, detail=f"{item} is not associated with a fiscal year")
    return int(fy_id)


def _assert_rate_group_access(conn, request: Request, rg_id: int) -> int:
    fy_id = _resource_fy_id(conn, "SELECT fiscal_year_id FROM rate_groups WHERE id = %s", (rg_id,), "Rate group")
    _assert_fy_access(conn, request, fy_id)
    return fy_id


def _assert_pool_group_access(conn, request: Request, pg_id: int) -> int:
    fy_id = _resource_fy_id(conn, "SELECT fiscal_year_id FROM pool_groups WHERE id = %s", (pg_id,), "Pool group")
    _assert_fy_access(conn, request, fy_id)
    return fy_id


def _assert_pool_access(conn, request: Request, pool_id: int) -> int:
    fy_id = _resource_fy_id(
        conn,
        """
        SELECT pg.fiscal_year_id
        FROM pools p
        JOIN pool_groups pg ON p.pool_group_id = pg.id
        WHERE p.id = %s
        """,
        (pool_id,),
        "Pool",
    )
    _assert_fy_access(conn, request, fy_id)
    return fy_id


def _assert_gl_mapping_access(conn, request: Request, mapping_id: int) -> int:
    fy_id = _resource_fy_id(
        conn,
        """
        SELECT pg.fiscal_year_id
        FROM gl_account_mappings gm
        JOIN pools p ON gm.pool_id = p.id
        JOIN pool_groups pg ON p.pool_group_id = pg.id
        WHERE gm.id = %s
        """,
        (mapping_id,),
        "GL mapping",
    )
    _assert_fy_access(conn, request, fy_id)
    return fy_id


def _assert_cost_category_access(conn, request: Request, cc_id: int) -> int:
    fy_id = _resource_fy_id(
        conn,
        "SELECT fiscal_year_id FROM cost_category_mappings WHERE id = %s",
        (cc_id,),
        "Cost category",
    )
    _assert_fy_access(conn, request, fy_id)
    return fy_id


def _assert_chart_account_access(conn, request: Request, ca_id: int) -> int:
    fy_id = _resource_fy_id(
        conn,
        "SELECT fiscal_year_id FROM chart_of_accounts WHERE id = %s",
        (ca_id,),
        "Chart account",
    )
    _assert_fy_access(conn, request, fy_id)
    return fy_id


def _assert_base_account_access(conn, request: Request, ba_id: int) -> int:
    fy_id = _resource_fy_id(
        conn,
        """
        SELECT pg.fiscal_year_id
        FROM pool_group_base_accounts ba
        JOIN pool_groups pg ON ba.pool_group_id = pg.id
        WHERE ba.id = %s
        """,
        (ba_id,),
        "Base account",
    )
    _assert_fy_access(conn, request, fy_id)
    return fy_id


def _assert_scenario_access(conn, request: Request, scenario_id: int) -> int:
    fy_id = _resource_fy_id(
        conn,
        "SELECT fiscal_year_id FROM scenarios WHERE id = %s",
        (scenario_id,),
        "Scenario",
    )
    _assert_fy_access(conn, request, fy_id)
    return fy_id


def _assert_scenario_event_access(conn, request: Request, event_id: int) -> int:
    fy_id = _resource_fy_id(
        conn,
        """
        SELECT s.fiscal_year_id
        FROM scenario_events se
        JOIN scenarios s ON se.scenario_id = s.id
        WHERE se.id = %s
        """,
        (event_id,),
        "Scenario event",
    )
    _assert_fy_access(conn, request, fy_id)
    return fy_id


def _assert_forecast_run_access(conn, request: Request, run_id: int) -> int:
    fy_id = _resource_fy_id(
        conn,
        "SELECT fiscal_year_id FROM forecast_runs WHERE id = %s",
        (run_id,),
        "Forecast run",
    )
    _assert_fy_access(conn, request, fy_id)
    return fy_id


def _assert_uploaded_file_access(conn, request: Request, file_id: int) -> int:
    fy_id = _resource_fy_id(
        conn,
        "SELECT fiscal_year_id FROM uploaded_files WHERE id = %s",
        (file_id,),
        "File",
    )
    _assert_fy_access(conn, request, fy_id)
    return fy_id


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
    rate_type: str
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


class ScenarioCreate(BaseModel):
    name: str
    description: str = ""


class ScenarioUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ScenarioEventCreate(BaseModel):
    effective_period: str
    event_type: str = "ADJUST"
    project: str = ""
    delta_direct_labor: float = 0
    delta_direct_labor_hrs: float = 0
    delta_subk: float = 0
    delta_odc: float = 0
    delta_travel: float = 0
    pool_deltas: dict[str, float] = {}
    notes: str = ""


class ScenarioEventUpdate(BaseModel):
    effective_period: str | None = None
    event_type: str | None = None
    project: str | None = None
    delta_direct_labor: float | None = None
    delta_direct_labor_hrs: float | None = None
    delta_subk: float | None = None
    delta_odc: float | None = None
    delta_travel: float | None = None
    pool_deltas: dict[str, float] | None = None
    notes: str | None = None


# ---------------------------------------------------------------------------
# Dashboard Summary
# ---------------------------------------------------------------------------

@router.get("/dashboard-summary")
def dashboard_summary(request: Request):
    user_id = get_current_user(request)
    conn = _conn()
    try:
        if user_id:
            return db.get_dashboard_summary(conn, user_id=user_id)
        return db.get_dashboard_summary(conn, demo_only=True)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Fiscal Years
# ---------------------------------------------------------------------------

@router.get("/fiscal-years")
def list_fiscal_years(request: Request):
    user_id = require_auth(request)
    conn = _conn()
    try:
        return db.list_fiscal_years(conn, user_id=user_id)
    finally:
        conn.close()


@router.post("/fiscal-years", status_code=201)
def create_fiscal_year(body: FiscalYearCreate, request: Request):
    user_id = require_auth(request)
    conn = _conn()
    try:
        fy_id = db.create_fiscal_year(conn, body.name, body.start_month, body.end_month, user_id=user_id)
        return {"id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.get("/fiscal-years/{fy_id}")
def get_fiscal_year(fy_id: int, request: Request):
    user_id = require_auth(request)
    conn = _conn()
    try:
        fy = db.get_fiscal_year(conn, fy_id, user_id=user_id)
        if not fy:
            _404("Fiscal year")
        return fy
    finally:
        conn.close()


@router.delete("/fiscal-years/{fy_id}")
def delete_fiscal_year(fy_id: int, request: Request):
    user_id = require_auth(request)
    conn = _conn()
    try:
        _check_fy_ownership(conn, fy_id, user_id)
        if not db.delete_fiscal_year(conn, fy_id):
            _404("Fiscal year")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Copy FY Setup
# ---------------------------------------------------------------------------

@router.post("/fiscal-years/{fy_id}/copy-setup", status_code=201)
def copy_fy_setup(fy_id: int, body: CopyFYSetup, request: Request):
    user_id = require_auth(request)
    conn = _conn()
    try:
        target = _check_fy_ownership(conn, fy_id, user_id)
        source = _check_fy_ownership(conn, body.source_fy_id, user_id)
        counts = db.copy_fy_setup(conn, body.source_fy_id, fy_id)
        return {"ok": True, "source": source["name"], "target": target["name"], **counts}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Rate Groups
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/rate-groups")
def list_rate_groups(fy_id: int, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        return db.list_rate_groups(conn, fy_id)
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/rate-groups", status_code=201)
def create_rate_group(fy_id: int, body: RateGroupCreate, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        rg_id = db.create_rate_group(conn, fy_id, body.name, body.display_order)
        return {"id": rg_id, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.put("/rate-groups/{rg_id}")
def update_rate_group(rg_id: int, body: RateGroupUpdate, request: Request):
    conn = _conn()
    try:
        _assert_rate_group_access(conn, request, rg_id)
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        if not db.update_rate_group(conn, rg_id, **updates):
            _404("Rate group")
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/rate-groups/{rg_id}")
def delete_rate_group(rg_id: int, request: Request):
    conn = _conn()
    try:
        _assert_rate_group_access(conn, request, rg_id)
        if not db.delete_rate_group(conn, rg_id):
            _404("Rate group")
        return {"ok": True}
    finally:
        conn.close()


@router.get("/rate-groups/{rg_id}/pool-groups")
def list_pool_groups_by_rate_group(rg_id: int, request: Request):
    conn = _conn()
    try:
        fy_id = _assert_rate_group_access(conn, request, rg_id)
        return db.list_pool_groups(conn, fy_id, rate_group_id=rg_id)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Pool Groups
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/pool-groups")
def list_pool_groups(fy_id: int, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        return db.list_pool_groups(conn, fy_id)
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/pool-groups", status_code=201)
def create_pool_group(fy_id: int, body: PoolGroupCreate, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        if body.rate_group_id is not None:
            rg_fy_id = _assert_rate_group_access(conn, request, body.rate_group_id)
            if rg_fy_id != fy_id:
                raise HTTPException(status_code=400, detail="rate_group_id must belong to the same fiscal year")
        pg_id = db.create_pool_group(
            conn, fy_id, body.name, body.base, body.display_order,
            rate_group_id=body.rate_group_id, cascade_order=body.cascade_order,
        )
        return {"id": pg_id, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.put("/pool-groups/{pg_id}")
def update_pool_group(pg_id: int, body: PoolGroupUpdate, request: Request):
    conn = _conn()
    try:
        fy_id = _assert_pool_group_access(conn, request, pg_id)
        if body.rate_group_id is not None:
            rg_fy_id = _assert_rate_group_access(conn, request, body.rate_group_id)
            if rg_fy_id != fy_id:
                raise HTTPException(status_code=400, detail="rate_group_id must belong to the same fiscal year")
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        if not db.update_pool_group(conn, pg_id, **updates):
            _404("Pool group")
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/pool-groups/{pg_id}")
def delete_pool_group(pg_id: int, request: Request):
    conn = _conn()
    try:
        _assert_pool_group_access(conn, request, pg_id)
        if not db.delete_pool_group(conn, pg_id):
            _404("Pool group")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Pools
# ---------------------------------------------------------------------------

@router.get("/pool-groups/{pg_id}/pools")
def list_pools(pg_id: int, request: Request):
    conn = _conn()
    try:
        _assert_pool_group_access(conn, request, pg_id)
        return db.list_pools(conn, pg_id)
    finally:
        conn.close()


@router.post("/pool-groups/{pg_id}/pools", status_code=201)
def create_pool(pg_id: int, body: PoolCreate, request: Request):
    conn = _conn()
    try:
        _assert_pool_group_access(conn, request, pg_id)
        pool_id = db.create_pool(conn, pg_id, body.name, body.display_order)
        return {"id": pool_id, "pool_group_id": pg_id, **body.model_dump()}
    finally:
        conn.close()


@router.put("/pools/{pool_id}")
def update_pool(pool_id: int, body: PoolUpdate, request: Request):
    conn = _conn()
    try:
        _assert_pool_access(conn, request, pool_id)
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        if not db.update_pool(conn, pool_id, **updates):
            _404("Pool")
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/pools/{pool_id}")
def delete_pool(pool_id: int, request: Request):
    conn = _conn()
    try:
        _assert_pool_access(conn, request, pool_id)
        if not db.delete_pool(conn, pool_id):
            _404("Pool")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# GL Account Mappings
# ---------------------------------------------------------------------------

@router.get("/pools/{pool_id}/gl-mappings")
def list_gl_mappings(pool_id: int, request: Request):
    conn = _conn()
    try:
        _assert_pool_access(conn, request, pool_id)
        return db.list_gl_mappings(conn, pool_id)
    finally:
        conn.close()


@router.post("/pools/{pool_id}/gl-mappings", status_code=201)
def create_gl_mapping(pool_id: int, body: GLMappingCreate, request: Request):
    conn = _conn()
    try:
        _assert_pool_access(conn, request, pool_id)
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
def delete_gl_mapping(mapping_id: int, request: Request):
    conn = _conn()
    try:
        _assert_gl_mapping_access(conn, request, mapping_id)
        if not db.delete_gl_mapping(conn, mapping_id):
            _404("GL mapping")
        return {"ok": True}
    finally:
        conn.close()


@router.get("/fiscal-years/{fy_id}/unassigned-accounts")
def get_unassigned_accounts(fy_id: int, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        return db.get_unassigned_accounts(conn, fy_id)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Reference Rates (Budget / Provisional / Forward Pricing)
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/reference-rates")
def list_reference_rates(fy_id: int, request: Request, rate_type: str | None = None):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        return db.list_reference_rates(conn, fy_id, rate_type)
    finally:
        conn.close()


@router.put("/fiscal-years/{fy_id}/reference-rates")
def upsert_reference_rate(fy_id: int, body: ReferenceRateUpsert, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        rid = db.upsert_reference_rate(
            conn, fy_id, body.rate_type, body.pool_group_name, body.period, body.rate_value
        )
        return {"id": rid, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.put("/fiscal-years/{fy_id}/reference-rates/bulk")
def bulk_upsert_reference_rates(fy_id: int, body: list[ReferenceRateUpsert], request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        ids = []
        for item in body:
            rid = db.upsert_reference_rate(
                conn, fy_id, item.rate_type, item.pool_group_name, item.period, item.rate_value
            )
            ids.append(rid)
        return {"ids": ids}
    finally:
        conn.close()


_VALID_RATE_TYPES = {"budget", "provisional", "threshold", "forward_pricing"}
_PERIOD_RE = re.compile(r"^\d{4}-(?:0[1-9]|1[0-2])$")


@router.post("/fiscal-years/{fy_id}/reference-rates/upload", status_code=201)
async def upload_reference_rates(fy_id: int, request: Request, file: UploadFile = File(...)):
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))

    required_cols = {"pool_group_name", "period", "rate_type", "rate_value"}
    if not reader.fieldnames or not required_cols.issubset(set(reader.fieldnames)):
        missing = required_cols - set(reader.fieldnames or [])
        raise HTTPException(status_code=400, detail=f"Missing required columns: {', '.join(sorted(missing))}")

    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        pgs = db.list_pool_groups(conn, fy_id)
    finally:
        conn.close()
    valid_pg_names = {pg["name"] for pg in pgs}

    rows: list[dict] = []
    errors: list[str] = []
    for i, raw in enumerate(reader, start=2):
        pg = (raw.get("pool_group_name") or "").strip()
        period = (raw.get("period") or "").strip()
        rt = (raw.get("rate_type") or "").strip().lower()
        rv_str = (raw.get("rate_value") or "").strip()

        row_errors: list[str] = []
        if not pg:
            row_errors.append("pool_group_name is empty")
        elif pg not in valid_pg_names:
            row_errors.append(f"pool_group_name '{pg}' not found")
        if not _PERIOD_RE.match(period):
            row_errors.append(f"invalid period '{period}' (expected YYYY-MM)")
        if rt not in _VALID_RATE_TYPES:
            row_errors.append(f"invalid rate_type '{rt}' (expected: {', '.join(sorted(_VALID_RATE_TYPES))})")
        try:
            rv = float(rv_str) / 100.0
        except (ValueError, TypeError):
            row_errors.append(f"invalid rate_value '{rv_str}'")
            rv = 0.0

        if row_errors:
            errors.append(f"Row {i}: {'; '.join(row_errors)}")
        else:
            rows.append({"rate_type": rt, "pool_group_name": pg, "period": period, "rate_value": rv})

    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors, "valid_rows": len(rows)})

    conn = _conn()
    try:
        count = db.bulk_upsert_reference_rates_atomic(conn, fy_id, rows)
        return {"imported": count}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Entities (from GL_Actuals on disk or uploaded file)
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/entities")
def list_entities(fy_id: int, request: Request, data_dir: str = "data"):
    conn = _conn()
    try:
        user_id, fy = _assert_fy_access(conn, request, fy_id)
        # Try uploaded GL_Actuals first
        uploaded = db.get_latest_uploaded_file(conn, fy_id, "gl_actuals")
    finally:
        conn.close()

    import pandas as pd

    if uploaded:
        try:
            df = pd.read_csv(io.BytesIO(uploaded["content"]), dtype={"Account": str})
            if "Entity" in df.columns:
                return sorted(df["Entity"].dropna().astype(str).unique().tolist())
        except Exception:
            pass

    gl_path = Path(data_dir) / "GL_Actuals.csv"
    if not gl_path.exists():
        return []
    try:
        df = pd.read_csv(gl_path, dtype={"Account": str})
        if "Entity" not in df.columns:
            return []
        return sorted(df["Entity"].dropna().astype(str).unique().tolist())
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Forecast Runs
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/forecast-runs")
def list_forecast_runs(fy_id: int, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        return db.list_forecast_runs(conn, fy_id)
    finally:
        conn.close()


@router.get("/forecast-runs/{run_id}")
def get_forecast_run(run_id: int, request: Request):
    conn = _conn()
    try:
        _assert_forecast_run_access(conn, request, run_id)
        run = db.get_forecast_run(conn, run_id)
        if not run:
            _404("Forecast run")
        result = {k: v for k, v in run.items() if k != "output_zip"}
        result["zip_size"] = len(run["output_zip"]) if run.get("output_zip") else 0
        return result
    finally:
        conn.close()


@router.get("/forecast-runs/{run_id}/download")
def download_forecast_run(run_id: int, request: Request):
    from fastapi.responses import Response as FastResponse
    conn = _conn()
    try:
        _assert_forecast_run_access(conn, request, run_id)
        run = db.get_forecast_run(conn, run_id)
        if not run or not run.get("output_zip"):
            _404("Forecast run")
        return FastResponse(
            content=run["output_zip"],
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="forecast_run_{run_id}.zip"'},
        )
    finally:
        conn.close()


@router.delete("/forecast-runs/{run_id}")
def delete_forecast_run(run_id: int, request: Request):
    conn = _conn()
    try:
        _assert_forecast_run_access(conn, request, run_id)
        if not db.delete_forecast_run(conn, run_id):
            _404("Forecast run")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Revenue
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/revenue")
def list_revenue(fy_id: int, request: Request, project: str | None = None):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        return db.list_revenue(conn, fy_id, project)
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/revenue", status_code=201)
def upsert_revenue(fy_id: int, body: RevenueUpsert, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        rid = db.upsert_revenue(conn, fy_id, body.period, body.project, body.revenue)
        return {"id": rid, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/revenue/import", status_code=201)
def import_revenue(fy_id: int, body: list[RevenueUpsert], request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
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
def list_cost_categories(fy_id: int, request: Request, category_type: str | None = None):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        return db.list_cost_categories(conn, fy_id, category_type)
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/cost-categories", status_code=201)
def create_cost_category(fy_id: int, body: CostCategoryCreate, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        cc_id = db.create_cost_category(
            conn, fy_id, body.category_type, body.category_name, body.gl_account, body.is_direct
        )
        return {"id": cc_id, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.put("/cost-categories/{cc_id}")
def update_cost_category(cc_id: int, body: CostCategoryUpdate, request: Request):
    conn = _conn()
    try:
        _assert_cost_category_access(conn, request, cc_id)
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        if not db.update_cost_category(conn, cc_id, **updates):
            _404("Cost category")
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/cost-categories/{cc_id}")
def delete_cost_category(cc_id: int, request: Request):
    conn = _conn()
    try:
        _assert_cost_category_access(conn, request, cc_id)
        if not db.delete_cost_category(conn, cc_id):
            _404("Cost category")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Chart of Accounts
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/chart-of-accounts")
def list_chart_of_accounts(fy_id: int, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        return db.list_chart_of_accounts(conn, fy_id)
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/chart-of-accounts", status_code=201)
def create_chart_account(fy_id: int, body: ChartAccountCreate, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        ca_id = db.create_chart_account(conn, fy_id, body.account, body.name, body.category)
        return {"id": ca_id, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/chart-of-accounts/bulk", status_code=201)
def bulk_create_chart_accounts(fy_id: int, body: ChartAccountBulk, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        ids = db.bulk_create_chart_accounts(conn, fy_id, [a.model_dump() for a in body.accounts])
        return {"ids": ids, "imported": len(ids)}
    finally:
        conn.close()


@router.delete("/chart-of-accounts/{ca_id}")
def delete_chart_account(ca_id: int, request: Request):
    conn = _conn()
    try:
        _assert_chart_account_access(conn, request, ca_id)
        if not db.delete_chart_account(conn, ca_id):
            _404("Chart account")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Pool Group Base Accounts
# ---------------------------------------------------------------------------

@router.get("/pool-groups/{pg_id}/base-accounts")
def list_base_accounts(pg_id: int, request: Request):
    conn = _conn()
    try:
        _assert_pool_group_access(conn, request, pg_id)
        return db.list_base_accounts(conn, pg_id)
    finally:
        conn.close()


@router.post("/pool-groups/{pg_id}/base-accounts", status_code=201)
def create_base_account(pg_id: int, body: BaseAccountCreate, request: Request):
    conn = _conn()
    try:
        _assert_pool_group_access(conn, request, pg_id)
        ba_id = db.create_base_account(conn, pg_id, body.account, body.notes)
        return {"id": ba_id, "pool_group_id": pg_id, **body.model_dump()}
    finally:
        conn.close()


@router.delete("/base-accounts/{ba_id}")
def delete_base_account(ba_id: int, request: Request):
    conn = _conn()
    try:
        _assert_base_account_access(conn, request, ba_id)
        if not db.delete_base_account(conn, ba_id):
            _404("Base account")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Available Accounts (for shuttle UI)
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/available-cost-accounts")
def get_available_cost_accounts(fy_id: int, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        return db.get_available_cost_accounts(conn, fy_id)
    finally:
        conn.close()


@router.get("/fiscal-years/{fy_id}/available-base-accounts")
def get_available_base_accounts(fy_id: int, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        return db.get_available_base_accounts(conn, fy_id)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/scenarios")
def list_scenarios(fy_id: int, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        return db.list_scenarios(conn, fy_id)
    finally:
        conn.close()


@router.post("/fiscal-years/{fy_id}/scenarios", status_code=201)
def create_scenario(fy_id: int, body: ScenarioCreate, request: Request):
    conn = _conn()
    try:
        _assert_fy_access(conn, request, fy_id)
        sid = db.create_scenario(conn, fy_id, body.name, body.description)
        return {"id": sid, "fiscal_year_id": fy_id, **body.model_dump()}
    finally:
        conn.close()


@router.get("/scenarios/{scenario_id}")
def get_scenario(scenario_id: int, request: Request):
    conn = _conn()
    try:
        _assert_scenario_access(conn, request, scenario_id)
        s = db.get_scenario(conn, scenario_id)
        if not s:
            _404("Scenario")
        return s
    finally:
        conn.close()


@router.put("/scenarios/{scenario_id}")
def update_scenario(scenario_id: int, body: ScenarioUpdate, request: Request):
    conn = _conn()
    try:
        _assert_scenario_access(conn, request, scenario_id)
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        if not db.update_scenario(conn, scenario_id, **updates):
            _404("Scenario")
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/scenarios/{scenario_id}")
def delete_scenario(scenario_id: int, request: Request):
    conn = _conn()
    try:
        _assert_scenario_access(conn, request, scenario_id)
        if not db.delete_scenario(conn, scenario_id):
            _404("Scenario")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Scenario Events
# ---------------------------------------------------------------------------

@router.get("/scenarios/{scenario_id}/events")
def list_scenario_events(scenario_id: int, request: Request):
    conn = _conn()
    try:
        _assert_scenario_access(conn, request, scenario_id)
        return db.list_scenario_events(conn, scenario_id)
    finally:
        conn.close()


@router.post("/scenarios/{scenario_id}/events", status_code=201)
def create_scenario_event(scenario_id: int, body: ScenarioEventCreate, request: Request):
    import json
    conn = _conn()
    try:
        _assert_scenario_access(conn, request, scenario_id)
        eid = db.create_scenario_event(
            conn, scenario_id,
            body.effective_period, body.event_type, body.project,
            body.delta_direct_labor, body.delta_direct_labor_hrs,
            body.delta_subk, body.delta_odc, body.delta_travel,
            json.dumps(body.pool_deltas), body.notes,
        )
        return {"id": eid, "scenario_id": scenario_id, **body.model_dump()}
    finally:
        conn.close()


@router.put("/scenario-events/{event_id}")
def update_scenario_event(event_id: int, body: ScenarioEventUpdate, request: Request):
    conn = _conn()
    try:
        _assert_scenario_event_access(conn, request, event_id)
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        if not db.update_scenario_event(conn, event_id, **updates):
            _404("Scenario event")
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/scenario-events/{event_id}")
def delete_scenario_event(event_id: int, request: Request):
    conn = _conn()
    try:
        _assert_scenario_event_access(conn, request, event_id)
        if not db.delete_scenario_event(conn, event_id):
            _404("Scenario event")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Seed / Clear Test Data
# ---------------------------------------------------------------------------

@router.post("/seed-test-data", status_code=201)
def seed_test_data(request: Request, data_dir: str = "data_test"):
    from .seed import seed_test_data as _seed
    require_auth(request)
    conn = _conn()
    try:
        result = _seed(conn, Path(data_dir))
        if "error" in result:
            raise HTTPException(status_code=409, detail=result["error"])
        return result
    finally:
        conn.close()


@router.delete("/seed-test-data")
def clear_test_data(request: Request, data_dir: str = "data_test"):
    from .seed import clear_test_data as _clear
    require_auth(request)
    conn = _conn()
    try:
        return _clear(conn, Path(data_dir))
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Seed / Clear Demo Data
# ---------------------------------------------------------------------------

@router.post("/seed-demo-data", status_code=201)
def seed_demo_data(request: Request, data_dir: str = "data_demo"):
    from .demo_data import seed_demo_data as _seed
    user_id = require_auth(request)
    conn = _conn()
    try:
        result = _seed(conn, Path(data_dir), user_id=user_id)
        if "error" in result:
            raise HTTPException(status_code=409, detail=result["error"])
        return result
    finally:
        conn.close()


@router.delete("/seed-demo-data")
def clear_demo_data(request: Request, data_dir: str = "data_demo"):
    from .demo_data import clear_demo_data as _clear
    user_id = require_auth(request)
    conn = _conn()
    try:
        return _clear(conn, Path(data_dir), user_id=user_id)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Rates Table (comparison view)
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/rates-table")
def get_rates_table(
    fy_id: int,
    request: Request,
    scenario: str = "Base",
    forecast_months: int = 12,
    run_rate_months: int = 3,
    input_dir: str | None = None,
):
    from .agents import AnalystAgent, PlannerAgent
    from .config import RateConfig, default_rate_config
    from .ytd import compute_ytd_rates, build_rates_comparison_table

    user_id = require_auth(request)
    conn = _conn()
    try:
        fy = _check_fy_ownership(conn, fy_id, user_id)
        raw_config = db.build_rate_config_from_db(conn, fy_id)
        if raw_config["rates"]:
            cfg = RateConfig.from_mapping(raw_config)
        else:
            cfg = default_rate_config()
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
        input_dir = "data_demo" if fy["name"].startswith("DEMO-") else "data"

    input_path = Path(input_dir)
    if not input_path.exists():
        raise HTTPException(status_code=400, detail=f"Input directory not found: {input_dir}")

    import pandas as pd
    import shutil
    import tempfile

    fy_start = pd.Period(fy["start_month"], freq="M")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_input = Path(tmp) / "inputs"
        tmp_input.mkdir(parents=True, exist_ok=True)

        fy_start_str = fy["start_month"]
        fy_end_str = fy["end_month"]

        conn2 = _conn()
        try:
            # Try uploaded files first
            for file_type, fname in [("gl_actuals", "GL_Actuals.csv"), ("direct_costs", "Direct_Costs_By_Project.csv")]:
                uf = db.get_latest_uploaded_file(conn2, fy_id, file_type)
                if uf:
                    df = pd.read_csv(io.BytesIO(uf["content"]))
                    if "Period" in df.columns:
                        df = df[(df["Period"] >= fy_start_str) & (df["Period"] <= fy_end_str)]
                    df.to_csv(tmp_input / fname, index=False)
                else:
                    src = input_path / fname
                    if src.exists():
                        df = pd.read_csv(src)
                        if "Period" in df.columns:
                            df = df[(df["Period"] >= fy_start_str) & (df["Period"] <= fy_end_str)]
                        df.to_csv(tmp_input / fname, index=False)

            account_map_df = db.build_account_map_df_from_db(conn2, fy_id)
            if not account_map_df.empty:
                account_map_df.to_csv(tmp_input / "Account_Map.csv", index=False)
            elif (input_path / "Account_Map.csv").exists():
                shutil.copy2(input_path / "Account_Map.csv", tmp_input / "Account_Map.csv")

            scenario_df = db.build_scenario_events_df_from_db(conn2, fy_id)
            if not scenario_df.empty:
                scenario_df.to_csv(tmp_input / "Scenario_Events.csv", index=False)
            elif (input_path / "Scenario_Events.csv").exists():
                shutil.copy2(input_path / "Scenario_Events.csv", tmp_input / "Scenario_Events.csv")
        finally:
            conn2.close()

        if not (tmp_input / "Scenario_Events.csv").exists():
            (tmp_input / "Scenario_Events.csv").write_text(
                "Scenario,EffectivePeriod,Type,Project\nBase,2025-01,ADJUST,\n"
            )

        plan = PlannerAgent().plan(
            scenario=scenario,
            forecast_months=forecast_months,
            run_rate_months=run_rate_months,
            events_path=tmp_input / "Scenario_Events.csv",
        )
        from dataclasses import replace
        plan = replace(plan, fy_start=fy_start)

        results = AnalystAgent().run(input_dir=tmp_input, config=cfg, plan=plan)
        result = next((r for r in results if r.scenario == scenario), results[0])

    rate_defs = {name: {"pool": rd.pool, "base": rd.base} for name, rd in cfg.rates.items()}
    ytd = compute_ytd_rates(result.pools, result.bases, rate_defs, fy_start)

    rate_names = list(cfg.rates.keys())
    comparison = build_rates_comparison_table(
        result.rates, ytd, budget_rates, prov_rates, rate_names
    )

    output: dict[str, Any] = {}
    for rate_name, table_df in comparison.items():
        output[rate_name] = {
            "periods": list(table_df.columns),
            "rows": {row_name: [float(v) for v in table_df.loc[row_name]] for row_name in table_df.index},
        }

    pools_df = result.pools.copy()
    pools_df.index = pools_df.index.astype(str)
    bases_df = result.bases.copy()
    bases_df.index = bases_df.index.astype(str)
    output["_pools"] = {col: {p: round(float(v), 2) for p, v in pools_df[col].items()} for col in pools_df.columns}
    output["_bases"] = {col: {p: round(float(v), 2) for p, v in bases_df[col].items()} for col in bases_df.columns}
    output["_rate_defs"] = {name: {"pool": rd.pool, "base": rd.base} for name, rd in cfg.rates.items()}

    return output


# ---------------------------------------------------------------------------
# Project Status Report (PSR)
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/psr")
def get_psr(
    fy_id: int,
    request: Request,
    scenario: str = "Base",
    forecast_months: int = 12,
    run_rate_months: int = 3,
    input_dir: str | None = None,
):
    import shutil
    import tempfile
    import pandas as pd
    from .agents import AnalystAgent, PlannerAgent
    from .config import RateConfig, default_rate_config
    from .psr import build_psr, build_psr_summary

    user_id = require_auth(request)
    conn = _conn()
    try:
        fy = _check_fy_ownership(conn, fy_id, user_id)
        raw_config = db.build_rate_config_from_db(conn, fy_id)
        if raw_config["rates"]:
            cfg = RateConfig.from_mapping(raw_config)
        else:
            cfg = default_rate_config()
        account_map_df = db.build_account_map_df_from_db(conn, fy_id)
        scenario_df = db.build_scenario_events_df_from_db(conn, fy_id)
        revenue_data = db.list_revenue(conn, fy_id)
    finally:
        conn.close()

    if not input_dir:
        input_dir = "data_demo" if fy["name"].startswith("DEMO-") else "data"

    disk_dir = Path(input_dir)
    if not disk_dir.exists():
        raise HTTPException(status_code=400, detail=f"Input directory not found: {input_dir}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_input = Path(tmp) / "inputs"
        tmp_input.mkdir(parents=True, exist_ok=True)

        fy_start_str = fy["start_month"]
        fy_end_str = fy["end_month"]

        conn2 = _conn()
        try:
            for file_type, fname in [("gl_actuals", "GL_Actuals.csv"), ("direct_costs", "Direct_Costs_By_Project.csv")]:
                uf = db.get_latest_uploaded_file(conn2, fy_id, file_type)
                if uf:
                    df = pd.read_csv(io.BytesIO(uf["content"]))
                    if "Period" in df.columns:
                        df = df[(df["Period"] >= fy_start_str) & (df["Period"] <= fy_end_str)]
                    df.to_csv(tmp_input / fname, index=False)
                else:
                    src = disk_dir / fname
                    if src.exists():
                        df = pd.read_csv(src)
                        if "Period" in df.columns:
                            df = df[(df["Period"] >= fy_start_str) & (df["Period"] <= fy_end_str)]
                        df.to_csv(tmp_input / fname, index=False)
        finally:
            conn2.close()

        if not account_map_df.empty:
            account_map_df.to_csv(tmp_input / "Account_Map.csv", index=False)
        elif (disk_dir / "Account_Map.csv").exists():
            shutil.copy2(disk_dir / "Account_Map.csv", tmp_input / "Account_Map.csv")

        if not scenario_df.empty:
            scenario_df.to_csv(tmp_input / "Scenario_Events.csv", index=False)
        elif (disk_dir / "Scenario_Events.csv").exists():
            shutil.copy2(disk_dir / "Scenario_Events.csv", tmp_input / "Scenario_Events.csv")

        if not (tmp_input / "Scenario_Events.csv").exists():
            (tmp_input / "Scenario_Events.csv").write_text(
                "Scenario,EffectivePeriod,Type,Project,DeltaDirectLabor$,DeltaDirectLaborHrs,"
                "DeltaSubk,DeltaODC,DeltaTravel,DeltaPoolFringe,DeltaPoolOverhead,DeltaPoolGA,Notes\n"
                "Base,2025-01,ADJUST,,0,0,0,0,0,0,0,0,No changes\n"
            )

        plan = PlannerAgent().plan(
            scenario=scenario,
            forecast_months=forecast_months,
            run_rate_months=run_rate_months,
            events_path=tmp_input / "Scenario_Events.csv",
        )

        from dataclasses import replace
        plan = replace(plan, fy_start=pd.Period(fy["start_month"], freq="M"))

        results = AnalystAgent().run(input_dir=tmp_input, config=cfg, plan=plan)
        result = next((r for r in results if r.scenario == scenario), results[0])

    dc_path = disk_dir / "Direct_Costs_By_Project.csv"
    allowed_projects = None
    if dc_path.exists():
        dc_df = pd.read_csv(dc_path)
        dc_fy = dc_df[
            (dc_df["Period"] >= fy["start_month"])
            & (dc_df["Period"] <= fy["end_month"])
        ]
        allowed_projects = sorted(dc_fy["Project"].unique().tolist())

    psr = build_psr(
        result.project_impacts, revenue_data,
        fy_start=fy["start_month"], fy_end=fy["end_month"],
        allowed_projects=allowed_projects,
    )
    summary = build_psr_summary(psr)

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
# PST Report (Project Status by Time)
# ---------------------------------------------------------------------------

@router.get("/fiscal-years/{fy_id}/pst")
def get_pst(
    fy_id: int,
    request: Request,
    selected_period: str = "",
    scenario: str = "Base",
    forecast_months: int = 12,
    run_rate_months: int = 3,
    input_dir: str | None = None,
):
    import shutil
    import tempfile
    import pandas as pd
    from .agents import AnalystAgent, PlannerAgent
    from .config import RateConfig, default_rate_config
    from .pst import build_pst_report

    user_id = require_auth(request)
    conn = _conn()
    try:
        fy = _check_fy_ownership(conn, fy_id, user_id)
        raw_config = db.build_rate_config_from_db(conn, fy_id)
        if raw_config["rates"]:
            cfg = RateConfig.from_mapping(raw_config)
        else:
            cfg = default_rate_config()
        account_map_df = db.build_account_map_df_from_db(conn, fy_id)
        scenario_df = db.build_scenario_events_df_from_db(conn, fy_id)
        ref_rates = db.list_reference_rates(conn, fy_id, rate_type="budget")
    finally:
        conn.close()

    if not input_dir:
        input_dir = "data_demo" if fy["name"].startswith("DEMO-") else "data"

    disk_dir = Path(input_dir)
    if not disk_dir.exists():
        raise HTTPException(status_code=400, detail=f"Input directory not found: {input_dir}")

    # Build budget rates dict
    budget_rates: dict[str, dict[str, float]] = {}
    for rr in ref_rates:
        budget_rates.setdefault(rr["pool_group_name"], {})[rr["period"]] = rr["rate_value"]

    with tempfile.TemporaryDirectory() as tmp:
        tmp_input = Path(tmp) / "inputs"
        tmp_input.mkdir(parents=True, exist_ok=True)

        fy_start_str = fy["start_month"]
        fy_end_str = fy["end_month"]

        conn2 = _conn()
        try:
            for file_type, fname in [("gl_actuals", "GL_Actuals.csv"), ("direct_costs", "Direct_Costs_By_Project.csv")]:
                uf = db.get_latest_uploaded_file(conn2, fy_id, file_type)
                if uf:
                    df = pd.read_csv(io.BytesIO(uf["content"]))
                    if "Period" in df.columns:
                        df = df[(df["Period"] >= fy_start_str) & (df["Period"] <= fy_end_str)]
                    df.to_csv(tmp_input / fname, index=False)
                else:
                    src = disk_dir / fname
                    if src.exists():
                        df = pd.read_csv(src)
                        if "Period" in df.columns:
                            df = df[(df["Period"] >= fy_start_str) & (df["Period"] <= fy_end_str)]
                        df.to_csv(tmp_input / fname, index=False)
        finally:
            conn2.close()

        if not account_map_df.empty:
            account_map_df.to_csv(tmp_input / "Account_Map.csv", index=False)
        elif (disk_dir / "Account_Map.csv").exists():
            shutil.copy2(disk_dir / "Account_Map.csv", tmp_input / "Account_Map.csv")

        if not scenario_df.empty:
            scenario_df.to_csv(tmp_input / "Scenario_Events.csv", index=False)
        elif (disk_dir / "Scenario_Events.csv").exists():
            shutil.copy2(disk_dir / "Scenario_Events.csv", tmp_input / "Scenario_Events.csv")

        if not (tmp_input / "Scenario_Events.csv").exists():
            (tmp_input / "Scenario_Events.csv").write_text(
                "Scenario,EffectivePeriod,Type,Project,DeltaDirectLabor$,DeltaDirectLaborHrs,"
                "DeltaSubk,DeltaODC,DeltaTravel,DeltaPoolFringe,DeltaPoolOverhead,DeltaPoolGA,Notes\n"
                "Base,2025-01,ADJUST,,0,0,0,0,0,0,0,0,No changes\n"
            )

        plan = PlannerAgent().plan(
            scenario=scenario,
            forecast_months=forecast_months,
            run_rate_months=run_rate_months,
            events_path=tmp_input / "Scenario_Events.csv",
        )
        from dataclasses import replace
        plan = replace(plan, fy_start=pd.Period(fy_start_str, freq="M"))

        results = AnalystAgent().run(input_dir=tmp_input, config=cfg, plan=plan)
        result = next((r for r in results if r.scenario == scenario), results[0])

    # Determine selected_period default (last actual period in FY range)
    if not selected_period:
        all_periods = sorted(result.pools.index.astype(str).tolist())
        fy_periods = [p for p in all_periods if fy_start_str <= p <= fy_end_str]
        selected_period = fy_periods[-1] if fy_periods else (all_periods[-1] if all_periods else fy_end_str)

    pst_result = build_pst_report(
        pools=result.pools,
        bases=result.bases,
        project_impacts=result.project_impacts,
        budget_rates=budget_rates,
        selected_period=selected_period,
        fy_start=fy_start_str,
    )

    # Serialize
    records = []
    for _, row in pst_result.iterrows():
        records.append({col: (round(float(row[col]), 2) if isinstance(row[col], float) else row[col]) for col in pst_result.columns})

    all_periods = sorted(result.pools.index.astype(str).tolist())
    fy_periods = [p for p in all_periods if fy_start_str <= p <= fy_end_str]

    return {
        "categories": records,
        "selected_period": selected_period,
        "available_periods": fy_periods,
        "fy_start": fy_start_str,
        "fy_end": fy_end_str,
    }


# ---------------------------------------------------------------------------
# File Upload / Download / Delete
# ---------------------------------------------------------------------------

@router.post("/fiscal-years/{fy_id}/files", status_code=201)
async def upload_file(
    fy_id: int,
    request: Request,
    file: UploadFile = File(...),
    file_type: str = "gl_actuals",
):
    user_id = require_auth(request)
    content = await file.read()

    conn = _conn()
    try:
        _check_fy_ownership(conn, fy_id, user_id)

        # Enforce storage quota for authenticated users
        used = db.get_user_storage_bytes(conn, user_id)
        if used + len(content) > db.MAX_STORAGE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Storage limit exceeded. Used: {used // 1024 // 1024}MB of {db.MAX_STORAGE_BYTES // 1024 // 1024}MB",
            )

        file_id = db.save_uploaded_file(conn, fy_id, file_type, file.filename or file_type, content)
        return {"id": file_id, "file_type": file_type, "file_name": file.filename, "size_bytes": len(content)}
    finally:
        conn.close()


@router.get("/fiscal-years/{fy_id}/files")
def list_files(fy_id: int, request: Request):
    user_id = require_auth(request)
    conn = _conn()
    try:
        _check_fy_ownership(conn, fy_id, user_id)
        return db.list_uploaded_files(conn, fy_id)
    finally:
        conn.close()


@router.get("/files/{file_id}/download")
def download_file(file_id: int, request: Request):
    from fastapi.responses import Response as FastResponse
    conn = _conn()
    try:
        _assert_uploaded_file_access(conn, request, file_id)
        f = db.get_uploaded_file(conn, file_id)
        if not f:
            _404("File")
        return FastResponse(
            content=f["content"],
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{f["file_name"]}"'},
        )
    finally:
        conn.close()


@router.delete("/files/{file_id}")
def delete_file(file_id: int, request: Request):
    conn = _conn()
    try:
        _assert_uploaded_file_access(conn, request, file_id)
        if not db.delete_uploaded_file(conn, file_id):
            _404("File")
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Storage usage
# ---------------------------------------------------------------------------

@router.get("/storage-usage")
def get_storage_usage(request: Request):
    user_id = require_auth(request)
    conn = _conn()
    try:
        used = db.get_user_storage_bytes(conn, user_id)
        return {
            "used_bytes": used,
            "max_bytes": db.MAX_STORAGE_BYTES,
            "used_mb": round(used / 1024 / 1024, 2),
            "max_mb": db.MAX_STORAGE_BYTES // 1024 // 1024,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# DB-based Forecast
# ---------------------------------------------------------------------------

@router.post("/fiscal-years/{fy_id}/forecast")
def forecast_from_db(
    fy_id: int,
    request: Request,
    scenario: str | None = None,
    forecast_months: int = 12,
    run_rate_months: int = 3,
    input_dir: str | None = None,
):
    from .agents import AnalystAgent, PlannerAgent, ReporterAgent
    from .config import RateConfig

    user_id = require_auth(request)
    conn = _conn()
    try:
        fy = _check_fy_ownership(conn, fy_id, user_id)
        raw_config = db.build_rate_config_from_db(conn, fy_id)
        if not raw_config["rates"]:
            raise HTTPException(status_code=400, detail="No pool groups configured for this fiscal year")
        cfg = RateConfig.from_mapping(raw_config)
    finally:
        conn.close()

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
