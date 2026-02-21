from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .config import RateConfig
from .io import load_inputs
from .mapping import map_accounts_to_pools
from .model import apply_scenario_events, build_baseline_projection, compute_actual_aggregates, compute_rates_and_impacts
from .normalize import normalize_inputs
from .narrative_ai import write_ai_narrative
from .reporting import save_rate_charts, write_assumptions, write_excel_pack, write_narrative
from .types import ForecastResult


@dataclass(frozen=True)
class ScenarioPlan:
    scenarios: list[str]
    forecast_months: int
    run_rate_months: int


class PlannerAgent:
    def plan(self, scenario: str | None, forecast_months: int, run_rate_months: int, events_path: Path) -> ScenarioPlan:
        scenarios: list[str]
        if scenario:
            scenarios = [scenario]
        else:
            import pandas as pd

            ev = pd.read_csv(events_path)
            if "Scenario" in ev.columns:
                scenarios = sorted({str(x) for x in ev["Scenario"].fillna("Base").unique()})
            else:
                scenarios = ["Base"]
        return ScenarioPlan(scenarios=scenarios, forecast_months=forecast_months, run_rate_months=run_rate_months)


class AnalystAgent:
    def run(self, input_dir: Path, config: RateConfig, plan: ScenarioPlan) -> list[ForecastResult]:
        inputs = load_inputs(input_dir)
        gl, mp, direct, events, warnings = normalize_inputs(
            inputs.gl_actuals, inputs.account_map, inputs.direct_costs, inputs.scenario_events
        )
        gl_mapped, map_warnings = map_accounts_to_pools(gl, mp)
        warnings.extend(map_warnings)

        actual_pools, actual_bases, direct_by_project, agg_warnings = compute_actual_aggregates(gl_mapped, direct, config)
        warnings.extend(agg_warnings)

        baseline = build_baseline_projection(
            actual_pools,
            actual_bases,
            direct_by_project,
            forecast_months=plan.forecast_months,
            run_rate_months=plan.run_rate_months,
        )

        results: list[ForecastResult] = []
        for scenario in plan.scenarios:
            proj = apply_scenario_events(baseline, events, scenario=scenario)
            rates, impacts = compute_rates_and_impacts(proj, config)
            assumptions = dict(proj.assumptions)
            results.append(
                ForecastResult(
                    scenario=scenario,
                    periods=rates.index,
                    pools=proj.pools,
                    bases=proj.bases,
                    rates=rates,
                    project_impacts=impacts,
                    assumptions=assumptions,
                    warnings=list(dict.fromkeys(warnings + proj.warnings)),
                )
            )
        return results


class ReporterAgent:
    def package(self, out_dir: Path, results: list[ForecastResult]) -> None:
        out_dir.mkdir(parents=True, exist_ok=True)
        charts_dir = out_dir / "charts"
        save_rate_charts(charts_dir, results)
        write_excel_pack(out_dir / "rate_pack.xlsx", results)

        for res in results:
            scen_dir = out_dir / res.scenario
            scen_dir.mkdir(parents=True, exist_ok=True)
            write_ai_narrative(scen_dir / "narrative.md", res)
            write_assumptions(scen_dir / "assumptions.json", res.assumptions)

        base = next((r for r in results if r.scenario == "Base"), results[0])
        write_ai_narrative(out_dir / "narrative.md", base)
        write_assumptions(out_dir / "assumptions.json", base.assumptions)
