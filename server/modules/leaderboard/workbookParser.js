import * as XLSX from 'xlsx'
import { badRequest } from '../../lib/errors.js'
import { calculateBoards } from './ranking.js'

const norm = (value) => String(value ?? '').replace(/\s+/g, '').toLowerCase()
const num = (value) => {
  if (typeof value === 'number') return value
  const text = String(value ?? '').trim()
  const parsed = Number(text.replace(/[(),]/g, match => match === '(' ? '-' : '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

const HEADER_ALIASES = {
  name: ['姓名', '负责人', '店铺负责人'], store: ['店铺', '店铺名'], level: ['职级'],
  score: ['总分', '优秀员工pk总分', '得分'], profitGrowth: ['环比利润增长', '环比毛利', '环比增长'],
  newProducts: ['达标新品数', '新品数'], newSkuOk: ['上新目标状态', '上新达标'],
  may: ['5月上新', '五月上新'], june: ['6月上新', '六月上新'], total: ['双月合计', '合计'], gap: ['缺口说明', '缺口'],
  qualified: ['达标新品数', '达标数'], points: ['当月累计积分', '累计积分', '积分'], change: ['较昨日变动', '积分变动'],
  mom: ['环比毛利', '环比利润增长'], yoy: ['同比毛利', '同比利润增长'],
}

function findHeaderRow(rows) {
  let best = { index: -1, score: 0 }
  rows.slice(0, 30).forEach((row, index) => {
    const score = row.filter(cell => Object.values(HEADER_ALIASES).flat().some(alias => norm(cell).includes(norm(alias)))).length
    if (score > best.score) best = { index, score }
  })
  return best.score >= 2 ? best.index : -1
}

function columnMap(header) {
  const result = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = header.findIndex(cell => aliases.some(alias => norm(cell).includes(norm(alias))))
    if (index >= 0) result[field] = index
  }
  return result
}

function rowsFromSheet(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })
}

function inferSheetMonths(sheet, board){
  const rows=rowsFromSheet(sheet),year=new Date().getFullYear(),explicit=new Set()
  for(const row of rows)for(const cell of row){const match=String(cell).match(/(20\d{2})[-/.年](0?[1-9]|1[0-2])/);if(match)explicit.add(`${match[1]}-${String(Number(match[2])).padStart(2,'0')}`)}
  if(explicit.size)return[...explicit]
  if(board==='newsku'){
    const header=rows.slice(0,10).find(row=>row.filter(cell=>/^\d{1,2}月$/.test(String(cell).trim())).length>=2)||[]
    return header.filter(cell=>/^\d{1,2}月$/.test(String(cell).trim())).map(cell=>`${year}-${String(Number(String(cell).match(/\d+/)[0])).padStart(2,'0')}`).slice(0,2)
  }
  if(board==='success')return[`${year}-05`,`${year}-06`]
  return[]
}

function parseGenericSheet(sheet, sheetName) {
  const rows = rowsFromSheet(sheet)
  const headerIndex = findHeaderRow(rows)
  if (headerIndex < 0) return null
  const columns = columnMap(rows[headerIndex])
  const records = rows.slice(headerIndex + 1).filter(row => row.some(cell => String(cell).trim())).map(row => ({
    name: row[columns.name], store: row[columns.store], level: row[columns.level], score: num(row[columns.score]),
    profitGrowth: num(row[columns.profitGrowth]), newProducts: num(row[columns.newProducts]), newSkuOk: /达标|是|完成|✅/.test(String(row[columns.newSkuOk])) && !/未达标|否|未完成|❌/.test(String(row[columns.newSkuOk])),
    may: num(row[columns.may]), june: num(row[columns.june]), total: num(row[columns.total]), gap: row[columns.gap],
    qualified: num(row[columns.qualified]), points: num(row[columns.points]), change: num(row[columns.change]), mom: num(row[columns.mom]), yoy: num(row[columns.yoy]),
  })).filter(row => row.name || row.store)
  return { sheetName, columns, records }
}

