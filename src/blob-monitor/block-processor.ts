import type { Block, Transaction } from 'viem'
import type { BlobTransaction } from './types.js'
import { logger } from '../shared/logger.js'

const isBlobTransaction = (tx: Transaction): boolean => {
  // EIP-4844 blob transactions have type 0x03
  return tx.type === 'eip4844' && 
    tx.blobVersionedHashes !== undefined &&
    tx.blobVersionedHashes.length > 0
}

const isToBaseContract = (tx: Transaction, contracts: Set<string>): boolean =>
  contracts.has(tx.to?.toLowerCase() || '')

export const processBlock = async (
  block: Block,
  baseContracts: string[]
): Promise<BlobTransaction[]> => {
  if (!block.transactions || typeof block.transactions[0] === 'string') {
    return []
  }
  
  const contractSet = new Set(baseContracts.map(addr => addr.toLowerCase()))
  
  const blobTransactions = (block.transactions as Transaction[])
    .filter(tx => isBlobTransaction(tx) && isToBaseContract(tx, contractSet))
    .map(tx => ({
      hash: tx.hash!,
      from: tx.from!,
      blockNumber: block.number!,
      blockHash: block.hash!,
      timestamp: block.timestamp,
      blobVersionedHashes: [...(tx.blobVersionedHashes || [])]
    }))
  
  if (blobTransactions.length > 0) {
    logger.info(`Found ${blobTransactions.length} blob transactions in block ${block.number}`)
  }
  
  return blobTransactions
} 