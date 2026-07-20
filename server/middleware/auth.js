import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { forbidden } from '../lib/errors.js'

const LOCAL_USERS = {
  admin:    { user_id: 'local-admin',    username: 'admin',    role: 'super_admin', department: '运营部门' },
  manager:  { user_id: 'local-manager',  username: 'manager',  role: 'supervisor',  department: '运营部门' },
  dept1:    { user_id: 'local-dept1',    username: 'dept1',    role: 'employee',    department: '运营一部' },
  dept2:    { user_id: 'local-dept2',    username: 'dept2',    role: 'employee',    department: '运营二部' },
  employee: { user_id: 'local-employee', username: 'employee', role: 'employee',    department: '运营部门' },
}

export function localLogin(username, password) {
  const user = LOCAL_USERS[username]
  const expected = username === 'admin' ? (process.env.LOCAL_ADMIN_PASSWORD || '123456') : (process.env.LOCAL_USER_PASSWORD || '123456')
  if (!user || password !== expected) return null
  return { user, token: jwt.sign(user, config.jwtSecret, { expiresIn: '12h' }) }
}

export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ ok: false, error: '请先登录' })
  try { req.actor = jwt.verify(token, config.jwtSecret); next() }
  catch { res.status(401).json({ ok: false, error: '登录已失效，请重新登录' }) }
}

/* 可选认证：有 token 就解析，没有也继续（用于部门权限隔离） */
export function optionalAuth(req, _res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (token) {
    try { req.actor = jwt.verify(token, config.jwtSecret) } catch { /* token 无效也放行 */ }
  }
  next()
}

export function requireManager(req, _res, next) {
  if (!['super_admin', 'supervisor'].includes(req.actor?.role)) return next(forbidden())
  next()
}
