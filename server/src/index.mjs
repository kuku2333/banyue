import { createServer } from 'node:http'
import { existsSync, createReadStream, createWriteStream, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { extname, join, posix, resolve, dirname, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { row, rows, run } from './db.mjs'
import {
  clearCookie,
  contentHash,
  createSession,
  destroySession,
  ensureBuiltinAdmin,
  generateRecoveryCode,
  hashPassword,
  isEnvAdmin,
  makeUser,
  newId,
  sessionCookie,
  setRecoveryCode,
  userFromRequest,
  verifyPassword,
  verifyRecoveryCode,
} from './auth.mjs'
import {
  coverHeaders,
  getPlayInfo,
  isAllowedBiliUrl,
  proxyBiliStream,
  resolveVideo,
  safeFileName,
} from './bilibili.mjs'

const PORT = Number(process.env.PORT ?? 8787)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, '../web/dist')
const FILES_DIR = process.env.BANYUE_FILES_DIR
  ? resolve(process.env.BANYUE_FILES_DIR)
  : resolve(ROOT, 'data/files')
const MAX_BODY = 64 * 1024
const UPLOAD_LIMITS = { book: 50 * 1024 * 1024, track: 40 * 1024 * 1024 }
/** 每个账号的云端总容量（MB），默认 200 */
const QUOTA_BYTES = Math.max(1, Number(process.env.BANYUE_QUOTA_MB ?? 200)) * 1024 * 1024

mkdirSync(FILES_DIR, { recursive: true })

function storageUsed(userId) {
  const rowData = row('SELECT COALESCE(SUM(size), 0) AS used FROM assets WHERE owner_id = ?', [userId])
  return Number(rowData?.used ?? 0)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

function send(res, status, data, headers = {}) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  })
  res.end(body)
}

function fail(res, status, message) {
  send(res, status, { error: message })
}

function sendPlain(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(text)
}

/**
 * decodeURIComponent 遇到 `%`、`%zz` 这类畸形转义会抛 URIError。
 * 之前这个异常会从请求回调里冒出去，变成 unhandledRejection 把整个进程带下去，
 * 所以这里统一兜住，解码失败就当作「非法路径」处理。
 */
function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

async function readBody(req, limit = MAX_BODY) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('invalid json')
  }
}

const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  displayName: user.display_name ?? user.displayName,
  isAdmin: Number(user.is_admin) === 1 || isEnvAdmin(user.username),
})

function canManage(user, ownerId) {
  return Boolean(user) && (user.is_admin || user.id === ownerId)
}

function requireUser(req, res) {
  const user = userFromRequest(req)
  if (!user) {
    fail(res, 401, '需要登录')
    return null
  }
  return user
}

function requireAdmin(req, res) {
  const user = requireUser(req, res)
  if (!user) return null
  if (!user.is_admin) {
    fail(res, 403, '需要管理员权限')
    return null
  }
  return user
}

/* ---------------- 登录限流 ---------------- */

/**
 * 用户名 + 来源 IP 维度的失败计数：scrypt 很慢，但挡不住慢慢试。
 * 10 分钟内错 10 次就先停一会儿，成功登录则清零。
 */
const LOGIN_WINDOW = 10 * 60 * 1000
const LOGIN_MAX_FAILS = 10
const MAX_TRACKED = 5000
const loginFails = new Map()

function loginKey(req, username) {
  return `${req.socket.remoteAddress ?? 'unknown'}|${username}`
}

function loginBlocked(key) {
  const entry = loginFails.get(key)
  if (!entry) return false
  if (Date.now() > entry.resetAt) {
    loginFails.delete(key)
    return false
  }
  return entry.count >= LOGIN_MAX_FAILS
}

function noteLoginFail(key) {
  const now = Date.now()
  const entry = loginFails.get(key)
  if (!entry || now > entry.resetAt) {
    if (loginFails.size >= MAX_TRACKED) {
      // 简单防膨胀：清掉已经过期的，还满就丢掉最早插入的一条
      for (const [key2, item] of loginFails) if (now > item.resetAt) loginFails.delete(key2)
      if (loginFails.size >= MAX_TRACKED) loginFails.delete(loginFails.keys().next().value)
    }
    loginFails.set(key, { count: 1, resetAt: now + LOGIN_WINDOW })
    return
  }
  entry.count += 1
}

/* ---------------- 路由 ---------------- */

const routes = []
function route(method, pattern, handler) {
  const keys = []
  const regex = new RegExp(
    '^' +
      pattern.replace(/:[a-zA-Z]+/g, (match) => {
        keys.push(match.slice(1))
        return '([^/]+)'
      }) +
      '$',
  )
  routes.push({ method, regex, keys, handler })
}

/* 账号 */

