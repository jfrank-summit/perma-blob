import type { PublicClient, Hash, Address, Log } from 'viem'

export type MonitorConfig = {
  rpcUrl: string
  beaconApiUrl?: string; // Optional: if monitor needs to interact with Beacon API directly
  baseContracts: Address[]
  confirmations: number
  batchSize: number
  blocksFromHead?: number // Optional: How many blocks from head to start if no last processed block
  l2Source: string
}

export type MonitorState = {
  isRunning: boolean
  lastProcessedBlock: bigint
  client: PublicClient
  monitorId: string
}

export type BlobTransaction = {
  hash: Hash
  from: string
  blockNumber: bigint
  blockHash: Hash
  timestamp: bigint
  blobVersionedHashes: string[]
}

export type ProcessingJob = {
  blockNumber: bigint
  blockHash: Hash
  timestamp: bigint
  txHash: Hash
  from: Address
  to: Address
  blobVersionedHashes: Hash[]
  l2Source: string
}

export type BlobTxLog = Log & {
  // Add specific event parameters if we are decoding known events
  // For now, we assume we get relevant info from the transaction receipt directly
} 