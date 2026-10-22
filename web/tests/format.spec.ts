import { describe, expect, it } from 'vitest'
import { formatDate, localDateStamp } from '@/lib/format'

describe('日期格式化', () => {
  it('完整日期、短日期与月份', () => {
    expect(formatDate('2026-10-21')).toBe('2026 年 10 月 21 日')
    expect(formatDate('2026-10-21', 'short')).toBe('10.21')
    expect(formatDate('2026-10-21', 'month')).toBe('10 月')
  })

  it('只有年月时不会输出 NaN', () => {
    expect(formatDate('2026-10')).toBe('2026 年 10 月')
    expect(formatDate('2026-10', 'short')).toBe('10')
  })

  it('无法解析时原样返回', () => {
    expect(formatDate('随便什么')).toBe('随便什么')
  })

  it('时间戳按本地时区取日期，不因 UTC 偏移差一天', () => {
    // 本地 2026-10-21 00:30（东八区等价于 UTC 前一天 16:30）
    const stamp = new Date(2026, 9, 21, 0, 30).getTime()
    expect(localDateStamp(stamp)).toBe('2026-10-21')
    expect(localDateStamp(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01')
  })

  it('非法时间戳返回空串', () => {
    expect(localDateStamp(Number.NaN)).toBe('')
  })
})
