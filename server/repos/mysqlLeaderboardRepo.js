import mysql from 'mysql2/promise'

export function createMysqlPool(env = process.env) {
  return mysql.createPool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionLimit: 10,
    charset: 'utf8mb4',
  })
}

// 本地阶段先使用 JSON 仓储。该模块保留 BESKO OS 迁移接缝，第二阶段接入迁移脚本与事务写入。