const boardFromName = (name) => /利润/.test(name) ? 'profit' : /上新/.test(name) ? 'newsku' : /推新成功/.test(name) ? 'success' : /积分/.test(name) ? 'point' : /优秀员工|pk|总榜/i.test(name) ? 'total' : null
const slug = (text) => norm(text).replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-')

function addPerson(people, name, store = '待设置', level = '待设置') {
  const pid = slug(`${store}-${name}`);people[pid] ||= { name: String(name), store: String(store), level: String(level) };return pid
}

function parseProfitTemplate(sheet, people) {
  const rows = rowsFromSheet(sheet), headerIndex = rows.findIndex(row => row.some(cell => norm(cell) === '毛利润'))
  if (headerIndex < 0) return []
  const header = rows[headerIndex], storeCol = header.findIndex(v => norm(v) === '店铺'), profitCol = header.findIndex(v => norm(v) === '毛利润')
  const ownerCols = header.map((v, i) => /^负责人\d*$/.test(norm(v)) ? i : -1).filter(i => i >= 0)
  const byPid = new Map()
  for (const row of rows.slice(headerIndex + 1)) for (const col of ownerCols) {
    const name = String(row[col] || '').trim();if (!name) continue
    const pid = addPerson(people, name, row[storeCol]);const current = byPid.get(pid) || { pid, currentProfit: 0, mom: 0, yoy: 0 };current.currentProfit += num(row[profitCol]);current.mom = current.currentProfit;byPid.set(pid, current)
  }
  return [...byPid.values()]
}

function parseNewSkuTemplate(sheet, people) {
  const rows = rowsFromSheet(sheet), monthRow = rows.findIndex(row => row.some(cell => /\d+月/.test(String(cell))))
  if (monthRow < 0) return []
  const personCol = 1, monthCols = rows[monthRow].map((v, i) => /\d+月/.test(String(v)) ? i + 1 : -1).filter(i => i >= 0)
  return rows.slice(monthRow + 1).map(row => {
    const name = String(row[personCol] || '').trim();if (!name || /运营|总计|说明/.test(name)) return null
    const counts = monthCols.map(col => num(row[col])), may = counts[0] || 0, june = counts[1] || 0, total = may + june, ok = june >= 2 && total >= 4
    return { pid: addPerson(people, name), may, june, total, newSkuOk: ok, gap: ok ? '已完成双月目标' : `双月目标缺口${Math.max(0, 4-total)}款` }
  }).filter(Boolean)
}

function parseSuccessTemplate(sheet, people, cycleMonths = [5, 6]) {
  const rows = rowsFromSheet(sheet), header = rows[0] || [], monthCols = cycleMonths.map(month => header.findIndex(v => norm(v) === `${month}月`)).filter(i => i >= 0)
  return rows.slice(1).map(row => {
    const name = String(row[0] || '').trim();if (!name || name.length > 30 || /总计|说明|计分标准|推新成功得分/.test(name)) return null
    const qualified = monthCols.reduce((sum, col) => sum + num(row[col]), 0)
    return { pid: addPerson(people, name), qualified, score: qualified * 25 }
  }).filter(Boolean)
}

function mergePersonIdentity(people) {
  const byName = new Map()
  for (const [pid, person] of Object.entries(people)) {
    const existing = byName.get(person.name)
    if (!existing || existing.person.store === '待设置') byName.set(person.name, { pid, person })
  }
  const aliases = {};for (const [pid, person] of Object.entries(people)) aliases[pid] = byName.get(person.name).pid
  return { people: Object.fromEntries([...byName.values()].map(x => [x.pid, x.person])), aliases }
}

export function cycleKeyForMonth(value) {
  const match=String(value||'').match(/(20\d{2})[-/.年](\d{1,2})/)
  if(!match)return new Date().toISOString().slice(0,7)
  const month=Number(match[2]),start=month%2===0?month-1:month
  return `${match[1]}-${String(start).padStart(2,'0')}`
}

