// Represents a single fetched and validated blob
export type FetchedBlob = {
  versionedHash: string;        // The versioned hash (derived from kzgCommitment)
  blob: `0x${string}`;           // Hex-encoded blob data content
  kzgProof: `0x${string}`;
  kzgCommitment: `0x${string}`;
};

// Contains all fetched blobs for a specific transaction, along with job context
export type FetchedTransactionBlobs = {
  // Context from the input ProcessingJob
  transactionHash: string;
  blockNumber: bigint;
  blockHash: string; // Execution Layer Block Hash
  timestamp: bigint;
  from: string;
  to: string; // Added
  l2Source: string; // Identifier for the L2 source, carried from ProcessingJob
  expectedBlobVersionedHashes: string[]; // The original list from ProcessingJob

  // Data derived/fetched by the fetcher
  slot: string; // Added - Slot number used for Beacon API call
  blockRootHash?: string; // Added - Beacon chain block root, fetched from headers endpoint

  // Actual fetched data
  fetchedBlobs: FetchedBlob[]; // Array of blobs successfully fetched and validated for this transaction
  
  // Status/Metadata
  allBlobsFound: boolean; // True if all expectedBlobVersionedHashes were found
  errors?: string[];      // Any errors encountered during fetching for this job
};

// Configuration specific to the blob fetcher
export type BlobFetcherConfig = {
  retryCount: number;
  retryDelayMs: number;
};

// Viem/RPC BlobSidecar structure (simplified, for internal reference if needed)
// Actual type will come from Viem or direct RPC calls
export type RpcBlobSidecar = {
  blob: `0x${string}`;          // Blob data
  kzgCommitment: `0x${string}`; // KZG commitment
  kzgProof: `0x${string}`;      // KZG proof
  // signedBlockHeader and kzgCommitmentInclusionProof might also be part of the full sidecar
  // but are not strictly needed for the fetcher's output to the archiver.
}; 