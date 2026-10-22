import { createServer } from 'node:http'
import { existsSync, createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { row, rows, run } from './db.mjs'
import {
  clearCookie,
  createSession,
  destroySession,
  makeUser,
  newId,
  sessionCookie,
  userFromRequest,
  verifyPassword,
} from './auth.mjs'

const PORT = Number(process.env.PORT ?? 8787)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, '../web/dist')
const MAX_BODY = 64 * 1024

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
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

async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('invalid json')
  }
}

const publicUser = (user) => ({ id: user.id, username: user.username, displayName: user.display_name })

function requireUser(req, res) {
  const user = userFromRequest(req)
  if (!user) {
    fail(res, 401, '需要登录')
    return null
  }
  return user
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

  const user = makeUser(username, displayName, password)
  const session = createSession(user.id)
  send(res, 201, { user: publicUser({ ...user, display_name: displayName }) }, { 'Set-Cookie': sessionCookie(session.id, 30 * 24 * 3600) })
})

route('POST', '/api/auth/login', async (req, res) => {
  const body = await readBody(req)
  const username = String(body.username ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const user = row('SELECT * FROM users WHERE username = ?', [username])
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    return fail(res, 401, '用户名或密码不对')
  }
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
  if (collection.owner_id !== user.id) return fail(res, 403, '只能删自己的收藏夹')
  run('DELETE FROM collections WHERE id = ?', [params.id])
  send(res, 200, { ok: true })
})

route('POST', '/api/collections/:id/items', async (req, res, params) => {
  const user = requireUser(req, res)
  if (!user) return
  const collection = row('SELECT owner_id FROM collections WHERE id = ?', [params.id])
  if (!collection) return fail(res, 404, '收藏夹不存在')
  if (collection.owner_id !== user.id) return fail(res, 403, '只能往自己的收藏夹里加')
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
  if (collection.owner_id !== user.id) return fail(res, 403, '只能改自己的收藏夹')
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
  if (bookmark.user_id !== user.id) return fail(res, 403, '只能删自己的书签')
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

/* ---------------- 静态文件 ---------------- */

function serveStatic(req, res, url) {
  if (!existsSync(DIST)) return false
  const clean = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(DIST, clean)
  if (!file.startsWith(DIST)) return false
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  if (!existsSync(file)) return false
  const type = MIME[extname(file)] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type })
  createReadStream(file).pipe(res)
  return true
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname.startsWith('/api/')) {
    for (const candidate of routes) {
      if (candidate.method !== req.method) continue
      const match = candidate.regex.exec(url.pathname)
      if (!match) continue
      const params = {}
      candidate.keys.forEach((key, index) => (params[key] = decodeURIComponent(match[index + 1])))
      try {
        await candidate.handler(req, res, params, url)
      } catch (error) {
        fail(res, 400, error.message === 'invalid json' ? '请求格式不对' : '请求失败')
      }
      return
    }
    return fail(res, 404, '接口不存在')
  }

  if (req.method === 'GET' && serveStatic(req, res, url)) return
  fail(res, 404, 'Not Found')
})

server.listen(PORT, () => {
  console.log(`banyue api on http://localhost:${PORT}  (static: ${existsSync(DIST) ? DIST : 'none'})`)
})