route('POST', '/api/auth/register', async (req, res) => {
  const body = await readBody(req)
  const username = String(body.username ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const displayName = String(body.displayName ?? '').trim() || username
  if (!/^[a-z0-9_-]{3,24}$/.test(username)) return fail(res, 400, '用户名需 3-24 位，仅限字母、数字、下划线、连字符')
  if (password.length < 6) return fail(res, 400, '密码至少 6 位')
  if (displayName.length > 24) return fail(res, 400, '昵称最多 24 字')
  if (row('SELECT id FROM users WHERE username = ?', [username])) return fail(res, 409, '这个用户名已被占用')

  let user
  try {
    user = makeUser(username, displayName, password)
  } catch (error) {
    // 同时注册同一个名字时上面的查询会一起通过，交给唯一索引兜底
    if (/UNIQUE/i.test(String(error?.message ?? ''))) return fail(res, 409, '这个用户名已被占用')
    throw error
  }
  const session = createSession(user.id)
  send(res, 201, {
    user: publicUser({ ...user, display_name: displayName }),
    recoveryCode: user.recoveryCode,
  }, { 'Set-Cookie': sessionCookie(session.id, 30 * 24 * 3600) })
})

route('POST', '/api/auth/recover', async (req, res) => {
  const body = await readBody(req)
  const username = String(body.username ?? '').trim().toLowerCase()
  const code = String(body.code ?? '').trim()
  const password = String(body.password ?? '')
  const key = loginKey(req, `recover:${username}`)
  if (loginBlocked(key)) return fail(res, 429, '试太多次了，过十分钟再试')
  const user = row('SELECT * FROM users WHERE username = ?', [username])
  if (!user || !verifyRecoveryCode(user, code)) {
    noteLoginFail(key)
    return fail(res, 401, '用户名或恢复码不对')
  }
  if (password.length < 6) return fail(res, 400, '密码至少 6 位')

  const { hash, salt } = hashPassword(password)
  run('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?', [hash, salt, user.id])
  const recoveryCode = generateRecoveryCode()
  setRecoveryCode(user.id, recoveryCode)
  loginFails.delete(key)
  // 恢复后旧会话全部作废
  run('DELETE FROM sessions WHERE user_id = ?', [user.id])
  send(res, 200, { ok: true, recoveryCode })
})

route('POST', '/api/auth/recovery-code', async (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const recoveryCode = generateRecoveryCode()
  setRecoveryCode(user.id, recoveryCode)
  send(res, 200, { recoveryCode })
})

route('POST', '/api/auth/login', async (req, res) => {
  const body = await readBody(req)
  const username = String(body.username ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const key = loginKey(req, username)
  if (loginBlocked(key)) return fail(res, 429, '输错太多次了，过十分钟再试')
  const user = row('SELECT * FROM users WHERE username = ?', [username])
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    noteLoginFail(key)
    return fail(res, 401, '用户名或密码不对')
  }
  loginFails.delete(key)
  const session = createSession(user.id)
  send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(session.id, 30 * 24 * 3600) })
})

route('POST', '/api/auth/logout', async (req, res) => {
  const user = userFromRequest(req)
  if (user) destroySession(user.sessionId)
  send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() })
})

route('GET', '/api/me', async (req, res) => {
  const user = userFromRequest(req)
  send(res, 200, { user: user ? publicUser(user) : null })
})

/* 收藏夹 */

/* ---------------- 歌单（可公开/私有，可隐藏别人的） ---------------- */

/** 单条歌单的公开形态 */
function playlistShape(item, viewer) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    isPublic: Number(item.is_public) === 1,
    createdAt: item.created_at,
    itemCount: Number(item.item_count ?? 0),
    owner: { username: item.username, displayName: item.display_name },
    mine: viewer ? viewer.username === item.username : false,
  }
}

route('GET', '/api/playlists', async (req, res) => {
  const user = userFromRequest(req)
  // 自己的全部（含私有）+ 别人的公开歌单；但去掉自己隐藏的
  const list = rows(
    `SELECT p.id, p.name, p.description, p.is_public, p.created_at, u.username, u.display_name,
            (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS item_count
     FROM playlists p JOIN users u ON u.id = p.owner_id
     WHERE p.is_public = 1 OR p.owner_id = ?
     ORDER BY p.created_at DESC LIMIT 200`,
    [user?.id ?? ''],
  )
  const hidden = user
    ? rows('SELECT playlist_id FROM playlist_hides WHERE user_id = ?', [user.id]).map((r) => r.playlist_id)
    : []
  const hiddenSet = new Set(hidden)
  send(res, 200, {
    playlists: list
      .filter((item) => !hiddenSet.has(item.id))
      .map((item) => playlistShape(item, user)),
    hidden,
  })
})

route('GET', '/api/playlists/:id', async (req, res, params) => {
  const playlist = row(
    `SELECT p.*, u.username, u.display_name FROM playlists p JOIN users u ON u.id = p.owner_id WHERE p.id = ?`,
    [params.id],
  )
  if (!playlist) return fail(res, 404, '歌单不存在')
  const user = userFromRequest(req)
  const mine = user?.username === playlist.username
  if (Number(playlist.is_public) !== 1 && !mine) return fail(res, 403, '这是别人的私有歌单')
  const items = rows(
    `SELECT id, item_key, title, artist, asset_id, hash, position, created_at
     FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC, created_at ASC`,
    [params.id],
  )
  send(res, 200, {
    playlist: {
      ...playlistShape({ ...playlist, item_count: items.length }, user),
      items: items.map((item) => ({
        id: item.id,
        key: item.item_key,
        title: item.title,
        artist: item.artist,
        assetId: item.asset_id,
        hash: item.hash,
        position: item.position,
      })),
    },
  })
})

route('POST', '/api/playlists', async (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const body = await readBody(req)
  const name = String(body.name ?? '').trim().slice(0, 60)
  if (!name) return fail(res, 400, '歌单名不能为空')
  const description = String(body.description ?? '').trim().slice(0, 200)
  const isPublic = body.isPublic === false ? 0 : 1
  const id = newId('pl')
  run('INSERT INTO playlists (id, owner_id, name, description, is_public, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    id,
    user.id,
    name,
    description,
    isPublic,
    Date.now(),
  ])
  send(res, 201, { id })
})

