// 端到端自检：注册 → 查看/新建收藏夹 → 把正在播放的歌加进歌单。
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = path.resolve(process.argv[3] ?? '../.shots')
const EDGE = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)[0]

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-col-${Date.now()}`),
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const endpoint = await new Promise((resolve, reject) => {
  let buffer = ''
  const timer = setTimeout(() => reject(new Error('等待 DevTools 端点超时')), 15000)
  browser.stderr.on('data', (chunk) => {
    buffer += String(chunk)
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer)
    if (match) {
      clearTimeout(timer)
      resolve(new URL(match[1]))
    }
  })
  browser.on('exit', (code) => reject(new Error(`浏览器提前退出 (${code})`)))
})

const targets = await (await fetch(`http://127.0.0.1:${endpoint.port}/json/list`)).json()
const socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
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
async function shot(name, width = 1440, height = 1000) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await wait(400)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`shot ${name}.png`)
}

/** 给 Vue 的 v-model 输入框赋值 */
async function fill(selector, value) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
}

async function click(selector) {
  return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`)
}

await mkdir(OUT, { recursive: true })
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

const username = `e2e${Date.now().toString(36).slice(-6)}`
await send('Page.navigate', { url: `${BASE}/collections` })
await wait(2200)

// 注册
await click('.login-btn')
await wait(500)
await click('.auth-box .switch button')
await wait(300)
await fill('.auth-box input:nth-of-type(1)', username)
await fill('.auth-box label:nth-of-type(2) input', '端到端用户')
await fill('.auth-box input[type="password"]', 'secret123')
await shot('account-register')
await click('.auth-box .submit')
await wait(1500)
console.log('logged in chip:', await evaluate("document.querySelector('.user-chip b')?.textContent ?? 'none'"))

// 新建音乐收藏夹
await click('.toolbar .btn')
await wait(400)
await fill('.create-box input:nth-of-type(1)', '深夜循环')
await fill('.create-box input:nth-of-type(2)', '夜里写代码时听')
await shot('collections-create')
await click('.create-box .btn--solid')
await wait(1200)
console.log('detail open:', await evaluate("document.querySelector('.detail h2')?.textContent ?? 'none'"))
await shot('collections-detail')

// 去听歌，把正在播放的歌加进歌单
await send('Page.navigate', { url: `${BASE}/music` })
await wait(2400)
await evaluate("document.querySelector('.track-list .play')?.click()")
await wait(2500)
await evaluate("document.querySelectorAll('.p-extra .p-mode')[1]?.click()")
await wait(1000)
await shot('collection-picker')
const pick = await evaluate("document.querySelector('.picker .pick')?.textContent ?? 'none'")
console.log('picker first collection:', JSON.stringify(pick))
await evaluate("document.querySelector('.picker .pick')?.click()")
await wait(1200)
await shot('collection-picker-done')

// 回到收藏夹页确认条目
await send('Page.navigate', { url: `${BASE}/collections` })
await wait(2200)
await evaluate("document.querySelector('.collection-card')?.click()")
await wait(800)
console.log('items:', await evaluate("document.querySelectorAll('.item-list li').length"))
await shot('collections-after')

socket.close()
browser.kill()
process.exit(0)