export function autoDetectBoard(buffer) {
  let wb
  try { wb = XLSX.read(buffer, { type: 'buffer' }) }
  catch { return '' }
  for (const name of wb.SheetNames) {
    const b = boardFromName(name)
    if (b === 'profit' || b === 'newsku' || b === 'success') return b
  }
  return ''
}

export function parseLeaderboardWorkbook(buffer, { filename = '排行榜.xlsx', dataMonth = '', board = '' } = {}) {
  let workbook
  try { workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true }) }
  catch { throw badRequest('Excel 文件无法解析，请确认文件未损坏') }
  const peopleRaw = {}, inputs = { total: [], profit: [], newsku: [], success: [], point: [] }, diagnostics = [], sourceMonths = new Set()
  if(dataMonth)sourceMonths.add(String(dataMonth).slice(0,7))
  for (const name of workbook.SheetNames) {
    const sheetBoard = boardFromName(name)
    if (board && sheetBoard !== board) continue
    const sheet = workbook.Sheets[name]
    if (/利润/.test(name)) { inputs.profit = parseProfitTemplate(sheet, peopleRaw);for(const month of inferSheetMonths(sheet,'profit'))sourceMonths.add(month) }
    else if (/上新目标/.test(name)) { inputs.newsku = parseNewSkuTemplate(sheet, peopleRaw);for(const month of inferSheetMonths(sheet,'newsku'))sourceMonths.add(month) }
    else if (/推新成功/.test(name)) { inputs.success = parseSuccessTemplate(sheet, peopleRaw);for(const month of inferSheetMonths(sheet,'success'))sourceMonths.add(month) }
    else continue
    diagnostics.push({ name, rows: rowsFromSheet(sheet).length })
  }
  if (!inputs.profit.length && !inputs.newsku.length && !inputs.success.length) throw badRequest('未找到利润、上新或推新数据模板', { sheets: workbook.SheetNames })
  const providedBoards = ['profit','newsku','success'].filter(board => inputs[board].length), identity = mergePersonIdentity(peopleRaw), remap = rows => rows.map(row => ({ ...row, pid: identity.aliases[row.pid] }))
  inputs.profit = remap(inputs.profit);inputs.newsku = remap(inputs.newsku);inputs.success = remap(inputs.success)
  const profitMonth=[...sourceMonths].sort().at(-1)||'',profitMonths=inputs.profit.length&&profitMonth?{[profitMonth]:inputs.profit.map(row=>({...row,month:profitMonth,mom:0}))}:{},profitRows=inputs.profit.map(row=>({...row,month:profitMonth,mom:0}))
  inputs.profit=profitRows
  const profitByPid = new Map(inputs.profit.map(row => [row.pid, row])), skuByPid = new Map(inputs.newsku.map(row => [row.pid, row])), successByPid = new Map(inputs.success.map(row => [row.pid, row]))
  inputs.total = Object.keys(identity.people).map(pid => {
    const profit = profitByPid.get(pid) || { mom: 0 }, sku = skuByPid.get(pid) || { total: 0, newSkuOk: false }, success = successByPid.get(pid) || { qualified: 0 }
    const extraScore = Math.min(30, Math.max(0, sku.total - 4) * 15), rawScore = profit.mom * .01 + success.qualified * 25 + extraScore, score = Math.round(rawScore * 100) / 100
    return { pid, score, profitGrowth: profit.mom, newProducts: success.qualified, newSkuOk: sku.newSkuOk }
  }).sort((a,b)=>b.score-a.score)
  const now = new Date().toISOString()
  const key = cycleKeyForMonth(dataMonth||[...sourceMonths].sort().at(-1)||now.slice(0,7))
  return { key, label: key, sourceFile: filename, sourceMonths: [...sourceMonths].sort(), profitMonths, providedBoards, updatedAt: now, status: 'draft', ...calculateBoards(identity.people, inputs), diagnostics: { sheets: diagnostics, warnings: ['利润榜保存每月原始毛利润；同周期第二个月上传后，自动按“第二个月毛利润－第一个月毛利润”计算增长额。','模板未提供职级，人员职级暂标记为“待设置”。'] } }
}

