"""SQLite persistence layer for the Indirect Rates application.

Provides schema, connection management, and CRUD functions for:
- Fiscal years
- Pool groups and pools
- GL account mappings
- Budget/provisional/forward-pricing rates
- Revenue data
- Cost category mappings
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator

import pandas as pd

DEFAULT_DB_PATH = Path("indirectrates.db")

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS fiscal_years (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    start_month TEXT    NOT NULL,  -- YYYY-MM
    end_month   TEXT    NOT NULL,  -- YYYY-MM
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_groups (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    display_order   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(fiscal_year_id, name)
);

CREATE TABLE IF NOT EXISTS pool_groups (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    rate_group_id   INTEGER REFERENCES rate_groups(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    base            TEXT    NOT NULL DEFAULT 'DL',  -- base key for rate calc (DL, TL, TCI, etc.)
    display_order   INTEGER NOT NULL DEFAULT 0,
    cascade_order   INTEGER NOT NULL DEFAULT 0,  -- 0=Fringe first, 1=OH second, 2=G&A last
    UNIQUE(fiscal_year_id, name)
);

CREATE TABLE IF NOT EXISTS pools (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_group_id   INTEGER NOT NULL REFERENCES pool_groups(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    display_order   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(pool_group_id, name)
);

CREATE TABLE IF NOT EXISTS gl_account_mappings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id         INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    account         TEXT    NOT NULL,
    is_unallowable  INTEGER NOT NULL DEFAULT 0,
    notes           TEXT    NOT NULL DEFAULT '',
    UNIQUE(pool_id, account)
);

CREATE TABLE IF NOT EXISTS budget_provisional_rates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    rate_type       TEXT    NOT NULL,  -- 'budget', 'provisional', 'forward_pricing'
    pool_group_name TEXT    NOT NULL,
    period          TEXT    NOT NULL,  -- YYYY-MM
    rate_value      REAL    NOT NULL DEFAULT 0.0,
    UNIQUE(fiscal_year_id, rate_type, pool_group_name, period)
);

CREATE TABLE IF NOT EXISTS revenue_data (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    period          TEXT    NOT NULL,  -- YYYY-MM
    project         TEXT    NOT NULL,
    revenue         REAL    NOT NULL DEFAULT 0.0,
    UNIQUE(fiscal_year_id, period, project)
);

CREATE TABLE IF NOT EXISTS cost_category_mappings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    category_type   TEXT    NOT NULL,  -- 'Labor', 'ODC', 'Subk', 'Travel', 'Other'
    category_name   TEXT    NOT NULL,
    gl_account      TEXT    NOT NULL DEFAULT '',
    is_direct       INTEGER NOT NULL DEFAULT 1,
    UNIQUE(fiscal_year_id, category_type, category_name)
);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    account         TEXT    NOT NULL,
    name            TEXT    NOT NULL DEFAULT '',
    category        TEXT    NOT NULL DEFAULT '',
    UNIQUE(fiscal_year_id, account)
);

CREATE TABLE IF NOT EXISTS pool_group_base_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_group_id   INTEGER NOT NULL REFERENCES pool_groups(id) ON DELETE CASCADE,
    account         TEXT    NOT NULL,
    notes           TEXT    NOT NULL DEFAULT '',
    UNIQUE(pool_group_id, account)
);
"""


