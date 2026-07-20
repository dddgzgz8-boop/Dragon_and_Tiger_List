import { badRequest } from '../../lib/errors.js'

const host = process.env.FEISHU_BRAND === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
async function token(){const r=await fetch(`${host}/open-apis/auth/v3/tenant_access_token/internal`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})}).then(x=>x.json());if(!r.tenant_access_token)throw badRequest(`飞书鉴权失败：${r.msg||r.code}`);return r.tenant_access_token}
async function avatarToken(){const appId=process.env.FEISHU_AVATAR_APP_ID||process.env.FEISHU_APP_ID,appSecret=process.env.FEISHU_AVATAR_APP_SECRET||process.env.FEISHU_APP_SECRET;const r=await fetch(`${host}/open-apis/auth/v3/tenant_access_token/internal`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:appId,app_secret:appSecret})}).then(x=>x.json());if(!r.tenant_access_token)throw badRequest(`飞书头像应用鉴权失败：${r.msg||r.code}`);return r.tenant_access_token}
async function records(accessToken){const items=[];let pageToken='';do{const url=new URL(`${host}/open-apis/bitable/v1/apps/${process.env.FEISHU_POINTS_APP_TOKEN}/tables/${process.env.FEISHU_POINTS_TABLE_ID}/records`);url.searchParams.set('page_size','500');if(process.env.FEISHU_POINTS_VIEW_ID)url.searchParams.set('view_id',process.env.FEISHU_POINTS_VIEW_ID);if(pageToken)url.searchParams.set('page_token',pageToken);const r=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`}}).then(x=>x.json());if(r.code)throw badRequest(`读取飞书积分表失败：${r.msg||r.code}`);items.push(...(r.data?.items||[]));pageToken=r.data?.has_more?r.data.page_token:''}while(pageToken);return items}
const namesOf=value=>Array.isArray(value)?value.map(v=>typeof v==='object'?(v.name||v.en_name):v).filter(Boolean):[String(value||'')].filter(Boolean)
const usersOf=value=>Array.isArray(value)?value.filter(v=>v&&typeof v==='object').map(v=>({name:v.name||v.en_name||'',openId:v.id||v.open_id||''})).filter(v=>v.name):[]
const dateText=value=>value?new Date(Number(value)).toISOString().slice(0,10):''
async function avatarOf(accessToken,openId){if(!openId)return'';const url=new URL(`${host}/open-apis/contact/v3/users/${encodeURIComponent(openId)}`);url.searchParams.set('user_id_type','open_id');const r=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`}}).then(x=>x.json());if(r.code)return'';const avatar=r.data?.user?.avatar||{};return avatar.avatar_240||avatar.avatar_640||avatar.avatar_origin||avatar.avatar_72||''}
const avatarUrlOf=value=>{if(typeof value==='string')return value;if(!value)return'';return value.avatar_240||value.avatar_640||value.avatar_origin||value.avatar_url||value.url||''}
async function directoryAvatars(accessToken){const url=`${host}/open-apis/directory/v1/employees/filter?employee_id_type=open_id`,employees=[];let pageToken='';do{const pageRequest={page_size:100};if(pageToken)pageRequest.page_token=pageToken;const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'content-type':'application/json'},body:JSON.stringify({filter:{conditions:[{field:'base_info.active_status',operator:'eq',value:'2'}]},required_fields:['base_info.employee_id','base_info.name','base_info.avatar','work_info.job_level','work_info.job_title','department_ids'],page_request:pageRequest})}).then(x=>x.json());if(r.code)return{byId:new Map(),byName:new Map(),error:`${r.code} ${r.msg}`};employees.push(...(r.data?.employees||[]));pageToken=r.data?.page_response?.has_more?r.data.page_response.page_token:''}while(pageToken);const byId=new Map(),byName=new Map();for(const employee of employees){const base=employee.base_info||{},work=employee.work_info||{},level=work.job_level?.name?.default_value||work.job_level?.default_value||work.job_level?.name||'',name=base.name?.name?.default_value||base.name?.default_value||'',deptIds=Array.isArray(employee.department_ids)?employee.department_ids:[],item={avatarUrl:avatarUrlOf(base.avatar),name,level,departmentIds:deptIds};byId.set(base.employee_id||employee.employee_id,item);if(name)byName.set(name.toLowerCase(),item)}return{byId,byName,error:'',visibleCount:byId.size}}
export function pointsPeriodForCycle(cycle){
  const cycleMonth=String(cycle?.key||'').match(/-(\d{1,2})$/)?.[1]
  const sourceMonth=[...(cycle?.sourceMonths||[])].sort().at(-1)?.match(/-(\d{1,2})$/)?.[1]
  const month=Number(sourceMonth||cycleMonth||new Date().getMonth()+1)
  const start=month%2===0?month-1:month
  return `${start}-${start+1}月`
}

export async function fetchCumulativePoints({period=''}={}){
  if(!process.env.FEISHU_APP_ID||!process.env.FEISHU_APP_SECRET)throw badRequest('未配置飞书应用凭证')
  const accessToken=await token(),directoryToken=await token(),all=await records(accessToken),department=process.env.FEISHU_POINTS_DEPARTMENT||'运营二部',totals=new Map(),details=new Map(),identities=new Map()
  let sourceCount=0
  for(const record of all){
    const f=record.fields||{}
    if(String(f['部门']||'')!==department)continue
    if(period&&String(f['归属月份']||'').trim()!==period)continue
    const quantity=Number(f['发放数量']||0)
    if(!Number.isFinite(quantity))continue
    sourceCount++
    for(const user of usersOf(f['姓名']))if(!identities.has(user.name))identities.set(user.name,user)
    for(const name of namesOf(f['姓名'])){
      totals.set(name,(totals.get(name)||0)+quantity)
      const list=details.get(name)||[]
      list.push({recordId:record.record_id,date:dateText(f['日期']),cardType:String(f['积分卡类型']||''),quantity,reason:String(f['发放事由']||''),issuer:namesOf(f['发放人']).join('、'),period:String(f['归属月份']||''),exchangeStatus:String(f['兑换状态']||''),exchangeReward:String(f['兑换奖励']||''),remark:String(f['备注']||'')})
      details.set(name,list)
    }
  }
  for(const list of details.values())list.sort((a,b)=>String(b.date).localeCompare(String(a.date))||b.quantity-a.quantity)
  const directory=await directoryAvatars(directoryToken),people={}
  await Promise.all([...identities].map(async([name,user])=>{const found=directory.byName.get(name.toLowerCase())||directory.byId.get(user.openId);people[name]={openId:user.openId,avatarUrl:found?.avatarUrl||'',level:found?.level||''}}))
  const avatarCount=Object.values(people).filter(x=>x.avatarUrl).length
  return{department,period,fetchedAt:new Date().toISOString(),sourceCount,totalSourceCount:all.length,totals:[...totals].map(([name,points])=>({name,points})).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name,'zh-CN')),details:Object.fromEntries(details),people,avatarCount,avatarMessage:directory.error?`飞书头像应用未授权：${directory.error}`:`飞书头像应用当前可见 ${directory.visibleCount||0} 人，已同步 ${avatarCount} 个头像`}
}
