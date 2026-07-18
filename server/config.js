import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const config = {
  rootDir,
  port: Number(process.env.PORT || 3100),
  jwtSecret: process.env.JWT_SECRET || 'local-development-only-secret',
  storage: process.env.LEADERBOARD_STORAGE || 'local',
  dataDir: path.resolve(rootDir, process.env.LEADERBOARD_DATA_DIR || 'data/runtime'),
  avatarDir: path.resolve(rootDir, 'uploads/avatars'),
  workbookPath: path.resolve(rootDir, '运营部门龙虎榜-附表格模版.xlsx'),
}
