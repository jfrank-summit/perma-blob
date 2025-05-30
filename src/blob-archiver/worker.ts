import Redis from 'ioredis';
import type { Config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import type { FetchedTransactionBlobs } from '../blob-fetcher/types.js';
import { createBlobArchiver } from './archiver.js';
import type { ArchivalResult } from './types.js';
import { bigIntReviver } from '../shared/json-utils.js';

// We might need a separate queue for results/failures of archival, or log them, or send to a dead-letter queue.
// For now, we'll log and can decide on a specific output queue later if needed.
// const ARCHIVAL_SUCCESS_QUEUE_KEY = 'blob_archival_success_queue';
// const ARCHIVAL_FAILURE_QUEUE_KEY = 'blob_archival_failure_queue';

const BLOB_ARCHIVE_JOBS_QUEUE_KEY = 'blob_archive_jobs_queue'; // Input queue
const POLLING_INTERVAL_MS = 1000; // How often to check Redis if no job was found
const JOB_TIMEOUT_S = 60; // How long to wait for a job from BRPOP

export const createBlobArchiverWorker = async (config: Config) => {
  logger.info('[BlobArchiverWorker] Initializing...');

  const redisClient = new Redis(config.redis.url, {
    maxRetriesPerRequest: 3,
  });

  redisClient.on('connect', () => logger.info('[BlobArchiverWorker] Connected to Redis.'));
  redisClient.on('error', (err) => logger.error('[BlobArchiverWorker] Redis connection error:', err));

  // The archiver itself doesn't need a Viem client, but it needs the appConfig for AutoDrive details.
  const blobArchiver = createBlobArchiver(config);
  let isShuttingDown = false;

  const processJob = async (jobString: string): Promise<void> => {
    let jobData: FetchedTransactionBlobs | null = null;
    try {
      jobData = JSON.parse(jobString, bigIntReviver) as FetchedTransactionBlobs;
      logger.info(`[BlobArchiverWorker] Dequeued archival job for tx: ${jobData.transactionHash}`);

      const resultDetails: ArchivalResult = await blobArchiver.archiveBlobData(jobData);

      // Now, check the .success field of ArchivalResult
      if (resultDetails.success) {
        logger.info(`[BlobArchiverWorker] Successfully processed archival for tx: ${resultDetails.transactionHash}. Message: ${resultDetails.message}`, {
          transactionHash: resultDetails.transactionHash,
          details: resultDetails.blobArchivalDetails,
        });
      } else {
        // This case means the archival process itself determined a failure (e.g., some blobs failed or setup failed)
        logger.error(`[BlobArchiverWorker] Archival process completed with failures for tx: ${resultDetails.transactionHash}. Message: ${resultDetails.message}`, {
          transactionHash: resultDetails.transactionHash,
          details: resultDetails.blobArchivalDetails,
          overallError: resultDetails.error, // The error field within ArchivalResult
        });
      }
    } catch (error: any) {
      // This catches errors from JSON.parse or if archiveBlobData throws an unexpected exception
      const txHash = jobData?.transactionHash || 'unknown_tx_hash_due_to_parse_failure';
      logger.error(`[BlobArchiverWorker] Critical error processing job for tx: ${txHash}. Error: ${error.message}`, { 
        transactionHash: txHash,
        errorName: error.name,
        errorMessage: error.message, 
        errorStack: error.stack,
        jobString, // Log the raw job string in case of parse failure
      });
    }
  };

  const work = async () => {
    logger.info('[BlobArchiverWorker] Starting work loop...');
    while (!isShuttingDown) {
      try {
        const result = await redisClient.brpop(BLOB_ARCHIVE_JOBS_QUEUE_KEY, JOB_TIMEOUT_S);
        if (result) {
          const [_queueName, jobString] = result;
          await processJob(jobString);
        } else {
          logger.debug('[BlobArchiverWorker] No job in archive queue, waiting...');
        }
      } catch (err: any) {
        // Log errors from BRPOP itself, not from processJob (which has its own try-catch)
        logger.error('[BlobArchiverWorker] Error during Redis BRPOP operation:', err);
        if (!isShuttingDown) {
          // Avoid busy-looping on persistent Redis errors
          await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS * 5)); 
        }
      }
    }
    logger.info('[BlobArchiverWorker] Work loop stopped.');
  };

  const start = () => {
    isShuttingDown = false;
    work().catch(err => {
      logger.error('[BlobArchiverWorker] Unhandled error in work loop (should not happen if processJob catches its errors):', err);
    });
    logger.info('[BlobArchiverWorker] Worker started.');
  };

  const stop = async () => {
    logger.info('[BlobArchiverWorker] Stopping worker...');
    isShuttingDown = true;
    await redisClient.quit();
    logger.info('[BlobArchiverWorker] Redis client disconnected. Worker stopped.');
  };

  return {
    start,
    stop,
  };
}; 