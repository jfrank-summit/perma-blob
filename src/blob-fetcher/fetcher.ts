import type { PublicClient, Hex } from 'viem';
import { commitmentToVersionedHash } from 'viem';
import type { ProcessingJob } from '../blob-monitor/types.js';
import type { FetchedTransactionBlobs, FetchedBlob, BlobFetcherConfig, RpcBlobSidecar } from './types.js';
import type { Config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { type Result, Ok, Err } from '../shared/result.js';

const defaultFetcherConfigValues: BlobFetcherConfig = {
  retryCount: 3,
  retryDelayMs: 2000,
};

// Helper function for sleep
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// Define the expected RPC response structure for eth_getBlobSidecars
// Based on EIP-4844, it should return an array of sidecar objects.
// Each sidecar object includes blob, kzgCommitment, kzgProof.
// We need to ensure our RpcBlobSidecar type matches what the RPC actually returns.
// Viem's `BlobSidecar` type might be useful here if it exists and matches.
// For now, RpcBlobSidecar is defined in ./types.ts
type EthGetBlobSidecarsRpcResponse = RpcBlobSidecar[];

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
    logger.info(`[BlobFetcher] Fetching blobs for tx: ${job.txHash} in block: ${job.blockHash}`);

    let attempt = 0;
    let blockSidecarsResponse: EthGetBlobSidecarsRpcResponse | null = null;
    let lastError: Error | null = null;

    // Ensure blockHash is in Hex format for the RPC call
    const blockHashHex = job.blockHash.startsWith('0x') ? job.blockHash as Hex : `0x${job.blockHash}` as Hex;

    while (attempt < fetcherConfig.retryCount && blockSidecarsResponse === null) {
      attempt++;
      try {
        logger.debug(`[BlobFetcher] Attempt ${attempt}: Calling eth_getBlobSidecars for block ${blockHashHex}`);
        
        // TODO: For proper type safety with Viem, eth_getBlobSidecars should be added to the PublicClient's RpcSchema.
        // This would allow viemClient.request({ method: 'eth_getBlobSidecars', params: [...] }) to be fully typed.
        // For now, we cast the response and perform runtime checks.
        const response = await viemClient.request({
          method: 'eth_getBlobSidecars' as 'eth_call', // HACK: Casting to a known method to bypass initial type check. This is NOT ideal.
                                                    // The proper fix is schema extension for the client.
          params: [blockHashHex] as any, // HACK: Cast params to any. Proper fix is schema extension.
        });
        
        if (Array.isArray(response)) {
          if (response.every(item => 
              typeof item === 'object' && 
              item !== null && 
              'blob' in item && 
              'kzgCommitment' in item && 
              'kzgProof' in item)) {
            blockSidecarsResponse = response as EthGetBlobSidecarsRpcResponse;
          } else if (response.length === 0) {
            blockSidecarsResponse = [];
          } else {
            throw new Error('Response items do not match expected RpcBlobSidecar structure');
          }
        } else {
          throw new Error('Response from eth_getBlobSidecars was not an array');
        }

      } catch (e: any) {
        lastError = new Error(`[BlobFetcher] Attempt ${attempt} failed for eth_getBlobSidecars for block ${blockHashHex}: ${e.message}`);
        logger.warn(lastError.message, { stack: e.stack, originalError: e });
        if (attempt < fetcherConfig.retryCount) {
          await sleep(fetcherConfig.retryDelayMs);
        } else {
          // Ensure loop terminates if all retries failed by setting a non-null value
          blockSidecarsResponse = []; 
        }
      }
    }

    // Check if fetching ultimately failed or returned empty when blobs were expected
    if (blockSidecarsResponse === null || (blockSidecarsResponse.length === 0 && job.blobVersionedHashes.length > 0 && lastError !== null)) {
      const errorMessage = `[BlobFetcher] Failed to fetch blob sidecars for block ${blockHashHex} after ${fetcherConfig.retryCount} attempts. Last error: ${lastError?.message || 'Node returned empty or no sidecars, or an unexpected error occurred'}`;
      logger.error(errorMessage, { lastError });
      return Err(new Error(errorMessage));
    }

    const actualSidecars = blockSidecarsResponse || [];

    if (actualSidecars.length === 0 && job.blobVersionedHashes.length > 0) {
      logger.warn(`[BlobFetcher] No blob sidecars found in block ${blockHashHex} via RPC, but job ${job.txHash} expected ${job.blobVersionedHashes.length} blobs. This could mean the block has no sidecars or there was an issue with the RPC call not caught as an error.`);
    } else if (actualSidecars.length > 0) {
      logger.info(`[BlobFetcher] Received ${actualSidecars.length} sidecars for block ${blockHashHex}. Filtering for tx ${job.txHash}.`);
    }

    const fetchedBlobsForTx: FetchedBlob[] = [];
    const foundVersionedHashes = new Set<string>();
    const errorsEncountered: string[] = [];

    for (const sidecar of actualSidecars) {
      try {
        const kzgCommitmentHex: Hex = sidecar.kzgCommitment.startsWith('0x') 
            ? sidecar.kzgCommitment as Hex 
            : `0x${sidecar.kzgCommitment}` as Hex;
        
        // Pass commitment as an object and specify output type as hex
        const derivedVersionedHash = commitmentToVersionedHash({
          commitment: kzgCommitmentHex,
          to: 'hex'
        });
        
        if (job.blobVersionedHashes.includes(derivedVersionedHash)) {
          fetchedBlobsForTx.push({
            versionedHash: derivedVersionedHash,
            blob: (sidecar.blob.startsWith('0x') ? sidecar.blob : `0x${sidecar.blob}`) as Hex,
            kzgProof: (sidecar.kzgProof.startsWith('0x') ? sidecar.kzgProof : `0x${sidecar.kzgProof}`) as Hex,
            kzgCommitment: kzgCommitmentHex,
          });
          foundVersionedHashes.add(derivedVersionedHash);
        }
      } catch (hashError: any) {
        const hashErrorMessage = `[BlobFetcher] Error processing sidecar in block ${blockHashHex} (commitment: ${sidecar.kzgCommitment}): ${hashError.message}`;
        logger.warn(hashErrorMessage, { stack: hashError.stack });
        errorsEncountered.push(hashErrorMessage);
      }
    }

    const allExpectedBlobsFound = job.blobVersionedHashes.length === 0 || job.blobVersionedHashes.every(hash => foundVersionedHashes.has(hash));

    if (!allExpectedBlobsFound && job.blobVersionedHashes.length > 0) {
      const missingHashes = job.blobVersionedHashes.filter(hash => !foundVersionedHashes.has(hash));
      const warningMessage = `[BlobFetcher] Not all expected blobs found for tx ${job.txHash}. Expected ${job.blobVersionedHashes.length}, found ${foundVersionedHashes.size}. Missing: ${missingHashes.join(', ')}`;
      logger.warn(warningMessage);
      errorsEncountered.push(warningMessage);
    }

    const resultData: FetchedTransactionBlobs = {
      transactionHash: job.txHash,
      blockNumber: job.blockNumber,
      blockHash: job.blockHash,
      timestamp: job.timestamp,
      from: job.from,
      expectedBlobVersionedHashes: job.blobVersionedHashes,
      fetchedBlobs: fetchedBlobsForTx,
      allBlobsFound: allExpectedBlobsFound,
      ...(errorsEncountered.length > 0 && { errors: errorsEncountered }),
    };

    if (allExpectedBlobsFound || fetchedBlobsForTx.length > 0 || job.blobVersionedHashes.length === 0) {
      logger.info(`[BlobFetcher] Processed blobs for tx: ${job.txHash}. Found ${fetchedBlobsForTx.length}/${job.blobVersionedHashes.length} expected blobs.`);
    } else {
      // This case means no blobs were found but some were expected.
      logger.warn(`[BlobFetcher] No relevant blobs found for tx: ${job.txHash} despite expecting ${job.blobVersionedHashes.length}. Result indicates allBlobsFound: ${allExpectedBlobsFound}.`);
    }
    
    return Ok(resultData);
  };

  return {
    fetchBlobsForJob,
  };
}; 