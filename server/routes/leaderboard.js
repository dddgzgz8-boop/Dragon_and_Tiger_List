import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs/promises'
import { config } from '../config.js'
import { optionalAuth, requireAuth, requireManager } from '../middleware/auth.js'
import { deleteImport, getCycle, listCycles, listImports, setTotalLock, updatePerson, writeCycle, writePointsSync } from '../repos/localLeaderboardRepo.js'
import { autoDetectBoard, mergeLeaderboardCycles, parseLeaderboardWorkbook } from '../modules/leaderboard/workbookParser.js'
import { asyncHandler, badRequest } from '../lib/errors.js'
import { fetchCumulativePoints, pointsPeriodForCycle } from '../modules/leaderboard/feishuPointsSync.js'

const router = Router()
const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

/* multer 在 Windows 上有时会对中文文件名产生双重编码，修正它 */
function safeFilename(originalname) {
  try {
    const fixed = Buffer.from(originalname, 'latin1').toString('utf8')
    if (/[一-龥]/.test(fixed)) return fixed
  } catch {}
  return originalname
}

/* 本地验证阶段：排行榜只读接口公开；导入和头像写操作仍需 JWT。迁入中台后由外层统一鉴权。 */
router.get('/cycles', asyncHandler(async (_req, res) => res.json({ ok: true, items: await listCycles() })))
/* 按部门过滤榜单（积分榜不受部门限制，始终返回全员） */
function filterCycleByDept(cycle, department) {
  if (!department || department === '运营部门') return cycle
  const deptPids = new Set(Object.entries(cycle.people || {}).filter(([,p]) => p.department === department).map(([pid]) => pid))
  if (!deptPids.size) return cycle
  const filterBoard = (board) => (board || []).filter(row => deptPids.has(row.pid))
  return { ...cycle, total: filterBoard(cycle.total), profit: filterBoard(cycle.profit), newsku: filterBoard(cycle.newsku), success: filterBoard(cycle.success) }
}
router.get('/', optionalAuth, asyncHandler(async (req, res) => res.json({ ok: true, cycle: filterCycleByDept(await getCycle(req.query.cycle), req.actor?.department), department: req.actor?.department || '全部部门' })))
router.get('/imports', requireAuth, requireManager, asyncHandler(async (_req, res) => res.json({ ok: true, items: await listImports() })))
router.delete('/imports/:id', requireAuth, requireManager, asyncHandler(async (req, res) => { await deleteImport(req.params.id);res.json({ ok: true }) }))
router.patch('/people/:pid', requireAuth, requireManager, asyncHandler(async (req,res)=>res.json({ok:true,person:await updatePerson(req.params.pid,req.body||{})})))
router.post('/total-lock', requireAuth, requireManager, asyncHandler(async(req,res)=>{const cycle=await setTotalLock(Boolean(req.body?.locked));res.json({ok:true,locked:cycle.totalLocked,lockedAt:cycle.totalLockedAt||null})}))
router.get('/points/:pid/details', asyncHandler(async (req,res)=>{const cycle=await getCycle(req.query.cycle);res.json({ok:true,items:cycle.pointDetails?.[req.params.pid]||[],syncedAt:cycle.pointsSyncedAt||null})}))
router.post('/points/sync', requireAuth, requireManager, asyncHandler(async (_req,res)=>{const current=await getCycle();const period=pointsPeriodForCycle(current);const sync=await fetchCumulativePoints({period});const cycle=await writePointsSync(sync);res.json({ok:true,count:cycle.point.length,sourceCount:sync.sourceCount,totalSourceCount:sync.totalSourceCount,period,syncedAt:sync.fetchedAt,avatarCount:sync.avatarCount,avatarMessage:sync.avatarMessage})}))
router.post('/import', requireAuth, requireManager, excelUpload.single('file'), asyncHandler(async (req, res) => {
  const file=req.file,board=req.body?.board||autoDetectBoard(file.buffer)
  if (!file) throw badRequest('请选择 Excel 文件')
  if (!/\.xlsx?$/i.test(file.originalname)) throw badRequest('仅支持 .xlsx 或 .xls 文件')
  if(!['profit','newsku','success'].includes(board))throw badRequest('无法识别该 Excel 属于哪个榜单，请确认工作表名称包含"利润""上新""推新"等关键词')
  const filename=safeFilename(file.originalname)
  const incoming=parseLeaderboardWorkbook(file.buffer,{filename,board})
  if(!incoming.providedBoards.includes(board))throw badRequest('所选榜单类型与 Excel 内容不一致')
  if(!incoming.sourceMonths.length)throw badRequest('Excel 内未识别到数据月份，请在表内日期或备注中填写 YYYY-MM')
  const dataMonth=incoming.sourceMonths.sort()[0]
  let existing=null;try{existing=await getCycle(incoming.key)}catch{}
  const cycle=mergeLeaderboardCycles(existing,incoming)
  cycle.sourceFile=filename
  await writeCycle(cycle, { importedBy: req.actor.username, method: 'monthly-upload', board, dataMonth })
  res.json({ ok: true, cycle, diagnostics: cycle.diagnostics })
}))
router.post('/import-template', requireAuth, requireManager, asyncHandler(async (req, res) => {
  const buffer = await fs.readFile(config.workbookPath)
  const cycle = parseLeaderboardWorkbook(buffer, { filename: path.basename(config.workbookPath) })
  await writeCycle(cycle, { importedBy: req.actor.username, method: 'template' })
  res.json({ ok: true, cycle, diagnostics: cycle.diagnostics })
}))

export default router
