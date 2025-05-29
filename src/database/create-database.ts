import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import type { Database, DatabaseConfig, QueryResult, DatabaseConnection } from './types.js'
import { runMigrations } from './migrations.js'

const { Pool } = pg

const createPGLiteConnection = async (path: string): Promise<Database> => {
  const pglite = new PGlite(path)
  
  const query = async <T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> => {
    const result = await pglite.query(sql, params)
    return {
      rows: result.rows as T[],
      rowCount: result.rows.length
    }
  }
  
  const transaction = async <T>(fn: (tx: DatabaseConnection) => Promise<T>): Promise<T> => {
    return await pglite.transaction(async (tx) => {
      const txConnection: DatabaseConnection = {
        query: async <T = any>(sql: string, params?: any[]) => {
          const result = await tx.query(sql, params)
          return {
            rows: result.rows as T[],
            rowCount: result.rows.length
          }
        },
        transaction: () => { throw new Error('Nested transactions not supported') },
        close: async () => {}
      }
      return fn(txConnection)
    })
  }
  
  const close = async () => {
    await pglite.close()
  }
  
  const migrate = async () => {
    await runMigrations({ query, transaction, close })
  }
  
  return { query, transaction, close, migrate }
}

const createPostgresConnection = async (connectionString: string): Promise<Database> => {
  const pool = new Pool({ connectionString })
  
  const query = async <T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> => {
    const result = await pool.query(sql, params)
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? 0
    }
  }
  
  const transaction = async <T>(fn: (tx: DatabaseConnection) => Promise<T>): Promise<T> => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn({
        query: async (sql, params) => {
          const res = await client.query(sql, params)
          return { rows: res.rows, rowCount: res.rowCount ?? 0 }
        },
        transaction: () => { throw new Error('Nested transactions not supported') },
        close: async () => {}
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  
  const close = async () => {
    await pool.end()
  }
  
  const migrate = async () => {
    await runMigrations({ query, transaction, close })
  }
  
  return { query, transaction, close, migrate }
}

export const createDatabase = async (config: DatabaseConfig): Promise<Database> => {
  if (config.type === 'pglite') {
    if (!config.pglitePath) {
      throw new Error('pglitePath is required for PGLite')
    }
    return createPGLiteConnection(config.pglitePath)
  } else {
    if (!config.postgresUrl) {
      throw new Error('postgresUrl is required for PostgreSQL')
    }
    return createPostgresConnection(config.postgresUrl)
  }
} 