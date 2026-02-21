"""Seed and clear sample test data for development/testing.

Populates the DB with a realistic FY, chart of accounts, pool structure,
and writes CSV files for the forecast engine.
"""

from __future__ import annotations

import csv
import random
import sqlite3
from pathlib import Path
from typing import Any

from . import db

FY_NAME = "FY2025-TEST"
FY_START = "2024-10"
FY_END = "2025-09"

RATE_GROUP_NAME = "Standard Rate Structure"

CHART_OF_ACCOUNTS = [
    # 5xxx — Direct costs
    {"account": "5100.01", "name": "Direct Labor - Engineers", "category": "Direct"},
    {"account": "5100.02", "name": "Direct Labor - Analysts", "category": "Direct"},
    {"account": "5100.03", "name": "Direct Labor - Admin", "category": "Direct"},
    {"account": "5200.01", "name": "Travel", "category": "Direct"},
    {"account": "5300.01", "name": "Subcontracts", "category": "Direct"},
    {"account": "5400.01", "name": "ODC / Materials", "category": "Direct"},
    # 6xxx — Fringe
    {"account": "6100.01", "name": "Health Insurance", "category": "Fringe"},
    {"account": "6100.02", "name": "401k Match", "category": "Fringe"},
    {"account": "6100.03", "name": "Payroll Taxes", "category": "Fringe"},
    {"account": "6100.04", "name": "Workers Comp", "category": "Fringe"},
    # 7xxx — Overhead
    {"account": "7100.01", "name": "Rent", "category": "Overhead"},
    {"account": "7100.02", "name": "Utilities", "category": "Overhead"},
    {"account": "7100.03", "name": "IT Equipment & Software", "category": "Overhead"},
    {"account": "7100.04", "name": "Office Supplies", "category": "Overhead"},
    {"account": "7100.05", "name": "Depreciation", "category": "Overhead"},
    # 8xxx — G&A
    {"account": "8100.01", "name": "Executive Salaries", "category": "G&A"},
    {"account": "8100.02", "name": "Accounting & Finance", "category": "G&A"},
    {"account": "8100.03", "name": "HR & Admin", "category": "G&A"},
    {"account": "8100.04", "name": "Business Development", "category": "G&A"},
    {"account": "8100.05", "name": "General Insurance", "category": "G&A"},
    # 9xxx — Unallowable
    {"account": "9100.01", "name": "Entertainment", "category": "Unallowable"},
    {"account": "9100.02", "name": "Alcohol", "category": "Unallowable"},
    {"account": "9100.03", "name": "Lobbying", "category": "Unallowable"},
]

# Pool structure: (pool_group_name, base, cascade_order, cost_accounts, base_accounts)
POOL_STRUCTURE = [
    {
        "name": "Fringe",
        "base": "DL",
        "cascade_order": 0,
        "cost_accounts": ["6100.01", "6100.02", "6100.03", "6100.04"],
        "base_accounts": ["5100.01", "5100.02", "5100.03"],
    },
    {
        "name": "Overhead",
        "base": "DL",
        "cascade_order": 1,
        "cost_accounts": ["7100.01", "7100.02", "7100.03", "7100.04", "7100.05"],
        "base_accounts": ["5100.01", "5100.02", "5100.03"],
    },
    {
        "name": "G&A",
        "base": "TCI",
        "cascade_order": 2,
        "cost_accounts": ["8100.01", "8100.02", "8100.03", "8100.04", "8100.05"],
        "base_accounts": ["5100.01", "5100.02", "5100.03", "5200.01", "5300.01", "5400.01"],
    },
    {
        "name": "Unallowable",
        "base": "DL",
        "cascade_order": 3,
        "cost_accounts": ["9100.01", "9100.02", "9100.03"],
        "base_accounts": [],
        "is_unallowable": True,
    },
]

