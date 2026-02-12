from __future__ import annotations

from pathlib import Path

import pytest

from indirectrates.db import (
    create_cost_category,
    create_fiscal_year,
    create_gl_mapping,
    create_pool,
    create_pool_group,
    create_rate_group,
    build_account_map_df_from_db,
    build_rate_config_from_db,
    delete_fiscal_year,
    delete_gl_mapping,
    delete_pool,
    delete_pool_group,
    delete_rate_group,
    get_connection,
    get_fiscal_year,
    init_db,
    list_cost_categories,
    list_fiscal_years,
    list_gl_mappings,
    list_pool_groups,
    list_pools,
    list_rate_groups,
    list_reference_rates,
    list_revenue,
    transaction,
    update_pool,
    update_pool_group,
    update_rate_group,
    upsert_reference_rate,
    upsert_revenue,
)


@pytest.fixture()
def db(tmp_path: Path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    conn = get_connection(db_path)
    yield conn
    conn.close()


def test_init_db_creates_tables(tmp_path: Path) -> None:
    db_path = init_db(tmp_path / "test.db")
    assert db_path.exists()
    conn = get_connection(db_path)
    tables = [
        r[0]
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    ]
    conn.close()
    assert "fiscal_years" in tables
    assert "rate_groups" in tables
    assert "pool_groups" in tables
    assert "pools" in tables
    assert "gl_account_mappings" in tables
    assert "budget_provisional_rates" in tables
    assert "revenue_data" in tables
    assert "cost_category_mappings" in tables


def test_init_db_idempotent(tmp_path: Path) -> None:
    db_path = tmp_path / "test.db"
    init_db(db_path)
    init_db(db_path)  # should not raise


def test_fiscal_year_crud(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    assert fy_id > 0

    fys = list_fiscal_years(db)
    assert len(fys) == 1
    assert fys[0]["name"] == "FY2025"

    fy = get_fiscal_year(db, fy_id)
    assert fy is not None
    assert fy["start_month"] == "2024-10"

    assert delete_fiscal_year(db, fy_id)
    assert list_fiscal_years(db) == []


def test_rate_group_crud(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    rg_id = create_rate_group(db, fy_id, "Division A")
    assert rg_id > 0

    groups = list_rate_groups(db, fy_id)
    assert len(groups) == 1
    assert groups[0]["name"] == "Division A"

    assert update_rate_group(db, rg_id, name="Division B")
    groups = list_rate_groups(db, fy_id)
    assert groups[0]["name"] == "Division B"

    assert delete_rate_group(db, rg_id)
    assert list_rate_groups(db, fy_id) == []


def test_pool_group_with_rate_group(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    rg_id = create_rate_group(db, fy_id, "Primary")

    pg_id = create_pool_group(db, fy_id, "Fringe", base="TL", rate_group_id=rg_id)
    assert pg_id > 0

    # Filter by rate_group_id
    groups = list_pool_groups(db, fy_id, rate_group_id=rg_id)
    assert len(groups) == 1
    assert groups[0]["rate_group_id"] == rg_id

    # Without filter still returns all
    all_groups = list_pool_groups(db, fy_id)
    assert len(all_groups) == 1


def test_rate_group_cascade_deletes_pool_groups(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    rg_id = create_rate_group(db, fy_id, "Primary")
    create_pool_group(db, fy_id, "Fringe", base="TL", rate_group_id=rg_id)

    delete_rate_group(db, rg_id)
    assert list_pool_groups(db, fy_id) == []


def test_pool_group_crud(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    pg_id = create_pool_group(db, fy_id, "Fringe", base="TL")
    assert pg_id > 0

    groups = list_pool_groups(db, fy_id)
    assert len(groups) == 1
    assert groups[0]["name"] == "Fringe"
    assert groups[0]["base"] == "TL"

    assert update_pool_group(db, pg_id, name="Fringe Benefits")
    groups = list_pool_groups(db, fy_id)
    assert groups[0]["name"] == "Fringe Benefits"

    assert delete_pool_group(db, pg_id)
    assert list_pool_groups(db, fy_id) == []


def test_pool_crud(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    pg_id = create_pool_group(db, fy_id, "Fringe", base="TL")
    pool_id = create_pool(db, pg_id, "Fringe 1")
    assert pool_id > 0

    pools = list_pools(db, pg_id)
    assert len(pools) == 1
    assert pools[0]["name"] == "Fringe 1"

    assert update_pool(db, pool_id, name="Health Insurance")
    pools = list_pools(db, pg_id)
    assert pools[0]["name"] == "Health Insurance"

    assert delete_pool(db, pool_id)
    assert list_pools(db, pg_id) == []


def test_gl_mapping_crud(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    pg_id = create_pool_group(db, fy_id, "Fringe", base="TL")
    pool_id = create_pool(db, pg_id, "Fringe 1")

    m_id = create_gl_mapping(db, pool_id, "6000", is_unallowable=False, notes="Benefits")
    assert m_id > 0

    mappings = list_gl_mappings(db, pool_id)
    assert len(mappings) == 1
    assert mappings[0]["account"] == "6000"

    assert delete_gl_mapping(db, m_id)
    assert list_gl_mappings(db, pool_id) == []


def test_cascade_delete(db) -> None:
    """Deleting a fiscal year cascades to pool_groups, pools, and gl_mappings."""
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    pg_id = create_pool_group(db, fy_id, "Fringe", base="TL")
    pool_id = create_pool(db, pg_id, "Fringe 1")
    create_gl_mapping(db, pool_id, "6000")

    delete_fiscal_year(db, fy_id)

    assert list_pool_groups(db, fy_id) == []
    assert list_pools(db, pg_id) == []
    assert list_gl_mappings(db, pool_id) == []


def test_reference_rates(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    upsert_reference_rate(db, fy_id, "budget", "Fringe", "2024-10", 0.28)
    upsert_reference_rate(db, fy_id, "budget", "Fringe", "2024-11", 0.29)
    upsert_reference_rate(db, fy_id, "provisional", "Fringe", "2024-10", 0.30)

    budget = list_reference_rates(db, fy_id, "budget")
    assert len(budget) == 2

    all_rates = list_reference_rates(db, fy_id)
    assert len(all_rates) == 3

    # Upsert updates existing
    upsert_reference_rate(db, fy_id, "budget", "Fringe", "2024-10", 0.31)
    budget = list_reference_rates(db, fy_id, "budget")
    assert budget[0]["rate_value"] == pytest.approx(0.31)


def test_revenue_crud(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    upsert_revenue(db, fy_id, "2024-10", "P001", 500_000.0)
    upsert_revenue(db, fy_id, "2024-10", "P002", 300_000.0)

    rev = list_revenue(db, fy_id)
    assert len(rev) == 2

    rev_p1 = list_revenue(db, fy_id, "P001")
    assert len(rev_p1) == 1
    assert rev_p1[0]["revenue"] == pytest.approx(500_000.0)


def test_cost_category_crud(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    cc_id = create_cost_category(db, fy_id, "Labor", "Direct Engineer", gl_account="5000", is_direct=True)
    assert cc_id > 0

    cats = list_cost_categories(db, fy_id, "Labor")
    assert len(cats) == 1

    all_cats = list_cost_categories(db, fy_id)
    assert len(all_cats) == 1


def test_transaction_rollback(db) -> None:
    create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    try:
        with transaction(db):
            db.execute("INSERT INTO fiscal_years (name, start_month, end_month) VALUES ('FY2026', '2025-10', '2026-09')")
            raise ValueError("force rollback")
    except ValueError:
        pass
    fys = list_fiscal_years(db)
    assert len(fys) == 1  # FY2026 was rolled back


def test_pool_group_cascade_order(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    pg_id = create_pool_group(db, fy_id, "Fringe", base="TL", cascade_order=0)
    pg2_id = create_pool_group(db, fy_id, "Overhead", base="DL", cascade_order=1)

    groups = list_pool_groups(db, fy_id)
    assert groups[0]["cascade_order"] == 0
    assert groups[1]["cascade_order"] == 1

    # Update cascade_order
    assert update_pool_group(db, pg2_id, cascade_order=2)
    groups = list_pool_groups(db, fy_id)
    oh = next(g for g in groups if g["name"] == "Overhead")
    assert oh["cascade_order"] == 2


def test_build_rate_config_includes_cascade_order(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    pg1 = create_pool_group(db, fy_id, "Fringe", base="TL", cascade_order=0)
    create_pool(db, pg1, "Health Insurance")
    pg2 = create_pool_group(db, fy_id, "Overhead", base="DL", cascade_order=1)
    create_pool(db, pg2, "IT Support")
    pg3 = create_pool_group(db, fy_id, "G&A", base="TCI", cascade_order=2)
    create_pool(db, pg3, "Admin")

    raw = build_rate_config_from_db(db, fy_id)
    assert raw["rates"]["Fringe"]["cascade_order"] == 0
    assert raw["rates"]["Overhead"]["cascade_order"] == 1
    assert raw["rates"]["G&A"]["cascade_order"] == 2

    from indirectrates.config import RateConfig
    cfg = RateConfig.from_mapping(raw)
    assert cfg.rates["Fringe"].cascade_order == 0
    assert cfg.rates["Overhead"].cascade_order == 1
    assert cfg.rates["G&A"].cascade_order == 2


def test_build_rate_config_from_db(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    pg1 = create_pool_group(db, fy_id, "Fringe", base="TL")
    create_pool(db, pg1, "Health Insurance")
    create_pool(db, pg1, "Dental")
    pg2 = create_pool_group(db, fy_id, "Overhead", base="DL")
    create_pool(db, pg2, "IT Support")

    raw = build_rate_config_from_db(db, fy_id)
    assert "Fringe" in raw["rates"]
    assert sorted(raw["rates"]["Fringe"]["pool"]) == ["Dental", "Health Insurance"]
    assert raw["rates"]["Fringe"]["base"] == "TL"
    assert raw["rates"]["Overhead"]["pool"] == ["IT Support"]


def test_build_account_map_df(db) -> None:
    fy_id = create_fiscal_year(db, "FY2025", "2024-10", "2025-09")
    pg = create_pool_group(db, fy_id, "Fringe", base="TL")
    pool_id = create_pool(db, pg, "Benefits")
    create_gl_mapping(db, pool_id, "6000", notes="Health")
    create_gl_mapping(db, pool_id, "6001", is_unallowable=True, notes="Unal")

    df = build_account_map_df_from_db(db, fy_id)
    assert len(df) == 2
    assert list(df.columns) == ["Account", "Pool", "BaseCategory", "IsUnallowable", "Notes"]
    assert df.iloc[0]["Pool"] == "Benefits"
    assert bool(df.iloc[1]["IsUnallowable"]) is True
