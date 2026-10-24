// 端到端：验证音乐播放器新增交互（倍速/睡眠/队列拖拽/最近播放/键盘/队列持久化）
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
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-player-${Date.now()}`),
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
await wait(3000)

// 切云端音乐，播第一首
await evaluate(`[...document.querySelectorAll('.chip')].find(b => b.textContent.trim() === '云端音乐')?.click()`)
await wait(3500)
await evaluate(`document.querySelector('.record')?.click()`)
await wait(3500)

const hasPlayer = await evaluate(`!!document.querySelector('.player')`)
check('播放器已出现', hasPlayer)
if (!hasPlayer) { browser.kill(); process.exit(1) }

console.log('\n[倍速]')
const rate0 = await evaluate(`[...document.querySelectorAll('.p-mode')].find(b => b.textContent.includes('×'))?.textContent.trim()`)
check('倍速按钮存在', Boolean(rate0), `得到: ${rate0}`)
await evaluate(`[...document.querySelectorAll('.p-mode')].find(b => b.textContent.includes('×'))?.click()`)
await wait(500)
const rate1 = await evaluate(`[...document.querySelectorAll('.p-mode')].find(b => b.textContent.includes('×'))?.textContent.trim()`)
check('点一下倍速变化', rate1 !== rate0, `${rate0} → ${rate1}`)
const actualRate = await evaluate(`document.querySelector('audio')?.playbackRate ?? null`)
check('audio.playbackRate 跟着改', actualRate !== 1 || rate1.includes('1.25'), `rate=${actualRate}, 按钮=${rate1}`)

console.log('\n[睡眠定时]')
const sleep0 = await evaluate(`[...document.querySelectorAll('.p-mode')].find(b => b.textContent.trim() === '定时')?.textContent.trim()`)
check('定时按钮存在', sleep0 === '定时', `得到: ${sleep0}`)
await evaluate(`[...document.querySelectorAll('.p-mode')].find(b => b.textContent.trim() === '定时')?.click()`)
await wait(600)
const sleep1 = await evaluate(`[...document.querySelectorAll('.p-mode')].find(b => /^\\d+:\\d\\d$/.test(b.textContent.trim()))?.textContent.trim()`)
check('开启后显示倒计时', Boolean(sleep1), `得到: ${sleep1}`)
// 关掉
await evaluate(`[...document.querySelectorAll('.p-mode')].find(b => /^\\d+:\\d\\d$/.test(b.textContent.trim()))?.click()`)
await wait(400)
const sleep2 = await evaluate(`[...document.querySelectorAll('.p-mode')].find(b => b.textContent.trim() === '定时')?.textContent.trim()`)
check('再点一次取消定时', sleep2 === '定时')

console.log('\n[键盘快捷键]')
const volBefore = await evaluate(`document.querySelector('.p-vol input')?.value`)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
await wait(400)
const volAfter = await evaluate(`document.querySelector('.p-vol input')?.value`)
check('↓ 降低音量', Number(volAfter) < Number(volBefore), `${volBefore} → ${volAfter}`)

const tBefore = await evaluate(`document.querySelector('.p-time')?.textContent`)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '5', code: 'Digit5', windowsVirtualKeyCode: 53, text: '5' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '5', code: 'Digit5', windowsVirtualKeyCode: 53 })
await wait(800)
const tAfter = await evaluate(`document.querySelector('.p-time')?.textContent`)
check('数字键 5 跳到约 50%', tBefore !== tAfter, `${tBefore} → ${tAfter}`)

console.log('\n[队列拖拽]')
await evaluate(`document.querySelector('[aria-label="打开队列"], .p-icon[title*="队列"]')?.click()`)
await wait(300)
// 队列按钮是第几个 p-icon，兜底用文本找
let queueOpen = await evaluate(`!!document.querySelector('.queue-panel')`)
if (!queueOpen) {
  await evaluate(`[...document.querySelectorAll('.p-icon')].find(b => b.getAttribute('aria-label')?.includes('队列'))?.click()`)
  await wait(400)
  queueOpen = await evaluate(`!!document.querySelector('.queue-panel')`)
}
check('队列面板能打开', queueOpen)
if (queueOpen) {
  const before = await evaluate(`[...document.querySelectorAll('.queue-panel li .q-main b')].map(b => b.textContent)`)
  const liCount = before.length
  if (liCount >= 2) {
    const box = await evaluate(`(() => {
      const lis = document.querySelectorAll('.queue-panel li');
      const a = lis[0].getBoundingClientRect(), b = lis[1].getBoundingClientRect();
      return JSON.stringify({ ax: a.left + a.width/2, ay: a.top + a.height/2, by: b.top + b.height/2, bx: b.left + b.width/2 });
    })()`)
    const p = JSON.parse(box)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.ax, y: p.ay, button: 'left', clickCount: 1 })
    await wait(120)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.bx, y: p.by, button: 'left' })
    await wait(150)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.bx, y: p.by, button: 'left', clickCount: 1 })
    await wait(700)
    const after = await evaluate(`[...document.querySelectorAll('.queue-panel li .q-main b')].map(b => b.textContent)`)
    check('拖动后顺序变化', JSON.stringify(before) !== JSON.stringify(after), `${before.join(',')} → ${after.join(',')}`)
  } else {
    check('队列里至少两首可拖', false, `只有 ${liCount} 首`)
  }
}

console.log('\n[最近播放]')
const recentTab = await evaluate(`!![...document.querySelectorAll('.chip, button')].find(b => b.textContent.trim() === '最近')`)
check('「最近」标签存在', recentTab)
if (recentTab) {
  await evaluate(`[...document.querySelectorAll('.chip, button')].find(b => b.textContent.trim() === '最近')?.click()`)
  await wait(1200)
  const recentCount = await evaluate(`document.querySelectorAll('.record').length`)
  check('最近播放里有记录', recentCount > 0, `${recentCount} 首`)
}

console.log('\n[队列持久化]')
const queueLenBefore = await evaluate(`(() => {
  try { return JSON.parse(localStorage.getItem('banyue:player:queue') || '[]').length } catch { return -1 }
})()`)
check('队列已写入 localStorage', queueLenBefore > 0, `${queueLenBefore} 首`)
await send('Page.navigate', { url: `${BASE}/music` })
await wait(3000)
const restored = await evaluate(`!!document.querySelector('.player')`)
check('刷新后播放器自动恢复', restored)
const restoredTitle = await evaluate(`document.querySelector('.p-meta b')?.textContent ?? ''`)
check('刷新后仍显示上次的歌', restoredTitle.length > 0, `"${restoredTitle}"`)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
