// 首页「继续阅读」：读过的文章要出现在首页，进度条比例正确，点击能回去
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
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', 'dsh-resume-' + Date.now()),
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

// 干净起步
await send('Page.navigate', { url: `${BASE}/` })
await wait(2000)
await ev(`Object.keys(localStorage).filter(k => k.startsWith('banyue:')).forEach(k => localStorage.removeItem(k))`)
await send('Page.navigate', { url: `${BASE}/` })
await wait(2000)

const noResume = await ev(`!!document.querySelector('.resume')`)
check('没读过时不显示继续阅读', !noResume)

// 读两篇：一篇读得少、一篇读得多，但先读读得多的那篇
const readPost = async (slug, ratio) => {
  await send('Page.navigate', { url: `${BASE}/post/${slug}` })
  await wait(2200)
  await ev(`window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * ${ratio})`)
  await wait(900)
}

await readPost('city-bookstore', 0.6)   // 先读，进度高
await readPost('rainy-cafe', 0.25)      // 后读，进度低

// 回首页
await send('Page.navigate', { url: `${BASE}/` })
await wait(2200)

const info = await ev(`
(() => {
  const box = document.querySelector('.resume');
  if (!box) return { exists: false };
  const items = [...box.querySelectorAll('.resume-item')];
  return {
    exists: true,
    count: items.length,
    titles: items.map(i => i.querySelector('b')?.textContent?.trim() ?? ''),
    labels: items.map(i => i.querySelector('.muted')?.textContent?.trim() ?? ''),
    barWidths: items.map(i => i.querySelector('.resume-bar i')?.style?.width ?? ''),
    hrefs: items.map(i => i.getAttribute('href')),
    hasTitle: !!box.querySelector('.section-title h2')
  };
})()
`)
if (!info.exists) {
  check('读过后出现继续阅读', false, '区块不存在')
} else {
  console.log('  条目:', JSON.stringify(info.titles), JSON.stringify(info.labels))
  console.log('  进度条:', JSON.stringify(info.barWidths))
  check('读过后出现继续阅读', info.exists)
  check('最多 3 条', info.count <= 3, `${info.count} 条`)
  check('两篇都进去了', info.count === 2, `${info.count} 条`)
  check('有标题', info.hasTitle)
  check('显示百分比', info.labels.every((l) => /读到 \d+%/.test(l)), JSON.stringify(info.labels))
  check('进度条宽度与百分比一致', info.barWidths.every((w, i) => {
    const pct = /读到 (\d+)%/.exec(info.labels[i] ?? '')
    return pct ? Math.abs(Number(pct[1]) - Number.parseFloat(w)) <= 2 : false
  }), JSON.stringify(info.barWidths))

  // 最近读的排最前
  check('最近读的排第一', info.titles[0]?.includes('雨') || info.hrefs[0]?.includes('rainy-cafe'),
    `${info.titles[0]} / ${info.hrefs[0]}`)

  // 点进去能到文章页
  await ev(`document.querySelector('.resume-item').click()`)
  await wait(2200)
  const url = await ev(`location.pathname`)
  check('点击能进入文章', url.startsWith('/post/'), url)
  const y = await ev(`window.scrollY`)
  check('进入后恢复到上次位置', y > 100, `scrollY=${y}`)
}

// 读完一篇后它应从列表消失
await readPost('rainy-cafe', 1)
await send('Page.navigate', { url: `${BASE}/` })
await wait(2200)
const afterDone = await ev(`
(() => {
  const items = [...document.querySelectorAll('.resume-item')];
  return { count: items.length, hrefs: items.map(i => i.getAttribute('href')) };
})()
`)
console.log('  读完后条目:', JSON.stringify(afterDone.hrefs))
check('读完的文章从列表移除', !afterDone.hrefs.some((h) => h?.includes('rainy-cafe')), JSON.stringify(afterDone.hrefs))

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
