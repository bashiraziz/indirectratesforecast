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
    {"account": "5001", "name": "Direct Labor - Engineers", "category": "Labor"},
    {"account": "5002", "name": "Direct Labor - Analysts", "category": "Labor"},
    {"account": "5003", "name": "Direct Labor - Admin", "category": "Labor"},
    {"account": "6001", "name": "Health Insurance", "category": "Fringe"},
    {"account": "6002", "name": "401k Match", "category": "Fringe"},
    {"account": "6003", "name": "Payroll Taxes", "category": "Fringe"},
    {"account": "6004", "name": "Workers Comp", "category": "Fringe"},
    {"account": "6101", "name": "Rent", "category": "Overhead"},
    {"account": "6102", "name": "Utilities", "category": "Overhead"},
    {"account": "6103", "name": "IT Equipment & Software", "category": "Overhead"},
    {"account": "6104", "name": "Office Supplies", "category": "Overhead"},
    {"account": "6105", "name": "Depreciation", "category": "Overhead"},
    {"account": "7001", "name": "Executive Salaries", "category": "G&A"},
    {"account": "7002", "name": "Accounting & Finance", "category": "G&A"},
    {"account": "7003", "name": "HR & Admin", "category": "G&A"},
    {"account": "7004", "name": "Business Development", "category": "G&A"},
    {"account": "7005", "name": "General Insurance", "category": "G&A"},
    {"account": "8001", "name": "Travel", "category": "Direct"},
    {"account": "8002", "name": "Subcontracts", "category": "Direct"},
    {"account": "8003", "name": "ODC / Materials", "category": "Direct"},
]

# Pool structure: (pool_group_name, base, cascade_order, cost_accounts, base_accounts)
POOL_STRUCTURE = [
    {
        "name": "Fringe",
        "base": "DL",
        "cascade_order": 0,
        "cost_accounts": ["6001", "6002", "6003", "6004"],
        "base_accounts": ["5001", "5002", "5003"],
    },
    {
        "name": "Overhead",
        "base": "DL",
        "cascade_order": 1,
        "cost_accounts": ["6101", "6102", "6103", "6104", "6105"],
        "base_accounts": ["5001", "5002", "5003"],
    },
    {
        "name": "G&A",
        "base": "TCI",
        "cascade_order": 2,
        "cost_accounts": ["7001", "7002", "7003", "7004", "7005"],
        "base_accounts": ["5001", "5002", "5003", "8001", "8002", "8003"],
    },
]

# Monthly GL amounts (base amounts with +/- variation applied per month)
_GL_BASE_AMOUNTS: dict[str, float] = {
    "5001": 120000,   # DL Engineers
    "5002": 85000,    # DL Analysts
    "5003": 45000,    # DL Admin
    "6001": 38000,    # Health Insurance
    "6002": 12500,    # 401k Match
    "6003": 19000,    # Payroll Taxes
    "6004": 3500,     # Workers Comp
    "6101": 22000,    # Rent (fixed)
    "6102": 4500,     # Utilities
    "6103": 15000,    # IT Equipment
    "6104": 3000,     # Office Supplies
    "6105": 8000,     # Depreciation (fixed)
    "7001": 55000,    # Exec Salaries
    "7002": 25000,    # Accounting
    "7003": 18000,    # HR
    "7004": 12000,    # BD
    "7005": 6000,     # Insurance
    "8001": 8000,     # Travel
    "8002": 45000,    # Subcontracts
    "8003": 15000,    # ODC
}

# Accounts with fixed amounts (no variation)
_FIXED_ACCOUNTS = {"6101", "6105"}

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
            display_order=ps["cascade_order"],
            rate_group_id=rg_id,
            cascade_order=ps["cascade_order"],
        )
        pool_group_count += 1

        # Create a single pool with same name as group
        pool_id = db.create_pool(conn, pg_id, ps["name"])
        pool_count += 1

        # Add cost accounts (GL mappings)
        for acct in ps["cost_accounts"]:
            db.create_gl_mapping(conn, pool_id, acct)
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
        for acct in ps["cost_accounts"]:
            entry = next(a for a in CHART_OF_ACCOUNTS if a["account"] == acct)
            rows.append({
                "Account": acct,
                "Pool": ps["name"],
                "BaseCategory": ps["base"],
                "IsUnallowable": False,
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