route('PATCH', '/api/playlists/:id', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const playlist = row('SELECT owner_id FROM playlists WHERE id = ?', [params.id])
  if (!playlist) return fail(res, 404, '歌单不存在')
  if (!canManage(user, playlist.owner_id)) return fail(res, 403, '只能改自己的歌单')
  const body = await readBody(req)
  const sets = []
  const values = []
  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 60)
    if (!name) return fail(res, 400, '歌单名不能为空')
    sets.push('name = ?')
    values.push(name)
  }
  if (typeof body.description === 'string') {
    sets.push('description = ?')
    values.push(body.description.trim().slice(0, 200))
  }
  if (typeof body.isPublic === 'boolean') {
    sets.push('is_public = ?')
    values.push(body.isPublic ? 1 : 0)
  }
  if (!sets.length) return fail(res, 400, '没有要改的内容')
  values.push(params.id)
  run(`UPDATE playlists SET ${sets.join(', ')} WHERE id = ?`, values)
  send(res, 200, { ok: true })
})

route('DELETE', '/api/playlists/:id', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const playlist = row('SELECT owner_id FROM playlists WHERE id = ?', [params.id])
  if (!playlist) return fail(res, 404, '歌单不存在')
  if (!canManage(user, playlist.owner_id)) return fail(res, 403, '只能删自己的歌单')
  run('DELETE FROM playlists WHERE id = ?', [params.id])
  send(res, 200, { ok: true })
})

route('POST', '/api/playlists/:id/items', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const playlist = row('SELECT owner_id FROM playlists WHERE id = ?', [params.id])
  if (!playlist) return fail(res, 404, '歌单不存在')
  if (!canManage(user, playlist.owner_id)) return fail(res, 403, '只能往自己的歌单里加歌')
  const body = await readBody(req)
  const title = String(body.title ?? '').trim().slice(0, 120)
  if (!title) return fail(res, 400, '缺少歌名')
  const artist = String(body.artist ?? '').trim().slice(0, 80)
  const key = String(body.key ?? body.assetId ?? title).trim().slice(0, 200)
  const assetId = String(body.assetId ?? '').trim().slice(0, 80)
  const hash = String(body.hash ?? '').trim().slice(0, 64)
  const max = row('SELECT COALESCE(MAX(position), -1) AS max FROM playlist_items WHERE playlist_id = ?', [params.id])
  try {
    run(
      'INSERT INTO playlist_items (id, playlist_id, item_key, title, artist, asset_id, hash, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [newId('pli'), params.id, key, title, artist, assetId, hash, Number(max?.max ?? -1) + 1, Date.now()],
    )
  } catch {
    return fail(res, 409, '这首歌已经在歌单里了')
  }
  send(res, 201, { ok: true })
})

route('DELETE', '/api/playlists/:id/items/:itemId', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const playlist = row('SELECT owner_id FROM playlists WHERE id = ?', [params.id])
  if (!playlist) return fail(res, 404, '歌单不存在')
  if (!canManage(user, playlist.owner_id)) return fail(res, 403, '只能改自己的歌单')
  run('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?', [params.itemId, params.id])
  send(res, 200, { ok: true })
})

/** 隐藏 / 取消隐藏别人的歌单（只影响自己的列表） */
route('POST', '/api/playlists/:id/hide', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const playlist = row('SELECT owner_id FROM playlists WHERE id = ?', [params.id])
  if (!playlist) return fail(res, 404, '歌单不存在')
  if (playlist.owner_id === user.id) return fail(res, 400, '不用隐藏自己的歌单')
  run('INSERT OR REPLACE INTO playlist_hides (user_id, playlist_id, created_at) VALUES (?, ?, ?)', [
    user.id,
    params.id,
    Date.now(),
  ])
  send(res, 200, { ok: true })
})

route('DELETE', '/api/playlists/:id/hide', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  run('DELETE FROM playlist_hides WHERE user_id = ? AND playlist_id = ?', [user.id, params.id])
  send(res, 200, { ok: true })
})

/** 我的隐藏歌单列表（用于「恢复显示」） */
route('GET', '/api/playlists-hidden', async (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const list = rows(
    `SELECT p.id, p.name, u.username, u.display_name
     FROM playlist_hides h JOIN playlists p ON p.id = h.playlist_id JOIN users u ON u.id = p.owner_id
     WHERE h.user_id = ? ORDER BY h.created_at DESC`,
    [user.id],
  )
  send(res, 200, {
    playlists: list.map((item) => ({
      id: item.id,
      name: item.name,
      owner: { username: item.username, displayName: item.display_name },
    })),
  })
})

route('GET', '/api/collections', async (req, res, _params, url) => {
  const type = url.searchParams.get('type')
  const params = []
  let where = ''
  if (type === 'music' || type === 'books') {
    where = 'WHERE c.type = ?'
    params.push(type)
  }
  const list = rows(
    `SELECT c.id, c.type, c.name, c.description, c.created_at, u.username, u.display_name,
            (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = c.id) AS item_count
     FROM collections c JOIN users u ON u.id = c.owner_id
     ${where}
     ORDER BY c.created_at DESC LIMIT 200`,
    params,
  )
  const user = userFromRequest(req)
  send(res, 200, {
    collections: list.map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name,
      description: item.description,
      createdAt: item.created_at,
      itemCount: item.item_count,
      owner: { username: item.username, displayName: item.display_name },
      mine: user?.id === undefined ? false : item.username === user.username,
    })),
  })
})

