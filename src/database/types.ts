export type DatabaseConfig = {
  type: 'sqlite'
  sqlitePath: string
}

export type QueryResult<T = any> = {
  rows: T[]
  rowCount: number
}

export type DatabaseConnection = {
  query: <T = any>(sql: string, params?: any[]) => Promise<QueryResult<T>>
  transaction: <T>(fn: (tx: DatabaseConnection) => Promise<T>) => Promise<T>
  close: () => Promise<void>
}

export type Database = DatabaseConnection & {
  migrate: () => Promise<void>
} 