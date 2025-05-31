import sqlite3 from 'sqlite3';
import type { Database, DatabaseConfig, QueryResult, DatabaseConnection } from './types.js';
import { runMigrations } from './migrations.js';
import { logger } from '../shared/logger.js'; // Assuming logger is available
import path from 'node:path';
import fs from 'node:fs';

// Promisify sqlite3 methods
const openDb = (dbPath: string): Promise<sqlite3.Database> => {
  return new Promise((resolve, reject) => {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const db = new sqlite3.Database(dbPath, (err: Error | null) => {
      if (err) {
        logger.error(`[DB] Error opening SQLite database at ${dbPath}:`, err);
        reject(err);
      } else {
        logger.info(`[DB] SQLite database opened successfully at ${dbPath}`);
        resolve(db);
      }
    });
  });
};

const dbRun = (db: sqlite3.Database, sql: string, params?: any[]): Promise<{ lastID: number; changes: number }> => {
  return new Promise((resolve, reject) => {
    // Explicitly type 'this' for the callback function
    db.run(sql, params, function (this: sqlite3.RunResult, err: Error | null) {
      if (err) {
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
};

const dbAll = <T = any>(db: sqlite3.Database, sql: string, params?: any[]): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: T[]) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

const dbClose = (db: sqlite3.Database): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.close((err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const createSQLiteConnection = async (dbPath: string): Promise<Database> => {
  const db = await openDb(dbPath);

  // For SQLite, DDL statements (CREATE, ALTER, DROP) don't return rows/rowCount in the same way.
  // `exec` might be more appropriate for migrations or simple DDL.
  // The `query` function here is adapted for SELECT or DML returning data.
  const query = async <T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> => {
    // Basic heuristic: if it's a SELECT, use db.all, otherwise db.run
    // This might need to be more sophisticated for other DML like INSERT RETURNING (SQLite specific)
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      const rows = await dbAll<T>(db, sql, params);
      return {
        rows: rows,
        rowCount: rows.length
      };
    } else {
      // For INSERT, UPDATE, DELETE, etc. `run` is more typical.
      // The `changes` property indicates rows affected.
      const result = await dbRun(db, sql, params);
      return {
        rows: [], // Or could be an array with the lastID if applicable and desired
        rowCount: result.changes // Number of rows changed
      };
    }
  };

  const transaction = async <T>(fn: (tx: DatabaseConnection) => Promise<T>): Promise<T> => {
    await dbRun(db, 'BEGIN IMMEDIATE'); // Use BEGIN IMMEDIATE for better locking behavior
    try {
      const txConnection: DatabaseConnection = {
        query: async <R = any>(sql: string, params?: any[]): Promise<QueryResult<R>> => {
          // Re-use the main query logic, but it operates within the transaction context
          if (sql.trim().toUpperCase().startsWith('SELECT')) {
            const rows = await dbAll<R>(db, sql, params);
            return { rows, rowCount: rows.length };
          } else {
            const result = await dbRun(db, sql, params);
            return { rows: [], rowCount: result.changes };
          }
        },
        transaction: () => { throw new Error('Nested transactions not supported'); },
        close: async () => { /* No-op for individual transaction object */ }
      };
      const result = await fn(txConnection);
      await dbRun(db, 'COMMIT');
      return result;
    } catch (error) {
      await dbRun(db, 'ROLLBACK');
      throw error;
    }
  };

  const close = async () => {
    await dbClose(db);
    logger.info('[DB] SQLite database connection closed.');
  };

  const migrate = async () => {
    // SQLite doesn't have a separate exec, run often suffices for DDL.
    // Pass the query function which can handle DDL via its dbRun path.
    await runMigrations({ query, transaction, close });
  };

  return { query, transaction, close, migrate };
};

export const createDatabase = async (config: DatabaseConfig): Promise<Database> => {
  if (config.type === 'sqlite') {
    if (!config.sqlitePath) {
      // This check is more of a safeguard; Zod schema should ensure sqlitePath is present.
      throw new Error('sqlitePath is required for SQLite database. Check config schema.');
    }
    return createSQLiteConnection(config.sqlitePath);
  } else {
    // This case should be made impossible by the updated DatabaseConfig type and Zod validation.
    // Adding an exhaustive check for type safety.
    const exhaustiveCheck: never = config.type;
    throw new Error(`Unsupported database type after validation: ${exhaustiveCheck}. This should not happen.`);
  }
}; 