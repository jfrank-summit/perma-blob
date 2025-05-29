import Redis from 'ioredis';
import type { Config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import type { ProcessingJob } from '../blob-monitor/types.js'; // Job type from monitor
import { createBlobFetcher } from './fetcher.js';
import type { PublicClient } from 'viem';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const BLOB_FETCH_QUEUE_KEY = 'blob_fetch_jobs_queue';
const BLOB_ARCHIVE_QUEUE_KEY = 'blob_archive_jobs_queue'; // For results
const POLLING_INTERVAL_MS = 1000; // How often to check Redis if no job was found
const JOB_TIMEOUT_S = 60; // How long to wait for a job from BRPOP

export const createBlobFetcherWorker = async (config: Config) => {
  logger.info('[BlobFetcherWorker] Initializing...');

  const redisClient = new Redis(config.redis.url, {
    maxRetriesPerRequest: 3,
    // Add other Redis options if needed, e.g., password, db
  });

  redisClient.on('connect', () => logger.info('[BlobFetcherWorker] Connected to Redis.'));
  redisClient.on('error', (err) => logger.error('[BlobFetcherWorker] Redis connection error:', err));

  // Create a Viem public client for the fetcher
  // TODO: Consider if the viemClient should be passed in or created per worker config
  const viemClient: PublicClient = createPublicClient({
    chain: mainnet, // Make this configurable if necessary
    transport: http(config.ethereum.rpcUrl, {
      retryCount: 3,
      retryDelay: 1000,
    }),
  });

  const blobFetcher = createBlobFetcher(config, viemClient);
  let isShuttingDown = false;

  const processJob = async (jobString: string): Promise<void> => {
    try {
      const job: ProcessingJob = JSON.parse(jobString);
      logger.info(`[BlobFetcherWorker] Dequeued job for tx: ${job.txHash}`);

      const fetchResult = await blobFetcher.fetchBlobsForJob(job);

      if (fetchResult.ok) {
        const fetchedData = fetchResult.value;
        logger.info(`[BlobFetcherWorker] Successfully fetched ${fetchedData.fetchedBlobs.length} blobs for tx: ${job.txHash}. Enqueueing for archival.`);
        // Enqueue FetchedTransactionBlobs to the archive queue
        await redisClient.lpush(BLOB_ARCHIVE_QUEUE_KEY, JSON.stringify(fetchedData));
      } else {
        logger.error(`[BlobFetcherWorker] Failed to fetch blobs for tx: ${job.txHash}. Error: ${fetchResult.error.message}`, { job });
        // TODO: Implement dead-letter queue or other error handling for persistent fetch failures
        // For now, we just log the error and don't requeue automatically.
      }
    } catch (error: any) {
      logger.error('[BlobFetcherWorker] Error processing job string or during fetch operation:', { error: error.message, jobString, stack: error.stack });
      // Handle potential JSON parse errors or unexpected issues in fetchBlobsForJob not returning a Result
    }
  };

  const work = async () => {
    logger.info('[BlobFetcherWorker] Starting work loop...');
    while (!isShuttingDown) {
      try {
        // BRPOP blocks until a job is available or timeout
        const result = await redisClient.brpop(BLOB_FETCH_QUEUE_KEY, JOB_TIMEOUT_S);
        if (result) {
          const [_queueName, jobString] = result;
          await processJob(jobString);
        } else {
          // Timeout, no job found, loop will continue
          logger.debug('[BlobFetcherWorker] No job in queue, waiting...');
        }
      } catch (err: any) {
        logger.error('[BlobFetcherWorker] Error during Redis BRPOP or job processing:', err);
        // Avoid busy-looping on persistent Redis errors
        if (!isShuttingDown) {
          await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS * 5)); 
        }
      }
    }
    logger.info('[BlobFetcherWorker] Work loop stopped.');
  };

  const start = () => {
    isShuttingDown = false;
    work().catch(err => {
      logger.error('[BlobFetcherWorker] Unhandled error in work loop:', err);
      // Potentially restart or signal critical failure
    });
    logger.info('[BlobFetcherWorker] Worker started.');
  };

  const stop = async () => {
    logger.info('[BlobFetcherWorker] Stopping worker...');
    isShuttingDown = true;
    // Gracefully disconnect Redis client
    // IORedis `quit` is preferred for graceful shutdown.
    // It waits for pending replies before closing the connection.
    await redisClient.quit();
    logger.info('[BlobFetcherWorker] Redis client disconnected. Worker stopped.');
  };

  return {
    start,
    stop,
  };
}; 