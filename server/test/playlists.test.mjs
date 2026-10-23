import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 8901 + Math.floor(Math.random() * 90)
const BASE = `http://127.0.0.1:${PORT}`
let server
let dir

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'banyue-pl-'))
  server = spawn(process.execPath, ['src/index.mjs'], {
    env: { ...process.env, PORT: String(PORT), BANYUE_DB: join(dir, 'test.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('启动超时')), 10000)
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('banyue api')) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
})

after(async () => {
  server?.kill()
  await new Promise((r) => setTimeout(r, 300))
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    /* Windows 上偶发占用 */
  }
})

async function call(path, opts = {}) {
  const response = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? opts.cookie
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie }
}

test('歌单：创建、加歌、公开可见、私有不外露', async () => {
  const owner = await call('/api/auth/register', {
    method: 'POST',
    body: { username: 'plowner', password: 'secret123', displayName: '歌单主' },
  })
  const other = await call('/api/auth/register', {
    method: 'POST',
    body: { username: 'plother', password: 'secret123', displayName: '路人' },
  })

  const created = await call('/api/playlists', {
    method: 'POST',
    body: { name: '夜里听的', description: '慢歌', isPublic: true },
    cookie: owner.cookie,
  })
  assert.equal(created.status, 201)
  const id = created.body.id

  const added = await call(`/api/playlists/${id}/items`, {
    method: 'POST',
    body: { title: '第一首', artist: '歌手A', hash: 'hash-a' },
    cookie: owner.cookie,
  })
  assert.equal(added.status, 201)
  // 同一首再加一次应冲突
  const again = await call(`/api/playlists/${id}/items`, {
    method: 'POST',
    body: { title: '第一首', artist: '歌手A', hash: 'hash-a' },
    cookie: owner.cookie,
  })
  assert.equal(again.status, 409)

  const detail = await call(`/api/playlists/${id}`, { cookie: owner.cookie })
  assert.equal(detail.status, 200)
  assert.equal(detail.body.playlist.name, '夜里听的')
  assert.equal(detail.body.playlist.mine, true)
  assert.deepEqual(
    detail.body.playlist.items.map((item) => `${item.title}/${item.artist}`),
    ['第一首/歌手A'],
  )

  // 别人能看公开歌单
  const listForOther = await call('/api/playlists', { cookie: other.cookie })
  assert.ok(listForOther.body.playlists.some((item) => item.id === id))

  // 改成私有后，别人看不到也打不开
  await call(`/api/playlists/${id}`, { method: 'PATCH', body: { isPublic: false }, cookie: owner.cookie })
  const listAfterPrivate = await call('/api/playlists', { cookie: other.cookie })
  assert.ok(!listAfterPrivate.body.playlists.some((item) => item.id === id))
  const forbidden = await call(`/api/playlists/${id}`, { cookie: other.cookie })
  assert.equal(forbidden.status, 403)

  // 非本人不能加歌/改歌单
  const notMine = await call(`/api/playlists/${id}/items`, {
    method: 'POST',
    body: { title: '偷加的' },
    cookie: other.cookie,
  })
  assert.equal(notMine.status, 403)
})

test('歌单：别人可以隐藏，隐藏后列表里消失，可以再恢复', async () => {
  const owner = await call('/api/auth/register', {
    method: 'POST',
    body: { username: 'hideowner', password: 'secret123', displayName: '主' },
  })
  const viewer = await call('/api/auth/register', {
    method: 'POST',
    body: { username: 'hideviewer', password: 'secret123', displayName: '看客' },
  })

  const created = await call('/api/playlists', {
    method: 'POST',
    body: { name: '不想看到的歌单', isPublic: true },
    cookie: owner.cookie,
  })
  const id = created.body.id

  // 自己不能隐藏自己的
  const selfHide = await call(`/api/playlists/${id}/hide`, { method: 'POST', cookie: owner.cookie })
  assert.equal(selfHide.status, 400)

  const hidden = await call(`/api/playlists/${id}/hide`, { method: 'POST', cookie: viewer.cookie })
  assert.equal(hidden.status, 200)

  const list = await call('/api/playlists', { cookie: viewer.cookie })
  assert.ok(!list.body.playlists.some((item) => item.id === id), '隐藏后不该出现在列表里')
  assert.ok(list.body.hidden.includes(id))

  const hiddenList = await call('/api/playlists-hidden', { cookie: viewer.cookie })
  assert.deepEqual(
    hiddenList.body.playlists.map((item) => item.id),
    [id],
  )

  const restored = await call(`/api/playlists/${id}/hide`, { method: 'DELETE', cookie: viewer.cookie })
  assert.equal(restored.status, 200)
  const listAgain = await call('/api/playlists', { cookie: viewer.cookie })
  assert.ok(listAgain.body.playlists.some((item) => item.id === id))

  // 主人自己始终看得到
  const ownerList = await call('/api/playlists', { cookie: owner.cookie })
  assert.ok(ownerList.body.playlists.some((item) => item.id === id))
})