route('GET', '/api/collections/:id', async (req, res, params) => {
  const collection = row(
    `SELECT c.*, u.username, u.display_name FROM collections c JOIN users u ON u.id = c.owner_id WHERE c.id = ?`,
    [params.id],
  )
  if (!collection) return fail(res, 404, '收藏夹不存在')
  const items = rows(
    `SELECT id, item_key, title, subtitle, created_at FROM collection_items WHERE collection_id = ? ORDER BY created_at ASC`,
    [params.id],
  )
  const user = userFromRequest(req)
  send(res, 200, {
    collection: {
      id: collection.id,
      type: collection.type,
      name: collection.name,
      description: collection.description,
      createdAt: collection.created_at,
      owner: { username: collection.username, displayName: collection.display_name },
      mine: user?.username === collection.username,
      items: items.map((item) => ({
        id: item.id,
        key: item.item_key,
        title: item.title,
        subtitle: item.subtitle,
        createdAt: item.created_at,
      })),
    },
  })
})

route('POST', '/api/collections', async (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const body = await readBody(req)
  const type = body.type === 'books' ? 'books' : body.type === 'music' ? 'music' : null
  const name = String(body.name ?? '').trim()
  const description = String(body.description ?? '').trim()
  if (!type) return fail(res, 400, '类型只能是 music 或 books')
  if (name.length < 1 || name.length > 40) return fail(res, 400, '收藏夹名字 1-40 字')
  if (description.length > 200) return fail(res, 400, '简介最多 200 字')
  const id = newId('c')
  run('INSERT INTO collections (id, owner_id, type, name, description, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    id,
    user.id,
    type,
    name,
    description,
    Date.now(),
  ])
  send(res, 201, { id })
})

route('DELETE', '/api/collections/:id', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const collection = row('SELECT owner_id FROM collections WHERE id = ?', [params.id])
  if (!collection) return fail(res, 404, '收藏夹不存在')
  if (!canManage(user, collection.owner_id)) return fail(res, 403, '没有权限')
  run('DELETE FROM collections WHERE id = ?', [params.id])
  send(res, 200, { ok: true })
})

route('POST', '/api/collections/:id/items', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const collection = row('SELECT owner_id FROM collections WHERE id = ?', [params.id])
  if (!collection) return fail(res, 404, '收藏夹不存在')
  if (!canManage(user, collection.owner_id)) return fail(res, 403, '只能往自己的收藏夹里加')
  const body = await readBody(req)
  const key = String(body.key ?? '').trim()
  const title = String(body.title ?? '').trim()
  const subtitle = String(body.subtitle ?? '').trim()
  if (!key || !title) return fail(res, 400, '缺少条目信息')
  run(
    'INSERT OR IGNORE INTO collection_items (id, collection_id, item_key, title, subtitle, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [newId('i'), params.id, key.slice(0, 200), title.slice(0, 200), subtitle.slice(0, 200), Date.now()],
  )
  send(res, 201, { ok: true })
})

route('DELETE', '/api/collections/:id/items/:itemId', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const collection = row('SELECT owner_id FROM collections WHERE id = ?', [params.id])
  if (!collection) return fail(res, 404, '收藏夹不存在')
  if (!canManage(user, collection.owner_id)) return fail(res, 403, '只能改自己的收藏夹')
  run('DELETE FROM collection_items WHERE id = ? AND collection_id = ?', [params.itemId, params.id])
  send(res, 200, { ok: true })
})

/* 书签（公开，带评论） */

route('GET', '/api/books/:key/bookmarks', async (req, res, params) => {
  const list = rows(
    `SELECT b.id, b.chapter, b.chapter_title, b.ratio, b.note, b.created_at, u.username, u.display_name
     FROM bookmarks b JOIN users u ON u.id = b.user_id
     WHERE b.book_key = ? ORDER BY b.chapter ASC, b.ratio ASC LIMIT 500`,
    [params.key],
  )
  const user = userFromRequest(req)
  send(res, 200, {
    bookmarks: list.map((item) => ({
      id: item.id,
      chapter: item.chapter,
      chapterTitle: item.chapter_title,
      ratio: item.ratio,
      note: item.note,
      createdAt: item.created_at,
      owner: { username: item.username, displayName: item.display_name },
      mine: user?.username === item.username,
    })),
  })
})

route('POST', '/api/books/:key/bookmarks', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const body = await readBody(req)
  const chapter = Number(body.chapter ?? 0)
  const ratio = Number(body.ratio ?? 0)
  const note = String(body.note ?? '').trim().slice(0, 500)
  const chapterTitle = String(body.chapterTitle ?? '').trim().slice(0, 120)
  if (!Number.isFinite(chapter) || chapter < 0) return fail(res, 400, '章节参数不对')
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) return fail(res, 400, '阅读位置参数不对')
  const id = newId('b')
  run(
    'INSERT INTO bookmarks (id, book_key, user_id, chapter, chapter_title, ratio, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, params.key.slice(0, 200), user.id, Math.floor(chapter), chapterTitle, ratio, note, Date.now()],
  )
  send(res, 201, { id })
})

route('DELETE', '/api/bookmarks/:id', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const bookmark = row('SELECT user_id FROM bookmarks WHERE id = ?', [params.id])
  if (!bookmark) return fail(res, 404, '书签不存在')
  if (!canManage(user, bookmark.user_id)) return fail(res, 403, '只能删自己的书签')
  run('DELETE FROM bookmarks WHERE id = ?', [params.id])
  send(res, 200, { ok: true })
})

