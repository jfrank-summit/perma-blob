import type { Database } from '../types.js'

export type MonitorState = {
  lastProcessedBlock: bigint
  updatedAt: Date
}

export const createMonitorStateRepository = (db: Database) => {
  const getLastProcessedBlock = async (): Promise<bigint> => {
    const result = await db.query<{ last_processed_block: string }>(
      'SELECT last_processed_block FROM monitor_state WHERE id = 1'
    )
    return result.rows[0]?.last_processed_block 
      ? BigInt(result.rows[0].last_processed_block) 
      : 0n
  }
  
  const updateLastProcessedBlock = async (blockNumber: bigint): Promise<void> => {
    await db.query(
      `INSERT INTO monitor_state (id, last_processed_block) 
       VALUES (1, $1) 
       ON CONFLICT (id) 
       DO UPDATE SET last_processed_block = $1, updated_at = CURRENT_TIMESTAMP`,
      [blockNumber.toString()]
    )
  }
  
  return {
    getLastProcessedBlock,
    updateLastProcessedBlock
  }
} 