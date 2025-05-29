import { createDatabase } from './database/create-database.js'
import { createMonitorStateRepository } from './database/repositories/monitor-state.js'
// import { createArchivedBlobsRepository } from './database/repositories/archived-blobs.js'
import { loadConfig } from './shared/config.js'
import { logger } from './shared/logger.js'
import { createMonitorState, startMonitor } from './blob-monitor/index.js'
import type { ProcessingJob, MonitorConfig } from './blob-monitor/index.js'

const main = async () => {
  logger.info('Starting Ethereum L2 Blob Archival System...')
  
  try {
    // Load configuration
    const config = loadConfig()
    logger.info('Configuration loaded successfully')
    
    // Initialize database
    logger.info(`Initializing ${config.database.type} database...`)
    const dbConfig = config.database.type === 'pglite' 
      ? { type: 'pglite' as const, pglitePath: config.database.pglitePath || './data/blobs.db' }
      : { type: 'postgres' as const, postgresUrl: config.database.postgresUrl || '' }
    
    const db = await createDatabase(dbConfig)
    
    // Run migrations
    logger.info('Running database migrations...')
    await db.migrate()
    
    // Create repositories
    const monitorState = createMonitorStateRepository(db)
    // TODO: Use archivedBlobs repository when implementing archival
    // const archivedBlobs = createArchivedBlobsRepository(db)
    
    // Test database connection
    const lastBlock = await monitorState.getLastProcessedBlock()
    logger.info(`Last processed block: ${lastBlock}`)
    
    // Initialize monitor
    const monitorConfig: MonitorConfig = {
      rpcUrl: config.ethereum.rpcUrl,
      baseContracts: config.ethereum.baseContracts,
      confirmations: config.ethereum.confirmations,
      batchSize: config.ethereum.batchSize,
      ...(config.ethereum.startBlock !== undefined && { startBlock: config.ethereum.startBlock })
    }
    
    const monitor = await createMonitorState(monitorConfig, db)
    
    // Define blob processing handler
    const handleBlobFound = async (job: ProcessingJob) => {
      logger.info(`New blob transaction found: ${job.txHash}`, {
        blockNumber: job.blockNumber.toString(),
        blobCount: job.blobVersionedHashes.length
      })
      
      // TODO: Queue job for blob fetching and archival
      // For now, just log it
    }
    
    // Start monitoring
    const stopMonitor = await startMonitor(
      monitorConfig,
      monitor,
      db,
      handleBlobFound
    )
    
    logger.info('System initialization complete!')
    logger.info('Monitoring for Base L2 blob transactions...')
    
    // Handle shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...')
      stopMonitor()
      await db.close()
      process.exit(0)
    }
    
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    
  } catch (error) {
    logger.error('Failed to start system:', error)
    process.exit(1)
  }
}

// Run the main function
main().catch((error) => {
  logger.error('Unhandled error:', error)
  process.exit(1)
}) 