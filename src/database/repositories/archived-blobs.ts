import type { Database } from '../types.js'

export type ArchivedBlob = {
  blobHash: string
  cid: string
  l1BlockNumber: bigint
  l2Source: string
  txHash: string
  size: number
  archivedAt: Date
}

export const createArchivedBlobsRepository = (db: Database) => {
  const save = async (blob: ArchivedBlob): Promise<void> => {
    await db.query(
      `INSERT INTO archived_blobs (
        blob_hash, cid, l1_block_number, l2_source,
        tx_hash, size, archived_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (blob_hash) DO UPDATE SET
        cid = EXCLUDED.cid,
        archived_at = EXCLUDED.archived_at`,
      [
        blob.blobHash,
        blob.cid,
        blob.l1BlockNumber.toString(),
        blob.l2Source,
        blob.txHash,
        blob.size,
        blob.archivedAt
      ]
    )
  }
  
  const findByCid = async (cid: string): Promise<ArchivedBlob | null> => {
    const result = await db.query<any>(
      'SELECT * FROM archived_blobs WHERE cid = $1',
      [cid]
    )
    
    if (result.rows.length === 0) return null
    
    const row = result.rows[0]
    return {
      blobHash: row.blob_hash,
      cid: row.cid,
      l1BlockNumber: BigInt(row.l1_block_number),
      l2Source: row.l2_source,
      txHash: row.tx_hash,
      size: row.size,
      archivedAt: new Date(row.archived_at)
    }
  }
  
  const findByBlockRange = async (
    fromBlock: bigint,
    toBlock: bigint,
    limit = 100
  ): Promise<ArchivedBlob[]> => {
    const result = await db.query<any>(
      `SELECT * FROM archived_blobs 
       WHERE l1_block_number >= $1 AND l1_block_number <= $2
       ORDER BY l1_block_number DESC
       LIMIT $3`,
      [fromBlock.toString(), toBlock.toString(), limit]
    )
    
    return result.rows.map((row: any) => ({
      blobHash: row.blob_hash,
      cid: row.cid,
      l1BlockNumber: BigInt(row.l1_block_number),
      l2Source: row.l2_source,
      txHash: row.tx_hash,
      size: row.size,
      archivedAt: new Date(row.archived_at)
    }))
  }
  
  const findByBlobHash = async (blobHash: string): Promise<ArchivedBlob | null> => {
    const result = await db.query<any>(
      'SELECT * FROM archived_blobs WHERE blob_hash = $1',
      [blobHash]
    )
    
    if (result.rows.length === 0) return null
    
    const row = result.rows[0]
    return {
      blobHash: row.blob_hash,
      cid: row.cid,
      l1BlockNumber: BigInt(row.l1_block_number),
      l2Source: row.l2_source,
      txHash: row.tx_hash,
      size: row.size,
      archivedAt: new Date(row.archived_at)
    }
  }
  
  const updateVerificationTimestamp = async (blobHash: string): Promise<void> => {
    await db.query(
      'UPDATE archived_blobs SET last_verified_at = CURRENT_TIMESTAMP WHERE blob_hash = $1',
      [blobHash]
    )
  }
  
  const incrementRetrievalCount = async (blobHash: string): Promise<void> => {
    await db.query(
      'UPDATE archived_blobs SET retrieval_count = retrieval_count + 1 WHERE blob_hash = $1',
      [blobHash]
    )
  }
  
  return {
    save,
    findByCid,
    findByBlockRange,
    findByBlobHash,
    updateVerificationTimestamp,
    incrementRetrievalCount
  }
} 