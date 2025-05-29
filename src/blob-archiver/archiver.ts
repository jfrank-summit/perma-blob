import { createAutoDriveApi } from '@autonomys/auto-drive';
import { NetworkId } from '@autonomys/auto-utils';
import type { Config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import type { ArchivalJobData, ArchivalResult, BlobArchiverConfig, BlobContainer } from './types.js';
import { Ok, Err, type Result } from '../shared/result.js';
import crypto from 'node:crypto'; // For SHA256

const defaultArchiverConfig: Required<BlobArchiverConfig> = {
  autoDriveContainerName: 'eth-l2-blobs',
  autoDriveCreateContainerIfNotExists: true,
};

// Type for the AutoDrive API client instance
// This would ideally be a more specific type from the SDK if available, e.g., AutoDriveInstance
type AutoDriveApiClient = ReturnType<typeof createAutoDriveApi>;
let autoDriveApiClientInstance: AutoDriveApiClient | null = null;

const ensureAutoDriveClient = async (appConfig: Config): Promise<Result<AutoDriveApiClient, Error>> => {
  if (autoDriveApiClientInstance) return Ok(autoDriveApiClientInstance);
  
  try {
    const network = appConfig.autoDrive.network?.toUpperCase() === 'TAURUS' 
      ? NetworkId.TAURUS 
      : NetworkId.MAINNET;

    autoDriveApiClientInstance = createAutoDriveApi({
      apiKey: appConfig.autoDrive.apiKey,
      network: network,
      // Add other AutoDrive options if needed from appConfig.autoDrive
    });
    logger.info('[BlobArchiver] AutoDrive API client initialized.');
    return Ok(autoDriveApiClientInstance);
  } catch (error: any) {
    logger.error('[BlobArchiver] Failed to initialize AutoDrive API client:', error);
    return Err(new Error(`AutoDrive API client initialization failed: ${error.message}`));
  }
};

// Updated: This function now primarily confirms the container name to be used as a path prefix.
const ensureContainerAsPathPrefix = async (
  _drive: AutoDriveApiClient, // Drive client not strictly needed if no SDK calls are made here
  containerName: string,
  _createIfNeeded: boolean // Less relevant for path prefixes
): Promise<Result<string, Error>> => {
  if (!containerName || containerName.trim() === '') {
    const errMsg = 'AutoDrive container name (used as path prefix) cannot be empty.';
    logger.error(`[BlobArchiver] ${errMsg}`);
    return Err(new Error(errMsg));
  }
  logger.info(`[BlobArchiver] Using '${containerName}' as the path prefix (conceptual container) for uploads.`);
  return Ok(containerName);
};

const calculateSha256 = (buffer: Buffer): string => {
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

export const createBlobArchiver = (appConfig: Config) => {
  const archiverConfig: Required<BlobArchiverConfig> = {
    autoDriveContainerName: appConfig.blobArchiver?.autoDriveContainerName ?? defaultArchiverConfig.autoDriveContainerName,
    autoDriveCreateContainerIfNotExists: appConfig.blobArchiver?.autoDriveCreateContainerIfNotExists ?? defaultArchiverConfig.autoDriveCreateContainerIfNotExists,
  };

  const archiveBlobData = async (jobData: ArchivalJobData): Promise<ArchivalResult> => {
    logger.info(`[BlobArchiver] Starting archival for tx: ${jobData.transactionHash} from L2 source: ${jobData.l2Source}`);

    const driveClientResult = await ensureAutoDriveClient(appConfig);
    if (!driveClientResult.ok) {
      return {
        transactionHash: jobData.transactionHash,
        success: false,
        message: `Failed to initialize AutoDrive API client: ${driveClientResult.error.message}`,
        error: driveClientResult.error.message,
      };
    }
    const drive = driveClientResult.value;

    const containerPathPrefixResult = await ensureContainerAsPathPrefix(
      drive, 
      archiverConfig.autoDriveContainerName, 
      archiverConfig.autoDriveCreateContainerIfNotExists
    );
    
    if (!containerPathPrefixResult.ok) {
      return {
        transactionHash: jobData.transactionHash,
        success: false,
        message: `Invalid AutoDrive container/path prefix configuration: ${containerPathPrefixResult.error.message}`,
        error: containerPathPrefixResult.error.message,
      };
    }
    const containerPathPrefix = containerPathPrefixResult.value; 

    if (!jobData.fetchedBlobs || jobData.fetchedBlobs.length === 0) {
      logger.warn(`[BlobArchiver] No blobs to archive for tx: ${jobData.transactionHash}`);
      return {
        transactionHash: jobData.transactionHash,
        success: true, 
        message: 'No blobs were fetched for this transaction; nothing to archive.',
        blobArchivalDetails: [],
      };
    }

    const blobArchivalDetails: NonNullable<ArchivalResult['blobArchivalDetails']> = [];
    let overallSuccess = true;

    for (const fetchedBlob of jobData.fetchedBlobs) {
      const blobIndex = jobData.expectedBlobVersionedHashes.indexOf(fetchedBlob.versionedHash);
      if (blobIndex === -1) {
        logger.warn(`[BlobArchiver] Fetched blob ${fetchedBlob.versionedHash} not found in expected list for tx ${jobData.transactionHash}. Skipping.`);
        continue;
      }

      let currentBlobCid: string | undefined = undefined; // Renamed to avoid confusion, scoped to this iteration
      try {
        const rawBlobHex = fetchedBlob.blob.startsWith('0x') ? fetchedBlob.blob.substring(2) : fetchedBlob.blob;
        const blobBuffer = Buffer.from(rawBlobHex, 'hex');
        const blobBase64 = blobBuffer.toString('base64');
        const blobSha256 = calculateSha256(blobBuffer);

        const blobContainer: BlobContainer = {
          version: "1.0",
          type: "ethereum-l2-blob",
          metadata: {
            blobHash: fetchedBlob.versionedHash,
            l2Source: jobData.l2Source,
            l1BlockNumber: Number(jobData.blockNumber),
            l1BlockHash: jobData.blockHash,
            blobIndex: blobIndex,
            timestamp: Number(jobData.timestamp),
            sizeBytes: blobBuffer.length,
            txHash: jobData.transactionHash,
          },
          blob: blobBase64,
          checksums: {
            kzgCommitment: fetchedBlob.kzgCommitment,
            sha256: blobSha256,
          },
        };
        
        const autoDriveFileName = `${containerPathPrefix}/${blobContainer.metadata.txHash}-${blobContainer.metadata.blobHash}.json`;
        
        logger.info(`[BlobArchiver] Attempting to upload BlobContainer for ${fetchedBlob.versionedHash} as ${autoDriveFileName}`);

        currentBlobCid = await drive.uploadObjectAsJSON(blobContainer, autoDriveFileName, {
           compression: true,
        });

        if (!currentBlobCid || typeof currentBlobCid !== 'string') {
          throw new Error('AutoDrive upload did not return a valid CID string.');
        }

        logger.info(`[BlobArchiver] Successfully uploaded BlobContainer for ${fetchedBlob.versionedHash}. CID: ${currentBlobCid}`);
        
        blobArchivalDetails.push({
          versionedHash: fetchedBlob.versionedHash,
          blobCid: currentBlobCid,
          success: true,
        });

      } catch (error: any) {
        overallSuccess = false;
        const errorMessage = `Failed to archive blob ${fetchedBlob.versionedHash} for tx ${jobData.transactionHash}: ${error.message}`;
        logger.error(`[BlobArchiver] ${errorMessage}`, { error, stack: error.stack, blobCid: currentBlobCid });
        
        const errorDetail: any = {
          versionedHash: fetchedBlob.versionedHash,
          success: false,
          error: errorMessage,
        };
        if (currentBlobCid) { // Only add blobCid to the error detail if it was obtained before the error
          errorDetail.blobCid = currentBlobCid;
        }
        blobArchivalDetails.push(errorDetail);
      }
    }

    return {
      transactionHash: jobData.transactionHash,
      success: overallSuccess,
      message: overallSuccess ? 'All blobs processed for archival.' : 'Some blobs failed to archive.',
      blobArchivalDetails,
    };
  };

  return {
    archiveBlobData,
  };
}; 