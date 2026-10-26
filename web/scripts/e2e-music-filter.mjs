// 听歌页：本地歌单搜索过滤。往 IndexedDB 注入几首本地曲目，验证过滤。
import { spawn } from 'node:child_process'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)[0]

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
  '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', 'dsh-music-' + Date.now()),
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const endpoint = await new Promise((res, rej) => {
  let b = ''
  const t = setTimeout(() => rej(new Error('timeout')), 15000)
  browser.stderr.on('data', (c) => {
    b += String(c)
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(b)
    if (m) { clearTimeout(t); res(new URL(m[1])) }
  })
})

const targets = await (await fetch(`http://127.0.0.1:${endpoint.port}/json/list`)).json()
const pg = targets.find((t) => t.type === 'page')
const ws = new WebSocket(pg.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

let id = 0
const pend = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data))
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
})
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id
    pend.set(i, (x) => (x.error ? rej(new Error(x.error.message)) : res(x.result)))
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (expr) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  })
  if (exceptionDetails) return 'ERR:' + exceptionDetails.text
  return result.value
}

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

await send('Page.navigate', { url: `${BASE}/music` })
await wait(2500)

// 注入本地曲目到 banyue-reader 的 tracks 表
await ev(`
(async () => {
  const req = indexedDB.open('banyue-reader')
  const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
  const tx = db.transaction('tracks', 'readwrite')
  const store = tx.objectStore('tracks')
  const now = Date.now()
  const seed = [
    { id: 't1', title: '晴天', artist: '周杰伦', hash: 'h1', fingerprint: 'f1', createdAt: now - 3000, size: 100, duration: 10, format: 'mp3' },
    { id: 't2', title: '稻香', artist: '周杰伦', hash: 'h2', fingerprint: 'f2', createdAt: now - 2000, size: 100, duration: 10, format: 'mp3' },
    { id: 't3', title: '海阔天空', artist: 'Beyond', hash: 'h3', fingerprint: 'f3', createdAt: now - 1000, size: 100, duration: 10, format: 'mp3' },
  ]
  await Promise.all(seed.map((t) => new Promise((res) => { const r = store.put(t); r.onsuccess = () => res() })))
  await new Promise((res) => { tx.oncomplete = res })
})()
`)
await wait(500)
await send('Page.navigate', { url: `${BASE}/music` })
await wait(2600)

// 切到「本地」tab（默认可能不在）
await ev(`[...document.querySelectorAll('.tabs a, .chips a, [role=tab]')].find(a => a.textContent.includes('本地'))?.click()`)
await wait(600)

const before = await ev(`[...document.querySelectorAll('.record')].length`)
console.log('  注入后卡片数:', before)

// 找过滤输入框
const hasInput = await ev(`!!document.querySelector('.filter-input')`)
check('本地歌单有搜索框', hasInput)

// 输入「周杰伦」
await ev(`(() => { const el = document.querySelector('.filter-input'); el.value = '周杰伦'; el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
await wait(400)
const jay = await ev(`[...document.querySelectorAll('.record')].length`)
check('按歌手过滤只剩 2 首', jay === 2, `${jay} 首`)

// 输入「海阔」
await ev(`(() => { const el = document.querySelector('.filter-input'); el.value = '海阔'; el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
await wait(400)
const sea = await ev(`[...document.querySelectorAll('.record')].length`)
check('按歌名过滤只剩 1 首', sea === 1, `${sea} 首`)

// 清空
await ev(`(() => { const el = document.querySelector('.filter-input'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
await wait(400)
const cleared = await ev(`[...document.querySelectorAll('.record')].length`)
check('清空后恢复 3 首', cleared === 3, `${cleared} 首`)

// 无匹配
await ev(`(() => { const el = document.querySelector('.filter-input'); el.value = '不存在的歌'; el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
await wait(400)
const none = await ev(`[...document.querySelectorAll('.record')].length`)
check('无匹配时歌单为空', none === 0, `${none} 首`)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
