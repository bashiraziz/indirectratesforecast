"""Generate realistic enterprise demo data for Meridian Federal Solutions.

Populates DB with 4 fiscal years, ~60 GL accounts, 30 projects, 6 pool groups,
8 scenarios per FY, budget/provisional rates, revenue, and writes CSV files.
"""

from __future__ import annotations

import csv
import json
import random
from pathlib import Path
from typing import Any

from . import db

# ---------------------------------------------------------------------------
# Fiscal years
# ---------------------------------------------------------------------------

FY_DEFS = [
    {"name": "DEMO-FY2023", "start": "2022-10", "end": "2023-09"},
    {"name": "DEMO-FY2024", "start": "2023-10", "end": "2024-09"},
    {"name": "DEMO-FY2025", "start": "2024-10", "end": "2025-09"},
    {"name": "DEMO-FY2026", "start": "2025-10", "end": "2026-09"},
]

DEMO_FY_PREFIX = "DEMO-"

# FY2026 partial through Mar 2026
FY2026_LAST_ACTUAL = "2026-03"

RATE_GROUP_NAME = "Standard Rate Structure"

# ---------------------------------------------------------------------------
# Chart of Accounts (~60 accounts)
# ---------------------------------------------------------------------------

CHART_OF_ACCOUNTS = [
    # 5100.xx — Direct Labor (8 accounts)
    {"account": "5100.01", "name": "Direct Labor - Engineers", "category": "Direct"},
    {"account": "5100.02", "name": "Direct Labor - Sr Engineers", "category": "Direct"},
    {"account": "5100.03", "name": "Direct Labor - Analysts", "category": "Direct"},
    {"account": "5100.04", "name": "Direct Labor - Project Managers", "category": "Direct"},
    {"account": "5100.05", "name": "Direct Labor - Architects", "category": "Direct"},
    {"account": "5100.06", "name": "Direct Labor - QA/Test", "category": "Direct"},
    {"account": "5100.07", "name": "Direct Labor - Admin Support", "category": "Direct"},
    {"account": "5100.08", "name": "Direct Labor - Interns", "category": "Direct"},
    # 5200.xx — Travel (3 accounts)
    {"account": "5200.01", "name": "Travel - Domestic", "category": "Direct"},
    {"account": "5200.02", "name": "Travel - International", "category": "Direct"},
    {"account": "5200.03", "name": "Travel - Per Diem & Lodging", "category": "Direct"},
    # 5300.xx — Subcontracts (3 accounts)
    {"account": "5300.01", "name": "Subcontracts - Major Subs", "category": "Direct"},
    {"account": "5300.02", "name": "Subcontracts - Specialty Subs", "category": "Direct"},
    {"account": "5300.03", "name": "Subcontracts - Consulting", "category": "Direct"},
    # 5400.xx — ODC (4 accounts)
    {"account": "5400.01", "name": "ODC - Materials", "category": "Direct"},
    {"account": "5400.02", "name": "ODC - Equipment Purchases", "category": "Direct"},
    {"account": "5400.03", "name": "ODC - Software Licenses", "category": "Direct"},
    {"account": "5400.04", "name": "ODC - Office Supplies", "category": "Direct"},
    # 6100.xx — Fringe (7 accounts)
    {"account": "6100.01", "name": "Health Insurance", "category": "Fringe"},
    {"account": "6100.02", "name": "Dental & Vision", "category": "Fringe"},
    {"account": "6100.03", "name": "401k Match", "category": "Fringe"},
    {"account": "6100.04", "name": "Payroll Taxes (FICA/FUTA/SUTA)", "category": "Fringe"},
    {"account": "6100.05", "name": "Workers Compensation", "category": "Fringe"},
    {"account": "6100.06", "name": "PTO Accrual", "category": "Fringe"},
    {"account": "6100.07", "name": "Life & Disability Insurance", "category": "Fringe"},
    # 7100.xx — Overhead (10 accounts)
    {"account": "7100.01", "name": "Rent & Facilities", "category": "Overhead"},
    {"account": "7100.02", "name": "Utilities", "category": "Overhead"},
    {"account": "7100.03", "name": "IT Infrastructure", "category": "Overhead"},
    {"account": "7100.04", "name": "Software Tools & Subscriptions", "category": "Overhead"},
    {"account": "7100.05", "name": "Depreciation", "category": "Overhead"},
    {"account": "7100.06", "name": "Building Maintenance", "category": "Overhead"},
    {"account": "7100.07", "name": "Telecommunications", "category": "Overhead"},
    {"account": "7100.08", "name": "Training & Development", "category": "Overhead"},
    {"account": "7100.09", "name": "Recruiting Costs", "category": "Overhead"},
    {"account": "7100.10", "name": "Facility Security", "category": "Overhead"},
    # 8100.xx — G&A (8 accounts)
    {"account": "8100.01", "name": "Executive Compensation", "category": "G&A"},
    {"account": "8100.02", "name": "Accounting & Finance", "category": "G&A"},
    {"account": "8100.03", "name": "Human Resources", "category": "G&A"},
    {"account": "8100.04", "name": "Legal Services", "category": "G&A"},
    {"account": "8100.05", "name": "Business Development", "category": "G&A"},
    {"account": "8100.06", "name": "Marketing & Communications", "category": "G&A"},
    {"account": "8100.07", "name": "Corporate Insurance", "category": "G&A"},
    {"account": "8100.08", "name": "Audit & Compliance", "category": "G&A"},
    # 8200.xx — B&P (2 accounts)
    {"account": "8200.01", "name": "Proposal Labor", "category": "B&P"},
    {"account": "8200.02", "name": "Proposal Materials & Printing", "category": "B&P"},
    # 8300.xx — IR&D (2 accounts)
    {"account": "8300.01", "name": "Research Labor", "category": "IR&D"},
    {"account": "8300.02", "name": "Research Materials & Equipment", "category": "IR&D"},
    # 9100.xx — Unallowable (5 accounts)
    {"account": "9100.01", "name": "Entertainment", "category": "Unallowable"},
    {"account": "9100.02", "name": "Alcohol", "category": "Unallowable"},
    {"account": "9100.03", "name": "Lobbying", "category": "Unallowable"},
    {"account": "9100.04", "name": "Fines & Penalties", "category": "Unallowable"},
    {"account": "9100.05", "name": "Charitable Donations", "category": "Unallowable"},
]