/* 歌曲评论（云端歌才有） */

route('GET', '/api/songs/:key/comments', async (req, res, params) => {
  const list = rows(
    `SELECT c.id, c.body, c.created_at, u.username, u.display_name
     FROM song_comments c JOIN users u ON u.id = c.user_id
     WHERE c.song_key = ? ORDER BY c.created_at DESC LIMIT 200`,
    [params.key],
  )
  const user = userFromRequest(req)
  send(res, 200, {
    comments: list.map((item) => ({
      id: item.id,
      body: item.body,
      createdAt: item.created_at,
      owner: { username: item.username, displayName: item.display_name },
      mine: user?.username === item.username,
    })),
  })
})

route('POST', '/api/songs/:key/comments', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const body = await readBody(req)
  const text = String(body.body ?? '').trim()
  if (text.length < 1) return fail(res, 400, '评论不能为空')
  if (text.length > 500) return fail(res, 400, '评论最多 500 字')
  const id = newId('m')
  run('INSERT INTO song_comments (id, song_key, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    params.key.slice(0, 200),
    user.id,
    text,
    Date.now(),
  ])
  send(res, 201, { id })
})

route('DELETE', '/api/songs/:key/comments/:id', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const comment = row('SELECT user_id FROM song_comments WHERE id = ? AND song_key = ?', [params.id, params.key])
  if (!comment) return fail(res, 404, '评论不存在')
  if (!canManage(user, comment.user_id)) return fail(res, 403, '只能删自己的评论')
  run('DELETE FROM song_comments WHERE id = ?', [params.id])
  send(res, 200, { ok: true })
})

/* 段落评论（小说阅读器：某一段右键/长按评论，公开可见） */

route('GET', '/api/books/:key/paragraphs/:chapter/comments', async (req, res, params) => {
  const list = rows(
    `SELECT p.id, p.paragraph, p.body, p.created_at, u.username, u.display_name
     FROM paragraph_comments p JOIN users u ON u.id = p.user_id
     WHERE p.book_key = ? AND p.chapter = ? ORDER BY p.paragraph ASC, p.created_at ASC LIMIT 1000`,
    [params.key, Number(params.chapter) || 0],
  )
  const user = userFromRequest(req)
  send(res, 200, {
    comments: list.map((item) => ({
      id: item.id,
      paragraph: item.paragraph,
      body: item.body,
      createdAt: item.created_at,
      owner: { username: item.username, displayName: item.display_name },
      mine: user?.username === item.username,
    })),
  })
})

route('POST', '/api/books/:key/paragraphs/:chapter/comments', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const body = await readBody(req)
  const text = String(body.body ?? '').trim()
  const paragraph = Number(body.paragraph)
  if (text.length < 1) return fail(res, 400, '评论不能为空')
  if (text.length > 500) return fail(res, 400, '评论最多 500 字')
  if (!Number.isInteger(paragraph) || paragraph < 0) return fail(res, 400, '段落位置不对')
  const id = newId('pc')
  run(
    'INSERT INTO paragraph_comments (id, book_key, chapter, paragraph, user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, params.key.slice(0, 200), Number(params.chapter) || 0, paragraph, user.id, text, Date.now()],
  )
  send(res, 201, { id })
})

route('DELETE', '/api/paragraph-comments/:id', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const comment = row('SELECT user_id FROM paragraph_comments WHERE id = ?', [params.id])
  if (!comment) return fail(res, 404, '评论不存在')
  if (!canManage(user, comment.user_id)) return fail(res, 403, '只能删自己的评论')
  run('DELETE FROM paragraph_comments WHERE id = ?', [params.id])
  send(res, 200, { ok: true })
})

/* 云端文件（书 / 音乐） */

const EXT_BY_MIME = {
  'text/plain': '.txt',
  'text/markdown': '.md',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/webm': '.webm',
}

/** 客户端字节能存哪些 MIME；'text/html' 之类一律落成纯文本，避免同源脚本执行 */
function uploadMime(kind, header) {
  const raw = String(header ?? '').split(';')[0].trim().toLowerCase()
  if (kind === 'book') return raw === 'text/markdown' || raw === 'text/x-markdown' ? 'text/markdown' : 'text/plain'
  return /^audio\/[a-z0-9.+-]+$/.test(raw) ? raw : 'application/octet-stream'
}

/** 只接受已知扩展名，避免文件名里带奇怪的东西被拼进磁盘路径 */
function safeExt(filename) {
  const ext = extname(String(filename ?? '')).toLowerCase()
  return /^\.[a-z0-9]{1,7}$/.test(ext) ? ext : ''
}

route('GET', '/api/storage', async (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const used = storageUsed(user.id)
  send(res, 200, { used, quota: QUOTA_BYTES })
})

route('GET', '/api/assets', async (req, res, _params, url) => {
  const kind = url.searchParams.get('kind') === 'track' ? 'track' : 'book'
  const list = rows(
    `SELECT a.id, a.kind, a.title, a.subtitle, a.size, a.mime, a.hash, a.cover, a.created_at, u.username, u.display_name
     FROM assets a JOIN users u ON u.id = a.owner_id
     WHERE a.kind = ? ORDER BY a.created_at DESC LIMIT 300`,
    [kind],
  )
  const user = userFromRequest(req)
  send(res, 200, {
    assets: list.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle,
      size: item.size,
      mime: item.mime,
      hash: item.hash ?? '',
      cover: item.cover ?? '',
      createdAt: item.created_at,
      owner: { username: item.username, displayName: item.display_name },
      mine: user?.username === item.username,
    })),
  })
})

