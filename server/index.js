import express from 'express'
import path from 'node:path'
import { config } from './config.js'
import { localLogin } from './middleware/auth.js'
import leaderboardRouter from './routes/leaderboard.js'
import { fetchCumulativePoints, pointsPeriodForCycle } from './modules/leaderboard/feishuPointsSync.js'
import { getCycle, writePointsSync } from './repos/localLeaderboardRepo.js'

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use('/uploads', express.static(path.join(config.rootDir, 'uploads')))

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'besko-leaderboard-local' }))
app.post('/api/login', (req, res) => {
  const result = localLogin(req.body?.username, req.body?.password)
  if (!result) return res.status(401).json({ ok: false, error: '账号或密码错误' })
  res.json({ ok: true, ...result })
})
app.use('/api/leaderboard', leaderboardRouter)
app.get('/', (_req, res) => res.sendFile(path.join(config.rootDir, 'D老师.html')))
app.get('/admin', (_req, res) => res.sendFile(path.join(config.rootDir, 'admin.html')))
app.get('/login', (_req, res) => res.sendFile(path.join(config.rootDir, 'login.html')))

app.use((error, _req, res, _next) => {
  console.error(error)
  const status = error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500)
  res.status(status).json({ ok: false, error: error.message || '服务器内部错误', details: error.details })
})

async function scheduledPointsSync(){try{const current=await getCycle();const period=pointsPeriodForCycle(current);const sync=await fetchCumulativePoints({period});await writePointsSync(sync);console.log(`飞书积分同步完成：${period} / ${sync.totals.length} 人 / ${sync.sourceCount} 条来源记录`)}catch(error){console.error('飞书积分自动同步失败：',error.message)}}
app.listen(config.port, () => {console.log(`龙虎榜本地服务已启动：http://localhost:${config.port}`);setTimeout(scheduledPointsSync,5000).unref();setInterval(scheduledPointsSync,24*60*60*1000).unref()})