# Monthly GL amounts (base amounts with +/- variation applied per month)
_GL_BASE_AMOUNTS: dict[str, float] = {
    # Direct
    "5100.01": 120000,   # DL Engineers
    "5100.02": 85000,    # DL Analysts
    "5100.03": 45000,    # DL Admin
    "5200.01": 8000,     # Travel
    "5300.01": 45000,    # Subcontracts
    "5400.01": 15000,    # ODC
    # Fringe
    "6100.01": 38000,    # Health Insurance
    "6100.02": 12500,    # 401k Match
    "6100.03": 19000,    # Payroll Taxes
    "6100.04": 3500,     # Workers Comp
    # Overhead
    "7100.01": 22000,    # Rent (fixed)
    "7100.02": 4500,     # Utilities
    "7100.03": 15000,    # IT Equipment
    "7100.04": 3000,     # Office Supplies
    "7100.05": 8000,     # Depreciation (fixed)
    # G&A
    "8100.01": 55000,    # Exec Salaries
    "8100.02": 25000,    # Accounting
    "8100.03": 18000,    # HR
    "8100.04": 12000,    # BD
    "8100.05": 6000,     # Insurance
    # Unallowable
    "9100.01": 2500,     # Entertainment
    "9100.02": 800,      # Alcohol
    "9100.03": 1500,     # Lobbying
}

# Accounts with fixed amounts (no variation)
_FIXED_ACCOUNTS = {"7100.01", "7100.05"}

PERIODS = ["2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03"]

# Project definitions: (name, DL_base, Subk_base, ODC_base, Travel_base)
PROJECTS = [
    {"name": "PROJ-ALPHA", "dl": 180000, "subk": 30000, "odc": 12000, "travel": 5000},
    {"name": "PROJ-BETA", "dl": 90000, "subk": 10000, "odc": 5000, "travel": 2000},
    {"name": "PROJ-GAMMA", "dl": 45000, "subk": 5000, "odc": 3000, "travel": 1000},
]


def _vary(base: float, pct: float = 0.08, rng: random.Random | None = None) -> float:
    """Apply random variation to a base amount."""
    r = rng or random
    return round(base * (1 + r.uniform(-pct, pct)), 2)


def seed_test_data(conn: sqlite3.Connection, data_dir: Path | str) -> dict[str, Any]:
    """Seed the database with sample test data and write CSV files.

    Returns a summary dict with counts of created items.
    """
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(42)

    # Check if already seeded
    existing = conn.execute(
        "SELECT id FROM fiscal_years WHERE name = ?", (FY_NAME,)
    ).fetchone()
    if existing:
        return {"error": f"Fiscal year '{FY_NAME}' already exists. Clear first."}

    # 1. Create fiscal year
    fy_id = db.create_fiscal_year(conn, FY_NAME, FY_START, FY_END)

    # 2. Bulk-insert chart of accounts
    db.bulk_create_chart_accounts(conn, fy_id, CHART_OF_ACCOUNTS)

    # 3. Create rate group
    rg_id = db.create_rate_group(conn, fy_id, RATE_GROUP_NAME)

    # 4. Create pool groups, pools, GL mappings, and base accounts
    pool_group_count = 0
    pool_count = 0
    gl_mapping_count = 0
    base_account_count = 0

    for ps in POOL_STRUCTURE:
        pg_id = db.create_pool_group(
            conn, fy_id, ps["name"],
            base=ps["base"],
            display_order=ps.get("display_order", ps["cascade_order"]),
            rate_group_id=rg_id,
            cascade_order=ps["cascade_order"],
        )
        pool_group_count += 1

        # Create a single pool with same name as group
        pool_id = db.create_pool(conn, pg_id, ps["name"])
        pool_count += 1

        # Add cost accounts (GL mappings)
        is_unallowable = ps.get("is_unallowable", False)
        for acct in ps["cost_accounts"]:
            db.create_gl_mapping(conn, pool_id, acct, is_unallowable=is_unallowable)
            gl_mapping_count += 1

        # Add base accounts
        for acct in ps["base_accounts"]:
            db.create_base_account(conn, pg_id, acct)
            base_account_count += 1

    # 5. Write CSV files
    _write_gl_actuals(data_dir, rng)
    _write_direct_costs(data_dir, rng)
    _write_account_map(data_dir)
    _write_scenario_events(data_dir)

    return {
        "fiscal_year": FY_NAME,
        "fiscal_year_id": fy_id,
        "chart_accounts": len(CHART_OF_ACCOUNTS),
        "rate_groups": 1,
        "pool_groups": pool_group_count,
        "pools": pool_count,
        "gl_mappings": gl_mapping_count,
        "base_accounts": base_account_count,
        "csv_files": 4,
    }


