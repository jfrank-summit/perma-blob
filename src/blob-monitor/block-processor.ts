import type { Block, Transaction, Address, Hash } from 'viem'
import type { ProcessingJob, MonitorConfig } from './types.js'
import { logger } from '../shared/logger.js'

const isRelevantBlobTransaction = (
  tx: Transaction,
  monitoredContracts: Set<Address>
): tx is Transaction & {
  to: Address
  hash: Hash
  from: Address
  blobVersionedHashes: Hash[]
} => {
  return (
    tx.type === 'eip4844' &&
    tx.to !== null &&
    monitoredContracts.has(tx.to.toLowerCase() as Address) &&
    Array.isArray(tx.blobVersionedHashes) &&
    tx.blobVersionedHashes.length > 0
  )
}

export const createProcessingJobsForBlock = async (
  block: Block,
  monitorConfig: Pick<MonitorConfig, 'baseContracts' | 'l2Source'> 
): Promise<ProcessingJob[]> => {
  if (block.number === null || block.hash === null) {
    logger.error(
      `[BlockProcessor] Block is missing number or hash. Number: ${block.number}, Hash: ${block.hash}. Skipping job creation.`,
    );
    return [];
  }
  // After this check, block.number and block.hash are known to be non-null.
  // Assign to new consts to help TypeScript infer non-null types for use below.
  const blockNumber: bigint = block.number;
  const blockHash: Hash = block.hash;

  if (!block.transactions || block.transactions.length === 0) {
    return []
  }

  if (typeof block.transactions[0] === 'string') {
    logger.warn(
      `[BlockProcessor] Block ${blockNumber} transactions are hashes, not objects. Skipping. Proper hydration needed.`,
    );
    return [];
  }

  const monitoredContracts = new Set(
    monitorConfig.baseContracts.map(addr => addr.toLowerCase() as Address),
  )
  
  const jobs: ProcessingJob[] = (block.transactions as Transaction[])
    .filter((tx): tx is Transaction & { to: Address; blobVersionedHashes: Hash[] } => 
      isRelevantBlobTransaction(tx, monitoredContracts)
    )
    .map(tx => ({
      blockNumber,
      blockHash,
      timestamp: block.timestamp,
      txHash: tx.hash,
      from: tx.from,
      blobVersionedHashes: tx.blobVersionedHashes,
      l2Source: monitorConfig.l2Source,
    }))
  
  if (jobs.length > 0) {
    logger.info(`[BlockProcessor] Created ${jobs.length} processing jobs for block ${blockNumber}`)
  }
  
  return jobs
} 