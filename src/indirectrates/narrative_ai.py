"""Gemini-powered narrative generation for forecast results.

Generates richer, analyst-quality narrative summaries using Google Gemini.
Falls back to the template-based narrative if GEMINI_API_KEY is not set
or if the API call fails.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pandas as pd

from .types import ForecastResult


def _build_prompt(result: ForecastResult) -> str:
    """Build a structured prompt with forecast data for Gemini."""
    rates = result.rates.copy()
    last_actual_str = result.assumptions.get("last_actual_period")
    last_actual = pd.Period(last_actual_str, freq="M") if last_actual_str else None
    future = rates[rates.index > last_actual] if last_actual is not None else rates.tail(6)
    current = rates[rates.index <= last_actual].tail(3) if last_actual is not None else rates.head(3)

    def _avg(df: pd.DataFrame) -> dict[str, float]:
        if len(df.index) == 0:
            return {c: 0.0 for c in rates.columns}
        return {c: float(df[c].mean()) for c in df.columns}

    a_cur = _avg(current)
    a_fut = _avg(future)

    # Build rate trend table
    rate_lines = []
    for col in rates.columns:
        rate_lines.append(f"  {col}: current avg {a_cur.get(col, 0):.4f} → forecast avg {a_fut.get(col, 0):.4f}")

    # Pool and base summaries
    pool_summary = result.pools.tail(3).to_string()
    base_summary = result.bases.tail(3).to_string()

    # Project impact summary
    impacts = result.project_impacts
    projects = sorted(impacts["Project"].unique().tolist())
    total_loaded = impacts.groupby("Project")["LoadedCost$"].sum()

    prompt = f"""You are a GovCon indirect rate analyst. Write a concise management narrative for this forecast.

Scenario: {result.scenario}
Forecast months: {result.assumptions.get('forecast_months')}
Run-rate months: {result.assumptions.get('run_rate_months')}
Events applied: {result.assumptions.get('events_applied', 0)}

Rate trends:
{chr(10).join(rate_lines)}

Recent pool costs (last 3 actual periods):
{pool_summary}

Recent allocation bases (last 3 actual periods):
{base_summary}

Projects: {', '.join(projects)}
Total loaded cost by project:
{total_loaded.to_string()}

Warnings: {'; '.join(result.warnings) if result.warnings else 'None'}

Write a 3-5 paragraph narrative covering:
1. Executive summary of rate trends (improving, worsening, stable)
2. Key drivers behind rate movements (pool cost changes, base changes)
3. Project impact highlights (which projects carry the most loaded cost)
4. Risks or data quality concerns from warnings
5. Recommendations or areas to watch

Use markdown formatting. Be specific with numbers. Keep it under 500 words."""

    return prompt


def generate_ai_narrative(result: ForecastResult) -> str | None:
    """Generate an AI-powered narrative using Gemini.

    Returns the narrative text, or None if Gemini is unavailable.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None

    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        prompt = _build_prompt(result)
        response = model.generate_content(prompt)
        return response.text
    except Exception:
        return None


def write_ai_narrative(path: str | Path, result: ForecastResult) -> bool:
    """Write a Gemini-generated narrative to file.

    Returns True if AI narrative was written, False if it fell back to template.
    """
    from .reporting import write_narrative

    narrative = generate_ai_narrative(result)
    if narrative:
        path = Path(path)
        path.write_text(narrative, encoding="utf-8")
        return True

    # Fallback to template-based narrative
    write_narrative(path, result)
    return False
