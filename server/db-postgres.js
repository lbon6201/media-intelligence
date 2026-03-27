// PostgreSQL database adapter — used when DATABASE_URL is set (production/Railway)
// Provides a synchronous-looking interface by wrapping pg Pool
import pg from 'pg';
const { Pool } = pg;

let pool;

export function initPostgres() {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
  return pool;
}

export function getPool() { return pool; }

// Helper: convert SQLite-style ? placeholders to PostgreSQL $1, $2, etc.
function convertPlaceholders(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

// Convert SQLite functions to PostgreSQL
function convertSql(sql) {
  let s = convertPlaceholders(sql);
  s = s.replace(/datetime\('now'\)/g, 'NOW()');
  s = s.replace(/LIKE/g, 'ILIKE'); // Case-insensitive by default
  s = s.replace(/INSERT OR IGNORE/g, 'INSERT');
  s = s.replace(/ON CONFLICT\(([^)]+)\) DO UPDATE SET/g, 'ON CONFLICT($1) DO UPDATE SET');
  return s;
}

// Wrapper that mimics better-sqlite3 API but uses pg
// This is used for simple queries. Complex route logic stays sync with SQLite.
export class PgDb {
  prepare(sql) {
    const pgSql = convertSql(sql);
    return {
      all: async (...params) => {
        const result = await pool.query(pgSql, params);
        return result.rows;
      },
      get: async (...params) => {
        const result = await pool.query(pgSql, params);
        return result.rows[0] || null;
      },
      run: async (...params) => {
        const result = await pool.query(pgSql, params);
        return { changes: result.rowCount };
      },
    };
  }

  exec(sql) {
    return pool.query(sql);
  }

  transaction(fn) {
    // For pg, transactions need special handling
    return async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn();
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    };
  }
}
