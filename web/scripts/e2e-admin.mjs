// 端到端自检：管理员标识、删除他人云端文件、隐藏文章。
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = path.resolve(process.argv[3] ?? '../.shots')
const DB = path.resolve(process.cwd(), '../server/data/banyue.db')
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
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-admin-${Date.now()}`),
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

await mkdir(OUT, { recursive: true })
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

// 注册一个账号，然后在库里把它设为管理员
await send('Page.navigate', { url: `${BASE}/collections` })
await wait(1800)
const username = `adm${Date.now().toString(36).slice(-6)}`
const status = await evaluate(`fetch('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: '${username}', password: 'secret123', displayName: '管理员测试' })
}).then(r => r.status).catch(e => 'ERR ' + e.message)`)
console.log('register:', JSON.stringify(status), 'as', username)

const db = new DatabaseSync(DB)
db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run(username)
db.close()
console.log('granted admin to', username)

await send('Page.reload')
await wait(2200)
console.log('badge:', await evaluate("document.querySelector('.admin-badge')?.textContent?.trim() ?? 'none'"))

// 云端列表：管理员应看到所有条目的删除按钮
await send('Page.navigate', { url: `${BASE}/shelf` })
await wait(2200)
const counts = await evaluate("(() => ({ items: document.querySelectorAll('.cloud-list li').length, dels: document.querySelectorAll('.cloud-del').length }))()")
console.log('cloud items/delete buttons:', counts.items, counts.dels)

// 文章页：出现「删除文章」，点掉后首页少一篇
await send('Page.navigate', { url: `${BASE}/post/city-bookstore` })
await wait(1800)
console.log('delete button:', await evaluate("document.querySelector('.post-tools .tool-btn:last-child')?.textContent?.trim() ?? 'none'"))
await evaluate('window.confirm = () => true')
await evaluate("[...document.querySelectorAll('.post-tools .tool-btn')].find(b => b.textContent.includes('删除文章'))?.click()")
await wait(1500)
const hiddenCount = await evaluate("fetch('/api/hidden-posts').then(r => r.json()).then(d => d.posts.length)")
console.log('hidden posts:', hiddenCount)
await shot('admin-post-hidden')

// 恢复，别把真站的文章删掉
await evaluate(`fetch('/api/posts/city-bookstore/hide', { method: 'DELETE' })`)
await wait(600)
console.log('restored:', await evaluate("fetch('/api/hidden-posts').then(r => r.json()).then(d => d.posts.length)"))

socket.close()
browser.kill()
process.exit(0)
