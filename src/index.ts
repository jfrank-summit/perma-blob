import { createDatabase } from './database/create-database.js'
import { createMonitorStateRepository } from './database/repositories/monitor-state.js'
// import { createArchivedBlobsRepository } from './database/repositories/archived-blobs.js'
import { loadConfig } from './shared/config.js'
import { logger } from './shared/logger.js'
import { createMonitorState, startMonitor } from './blob-monitor/index.js'
import type { ProcessingJob, MonitorConfig } from './blob-monitor/index.js'
import { createBlobFetcherWorker } from './blob-fetcher/index.js'
import { createBlobArchiverWorker } from './blob-archiver/index.js'
import Redis from 'ioredis'

const BLOB_FETCH_QUEUE_KEY = 'blob_fetch_jobs_queue'

const main = async () => {
  logger.info('Starting Ethereum L2 Blob Archival System...')
  
  let fetcherWorker: Awaited<ReturnType<typeof createBlobFetcherWorker>> | null = null
  let archiverWorker: Awaited<ReturnType<typeof createBlobArchiverWorker>> | null = null
  let redisClient: Redis | null = null

  try {
    // Load configuration
    const config = loadConfig()
    logger.info('Configuration loaded successfully')
    
    // Initialize Redis client for publishing jobs
    redisClient = new Redis(config.redis.url, { maxRetriesPerRequest: 3 })
    redisClient.on('connect', () => logger.info('[Main] Connected to Redis for publishing jobs.'))
    redisClient.on('error', (err) => logger.error('[Main] Redis client error (for publishing):', err))
    
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
    logger.info(`Last processed block from DB: ${lastBlock}`)
    
    // Initialize and start Blob Fetcher Worker
    fetcherWorker = await createBlobFetcherWorker(config)
    fetcherWorker.start()
    
    // Initialize and start Blob Archiver Worker
    archiverWorker = await createBlobArchiverWorker(config)
    archiverWorker.start()
    
    // Initialize monitor
    const monitorConfig: MonitorConfig = {
      rpcUrl: config.ethereum.rpcUrl,
      baseContracts: config.ethereum.baseContracts.map(addr => addr as `0x${string}`),
      confirmations: config.ethereum.confirmations,
      batchSize: config.ethereum.batchSize,
      l2Source: 'base',
      ...(config.ethereum.startBlock !== undefined && { startBlock: config.ethereum.startBlock })
    }
    
    const initialMonitorState = await createMonitorState(monitorConfig, db)
    
    // Define blob processing handler
    const handleBlobFound = async (job: ProcessingJob) => {
      logger.info(`[Main] New blob transaction found: ${job.txHash}`, {
        blockNumber: job.blockNumber.toString(),
        blobCount: job.blobVersionedHashes.length
      })
      
      // Enqueue job for blob fetching
      if (redisClient) {
        try {
          await redisClient.lpush(BLOB_FETCH_QUEUE_KEY, JSON.stringify(job))
          logger.info(`[Main] Enqueued job for tx: ${job.txHash} to ${BLOB_FETCH_QUEUE_KEY}`)
        } catch (err) {
          logger.error('[Main] Failed to enqueue job to Redis:', { error: err, txHash: job.txHash })
          // TODO: Add retry or dead-letter logic for enqueue failures
        }
      } else {
        logger.error('[Main] Redis client not initialized. Cannot enqueue job.', { txHash: job.txHash })
      }
    }
    
    // Start monitoring
    const stopMonitor = await startMonitor(
      monitorConfig,
      initialMonitorState,
      db,
      handleBlobFound
    )
    
    logger.info('System initialization complete! Monitoring for blobs...')
    
    // Handle shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...')
      stopMonitor()
      if (fetcherWorker) {
        await fetcherWorker.stop()
      }
      if (archiverWorker) {
        await archiverWorker.stop()
      }
      if (redisClient) {
        await redisClient.quit()
        logger.info('[Main] Redis client (for publishing) disconnected.')
      }
      await db.close()
      logger.info('All components stopped. Exiting.')
      process.exit(0)
    }
    
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    
  } catch (error) {
    logger.error('Failed to start system:', error)
    if (fetcherWorker) await fetcherWorker.stop().catch(e => logger.error('Error stopping fetcher worker during main catch:', e))
    if (archiverWorker) await archiverWorker.stop().catch(e => logger.error('Error stopping archiver worker during main catch:', e))
    if (redisClient) await redisClient.quit().catch(e => logger.error('Error stopping main Redis client during main catch:', e))
    process.exit(1)
  }
}

// Run the main function
main().catch((error) => {
  logger.error('Unhandled error at main execution level:', error)
  process.exit(1)
}) 