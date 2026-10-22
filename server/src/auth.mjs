import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto'
import { row, run } from './db.mjs'

const SESSION_DAYS = 30
const COOKIE = 'banyue_sid'

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password, salt, expected) {
  const actual = scryptSync(password, salt, 64)
  const target = Buffer.from(expected, 'hex')
  return actual.length === target.length && timingSafeEqual(actual, target)
}

export function createSession(userId) {
  const id = randomBytes(24).toString('hex')
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [id, userId, expires])
  return { id, expires }
}

export function destroySession(sessionId) {
  if (sessionId) run('DELETE FROM sessions WHERE id = ?', [sessionId])
}

export function userFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie ?? '')
  const sid = cookies[COOKIE]
  if (!sid) return null
  const session = row('SELECT * FROM sessions WHERE id = ?', [sid])
  if (!session) return null
  if (session.expires_at < Date.now()) {
    destroySession(sid)
    return null
  }
  const user = row('SELECT id, username, display_name FROM users WHERE id = ?', [session.user_id])
  return user ? { ...user, sessionId: sid } : null
}

export function sessionCookie(sessionId, maxAgeSeconds) {
  return `${COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function parseCookies(header) {
  const out = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

export function newId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 恢复码：四组四位，去掉容易看混的 0/O/1/I */
export function generateRecoveryCode() {
  const bytes = randomBytes(16)
  const chars = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
  return [chars.slice(0, 4).join(''), chars.slice(4, 8).join(''), chars.slice(8, 12).join(''), chars.slice(12, 16).join('')].join('-')
}

export function setRecoveryCode(userId, code) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(code.trim().toUpperCase(), salt, 64).toString('hex')
  run('UPDATE users SET recovery_hash = ?, recovery_salt = ? WHERE id = ?', [hash, salt, userId])
}

export function verifyRecoveryCode(user, code) {
  if (!user?.recovery_hash || !user?.recovery_salt) return false
  const actual = scryptSync(String(code).trim().toUpperCase(), user.recovery_salt, 64)
  const target = Buffer.from(user.recovery_hash, 'hex')
  return actual.length === target.length && timingSafeEqual(actual, target)
}

export function makeUser(username, displayName, password) {
  const { hash, salt } = hashPassword(password)
  const recoveryCode = generateRecoveryCode()
  const recoverySalt = randomBytes(16).toString('hex')
  const recoveryHash = scryptSync(recoveryCode, recoverySalt, 64).toString('hex')
  const user = {
    id: newId('u'),
    username,
    display_name: displayName,
    password_hash: hash,
    salt,
    recovery_hash: recoveryHash,
    recovery_salt: recoverySalt,
    created_at: Date.now(),
  }
  run(
    'INSERT INTO users (id, username, display_name, password_hash, salt, recovery_hash, recovery_salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      user.id,
      user.username,
      user.display_name,
      user.password_hash,
      user.salt,
      user.recovery_hash,
      user.recovery_salt,
      user.created_at,
    ],
  )
  return { id: user.id, username, display_name: displayName, recoveryCode }
}
