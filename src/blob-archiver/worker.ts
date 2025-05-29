import Redis from 'ioredis';
import type { Config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { createBlobArchiver } from './archiver.js';
import type { ArchivalJobData, ArchivalResult } from './types.js';
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
    try {
      const jobData: ArchivalJobData = JSON.parse(jobString);
      logger.info(`[BlobArchiverWorker] Dequeued archival job for tx: ${jobData.transactionHash}`);

      const archivalResult: ArchivalResult = await blobArchiver.archiveBlobData(jobData);

      if (archivalResult.success) {
        logger.info(`[BlobArchiverWorker] Successfully processed archival for tx: ${jobData.transactionHash}. Message: ${archivalResult.message}`, {
          transactionHash: jobData.transactionHash,
          results: archivalResult.blobArchivalDetails,
        });
        // Optionally, push to a success queue or database log
      } else {
        logger.error(`[BlobArchiverWorker] Failed to archive blobs for tx: ${jobData.transactionHash}. Error: ${archivalResult.error || archivalResult.message}`, {
          transactionHash: jobData.transactionHash,
          details: archivalResult.blobArchivalDetails,
          overallError: archivalResult.error,
        });
        // TODO: Implement dead-letter queue or other error handling for persistent archival failures
      }
    } catch (error: any) {
      logger.error('[BlobArchiverWorker] Error processing job string or during archival operation:', { 
        error: error.message, 
        jobString, 
        stack: error.stack 
      });
      // Handle potential JSON parse errors or unexpected issues in archiveBlobData
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
        logger.error('[BlobArchiverWorker] Error during Redis BRPOP or job processing:', err);
        if (!isShuttingDown) {
          await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS * 5)); 
        }
      }
    }
    logger.info('[BlobArchiverWorker] Work loop stopped.');
  };

  const start = () => {
    isShuttingDown = false;
    work().catch(err => {
      logger.error('[BlobArchiverWorker] Unhandled error in work loop:', err);
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