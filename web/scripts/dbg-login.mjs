// 真实浏览器复现「点击登录」问题
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const BASE = 'http://82.156.108.50:8787'
const OUT = path.resolve('../.shots')
const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]
let EDGE = EDGE_CANDIDATES[0]
for (const candidate of EDGE_CANDIDATES) {
  if (existsSync(candidate)) {
    EDGE = candidate
    break
  }
}

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=0', '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-login-${Date.now()}`),
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const endpoint = await new Promise((resolve, reject) => {
  let buffer = ''
  const timer = setTimeout(() => reject(new Error('DevTools 端点超时')), 15000)
  browser.stderr.on('data', (chunk) => {
    buffer += String(chunk)
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer)
    if (match) {
      clearTimeout(timer)
      resolve(new URL(match[1]))
    }
  })
  browser.on('exit', (code) => reject(new Error(`浏览器提前退出 ${code}`)))
})

const targets = await (await fetch(`http://127.0.0.1:${endpoint.port}/json/list`)).json()
const socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
const logs = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  } else if (message.method === 'Runtime.consoleAPICalled' || message.method === 'Runtime.exceptionThrown') {
    logs.push(JSON.stringify(message.params).slice(0, 300))
  } else if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/api/')) {
    logs.push('REQ ' + message.params.request.method + ' ' + message.params.request.url)
  } else if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/')) {
    logs.push('RES ' + message.params.response.status + ' ' + message.params.response.url)
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
async function ev(expr) {
  const { result } = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return result.value
}
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log('shot', name)
}
async function fill(sel, value) {
  return ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return 'no-el'; const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return 'ok' })()`)
}

await mkdir(OUT, { recursive: true })
await send('Page.enable')
await send('Network.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BASE + '/' })
await wait(3000)

console.log('1) 打开登录弹窗...')
console.log('   login-btn 存在:', await ev("!!document.querySelector('.login-btn')"))
await ev("document.querySelector('.login-btn')?.click()")
await wait(800)
console.log('   弹窗出现:', await ev("!!document.querySelector('.auth-box')"))
await shot('dbg-1-dialog')

console.log('2) 填表单...')
console.log('   username:', await fill('.auth-box input:nth-of-type(1)', 'ttbvb'))
console.log('   password:', await fill('.auth-box input[type="password"]', '123456'))
await shot('dbg-2-filled')

console.log('3) 点登录按钮...')
const btnState = await ev(`(() => { const b = document.querySelector('.auth-box .submit'); return b ? {disabled: b.disabled, text: b.textContent} : 'no-btn' })()`)
console.log('   按钮状态:', JSON.stringify(btnState))
await ev("document.querySelector('.auth-box .submit')?.click()")
await wait(2500)

console.log('4) 点击后状态...')
console.log('   按钮:', JSON.stringify(await ev(`(() => { const b = document.querySelector('.auth-box .submit'); return b ? {disabled: b.disabled, text: b.textContent} : 'no-btn(可能已关闭)' })()`)))
console.log('   错误文案:', await ev("document.querySelector('.auth-box .error')?.textContent ?? '无'"))
console.log('   弹窗还在:', await ev("!!document.querySelector('.auth-box')"))
console.log('   用户徽章:', await ev("document.querySelector('.user-chip')?.textContent?.trim() ?? '无'"))
await shot('dbg-3-after-click')

console.log('5) 网络/控制台日志:')
logs.forEach((l) => console.log('  ', l))

socket.close()
browser.kill()
process.exit(0)