def get_connection(db_path: str | Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """Open a connection with WAL mode and foreign keys enabled."""
    db_path = Path(db_path)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    """Apply incremental migrations for schema changes to existing databases."""
    # Migration: add rate_groups table and pool_groups.rate_group_id column
    existing = {
        r[0]
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    if "pool_groups" in existing:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(pool_groups)").fetchall()}
        if "rate_group_id" not in cols:
            conn.execute(
                "ALTER TABLE pool_groups ADD COLUMN rate_group_id INTEGER REFERENCES rate_groups(id) ON DELETE CASCADE"
            )
        if "cascade_order" not in cols:
            conn.execute(
                "ALTER TABLE pool_groups ADD COLUMN cascade_order INTEGER NOT NULL DEFAULT 0"
            )


def init_db(db_path: str | Path = DEFAULT_DB_PATH) -> Path:
    """Create all tables and apply migrations. Idempotent."""
    db_path = Path(db_path)
    conn = get_connection(db_path)
    try:
        conn.executescript(_SCHEMA)
        _migrate(conn)
        conn.commit()
    finally:
        conn.close()
    return db_path


@contextmanager
def transaction(conn: sqlite3.Connection) -> Generator[sqlite3.Connection, None, None]:
    """Context manager that commits on success, rolls back on error."""
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


# ---------------------------------------------------------------------------
# Fiscal Years CRUD
# ---------------------------------------------------------------------------

def create_fiscal_year(conn: sqlite3.Connection, name: str, start_month: str, end_month: str) -> int:
    with transaction(conn):
        cur = conn.execute(
            "INSERT INTO fiscal_years (name, start_month, end_month) VALUES (?, ?, ?)",
            (name, start_month, end_month),
        )
        return cur.lastrowid  # type: ignore[return-value]


def list_fiscal_years(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM fiscal_years ORDER BY start_month DESC").fetchall()
    return [dict(r) for r in rows]


def get_fiscal_year(conn: sqlite3.Connection, fy_id: int) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM fiscal_years WHERE id = ?", (fy_id,)).fetchone()
    return dict(row) if row else None


def delete_fiscal_year(conn: sqlite3.Connection, fy_id: int) -> bool:
    with transaction(conn):
        cur = conn.execute("DELETE FROM fiscal_years WHERE id = ?", (fy_id,))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Rate Groups CRUD
# ---------------------------------------------------------------------------

def create_rate_group(
    conn: sqlite3.Connection, fiscal_year_id: int, name: str, display_order: int = 0
) -> int:
    with transaction(conn):
        cur = conn.execute(
            "INSERT INTO rate_groups (fiscal_year_id, name, display_order) VALUES (?, ?, ?)",
            (fiscal_year_id, name, display_order),
        )
        return cur.lastrowid  # type: ignore[return-value]


def list_rate_groups(conn: sqlite3.Connection, fiscal_year_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM rate_groups WHERE fiscal_year_id = ? ORDER BY display_order, name",
        (fiscal_year_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def update_rate_group(conn: sqlite3.Connection, rg_id: int, **kwargs: Any) -> bool:
    allowed = {"name", "display_order"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return False
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [rg_id]
    with transaction(conn):
        cur = conn.execute(f"UPDATE rate_groups SET {sets} WHERE id = ?", vals)
        return cur.rowcount > 0


def delete_rate_group(conn: sqlite3.Connection, rg_id: int) -> bool:
    with transaction(conn):
        cur = conn.execute("DELETE FROM rate_groups WHERE id = ?", (rg_id,))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Pool Groups CRUD
# ---------------------------------------------------------------------------

def create_pool_group(
    conn: sqlite3.Connection,
    fiscal_year_id: int,
    name: str,
    base: str = "DL",
    display_order: int = 0,
    rate_group_id: int | None = None,
    cascade_order: int = 0,
) -> int:
    with transaction(conn):
        cur = conn.execute(
            "INSERT INTO pool_groups (fiscal_year_id, name, base, display_order, rate_group_id, cascade_order) VALUES (?, ?, ?, ?, ?, ?)",
            (fiscal_year_id, name, base, display_order, rate_group_id, cascade_order),
        )
        return cur.lastrowid  # type: ignore[return-value]


def list_pool_groups(
    conn: sqlite3.Connection, fiscal_year_id: int, rate_group_id: int | None = None
) -> list[dict[str, Any]]:
    if rate_group_id is not None:
        rows = conn.execute(
            "SELECT * FROM pool_groups WHERE fiscal_year_id = ? AND rate_group_id = ? ORDER BY display_order, name",
            (fiscal_year_id, rate_group_id),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM pool_groups WHERE fiscal_year_id = ? ORDER BY display_order, name",
            (fiscal_year_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def update_pool_group(conn: sqlite3.Connection, pg_id: int, **kwargs: Any) -> bool:
    allowed = {"name", "base", "display_order", "rate_group_id", "cascade_order"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return False
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [pg_id]
    with transaction(conn):
        cur = conn.execute(f"UPDATE pool_groups SET {sets} WHERE id = ?", vals)
        return cur.rowcount > 0


def delete_pool_group(conn: sqlite3.Connection, pg_id: int) -> bool:
    with transaction(conn):
        cur = conn.execute("DELETE FROM pool_groups WHERE id = ?", (pg_id,))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Pools CRUD
# ---------------------------------------------------------------------------

def create_pool(conn: sqlite3.Connection, pool_group_id: int, name: str, display_order: int = 0) -> int:
    with transaction(conn):
        cur = conn.execute(
            "INSERT INTO pools (pool_group_id, name, display_order) VALUES (?, ?, ?)",
            (pool_group_id, name, display_order),
        )
        return cur.lastrowid  # type: ignore[return-value]


def list_pools(conn: sqlite3.Connection, pool_group_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM pools WHERE pool_group_id = ? ORDER BY display_order, name",
        (pool_group_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_pool(conn: sqlite3.Connection, pool_id: int) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM pools WHERE id = ?", (pool_id,)).fetchone()
    return dict(row) if row else None


def update_pool(conn: sqlite3.Connection, pool_id: int, **kwargs: Any) -> bool:
    allowed = {"name", "display_order"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return False
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [pool_id]
    with transaction(conn):
        cur = conn.execute(f"UPDATE pools SET {sets} WHERE id = ?", vals)
        return cur.rowcount > 0


def delete_pool(conn: sqlite3.Connection, pool_id: int) -> bool:
    with transaction(conn):
        cur = conn.execute("DELETE FROM pools WHERE id = ?", (pool_id,))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# GL Account Mappings CRUD
# ---------------------------------------------------------------------------

def create_gl_mapping(
    conn: sqlite3.Connection, pool_id: int, account: str, is_unallowable: bool = False, notes: str = ""
) -> int:
    with transaction(conn):
        cur = conn.execute(
            "INSERT INTO gl_account_mappings (pool_id, account, is_unallowable, notes) VALUES (?, ?, ?, ?)",
            (pool_id, account, int(is_unallowable), notes),
        )
        return cur.lastrowid  # type: ignore[return-value]


def list_gl_mappings(conn: sqlite3.Connection, pool_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM gl_account_mappings WHERE pool_id = ? ORDER BY account",
        (pool_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def delete_gl_mapping(conn: sqlite3.Connection, mapping_id: int) -> bool:
    with transaction(conn):
        cur = conn.execute("DELETE FROM gl_account_mappings WHERE id = ?", (mapping_id,))
        return cur.rowcount > 0


def get_unassigned_accounts(conn: sqlite3.Connection, fiscal_year_id: int) -> list[str]:
    """Return GL accounts from mapped pools in this FY that are NOT assigned to any pool."""
    assigned = conn.execute(
        """
        SELECT DISTINCT gm.account
        FROM gl_account_mappings gm
        JOIN pools p ON gm.pool_id = p.id
        JOIN pool_groups pg ON p.pool_group_id = pg.id
        WHERE pg.fiscal_year_id = ?
        """,
        (fiscal_year_id,),
    ).fetchall()
    assigned_set = {r["account"] for r in assigned}

    # Collect all known accounts from GL_Actuals if we have any data,
    # otherwise return empty — the caller should supply the universe.
    all_accounts = conn.execute(
        """
        SELECT DISTINCT gm.account
        FROM gl_account_mappings gm
        JOIN pools p ON gm.pool_id = p.id
        JOIN pool_groups pg ON p.pool_group_id = pg.id
        """,
    ).fetchall()
    all_set = {r["account"] for r in all_accounts}
    return sorted(all_set - assigned_set)


# ---------------------------------------------------------------------------
# Budget / Provisional Rates CRUD
# ---------------------------------------------------------------------------

def upsert_reference_rate(
    conn: sqlite3.Connection,
    fiscal_year_id: int,
    rate_type: str,
    pool_group_name: str,
    period: str,
    rate_value: float,
) -> int:
    with transaction(conn):
        cur = conn.execute(
            """
            INSERT INTO budget_provisional_rates (fiscal_year_id, rate_type, pool_group_name, period, rate_value)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(fiscal_year_id, rate_type, pool_group_name, period)
            DO UPDATE SET rate_value = excluded.rate_value
            """,
            (fiscal_year_id, rate_type, pool_group_name, period, rate_value),
        )
        return cur.lastrowid  # type: ignore[return-value]


def list_reference_rates(
    conn: sqlite3.Connection, fiscal_year_id: int, rate_type: str | None = None
) -> list[dict[str, Any]]:
    if rate_type:
        rows = conn.execute(
            "SELECT * FROM budget_provisional_rates WHERE fiscal_year_id = ? AND rate_type = ? ORDER BY pool_group_name, period",
            (fiscal_year_id, rate_type),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM budget_provisional_rates WHERE fiscal_year_id = ? ORDER BY rate_type, pool_group_name, period",
            (fiscal_year_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_reference_rate(conn: sqlite3.Connection, rate_id: int) -> bool:
    with transaction(conn):
        cur = conn.execute("DELETE FROM budget_provisional_rates WHERE id = ?", (rate_id,))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Revenue Data CRUD
# ---------------------------------------------------------------------------

def upsert_revenue(
    conn: sqlite3.Connection, fiscal_year_id: int, period: str, project: str, revenue: float
) -> int:
    with transaction(conn):
        cur = conn.execute(
            """
            INSERT INTO revenue_data (fiscal_year_id, period, project, revenue)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(fiscal_year_id, period, project)
            DO UPDATE SET revenue = excluded.revenue
            """,
            (fiscal_year_id, period, project, revenue),
        )
        return cur.lastrowid  # type: ignore[return-value]


def list_revenue(conn: sqlite3.Connection, fiscal_year_id: int, project: str | None = None) -> list[dict[str, Any]]:
    if project:
        rows = conn.execute(
            "SELECT * FROM revenue_data WHERE fiscal_year_id = ? AND project = ? ORDER BY period",
            (fiscal_year_id, project),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM revenue_data WHERE fiscal_year_id = ? ORDER BY project, period",
            (fiscal_year_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_revenue(conn: sqlite3.Connection, revenue_id: int) -> bool:
    with transaction(conn):
        cur = conn.execute("DELETE FROM revenue_data WHERE id = ?", (revenue_id,))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Cost Category Mappings CRUD
# ---------------------------------------------------------------------------

def create_cost_category(
    conn: sqlite3.Connection,
    fiscal_year_id: int,
    category_type: str,
    category_name: str,
    gl_account: str = "",
    is_direct: bool = True,
) -> int:
    with transaction(conn):
        cur = conn.execute(
            """
            INSERT INTO cost_category_mappings (fiscal_year_id, category_type, category_name, gl_account, is_direct)
            VALUES (?, ?, ?, ?, ?)
            """,
            (fiscal_year_id, category_type, category_name, gl_account, int(is_direct)),
        )
        return cur.lastrowid  # type: ignore[return-value]


def list_cost_categories(
    conn: sqlite3.Connection, fiscal_year_id: int, category_type: str | None = None
) -> list[dict[str, Any]]:
    if category_type:
        rows = conn.execute(
            "SELECT * FROM cost_category_mappings WHERE fiscal_year_id = ? AND category_type = ? ORDER BY category_name",
            (fiscal_year_id, category_type),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM cost_category_mappings WHERE fiscal_year_id = ? ORDER BY category_type, category_name",
            (fiscal_year_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def update_cost_category(conn: sqlite3.Connection, cc_id: int, **kwargs: Any) -> bool:
    allowed = {"category_name", "gl_account", "is_direct"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return False
    # Convert bool to int for SQLite
    if "is_direct" in fields:
        fields["is_direct"] = int(fields["is_direct"])
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [cc_id]
    with transaction(conn):
        cur = conn.execute(f"UPDATE cost_category_mappings SET {sets} WHERE id = ?", vals)
        return cur.rowcount > 0


def delete_cost_category(conn: sqlite3.Connection, cc_id: int) -> bool:
    with transaction(conn):
        cur = conn.execute("DELETE FROM cost_category_mappings WHERE id = ?", (cc_id,))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Bridge functions: DB config → engine config
# ---------------------------------------------------------------------------

def build_rate_config_from_db(conn: sqlite3.Connection, fiscal_year_id: int) -> dict[str, Any]:
    """Build a rate config mapping (suitable for RateConfig.from_mapping) from DB pool setup."""
    from .config import RateConfig

    pool_groups = list_pool_groups(conn, fiscal_year_id)
    rates: dict[str, Any] = {}
    all_pool_names: list[str] = []

    for pg in pool_groups:
        pools = list_pools(conn, pg["id"])
        pool_names = [p["name"] for p in pools]
        all_pool_names.extend(pool_names)
        rates[pg["name"]] = {
            "pool": pool_names if pool_names else [pg["name"]],
            "base": pg["base"],
            "cascade_order": pg.get("cascade_order", 0),
        }

    # Use default base definitions
    raw = {
        "base_definitions": {
            "DL": "DirectLabor$",
            "DLH": "DirectLaborHrs",
            "TL": "DirectLabor$",
            "TCI": {"sum": ["DirectLabor$", "Subk", "ODC", "Travel"]},
        },
        "rates": rates,
        "unallowable_pool_names": ["Unallowable"],
    }
    return raw


def build_account_map_df_from_db(conn: sqlite3.Connection, fiscal_year_id: int) -> pd.DataFrame:
    """Build an Account_Map DataFrame from DB GL account mappings."""
    rows = conn.execute(
        """
        SELECT gm.account AS "Account",
               p.name AS "Pool",
               pg.base AS "BaseCategory",
               gm.is_unallowable AS "IsUnallowable",
               gm.notes AS "Notes"
        FROM gl_account_mappings gm
        JOIN pools p ON gm.pool_id = p.id
        JOIN pool_groups pg ON p.pool_group_id = pg.id
        WHERE pg.fiscal_year_id = ?
        ORDER BY gm.account
        """,
        (fiscal_year_id,),
    ).fetchall()

    if not rows:
        return pd.DataFrame(columns=["Account", "Pool", "BaseCategory", "IsUnallowable", "Notes"])

    df = pd.DataFrame([dict(r) for r in rows])
    df["IsUnallowable"] = df["IsUnallowable"].astype(bool)
    return df


# ---------------------------------------------------------------------------
# Chart of Accounts CRUD
# ---------------------------------------------------------------------------

def list_chart_of_accounts(conn: sqlite3.Connection, fiscal_year_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM chart_of_accounts WHERE fiscal_year_id = ? ORDER BY account",
        (fiscal_year_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def create_chart_account(
    conn: sqlite3.Connection, fiscal_year_id: int, account: str, name: str = "", category: str = ""
) -> int:
    with transaction(conn):
        cur = conn.execute(
            "INSERT INTO chart_of_accounts (fiscal_year_id, account, name, category) VALUES (?, ?, ?, ?)",
            (fiscal_year_id, account, name, category),
        )
        return cur.lastrowid  # type: ignore[return-value]


def bulk_create_chart_accounts(
    conn: sqlite3.Connection, fiscal_year_id: int, accounts: list[dict[str, str]]
) -> list[int]:
    ids = []
    with transaction(conn):
        for acct in accounts:
            cur = conn.execute(
                "INSERT OR IGNORE INTO chart_of_accounts (fiscal_year_id, account, name, category) VALUES (?, ?, ?, ?)",
                (fiscal_year_id, acct.get("account", ""), acct.get("name", ""), acct.get("category", "")),
            )
            if cur.lastrowid:
                ids.append(cur.lastrowid)
    return ids


def delete_chart_account(conn: sqlite3.Connection, account_id: int) -> bool:
    with transaction(conn):
        cur = conn.execute("DELETE FROM chart_of_accounts WHERE id = ?", (account_id,))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Pool Group Base Accounts CRUD
# ---------------------------------------------------------------------------

def list_base_accounts(conn: sqlite3.Connection, pool_group_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM pool_group_base_accounts WHERE pool_group_id = ? ORDER BY account",
        (pool_group_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def create_base_account(
    conn: sqlite3.Connection, pool_group_id: int, account: str, notes: str = ""
) -> int:
    with transaction(conn):
        cur = conn.execute(
            "INSERT INTO pool_group_base_accounts (pool_group_id, account, notes) VALUES (?, ?, ?)",
            (pool_group_id, account, notes),
        )
        return cur.lastrowid  # type: ignore[return-value]


def delete_base_account(conn: sqlite3.Connection, base_account_id: int) -> bool:
    with transaction(conn):
        cur = conn.execute("DELETE FROM pool_group_base_accounts WHERE id = ?", (base_account_id,))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Available Account Helpers
# ---------------------------------------------------------------------------

def get_available_cost_accounts(conn: sqlite3.Connection, fiscal_year_id: int) -> list[dict[str, Any]]:
    """Return chart_of_accounts entries not assigned as cost accounts in any pool for this FY."""
    rows = conn.execute(
        """
        SELECT ca.* FROM chart_of_accounts ca
        WHERE ca.fiscal_year_id = ?
          AND ca.account NOT IN (
            SELECT gm.account
            FROM gl_account_mappings gm
            JOIN pools p ON gm.pool_id = p.id
            JOIN pool_groups pg ON p.pool_group_id = pg.id
            WHERE pg.fiscal_year_id = ?
          )
        ORDER BY ca.account
        """,
        (fiscal_year_id, fiscal_year_id),
    ).fetchall()
    return [dict(r) for r in rows]


def get_available_base_accounts(conn: sqlite3.Connection, fiscal_year_id: int) -> list[dict[str, Any]]:
    """Return chart_of_accounts entries not assigned as base accounts in any pool group for this FY."""
    rows = conn.execute(
        """
        SELECT ca.* FROM chart_of_accounts ca
        WHERE ca.fiscal_year_id = ?
          AND ca.account NOT IN (
            SELECT ba.account
            FROM pool_group_base_accounts ba
            JOIN pool_groups pg ON ba.pool_group_id = pg.id
            WHERE pg.fiscal_year_id = ?
          )
        ORDER BY ca.account
        """,
        (fiscal_year_id, fiscal_year_id),
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Copy FY Setup
# ---------------------------------------------------------------------------

def copy_fy_setup(conn: sqlite3.Connection, source_fy_id: int, target_fy_id: int) -> dict[str, int]:
    """Clone the entire pool setup from one fiscal year to another.

    Copies: chart_of_accounts, rate_groups, pool_groups, pools,
    gl_account_mappings, pool_group_base_accounts.

    Returns counts of copied items.
    """
    counts: dict[str, int] = {
        "chart_accounts": 0,
        "rate_groups": 0,
        "pool_groups": 0,
        "pools": 0,
        "gl_mappings": 0,
        "base_accounts": 0,
    }

    with transaction(conn):
        # 1. Copy chart of accounts
        src_accounts = conn.execute(
            "SELECT account, name, category FROM chart_of_accounts WHERE fiscal_year_id = ?",
            (source_fy_id,),
        ).fetchall()
        for a in src_accounts:
            conn.execute(
                "INSERT OR IGNORE INTO chart_of_accounts (fiscal_year_id, account, name, category) VALUES (?, ?, ?, ?)",
                (target_fy_id, a["account"], a["name"], a["category"]),
            )
            counts["chart_accounts"] += 1

        # 2. Copy rate groups and track old→new id mapping
        rg_map: dict[int, int] = {}
        src_rgs = conn.execute(
            "SELECT * FROM rate_groups WHERE fiscal_year_id = ? ORDER BY display_order",
            (source_fy_id,),
        ).fetchall()
        for rg in src_rgs:
            cur = conn.execute(
                "INSERT INTO rate_groups (fiscal_year_id, name, display_order) VALUES (?, ?, ?)",
                (target_fy_id, rg["name"], rg["display_order"]),
            )
            rg_map[rg["id"]] = cur.lastrowid  # type: ignore[assignment]
            counts["rate_groups"] += 1

        # 3. Copy pool groups
        pg_map: dict[int, int] = {}
        src_pgs = conn.execute(
            "SELECT * FROM pool_groups WHERE fiscal_year_id = ? ORDER BY display_order",
            (source_fy_id,),
        ).fetchall()
        for pg in src_pgs:
            new_rg_id = rg_map.get(pg["rate_group_id"]) if pg["rate_group_id"] else None
            cur = conn.execute(
                "INSERT INTO pool_groups (fiscal_year_id, name, base, display_order, rate_group_id, cascade_order) VALUES (?, ?, ?, ?, ?, ?)",
                (target_fy_id, pg["name"], pg["base"], pg["display_order"], new_rg_id, pg["cascade_order"]),
            )
            pg_map[pg["id"]] = cur.lastrowid  # type: ignore[assignment]
            counts["pool_groups"] += 1

        # 4. Copy pools and GL mappings
        pool_map: dict[int, int] = {}
        for old_pg_id, new_pg_id in pg_map.items():
            src_pools = conn.execute(
                "SELECT * FROM pools WHERE pool_group_id = ? ORDER BY display_order",
                (old_pg_id,),
            ).fetchall()
            for pool in src_pools:
                cur = conn.execute(
                    "INSERT INTO pools (pool_group_id, name, display_order) VALUES (?, ?, ?)",
                    (new_pg_id, pool["name"], pool["display_order"]),
                )
                new_pool_id = cur.lastrowid
                pool_map[pool["id"]] = new_pool_id  # type: ignore[assignment]
                counts["pools"] += 1

                # Copy GL mappings for this pool
                src_mappings = conn.execute(
                    "SELECT * FROM gl_account_mappings WHERE pool_id = ?",
                    (pool["id"],),
                ).fetchall()
                for m in src_mappings:
                    conn.execute(
                        "INSERT INTO gl_account_mappings (pool_id, account, is_unallowable, notes) VALUES (?, ?, ?, ?)",
                        (new_pool_id, m["account"], m["is_unallowable"], m["notes"]),
                    )
                    counts["gl_mappings"] += 1

            # 5. Copy base accounts for this pool group
            src_base = conn.execute(
                "SELECT * FROM pool_group_base_accounts WHERE pool_group_id = ?",
                (old_pg_id,),
            ).fetchall()
            for ba in src_base:
                conn.execute(
                    "INSERT INTO pool_group_base_accounts (pool_group_id, account, notes) VALUES (?, ?, ?)",
                    (new_pg_id, ba["account"], ba["notes"]),
                )
                counts["base_accounts"] += 1

    return counts
