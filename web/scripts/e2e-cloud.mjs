// 端到端自检：注册拿恢复码 → 书架传到云端 → 云端下载回书架。
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

const SAMPLE = `第一章 云上的书

这本书是从云端下载回来的，内容应该和上传时一致。

第二章 验证

只要字数与章节数对得上，就说明文件完整。
`

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-cloud-${Date.now()}`),
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
async function fill(selector, value) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
}

await mkdir(OUT, { recursive: true })
await send('Page.enable')
await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

// 1) 注册 → 恢复码
await send('Page.navigate', { url: `${BASE}/collections` })
await wait(2000)
await evaluate("document.querySelector('.login-btn')?.click()")
await wait(500)
await evaluate("document.querySelector('.auth-box .switches button')?.click()")
await wait(300)
const username = `cloud${Date.now().toString(36).slice(-6)}`
await fill('.auth-box input:nth-of-type(1)', username)
await fill('.auth-box label:nth-of-type(2) input', '云用户')
await fill('.auth-box input[type="password"]', 'secret123')
await evaluate("document.querySelector('.auth-box .submit')?.click()")
await wait(1600)
const recovery = await evaluate("document.querySelector('.auth-box .code')?.textContent?.trim() ?? 'none'")
console.log('recovery code shown:', recovery)
await shot('recovery-code')
await evaluate("document.querySelector('.auth-box .submit')?.click()")
await wait(600)

// 2) 导入本地书并传到云端
const bookPath = path.join(OUT, 'sample-cloud-book.txt')
await writeFile(bookPath, SAMPLE, 'utf8')
await send('Page.navigate', { url: `${BASE}/shelf` })
await wait(1800)
const { root } = await send('DOM.getDocument', { depth: -1 })
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#shelf-file-input' })
await send('DOM.setFileInputFiles', { nodeId, files: [bookPath] })
await wait(2000)
await evaluate("document.querySelector('.book-cloud')?.click()")
await wait(2000)
console.log('cloud books:', await evaluate("document.querySelectorAll('.cloud-list li').length"))
console.log('cloud owner:', await evaluate("document.querySelector('.cloud-main span')?.textContent?.trim() ?? 'none'"))
await shot('shelf-cloud')

// 3) 下载回书架
const before = await evaluate("document.querySelectorAll('.book-card').length")
await evaluate("document.querySelector('.cloud-list .cloud-btn')?.click()")
await wait(2200)
const after = await evaluate("document.querySelectorAll('.book-card').length")
console.log('local books before/after download:', before, '→', after)
await shot('shelf-cloud-downloaded')

socket.close()
browser.kill()
process.exit(0)
