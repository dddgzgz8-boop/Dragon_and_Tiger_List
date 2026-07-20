import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import { notFound } from '../lib/errors.js'
import { rankRows } from '../modules/leaderboard/ranking.js'

const statePath = path.join(config.dataDir, 'leaderboard.json')

async function ensureDir() { await fs.mkdir(config.dataDir, { recursive: true }) }

export async function readState() {
  await ensureDir()
  try { return JSON.parse(await fs.readFile(statePath, 'utf8')) }
  catch (error) {
    if (error.code === 'ENOENT') return { currentCycle: null, cycles: {} }
    throw error
  }
}

export async function writeCycle(cycle, importMeta = null) {
  const state = await readState()
  const previous = state.cycles[cycle.key] || state.cycles[state.currentCycle]
  /* Excel 重新导入只更新业务榜单，不应清空已经持久化的飞书积分与头像。 */
  if (previous) {
    cycle.people = { ...(previous.people || {}), ...(cycle.people || {}) }
    for (const [pid, oldPerson] of Object.entries(previous.people || {})) {
      if (!cycle.people[pid]) continue
      cycle.people[pid].avatarUrl ||= oldPerson.avatarUrl || ''
      cycle.people[pid].feishuOpenId ||= oldPerson.feishuOpenId || ''
    }
    cycle.point = previous.point || cycle.point || []
    cycle.pointDetails = previous.pointDetails || cycle.pointDetails || {}
    cycle.pointsSyncedAt = previous.pointsSyncedAt || cycle.pointsSyncedAt || null
    cycle.pointsSourceCount = previous.pointsSourceCount || cycle.pointsSourceCount || 0
  }
  state.cycles[cycle.key] = cycle
  state.currentCycle = cycle.key
  state.imports ||= []
  if (importMeta) {
    state.imports.unshift({ id: `imp-${Date.now()}`, filename: cycle.sourceFile, months: cycle.sourceMonths || [], importedAt: cycle.updatedAt, status: cycle.status, counts: { total: cycle.total.length, profit: cycle.profit.length, newsku: cycle.newsku.length, success: cycle.success.length, point: cycle.point.length }, ...importMeta })
    state.imports = state.imports.slice(0, 100)
  }
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8')
  return cycle
}

export async function getCycle(key) {
  const state = await readState()
  const cycleKey = key || state.currentCycle
  const cycle = state.cycles[cycleKey]
  if (!cycle) throw notFound('暂无可用榜单，请先导入 Excel')
  return cycle
}

export async function listCycles() {
  const state = await readState()
  return Object.values(state.cycles).map(({ key, label, updatedAt }) => ({ key, label, updatedAt, current: key === state.currentCycle }))
}

export async function listImports() { const state = await readState();return state.imports || [] }

export async function deleteImport(id) {
  const state = await readState()
  const before = (state.imports || []).length
  state.imports = (state.imports || []).filter(item => item.id !== id)
  if (state.imports.length === before) throw notFound('未找到该上传记录')
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8')
  return true
}

export async function updatePerson(pid, changes) {
  const state = await readState(), cycle = state.cycles[state.currentCycle]
  if (!cycle?.people?.[pid]) throw notFound('未找到该员工')
  if (typeof changes.level === 'string') cycle.people[pid].level = changes.level.trim() || '待设置'
  if (['运营一部','运营二部'].includes(changes.department)) cycle.people[pid].department = changes.department
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8')
  return cycle.people[pid]
}

function currentTotal(cycle){const profit=new Map((cycle.profit||[]).map(x=>[x.pid,x])),sku=new Map((cycle.newsku||[]).map(x=>[x.pid,x])),success=new Map((cycle.success||[]).map(x=>[x.pid,x])),pids=new Set([...profit.keys(),...sku.keys(),...success.keys()]);return rankRows([...pids].map(pid=>{const p=profit.get(pid)||{mom:0},s=sku.get(pid)||{total:0,newSkuOk:false},n=success.get(pid)||{qualified:0},extra=Math.min(30,Math.max(0,Number(s.total||0)-4)*15),score=Math.round((Number(p.mom||0)*.01+Number(n.qualified||0)*25+extra)*100)/100;return{pid,score,profitGrowth:Number(p.mom||0),newProducts:Number(n.qualified||0),newSkuOk:Boolean(s.newSkuOk)}}),'total')}

export async function setTotalLock(locked) {
  const state=await readState(),cycle=state.cycles[state.currentCycle]
  if(!cycle)throw notFound('暂无榜单')
  cycle.totalLocked=Boolean(locked)
  if(cycle.totalLocked){cycle.lockedTotal=cycle.total;cycle.totalLockedAt=new Date().toISOString()}
  else{cycle.total=currentTotal(cycle);delete cycle.lockedTotal;cycle.totalLockedAt=null}
  await fs.writeFile(statePath,JSON.stringify(state,null,2),'utf8')
  return cycle
}

export async function writePointsSync(sync) {
  const state = await readState(), cycle = state.cycles[state.currentCycle]
  if (!cycle) throw notFound('暂无榜单，无法关联积分人员')
  const peopleByName = new Map(Object.entries(cycle.people).map(([pid, person]) => [person.name, pid])), pointDetails = {}
  cycle.point = sync.totals.map(item => { let pid = peopleByName.get(item.name);if (!pid) { pid = `feishu-${item.name.toLowerCase().replace(/\s+/g, '-')}`;cycle.people[pid] = { name: item.name, store: '待设置', level: '待设置' } }const feishuPerson=sync.people?.[item.name]||{};cycle.people[pid].feishuOpenId=feishuPerson.openId||cycle.people[pid].feishuOpenId||'';cycle.people[pid].avatarUrl=feishuPerson.avatarUrl||cycle.people[pid].avatarUrl||'';if(feishuPerson.level&&(!cycle.people[pid].level||cycle.people[pid].level==='待设置'))cycle.people[pid].level=feishuPerson.level;cycle.people[pid].feishuDeptIds=feishuPerson.departmentIds||cycle.people[pid].feishuDeptIds||[];const detail=sync.details[item.name]||[];pointDetails[pid]=detail;const goldPoints=detail.filter(x=>/黄金/.test(x.cardType)).reduce((sum,x)=>sum+Number(x.quantity||0),0),ordinaryPoints=detail.filter(x=>!/黄金/.test(x.cardType)).reduce((sum,x)=>sum+Number(x.quantity||0),0);return { pid, points: item.points, ordinaryPoints, goldPoints, change: 0 } }).sort((a,b)=>b.points-a.points).map((row,index)=>({...row,rank:index+1}))
  cycle.pointDetails = pointDetails;cycle.pointsSyncedAt = sync.fetchedAt;cycle.pointsSourceCount = sync.sourceCount
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');return cycle
}
