import test from 'node:test'
import assert from 'node:assert/strict'
import { rankRows } from '../server/modules/leaderboard/ranking.js'
import { pointsPeriodForCycle } from '../server/modules/leaderboard/feishuPointsSync.js'
import { cycleKeyForMonth, mergeLeaderboardCycles } from '../server/modules/leaderboard/workbookParser.js'
import * as XLSX from 'xlsx'
import { parseLeaderboardWorkbook } from '../server/modules/leaderboard/workbookParser.js'

test('总榜按分数降序并保留并列名次', () => {
  const ranked = rankRows([{ pid: 'a', score: 10 }, { pid: 'b', score: 30 }, { pid: 'c', score: 30 }, { pid: 'd', score: 5 }], 'total')
  assert.deepEqual(ranked.map(row => [row.pid, row.rank]), [['b', 1], ['c', 1], ['a', 3], ['d', 4]])
})

test('总榜纯按总分排名，上新状态不改变名次', () => {
  const ranked = rankRows([{ pid: 'high', score: 999, newSkuOk: false }, { pid: 'low', score: 1, newSkuOk: true }], 'total')
  assert.deepEqual(ranked.map(row => row.pid), ['high', 'low'])
})

test('双月上新目标六种典型情况', () => {
  const completed = (first, second) => second >= 2 && first + second >= 4
  assert.equal(completed(2, 2), true)
  assert.equal(completed(1, 3), true)
  assert.equal(completed(1, 2), false)
  assert.equal(completed(2, 1), false)
  assert.equal(completed(0, 4), true)
  assert.equal(completed(0, 2), false)
})

test('积分优先按 Excel 数据月份映射双月归属月份', () => {
  assert.equal(pointsPeriodForCycle({ key: '2026-07', sourceMonths: ['2026-05'] }), '5-6月')
  assert.equal(pointsPeriodForCycle({ key: '2026-08', sourceMonths: [] }), '7-8月')
})

test('月度文件归入对应双月历史周期', () => {
  assert.equal(cycleKeyForMonth('2026-05'), '2026-05')
  assert.equal(cycleKeyForMonth('2026-06'), '2026-05')
  assert.equal(cycleKeyForMonth('2026-08'), '2026-07')
})

test('利润增长额按第二个月毛利润减第一个月毛利润', () => {
  const base={key:'2026-05',people:{a:{name:'A',store:'S',level:'P1'}},profit:[{pid:'a',currentProfit:1500,mom:0}],newsku:[],success:[],point:[],total:[],sourceMonths:['2026-05'],profitMonths:{'2026-05':[{pid:'a',currentProfit:1500}]},providedBoards:['profit']}
  const next={...base,sourceMonths:['2026-06'],profitMonths:{'2026-06':[{pid:'a',currentProfit:100}]},profit:[{pid:'a',currentProfit:100,mom:0}]}
  const merged=mergeLeaderboardCycles(base,next)
  assert.equal(merged.profit[0].mom,-1400)
})

test('利润文件从日期列自动识别月份', () => {
  const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['基础信息','','','','','','利润'],['日期','店铺','负责人1','负责人2','负责人3','币种','毛利润'],['2026-06','红卡-US','Kayo','','','USD',100]])
  XLSX.utils.book_append_sheet(workbook,sheet,'Tab2-利润数据模版')
  const parsed=parseLeaderboardWorkbook(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{filename:'利润.xlsx'})
  assert.deepEqual(parsed.sourceMonths,['2026-06'])
  assert.equal(parsed.key,'2026-05')
})

test('上新文件从月份标题自动识别双月周期', () => {
  const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['','',''],['','',''],['','姓名','','5月','','6月'],['','Kayo','',2,'',2]])
  XLSX.utils.book_append_sheet(workbook,sheet,'Tab-3上新目标完成情况')
  const parsed=parseLeaderboardWorkbook(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{filename:'上新.xlsx'})
  assert.deepEqual(parsed.sourceMonths,['2026-05','2026-06'])
  assert.equal(parsed.key,'2026-05')
})
