import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { forbidden } from '../lib/errors.js'

const LOCAL_USERS = {
  admin: { user_id: 'local-admin', username: 'admin', role: 'super_admin', department: '运营部门' },
  manager: { user_id: 'local-manager', username: 'manager', role: 'supervisor', department: '运营部门' },
  employee: { user_id: 'local-employee', username: 'employee', role: 'employee', department: '运营部门' },
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

export function requireManager(req, _res, next) {
  if (!['super_admin', 'supervisor'].includes(req.actor?.role)) return next(forbidden())
  next()
}
