/**
 * B站 代理后端地址。
 *
 * 为什么需要这层：
 * 服务器（云机房 IP）访问 api.bilibili.com 会被风控挡掉（HTTP 412），
 * 而用户自己的电脑（家庭宽带）是通的。所以线上页面把 B站请求转给本机后端
 * 处理 —— 浏览器里的 127.0.0.1 就是用户自己这台电脑。
 *
 * 规则：
 * - 页面本身就跑在 localhost / 127.0.0.1 → 直接用同源相对路径
 * - 否则（例如从服务器 IP 打开）→ 指向本机 127.0.0.1:8787
 * - 用户可在设置里覆盖（biliBackend 存在 localStorage）
 */
const LOCAL = 'http://127.0.0.1:8787'
const STORAGE_KEY = 'banyue:bili-backend'

function isLocalPage(): boolean {
  const h = location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
}

let cached: string | null = null

/** B站接口的基础地址，末尾不带斜杠 */
export function biliBase(): string {
  if (cached !== null) return cached
  const saved = localStorage.getItem(STORAGE_KEY)?.trim()
  if (saved) {
    cached = saved.replace(/\/+$/, '')
    return cached
  }
  // 页面在本地跑：同源即可，不用跨域
  cached = isLocalPage() ? '' : LOCAL
  return cached
}

/** 把 /api/bilibili/... 变成真实可请求的地址 */
export function biliUrl(path: string): string {
  const base = biliBase()
  return base ? `${base}${path}` : path
}

/** 是否正在跨域借用本机后端（用于提示文案） */
export function biliUsingLocal(): boolean {
  return biliBase() !== ''
}

/** 本机后端是否活着（跨域模式下探测一次，失败则回落到同源） */
export async function probeLocalBili(): Promise<boolean> {
  if (!biliBase()) return true
  try {
    const res = await fetch(`${LOCAL}/api/bilibili/ping`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}

export function setBiliBackend(origin: string): void {
  const value = origin.trim().replace(/\/+$/, '')
  if (value) localStorage.setItem(STORAGE_KEY, value)
  else localStorage.removeItem(STORAGE_KEY)
  cached = null
}

export function resetBiliBackend(): void {
  localStorage.removeItem(STORAGE_KEY)
  cached = null
}
