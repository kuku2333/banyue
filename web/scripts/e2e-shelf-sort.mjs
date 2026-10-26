// 书架：筛选 + 排序 + 整体进度，直接往 IndexedDB 注入测试数据
import { spawn } from 'node:child_process'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)[0]

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
  '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', 'dsh-shelf-' + Date.now()),
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const endpoint = await new Promise((res, rej) => {
  let b = ''
  const t = setTimeout(() => rej(new Error('timeout')), 15000)
  browser.stderr.on('data', (c) => {
    b += String(c)
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(b)
    if (m) { clearTimeout(t); res(new URL(m[1])) }
  })
})

const targets = await (await fetch(`http://127.0.0.1:${endpoint.port}/json/list`)).json()
const pg = targets.find((t) => t.type === 'page')
const ws = new WebSocket(pg.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

let id = 0
const pend = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data))
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
})
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id
    pend.set(i, (x) => (x.error ? rej(new Error(x.error.message)) : res(x.result)))
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (expr) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  })
  if (exceptionDetails) return 'ERR:' + exceptionDetails.text
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

await send('Page.navigate', { url: `${BASE}/shelf` })
await wait(2500)

await ev(`
(async () => {
  const req = indexedDB.open('banyue-reader')
  const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
  const tx = db.transaction('books', 'readwrite')
  const store = tx.objectStore('books')
  const now = Date.now()
  const seed = [
    { id: 'b1', title: '第一章', author: '甲', format: 'txt', size: 100, words: 1000, chapterCount: 1, encoding: 'utf-8', createdAt: now - 4000, lastReadAt: now - 100, progress: 0.6 },
    { id: 'b2', title: '第二章', author: '乙', format: 'txt', size: 100, words: 2000, chapterCount: 1, encoding: 'utf-8', createdAt: now - 3000, lastReadAt: now - 2000, progress: 1 },
    { id: 'b3', title: '第三章', author: '丙', format: 'txt', size: 100, words: 3000, chapterCount: 1, encoding: 'utf-8', createdAt: now - 2000, progress: 0 },
    { id: 'b4', title: '第四章', author: '丁', format: 'txt', size: 100, words: 4000, chapterCount: 1, encoding: 'utf-8', createdAt: now - 1000, lastReadAt: now - 50, progress: 0.3 },
  ]
  await Promise.all(seed.map((b) => new Promise((res) => { const r = store.put(b); r.onsuccess = () => res() })))
  await new Promise((res) => { tx.oncomplete = res })
})()
`)
await wait(600)
await send('Page.navigate', { url: `${BASE}/shelf` })
await wait(2600)

const base = await ev(`
(() => {
  const cards = [...document.querySelectorAll('.book-card')]
  const bar = document.querySelector('.shelf-progress')
  return {
    count: cards.length,
    overall: bar?.querySelector('span')?.textContent?.trim() ?? '',
    overallWidth: bar?.querySelector('i')?.style?.width ?? '',
    filterChips: [...document.querySelectorAll('.shelf-toolbar .chip')].map(c => c.textContent.trim()),
    sortOptions: [...document.querySelectorAll('.sort-select select option')].map(o => o.textContent.trim())
  }
})()
`)
console.log('  卡片数:', base.count, '| 筛选:', base.filterChips.join(','), '| 排序:', base.sortOptions.join(','))
console.log('  整体进度:', base.overall, '宽度', base.overallWidth)
check('4 本书都被渲染', base.count === 4, `${base.count}`)
check('有筛选标签', base.filterChips.some(c => c.includes('在读')) && base.filterChips.some(c => c.includes('读完')))
check('有排序选项', base.sortOptions.includes('最近在读') && base.sortOptions.includes('书名'))
check('整体进度条出现', !!base.overall, base.overall)

const orderRecent = await ev(`[...document.querySelectorAll('.book-card h3')].map(h => h.textContent.trim())`)
check('默认按最近在读排（第四章最前）', orderRecent[0] === '第四章', orderRecent.join(','))

await ev(`[...document.querySelectorAll('.sort-select select option')].find(o => o.textContent.includes('书名')).selected = true`)
await ev(`document.querySelector('.sort-select select').dispatchEvent(new Event('change'))`)
await wait(300)
const orderTitle = await ev(`[...document.querySelectorAll('.book-card h3')].map(h => h.textContent.trim())`)
// 中文排序按拼音，不是按一二三四的笔画语义：
// 二(er) < 三(san) < 四(si) < 一(yi)，所以顺序是 第二、第三、第四、第一章
check('按书名（拼音）排序', JSON.stringify(orderTitle) === JSON.stringify(['第二章','第三章','第四章','第一章']), orderTitle.join(','))

await ev(`[...document.querySelectorAll('.shelf-toolbar .chip')].find(c => c.textContent.includes('在读')).click()`)
await wait(300)
const reading = await ev(`[...document.querySelectorAll('.book-card h3')].map(h => h.textContent.trim())`)
check('筛选「在读」只剩 0.6 和 0.3 两本', reading.length === 2 && !reading.includes('第三章') && !reading.includes('第二章'), reading.join(','))

await ev(`[...document.querySelectorAll('.shelf-toolbar .chip')].find(c => c.textContent.includes('读完')).click()`)
await wait(300)
const done = await ev(`[...document.querySelectorAll('.book-card h3')].map(h => h.textContent.trim())`)
check('筛选「读完」只剩第二章', done.length === 1 && done[0] === '第二章', done.join(','))

await ev(`[...document.querySelectorAll('.shelf-toolbar .chip')].find(c => c.textContent.includes('未开始')).click()`)
await wait(300)
const todo = await ev(`[...document.querySelectorAll('.book-card h3')].map(h => h.textContent.trim())`)
check('筛选「未开始」只剩第三章', todo.length === 1 && todo[0] === '第三章', todo.join(','))

await ev(`[...document.querySelectorAll('.shelf-toolbar .chip')].find(c => c.textContent.trim().startsWith('全部')).click()`)
await wait(300)
const all = await ev(`document.querySelectorAll('.book-card').length`)
check('回到全部恢复 4 本', all === 4, `${all}`)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
