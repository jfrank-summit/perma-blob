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

// Placeholder for ensuring a container exists
const ensureContainerExists = async (
  drive: AutoDriveApiClient, // Corrected type
  containerName: string,
  createIfNeeded: boolean
): Promise<Result<string, Error>> => {
  try {
    logger.info(`[BlobArchiver:TODO] Checking/creating container '${containerName}'. Currently a placeholder.`);
    // Example usage from docs (conceptual)
    // const containers = await drive.getContainers(); // Fictional method, check SDK for actual
    // let container = containers.find(c => c.name === containerName);
    // if (!container && createIfNeeded) {
    //   logger.info(`[BlobArchiver] Container '${containerName}' not found, creating...`);
    //   container = await drive.createContainer(containerName, { makePublic: true }); // Check SDK for actual method and options
    //   logger.info(`[BlobArchiver] Container '${containerName}' created with ID: ${container.id}`);
    // }
    // if (!container) {
    //   return Err(new Error(`Container '${containerName}' not found and creation was not requested or failed.`));
    // }
    // return Ok(container.id); // Assuming container object has an id property
    if (createIfNeeded) {
      logger.info(`[BlobArchiver:TODO] Placeholder: Would attempt to create container '${containerName}' if it doesn't exist.`);
    }
    // For now, we'll just return the name as a placeholder for ID, assuming it will be used directly if needed by upload functions.
    // Or, if upload functions require an ID, this logic needs to be more robust.
    return Ok(containerName); 
  } catch (error: any) {
    logger.error(`[BlobArchiver] Error ensuring container '${containerName}' exists:`, error);
    return Err(new Error(`Failed to ensure container '${containerName}': ${error.message}`));
  }
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

    const containerName = archiverConfig.autoDriveContainerName;
    const containerResult = await ensureContainerExists(drive, containerName, archiverConfig.autoDriveCreateContainerIfNotExists);
    
    if (!containerResult.ok) {
      return {
        transactionHash: jobData.transactionHash,
        success: false,
        message: `Failed to ensure AutoDrive container '${containerName}': ${containerResult.error.message}`,
        error: containerResult.error.message,
      };
    }
    const actualContainerIdentifier = containerResult.value; // This is currently containerName, might be an ID in future
    logger.info(`[BlobArchiver] Using AutoDrive container identifier: '${actualContainerIdentifier}' for tx: ${jobData.transactionHash}`);

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
        // This case should ideally not happen if fetcher is correct
        continue;
      }

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
            l1BlockNumber: Number(jobData.blockNumber), // Convert BigInt to Number
            l1BlockHash: jobData.blockHash,
            blobIndex: blobIndex,
            timestamp: Number(jobData.timestamp), // Convert BigInt to Number
            sizeBytes: blobBuffer.length,
            txHash: jobData.transactionHash,
          },
          blob: blobBase64,
          checksums: {
            kzgCommitment: fetchedBlob.kzgCommitment,
            sha256: blobSha256,
          },
        };

        const blobContainerJsonString = JSON.stringify(blobContainer);
        // const blobContainerBuffer = Buffer.from(blobContainerJsonString);
        // const blobContainerSha256 = calculateSha256(blobContainerBuffer);
        
        // Placeholder for actual blob upload logic
        // The filename for AutoDrive could be the blobHash or kzgCommitment to ensure uniqueness if desired.
        const autoDriveFileName = `${blobContainer.metadata.txHash}-${blobContainer.metadata.blobHash}.json`;
        logger.info(`[BlobArchiver:TODO] Archiving BlobContainer for ${fetchedBlob.versionedHash} (tx: ${jobData.transactionHash}) as ${autoDriveFileName} to container '${actualContainerIdentifier}'.`);
        
        // const uploadResult = await drive.uploadObjectAsJSON(blobContainer, autoDriveFileName, {
        //    container: actualContainerIdentifier, // Check SDK: how to specify container for uploadObjectAsJSON
        //    compression: true, // Optional
        // });
        // const blobCid = uploadResult.cid; // Assuming result has a CID
        const blobCid = `fake-cid-${fetchedBlob.versionedHash}-${Date.now()}`;

        logger.info(`[BlobArchiver:TODO] Placeholder: BlobContainer for ${fetchedBlob.versionedHash} stored. CID: ${blobCid}`);
        
        blobArchivalDetails.push({
          versionedHash: fetchedBlob.versionedHash,
          blobCid: blobCid,
          // blobContainerSha256: blobContainerSha256, // If we want to store this for extra verification
          success: true,
        });
      } catch (error: any) {
        overallSuccess = false;
        const errorMessage = `Failed to prepare or archive blob ${fetchedBlob.versionedHash} for tx ${jobData.transactionHash}: ${error.message}`;
        logger.error(`[BlobArchiver] ${errorMessage}`, { error, stack: error.stack });
        blobArchivalDetails.push({
          versionedHash: fetchedBlob.versionedHash,
          success: false,
          error: errorMessage,
        });
      }
    }

    return {
      transactionHash: jobData.transactionHash,
      success: overallSuccess,
      message: overallSuccess ? 'All fetched blobs processed for archival.' : 'Some blobs failed to archive.',
      blobArchivalDetails,
    };
  };

  return {
    archiveBlobData,
  };
}; 