def clear_test_data(conn: sqlite3.Connection, data_dir: Path | str) -> dict[str, Any]:
    """Remove test fiscal year (CASCADE deletes children) and CSV files."""
    data_dir = Path(data_dir)

    row = conn.execute(
        "SELECT id FROM fiscal_years WHERE name = ?", (FY_NAME,)
    ).fetchone()

    deleted_fy = False
    if row:
        db.delete_fiscal_year(conn, row["id"])
        deleted_fy = True

    # Remove CSV files
    csv_files = ["GL_Actuals.csv", "Direct_Costs_By_Project.csv", "Account_Map.csv", "Scenario_Events.csv"]
    removed = 0
    for fname in csv_files:
        p = data_dir / fname
        if p.exists():
            p.unlink()
            removed += 1

    return {"deleted_fy": deleted_fy, "csv_files_removed": removed}


def _write_gl_actuals(data_dir: Path, rng: random.Random) -> None:
    rows = []
    for period in PERIODS:
        for acct, base_amt in _GL_BASE_AMOUNTS.items():
            if acct in _FIXED_ACCOUNTS:
                amt = base_amt
            else:
                amt = _vary(base_amt, rng=rng)
            rows.append({"Period": period, "Account": acct, "Amount": amt})

    with open(data_dir / "GL_Actuals.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["Period", "Account", "Amount"])
        writer.writeheader()
        writer.writerows(rows)


def _write_direct_costs(data_dir: Path, rng: random.Random) -> None:
    rows = []
    for period in PERIODS:
        for proj in PROJECTS:
            dl = _vary(proj["dl"], rng=rng)
            # Approximate hours from dollar amount (~$75/hr avg)
            hrs = round(dl / 75, 1)
            rows.append({
                "Period": period,
                "Project": proj["name"],
                "DirectLabor$": dl,
                "DirectLaborHrs": hrs,
                "Subk": _vary(proj["subk"], rng=rng),
                "ODC": _vary(proj["odc"], rng=rng),
                "Travel": _vary(proj["travel"], rng=rng),
            })

    with open(data_dir / "Direct_Costs_By_Project.csv", "w", newline="") as f:
        writer = csv.DictWriter(
            f, fieldnames=["Period", "Project", "DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"]
        )
        writer.writeheader()
        writer.writerows(rows)


def _write_account_map(data_dir: Path) -> None:
    rows = []
    for ps in POOL_STRUCTURE:
        is_unallowable = ps.get("is_unallowable", False)
        for acct in ps["cost_accounts"]:
            entry = next(a for a in CHART_OF_ACCOUNTS if a["account"] == acct)
            rows.append({
                "Account": acct,
                "Pool": ps["name"],
                "BaseCategory": ps["base"],
                "IsUnallowable": is_unallowable,
                "Notes": entry["name"],
            })

    with open(data_dir / "Account_Map.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["Account", "Pool", "BaseCategory", "IsUnallowable", "Notes"])
        writer.writeheader()
        writer.writerows(rows)


def _write_scenario_events(data_dir: Path) -> None:
    header = (
        "Scenario,EffectivePeriod,Type,Project,"
        "DeltaDirectLabor$,DeltaDirectLaborHrs,DeltaSubk,DeltaODC,DeltaTravel,"
        "DeltaPoolFringe,DeltaPoolOverhead,DeltaPoolGA,Notes\n"
    )
    row = "Base,2025-01,ADJUST,,0,0,0,0,0,0,0,0,No changes\n"
    (data_dir / "Scenario_Events.csv").write_text(header + row)
