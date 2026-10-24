// 端到端：新视频 → 保存到本地 + 保存到云端（真实上传），分别计时
import { spawn } from 'node:child_process'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const BVID = process.argv[3] ?? 'BV1Lx411c7Mh' // 动态漫画（之前没传过）

const EDGE = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)[0]
if (!EDGE) throw new Error('找不到 Edge')

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
  '--no-first-run', '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-bili2-${Date.now()}`),
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
  const { result } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false })

// 登录
await send('Page.navigate', { url: `${BASE}/bili` })
await wait(2000)
const login = await evaluate(`(async () => (await fetch('/api/auth/login', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'ttbvb',password:'123456'}),credentials:'same-origin'})).status)()`)
console.log('登录:', login)

// 解析新视频
await send('Page.navigate', { url: `${BASE}/bili` })
await wait(2500)
await evaluate(`
  (() => {
    const input = document.querySelector('.search-row input');
    input.value = '${BVID}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()
`)
await wait(400)
await evaluate(`document.querySelector('.search-row button[type=submit]')?.click()`)
await wait(8000)

const title = await evaluate(`document.querySelector('h2, .video-title, [class*=title]')?.textContent?.trim() ?? ''`)
console.log('解析到:', title.slice(0, 50))

// 通用等待结果
async function runAndWait(buttonText, label) {
  const clicked = await evaluate(`
    (() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('${buttonText}'));
      if (!b) return 'no-button';
      b.click(); return 'clicked';
    })()
  `)
  if (clicked !== 'clicked') { console.log(`${label}: 找不到按钮`); return }
  const t0 = Date.now()
  let msg = ''
  for (let i = 0; i < 90; i++) {
    await wait(1000)
    msg = await evaluate(`
      (() => {
        const n = document.querySelector('.save-msg') || document.querySelector('.save-err');
        return n ? n.textContent.trim() : '';
      })()
    `)
    if (msg) break
  }
  console.log(`${label}: 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s → "${msg}"`)
}

await runAndWait('保存到本地音乐', '保存到本地')
await runAndWait('保存到云端音乐', '保存到云端(真实上传)')

browser.kill()
process.exit(0)