route('POST', '/api/assets', async (req, res, _params, url) => {
  const user = requireUser(req, res)
  if (!user) return
  const kind = url.searchParams.get('kind')
  if (kind !== 'book' && kind !== 'track') return fail(res, 400, 'kind 只能是 book 或 track')
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared && declared > UPLOAD_LIMITS[kind]) {
    return fail(res, 413, `文件超过上限（${kind === 'book' ? '50MB' : '40MB'}）`)
  }

  const used = storageUsed(user.id)
  if (declared && used + declared > QUOTA_BYTES) {
    const left = Math.max(0, QUOTA_BYTES - used)
    return fail(
      res,
      413,
      `云端空间不够：已用 ${(used / 1048576).toFixed(1)}MB / ${(QUOTA_BYTES / 1048576).toFixed(0)}MB，还剩 ${(left / 1048576).toFixed(1)}MB`,
    )
  }
  const title = safeDecode(String(req.headers['x-title'] ?? ''))?.trim().slice(0, 120) ?? ''
  const subtitle = safeDecode(String(req.headers['x-subtitle'] ?? ''))?.trim().slice(0, 120) ?? ''
  if (!title) return fail(res, 400, '缺少标题')

  const hash = (safeDecode(String(req.headers['x-hash'] ?? '')) ?? '').trim().slice(0, 64)
  // 可选封面：前端压成小图 dataURL 传过来（限制体积，避免被当图床）
  const coverRaw = (safeDecode(String(req.headers['x-cover'] ?? '')) ?? '').trim()
  const cover = /^data:image\/(jpeg|png|webp);base64,/i.test(coverRaw) && coverRaw.length <= 600_000 ? coverRaw : ''
  // 同一用户上传过同一内容指纹的，直接跳过，不再落盘、不占配额
  if (hash) {
    const existed = row('SELECT id, cover FROM assets WHERE owner_id = ? AND kind = ? AND hash = ?', [user.id, kind, hash])
    if (existed) {
      // 之前没封面、这次带了，就补上（不重复占空间，也符合「勾选封面」的预期）
      if (cover && !existed.cover) run('UPDATE assets SET cover = ? WHERE id = ?', [cover, existed.id])
      return send(res, 200, { duplicate: true, id: existed.id })
    }
  }

  const mime = uploadMime(kind, req.headers['content-type'])
  const fallbackExt = safeExt(safeDecode(String(req.headers['x-filename'] ?? '')) ?? '')
  const ext = EXT_BY_MIME[mime] ?? (fallbackExt || '.bin')
  const id = newId('a')
  const storedName = `${id}${ext}`
  const temp = join(FILES_DIR, `${storedName}.part`)
  const target = join(FILES_DIR, storedName)
  const maxBytes = Math.max(1, Math.min(UPLOAD_LIMITS[kind], QUOTA_BYTES - used))
  let written = 0

  try {
    // 有的客户端不带 Content-Length，边写边计数，超限立刻中断
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        written += chunk.length
        if (written > maxBytes) {
          callback(new Error('TOO_LARGE'))
          return
        }
        callback(null, chunk)
      },
    })
    await pipeline(req, limiter, createWriteStream(temp))
    if (written === 0) {
      unlinkSync(temp)
      return fail(res, 400, '文件是空的')
    }
    // 并发上传时预检查会同时通过，落盘后再按实际用量复核一次
    if (storageUsed(user.id) + written > QUOTA_BYTES) {
      unlinkSync(temp)
      return fail(res, 413, '云端空间不够了，删掉一些旧文件再试')
    }
    renameSync(temp, target)
  } catch (error) {
    try {
      unlinkSync(temp)
    } catch {
      // 临时文件可能还没建出来
    }
    console.warn('[upload] failed', { kind, declared, written, reason: error.message })
    return fail(res, 413, '文件超过可用空间或大小上限')
  }

  // 客户端没传指纹时，服务端按落盘内容补一份——老数据/漏传 hash 的客户端也不漏判
  const finalHash = hash || contentHash(target)
  if (finalHash) {
    const existed = row('SELECT id FROM assets WHERE owner_id = ? AND kind = ? AND hash = ?', [user.id, kind, finalHash])
    if (existed) {
      unlinkSync(target)
      return send(res, 200, { duplicate: true, id: existed.id })
    }
  }

  run(
    'INSERT INTO assets (id, owner_id, kind, title, subtitle, size, mime, stored_name, hash, cover, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, user.id, kind, title, subtitle, written, mime, storedName, finalHash, cover, Date.now()],
  )
  send(res, 201, { id, size: written })
})

/** 只认单段 Range：`bytes=a-b` / `bytes=a-` / `bytes=-n`；返回 null 表示忽略 */
function parseRange(header, total) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim())
  if (!match) return null
  const [, rawStart = '', rawEnd = ''] = match
  if (!rawStart && !rawEnd) return null
  let start
  let end
  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, total - suffix)
    end = total - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : total - 1
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    if (start > end || start >= total) return 'unsatisfiable'
  }
  return { start, end: Math.min(end, total - 1) }
}

