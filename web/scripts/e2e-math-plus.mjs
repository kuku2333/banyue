// 验证数学工具增强：符号求导显示、导出 PNG
import { spawn } from 'node:child_process'
import path from 'node:path'
import { readFile, readdir, rm, mkdir } from 'node:fs/promises'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const DL = path.resolve(process.argv[3] ?? '../.shots/math')

const EDGE = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)[0]
if (!EDGE) throw new Error('找不到 Edge')

await rm(DL, { recursive: true, force: true })
await mkdir(DL, { recursive: true })

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
  '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-mathx-${Date.now()}`),
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
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

await send('Page.navigate', { url: `${BASE}/math` })
await wait(2800)

// 添加函数 sin(x)
const addFn = async (expr) => {
  await evaluate(`(() => {
    const input = document.querySelector('.expr-input');
    input.value = ${JSON.stringify(expr)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await wait(300)
  await evaluate(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('画曲线'))?.click()`)
  await wait(700)
}

await addFn('x^2')
const chips = await evaluate(`document.querySelectorAll('.func-chip').length`)
check('函数已添加', chips >= 1, `${chips} 个`)

// 点导数按钮
const hasPrime = await evaluate(`
  (() => {
    const chip = document.querySelector('.func-chip');
    return !!chip?.querySelector('button[title*="f′"]');
  })()
`)
check('函数条有求导按钮', hasPrime)

await evaluate(`document.querySelector('.func-chip button[title*="f′"]').click()`)
await wait(600)

const derivLine = await evaluate(`document.querySelector('.derivative-line code')?.textContent?.trim() ?? ''`)
check('显示导数式子', derivLine.length > 0, `"${derivLine}"`)
check('x^2 的导数含 2x', /2x/.test(derivLine), `"${derivLine}"`)

// 再点一次收起
await evaluate(`
  (() => {
    const chip = document.querySelector('.func-chip');
    const btn = chip.querySelector('button[title*="收起"]') || chip.querySelector('button[title*="f′"]');
    btn?.click();
    return 'ok';
  })()
`)
await wait(500)
const collapsed = await evaluate(`!!document.querySelector('.derivative-line')`)
check('再点一次收起导数', !collapsed)

// 三角函数
await addFn('sin(x)')
await wait(400)
await evaluate(`
  (() => {
    const chips = [...document.querySelectorAll('.func-chip')];
    const target = chips.find(c => c.textContent.includes('sin(x)'));
    target?.querySelector('button[title*="f′"]')?.click();
  })()
`)
await wait(600)
const sinDeriv = await evaluate(`document.querySelector('.derivative-line code')?.textContent?.trim() ?? ''`)
check('sin(x) 导数为 cos(x)', /cos\(x\)/.test(sinDeriv), `"${sinDeriv}"`)

// 导出 PNG
const exportBtn = await evaluate(`
  (() => {
    const b = [...document.querySelectorAll('.btn')].find(x => x.textContent.includes('导出 PNG'));
    return b ? 'found' : 'missing';
  })()
`)
check('有导出 PNG 按钮', exportBtn === 'found')

await evaluate(`[...document.querySelectorAll('.btn')].find(x => x.textContent.includes('导出 PNG')).click()`)
await wait(2500)

const files = await readdir(DL).catch(() => [])
console.log('  下载目录:', files)
check('产生了 PNG 文件', files.some((f) => f.endsWith('.png')), files.join(','))

const pngName = files.find((f) => f.endsWith('.png'))
if (pngName) {
  const buf = await readFile(path.join(DL, pngName))
  check('文件名符合 banyue-graph-*.png', /^banyue-graph-.*\.png$/.test(pngName), pngName)
  // PNG magic: 89 50 4E 47
  check('是合法 PNG', buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
  check('文件非空', buf.length > 1000, `${buf.length} 字节`)
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
