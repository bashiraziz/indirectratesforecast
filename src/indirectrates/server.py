from __future__ import annotations

import io
import logging
import os
import tempfile
import time
import uuid
import zipfile
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from .agents import AnalystAgent, PlannerAgent, ReporterAgent
from .api_crud import router as crud_router, get_current_user
from .config import RateConfig, default_rate_config
from .db import (
    build_account_map_df_from_db,
    build_rate_config_from_db,
    build_scenario_events_df_from_db,
    get_connection,
    get_fiscal_year,
    get_latest_uploaded_file,
    init_db,
    list_reference_rates,
    save_forecast_run,
    get_user_storage_bytes,
    MAX_STORAGE_BYTES,
)


# ---------------------------------------------------------------------------
# Rate limiter key: user_id from header if present, else remote IP
# ---------------------------------------------------------------------------

def _rate_key(request: Request) -> str:
    user_id = request.headers.get("X-User-ID")
    return f"user:{user_id}" if user_id else f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=_rate_key)
logger = logging.getLogger("indirectrates.api")

app = FastAPI(title="Indirect Rates Forecast API", version="0.3.0")
app.state.limiter = limiter


def _custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    from fastapi.openapi.utils import get_openapi
    schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
    schema.setdefault("components", {})["securitySchemes"] = {
        "BearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "API key (set API_KEY env var)"}
    }
    for path_item in schema.get("paths", {}).values():
        for operation in path_item.values():
            if isinstance(operation, dict):
                operation["security"] = [{"BearerAuth": []}]
    app.openapi_schema = schema
    return schema


app.openapi = _custom_openapi


def _request_id_from_request(request: Request) -> str:
    return getattr(request.state, "request_id", "") or request.headers.get("X-Request-ID", "")


def _http_error_code(status_code: int) -> str:
    return {
        400: "bad_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        413: "payload_too_large",
        422: "validation_error",
        429: "rate_limited",
        500: "internal_error",
        503: "service_unavailable",
    }.get(status_code, "http_error")


def _error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    detail: object,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "detail": detail,
            "error": {
                "code": code,
                "message": message,
                "request_id": _request_id_from_request(request),
            },
        },
    )


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_exception_handler(request: Request, _: RateLimitExceeded) -> JSONResponse:
    return _error_response(
        request,
        status_code=429,
        code="rate_limited",
        message="Rate limit exceeded",
        detail="Rate limit exceeded",
    )


@app.exception_handler(HTTPException)
async def _http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict):
        message = str(detail.get("message") or detail.get("detail") or "Request failed")
    else:
        message = str(detail)
    return _error_response(
        request,
        status_code=exc.status_code,
        code=_http_error_code(exc.status_code),
        message=message,
        detail=detail,
    )


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return _error_response(
        request,
        status_code=422,
        code="validation_error",
        message="Request validation failed",
        detail=exc.errors(),
    )


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "Unhandled server exception rid=%s method=%s path=%s",
        _request_id_from_request(request),
        request.method,
        request.url.path,
    )
    return _error_response(
        request,
        status_code=500,
        code="internal_error",
        message="Internal server error",
        detail="Internal server error",
    )


@app.middleware("http")
async def _request_context_middleware(request: Request, call_next):
    request.state.request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    response.headers["X-Request-ID"] = request.state.request_id
    logger.info(
        "%s %s -> %s in %.2fms rid=%s",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
        request.state.request_id,
    )
    return response


@app.on_event("startup")
def startup():
    """Initialize database tables on startup."""
    try:
        init_db()
    except Exception:
        logger.exception(
            "DB init failed during startup; DB-backed endpoints may fail until database is reachable"
        )


# ALLOWED_ORIGINS: comma-separated list of allowed origins.
# Add your Vercel deployment URL here, e.g.:
#   ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:3000
_default_origins = "http://localhost:3000,http://127.0.0.1:3000"
_origins_env = os.environ.get("ALLOWED_ORIGINS", _default_origins)
_allowed_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(crud_router)


@app.get("/")
def root():
    return {"ok": True}


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/readyz")
def readyz():
    conn = None
    try:
        conn = get_connection()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc.__class__.__name__}") from exc
    finally:
        if conn is not None:
            conn.close()


# ---------------------------------------------------------------------------
# Rate limit helpers
# ---------------------------------------------------------------------------

def _guest_limit() -> str:
    return "5/minute"


def _auth_limit() -> str:
    return "20/minute"


def _get_limit(key: str) -> str:
    return _auth_limit() if key.startswith("user:") else _guest_limit()