route('GET', '/api/assets/:id/file', async (req, res, params) => {
  const asset = row('SELECT * FROM assets WHERE id = ?', [params.id])
  if (!asset) return fail(res, 404, '文件不存在')
  const file = join(FILES_DIR, asset.stored_name)
  if (!existsSync(file)) return fail(res, 410, '文件已丢失')
  const total = statSync(file).size
  const mime = uploadMime(asset.kind, asset.mime)
  const playable = mime.startsWith('audio/')
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=86400',
  }
  // 不能内联渲染的东西一律当附件下载：否则上传的 HTML/SVG 会在本站域名下执行
  if (!playable) {
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(asset.title + extname(asset.stored_name))}`
  }

  const range = req.headers.range
  if (range) {
    const parsed = parseRange(range, total)
    if (parsed === 'unsatisfiable') {
      res.writeHead(416, { 'Content-Range': `bytes */${total}`, 'X-Content-Type-Options': 'nosniff' })
      return res.end()
    }
    if (parsed) {
      const { start, end } = parsed
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': end - start + 1,
      })
      createReadStream(file, { start, end }).pipe(res)
      return
    }
  }
  res.writeHead(200, { ...headers, 'Content-Length': total })
  createReadStream(file).pipe(res)
})

route('DELETE', '/api/assets/:id', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const asset = row('SELECT owner_id, stored_name FROM assets WHERE id = ?', [params.id])
  if (!asset) return fail(res, 404, '文件不存在')
  if (!canManage(user, asset.owner_id)) return fail(res, 403, '只能删自己上传的文件')
  run('DELETE FROM assets WHERE id = ?', [params.id])
  try {
    unlinkSync(join(FILES_DIR, asset.stored_name))
  } catch {
    // 文件可能已不在
  }
  send(res, 200, { ok: true })
})

/* 文章隐藏（管理员） */

route('GET', '/api/hidden-posts', async (_req, res) => {
  const list = rows('SELECT slug, hidden_at FROM hidden_posts ORDER BY hidden_at DESC')
  send(res, 200, { posts: list.map((item) => ({ slug: item.slug, hiddenAt: item.hidden_at })) })
})

route('POST', '/api/posts/:slug/hide', async (req, res, params) => {
  const admin = requireAdmin(req, res)
  if (!admin) return
  run('INSERT OR REPLACE INTO hidden_posts (slug, hidden_by, hidden_at) VALUES (?, ?, ?)', [
    params.slug.slice(0, 200),
    admin.id,
    Date.now(),
  ])
  send(res, 200, { ok: true })
})

route('DELETE', '/api/posts/:slug/hide', async (req, res, params) => {
  const admin = requireAdmin(req, res)
  if (!admin) return
  run('DELETE FROM hidden_posts WHERE slug = ?', [params.slug])
  send(res, 200, { ok: true })
})

/* ---------------- B站解析与流代理 ---------------- */

route('POST', '/api/bilibili/resolve', async (req, res) => {
  const body = await readBody(req)
  try {
    const info = await resolveVideo(body.url)
    send(res, 200, info)
  } catch (error) {
    fail(res, 400, error.message)
  }
})

route('GET', '/api/bilibili/playinfo', async (req, res, _params, url) => {
  const aid = Number(url.searchParams.get('aid'))
  const cid = Number(url.searchParams.get('cid'))
  if (!aid || !cid) return fail(res, 400, '缺少 aid / cid')
  try {
    const info = await getPlayInfo(aid, cid)
    send(res, 200, info)
  } catch (error) {
    fail(res, 502, error.message)
  }
})

/** 流代理：视频/音频直链带 Referer 抓取，透传 Range 便于播放器拖动 */
route('GET', '/api/bilibili/stream', async (req, res, _params, url) => {
  const target = url.searchParams.get('url')
  if (!target) return fail(res, 400, '缺少 url')
  if (!isAllowedBiliUrl(target)) return fail(res, 403, '只允许代理 B站 媒体地址')
  const range = req.headers.range
  let upstream
  try {
    upstream = await proxyBiliStream(target, range)
  } catch (error) {
    return fail(res, 502, error.message)
  }
  const headers = {
    'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  }
  const length = upstream.headers.get('content-length')
  const contentRange = upstream.headers.get('content-range')
  if (length) headers['content-length'] = length
  if (contentRange) headers['content-range'] = contentRange
  // 带 download=1 时按附件下载（文件名由 filename 参数给出）
  if (url.searchParams.get('download') === '1') {
    const title = url.searchParams.get('title') ?? 'bilibili'
    const ext = url.searchParams.get('ext') ?? '.mp4'
    headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(title, ext))}`
  }
  res.writeHead(upstream.status, headers)
  if (!upstream.body) return res.end()
  const reader = upstream.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
  } catch {
    // 客户端提前断开（切歌、拖进度）时上游流会抛错，忽略
  } finally {
    res.end()
  }
})

/** 封面代理：B站图片有防盗链，不代理会 403 */
route('GET', '/api/bilibili/cover', async (req, res, _params, url) => {
  const target = url.searchParams.get('url')
  if (!target || !isAllowedBiliUrl(target)) return fail(res, 400, '封面地址不合法')
  try {
    const upstream = await fetch(target, { headers: coverHeaders() })
    if (!upstream.ok) return fail(res, 502, `封面抓取失败 ${upstream.status}`)
    res.writeHead(200, {
      'content-type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'public, max-age=86400',
    })
    const buffer = Buffer.from(await upstream.arrayBuffer())
    res.end(buffer)
  } catch (error) {
    fail(res, 502, error.message)
  }
})

