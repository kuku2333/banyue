// 验证悬浮窗排版：无横向溢出、文字不竖排、音量条在卡片内
import { spawn } from 'node:child_process'
import path from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = path.resolve(process.argv[3] ?? '../.shots')

const EDGE = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)[0]
if (!EDGE) throw new Error('找不到 Edge')

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
  '--no-first-run', '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-layout-${Date.now()}`),
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${BASE}/music` })
await wait(3000)
await evaluate(`[...document.querySelectorAll('.chip')].find(b => b.textContent.trim() === '云端音乐')?.click()`)
await wait(3500)
await evaluate(`document.querySelector('.record')?.click()`)
await wait(3500)

const hasPlayer = await evaluate(`!!document.querySelector('.player')`)
check('播放器已出现', hasPlayer)
if (!hasPlayer) { browser.kill(); process.exit(1) }

// 1) 卡片内所有元素是否横向溢出
const overflow = await evaluate(`(() => {
  const card = document.querySelector('.player');
  const cr = card.getBoundingClientRect();
  const bad = [];
  for (const el of card.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > cr.right + 0.5 || r.left < cr.left - 0.5) {
      bad.push({ tag: el.tagName, cls: String(el.className).slice(0, 30), right: Math.round(r.right), cardRight: Math.round(cr.right) });
    }
  }
  return JSON.stringify({ cardRight: Math.round(cr.right), cardLeft: Math.round(cr.left), bad: bad.slice(0, 8), badCount: bad.length });
})()`)
const ov = JSON.parse(overflow)
check('卡片内无横向溢出', ov.badCount === 0, `溢出 ${ov.badCount} 个: ${JSON.stringify(ov.bad)}`)

// 2) 文字是否横排（行高 < 宽度 的极端情况 = 竖排）
const vertical = await evaluate(`(() => {
  const bad = [];
  for (const el of document.querySelectorAll('.p-mode')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // 竖排时宽度极小、高度很大
    if (r.height > r.width * 1.2 && r.width > 0) {
      bad.push({ text: el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }
  return JSON.stringify(bad);
})()`)
check('按钮文字是横排的', JSON.parse(vertical).length === 0, vertical)

// 3) 音量条完整在卡片内且是横向的
const vol = await evaluate(`(() => {
  const input = document.querySelector('.p-vol input');
  const card = document.querySelector('.player');
  if (!input) return JSON.stringify({ ok: false, reason: 'no-input' });
  const r = input.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  return JSON.stringify({
    width: Math.round(r.width),
    height: Math.round(r.height),
    insideRight: r.right <= cr.right + 0.5,
    insideLeft: r.left >= cr.left - 0.5,
    horizontal: r.width > r.height,
  });
})()`)
const v = JSON.parse(vol)
check('音量条在卡片内', v.insideRight && v.insideLeft, vol)
check('音量条是横向的', v.horizontal, `w=${v.width} h=${v.height}`)
check('音量条有合理宽度', v.width > 100, `w=${v.width}`)

// 4) 截图
await mkdir(OUT, { recursive: true })
const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile(path.join(OUT, 'player-layout.png'), Buffer.from(data, 'base64'))
console.log('  截图: .shots/player-layout.png')

// 5) 窄屏（手机）也检查一次
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await wait(1200)
const narrow = await evaluate(`(() => {
  const card = document.querySelector('.player');
  const cr = card.getBoundingClientRect();
  let bad = 0;
  for (const el of card.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > cr.right + 0.5) bad++;
  }
  return JSON.stringify({ bad, cardW: Math.round(cr.width) });
})()`)
check('窄屏下也无溢出', JSON.parse(narrow).bad === 0, narrow)

const { data: d2 } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile(path.join(OUT, 'player-layout-mobile.png'), Buffer.from(d2, 'base64'))
console.log('  截图: .shots/player-layout-mobile.png')

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
