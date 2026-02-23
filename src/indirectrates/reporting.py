from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import pandas as pd
from openpyxl import Workbook
from openpyxl.utils.dataframe import dataframe_to_rows

from .types import ForecastResult


def write_assumptions(path: str | Path, assumptions: dict[str, Any]) -> None:
    path = Path(path)
    path.write_text(json.dumps(assumptions, indent=2, default=str), encoding="utf-8")


def write_narrative(path: str | Path, result: ForecastResult) -> None:
    path = Path(path)
    rates = result.rates.copy()
    last_actual_str = result.assumptions.get("last_actual_period")
    last_actual = pd.Period(last_actual_str, freq="M") if last_actual_str else None
    future = rates[rates.index > last_actual] if last_actual is not None else rates.tail(6)
    current = rates[rates.index <= last_actual] if last_actual is not None else rates.head(3)

    def _avg(df: pd.DataFrame) -> dict[str, float]:
        if len(df.index) == 0:
            return {c: 0.0 for c in rates.columns}
        return {c: float(df[c].mean()) for c in df.columns}

    a_cur = _avg(current)
    a_fut = _avg(future)
    deltas = {k: (a_fut[k] - a_cur.get(k, 0.0)) for k in a_fut}

    lines: list[str] = []
    lines.append(f"# Indirect Rate Forecast Narrative — {result.scenario}")
    lines.append("")
    lines.append("## Summary (avg current vs forecast)")
    for k, v in deltas.items():
        lines.append(f"- {k}: {a_cur.get(k, 0.0):.3f} → {a_fut.get(k, 0.0):.3f} (Δ {v:+.3f})")
    lines.append("")
    lines.append("## Assumptions")
    lines.append(f"- Forecast months: {result.assumptions.get('forecast_months')}")
    lines.append(f"- Run-rate months: {result.assumptions.get('run_rate_months')}")
    lines.append(f"- Events applied: {result.assumptions.get('events_applied', 0)}")
    lines.append("")
    if result.warnings:
        lines.append("## Data Quality / Warnings")
        for w in result.warnings:
            lines.append(f"- {w}")
        lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


def save_rate_charts(out_dir: str | Path, results: list[ForecastResult]) -> list[Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []

    if not results:
        return paths

    # Determine actuals cutoff for vertical marker
    last_actual_str = results[0].assumptions.get("last_actual_period")
    last_actual_ts = pd.Period(last_actual_str, freq="M").to_timestamp() if last_actual_str else None

    rate_names = list(results[0].rates.columns)
    for rate_name in rate_names:
        plt.figure(figsize=(10, 4))
        for res in results:
            series = res.rates[rate_name].copy()
            x = series.index.to_timestamp()
            color = plt.plot(x, series.values, label=f"{res.scenario} (MTD)")[0].get_color()
            # Overlay YTD as dashed line in same color
            if res.ytd_rates is not None and rate_name in res.ytd_rates.columns:
                ytd_series = res.ytd_rates[rate_name].copy()
                ytd_x = ytd_series.index.to_timestamp()
                plt.plot(ytd_x, ytd_series.values, color=color, linestyle="--", alpha=0.7, label=f"{res.scenario} (YTD)")
        # Actuals vs Forecast cutoff line
        if last_actual_ts is not None:
            plt.axvline(x=last_actual_ts, color="gray", linestyle=":", linewidth=1, alpha=0.6)
            ymin, ymax = plt.ylim()
            plt.text(
                last_actual_ts, ymax, "  Actuals | Forecast  ",
                fontsize=7, color="gray", alpha=0.8, ha="center", va="top",
                bbox=dict(boxstyle="round,pad=0.2", facecolor="white", alpha=0.7, edgecolor="gray"),
            )
        plt.title(f"{rate_name} Rate Forecast")
        plt.ylabel("Rate")
        plt.gca().yaxis.set_major_formatter(mtick.PercentFormatter(xmax=1.0, decimals=1))
        plt.grid(True, alpha=0.25)
        plt.legend()
        p = out_dir / f"rate_{_safe_filename(rate_name)}.png"
        plt.tight_layout()
        plt.savefig(p, dpi=160)
        plt.close()
        paths.append(p)
    return paths


def write_excel_pack(path: str | Path, results: list[ForecastResult]) -> None:
    path = Path(path)
    wb = Workbook()
    wb.remove(wb.active)

    for res in results:
        _add_df_sheet(wb, f"{res.scenario} - Rates", _with_period_col(res.rates))
        if res.ytd_rates is not None and not res.ytd_rates.empty:
            _add_df_sheet(wb, f"{res.scenario} - YTD Rates", _with_period_col(res.ytd_rates))
        _add_df_sheet(wb, f"{res.scenario} - Pools", _with_period_col(res.pools))
        _add_df_sheet(wb, f"{res.scenario} - Bases", _with_period_col(res.bases))
        _add_df_sheet(wb, f"{res.scenario} - Impacts", res.project_impacts)

    wb.save(path)


def _with_period_col(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out.index = out.index.astype(str)
    return out.reset_index(names="Period")


def _add_df_sheet(wb: Workbook, title: str, df: pd.DataFrame) -> None:
    df = _excel_safe_df(df)
    ws = wb.create_sheet(title=title[:31])
    for r in dataframe_to_rows(df, index=False, header=True):
        ws.append(r)
    ws.freeze_panes = "A2"


def _safe_filename(s: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in s).strip("_")


def _excel_safe_df(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for col in out.columns:
        if isinstance(out[col].dtype, pd.PeriodDtype):
            out[col] = out[col].astype(str)
            continue
        # Object columns may contain pd.Period or other non-Excel types.
        if out[col].dtype == "object":
            out[col] = out[col].map(lambda v: str(v) if isinstance(v, pd.Period) else v)
    return out