# ---------------------------------------------------------------------------
# Pool structure (6 groups)
# ---------------------------------------------------------------------------

DL_ACCOUNTS = [f"5100.0{i}" for i in range(1, 9)]
ALL_DIRECT = DL_ACCOUNTS + [
    "5200.01", "5200.02", "5200.03",
    "5300.01", "5300.02", "5300.03",
    "5400.01", "5400.02", "5400.03", "5400.04",
]

POOL_STRUCTURE = [
    {
        "name": "Fringe",
        "base": "DL",
        "cascade_order": 0,
        "cost_accounts": ["6100.01", "6100.02", "6100.03", "6100.04", "6100.05", "6100.06", "6100.07"],
        "base_accounts": DL_ACCOUNTS,
    },
    {
        "name": "Overhead",
        "base": "DL",
        "cascade_order": 1,
        "cost_accounts": [
            "7100.01", "7100.02", "7100.03", "7100.04", "7100.05",
            "7100.06", "7100.07", "7100.08", "7100.09", "7100.10",
        ],
        "base_accounts": DL_ACCOUNTS,
    },
    {
        "name": "Material Handling",
        "base": "DL",
        "cascade_order": 2,
        "cost_accounts": ["5400.01", "5400.02"],  # subset of ODC — materials & equipment
        "base_accounts": DL_ACCOUNTS,
        "is_unallowable": False,
    },
    {
        "name": "B&P/IR&D",
        "base": "TCI",
        "cascade_order": 3,
        "cost_accounts": ["8200.01", "8200.02", "8300.01", "8300.02"],
        "base_accounts": ALL_DIRECT,
    },
    {
        "name": "G&A",
        "base": "TCI",
        "cascade_order": 4,
        "cost_accounts": [
            "8100.01", "8100.02", "8100.03", "8100.04",
            "8100.05", "8100.06", "8100.07", "8100.08",
        ],
        "base_accounts": ALL_DIRECT,
    },
    {
        "name": "Unallowable",
        "base": "DL",
        "cascade_order": 5,
        "cost_accounts": ["9100.01", "9100.02", "9100.03", "9100.04", "9100.05"],
        "base_accounts": [],
        "is_unallowable": True,
    },
]

# ---------------------------------------------------------------------------
# GL base amounts per month (FY2023 baseline, grows ~5% per year)
# ---------------------------------------------------------------------------

# NOTE: Direct accounts (5xxx) are calibrated to match Direct_Costs_By_Project totals
# so GL-derived and project-derived bases agree within ~5%.
# DL base ~$1.65M/mo at FY2023 steady state, TCI ~$2.06M.
# Pool amounts (6xxx, 7xxx, 8xxx) produce realistic rates:
#   Fringe ~31% of DL, OH ~55% of DL, G&A ~15% of TCI, B&P/IR&D ~4% of TCI
_GL_BASE_AMOUNTS: dict[str, float] = {
    # Direct Labor (~$1.654M/mo total, aligned to project DL)
    "5100.01": 438000,   # Engineers
    "5100.02": 305000,   # Sr Engineers
    "5100.03": 227000,   # Analysts
    "5100.04": 258000,   # PMs
    "5100.05": 172000,   # Architects
    "5100.06": 133000,   # QA/Test
    "5100.07": 86000,    # Admin Support
    "5100.08": 35000,    # Interns
    # Travel (~$55K/mo, aligned to project travel)
    "5200.01": 30000,    # Domestic
    "5200.02": 10000,    # International
    "5200.03": 15000,    # Per Diem
    # Subcontracts (~$230K/mo, aligned to project subk)
    "5300.01": 145000,   # Major Subs
    "5300.02": 55000,    # Specialty Subs
    "5300.03": 30000,    # Consulting
    # ODC (~$118K/mo, aligned to project ODC)
    "5400.01": 43000,    # Materials
    "5400.02": 30000,    # Equipment
    "5400.03": 35000,    # Software Licenses
    "5400.04": 10000,    # Supplies
    # Fringe (~$513K/mo -> ~31% of $1.654M DL base)
    "6100.01": 160000,   # Health
    "6100.02": 32000,    # Dental/Vision
    "6100.03": 58000,    # 401k
    "6100.04": 130000,   # Payroll Taxes
    "6100.05": 14000,    # Workers Comp
    "6100.06": 100000,   # PTO
    "6100.07": 19000,    # Life/Disability
    # Overhead (~$910K/mo -> ~55% of $1.654M DL base)
    "7100.01": 185000,   # Rent (fixed)
    "7100.02": 32000,    # Utilities
    "7100.03": 175000,   # IT Infra
    "7100.04": 105000,   # Software Tools
    "7100.05": 82000,    # Depreciation (fixed)
    "7100.06": 22000,    # Maintenance
    "7100.07": 42000,    # Telecom
    "7100.08": 72000,    # Training
    "7100.09": 85000,    # Recruiting
    "7100.10": 48000,    # Security
    # G&A (~$323K/mo -> ~15.7% of $2.06M TCI base)
    "8100.01": 105000,   # Exec Comp
    "8100.02": 48000,    # Accounting
    "8100.03": 38000,    # HR
    "8100.04": 28000,    # Legal
    "8100.05": 52000,    # BD
    "8100.06": 20000,    # Marketing
    "8100.07": 18000,    # Insurance
    "8100.08": 14000,    # Audit
    # B&P/IR&D (~$86K/mo -> ~4.2% of $2.06M TCI base)
    "8200.01": 45000,    # Proposal Labor
    "8200.02": 9000,     # Proposal Materials
    "8300.01": 24000,    # Research Labor
    "8300.02": 8000,     # Research Materials
    # Unallowable (<0.5% of costs)
    "9100.01": 3500,     # Entertainment
    "9100.02": 800,      # Alcohol
    "9100.03": 1200,     # Lobbying
    "9100.04": 500,      # Fines
    "9100.05": 2000,     # Donations
}

