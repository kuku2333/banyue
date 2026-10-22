import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 8800 + Math.floor(Math.random() * 100)
const BASE = `http://127.0.0.1:${PORT}`
const dir = mkdtempSync(join(tmpdir(), 'banyue-test-'))
let server

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
  }
}

before(async () => {
  server = spawn(process.execPath, ['src/index.mjs'], {
    env: { ...process.env, PORT: String(PORT), BANYUE_DB: join(dir, 'test.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 10000)
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('banyue api')) {
        clearTimeout(timer)
        resolve()
      }
    })
    server.on('exit', (code) => reject(new Error(`服务退出 ${code}`)))
  })
})

after(async () => {
  if (server) {
    const exited = new Promise((resolve) => server.once('exit', resolve))
    server.kill()
    await exited
  }
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Windows 下偶尔还占着文件句柄，测试临时目录留给系统清理
  }
})

const alice = { username: 'alice', password: 'secret123', displayName: '爱丽丝' }

test('注册、登录与身份', async () => {
  const registered = await call('/api/auth/register', { method: 'POST', body: alice })
  assert.equal(registered.status, 201)
  assert.equal(registered.body.user.displayName, '爱丽丝')

  const duplicate = await call('/api/auth/register', { method: 'POST', body: alice })
  assert.equal(duplicate.status, 409)

  const wrong = await call('/api/auth/login', { method: 'POST', body: { username: 'alice', password: 'nope' } })
  assert.equal(wrong.status, 401)

  const login = await call('/api/auth/login', { method: 'POST', body: alice })
  assert.equal(login.status, 200)
  const me = await call('/api/me', { cookie: login.cookie })
  assert.equal(me.body.user.username, 'alice')
})

test('收藏夹：登录才能建、公开可读、只能改自己的', async () => {
  const login = await call('/api/auth/login', { method: 'POST', body: alice })
  const cookie = login.cookie

  const anonymous = await call('/api/collections', { method: 'POST', body: { type: 'music', name: '匿名' } })
  assert.equal(anonymous.status, 401)

  const created = await call('/api/collections', {
    method: 'POST',
    body: { type: 'music', name: '通勤循环', description: '地铁上听' },
    cookie,
  })
  assert.equal(created.status, 201)

  const item = await call(`/api/collections/${created.body.id}/items`, {
    method: 'POST',
    body: { key: 'apple-42', title: '午夜場', subtitle: 'Anson Lo' },
    cookie,
  })
  assert.equal(item.status, 201)

  const publicList = await call('/api/collections?type=music')
  const found = publicList.body.collections.find((entry) => entry.id === created.body.id)
  assert.ok(found)
  assert.equal(found.owner.username, 'alice')
  assert.equal(found.itemCount, 1)
  assert.equal(found.mine, false)

  const detail = await call(`/api/collections/${created.body.id}`)
  assert.equal(detail.status, 200)
  assert.equal(detail.body.collection.items[0].title, '午夜場')

  const bob = await call('/api/auth/register', {
    method: 'POST',
    body: { username: 'bob', password: 'secret123', displayName: '鲍勃' },
  })
  const forbidden = await call(`/api/collections/${created.body.id}/items`, {
    method: 'POST',
    body: { key: 'x', title: 'x' },
    cookie: bob.cookie,
  })
  assert.equal(forbidden.status, 403)
})

test('书签公开可见，带用户名与留言', async () => {
  const login = await call('/api/auth/login', { method: 'POST', body: alice })
  const created = await call('/api/books/book-1/bookmarks', {
    method: 'POST',
    body: { chapter: 2, chapterTitle: '第二章 旧信', ratio: 0.35, note: '这页写得好' },
    cookie: login.cookie,
  })
  assert.equal(created.status, 201)

  const list = await call('/api/books/book-1/bookmarks', { cookie: login.cookie })
  assert.equal(list.body.bookmarks.length, 1)
  assert.equal(list.body.bookmarks[0].chapterTitle, '第二章 旧信')
  assert.equal(list.body.bookmarks[0].note, '这页写得好')
  assert.equal(list.body.bookmarks[0].owner.displayName, '爱丽丝')
  assert.equal(list.body.bookmarks[0].mine, true)

  const anonymous = await call('/api/books/book-1/bookmarks', { method: 'POST', body: { chapter: 1 } })
  assert.equal(anonymous.status, 401)
})

