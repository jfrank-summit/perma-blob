import type { FetchedTransactionBlobs } from '../blob-fetcher/types.js';

// The job data that the Archiver worker will process from the queue
export type ArchivalJobData = FetchedTransactionBlobs;

// Configuration specific to the blob archiver
export type BlobArchiverConfig = {
  // AutoDrive specific configurations will go here, e.g.:
  // - containerId for blobs (if pre-defined, or logic to create/find it)
  // - any specific upload options for AutoDrive
  // For now, we can keep it simple or add placeholders.
  autoDriveContainerName?: string; // Optional: Name of the container to use/create
  autoDriveCreateContainerIfNotExists?: boolean; // Whether to attempt to create container
};

// Structure of the object to be stored in AutoDrive for each blob
export type BlobContainer = {
  version: string;
  type: string;
  metadata: {
    // L1 transaction data
    txHash: string;
    from: string; 
    to: string;   
    l1BlockNumber: number;
    l1BlockHash: string; // Execution Layer Block Hash
    slot: string; 
    l1BlockRootHash?: string; // Optional: Beacon chain block root

    // Blob specific data
    blobHash: string; // Versioned hash
    blobIndex: number;
    sizeBytes: number;
    
    // L2 source info
    l2Source: string;
  };
  blob: string;                     // Base64 encoded blob data
  checksums: {
    kzgCommitment: string;          // Original KZG commitment
    sha256: string;                 // SHA256 of the raw blob data (hex string)
  };
};

// Represents the result of an archival attempt for a single transaction
export type ArchivalResult = {
  transactionHash: string;
  success: boolean;
  message: string;
  // Results for each blob processed within the transaction
  blobArchivalDetails?: Array<{
    versionedHash: string;
    blobCid?: string; // CID if successfully stored in AutoDrive
    blobContainerSha256?: string; // Optional: SHA256 of the BlobContainer JSON for verification
    success: boolean;
    error?: string;
  }>;
  error?: string; // Overall error for the transaction if something went wrong before individual blob processing
}; 