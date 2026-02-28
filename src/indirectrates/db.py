"""PostgreSQL persistence layer for the Indirect Rates application.

Provides schema, connection management, and CRUD functions for:
- Fiscal years (user-scoped)
- Pool groups and pools
- GL account mappings
- Budget/provisional/forward-pricing rates
- Revenue data
- Cost category mappings
- Uploaded files
"""

from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from typing import Any, Generator

import pandas as pd
import psycopg2
import psycopg2.extras

MAX_STORAGE_BYTES = 100 * 1024 * 1024  # 100 MB per user

# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

def get_connection() -> psycopg2.extensions.connection:
    """Open a psycopg2 connection.

    Priority for connection string:
      1. POSTGRES_URL_NON_POOLING  — Vercel/Neon direct endpoint (best for psycopg2)
      2. DATABASE_URL              — manual override or local dev
      3. Localhost fallback        — local dev without any env vars
    """
    url = (
        os.environ.get("POSTGRES_URL_NON_POOLING")
        or os.environ.get("DATABASE_URL")
        or "postgresql://indirectrates:dev@localhost:5432/indirectrates"
    )
    try:
        connect_timeout = int(os.environ.get("DB_CONNECT_TIMEOUT_SECONDS", "5"))
    except ValueError:
        connect_timeout = 5
    try:
        retries = int(os.environ.get("DB_CONNECT_RETRIES", "2"))
    except ValueError:
        retries = 2
    try:
        backoff_seconds = float(os.environ.get("DB_CONNECT_RETRY_BACKOFF_SECONDS", "0.25"))
    except ValueError:
        backoff_seconds = 0.25

    retries = max(0, retries)
    backoff_seconds = max(0.0, backoff_seconds)

    last_exc: psycopg2.OperationalError | None = None
    for attempt in range(retries + 1):
        try:
            conn = psycopg2.connect(
                url,
                cursor_factory=psycopg2.extras.RealDictCursor,
                connect_timeout=connect_timeout,
            )
            return conn
        except psycopg2.OperationalError as exc:
            last_exc = exc
            if attempt >= retries:
                break
            time.sleep(backoff_seconds * (2 ** attempt))

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("Failed to establish database connection")


@contextmanager
def transaction(conn: psycopg2.extensions.connection) -> Generator[psycopg2.extensions.connection, None, None]:
    """Context manager that commits on success, rolls back on error."""
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


