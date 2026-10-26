// 验证全站搜索：文章 / 标签 / 书 / 音乐都能搜到，且能跳转
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
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-search-${Date.now()}`),
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
  if (exceptionDetails) throw new Error(exceptionDetails.text + ' ' + (exceptionDetails.exception?.description ?? ''))
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
await send('Page.navigate', { url: `${BASE}/` })
await wait(2500)

// 打开搜索框（快捷键 / 或点按钮）
const opened = await evaluate(`
  (() => {
    const btn = [...document.querySelectorAll('button, [role=button]')]
      .find(b => (b.getAttribute('aria-label') || '').includes('搜索') || (b.getAttribute('title') || '').includes('搜索'));
    if (btn) { btn.click(); return 'clicked'; }
    return 'no-button';
  })()
`)
console.log('打开搜索:', opened)
await wait(600)

const hasInput = await evaluate(`!!document.querySelector('.search-field input')`)
check('搜索框已打开', hasInput)
if (!hasInput) { browser.kill(); process.exit(1) }

// 搜文章
await evaluate(`(() => {
  const i = document.querySelector('.search-field input');
  i.value = '小王';
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
await wait(700)
const postResults = await evaluate(`
  [...document.querySelectorAll('.search-item')].map(el => ({
    kind: el.querySelector('.kind')?.textContent?.trim(),
    title: el.querySelector('.body b')?.textContent?.trim(),
  }))
`)
console.log('搜「小王」:', JSON.stringify(postResults))
check('搜文章有结果', postResults.length > 0, `得到 ${postResults.length} 条`)
check('结果带类型标签', postResults.every((r) => ['文章', '书', '音乐', '标签'].includes(r.kind ?? '')), JSON.stringify(postResults.slice(0, 2)))

// 搜标签
await evaluate(`(() => {
  const i = document.querySelector('.search-field input');
  i.value = '读书';
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
await wait(700)
const tagResults = await evaluate(`
  [...document.querySelectorAll('.search-item')].map(el => el.querySelector('.kind')?.textContent?.trim())
`)
check('标签类型能出现', tagResults.includes('标签'), JSON.stringify(tagResults))

// 空关键词回退到最近文章
await evaluate(`(() => {
  const i = document.querySelector('.search-field input');
  i.value = '';
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
await wait(600)
const fallback = await evaluate(`document.querySelectorAll('.search-item').length`)
check('空关键词显示最近文章', fallback > 0, `${fallback} 条`)

// 搜不到时给提示
await evaluate(`(() => {
  const i = document.querySelector('.search-field input');
  i.value = 'zzzz不存在的关键词zzzz';
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
await wait(600)
const emptyText = await evaluate(`document.querySelector('.search-results .empty')?.textContent?.trim() ?? ''`)
check('无结果时显示提示', emptyText.includes('没有找到'), `"${emptyText}"`)

// 点第一条能跳转
await evaluate(`(() => {
  const i = document.querySelector('.search-field input');
  i.value = '小王';
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
await wait(700)
const clicked = await evaluate(`(() => {
  const first = document.querySelector('.search-item');
  if (!first) return 'none';
  first.click();
  return 'clicked';
})()`)
await wait(1200)
const url = await evaluate(`location.pathname`)
check('点结果能跳转', clicked === 'clicked' && url !== '/', `url=${url}`)
check('跳到了文章页', url.startsWith('/post/'), `url=${url}`)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
