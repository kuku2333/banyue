// 验证阅读进度：滚动存进度、返回时自动恢复、列表页显示「读到 x%」
import { spawn } from 'node:child_process'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5173'

const EDGE = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)[0]
if (!EDGE) throw new Error('找不到 Edge')

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
  '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-reading-${Date.now()}`),
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const endpoint = await new Promise((resolve, reject) => {
  let buffer = ''
  const timer = setTimeout(() => reject(new Error('等待 DevTools 端点超时')), 15000)
  browser.stderr.on('data', (chunk) => {
    buffer += String(chunk)
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer)
    if (m) { clearTimeout(timer); resolve(new URL(m[1])) }
  })
  browser.on('exit', (c) => reject(new Error(`浏览器提前退出 (${c})`)))
})

const targets = await (await fetch(`http://127.0.0.1:${endpoint.port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const msg = JSON.parse(String(event.data))
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    socket.send(JSON.stringify({ id, method, params }))
  })
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (exceptionDetails) throw new Error(exceptionDetails.text)
  return result.value
}

let pass = 0, fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

const SLUG = 'little-prince'

// 打开文章，滚到中间
await send('Page.navigate', { url: `${BASE}/post/${SLUG}` })
await wait(2500)

const scrollable = await evaluate(`document.documentElement.scrollHeight - window.innerHeight > 200`)
check('文章页可滚动', scrollable)

await evaluate(`window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * 0.45)`)
await wait(900)

const stored = await evaluate(`localStorage.getItem('banyue:pos:${SLUG}')`)
check('滚动后写入进度', stored !== null, `值=${stored}`)
check('进度值约 45%', stored !== null && Math.abs(Number(stored) - 0.45) < 0.12, `得到 ${stored}`)

// 离开页面（模拟关闭），再回来
await send('Page.navigate', { url: `${BASE}/` })
await wait(1800)
await send('Page.navigate', { url: `${BASE}/post/${SLUG}` })
await wait(2500)

const scrollY = await evaluate(`window.scrollY`)
const maxScroll = await evaluate(`document.documentElement.scrollHeight - window.innerHeight`)
const ratio = maxScroll > 0 ? scrollY / maxScroll : 0
check('回到页面自动恢复位置', ratio > 0.25, `比例 ${ratio.toFixed(2)}`)

const hint = await evaluate(`
  (() => {
    const el = [...document.querySelectorAll('.tool-btn')].find(b => b.textContent.includes('已回到上次位置'));
    return el ? el.textContent.trim() : '';
  })()
`)
check('显示恢复提示', hint.includes('已回到上次位置'), `"${hint}"`)
check('提示里带百分比', /读到 \d+%/.test(hint), `"${hint}"`)

// 列表页显示进度
await send('Page.navigate', { url: `${BASE}/` })
await wait(2200)
const cardProgress = await evaluate(`
  (() => {
    const cards = [...document.querySelectorAll('.post-card')];
    const withProgress = cards.filter(c => c.querySelector('.read-progress'));
    return JSON.stringify({
      total: cards.length,
      withProgress: withProgress.length,
      text: withProgress[0]?.querySelector('.read-progress')?.textContent?.trim() ?? '',
      hasBar: !!withProgress[0]?.querySelector('.read-bar'),
    });
  })()
`)
const cp = JSON.parse(cardProgress)
console.log('  列表页:', cardProgress)
check('列表页有进度标记', cp.withProgress > 0, `${cp.withProgress}/${cp.total}`)
check('进度标记是「读到 x%」', /读到 \d+%/.test(cp.text), cp.text)
check('卡片带细进度条', cp.hasBar)

// 读完（滚到底）应清掉进度
await send('Page.navigate', { url: `${BASE}/post/${SLUG}` })
await wait(2200)
await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`)
await wait(900)
const afterDone = await evaluate(`localStorage.getItem('banyue:pos:${SLUG}')`)
check('读完清掉进度记录', afterDone === null, `得到 ${afterDone}`)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
