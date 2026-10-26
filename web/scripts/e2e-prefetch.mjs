// 路由预加载验证：首页加载后 PostView 不应立即加载；
// hover 一张文章卡片后，PostView 的模块应当被预取（出现在网络资源里）。
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
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', 'dsh-prefetch-' + Date.now()),
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

await send('Page.navigate', { url: `${BASE}/` })
await wait(3000)

// 首页刚加载时，PostView 模块还没被拉（它不在已加载资源里）
const loadedAfterHome = await ev(`
(() => {
  const urls = performance.getEntriesByType('resource').map(r => r.name)
  return urls.filter(u => u.includes('PostView')).length
})()
`)
check('首页加载后未预取 PostView', loadedAfterHome === 0, `${loadedAfterHome} 个 PostView 资源`)

// hover 第一张文章卡片（绑定了 prefetch('post')）
await ev(`(() => {
  const card = document.querySelector('.post-card')
  if (!card) return
  card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
})()`)
await wait(1500)

const loadedAfterHover = await ev(`
(() => {
  const urls = performance.getEntriesByType('resource').map(r => r.name)
  return urls.filter(u => u.includes('PostView')).length
})()
`)
check('hover 卡片后预取了 PostView', loadedAfterHover > 0, `${loadedAfterHover} 个 PostView 资源`)

// 首页空闲时应当自动预取二级页（archive / tags / about），不抢首屏
await wait(1500)
const idleLoaded = await ev(`
(() => {
  const urls = performance.getEntriesByType('resource').map(r => r.name)
  return ['ArchiveView','TagsView','AboutView'].filter(n => urls.some(u => u.includes(n))).length
})()
`)
check('空闲时自动预取了二级页', idleLoaded > 0, `${idleLoaded} 个二级页 chunk`)

// 图片懒加载：正文图片应有 loading=lazy（装饰性图）
await send('Page.navigate', { url: `${BASE}/post/three-code-traps` })
await wait(2400)
const lazy = await ev(`
(() => {
  const imgs = [...document.querySelectorAll('.prose img')]
  return imgs.map(img => img.getAttribute('loading'))
})()
`)
console.log('  正文图 loading:', JSON.stringify(lazy))
check('正文图片启用懒加载', lazy.length > 0 && lazy.every((l) => l === 'lazy'), JSON.stringify(lazy))

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