/** 改云端文件的标题/歌手（仅作者或管理员） */
route('PATCH', '/api/assets/:id', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const asset = row('SELECT owner_id FROM assets WHERE id = ?', [params.id])
  if (!asset) return fail(res, 404, '文件不存在')
  if (!canManage(user, asset.owner_id)) return fail(res, 403, '只能改自己上传的文件')
  const body = await readBody(req)
  const sets = []
  const values = []
  if (typeof body.title === 'string') {
    const title = body.title.trim().slice(0, 120)
    if (!title) return fail(res, 400, '标题不能为空')
    sets.push('title = ?')
    values.push(title)
  }
  if (typeof body.artist === 'string') {
    sets.push('subtitle = ?')
    values.push(body.artist.trim().slice(0, 120))
  }
  if (!sets.length) return fail(res, 400, '没有要改的内容')
  values.push(params.id)
  run(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`, values)
  send(res, 200, { ok: true })
})

/** 单独设封面：dataURL 体积大，放 body 而不是请求头（header 有 16KB 上限） */
route('POST', '/api/assets/:id/cover', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const asset = row('SELECT owner_id FROM assets WHERE id = ?', [params.id])
  if (!asset) return fail(res, 404, '文件不存在')
  if (!canManage(user, asset.owner_id)) return fail(res, 403, '只能改自己上传的文件')
  // 封面是 dataURL，比普通 JSON 大得多
  let body
  try {
    body = await readBody(req, 512 * 1024)
  } catch {
    return fail(res, 413, '封面太大了（超过 512KB）')
  }
  const cover = String(body.cover ?? '').trim()
  // 空字符串表示清空封面
  if (cover && !/^data:image\/(jpeg|png|webp);base64,/i.test(cover)) return fail(res, 400, '封面格式不对')
  if (cover.length > 600_000) return fail(res, 413, '封面太大了')
  run('UPDATE assets SET cover = ? WHERE id = ?', [cover, params.id])
  send(res, 200, { ok: true })
})

/** 下载地址：给出建议文件名（前端用 <a download> 触发保存） */
route('GET', '/api/bilibili/name', async (_req, res, _params, url) => {
  const title = url.searchParams.get('title') ?? ''
  const ext = url.searchParams.get('ext') ?? '.mp4'
  send(res, 200, { filename: safeFileName(title, ext) })
})

/* ---------------- 静态文件 ---------------- */

/** 认得出来的静态资源后缀：这些找不到就老老实实 404，不回退成 index.html */
const STATIC_EXT = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.map',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.txt',
  '.webmanifest',
])

function serveStatic(req, res, url) {
  if (!existsSync(DIST)) return false
  const decoded = safeDecode(url.pathname)
  if (decoded === null) {
    sendPlain(res, 400, 'Bad Request')
    return true
  }
  // 统一成 posix 再 normalize：Windows 下反斜杠同样是分隔符，先抹平再判断越界
  const relative = posix.normalize(decoded.replace(/\\/g, '/'))
  if (relative === '..' || relative.startsWith('../')) {
    sendPlain(res, 403, 'Forbidden')
    return true
  }
  let file = join(DIST, relative)
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    sendPlain(res, 403, 'Forbidden')
    return true
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (STATIC_EXT.has(extname(file).toLowerCase())) {
      sendPlain(res, 404, 'Not Found')
      return true
    }
    file = join(DIST, 'index.html')
  }
  if (!existsSync(file)) {
    sendPlain(res, 404, 'Not Found')
    return true
  }

  const ext = extname(file).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    // 构建产物带哈希可以缓存，HTML 每次都回源，避免发版后拿到旧页面
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  })
  createReadStream(file).pipe(res)
  return true
}

async function handleRequest(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname.startsWith('/api/')) {
    for (const candidate of routes) {
      if (candidate.method !== req.method) continue
      const match = candidate.regex.exec(url.pathname)
      if (!match) continue
      const params = {}
      candidate.keys.forEach((key, index) => {
        const raw = match[index + 1] ?? ''
        params[key] = safeDecode(raw) ?? raw
      })
      try {
        await candidate.handler(req, res, params, url)
      } catch (error) {
        console.warn('[api] handler failed', { path: url.pathname, reason: error.message })
        if (res.headersSent) {
          res.end()
        } else {
          fail(res, 400, error.message === 'invalid json' ? '请求格式不对' : '请求失败')
        }
      }
      return
    }
    return fail(res, 404, '接口不存在')
  }

  if (req.method === 'GET' && serveStatic(req, res, url)) return
  fail(res, 404, 'Not Found')
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    // 兜底：任何没被接住的异常都不该让整个进程退出
    console.error('[request] unhandled', error)
    if (res.headersSent) res.end()
    else fail(res, 500, '服务器开小差了')
  })
})

const builtin = ensureBuiltinAdmin()
server.listen(PORT, () => {
  console.log(`banyue api on http://localhost:${PORT}  (static: ${existsSync(DIST) ? DIST : 'none'})`)
  if (builtin) {
    console.log(`内置管理员：${builtin.username}${builtin.created ? '（已创建）' : '（已确保可登录）'}`)
  }
})

// 过期会话只会在被访问时删除，长期运行会越攒越多；定期清一次
setInterval(() => {
  try {
    run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()])
  } catch (error) {
    console.warn('[sessions] sweep failed', error.message)
  }
}, 6 * 60 * 60 * 1000).unref()
