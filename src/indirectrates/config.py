from __future__ import annotations

from dataclasses import dataclass, field
import importlib.resources
from pathlib import Path
from typing import Any, Mapping

import yaml


@dataclass(frozen=True)
class RateDefinition:
    pool: list[str]
    base: str
    cascade_order: int = 0


@dataclass(frozen=True)
class RateConfig:
    base_definitions: dict[str, Any]
    rates: dict[str, RateDefinition]
    unallowable_pool_names: set[str]
    base_account_map: dict[str, list[str]] = field(default_factory=dict)
    # e.g. {"DL": ["5100.01", "5100.02", ...], "TCI": ["5100.01", ..., "5300.01", ...]}

    @staticmethod
    def from_mapping(raw: Mapping[str, Any]) -> "RateConfig":
        base_definitions = dict(raw.get("base_definitions", {}))
        rates_raw: Mapping[str, Any] = raw.get("rates", {}) or {}
        rates = {
            name: RateDefinition(
                pool=list(v["pool"]),
                base=str(v["base"]),
                cascade_order=int(v.get("cascade_order", 0)),
            )
            for name, v in rates_raw.items()
        }
        unallowable = set(raw.get("unallowable_pool_names", []) or [])
        base_account_map = dict(raw.get("base_account_map", {}) or {})
        return RateConfig(
            base_definitions=base_definitions,
            rates=rates,
            unallowable_pool_names=unallowable,
            base_account_map=base_account_map,
        )

    @staticmethod
    def from_yaml(path: str | Path) -> "RateConfig":
        path = Path(path)
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        return RateConfig.from_mapping(raw)


def default_rate_config() -> RateConfig:
    text = importlib.resources.files("indirectrates.resources").joinpath("default_rates.yaml").read_text(encoding="utf-8")
    return RateConfig.from_mapping(yaml.safe_load(text))