# Fixed-cost accounts with minimal variation
_FIXED_ACCOUNTS = {"7100.01", "7100.05"}

# ---------------------------------------------------------------------------
# Project definitions (30 projects)
# ---------------------------------------------------------------------------

# avg hourly rates by labor category
_HOURLY_RATES = {
    "IT": 92, "Engineering": 105, "Consulting": 88,
    "R&D": 98, "TaskOrder": 78,
}

PROJECTS = [
    # IT Services (8)
    {"name": "CLOUD-MIGR-001", "type": "T&M",   "ftes": 15, "cat": "IT",          "start_fy": 0, "end_fy": 3, "subk_pct": 0.15, "odc_pct": 0.08, "travel_pct": 0.03, "fee_pct": 0.07},
    {"name": "CYBER-OPS-002",  "type": "CPFF",  "ftes": 12, "cat": "IT",          "start_fy": 0, "end_fy": 2, "subk_pct": 0.10, "odc_pct": 0.05, "travel_pct": 0.02, "fee_pct": 0.06},
    {"name": "APP-MOD-003",    "type": "FFP",   "ftes": 8,  "cat": "IT",          "start_fy": 1, "end_fy": 3, "subk_pct": 0.12, "odc_pct": 0.06, "travel_pct": 0.02, "fee_pct": 0.08},
    {"name": "DATA-ANLYT-004", "type": "T&M",   "ftes": 6,  "cat": "IT",          "start_fy": 1, "end_fy": 3, "subk_pct": 0.08, "odc_pct": 0.10, "travel_pct": 0.01, "fee_pct": 0.07},
    {"name": "ZERO-TRUST-005", "type": "CPFF",  "ftes": 10, "cat": "IT",          "start_fy": 2, "end_fy": 3, "subk_pct": 0.18, "odc_pct": 0.07, "travel_pct": 0.03, "fee_pct": 0.06},
    {"name": "AI-ML-006",      "type": "CPAF",  "ftes": 7,  "cat": "IT",          "start_fy": 2, "end_fy": 3, "subk_pct": 0.05, "odc_pct": 0.12, "travel_pct": 0.01, "fee_pct": 0.05},
    {"name": "DEVSECOPS-007",  "type": "T&M",   "ftes": 5,  "cat": "IT",          "start_fy": 0, "end_fy": 1, "subk_pct": 0.10, "odc_pct": 0.04, "travel_pct": 0.02, "fee_pct": 0.07},
    {"name": "LEGACY-SYS-008", "type": "FFP",   "ftes": 4,  "cat": "IT",          "start_fy": 0, "end_fy": 1, "subk_pct": 0.05, "odc_pct": 0.03, "travel_pct": 0.01, "fee_pct": 0.06},
    # Engineering (7)
    {"name": "SYS-ENG-101",    "type": "CPFF",  "ftes": 20, "cat": "Engineering", "start_fy": 0, "end_fy": 3, "subk_pct": 0.25, "odc_pct": 0.10, "travel_pct": 0.04, "fee_pct": 0.07},
    {"name": "TEST-EVAL-102",  "type": "CPAF",  "ftes": 12, "cat": "Engineering", "start_fy": 0, "end_fy": 2, "subk_pct": 0.20, "odc_pct": 0.08, "travel_pct": 0.03, "fee_pct": 0.06},
    {"name": "HW-INTEG-103",   "type": "CPFF",  "ftes": 8,  "cat": "Engineering", "start_fy": 1, "end_fy": 3, "subk_pct": 0.30, "odc_pct": 0.15, "travel_pct": 0.05, "fee_pct": 0.07},
    {"name": "RADAR-DEV-104",  "type": "CPFF",  "ftes": 15, "cat": "Engineering", "start_fy": 1, "end_fy": 3, "subk_pct": 0.22, "odc_pct": 0.12, "travel_pct": 0.04, "fee_pct": 0.08},
    {"name": "PROTO-FAB-105",  "type": "FFP",   "ftes": 6,  "cat": "Engineering", "start_fy": 2, "end_fy": 3, "subk_pct": 0.15, "odc_pct": 0.20, "travel_pct": 0.02, "fee_pct": 0.06},
    {"name": "ENV-TEST-106",   "type": "T&M",   "ftes": 4,  "cat": "Engineering", "start_fy": 0, "end_fy": 1, "subk_pct": 0.10, "odc_pct": 0.08, "travel_pct": 0.03, "fee_pct": 0.07},
    {"name": "QUAL-ASSUR-107", "type": "CPFF",  "ftes": 3,  "cat": "Engineering", "start_fy": 0, "end_fy": 2, "subk_pct": 0.05, "odc_pct": 0.04, "travel_pct": 0.02, "fee_pct": 0.06},
    # Professional Services (6)
    {"name": "PROG-MGMT-201",  "type": "T&M",   "ftes": 8,  "cat": "Consulting",  "start_fy": 0, "end_fy": 3, "subk_pct": 0.05, "odc_pct": 0.03, "travel_pct": 0.06, "fee_pct": 0.08},
    {"name": "STRAT-ADV-202",  "type": "T&M",   "ftes": 5,  "cat": "Consulting",  "start_fy": 0, "end_fy": 2, "subk_pct": 0.03, "odc_pct": 0.02, "travel_pct": 0.08, "fee_pct": 0.09},
    {"name": "TRAIN-DEV-203",  "type": "FFP",   "ftes": 4,  "cat": "Consulting",  "start_fy": 1, "end_fy": 3, "subk_pct": 0.04, "odc_pct": 0.05, "travel_pct": 0.04, "fee_pct": 0.07},
    {"name": "CHANGE-MGT-204", "type": "T&M",   "ftes": 3,  "cat": "Consulting",  "start_fy": 2, "end_fy": 3, "subk_pct": 0.02, "odc_pct": 0.02, "travel_pct": 0.05, "fee_pct": 0.08},
    {"name": "ACQN-SUPP-205",  "type": "CPFF",  "ftes": 6,  "cat": "Consulting",  "start_fy": 1, "end_fy": 3, "subk_pct": 0.06, "odc_pct": 0.03, "travel_pct": 0.04, "fee_pct": 0.06},
    {"name": "POLICY-REV-206", "type": "FFP",   "ftes": 2,  "cat": "Consulting",  "start_fy": 0, "end_fy": 1, "subk_pct": 0.02, "odc_pct": 0.01, "travel_pct": 0.03, "fee_pct": 0.06},
    # R&D (5)
    {"name": "QUANTUM-R-301",  "type": "CPFF",  "ftes": 5,  "cat": "R&D",         "start_fy": 1, "end_fy": 3, "subk_pct": 0.08, "odc_pct": 0.15, "travel_pct": 0.02, "fee_pct": 0.07},
    {"name": "EDGE-COMP-302",  "type": "CPFF",  "ftes": 4,  "cat": "R&D",         "start_fy": 1, "end_fy": 3, "subk_pct": 0.06, "odc_pct": 0.12, "travel_pct": 0.01, "fee_pct": 0.06},
    {"name": "AUTO-TEST-303",  "type": "CPFF",  "ftes": 3,  "cat": "R&D",         "start_fy": 2, "end_fy": 3, "subk_pct": 0.04, "odc_pct": 0.08, "travel_pct": 0.01, "fee_pct": 0.06},
    {"name": "CYBER-RES-304",  "type": "CPFF",  "ftes": 4,  "cat": "R&D",         "start_fy": 0, "end_fy": 2, "subk_pct": 0.05, "odc_pct": 0.10, "travel_pct": 0.02, "fee_pct": 0.07},
    {"name": "SENSOR-DEV-305", "type": "CPFF",  "ftes": 3,  "cat": "R&D",         "start_fy": 0, "end_fy": 1, "subk_pct": 0.10, "odc_pct": 0.18, "travel_pct": 0.02, "fee_pct": 0.06},
    # Task Orders (4)
    {"name": "TASK-SEC-401",   "type": "FFP",   "ftes": 3,  "cat": "TaskOrder",   "start_fy": 1, "end_fy": 2, "subk_pct": 0.05, "odc_pct": 0.03, "travel_pct": 0.01, "fee_pct": 0.06},
    {"name": "TASK-DOC-402",   "type": "FFP",   "ftes": 2,  "cat": "TaskOrder",   "start_fy": 2, "end_fy": 3, "subk_pct": 0.02, "odc_pct": 0.01, "travel_pct": 0.01, "fee_pct": 0.05},
    {"name": "TASK-SCAN-403",  "type": "FFP",   "ftes": 2,  "cat": "TaskOrder",   "start_fy": 0, "end_fy": 1, "subk_pct": 0.08, "odc_pct": 0.05, "travel_pct": 0.01, "fee_pct": 0.06},
    {"name": "TASK-AUDIT-404", "type": "FFP",   "ftes": 2,  "cat": "TaskOrder",   "start_fy": 2, "end_fy": 3, "subk_pct": 0.03, "odc_pct": 0.02, "travel_pct": 0.02, "fee_pct": 0.05},
]