export function mergeLeaderboardCycles(existing, incoming) {
  if (!existing) return incoming
  const people = { ...(existing.people || {}) }, nameToPid = new Map(Object.entries(people).map(([pid,p])=>[p.name,pid])), aliases = {}
  for (const [incomingPid,p] of Object.entries(incoming.people||{})) {
    let pid=nameToPid.get(p.name)
    if(!pid){pid=incomingPid;people[pid]={...p};nameToPid.set(p.name,pid)}
    else people[pid]={...people[pid],store:p.store&&p.store!=='待设置'?p.store:people[pid].store,level:people[pid].level||p.level}
    aliases[incomingPid]=pid
  }
  const remap=rows=>(rows||[]).map(row=>({...row,pid:aliases[row.pid]||row.pid})), provided=new Set(incoming.providedBoards||[])
  const profitMonths={...(existing.profitMonths||{})}
  if(!Object.keys(profitMonths).length&&(existing.profit||[]).length){const oldMonth=[...(existing.sourceMonths||[])].sort().at(-1);if(oldMonth)profitMonths[oldMonth]=existing.profit}
  if(provided.has('profit'))for(const [month,rows] of Object.entries(incoming.profitMonths||{}))profitMonths[month]=remap(rows)
  const profitMonthKeys=Object.keys(profitMonths).sort(),latestProfitMonth=profitMonthKeys.at(-1),previousProfitMonth=profitMonthKeys.at(-2),latestProfit=new Map((profitMonths[latestProfitMonth]||[]).map(row=>[row.pid,row])),previousProfit=new Map((profitMonths[previousProfitMonth]||[]).map(row=>[row.pid,row])),profitPids=new Set([...latestProfit.keys(),...previousProfit.keys()])
  const profit=provided.has('profit')?[...profitPids].map(pid=>{const current=Number(latestProfit.get(pid)?.currentProfit||0),previous=Number(previousProfit.get(pid)?.currentProfit||0);return{pid,currentProfit:current,previousProfit:previous,mom:previousProfitMonth?Math.round((current-previous)*100)/100:0,yoy:0,month:latestProfitMonth,previousMonth:previousProfitMonth||''}}):[...(existing.profit||[])]
  const newsku=provided.has('newsku')?remap(incoming.newsku):[...(existing.newsku||[])]
  const success=provided.has('success')?remap(incoming.success):[...(existing.success||[])]
  const profitByPid=new Map(profit.map(row=>[row.pid,row])),skuByPid=new Map(newsku.map(row=>[row.pid,row])),successByPid=new Map(success.map(row=>[row.pid,row]))
  const activePids=new Set([...profit,...newsku,...success].map(row=>row.pid))
  const total=[...activePids].map(pid=>{const p=profitByPid.get(pid)||{mom:0},sku=skuByPid.get(pid)||{total:0,newSkuOk:false},s=successByPid.get(pid)||{qualified:0};const extra=Math.min(30,Math.max(0,sku.total-4)*15),score=Math.round((p.mom*.01+s.qualified*25+extra)*100)/100;return{pid,score,profitGrowth:p.mom,newProducts:s.qualified,newSkuOk:sku.newSkuOk}})
  const boards=calculateBoards(people,{total,profit,newsku,success,point:existing.point||[]})
  if(existing.totalLocked)boards.total=existing.lockedTotal||existing.total||boards.total
  return {...existing,...incoming,...boards,profitMonths,sourceFile:[existing.sourceFile,incoming.sourceFile].filter(Boolean).join(' + '),sourceMonths:[...new Set([...(existing.sourceMonths||[]),...(incoming.sourceMonths||[])])].sort(),providedBoards:[...new Set([...(existing.providedBoards||[]),...(incoming.providedBoards||[])])],pointDetails:existing.pointDetails||{},pointsSyncedAt:existing.pointsSyncedAt||null,pointsSourceCount:existing.pointsSourceCount||0}
}
