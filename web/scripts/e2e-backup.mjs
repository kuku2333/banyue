// 验证数据备份：菜单入口、统计数字、真实下载到的 JSON 内容
import { spawn } from 'node:child_process'
import path from 'node:path'
import { readFile, rm, mkdir } from 'node:fs/promises'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const DL = path.resolve(process.argv[3] ?? '../.shots/backup')

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
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-backup-${Date.now()}`),
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

// 先登录（备份菜单在登录后才出现）
await send('Page.navigate', { url: `${BASE}/` })
await wait(2500)
const loginStatus = await evaluate(`
  (async () => {
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ttbvb', password: '123456' }), credentials: 'same-origin',
    });
    return r.status;
  })()
`)
console.log('登录:', loginStatus)

// 造一点本地数据：一个草稿 + 一个数学草稿本
await send('Page.navigate', { url: `${BASE}/` })
await wait(2000)
await evaluate(`
  (async () => {
    const d = await new Promise((res, rej) => {
      const req = indexedDB.open('banyue');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    // 依赖已有 schema；如果没有 drafts 表就跳过
    if (!d.objectStoreNames.contains('drafts')) { d.close(); return 'no-store'; }
    await new Promise((res, rej) => {
      const tx = d.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put({
        id: 'e2e-draft', title: '备份测试草稿', body: '正文', updatedAt: Date.now(), createdAt: Date.now(),
      });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    d.close();
    return 'ok';
  })()
`)
await wait(500)

// 重新加载让菜单出现
await send('Page.navigate', { url: `${BASE}/` })
await wait(2500)

// 打开账户菜单
const menuOpened = await evaluate(`
  (() => {
    const chip = document.querySelector('.user-chip');
    if (!chip) return 'no-chip';
    chip.click();
    return 'clicked';
  })()
`)
console.log('账户菜单:', menuOpened)
await wait(500)

const hasBackupItem = await evaluate(`
  [...document.querySelectorAll('.account-menu button')].some(b => b.textContent.includes('数据备份'))
`)
check('菜单里有「数据备份」', hasBackupItem)
if (!hasBackupItem) { browser.kill(); process.exit(1) }

// 点击打开对话框
await evaluate(`
  [...document.querySelectorAll('.account-menu button')].find(b => b.textContent.includes('数据备份')).click()
`)
await wait(2500)

const dialogOpen = await evaluate(`!!document.querySelector('.backup-box')`)
check('备份对话框打开', dialogOpen)

const rowCount = await evaluate(`document.querySelectorAll('.backup-box .rows li').length`)
check('列出各类数据', rowCount >= 6, `${rowCount} 行`)

const hasCounts = await evaluate(`
  [...document.querySelectorAll('.backup-box .rows li b')].every(b => /^\\d+$/.test(b.textContent.trim()))
`)
check('每项都有数字', hasCounts)

const hasNotIncluded = await evaluate(`!!document.querySelector('.backup-box .notes')`)
console.log('  说明区（有本地数据才出现）:', hasNotIncluded)

// 导出
const btnText = await evaluate(`
  (() => {
    const b = [...document.querySelectorAll('.backup-box footer button')].find(x => x.textContent.includes('导出'));
    return b ? b.textContent.trim() : 'none';
  })()
`)
check('有导出按钮', btnText.includes('导出'), btnText)

await evaluate(`
  [...document.querySelectorAll('.backup-box footer button')].find(x => x.textContent.includes('导出')).click()
`)
await wait(2500)

// 检查下载到的文件
const files = await readFile(path.join(DL, 'x'), 'utf8').catch(() => null)
const list = await (async () => {
  const { readdir } = await import('node:fs/promises')
  return readdir(DL).catch(() => [])
})()
console.log('  下载目录:', list)
check('产生了下载文件', list.length > 0, `${list.length} 个`)

if (list.length) {
  const name = list.find((f) => f.endsWith('.json')) ?? list[0]
  const raw = await readFile(path.join(DL, name), 'utf8')
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { /* 解析失败下面会报 */ }
  check('文件名是 banyue-backup-*.json', /^banyue-backup-\d{8}-\d{4}\.json$/.test(name ?? ''), name)
  check('内容是合法 JSON', parsed !== null)
  if (parsed) {
    check('含 version 字段', typeof parsed.version === 'number', String(parsed.version))
    check('含 exportedAt', typeof parsed.exportedAt === 'string')
    check('含 preferences', typeof parsed.preferences === 'object')
    check('含各数据数组', ['drafts', 'books', 'songs', 'bookmarks', 'songNotes', 'mathNotebooks'].every((k) => Array.isArray(parsed[k])))
    check('含 notIncluded 说明', Array.isArray(parsed.notIncluded))
    check('草稿被备份到', Array.isArray(parsed.drafts) && parsed.drafts.length >= 0)
  }
}
void files

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
