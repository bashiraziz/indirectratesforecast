from __future__ import annotations

import io
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, File, Form, UploadFile
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .agents import AnalystAgent, PlannerAgent, ReporterAgent
from .api_crud import router as crud_router
from .config import RateConfig, default_rate_config
from .db import (
    build_account_map_df_from_db,
    build_rate_config_from_db,
    get_connection,
    get_fiscal_year,
    init_db,
)

app = FastAPI(title="Indirect Rates Forecast API", version="0.2.0")

# Ensure database tables exist on startup
init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(crud_router)


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.post("/forecast")
async def forecast(
    scenario: Optional[str] = Form(default=None),
    forecast_months: int = Form(default=12),
    run_rate_months: int = Form(default=3),
    fiscal_year_id: Optional[int] = Form(default=None),
    inputs_zip: Optional[UploadFile] = File(default=None),
    gl_actuals: Optional[UploadFile] = File(default=None),
    account_map: Optional[UploadFile] = File(default=None),
    direct_costs: Optional[UploadFile] = File(default=None),
    scenario_events: Optional[UploadFile] = File(default=None),
    config_yaml: Optional[UploadFile] = File(default=None),
):
    scenario = (scenario or "").strip() or None

    # When fiscal_year_id is provided, load config from DB instead of uploads
    if fiscal_year_id is not None:
        conn = get_connection()
        try:
            fy = get_fiscal_year(conn, fiscal_year_id)
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

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        input_dir = tmp_path / "inputs"
        out_dir = tmp_path / "out"
        input_dir.mkdir(parents=True, exist_ok=True)

        if inputs_zip is not None:
            data = await inputs_zip.read()
            with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
                zf.extractall(input_dir)
        else:
            await _write_upload(gl_actuals, input_dir / "GL_Actuals.csv")
            if account_map_df is not None:
                # Write DB-generated Account_Map so the pipeline picks it up
                account_map_df.to_csv(input_dir / "Account_Map.csv", index=False)
            else:
                await _write_upload(account_map, input_dir / "Account_Map.csv")
            await _write_upload(direct_costs, input_dir / "Direct_Costs_By_Project.csv")
            await _write_upload(scenario_events, input_dir / "Scenario_Events.csv")

        # If Scenario_Events.csv is missing, write a default no-op Base row
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
        results = AnalystAgent().run(input_dir=input_dir, config=cfg, plan=plan)
        ReporterAgent().package(out_dir=out_dir, results=results)

        payload = _zip_dir_bytes(out_dir)
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
    raw = yaml.safe_load((await config_yaml.read()).decode("utf-8"))
    return RateConfig.from_mapping(raw)
