import { createDatabase } from './database/create-database.js'
import { createMonitorStateRepository } from './database/repositories/monitor-state.js'
import { createArchivedBlobsRepository } from './database/repositories/archived-blobs.js'
import { loadConfig } from './shared/config.js'

const main = async () => {
  console.log('Starting Ethereum L2 Blob Archival System...')
  
  try {
    // Load configuration
    const config = loadConfig()
    console.log('Configuration loaded successfully')
    
    // Initialize database
    console.log(`Initializing ${config.database.type} database...`)
    const dbConfig = config.database.type === 'pglite' 
      ? { type: 'pglite' as const, pglitePath: config.database.pglitePath || './data/blobs.db' }
      : { type: 'postgres' as const, postgresUrl: config.database.postgresUrl || '' }
    
    const db = await createDatabase(dbConfig)
    
    // Run migrations
    console.log('Running database migrations...')
    await db.migrate()
    
    // Create repositories
    const monitorState = createMonitorStateRepository(db)
    const archivedBlobs = createArchivedBlobsRepository(db)
    
    // Test database connection
    const lastBlock = await monitorState.getLastProcessedBlock()
    console.log(`Last processed block: ${lastBlock}`)
    
    // TODO: Initialize components
    console.log('System initialization complete!')
    console.log('Ready to start monitoring and archiving blobs...')
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down gracefully...')
      await db.close()
      process.exit(0)
    })
    
    process.on('SIGTERM', async () => {
      console.log('\nShutting down gracefully...')
      await db.close()
      process.exit(0)
    })
    
  } catch (error) {
    console.error('Failed to start system:', error)
    process.exit(1)
  }
}

// Run the main function
main().catch(console.error) 