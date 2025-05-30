import type { PublicClient, Hex } from 'viem';
import { commitmentToVersionedHash } from 'viem';
import type { ProcessingJob } from '../blob-monitor/types.js';
import type { FetchedTransactionBlobs, FetchedBlob, BlobFetcherConfig, RpcBlobSidecar } from './types.js';
import type { Config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { type Result, Ok, Err } from '../shared/result.js';
import fetch from 'node-fetch'; // Import node-fetch
import { bigIntReplacer } from '../shared/json-utils.js'; // Import the replacer

const defaultFetcherConfigValues: BlobFetcherConfig = {
  retryCount: 3,
  retryDelayMs: 2000,
};

// Helper function for sleep
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// Define the expected structure from the Beacon API /eth/v1/beacon/blob_sidecars/{block_id}
type BeaconApiBlobSidecar = {
  index: string; // Index of the sidecar
  blob: Hex;     // The blob of data associated with the sidecar
  kzg_commitment: Hex; // The KZG commitment for the data
  kzg_proof: Hex;      // The KZG proof for the data
  // The API might return more fields, but these are the core ones matching RpcBlobSidecar
};

type BeaconApiGetBlobSidecarsResponse = {
  version: string;
  execution_optimistic: boolean;
  finalized: boolean;
  data: BeaconApiBlobSidecar[];
};

export const createBlobFetcher = (
  appConfig: Config, // Global app config
  viemClient: PublicClient
) => {
  const fetcherConfig: BlobFetcherConfig = {
    retryCount: appConfig.blobFetcher?.retryCount ?? defaultFetcherConfigValues.retryCount,
    retryDelayMs: appConfig.blobFetcher?.retryDelayMs ?? defaultFetcherConfigValues.retryDelayMs,
  };

  const fetchBlobsForJob = async (
    job: ProcessingJob
  ): Promise<Result<FetchedTransactionBlobs, Error>> => {
    logger.info(`[BlobFetcher] Fetching blobs for tx: ${job.txHash} in block: ${job.blockHash} (num: ${job.blockNumber}) using REST Beacon API`);

    let attempt = 0;
    let beaconApiResponse: BeaconApiGetBlobSidecarsResponse | null = null;
    let lastError: Error | null = null;

    // Fetch the block to get its exact slot (post-merge blocks have a slot in the extraData or we can calculate from timestamp)
    let slotNumber: bigint;
    let blockRootHashFromHeader: string | undefined;
    try {
      const block = await viemClient.getBlock({ blockNumber: job.blockNumber });
      // Calculate slot from timestamp
      // Mainnet merge timestamp: 1663224179 (Thu Sep 15 2022 06:42:59 GMT+0000)
      // Mainnet merge slot: 4700013
      const MERGE_TIMESTAMP = 1663224179n;
      const MERGE_SLOT = 4700013n;
      const SECONDS_PER_SLOT = 12n;
      
      if (block.timestamp < MERGE_TIMESTAMP) {
        throw new Error(`Block ${job.blockNumber} is pre-merge and doesn't have blob data`);
      }
      
      slotNumber = MERGE_SLOT + (block.timestamp - MERGE_TIMESTAMP) / SECONDS_PER_SLOT;
      logger.debug(`[BlobFetcher] Calculated slot ${slotNumber} for block ${job.blockNumber} (timestamp: ${block.timestamp})`);
    } catch (e: any) {
      const errorMessage = `[BlobFetcher] Failed to calculate slot for block ${job.blockNumber}: ${e.message}`;
      logger.error(errorMessage);
      return Err(new Error(errorMessage));
    }

    const blockHashHex = job.blockHash.startsWith('0x') ? job.blockHash as Hex : `0x${job.blockHash}` as Hex;
    
    // Use dedicated Beacon API URL if available, otherwise append to Execution RPC URL
    const baseBeaconUrl = appConfig.ethereum.beaconApiUrl || appConfig.ethereum.rpcUrl;
    
    // Ensure the Beacon API URL ends with a slash if it doesn't already, to correctly append the path
    const MUNGED_API_URL = baseBeaconUrl.endsWith('/') ? baseBeaconUrl : `${baseBeaconUrl}/`;
    // Use slot number instead of block hash
    const beaconApiUrl = `${MUNGED_API_URL}eth/v1/beacon/blob_sidecars/${slotNumber}`;

    while (attempt < fetcherConfig.retryCount && beaconApiResponse === null) {
      attempt++;
      try {
        logger.debug(`[BlobFetcher] Attempt ${attempt}: Calling Beacon API for blob sidecars. Slot: ${slotNumber}, Block num: ${job.blockNumber}, URL: ${beaconApiUrl}`);
        
        const response = await fetch(beaconApiUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            // Add any other necessary headers, e.g., API keys if the URL doesn't embed them
            // For QuickNode, the API key is usually part of the URL path.
          }
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Beacon API request failed with status ${response.status}: ${errorBody}`);
        }

        const responseData = await response.json() as any; // Cast to any first for validation

        // Validate the structure of the response data
        if (responseData && Array.isArray(responseData.data) && 
            typeof responseData.version === 'string') {
          beaconApiResponse = responseData as BeaconApiGetBlobSidecarsResponse;
        } else {
          throw new Error('Beacon API response does not match expected structure BeaconApiGetBlobSidecarsResponse');
        }

      } catch (e: any) {
        lastError = new Error(`[BlobFetcher] Attempt ${attempt} failed for Beacon API for slot ${slotNumber} (block num: ${job.blockNumber}): ${e.message}`);
        logger.warn(lastError.message, JSON.parse(JSON.stringify({ stack: e.stack, originalError: e, blockNumber: job.blockNumber, slot: slotNumber.toString() }, bigIntReplacer)));
        if (attempt < fetcherConfig.retryCount) {
          await sleep(fetcherConfig.retryDelayMs);
        } else {
           // Ensure loop terminates if all retries failed
          beaconApiResponse = { data: [], version: '', execution_optimistic: false, finalized: false }; // or null to indicate complete failure
        }
      }
    }

    if (beaconApiResponse === null || (beaconApiResponse.data.length === 0 && job.blobVersionedHashes.length > 0 && lastError !== null)) {
       const errorMessage = `[BlobFetcher] Failed to fetch blob sidecars for slot ${slotNumber} (block num: ${job.blockNumber}) via Beacon API after ${fetcherConfig.retryCount} attempts. Last error: ${lastError?.message || 'Node returned empty or no sidecars, or an unexpected error occurred'}`;
      logger.error(errorMessage, JSON.parse(JSON.stringify({ lastError, blockNumber: job.blockNumber, slot: slotNumber.toString() }, bigIntReplacer)));
      return Err(new Error(errorMessage));
    }
    
    const actualSidecarsData = beaconApiResponse?.data || [];

    if (actualSidecarsData.length === 0 && job.blobVersionedHashes.length > 0) {
      logger.warn(`[BlobFetcher] No blob sidecars found in slot ${slotNumber} (block num: ${job.blockNumber}) via Beacon API, but job ${job.txHash} expected ${job.blobVersionedHashes.length} blobs.`);
    } else if (actualSidecarsData.length > 0) {
      logger.info(`[BlobFetcher] Received ${actualSidecarsData.length} sidecars for slot ${slotNumber} (block num: ${job.blockNumber}) via Beacon API. Filtering for tx ${job.txHash}.`);
    }
    
    // Map BeaconApiBlobSidecar to RpcBlobSidecar (which is used by FetchedBlob)
    // The structure is quite similar.
    const mappedSidecars: RpcBlobSidecar[] = actualSidecarsData.map(apiSidecar => ({
        blob: apiSidecar.blob.startsWith('0x') ? apiSidecar.blob : `0x${apiSidecar.blob}` as Hex,
        kzgCommitment: apiSidecar.kzg_commitment.startsWith('0x') ? apiSidecar.kzg_commitment : `0x${apiSidecar.kzg_commitment}` as Hex,
        kzgProof: apiSidecar.kzg_proof.startsWith('0x') ? apiSidecar.kzg_proof : `0x${apiSidecar.kzg_proof}` as Hex,
        // index: apiSidecar.index, // If RpcBlobSidecar type is updated to include index
    }));


    const fetchedBlobsForTx: FetchedBlob[] = [];
    const foundVersionedHashes = new Set<string>();
    const errorsEncountered: string[] = [];

    for (const sidecar of mappedSidecars) { // Use mappedSidecars
      try {
        const kzgCommitmentHex: Hex = sidecar.kzgCommitment; // Already Hex
        
        const derivedVersionedHash = commitmentToVersionedHash({
          commitment: kzgCommitmentHex,
          to: 'hex'
        });
        
        if (job.blobVersionedHashes.includes(derivedVersionedHash)) {
          fetchedBlobsForTx.push({
            versionedHash: derivedVersionedHash,
            blob: sidecar.blob, // Already Hex
            kzgProof: sidecar.kzgProof, // Already Hex
            kzgCommitment: kzgCommitmentHex,
          });
          foundVersionedHashes.add(derivedVersionedHash);
        }
      } catch (hashError: any) {
        const hashErrorMessage = `[BlobFetcher] Error processing sidecar in slot ${slotNumber} (block num: ${job.blockNumber}) (commitment: ${sidecar.kzgCommitment}): ${hashError.message}`;
        logger.warn(hashErrorMessage, JSON.parse(JSON.stringify({ stack: hashError.stack, blockNumber: job.blockNumber, slot: slotNumber.toString() }, bigIntReplacer)));
        errorsEncountered.push(hashErrorMessage);
      }
    }

    const allExpectedBlobsFound = job.blobVersionedHashes.length === 0 || job.blobVersionedHashes.every(hash => foundVersionedHashes.has(hash));

    if (!allExpectedBlobsFound && job.blobVersionedHashes.length > 0) {
      const missingHashes = job.blobVersionedHashes.filter(hash => !foundVersionedHashes.has(hash));
      const warningMessage = `[BlobFetcher] Not all expected blobs found for tx ${job.txHash} (block: ${job.blockNumber}). Expected ${job.blobVersionedHashes.length}, found ${foundVersionedHashes.size}. Missing: ${missingHashes.join(', ')}`;
      logger.warn(warningMessage);
      errorsEncountered.push(warningMessage);
    }

    const resultData: FetchedTransactionBlobs = {
      transactionHash: job.txHash,
      blockNumber: job.blockNumber,
      blockHash: job.blockHash,
      timestamp: job.timestamp,
      from: job.from,
      l2Source: job.l2Source,
      expectedBlobVersionedHashes: job.blobVersionedHashes,
      fetchedBlobs: fetchedBlobsForTx,
      allBlobsFound: allExpectedBlobsFound,
      ...(errorsEncountered.length > 0 && { errors: errorsEncountered }),
    };
    
    if (allExpectedBlobsFound || fetchedBlobsForTx.length > 0 || job.blobVersionedHashes.length === 0) {
      logger.info(`[BlobFetcher] Processed blobs for tx: ${job.txHash} (block: ${job.blockNumber}). Found ${fetchedBlobsForTx.length}/${job.blobVersionedHashes.length} expected blobs.`);
    } else {
      logger.warn(`[BlobFetcher] No relevant blobs found for tx: ${job.txHash} (block: ${job.blockNumber}) despite expecting ${job.blobVersionedHashes.length}. Result indicates allBlobsFound: ${allExpectedBlobsFound}.`);
    }
    
    return Ok(resultData);
  };

  return {
    fetchBlobsForJob,
  };
}; 