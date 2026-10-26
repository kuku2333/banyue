// 文章阅读进度：以「滚动到全篇的百分之几」存储。
// 键是 banyue:pos:<slug>，和 PostView 里恢复位置用的是同一份数据，
// 列表页读它来显示「读到 40%」的提示。
const PREFIX = 'banyue:pos:'

/** 0.03 以下当没读过，0.97 以上当读完了 */
const MIN = 0.03
const DONE = 0.97

export function positionKeyOf(slug: string): string {
  return `${PREFIX}${slug}`
}

/** 读取某篇文章的阅读进度，返回 0（未读）到 1（读完） */
export function readProgress(slug: string): number {
  try {
    const raw = localStorage.getItem(positionKeyOf(slug))
    if (raw === null) return 0
    const value = Number(raw)
    if (!Number.isFinite(value)) return 0
    return Math.min(1, Math.max(0, value))
  } catch {
    return 0
  }
}

export function saveProgress(slug: string, ratio: number): void {
  try {
    if (ratio <= MIN || ratio >= DONE) {
      localStorage.removeItem(positionKeyOf(slug))
      localStorage.removeItem(touchedKeyOf(slug))
      return
    }
    localStorage.setItem(positionKeyOf(slug), String(ratio))
    // 记下最后阅读时间：首页「继续阅读」按它排序，而不是按进度高低
    localStorage.setItem(touchedKeyOf(slug), String(Date.now()))
  } catch {
    /* 隐私模式写不进去，忽略 */
  }
}

/** 最后阅读时间戳的键；没读过返回 0 */
function touchedKeyOf(slug: string): string {
  return `banyue:touched:${slug}`
}

export function readTouched(slug: string): number {
  try {
    const raw = localStorage.getItem(touchedKeyOf(slug))
    if (raw === null) return 0
    const value = Number(raw)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

/** 给界面用的文案：null 表示没读过 */
export function progressLabel(ratio: number): string | null {
  if (ratio < MIN) return null
  const percent = Math.round(ratio * 100)
  return `读到 ${percent}%`
}

/** 扫一遍所有文章进度，给首页/归档做「继续阅读」 */
export function allProgress(slugs: string[]): { slug: string; ratio: number }[] {
  const out: { slug: string; ratio: number }[] = []
  for (const slug of slugs) {
    const ratio = readProgress(slug)
    if (ratio >= MIN) out.push({ slug, ratio })
  }
  return out.sort((a, b) => b.ratio - a.ratio)
}

/**
 * 「继续阅读」列表：最近读过的、还没读完的文章，按最后阅读时间倒序。
 * 与 allProgress 的区别是排序依据——这里是「最近」，那边是「读得最多」。
 */
export function recentReading(slugs: string[], limit = 3): { slug: string; ratio: number; touched: number }[] {
  const out: { slug: string; ratio: number; touched: number }[] = []
  for (const slug of slugs) {
    const ratio = readProgress(slug)
    if (ratio < MIN) continue
    out.push({ slug, ratio, touched: readTouched(slug) })
  }
  return out
    .sort((a, b) => b.touched - a.touched)
    .slice(0, limit)
}
