import type { DatabaseConnection } from './types.js'

type Migration = {
  version: number
  name: string
  up: (db: DatabaseConnection) => Promise<void>
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: async (db) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS monitor_state (
          id INTEGER PRIMARY KEY,
          last_processed_block BIGINT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `)
      
      await db.query(`
        CREATE TABLE IF NOT EXISTS archived_blobs (
          blob_hash TEXT PRIMARY KEY,
          cid TEXT NOT NULL,
          l1_block_number BIGINT NOT NULL,
          l2_source TEXT NOT NULL,
          tx_hash TEXT NOT NULL,
          size INTEGER NOT NULL,
          archived_at TIMESTAMP NOT NULL,
          retrieval_count INTEGER DEFAULT 0,
          last_verified_at TIMESTAMP
        )
      `)
      
      await db.query(`
        CREATE INDEX idx_archived_blobs_block ON archived_blobs(l1_block_number)
      `)
      
      await db.query(`
        CREATE INDEX idx_archived_blobs_cid ON archived_blobs(cid)
      `)
    }
  },
  {
    version: 2,
    name: 'add_metrics_table',
    up: async (db) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS archival_metrics (
          id SERIAL PRIMARY KEY,
          metric_type TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          size_bytes INTEGER,
          success BOOLEAN NOT NULL,
          recorded_at TIMESTAMP NOT NULL
        )
      `)
    }
  }
]

export const runMigrations = async (db: DatabaseConnection): Promise<void> => {
  // Create migrations table
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  
  // Get applied migrations
  const result = await db.query<{ version: number }>('SELECT version FROM migrations')
  const appliedVersions = new Set(result.rows.map(r => r.version))
  
  // Apply pending migrations
  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      console.log(`Applying migration ${migration.version}: ${migration.name}`)
      
      await db.transaction(async (tx) => {
        await migration.up(tx)
        await tx.query(
          'INSERT INTO migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        )
      })
      
      console.log(`Migration ${migration.version} applied successfully`)
    }
  }
} 