"""Tests for the CRUD API endpoints using FastAPI TestClient."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from indirectrates.db import init_db

# Delay import to allow patching
_test_db_path: Path | None = None


@pytest.fixture(autouse=True)
def setup_test_db(tmp_path: Path):
    """Create a fresh DB for each test and patch api_crud to use it."""
    global _test_db_path
    _test_db_path = tmp_path / "test_api.db"
    init_db(_test_db_path)

    from indirectrates import api_crud, db as db_mod

    original_db_path = api_crud.DB_PATH
    api_crud.DB_PATH = _test_db_path

    yield

    api_crud.DB_PATH = original_db_path


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from indirectrates.server import app
    return TestClient(app)


def test_healthz(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200


def test_fiscal_year_lifecycle(client):
    # Create
    resp = client.post("/api/fiscal-years", json={"name": "FY2025", "start_month": "2024-10", "end_month": "2025-09"})
    assert resp.status_code == 201
    fy = resp.json()
    fy_id = fy["id"]
    assert fy["name"] == "FY2025"

    # List
    resp = client.get("/api/fiscal-years")
    assert resp.status_code == 200
    fys = resp.json()
    assert len(fys) == 1

    # Get
    resp = client.get(f"/api/fiscal-years/{fy_id}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "FY2025"

    # Delete
    resp = client.delete(f"/api/fiscal-years/{fy_id}")
    assert resp.status_code == 200

    # Gone
    resp = client.get(f"/api/fiscal-years/{fy_id}")
    assert resp.status_code == 404


def test_rate_group_lifecycle(client):
    fy = client.post("/api/fiscal-years", json={"name": "FY2025", "start_month": "2024-10", "end_month": "2025-09"}).json()
    fy_id = fy["id"]

    # Create rate group
    resp = client.post(f"/api/fiscal-years/{fy_id}/rate-groups", json={"name": "Division A"})
    assert resp.status_code == 201
    rg = resp.json()
    rg_id = rg["id"]
    assert rg["name"] == "Division A"

    # List
    groups = client.get(f"/api/fiscal-years/{fy_id}/rate-groups").json()
    assert len(groups) == 1

    # Update
    resp = client.put(f"/api/rate-groups/{rg_id}", json={"name": "Division B"})
    assert resp.status_code == 200

    # Delete
    resp = client.delete(f"/api/rate-groups/{rg_id}")
    assert resp.status_code == 200

    groups = client.get(f"/api/fiscal-years/{fy_id}/rate-groups").json()
    assert len(groups) == 0


def test_pool_group_in_rate_group(client):
    fy = client.post("/api/fiscal-years", json={"name": "FY2025", "start_month": "2024-10", "end_month": "2025-09"}).json()
    fy_id = fy["id"]

    rg = client.post(f"/api/fiscal-years/{fy_id}/rate-groups", json={"name": "Primary"}).json()
    rg_id = rg["id"]

    # Create pool group with rate_group_id
    resp = client.post(f"/api/fiscal-years/{fy_id}/pool-groups", json={"name": "Fringe", "base": "TL", "rate_group_id": rg_id})
    assert resp.status_code == 201
    pg = resp.json()
    assert pg["rate_group_id"] == rg_id

    # List pool groups by rate group
    pgs = client.get(f"/api/rate-groups/{rg_id}/pool-groups").json()
    assert len(pgs) == 1
    assert pgs[0]["name"] == "Fringe"


def test_pool_group_lifecycle(client):
    # Create FY first
    fy = client.post("/api/fiscal-years", json={"name": "FY2025", "start_month": "2024-10", "end_month": "2025-09"}).json()
    fy_id = fy["id"]

    # Create pool group
    resp = client.post(f"/api/fiscal-years/{fy_id}/pool-groups", json={"name": "Fringe", "base": "TL"})
    assert resp.status_code == 201
    pg = resp.json()
    pg_id = pg["id"]
    assert pg["name"] == "Fringe"

    # List
    groups = client.get(f"/api/fiscal-years/{fy_id}/pool-groups").json()
    assert len(groups) == 1

    # Update
    resp = client.put(f"/api/pool-groups/{pg_id}", json={"name": "Fringe Benefits"})
    assert resp.status_code == 200

    # Delete
    resp = client.delete(f"/api/pool-groups/{pg_id}")
    assert resp.status_code == 200

    groups = client.get(f"/api/fiscal-years/{fy_id}/pool-groups").json()
    assert len(groups) == 0


def test_pool_group_cascade_order(client):
    fy = client.post("/api/fiscal-years", json={"name": "FY2025", "start_month": "2024-10", "end_month": "2025-09"}).json()
    fy_id = fy["id"]

    # Create with cascade_order
    resp = client.post(f"/api/fiscal-years/{fy_id}/pool-groups", json={"name": "Fringe", "base": "TL", "cascade_order": 0})
    assert resp.status_code == 201
    pg = resp.json()
    assert pg["cascade_order"] == 0

    resp = client.post(f"/api/fiscal-years/{fy_id}/pool-groups", json={"name": "Overhead", "base": "DL", "cascade_order": 1})
    assert resp.status_code == 201
    assert resp.json()["cascade_order"] == 1

    # Update cascade_order
    resp = client.put(f"/api/pool-groups/{pg['id']}", json={"cascade_order": 2})
    assert resp.status_code == 200

    # Verify update
    groups = client.get(f"/api/fiscal-years/{fy_id}/pool-groups").json()
    fringe = next(g for g in groups if g["name"] == "Fringe")
    assert fringe["cascade_order"] == 2


def test_pool_lifecycle(client):
    fy = client.post("/api/fiscal-years", json={"name": "FY2025", "start_month": "2024-10", "end_month": "2025-09"}).json()
    pg = client.post(f"/api/fiscal-years/{fy['id']}/pool-groups", json={"name": "Fringe", "base": "TL"}).json()
    pg_id = pg["id"]

    # Create pool
    resp = client.post(f"/api/pool-groups/{pg_id}/pools", json={"name": "Health Insurance"})
    assert resp.status_code == 201
    pool = resp.json()
    pool_id = pool["id"]

    # List
    pools = client.get(f"/api/pool-groups/{pg_id}/pools").json()
    assert len(pools) == 1

    # Update
    resp = client.put(f"/api/pools/{pool_id}", json={"name": "Medical"})
    assert resp.status_code == 200

    # Delete
    resp = client.delete(f"/api/pools/{pool_id}")
    assert resp.status_code == 200


def test_gl_mapping_lifecycle(client):
    fy = client.post("/api/fiscal-years", json={"name": "FY2025", "start_month": "2024-10", "end_month": "2025-09"}).json()
    pg = client.post(f"/api/fiscal-years/{fy['id']}/pool-groups", json={"name": "Fringe", "base": "TL"}).json()
    pool = client.post(f"/api/pool-groups/{pg['id']}/pools", json={"name": "Benefits"}).json()
    pool_id = pool["id"]

    # Create mapping
    resp = client.post(f"/api/pools/{pool_id}/gl-mappings", json={"account": "6000", "notes": "Health"})
    assert resp.status_code == 201
    m = resp.json()

    # List
    mappings = client.get(f"/api/pools/{pool_id}/gl-mappings").json()
    assert len(mappings) == 1

    # Delete
    resp = client.delete(f"/api/gl-mappings/{m['id']}")
    assert resp.status_code == 200


def test_reference_rates(client):
    fy = client.post("/api/fiscal-years", json={"name": "FY2025", "start_month": "2024-10", "end_month": "2025-09"}).json()
    fy_id = fy["id"]

    # Upsert
    resp = client.put(
        f"/api/fiscal-years/{fy_id}/reference-rates",
        json={"rate_type": "budget", "pool_group_name": "Fringe", "period": "2024-10", "rate_value": 0.28},
    )
    assert resp.status_code == 200

    # List
    rates = client.get(f"/api/fiscal-years/{fy_id}/reference-rates").json()
    assert len(rates) == 1

    # Bulk upsert
    resp = client.put(
        f"/api/fiscal-years/{fy_id}/reference-rates/bulk",
        json=[
            {"rate_type": "budget", "pool_group_name": "Fringe", "period": "2024-11", "rate_value": 0.29},
            {"rate_type": "provisional", "pool_group_name": "Overhead", "period": "2024-10", "rate_value": 0.55},
        ],
    )
    assert resp.status_code == 200

    all_rates = client.get(f"/api/fiscal-years/{fy_id}/reference-rates").json()
    assert len(all_rates) == 3


def test_revenue(client):
    fy = client.post("/api/fiscal-years", json={"name": "FY2025", "start_month": "2024-10", "end_month": "2025-09"}).json()
    fy_id = fy["id"]

    resp = client.post(
        f"/api/fiscal-years/{fy_id}/revenue",
        json={"period": "2024-10", "project": "P001", "revenue": 500000},
    )
    assert resp.status_code == 201

    # Import bulk
    resp = client.post(
        f"/api/fiscal-years/{fy_id}/revenue/import",
        json=[
            {"period": "2024-10", "project": "P002", "revenue": 300000},
            {"period": "2024-11", "project": "P001", "revenue": 550000},
        ],
    )
    assert resp.status_code == 201
    assert resp.json()["imported"] == 2

    rev = client.get(f"/api/fiscal-years/{fy_id}/revenue").json()
    assert len(rev) == 3


def test_cost_categories(client):
    fy = client.post("/api/fiscal-years", json={"name": "FY2025", "start_month": "2024-10", "end_month": "2025-09"}).json()
    fy_id = fy["id"]

    resp = client.post(
        f"/api/fiscal-years/{fy_id}/cost-categories",
        json={"category_type": "Labor", "category_name": "Direct Engineer", "gl_account": "5000"},
    )
    assert resp.status_code == 201
    cc = resp.json()

    cats = client.get(f"/api/fiscal-years/{fy_id}/cost-categories").json()
    assert len(cats) == 1

    resp = client.put(f"/api/cost-categories/{cc['id']}", json={"category_name": "Senior Engineer"})
    assert resp.status_code == 200

    resp = client.delete(f"/api/cost-categories/{cc['id']}")
    assert resp.status_code == 200
