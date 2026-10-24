// 诊断：悬浮窗进度条点击是否生效
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
  '--no-first-run', '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-seek-${Date.now()}`),
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
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  })
  if (exceptionDetails) return { __error: exceptionDetails.text + ' ' + (exceptionDetails.exception?.description ?? '') }
  return result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

// 去听歌页 → 切「云端音乐」→ 点第一张唱片播放
await send('Page.navigate', { url: `${BASE}/music` })
await wait(3000)

await evaluate(`[...document.querySelectorAll('.chip')].find(b => b.textContent.trim() === '云端音乐')?.click()`)
await wait(3500)

const playResult = await evaluate(`
  (() => {
    const rec = document.querySelector('.record');
    if (!rec) return 'no-record';
    rec.click();
    return 'clicked-record';
  })()
`)
console.log('播放尝试:', playResult)
await wait(3000)

const hasBar = await evaluate(`!!document.querySelector('.p-bar')`)
console.log('悬浮窗进度条存在:', hasBar)

if (!hasBar) {
  const info = await evaluate(`JSON.stringify({
    buttons: [...document.querySelectorAll('button')].slice(0,15).map(b => b.textContent.trim().slice(0,12)),
    hasPlayer: !!document.querySelector('.player-bar, [class*=player]'),
  })`)
  console.log('页面状态:', info)
  browser.kill(); process.exit(1)
}

// 记录点击前状态
const before = await evaluate(`JSON.stringify({
  time: document.querySelector('.p-time')?.textContent ?? '',
  width: document.querySelector('.p-bar')?.getBoundingClientRect().width ?? 0,
  left: document.querySelector('.p-bar')?.getBoundingClientRect().left ?? 0,
  top: document.querySelector('.p-bar')?.getBoundingClientRect().top ?? 0,
  height: document.querySelector('.p-bar')?.getBoundingClientRect().height ?? 0,
})`)
const b = JSON.parse(before)
console.log('点击前:', before)

// 检查进度条中心点上真正命中的元素
const hit = await evaluate(`(() => {
  const bar = document.querySelector('.p-bar');
  const rect = bar.getBoundingClientRect();
  const x = rect.left + rect.width * 0.75;
  const y = rect.top + rect.height / 2;
  const el = document.elementFromPoint(x, y);
  return JSON.stringify({
    x, y,
    tag: el ? el.tagName : null,
    cls: el ? String(el.className) : null,
    isBar: el ? (el.classList?.contains('p-bar') || !!el.closest?.('.p-bar')) : false,
  });
})()`)
console.log('命中元素(75%处):', hit)

// 真实鼠标点击（不是 el.click()，用 Input.dispatchMouseEvent 更接近真人）
const clickX = b.left + b.width * 0.75
const clickY = b.top + b.height / 2
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickX, y: clickY, button: 'left', clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickX, y: clickY, button: 'left', clickCount: 1 })
await wait(1200)

const after = await evaluate(`JSON.stringify({
  time: document.querySelector('.p-time')?.textContent ?? '',
  width: document.querySelector('.p-bar i')?.style.width ?? '',
})`)
console.log('鼠标点击后:', after)

/* ---------- 拖动测试（按下后横向拖到另一处） ---------- */
const dragBox = await evaluate(`(() => {
  const r = document.querySelector('.p-bar').getBoundingClientRect();
  return JSON.stringify({ left: r.left, top: r.top, width: r.width, height: r.height });
})()`)
const d = JSON.parse(dragBox)
const dragY = d.top + d.height / 2
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: d.left + d.width * 0.2, y: dragY, button: 'left', clickCount: 1 })
await wait(120)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: d.left + d.width * 0.5, y: dragY, button: 'left' })
await wait(120)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: d.left + d.width * 0.9, y: dragY, button: 'left' })
await wait(120)
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: d.left + d.width * 0.9, y: dragY, button: 'left', clickCount: 1 })
await wait(1000)
const afterDrag = await evaluate(`JSON.stringify({
  time: document.querySelector('.p-time')?.textContent ?? '',
  width: document.querySelector('.p-bar i')?.style.width ?? '',
})`)
console.log('拖动到 90% 后:', afterDrag)

/* ---------- 触摸点击（模拟手机） ---------- */
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await wait(1200)

const barBox = await evaluate(`(() => {
  const bar = document.querySelector('.p-bar');
  if (!bar) return 'no-bar';
  const r = bar.getBoundingClientRect();
  return JSON.stringify({ left: r.left, top: r.top, width: r.width, height: r.height, time: document.querySelector('.p-time')?.textContent ?? '' });
})()`)
console.log('移动端进度条:', barBox)

if (barBox !== 'no-bar') {
  const m = JSON.parse(barBox)
  const tx = m.left + m.width * 0.4
  const ty = m.top + m.height / 2
  console.log('点击 40% 位置')
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: tx, y: ty, id: 1 }],
  })
  await wait(60)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(1200)
  const afterTouch = await evaluate(`JSON.stringify({
    time: document.querySelector('.p-time')?.textContent ?? '',
    width: document.querySelector('.p-bar i')?.style.width ?? '',
  })`)
  console.log('触摸点击后:', afterTouch)
}

browser.kill()
process.exit(0)