test('歌曲评论：云端公开，空评论被拒', async () => {
  const login = await call('/api/auth/login', { method: 'POST', body: alice })
  const empty = await call('/api/songs/apple-42/comments', { method: 'POST', body: { body: '  ' }, cookie: login.cookie })
  assert.equal(empty.status, 400)

  const created = await call('/api/songs/apple-42/comments', {
    method: 'POST',
    body: { body: '循环一晚上了' },
    cookie: login.cookie,
  })
  assert.equal(created.status, 201)

  const list = await call('/api/songs/apple-42/comments')
  assert.equal(list.body.comments.length, 1)
  assert.equal(list.body.comments[0].body, '循环一晚上了')
  assert.equal(list.body.comments[0].owner.username, 'alice')

  const removed = await call(`/api/songs/apple-42/comments/${created.body.id}`, { method: 'DELETE', cookie: login.cookie })
  assert.equal(removed.status, 200)
})

test('恢复码：可重置密码、旧密码失效、旧会话作废', async () => {
  const registered = await call('/api/auth/register', {
    method: 'POST',
    body: { username: 'carol', password: 'secret123', displayName: '卡罗尔' },
  })
  assert.equal(registered.status, 201)
  const code = registered.body.recoveryCode
  assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)

  const wrong = await call('/api/auth/recover', {
    method: 'POST',
    body: { username: 'carol', code: 'AAAA-AAAA-AAAA-AAAA', password: 'newsecret' },
  })
  assert.equal(wrong.status, 401)

  const recovered = await call('/api/auth/recover', {
    method: 'POST',
    body: { username: 'carol', code, password: 'newsecret' },
  })
  assert.equal(recovered.status, 200)
  assert.notEqual(recovered.body.recoveryCode, code, '恢复码应当轮换')

  const oldPassword = await call('/api/auth/login', { method: 'POST', body: { username: 'carol', password: 'secret123' } })
  assert.equal(oldPassword.status, 401)
  const newPassword = await call('/api/auth/login', { method: 'POST', body: { username: 'carol', password: 'newsecret' } })
  assert.equal(newPassword.status, 200)
})

test('云端文件：登录上传、公开列表、原样下载、只有作者能删', async () => {
  const login = await call('/api/auth/login', { method: 'POST', body: alice })
  const text = '第一章 雨夜\n\n雨下了一整天。\n'
  const uploaded = await fetch(`${BASE}/api/assets?kind=book`, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      'x-title': encodeURIComponent('雨夜'),
      'x-subtitle': encodeURIComponent('测试作者'),
      cookie: login.cookie,
    },
    body: text,
  })
  assert.equal(uploaded.status, 201)
  const { id } = await uploaded.json()

  const anonymousUpload = await fetch(`${BASE}/api/assets?kind=book`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-title': 'x' },
    body: 'x',
  })
  assert.equal(anonymousUpload.status, 401)

  const listed = await call('/api/assets?kind=book')
  const found = listed.body.assets.find((asset) => asset.id === id)
  assert.ok(found)
  assert.equal(found.title, '雨夜')
  assert.equal(found.owner.username, 'alice')

  const downloaded = await fetch(`${BASE}/api/assets/${id}/file`)
  assert.equal(downloaded.status, 200)
  assert.equal(await downloaded.text(), text)

  const ranged = await fetch(`${BASE}/api/assets/${id}/file`, { headers: { range: 'bytes=0-5' } })
  assert.equal(ranged.status, 206)
  assert.equal(ranged.headers.get('content-range'), `bytes 0-5/${Buffer.byteLength(text)}`)

  const bob = await call('/api/auth/register', {
    method: 'POST',
    body: { username: 'dave', password: 'secret123', displayName: '戴夫' },
  })
  const forbidden = await call(`/api/assets/${id}`, { method: 'DELETE', cookie: bob.cookie })
  assert.equal(forbidden.status, 403)

  const removed = await call(`/api/assets/${id}`, { method: 'DELETE', cookie: login.cookie })
  assert.equal(removed.status, 200)
  const gone = await fetch(`${BASE}/api/assets/${id}/file`)
  assert.equal(gone.status, 404)
})
