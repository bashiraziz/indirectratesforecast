from __future__ import annotations

import pandas as pd


def map_accounts_to_pools(gl_actuals: pd.DataFrame, account_map: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    gl = gl_actuals.copy()
    mp = account_map.copy()

    mp["Account"] = mp["Account"].astype(str)
    gl["Account"] = gl["Account"].astype(str)

    merged = gl.merge(mp[["Account", "Pool", "BaseCategory", "IsUnallowable"]], on="Account", how="left")
    warnings: list[str] = []

    missing = int(merged["Pool"].isna().sum())
    if missing:
        warnings.append(f"{missing} GL rows have no Account_Map match; treated as Unmapped (excluded from pools).")
        merged["Pool"] = merged["Pool"].fillna("Unmapped")
        merged["IsUnallowable"] = merged["IsUnallowable"].fillna(True)

    merged["IsUnallowable"] = merged["IsUnallowable"].fillna(False).astype(bool)
    merged["Amount"] = pd.to_numeric(merged["Amount"], errors="coerce").fillna(0.0)
    return merged, warnings
