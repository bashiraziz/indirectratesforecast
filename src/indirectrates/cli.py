from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer
from rich.console import Console

from .agents import AnalystAgent, PlannerAgent, ReporterAgent
from .config import RateConfig, default_rate_config
from .db import DEFAULT_DB_PATH, init_db
from .synth import SynthSpec, generate_synthetic_dataset

app = typer.Typer(add_completion=False, help="Indirect rate forecasting agent (GovCon MVP).")
console = Console()


@app.command()
def synth(
    out: Path = typer.Option(..., help="Output directory for synthetic CSVs."),
    start: str = typer.Option("2025-01", help="Start period (YYYY-MM)."),
    months: int = typer.Option(18, min=3, help="Number of months."),
    projects: int = typer.Option(5, min=1, help="Number of projects."),
    seed: int = typer.Option(42, help="RNG seed."),
):
    generate_synthetic_dataset(out, SynthSpec(start=start, months=months, projects=projects, seed=seed))
    console.print(f"Wrote synthetic dataset to {out}")


@app.command()
def run(
    input: Path = typer.Option(..., exists=True, file_okay=False, help="Input directory containing CSVs."),
    out: Path = typer.Option(..., help="Output directory for the management pack."),
    scenario: Optional[str] = typer.Option(None, help="Scenario name (omit to run all scenarios found)."),
    config: Optional[Path] = typer.Option(None, help="Rate config YAML (default uses packaged config)."),
    forecast_months: int = typer.Option(12, min=1, help="Months beyond last actual to project."),
    run_rate_months: int = typer.Option(3, min=1, help="Months to average for run-rate projection."),
):
    cfg = RateConfig.from_yaml(config) if config else default_rate_config()
    plan = PlannerAgent().plan(scenario, forecast_months, run_rate_months, events_path=input / "Scenario_Events.csv")
    results = AnalystAgent().run(input_dir=input, config=cfg, plan=plan)
    ReporterAgent().package(out_dir=out, results=results)
    console.print(f"Wrote management pack to {out}")


@app.command(name="init-db")
def init_db_cmd(
    db: Path = typer.Option(str(DEFAULT_DB_PATH), help="Path to the SQLite database file."),
):
    """Initialize the SQLite database (creates tables if they don't exist)."""
    path = init_db(db)
    console.print(f"Database initialized at {path}")


def _find_available_port(host: str, preferred: int) -> int:
    """Return *preferred* if free, otherwise try fallbacks then let the OS pick."""
    import socket

    candidates = [preferred] + [p for p in (8000, 8001, 8080, 8888) if p != preferred]
    for port in candidates:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    # All candidates busy — let the OS assign one
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", help="Host to bind (use 0.0.0.0 for LAN)."),
    port: int = typer.Option(8000, help="Port to serve the API on."),
):
    """Start the forecast API server (for the Next.js UI)."""
    try:
        import uvicorn
    except Exception as e:  # pragma: no cover
        raise typer.BadParameter('Missing server deps. Install with: pip install -e ".[server]"') from e

    actual_port = _find_available_port(host, port)
    if actual_port != port:
        console.print(f"Port {port} is in use, using port {actual_port} instead.")
    uvicorn.run("indirectrates.server:app", host=host, port=actual_port, reload=False)