# Hours per month at 100% utilization
_HRS_PER_MONTH = 173

# ---------------------------------------------------------------------------
# Budget / provisional rate targets by pool group per FY
# (budget = planned, provisional = DCAA-approved billing rate)
# ---------------------------------------------------------------------------

_BUDGET_RATES = {
    "DEMO-FY2023": {"Fringe": 0.310, "Overhead": 0.560, "G&A": 0.148, "B&P/IR&D": 0.042},
    "DEMO-FY2024": {"Fringe": 0.315, "Overhead": 0.555, "G&A": 0.152, "B&P/IR&D": 0.044},
    "DEMO-FY2025": {"Fringe": 0.320, "Overhead": 0.545, "G&A": 0.155, "B&P/IR&D": 0.045},
    "DEMO-FY2026": {"Fringe": 0.325, "Overhead": 0.540, "G&A": 0.158, "B&P/IR&D": 0.046},
}

_PROVISIONAL_RATES = {
    "DEMO-FY2023": {"Fringe": 0.305, "Overhead": 0.550, "G&A": 0.145, "B&P/IR&D": 0.040},
    "DEMO-FY2024": {"Fringe": 0.312, "Overhead": 0.548, "G&A": 0.150, "B&P/IR&D": 0.043},
    "DEMO-FY2025": {"Fringe": 0.318, "Overhead": 0.540, "G&A": 0.153, "B&P/IR&D": 0.044},
    "DEMO-FY2026": {"Fringe": 0.322, "Overhead": 0.535, "G&A": 0.156, "B&P/IR&D": 0.045},
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _vary(base: float, pct: float = 0.08, rng: random.Random | None = None) -> float:
    r = rng or random
    return round(base * (1 + r.uniform(-pct, pct)), 2)


def _periods_for_fy(fy_def: dict) -> list[str]:
    """Generate YYYY-MM period list for a fiscal year."""
    start_y, start_m = map(int, fy_def["start"].split("-"))
    end_y, end_m = map(int, fy_def["end"].split("-"))
    periods = []
    y, m = start_y, start_m
    while (y, m) <= (end_y, end_m):
        periods.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return periods


def _month_index_in_fy(period: str) -> int:
    """0-based month index within the fiscal year (Oct=0, Nov=1, ...)."""
    m = int(period.split("-")[1])
    return (m - 10) % 12


def _seasonal_factor(period: str) -> float:
    """Seasonal multiplier: Dec dip, Sep spike, summer dip."""
    m = int(period.split("-")[1])
    if m == 12:
        return 0.85  # Holiday dip
    if m == 9:
        return 1.10  # Year-end push
    if m in (7, 8):
        return 0.95  # Summer slowdown
    return 1.0


def _yoy_growth(fy_index: int) -> float:
    """YoY growth factor relative to FY2023 baseline (index 0)."""
    # ~5% compound growth
    return (1.05) ** fy_index


def _project_active(proj: dict, fy_index: int) -> bool:
    return proj["start_fy"] <= fy_index <= proj["end_fy"]


def _lifecycle_factor(proj: dict, fy_index: int, month_in_fy: int, total_months: int) -> float:
    """Ramp-up / wind-down factor for project lifecycle."""
    # Compute absolute month position for the project
    fy_start = proj["start_fy"]
    fy_end = proj["end_fy"]

    # Month of project life (0-based)
    proj_month = (fy_index - fy_start) * 12 + month_in_fy
    # Total project months
    total_proj_months = (fy_end - fy_start + 1) * 12

    # First FY ramp-up
    if proj_month == 0:
        return 0.50
    if proj_month == 1:
        return 0.75
    if proj_month == 2:
        return 0.90

    # Last FY wind-down
    months_remaining = total_proj_months - proj_month - 1
    if months_remaining == 0:
        return 0.50
    if months_remaining == 1:
        return 0.75

    return 1.0


# ---------------------------------------------------------------------------
# Main generation functions
# ---------------------------------------------------------------------------


def _generate_all_periods() -> list[str]:
    """All 48 periods across 4 FYs, capped at FY2026 partial."""
    periods = []
    for fy_def in FY_DEFS:
        for p in _periods_for_fy(fy_def):
            if p <= FY2026_LAST_ACTUAL:
                periods.append(p)
    return sorted(set(periods))


def _fy_index_for_period(period: str) -> int:
    """Determine which FY index a period belongs to."""
    for i, fy_def in enumerate(FY_DEFS):
        fy_periods = _periods_for_fy(fy_def)
        if period in fy_periods:
            return i
    return 0


# Proportional distribution of direct costs across GL accounts within each category
_DL_ACCOUNT_WEIGHTS = {
    "5100.01": 0.265, "5100.02": 0.184, "5100.03": 0.137, "5100.04": 0.156,
    "5100.05": 0.104, "5100.06": 0.080, "5100.07": 0.052, "5100.08": 0.022,
}
_TRAVEL_ACCOUNT_WEIGHTS = {"5200.01": 0.545, "5200.02": 0.182, "5200.03": 0.273}
_SUBK_ACCOUNT_WEIGHTS = {"5300.01": 0.632, "5300.02": 0.237, "5300.03": 0.131}
_ODC_ACCOUNT_WEIGHTS = {"5400.01": 0.364, "5400.02": 0.254, "5400.03": 0.305, "5400.04": 0.077}

# Accounts that are pool costs (not direct costs) — use _GL_BASE_AMOUNTS for these
_POOL_COST_ACCOUNTS = {a for a in _GL_BASE_AMOUNTS if a.startswith(("6", "7", "8", "9"))}

# FY2023 baseline DL per month (sum of DL account base amounts)
_FY2023_BASELINE_DL = sum(v for k, v in _GL_BASE_AMOUNTS.items() if k.startswith("5100."))


def _generate_gl_rows(rng: random.Random, direct_rows: list[dict] | None = None) -> list[dict]:
    """Generate GL_Actuals rows for all periods.

    When *direct_rows* is provided, direct accounts (5xxx) are derived from the
    project-level totals so that GL bases match Direct_Costs_By_Project within
    normal random variation.  Pool/indirect accounts (6xxx+) use _GL_BASE_AMOUNTS.
    """
    rows = []
    all_periods = _generate_all_periods()

    # Aggregate direct costs by period when available
    period_totals: dict[str, dict[str, float]] = {}
    if direct_rows:
        for r in direct_rows:
            p = r["Period"]
            if p not in period_totals:
                period_totals[p] = {"DL": 0.0, "Subk": 0.0, "ODC": 0.0, "Travel": 0.0}
            period_totals[p]["DL"] += r["DirectLabor$"]
            period_totals[p]["Subk"] += r["Subk"]
            period_totals[p]["ODC"] += r["ODC"]
            period_totals[p]["Travel"] += r["Travel"]

    for period in all_periods:
        fy_idx = _fy_index_for_period(period)
        growth = _yoy_growth(fy_idx)
        seasonal = _seasonal_factor(period)

        if period_totals and period in period_totals:
            # Derive direct GL accounts from project totals
            totals = period_totals[period]
            for acct, weight in _DL_ACCOUNT_WEIGHTS.items():
                amt = _vary(totals["DL"] * weight, pct=0.03, rng=rng)
                rows.append({"Period": period, "Account": acct, "Amount": round(amt, 2)})
            for acct, weight in _TRAVEL_ACCOUNT_WEIGHTS.items():
                amt = _vary(totals["Travel"] * weight, pct=0.03, rng=rng)
                rows.append({"Period": period, "Account": acct, "Amount": round(amt, 2)})
            for acct, weight in _SUBK_ACCOUNT_WEIGHTS.items():
                amt = _vary(totals["Subk"] * weight, pct=0.03, rng=rng)
                rows.append({"Period": period, "Account": acct, "Amount": round(amt, 2)})
            for acct, weight in _ODC_ACCOUNT_WEIGHTS.items():
                amt = _vary(totals["ODC"] * weight, pct=0.03, rng=rng)
                rows.append({"Period": period, "Account": acct, "Amount": round(amt, 2)})

            # Pool/indirect accounts: scale with DL growth so rates stay stable.
            # When more projects are active, pool costs (benefits, facilities, etc.)
            # grow proportionally.  Use the DL ratio vs FY2023 baseline.
            dl_ratio = totals["DL"] / _FY2023_BASELINE_DL if _FY2023_BASELINE_DL > 0 else 1.0
            for acct, base_amt in _GL_BASE_AMOUNTS.items():
                if acct not in _POOL_COST_ACCOUNTS:
                    continue
                scaled = base_amt * dl_ratio * seasonal
                if acct in _FIXED_ACCOUNTS:
                    amt = round(base_amt * dl_ratio, 2)
                else:
                    amt = _vary(scaled, pct=0.08, rng=rng)
                rows.append({"Period": period, "Account": acct, "Amount": amt})
        else:
            # Fallback: all accounts from base amounts
            for acct, base_amt in _GL_BASE_AMOUNTS.items():
                scaled = base_amt * growth * seasonal
                if acct in _FIXED_ACCOUNTS:
                    amt = round(base_amt * growth, 2)
                else:
                    amt = _vary(scaled, pct=0.08, rng=rng)
                rows.append({"Period": period, "Account": acct, "Amount": amt})
    return rows


def _generate_direct_cost_rows(rng: random.Random) -> list[dict]:
    """Generate Direct_Costs_By_Project rows for all periods."""
    rows = []
    all_periods = _generate_all_periods()

    for period in all_periods:
        fy_idx = _fy_index_for_period(period)
        month_in_fy = _month_index_in_fy(period)
        growth = _yoy_growth(fy_idx)
        seasonal = _seasonal_factor(period)

        for proj in PROJECTS:
            if not _project_active(proj, fy_idx):
                continue

            rate = _HOURLY_RATES[proj["cat"]]
            lifecycle = _lifecycle_factor(proj, fy_idx, month_in_fy, 12)

            base_dl = proj["ftes"] * rate * _HRS_PER_MONTH * growth * seasonal * lifecycle
            dl = _vary(base_dl, pct=0.10, rng=rng)
            hrs = round(dl / rate, 1)

            subk = _vary(dl * proj["subk_pct"], pct=0.15, rng=rng)
            odc = _vary(dl * proj["odc_pct"], pct=0.12, rng=rng)
            travel = _vary(dl * proj["travel_pct"], pct=0.20, rng=rng)

            rows.append({
                "Period": period,
                "Project": proj["name"],
                "DirectLabor$": round(dl, 2),
                "DirectLaborHrs": hrs,
                "Subk": round(subk, 2),
                "ODC": round(odc, 2),
                "Travel": round(travel, 2),
            })
    return rows


def _generate_revenue_data(direct_rows: list[dict], rng: random.Random) -> list[dict]:
    """Generate revenue data linked to projects."""
    # Aggregate direct costs per period/project
    cost_by_pp: dict[tuple[str, str], float] = {}
    for r in direct_rows:
        key = (r["Period"], r["Project"])
        cost_by_pp[key] = r["DirectLabor$"] + r["Subk"] + r["ODC"] + r["Travel"]

    proj_lookup = {p["name"]: p for p in PROJECTS}
    revenue_rows = []

    for (period, project), total_direct in cost_by_pp.items():
        proj = proj_lookup.get(project)
        if not proj:
            continue

        # Estimate total cost with indirect loading (~1.8-2.0x direct)
        indirect_loading = 1.85
        total_cost = total_direct * indirect_loading

        if proj["type"] == "FFP":
            # Fixed price — fixed monthly amount with slight variation
            # Price set to yield target fee
            revenue = total_cost * (1 + proj["fee_pct"]) * _vary(1.0, 0.02, rng)
        elif proj["type"] == "T&M":
            # T&M — billed at rates
            revenue = total_cost * (1 + proj["fee_pct"]) * _vary(1.0, 0.03, rng)
        elif proj["type"] == "CPFF":
            # Cost plus fixed fee
            revenue = total_cost * (1 + proj["fee_pct"])
        else:  # CPAF
            # Cost plus award fee (variable 3-10%)
            award = rng.uniform(0.03, proj["fee_pct"])
            revenue = total_cost * (1 + award)

        revenue_rows.append({
            "period": period,
            "project": project,
            "revenue": round(revenue, 2),
        })

    return revenue_rows


def _generate_scenarios_for_fy(
    conn, fy_id: int, fy_name: str, fy_def: dict
) -> int:
    """Create 8 scenarios with events for a single FY."""
    periods = _periods_for_fy(fy_def)
    mid_period = periods[len(periods) // 2] if periods else periods[0]
    q3_period = periods[6] if len(periods) > 6 else mid_period
    count = 0

    # 1. Base — no changes
    sid = db.create_scenario(conn, fy_id, "Base", "No changes - baseline forecast")
    db.create_scenario_event(
        conn, sid,
        effective_period=mid_period, event_type="ADJUST", project="",
        delta_direct_labor=0, delta_direct_labor_hrs=0,
        delta_subk=0, delta_odc=0, delta_travel=0,
        pool_deltas=json.dumps({}), notes="No changes",
    )
    count += 1

    # 2. Win — 2 new projects mid-year
    sid = db.create_scenario(conn, fy_id, "Win", "New contract wins add staff and costs")
    db.create_scenario_event(
        conn, sid,
        effective_period=mid_period, event_type="WIN", project="NEW-WIN-A",
        delta_direct_labor=120000, delta_direct_labor_hrs=1300,
        delta_subk=25000, delta_odc=10000, delta_travel=5000,
        pool_deltas=json.dumps({"Fringe": 36000, "Overhead": 18000, "G&A": 8000}),
        notes="New DoD cloud contract won",
    )
    db.create_scenario_event(
        conn, sid,
        effective_period=q3_period, event_type="WIN", project="NEW-WIN-B",
        delta_direct_labor=60000, delta_direct_labor_hrs=650,
        delta_subk=15000, delta_odc=5000, delta_travel=3000,
        pool_deltas=json.dumps({"Fringe": 18000, "Overhead": 9000, "G&A": 4000}),
        notes="Advisory task order awarded",
    )
    count += 1

    # 3. Lose — 1 project ends early
    sid = db.create_scenario(conn, fy_id, "Lose", "Contract loss reduces direct costs; pools are sticky")
    db.create_scenario_event(
        conn, sid,
        effective_period=mid_period, event_type="LOSE", project="SYS-ENG-101",
        delta_direct_labor=-120000, delta_direct_labor_hrs=-1300,
        delta_subk=-15000, delta_odc=-8000, delta_travel=-5000,
        pool_deltas=json.dumps({}),
        notes="Major engineering contract not renewed - pools sticky",
    )
    count += 1

    # 4. Hiring Surge — +15% DL
    sid = db.create_scenario(conn, fy_id, "Hiring Surge", "15% increase in direct labor with proportional fringe")
    db.create_scenario_event(
        conn, sid,
        effective_period=mid_period, event_type="HIRE", project="",
        delta_direct_labor=160000, delta_direct_labor_hrs=1700,
        delta_subk=0, delta_odc=5000, delta_travel=3000,
        pool_deltas=json.dumps({"Fringe": 48000, "Overhead": 25000, "G&A": 10000}),
        notes="Aggressive hiring across IT and Engineering divisions",
    )
    count += 1

    # 5. RIF — -10% DL
    sid = db.create_scenario(conn, fy_id, "RIF", "10% workforce reduction; benefits lag behind")
    db.create_scenario_event(
        conn, sid,
        effective_period=mid_period, event_type="RIF", project="",
        delta_direct_labor=-105000, delta_direct_labor_hrs=-1100,
        delta_subk=-10000, delta_odc=-3000, delta_travel=-2000,
        pool_deltas=json.dumps({"Fringe": -28000, "Overhead": -5000}),
        notes="RIF - fringe lags (benefits continue 60 days)",
    )
    count += 1

    # 6. Restructure — shift costs between pools
    sid = db.create_scenario(conn, fy_id, "Restructure", "Cost restructuring: reduce OH, increase G&A and B&P")
    db.create_scenario_event(
        conn, sid,
        effective_period=mid_period, event_type="ADJUST", project="",
        delta_direct_labor=0, delta_direct_labor_hrs=0,
        delta_subk=0, delta_odc=0, delta_travel=0,
        pool_deltas=json.dumps({"Overhead": -50000, "G&A": 30000, "B&P/IR&D": 20000}),
        notes="Facilities consolidation shifts costs from OH to G&A; increased B&P investment",
    )
    count += 1

    # 7. Best Case — Win + Hiring Surge combined
    sid = db.create_scenario(conn, fy_id, "Best Case", "Combined: new wins plus aggressive hiring")
    db.create_scenario_event(
        conn, sid,
        effective_period=mid_period, event_type="WIN", project="NEW-WIN-A",
        delta_direct_labor=120000, delta_direct_labor_hrs=1300,
        delta_subk=25000, delta_odc=10000, delta_travel=5000,
        pool_deltas=json.dumps({"Fringe": 36000, "Overhead": 18000, "G&A": 8000}),
        notes="New DoD cloud contract + organic growth",
    )
    db.create_scenario_event(
        conn, sid,
        effective_period=q3_period, event_type="HIRE", project="",
        delta_direct_labor=160000, delta_direct_labor_hrs=1700,
        delta_subk=0, delta_odc=5000, delta_travel=3000,
        pool_deltas=json.dumps({"Fringe": 48000, "Overhead": 25000, "G&A": 10000}),
        notes="Hiring surge to support new work",
    )
    count += 1

    # 8. Worst Case — Lose + RIF combined
    sid = db.create_scenario(conn, fy_id, "Worst Case", "Combined: contract loss plus workforce reduction")
    db.create_scenario_event(
        conn, sid,
        effective_period=mid_period, event_type="LOSE", project="SYS-ENG-101",
        delta_direct_labor=-120000, delta_direct_labor_hrs=-1300,
        delta_subk=-15000, delta_odc=-8000, delta_travel=-5000,
        pool_deltas=json.dumps({}),
        notes="Major contract loss",
    )
    db.create_scenario_event(
        conn, sid,
        effective_period=q3_period, event_type="RIF", project="",
        delta_direct_labor=-105000, delta_direct_labor_hrs=-1100,
        delta_subk=-10000, delta_odc=-3000, delta_travel=-2000,
        pool_deltas=json.dumps({"Fringe": -28000, "Overhead": -5000}),
        notes="RIF following contract loss",
    )
    count += 1

    return count


# ---------------------------------------------------------------------------
# CSV writers
# ---------------------------------------------------------------------------


def _write_gl_actuals(data_dir: Path, rows: list[dict]) -> None:
    with open(data_dir / "GL_Actuals.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["Period", "Account", "Amount"])
        writer.writeheader()
        writer.writerows(rows)


def _write_direct_costs(data_dir: Path, rows: list[dict]) -> None:
    with open(data_dir / "Direct_Costs_By_Project.csv", "w", newline="") as f:
        writer = csv.DictWriter(
            f, fieldnames=["Period", "Project", "DirectLabor$", "DirectLaborHrs", "Subk", "ODC", "Travel"]
        )
        writer.writeheader()
        writer.writerows(rows)


def _write_account_map(data_dir: Path) -> None:
    rows = []
    mapped_accounts: set[str] = set()

    # Pool cost accounts
    for ps in POOL_STRUCTURE:
        is_unallowable = ps.get("is_unallowable", False)
        for acct in ps["cost_accounts"]:
            entry = next((a for a in CHART_OF_ACCOUNTS if a["account"] == acct), None)
            name = entry["name"] if entry else acct
            rows.append({
                "Account": acct,
                "Pool": ps["name"],
                "BaseCategory": ps["base"],
                "IsUnallowable": is_unallowable,
                "Notes": name,
            })
            mapped_accounts.add(acct)

    # Base / direct accounts — mapped as "Direct" pool so they are not flagged unmapped
    for ps in POOL_STRUCTURE:
        for acct in ps.get("base_accounts", []):
            if acct not in mapped_accounts:
                entry = next((a for a in CHART_OF_ACCOUNTS if a["account"] == acct), None)
                name = entry["name"] if entry else acct
                rows.append({
                    "Account": acct,
                    "Pool": "Direct",
                    "BaseCategory": "Direct",
                    "IsUnallowable": False,
                    "Notes": name,
                })
                mapped_accounts.add(acct)

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


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def seed_demo_data(conn, data_dir: Path | str, user_id: str = "") -> dict[str, Any]:
    """Seed the database with realistic enterprise demo data and write CSV files.

    Creates 4 fiscal years (DEMO-FY2023 through DEMO-FY2026) with full pool
    structures, scenarios, reference rates, revenue data, and CSV files.
    """
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(42)

    # Check if already seeded (scoped to this user)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM fiscal_years WHERE name LIKE %s AND user_id = %s",
            (f"{DEMO_FY_PREFIX}%", user_id),
        )
        existing = cur.fetchone()
    if existing:
        return {"error": f"Demo data already exists (found {DEMO_FY_PREFIX}* fiscal years). Clear first."}

    # Generate all data first (direct costs first, so GL can derive from them)
    direct_rows = _generate_direct_cost_rows(rng)
    gl_rows = _generate_gl_rows(rng, direct_rows=direct_rows)
    revenue_rows = _generate_revenue_data(direct_rows, rng)

    total_scenarios = 0
    fy_ids = []

    for fy_idx, fy_def in enumerate(FY_DEFS):
        # 1. Create fiscal year
        fy_id = db.create_fiscal_year(conn, fy_def["name"], fy_def["start"], fy_def["end"], user_id=user_id)
        fy_ids.append(fy_id)

        # 2. Bulk-insert chart of accounts
        db.bulk_create_chart_accounts(conn, fy_id, CHART_OF_ACCOUNTS)

        # 3. Create rate group
        rg_id = db.create_rate_group(conn, fy_id, RATE_GROUP_NAME)

        # 4. Create pool groups, pools, GL mappings, base accounts
        for ps in POOL_STRUCTURE:
            pg_id = db.create_pool_group(
                conn, fy_id, ps["name"],
                base=ps["base"],
                display_order=ps.get("display_order", ps["cascade_order"]),
                rate_group_id=rg_id,
                cascade_order=ps["cascade_order"],
            )
            pool_id = db.create_pool(conn, pg_id, ps["name"])

            is_unallowable = ps.get("is_unallowable", False)
            for acct in ps["cost_accounts"]:
                db.create_gl_mapping(conn, pool_id, acct, is_unallowable=is_unallowable)

            for acct in ps["base_accounts"]:
                db.create_base_account(conn, pg_id, acct)

        # 5. Seed scenarios
        sc = _generate_scenarios_for_fy(conn, fy_id, fy_def["name"], fy_def)
        total_scenarios += sc

        # 6. Seed budget and provisional rates (one per period per pool group)
        fy_periods = _periods_for_fy(fy_def)
        for period in fy_periods:
            for pg_name, rate_val in _BUDGET_RATES.get(fy_def["name"], {}).items():
                db.upsert_reference_rate(conn, fy_id, "budget", pg_name, period, rate_val)
            for pg_name, rate_val in _PROVISIONAL_RATES.get(fy_def["name"], {}).items():
                db.upsert_reference_rate(conn, fy_id, "provisional", pg_name, period, rate_val)

        # 7. Seed revenue data for this FY
        for rev in revenue_rows:
            if rev["period"] in fy_periods:
                db.upsert_revenue(conn, fy_id, rev["period"], rev["project"], rev["revenue"])

    # 8. Write CSV files
    _write_gl_actuals(data_dir, gl_rows)
    _write_direct_costs(data_dir, direct_rows)
    _write_account_map(data_dir)
    _write_scenario_events(data_dir)

    return {
        "fiscal_years": len(FY_DEFS),
        "fiscal_year_names": [f["name"] for f in FY_DEFS],
        "chart_accounts": len(CHART_OF_ACCOUNTS),
        "pool_groups": len(POOL_STRUCTURE),
        "pools": len(POOL_STRUCTURE),
        "gl_mappings": sum(len(ps["cost_accounts"]) for ps in POOL_STRUCTURE),
        "base_accounts": sum(len(ps["base_accounts"]) for ps in POOL_STRUCTURE),
        "scenarios": total_scenarios,
        "projects": len(PROJECTS),
        "periods": len(_generate_all_periods()),
        "csv_files": 4,
    }


def clear_demo_data(conn, data_dir: Path | str, user_id: str = "") -> dict[str, Any]:
    """Remove all DEMO-* fiscal years (CASCADE deletes children) and CSV files."""
    data_dir = Path(data_dir)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name FROM fiscal_years WHERE name LIKE %s AND user_id = %s",
            (f"{DEMO_FY_PREFIX}%", user_id),
        )
        rows = cur.fetchall()

    deleted_count = 0
    for row in rows:
        db.delete_fiscal_year(conn, row["id"])
        deleted_count += 1

    csv_files = ["GL_Actuals.csv", "Direct_Costs_By_Project.csv", "Account_Map.csv", "Scenario_Events.csv"]
    removed = 0
    for fname in csv_files:
        p = data_dir / fname
        if p.exists():
            p.unlink()
            removed += 1

    return {"deleted_fiscal_years": deleted_count, "csv_files_removed": removed}