# ---------------------------------------------------------------------------
# Schema & init
# ---------------------------------------------------------------------------

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS fiscal_years (
    id          SERIAL PRIMARY KEY,
    user_id     TEXT    NOT NULL DEFAULT '',
    name        TEXT    NOT NULL,
    start_month TEXT    NOT NULL,
    end_month   TEXT    NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS rate_groups (
    id              SERIAL PRIMARY KEY,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    display_order   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(fiscal_year_id, name)
);

CREATE TABLE IF NOT EXISTS pool_groups (
    id              SERIAL PRIMARY KEY,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    rate_group_id   INTEGER REFERENCES rate_groups(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    base            TEXT    NOT NULL DEFAULT 'DL',
    display_order   INTEGER NOT NULL DEFAULT 0,
    cascade_order   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(fiscal_year_id, name)
);

CREATE TABLE IF NOT EXISTS pools (
    id              SERIAL PRIMARY KEY,
    pool_group_id   INTEGER NOT NULL REFERENCES pool_groups(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    display_order   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(pool_group_id, name)
);

CREATE TABLE IF NOT EXISTS gl_account_mappings (
    id              SERIAL PRIMARY KEY,
    pool_id         INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    account         TEXT    NOT NULL,
    is_unallowable  BOOLEAN NOT NULL DEFAULT FALSE,
    notes           TEXT    NOT NULL DEFAULT '',
    UNIQUE(pool_id, account)
);

CREATE TABLE IF NOT EXISTS budget_provisional_rates (
    id              SERIAL PRIMARY KEY,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    rate_type       TEXT    NOT NULL,
    pool_group_name TEXT    NOT NULL,
    period          TEXT    NOT NULL,
    rate_value      REAL    NOT NULL DEFAULT 0.0,
    UNIQUE(fiscal_year_id, rate_type, pool_group_name, period)
);

CREATE TABLE IF NOT EXISTS revenue_data (
    id              SERIAL PRIMARY KEY,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    period          TEXT    NOT NULL,
    project         TEXT    NOT NULL,
    revenue         REAL    NOT NULL DEFAULT 0.0,
    UNIQUE(fiscal_year_id, period, project)
);

CREATE TABLE IF NOT EXISTS cost_category_mappings (
    id              SERIAL PRIMARY KEY,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    category_type   TEXT    NOT NULL,
    category_name   TEXT    NOT NULL,
    gl_account      TEXT    NOT NULL DEFAULT '',
    is_direct       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(fiscal_year_id, category_type, category_name)
);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id              SERIAL PRIMARY KEY,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    account         TEXT    NOT NULL,
    name            TEXT    NOT NULL DEFAULT '',
    category        TEXT    NOT NULL DEFAULT '',
    UNIQUE(fiscal_year_id, account)
);

CREATE TABLE IF NOT EXISTS pool_group_base_accounts (
    id              SERIAL PRIMARY KEY,
    pool_group_id   INTEGER NOT NULL REFERENCES pool_groups(id) ON DELETE CASCADE,
    account         TEXT    NOT NULL,
    notes           TEXT    NOT NULL DEFAULT '',
    UNIQUE(pool_group_id, account)
);

CREATE TABLE IF NOT EXISTS scenarios (
    id              SERIAL PRIMARY KEY,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    description     TEXT    NOT NULL DEFAULT '',
    UNIQUE(fiscal_year_id, name)
);

CREATE TABLE IF NOT EXISTS scenario_events (
    id                      SERIAL PRIMARY KEY,
    scenario_id             INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    effective_period        TEXT    NOT NULL,
    event_type              TEXT    NOT NULL DEFAULT 'ADJUST',
    project                 TEXT    NOT NULL DEFAULT '',
    delta_direct_labor      REAL    NOT NULL DEFAULT 0,
    delta_direct_labor_hrs  REAL    NOT NULL DEFAULT 0,
    delta_subk              REAL    NOT NULL DEFAULT 0,
    delta_odc               REAL    NOT NULL DEFAULT 0,
    delta_travel            REAL    NOT NULL DEFAULT 0,
    pool_deltas             TEXT    NOT NULL DEFAULT '{}',
    notes                   TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS forecast_runs (
    id              SERIAL PRIMARY KEY,
    fiscal_year_id  INTEGER REFERENCES fiscal_years(id) ON DELETE CASCADE,
    scenario        TEXT    NOT NULL DEFAULT '',
    forecast_months INTEGER NOT NULL,
    run_rate_months INTEGER NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    assumptions_json TEXT   NOT NULL DEFAULT '{}',
    output_zip      BYTEA
);

CREATE TABLE IF NOT EXISTS uploaded_files (
    id             SERIAL PRIMARY KEY,
    fiscal_year_id INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    file_type      TEXT    NOT NULL,
    file_name      TEXT    NOT NULL,
    content        BYTEA   NOT NULL,
    size_bytes     INTEGER NOT NULL DEFAULT 0,
    uploaded_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
"""


def init_db() -> None:
    """Create all tables. Idempotent."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(_SCHEMA)
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Storage tracking
# ---------------------------------------------------------------------------

def get_user_storage_bytes(conn: psycopg2.extensions.connection, user_id: str) -> int:
    """Return total bytes stored by this user across forecast_runs + uploaded_files."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(SUM(octet_length(fr.output_zip)), 0) AS total
            FROM forecast_runs fr
            JOIN fiscal_years fy ON fr.fiscal_year_id = fy.id
            WHERE fy.user_id = %s
            """,
            (user_id,),
        )
        run_bytes = (cur.fetchone() or {}).get("total") or 0

        cur.execute(
            """
            SELECT COALESCE(SUM(uf.size_bytes), 0) AS total
            FROM uploaded_files uf
            JOIN fiscal_years fy ON uf.fiscal_year_id = fy.id
            WHERE fy.user_id = %s
            """,
            (user_id,),
        )
        file_bytes = (cur.fetchone() or {}).get("total") or 0

    return int(run_bytes) + int(file_bytes)


# ---------------------------------------------------------------------------
# Fiscal Years CRUD
# ---------------------------------------------------------------------------

def create_fiscal_year(
    conn: psycopg2.extensions.connection,
    name: str,
    start_month: str,
    end_month: str,
    user_id: str = "",
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO fiscal_years (user_id, name, start_month, end_month) VALUES (%s, %s, %s, %s) RETURNING id",
                (user_id, name, start_month, end_month),
            )
            return cur.fetchone()["id"]


def list_fiscal_years(
    conn: psycopg2.extensions.connection, user_id: str | None = None
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        if user_id is not None:
            cur.execute(
                "SELECT * FROM fiscal_years WHERE user_id = %s ORDER BY start_month DESC",
                (user_id,),
            )
        else:
            cur.execute("SELECT * FROM fiscal_years ORDER BY start_month DESC")
        return [dict(r) for r in cur.fetchall()]


def get_fiscal_year(
    conn: psycopg2.extensions.connection, fy_id: int, user_id: str | None = None
) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        if user_id is not None:
            cur.execute(
                "SELECT * FROM fiscal_years WHERE id = %s AND (user_id = %s OR user_id = '')",
                (fy_id, user_id),
            )
        else:
            cur.execute("SELECT * FROM fiscal_years WHERE id = %s", (fy_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def delete_fiscal_year(conn: psycopg2.extensions.connection, fy_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM fiscal_years WHERE id = %s", (fy_id,))
            return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Rate Groups CRUD
# ---------------------------------------------------------------------------

def create_rate_group(
    conn: psycopg2.extensions.connection, fiscal_year_id: int, name: str, display_order: int = 0
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO rate_groups (fiscal_year_id, name, display_order) VALUES (%s, %s, %s) RETURNING id",
                (fiscal_year_id, name, display_order),
            )
            return cur.fetchone()["id"]


def list_rate_groups(conn: psycopg2.extensions.connection, fiscal_year_id: int) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM rate_groups WHERE fiscal_year_id = %s ORDER BY display_order, name",
            (fiscal_year_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def update_rate_group(conn: psycopg2.extensions.connection, rg_id: int, **kwargs: Any) -> bool:
    allowed = {"name", "display_order"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return False
    sets = ", ".join(f"{k} = %s" for k in fields)
    vals = list(fields.values()) + [rg_id]
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(f"UPDATE rate_groups SET {sets} WHERE id = %s", vals)
            return cur.rowcount > 0


def delete_rate_group(conn: psycopg2.extensions.connection, rg_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM rate_groups WHERE id = %s", (rg_id,))
            return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Pool Groups CRUD
# ---------------------------------------------------------------------------

def create_pool_group(
    conn: psycopg2.extensions.connection,
    fiscal_year_id: int,
    name: str,
    base: str = "DL",
    display_order: int = 0,
    rate_group_id: int | None = None,
    cascade_order: int = 0,
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO pool_groups (fiscal_year_id, name, base, display_order, rate_group_id, cascade_order) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (fiscal_year_id, name, base, display_order, rate_group_id, cascade_order),
            )
            return cur.fetchone()["id"]


def list_pool_groups(
    conn: psycopg2.extensions.connection,
    fiscal_year_id: int,
    rate_group_id: int | None = None,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        if rate_group_id is not None:
            cur.execute(
                "SELECT * FROM pool_groups WHERE fiscal_year_id = %s AND rate_group_id = %s ORDER BY cascade_order, display_order, name",
                (fiscal_year_id, rate_group_id),
            )
        else:
            cur.execute(
                "SELECT * FROM pool_groups WHERE fiscal_year_id = %s ORDER BY cascade_order, display_order, name",
                (fiscal_year_id,),
            )
        return [dict(r) for r in cur.fetchall()]


def update_pool_group(conn: psycopg2.extensions.connection, pg_id: int, **kwargs: Any) -> bool:
    allowed = {"name", "base", "display_order", "rate_group_id", "cascade_order"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return False
    sets = ", ".join(f"{k} = %s" for k in fields)
    vals = list(fields.values()) + [pg_id]
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(f"UPDATE pool_groups SET {sets} WHERE id = %s", vals)
            return cur.rowcount > 0


def delete_pool_group(conn: psycopg2.extensions.connection, pg_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM pool_groups WHERE id = %s", (pg_id,))
            return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Pools CRUD
# ---------------------------------------------------------------------------

def create_pool(conn: psycopg2.extensions.connection, pool_group_id: int, name: str, display_order: int = 0) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO pools (pool_group_id, name, display_order) VALUES (%s, %s, %s) RETURNING id",
                (pool_group_id, name, display_order),
            )
            return cur.fetchone()["id"]


def list_pools(conn: psycopg2.extensions.connection, pool_group_id: int) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM pools WHERE pool_group_id = %s ORDER BY display_order, name",
            (pool_group_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def get_pool(conn: psycopg2.extensions.connection, pool_id: int) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM pools WHERE id = %s", (pool_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def update_pool(conn: psycopg2.extensions.connection, pool_id: int, **kwargs: Any) -> bool:
    allowed = {"name", "display_order"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return False
    sets = ", ".join(f"{k} = %s" for k in fields)
    vals = list(fields.values()) + [pool_id]
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(f"UPDATE pools SET {sets} WHERE id = %s", vals)
            return cur.rowcount > 0


def delete_pool(conn: psycopg2.extensions.connection, pool_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM pools WHERE id = %s", (pool_id,))
            return cur.rowcount > 0


# ---------------------------------------------------------------------------
# GL Account Mappings CRUD
# ---------------------------------------------------------------------------

def check_cost_account_conflict(
    conn: psycopg2.extensions.connection, pool_id: int, account: str
) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT gm.account,
                   p2.name   AS existing_pool,
                   pg2.name  AS existing_pool_group,
                   rg.name   AS rate_group
            FROM gl_account_mappings gm
            JOIN pools p2        ON gm.pool_id = p2.id
            JOIN pool_groups pg2 ON p2.pool_group_id = pg2.id
            LEFT JOIN rate_groups rg ON pg2.rate_group_id = rg.id
            WHERE gm.account = %s
              AND gm.pool_id != %s
              AND pg2.rate_group_id = (
                  SELECT pg.rate_group_id
                  FROM pools p
                  JOIN pool_groups pg ON p.pool_group_id = pg.id
                  WHERE p.id = %s
              )
            LIMIT 1
            """,
            (account, pool_id, pool_id),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def create_gl_mapping(
    conn: psycopg2.extensions.connection, pool_id: int, account: str, is_unallowable: bool = False, notes: str = ""
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO gl_account_mappings (pool_id, account, is_unallowable, notes) VALUES (%s, %s, %s, %s) RETURNING id",
                (pool_id, account, is_unallowable, notes),
            )
            return cur.fetchone()["id"]


def list_gl_mappings(conn: psycopg2.extensions.connection, pool_id: int) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM gl_account_mappings WHERE pool_id = %s ORDER BY account",
            (pool_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def delete_gl_mapping(conn: psycopg2.extensions.connection, mapping_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM gl_account_mappings WHERE id = %s", (mapping_id,))
            return cur.rowcount > 0


def get_unassigned_accounts(conn: psycopg2.extensions.connection, fiscal_year_id: int) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT gm.account
            FROM gl_account_mappings gm
            JOIN pools p ON gm.pool_id = p.id
            JOIN pool_groups pg ON p.pool_group_id = pg.id
            WHERE pg.fiscal_year_id = %s
            """,
            (fiscal_year_id,),
        )
        assigned_set = {r["account"] for r in cur.fetchall()}

        cur.execute(
            """
            SELECT DISTINCT gm.account
            FROM gl_account_mappings gm
            JOIN pools p ON gm.pool_id = p.id
            JOIN pool_groups pg ON p.pool_group_id = pg.id
            """,
        )
        all_set = {r["account"] for r in cur.fetchall()}
    return sorted(all_set - assigned_set)


# ---------------------------------------------------------------------------
# Budget / Provisional Rates CRUD
# ---------------------------------------------------------------------------

def upsert_reference_rate(
    conn: psycopg2.extensions.connection,
    fiscal_year_id: int,
    rate_type: str,
    pool_group_name: str,
    period: str,
    rate_value: float,
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO budget_provisional_rates (fiscal_year_id, rate_type, pool_group_name, period, rate_value)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT(fiscal_year_id, rate_type, pool_group_name, period)
                DO UPDATE SET rate_value = EXCLUDED.rate_value
                RETURNING id
                """,
                (fiscal_year_id, rate_type, pool_group_name, period, rate_value),
            )
            return cur.fetchone()["id"]


def bulk_upsert_reference_rates_atomic(
    conn: psycopg2.extensions.connection,
    fiscal_year_id: int,
    rows: list[dict[str, Any]],
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(
                cur,
                """
                INSERT INTO budget_provisional_rates (fiscal_year_id, rate_type, pool_group_name, period, rate_value)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT(fiscal_year_id, rate_type, pool_group_name, period)
                DO UPDATE SET rate_value = EXCLUDED.rate_value
                """,
                [
                    (fiscal_year_id, r["rate_type"], r["pool_group_name"], r["period"], r["rate_value"])
                    for r in rows
                ],
            )
    return len(rows)


def list_reference_rates(
    conn: psycopg2.extensions.connection, fiscal_year_id: int, rate_type: str | None = None
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        if rate_type:
            cur.execute(
                "SELECT * FROM budget_provisional_rates WHERE fiscal_year_id = %s AND rate_type = %s ORDER BY pool_group_name, period",
                (fiscal_year_id, rate_type),
            )
        else:
            cur.execute(
                "SELECT * FROM budget_provisional_rates WHERE fiscal_year_id = %s ORDER BY rate_type, pool_group_name, period",
                (fiscal_year_id,),
            )
        return [dict(r) for r in cur.fetchall()]


def delete_reference_rate(conn: psycopg2.extensions.connection, rate_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM budget_provisional_rates WHERE id = %s", (rate_id,))
            return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Revenue Data CRUD
# ---------------------------------------------------------------------------

def upsert_revenue(
    conn: psycopg2.extensions.connection, fiscal_year_id: int, period: str, project: str, revenue: float
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO revenue_data (fiscal_year_id, period, project, revenue)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT(fiscal_year_id, period, project)
                DO UPDATE SET revenue = EXCLUDED.revenue
                RETURNING id
                """,
                (fiscal_year_id, period, project, revenue),
            )
            return cur.fetchone()["id"]


def list_revenue(
    conn: psycopg2.extensions.connection, fiscal_year_id: int, project: str | None = None
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        if project:
            cur.execute(
                "SELECT * FROM revenue_data WHERE fiscal_year_id = %s AND project = %s ORDER BY period",
                (fiscal_year_id, project),
            )
        else:
            cur.execute(
                "SELECT * FROM revenue_data WHERE fiscal_year_id = %s ORDER BY project, period",
                (fiscal_year_id,),
            )
        return [dict(r) for r in cur.fetchall()]


def delete_revenue(conn: psycopg2.extensions.connection, revenue_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM revenue_data WHERE id = %s", (revenue_id,))
            return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Cost Category Mappings CRUD
# ---------------------------------------------------------------------------

def create_cost_category(
    conn: psycopg2.extensions.connection,
    fiscal_year_id: int,
    category_type: str,
    category_name: str,
    gl_account: str = "",
    is_direct: bool = True,
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO cost_category_mappings (fiscal_year_id, category_type, category_name, gl_account, is_direct)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
                """,
                (fiscal_year_id, category_type, category_name, gl_account, is_direct),
            )
            return cur.fetchone()["id"]


def list_cost_categories(
    conn: psycopg2.extensions.connection, fiscal_year_id: int, category_type: str | None = None
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        if category_type:
            cur.execute(
                "SELECT * FROM cost_category_mappings WHERE fiscal_year_id = %s AND category_type = %s ORDER BY category_name",
                (fiscal_year_id, category_type),
            )
        else:
            cur.execute(
                "SELECT * FROM cost_category_mappings WHERE fiscal_year_id = %s ORDER BY category_type, category_name",
                (fiscal_year_id,),
            )
        return [dict(r) for r in cur.fetchall()]


def update_cost_category(conn: psycopg2.extensions.connection, cc_id: int, **kwargs: Any) -> bool:
    allowed = {"category_name", "gl_account", "is_direct"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return False
    sets = ", ".join(f"{k} = %s" for k in fields)
    vals = list(fields.values()) + [cc_id]
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(f"UPDATE cost_category_mappings SET {sets} WHERE id = %s", vals)
            return cur.rowcount > 0


def delete_cost_category(conn: psycopg2.extensions.connection, cc_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cost_category_mappings WHERE id = %s", (cc_id,))
            return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Chart of Accounts CRUD
# ---------------------------------------------------------------------------

def list_chart_of_accounts(conn: psycopg2.extensions.connection, fiscal_year_id: int) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM chart_of_accounts WHERE fiscal_year_id = %s ORDER BY account",
            (fiscal_year_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def create_chart_account(
    conn: psycopg2.extensions.connection, fiscal_year_id: int, account: str, name: str = "", category: str = ""
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO chart_of_accounts (fiscal_year_id, account, name, category) VALUES (%s, %s, %s, %s) RETURNING id",
                (fiscal_year_id, account, name, category),
            )
            return cur.fetchone()["id"]


def bulk_create_chart_accounts(
    conn: psycopg2.extensions.connection, fiscal_year_id: int, accounts: list[dict[str, str]]
) -> list[int]:
    ids = []
    with transaction(conn):
        with conn.cursor() as cur:
            for acct in accounts:
                cur.execute(
                    """
                    INSERT INTO chart_of_accounts (fiscal_year_id, account, name, category)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (fiscal_year_id, account) DO NOTHING
                    RETURNING id
                    """,
                    (fiscal_year_id, acct.get("account", ""), acct.get("name", ""), acct.get("category", "")),
                )
                row = cur.fetchone()
                if row:
                    ids.append(row["id"])
    return ids


def delete_chart_account(conn: psycopg2.extensions.connection, account_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM chart_of_accounts WHERE id = %s", (account_id,))
            return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Pool Group Base Accounts CRUD
# ---------------------------------------------------------------------------

def list_base_accounts(conn: psycopg2.extensions.connection, pool_group_id: int) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM pool_group_base_accounts WHERE pool_group_id = %s ORDER BY account",
            (pool_group_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def create_base_account(
    conn: psycopg2.extensions.connection, pool_group_id: int, account: str, notes: str = ""
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO pool_group_base_accounts (pool_group_id, account, notes) VALUES (%s, %s, %s) RETURNING id",
                (pool_group_id, account, notes),
            )
            return cur.fetchone()["id"]


def delete_base_account(conn: psycopg2.extensions.connection, base_account_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM pool_group_base_accounts WHERE id = %s", (base_account_id,))
            return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Available Account Helpers
# ---------------------------------------------------------------------------

def get_available_cost_accounts(conn: psycopg2.extensions.connection, fiscal_year_id: int) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ca.* FROM chart_of_accounts ca
            WHERE ca.fiscal_year_id = %s
              AND ca.account NOT IN (
                SELECT gm.account
                FROM gl_account_mappings gm
                JOIN pools p ON gm.pool_id = p.id
                JOIN pool_groups pg ON p.pool_group_id = pg.id
                WHERE pg.fiscal_year_id = %s
              )
            ORDER BY ca.account
            """,
            (fiscal_year_id, fiscal_year_id),
        )
        return [dict(r) for r in cur.fetchall()]


def get_available_base_accounts(conn: psycopg2.extensions.connection, fiscal_year_id: int) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ca.* FROM chart_of_accounts ca
            WHERE ca.fiscal_year_id = %s
              AND ca.account NOT IN (
                SELECT ba.account
                FROM pool_group_base_accounts ba
                JOIN pool_groups pg ON ba.pool_group_id = pg.id
                WHERE pg.fiscal_year_id = %s
              )
            ORDER BY ca.account
            """,
            (fiscal_year_id, fiscal_year_id),
        )
        return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Copy FY Setup
# ---------------------------------------------------------------------------

def copy_fy_setup(conn: psycopg2.extensions.connection, source_fy_id: int, target_fy_id: int) -> dict[str, int]:
    counts: dict[str, int] = {
        "chart_accounts": 0,
        "rate_groups": 0,
        "pool_groups": 0,
        "pools": 0,
        "gl_mappings": 0,
        "base_accounts": 0,
    }

    with transaction(conn):
        with conn.cursor() as cur:
            # 1. Copy chart of accounts
            cur.execute(
                "SELECT account, name, category FROM chart_of_accounts WHERE fiscal_year_id = %s",
                (source_fy_id,),
            )
            for a in cur.fetchall():
                cur.execute(
                    "INSERT INTO chart_of_accounts (fiscal_year_id, account, name, category) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                    (target_fy_id, a["account"], a["name"], a["category"]),
                )
                counts["chart_accounts"] += 1

            # 2. Copy rate groups
            rg_map: dict[int, int] = {}
            cur.execute(
                "SELECT * FROM rate_groups WHERE fiscal_year_id = %s ORDER BY display_order",
                (source_fy_id,),
            )
            for rg in cur.fetchall():
                cur.execute(
                    "INSERT INTO rate_groups (fiscal_year_id, name, display_order) VALUES (%s, %s, %s) RETURNING id",
                    (target_fy_id, rg["name"], rg["display_order"]),
                )
                rg_map[rg["id"]] = cur.fetchone()["id"]
                counts["rate_groups"] += 1

            # 3. Copy pool groups
            pg_map: dict[int, int] = {}
            cur.execute(
                "SELECT * FROM pool_groups WHERE fiscal_year_id = %s ORDER BY display_order",
                (source_fy_id,),
            )
            for pg in cur.fetchall():
                new_rg_id = rg_map.get(pg["rate_group_id"]) if pg["rate_group_id"] else None
                cur.execute(
                    "INSERT INTO pool_groups (fiscal_year_id, name, base, display_order, rate_group_id, cascade_order) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                    (target_fy_id, pg["name"], pg["base"], pg["display_order"], new_rg_id, pg["cascade_order"]),
                )
                pg_map[pg["id"]] = cur.fetchone()["id"]
                counts["pool_groups"] += 1

            # 4. Copy pools + GL mappings + base accounts
            for old_pg_id, new_pg_id in pg_map.items():
                cur.execute(
                    "SELECT * FROM pools WHERE pool_group_id = %s ORDER BY display_order",
                    (old_pg_id,),
                )
                for pool in cur.fetchall():
                    cur.execute(
                        "INSERT INTO pools (pool_group_id, name, display_order) VALUES (%s, %s, %s) RETURNING id",
                        (new_pg_id, pool["name"], pool["display_order"]),
                    )
                    new_pool_id = cur.fetchone()["id"]
                    counts["pools"] += 1

                    cur.execute(
                        "SELECT * FROM gl_account_mappings WHERE pool_id = %s",
                        (pool["id"],),
                    )
                    for m in cur.fetchall():
                        cur.execute(
                            "INSERT INTO gl_account_mappings (pool_id, account, is_unallowable, notes) VALUES (%s, %s, %s, %s)",
                            (new_pool_id, m["account"], m["is_unallowable"], m["notes"]),
                        )
                        counts["gl_mappings"] += 1

                cur.execute(
                    "SELECT * FROM pool_group_base_accounts WHERE pool_group_id = %s",
                    (old_pg_id,),
                )
                for ba in cur.fetchall():
                    cur.execute(
                        "INSERT INTO pool_group_base_accounts (pool_group_id, account, notes) VALUES (%s, %s, %s)",
                        (new_pg_id, ba["account"], ba["notes"]),
                    )
                    counts["base_accounts"] += 1

    return counts


# ---------------------------------------------------------------------------
# Scenarios CRUD
# ---------------------------------------------------------------------------

def create_scenario(
    conn: psycopg2.extensions.connection, fiscal_year_id: int, name: str, description: str = ""
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO scenarios (fiscal_year_id, name, description) VALUES (%s, %s, %s) RETURNING id",
                (fiscal_year_id, name, description),
            )
            return cur.fetchone()["id"]


def list_scenarios(conn: psycopg2.extensions.connection, fiscal_year_id: int) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.*, (SELECT COUNT(*) FROM scenario_events se WHERE se.scenario_id = s.id) AS event_count
            FROM scenarios s
            WHERE s.fiscal_year_id = %s
            ORDER BY s.name
            """,
            (fiscal_year_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def get_scenario(conn: psycopg2.extensions.connection, scenario_id: int) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM scenarios WHERE id = %s", (scenario_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def update_scenario(conn: psycopg2.extensions.connection, scenario_id: int, **kwargs: Any) -> bool:
    allowed = {"name", "description"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return False
    sets = ", ".join(f"{k} = %s" for k in fields)
    vals = list(fields.values()) + [scenario_id]
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(f"UPDATE scenarios SET {sets} WHERE id = %s", vals)
            return cur.rowcount > 0


def delete_scenario(conn: psycopg2.extensions.connection, scenario_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM scenarios WHERE id = %s", (scenario_id,))
            return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Scenario Events CRUD
# ---------------------------------------------------------------------------

def create_scenario_event(
    conn: psycopg2.extensions.connection,
    scenario_id: int,
    effective_period: str,
    event_type: str = "ADJUST",
    project: str = "",
    delta_direct_labor: float = 0,
    delta_direct_labor_hrs: float = 0,
    delta_subk: float = 0,
    delta_odc: float = 0,
    delta_travel: float = 0,
    pool_deltas: str = "{}",
    notes: str = "",
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO scenario_events
                    (scenario_id, effective_period, event_type, project,
                     delta_direct_labor, delta_direct_labor_hrs, delta_subk, delta_odc, delta_travel,
                     pool_deltas, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
                """,
                (
                    scenario_id, effective_period, event_type, project,
                    delta_direct_labor, delta_direct_labor_hrs, delta_subk, delta_odc, delta_travel,
                    pool_deltas, notes,
                ),
            )
            return cur.fetchone()["id"]


def list_scenario_events(conn: psycopg2.extensions.connection, scenario_id: int) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM scenario_events WHERE scenario_id = %s ORDER BY effective_period",
            (scenario_id,),
        )
        result = []
        for r in cur.fetchall():
            d = dict(r)
            try:
                d["pool_deltas"] = json.loads(d["pool_deltas"]) if d["pool_deltas"] else {}
            except (json.JSONDecodeError, TypeError):
                d["pool_deltas"] = {}
            result.append(d)
    return result


def update_scenario_event(conn: psycopg2.extensions.connection, event_id: int, **kwargs: Any) -> bool:
    allowed = {
        "effective_period", "event_type", "project",
        "delta_direct_labor", "delta_direct_labor_hrs", "delta_subk", "delta_odc", "delta_travel",
        "pool_deltas", "notes",
    }
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return False
    if "pool_deltas" in fields and isinstance(fields["pool_deltas"], dict):
        fields["pool_deltas"] = json.dumps(fields["pool_deltas"])
    sets = ", ".join(f"{k} = %s" for k in fields)
    vals = list(fields.values()) + [event_id]
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(f"UPDATE scenario_events SET {sets} WHERE id = %s", vals)
            return cur.rowcount > 0


def delete_scenario_event(conn: psycopg2.extensions.connection, event_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM scenario_events WHERE id = %s", (event_id,))
            return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Bridge: DB scenarios → Scenario_Events DataFrame
# ---------------------------------------------------------------------------

def build_scenario_events_df_from_db(
    conn: psycopg2.extensions.connection, fiscal_year_id: int, scenario_name: str | None = None
) -> pd.DataFrame:
    with conn.cursor() as cur:
        if scenario_name:
            cur.execute(
                """
                SELECT s.name AS "Scenario", se.effective_period AS "EffectivePeriod",
                       se.event_type AS "Type", se.project AS "Project",
                       se.delta_direct_labor, se.delta_direct_labor_hrs,
                       se.delta_subk, se.delta_odc, se.delta_travel,
                       se.pool_deltas, se.notes AS "Notes"
                FROM scenario_events se
                JOIN scenarios s ON se.scenario_id = s.id
                WHERE s.fiscal_year_id = %s AND s.name = %s
                ORDER BY s.name, se.effective_period
                """,
                (fiscal_year_id, scenario_name),
            )
        else:
            cur.execute(
                """
                SELECT s.name AS "Scenario", se.effective_period AS "EffectivePeriod",
                       se.event_type AS "Type", se.project AS "Project",
                       se.delta_direct_labor, se.delta_direct_labor_hrs,
                       se.delta_subk, se.delta_odc, se.delta_travel,
                       se.pool_deltas, se.notes AS "Notes"
                FROM scenario_events se
                JOIN scenarios s ON se.scenario_id = s.id
                WHERE s.fiscal_year_id = %s
                ORDER BY s.name, se.effective_period
                """,
                (fiscal_year_id,),
            )
        rows = cur.fetchall()

    if not rows:
        return pd.DataFrame()

    records = []
    all_pool_keys: set[str] = set()
    for r in rows:
        d = dict(r)
        try:
            pool_deltas = json.loads(d.pop("pool_deltas")) if d.get("pool_deltas") else {}
        except (json.JSONDecodeError, TypeError):
            pool_deltas = {}
            d.pop("pool_deltas", None)
        d["DeltaDirectLabor$"] = d.pop("delta_direct_labor")
        d["DeltaDirectLaborHrs"] = d.pop("delta_direct_labor_hrs")
        d["DeltaSubk"] = d.pop("delta_subk")
        d["DeltaODC"] = d.pop("delta_odc")
        d["DeltaTravel"] = d.pop("delta_travel")
        for pool_name, delta_val in pool_deltas.items():
            col_name = pool_name.replace("&", "").replace(" ", "")
            col_key = f"DeltaPool{col_name}"
            d[col_key] = delta_val
            all_pool_keys.add(col_key)
        records.append(d)

    df = pd.DataFrame(records)
    for key in all_pool_keys:
        if key not in df.columns:
            df[key] = 0.0
    df = df.fillna(0)
    return df


# ---------------------------------------------------------------------------
# Bridge: DB config → engine config
# ---------------------------------------------------------------------------

def build_rate_config_from_db(conn: psycopg2.extensions.connection, fiscal_year_id: int) -> dict[str, Any]:
    pool_groups = list_pool_groups(conn, fiscal_year_id)
    rates: dict[str, Any] = {}

    for pg in pool_groups:
        pools = list_pools(conn, pg["id"])
        pool_names = [p["name"] for p in pools]
        rates[pg["name"]] = {
            "pool": pool_names if pool_names else [pg["name"]],
            "base": pg["base"],
            "cascade_order": pg.get("cascade_order", 0),
        }

    base_account_map: dict[str, list[str]] = {}
    for pg in pool_groups:
        base_accounts = list_base_accounts(conn, pg["id"])
        if base_accounts:
            key = pg["base"]
            accts = [ba["account"] for ba in base_accounts]
            base_account_map.setdefault(key, []).extend(accts)
    for key in base_account_map:
        base_account_map[key] = sorted(set(base_account_map[key]))

    raw: dict[str, Any] = {
        "base_definitions": {
            "DL": "DirectLabor$",
            "DLH": "DirectLaborHrs",
            "TL": "DirectLabor$",
            "TCI": {"sum": ["DirectLabor$", "Subk", "ODC", "Travel"]},
        },
        "rates": rates,
        "unallowable_pool_names": ["Unallowable"],
    }
    if base_account_map:
        raw["base_account_map"] = base_account_map
    return raw


def build_account_map_df_from_db(conn: psycopg2.extensions.connection, fiscal_year_id: int) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT gm.account AS "Account",
                   p.name AS "Pool",
                   pg.base AS "BaseCategory",
                   gm.is_unallowable AS "IsUnallowable",
                   gm.notes AS "Notes"
            FROM gl_account_mappings gm
            JOIN pools p ON gm.pool_id = p.id
            JOIN pool_groups pg ON p.pool_group_id = pg.id
            WHERE pg.fiscal_year_id = %s
            ORDER BY gm.account
            """,
            (fiscal_year_id,),
        )
        records = [dict(r) for r in cur.fetchall()]

        mapped_accounts = {r["Account"] for r in records}

        cur.execute(
            """
            SELECT DISTINCT ba.account, ba.notes
            FROM pool_group_base_accounts ba
            JOIN pool_groups pg ON ba.pool_group_id = pg.id
            WHERE pg.fiscal_year_id = %s
            ORDER BY ba.account
            """,
            (fiscal_year_id,),
        )
        for br in cur.fetchall():
            acct = br["account"]
            if acct not in mapped_accounts:
                records.append({
                    "Account": acct,
                    "Pool": "Direct",
                    "BaseCategory": "Direct",
                    "IsUnallowable": False,
                    "Notes": br["notes"],
                })
                mapped_accounts.add(acct)

    if not records:
        return pd.DataFrame(columns=["Account", "Pool", "BaseCategory", "IsUnallowable", "Notes"])

    df = pd.DataFrame(records)
    df["IsUnallowable"] = df["IsUnallowable"].astype(bool)
    return df


# ---------------------------------------------------------------------------
# Forecast Runs CRUD
# ---------------------------------------------------------------------------

def save_forecast_run(
    conn: psycopg2.extensions.connection,
    fiscal_year_id: int | None,
    scenario: str,
    forecast_months: int,
    run_rate_months: int,
    assumptions_json: str,
    output_zip: bytes,
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO forecast_runs (fiscal_year_id, scenario, forecast_months, run_rate_months, assumptions_json, output_zip)
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
                """,
                (fiscal_year_id, scenario, forecast_months, run_rate_months, assumptions_json, psycopg2.Binary(output_zip)),
            )
            return cur.fetchone()["id"]


def list_forecast_runs(
    conn: psycopg2.extensions.connection, fiscal_year_id: int
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, fiscal_year_id, scenario, forecast_months, run_rate_months,
                   created_at, assumptions_json, octet_length(output_zip) as zip_size
            FROM forecast_runs
            WHERE fiscal_year_id = %s
            ORDER BY created_at DESC
            """,
            (fiscal_year_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def get_forecast_run(conn: psycopg2.extensions.connection, run_id: int) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM forecast_runs WHERE id = %s", (run_id,))
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    # Convert memoryview to bytes
    if d.get("output_zip") and isinstance(d["output_zip"], memoryview):
        d["output_zip"] = bytes(d["output_zip"])
    return d


def delete_forecast_run(conn: psycopg2.extensions.connection, run_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM forecast_runs WHERE id = %s", (run_id,))
            return cur.rowcount > 0


def get_dashboard_summary(
    conn: psycopg2.extensions.connection, user_id: str | None = None, demo_only: bool = False
) -> dict[str, Any]:
    with conn.cursor() as cur:
        if user_id is not None:
            cur.execute(
                "SELECT * FROM fiscal_years WHERE user_id = %s ORDER BY start_month DESC",
                (user_id,),
            )
        elif demo_only:
            cur.execute(
                "SELECT * FROM fiscal_years WHERE name LIKE 'DEMO-%' ORDER BY start_month DESC"
            )
        else:
            cur.execute("SELECT * FROM fiscal_years ORDER BY start_month DESC")
        fys = cur.fetchall()

        fy_summaries = []
        for fy in fys:
            fy_id = fy["id"]

            cur.execute("SELECT COUNT(*) AS c FROM rate_groups WHERE fiscal_year_id = %s", (fy_id,))
            rg_count = cur.fetchone()["c"]

            cur.execute("SELECT COUNT(*) AS c FROM pool_groups WHERE fiscal_year_id = %s", (fy_id,))
            pg_count = cur.fetchone()["c"]

            cur.execute(
                """SELECT COUNT(*) AS c FROM gl_account_mappings gm
                   JOIN pools p ON gm.pool_id = p.id
                   JOIN pool_groups pg ON p.pool_group_id = pg.id
                   WHERE pg.fiscal_year_id = %s""",
                (fy_id,),
            )
            gl_count = cur.fetchone()["c"]

            cur.execute("SELECT COUNT(*) AS c FROM chart_of_accounts WHERE fiscal_year_id = %s", (fy_id,))
            ca_count = cur.fetchone()["c"]

            cur.execute("SELECT COUNT(*) AS c FROM scenarios WHERE fiscal_year_id = %s", (fy_id,))
            sc_count = cur.fetchone()["c"]

            cur.execute(
                "SELECT COUNT(*) AS c, MAX(created_at) AS latest FROM forecast_runs WHERE fiscal_year_id = %s",
                (fy_id,),
            )
            fr_row = cur.fetchone()
            fr_count = fr_row["c"]
            latest_run = fr_row["latest"]

            ref_counts = {}
            for rt in ("budget", "provisional", "threshold"):
                cur.execute(
                    "SELECT COUNT(*) AS c FROM budget_provisional_rates WHERE fiscal_year_id = %s AND rate_type = %s",
                    (fy_id, rt),
                )
                ref_counts[rt] = cur.fetchone()["c"]

            cur.execute("SELECT COUNT(*) AS c FROM revenue_data WHERE fiscal_year_id = %s", (fy_id,))
            rev_count = cur.fetchone()["c"]

            fy_summaries.append({
                "id": fy_id,
                "name": fy["name"],
                "start_month": fy["start_month"],
                "end_month": fy["end_month"],
                "rate_groups": rg_count,
                "pool_groups": pg_count,
                "gl_mappings": gl_count,
                "chart_accounts": ca_count,
                "scenarios": sc_count,
                "forecast_runs": fr_count,
                "latest_run": str(latest_run) if latest_run else None,
                "reference_rates": ref_counts,
                "revenue_entries": rev_count,
            })

        # Recent runs scoped to user's FYs
        if user_id is not None:
            cur.execute(
                """SELECT fr.id, fr.fiscal_year_id, fy.name AS fiscal_year_name,
                          fr.scenario, fr.forecast_months, fr.created_at,
                          octet_length(fr.output_zip) AS zip_size
                   FROM forecast_runs fr
                   LEFT JOIN fiscal_years fy ON fr.fiscal_year_id = fy.id
                   WHERE fy.user_id = %s
                   ORDER BY fr.created_at DESC LIMIT 5""",
                (user_id,),
            )
        elif demo_only:
            cur.execute(
                """SELECT fr.id, fr.fiscal_year_id, fy.name AS fiscal_year_name,
                          fr.scenario, fr.forecast_months, fr.created_at,
                          octet_length(fr.output_zip) AS zip_size
                   FROM forecast_runs fr
                   LEFT JOIN fiscal_years fy ON fr.fiscal_year_id = fy.id
                   WHERE fy.name LIKE 'DEMO-%'
                   ORDER BY fr.created_at DESC LIMIT 5"""
            )
        else:
            cur.execute(
                """SELECT fr.id, fr.fiscal_year_id, fy.name AS fiscal_year_name,
                          fr.scenario, fr.forecast_months, fr.created_at,
                          octet_length(fr.output_zip) AS zip_size
                   FROM forecast_runs fr
                   LEFT JOIN fiscal_years fy ON fr.fiscal_year_id = fy.id
                   ORDER BY fr.created_at DESC LIMIT 5"""
            )
        recent_rows = cur.fetchall()

    return {
        "fiscal_years": fy_summaries,
        "recent_runs": [dict(r) for r in recent_rows],
    }


# ---------------------------------------------------------------------------
# Uploaded Files CRUD
# ---------------------------------------------------------------------------

def save_uploaded_file(
    conn: psycopg2.extensions.connection,
    fiscal_year_id: int,
    file_type: str,
    file_name: str,
    content: bytes,
) -> int:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO uploaded_files (fiscal_year_id, file_type, file_name, content, size_bytes)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
                """,
                (fiscal_year_id, file_type, file_name, psycopg2.Binary(content), len(content)),
            )
            return cur.fetchone()["id"]


def list_uploaded_files(conn: psycopg2.extensions.connection, fiscal_year_id: int) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, fiscal_year_id, file_type, file_name, size_bytes, uploaded_at FROM uploaded_files WHERE fiscal_year_id = %s ORDER BY uploaded_at DESC",
            (fiscal_year_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def get_uploaded_file(conn: psycopg2.extensions.connection, file_id: int) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM uploaded_files WHERE id = %s", (file_id,))
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    if d.get("content") and isinstance(d["content"], memoryview):
        d["content"] = bytes(d["content"])
    return d


def delete_uploaded_file(conn: psycopg2.extensions.connection, file_id: int) -> bool:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM uploaded_files WHERE id = %s", (file_id,))
            return cur.rowcount > 0


def get_latest_uploaded_file(
    conn: psycopg2.extensions.connection, fiscal_year_id: int, file_type: str
) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM uploaded_files WHERE fiscal_year_id = %s AND file_type = %s ORDER BY uploaded_at DESC LIMIT 1",
            (fiscal_year_id, file_type),
        )
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    if d.get("content") and isinstance(d["content"], memoryview):
        d["content"] = bytes(d["content"])
    return d