@app.post("/forecast")
@limiter.limit(_get_limit)
async def forecast(
    request: Request,
    scenario: Optional[str] = Form(default=None),
    forecast_months: int = Form(default=12),
    run_rate_months: int = Form(default=3),
    fiscal_year_id: Optional[int] = Form(default=None),
    input_dir_path: Optional[str] = Form(default=None),
    inputs_zip: Optional[UploadFile] = File(default=None),
    gl_actuals: Optional[UploadFile] = File(default=None),
    account_map: Optional[UploadFile] = File(default=None),
    direct_costs: Optional[UploadFile] = File(default=None),
    scenario_events: Optional[UploadFile] = File(default=None),
    config_yaml: Optional[UploadFile] = File(default=None),
    entity: Optional[str] = Form(default=None),
):
    scenario = (scenario or "").strip() or None
    entity = (entity or "").strip() or None
    user_id = get_current_user(request)

    # When fiscal_year_id is provided, load config from DB instead of uploads
    fy = None
    if fiscal_year_id is not None:
        if not user_id:
            raise HTTPException(status_code=401, detail="Authentication required for fiscal_year_id mode")
        conn = get_connection()
        try:
            fy = get_fiscal_year(conn, fiscal_year_id, user_id=user_id)
            if not fy:
                raise HTTPException(status_code=404, detail=f"Fiscal year {fiscal_year_id} not found")
            raw_cfg = build_rate_config_from_db(conn, fiscal_year_id)
            cfg = RateConfig.from_mapping(raw_cfg)
            account_map_df = build_account_map_df_from_db(conn, fiscal_year_id)
        finally:
            conn.close()
        if account_map_df.empty:
            raise HTTPException(status_code=400, detail="No GL account mappings configured for this fiscal year")
    else:
        cfg = await _load_config(config_yaml)
        account_map_df = None

    disk_dir = Path(input_dir_path) if input_dir_path else None

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        input_dir = tmp_path / "inputs"
        out_dir = tmp_path / "out"
        input_dir.mkdir(parents=True, exist_ok=True)

        if inputs_zip is not None:
            data = await inputs_zip.read()
            try:
                with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
                    zf.extractall(input_dir)
            except zipfile.BadZipFile as exc:
                raise HTTPException(status_code=400, detail="inputs_zip is not a valid ZIP archive") from exc
        else:
            # GL_Actuals: fresh upload > gl_entries > uploaded_files > disk
            if gl_actuals is not None:
                await _write_upload(gl_actuals, input_dir / "GL_Actuals.csv")
            elif fiscal_year_id is not None:
                from . import db as _db
                conn = get_connection()
                try:
                    csv_str = _db.get_gl_entries_as_csv(conn, user_id or "", fiscal_year_id)
                finally:
                    conn.close()
                if csv_str.strip():
                    (input_dir / "GL_Actuals.csv").write_text(csv_str, encoding="utf-8")
                else:
                    conn = get_connection()
                    try:
                        uf = get_latest_uploaded_file(conn, fiscal_year_id, "gl_actuals")
                    finally:
                        conn.close()
                    if uf:
                        (input_dir / "GL_Actuals.csv").write_bytes(uf["content"])
                    elif disk_dir and (disk_dir / "GL_Actuals.csv").exists():
                        import shutil
                        shutil.copy2(disk_dir / "GL_Actuals.csv", input_dir / "GL_Actuals.csv")
            elif disk_dir and (disk_dir / "GL_Actuals.csv").exists():
                import shutil
                shutil.copy2(disk_dir / "GL_Actuals.csv", input_dir / "GL_Actuals.csv")

            # Account_Map: DB-generated > uploaded > disk
            if account_map_df is not None:
                account_map_df.to_csv(input_dir / "Account_Map.csv", index=False)
            elif account_map is not None:
                await _write_upload(account_map, input_dir / "Account_Map.csv")
            elif disk_dir and (disk_dir / "Account_Map.csv").exists():
                import shutil
                shutil.copy2(disk_dir / "Account_Map.csv", input_dir / "Account_Map.csv")

            # Direct_Costs: fresh upload > direct_cost_entries > uploaded_files > disk
            if direct_costs is not None:
                await _write_upload(direct_costs, input_dir / "Direct_Costs_By_Project.csv")
            elif fiscal_year_id is not None:
                conn = get_connection()
                try:
                    dc_csv = _db.get_direct_cost_entries_as_csv(conn, user_id or "", fiscal_year_id)
                finally:
                    conn.close()
                if dc_csv.strip():
                    (input_dir / "Direct_Costs_By_Project.csv").write_text(dc_csv, encoding="utf-8")
                else:
                    conn = get_connection()
                    try:
                        uf = get_latest_uploaded_file(conn, fiscal_year_id, "direct_costs")
                    finally:
                        conn.close()
                    if uf:
                        (input_dir / "Direct_Costs_By_Project.csv").write_bytes(uf["content"])
                    elif disk_dir and (disk_dir / "Direct_Costs_By_Project.csv").exists():
                        import shutil
                        shutil.copy2(disk_dir / "Direct_Costs_By_Project.csv", input_dir / "Direct_Costs_By_Project.csv")
            elif disk_dir and (disk_dir / "Direct_Costs_By_Project.csv").exists():
                import shutil
                shutil.copy2(disk_dir / "Direct_Costs_By_Project.csv", input_dir / "Direct_Costs_By_Project.csv")

            # Scenario_Events: fresh upload > disk
            if scenario_events is not None:
                await _write_upload(scenario_events, input_dir / "Scenario_Events.csv")
            elif disk_dir and (disk_dir / "Scenario_Events.csv").exists():
                import shutil
                shutil.copy2(disk_dir / "Scenario_Events.csv", input_dir / "Scenario_Events.csv")

        # Try loading Scenario_Events from DB scenarios
        if not (input_dir / "Scenario_Events.csv").exists() and fiscal_year_id is not None:
            conn = get_connection()
            try:
                scenario_df = build_scenario_events_df_from_db(conn, fiscal_year_id)
                if not scenario_df.empty:
                    scenario_df.to_csv(input_dir / "Scenario_Events.csv", index=False)
            finally:
                conn.close()

        if not (input_dir / "Scenario_Events.csv").exists():
            (input_dir / "Scenario_Events.csv").write_text(
                "Scenario,EffectivePeriod,Type,Project,DeltaDirectLabor$,DeltaDirectLaborHrs,"
                "DeltaSubk,DeltaODC,DeltaTravel,DeltaPoolFringe,DeltaPoolOverhead,DeltaPoolGA,Notes\n"
                "Base,2025-01,ADJUST,,0,0,0,0,0,0,0,0,No changes\n"
            )

        _require_inputs(input_dir)

        plan = PlannerAgent().plan(
            scenario=scenario,
            forecast_months=int(forecast_months),
            run_rate_months=int(run_rate_months),
            events_path=input_dir / "Scenario_Events.csv",
        )

        if fiscal_year_id is not None and fy:
            import pandas as pd
            from dataclasses import replace
            plan = replace(plan, fy_start=pd.Period(fy["start_month"], freq="M"))

        results = AnalystAgent().run(input_dir=input_dir, config=cfg, plan=plan, entity=entity)

        if fiscal_year_id is not None:
            conn = get_connection()
            try:
                ref_rates = list_reference_rates(conn, fiscal_year_id, rate_type="budget")
                ref_thresholds = list_reference_rates(conn, fiscal_year_id, rate_type="threshold")
            finally:
                conn.close()
            if ref_rates:
                budget_map: dict = {}
                for rr in ref_rates:
                    budget_map.setdefault(rr["pool_group_name"], {})[rr["period"]] = rr["rate_value"]
                for res in results:
                    res.assumptions["budget_rates"] = budget_map
            if ref_thresholds:
                threshold_map: dict = {}
                for rr in ref_thresholds:
                    threshold_map.setdefault(rr["pool_group_name"], {})[rr["period"]] = rr["rate_value"]
                for res in results:
                    res.assumptions["rate_thresholds"] = threshold_map

        ReporterAgent().package(out_dir=out_dir, results=results)

        payload = _zip_dir_bytes(out_dir)

        # Persist forecast run only for DB mode
        if fiscal_year_id is not None:
            import json as _json
            assumptions_str = _json.dumps(results[0].assumptions, default=str) if results else "{}"
            conn = get_connection()
            try:
                save_forecast_run(
                    conn,
                    fiscal_year_id=fiscal_year_id,
                    scenario=scenario or "",
                    forecast_months=int(forecast_months),
                    run_rate_months=int(run_rate_months),
                    assumptions_json=assumptions_str,
                    output_zip=payload,
                )
            finally:
                conn.close()

        return Response(
            content=payload,
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="rate_pack_output.zip"'},
        )


async def _write_upload(upload: Optional[UploadFile], path: Path) -> None:
    if upload is None:
        return
    path.write_bytes(await upload.read())


def _require_inputs(input_dir: Path) -> None:
    required = [
        "GL_Actuals.csv",
        "Account_Map.csv",
        "Direct_Costs_By_Project.csv",
        "Scenario_Events.csv",
    ]
    missing = [n for n in required if not (input_dir / n).exists()]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required inputs: {', '.join(missing)}")


def _zip_dir_bytes(src_dir: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in src_dir.rglob("*"):
            if path.is_file():
                zf.write(path, arcname=str(path.relative_to(src_dir)))
    return buf.getvalue()


async def _load_config(config_yaml: Optional[UploadFile]) -> RateConfig:
    if config_yaml is None:
        return default_rate_config()
    try:
        raw_text = (await config_yaml.read()).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="config_yaml must be UTF-8 text") from exc

    try:
        raw = yaml.safe_load(raw_text) or {}
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=400, detail="config_yaml is invalid YAML") from exc

    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="config_yaml must define a YAML mapping/object at top level")

    try:
        return RateConfig.from_mapping(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid config_yaml content: {exc}") from exc
