import { beforeEach, describe, expect, it } from 'vitest'
import { allProgress, positionKeyOf, progressLabel, readProgress, saveProgress } from '@/lib/reading'

beforeEach(() => {
  localStorage.clear()
})

describe('positionKeyOf', () => {
  it('前缀与 slug 拼接', () => {
    expect(positionKeyOf('little-prince')).toBe('banyue:pos:little-prince')
  })
})

describe('saveProgress / readProgress', () => {
  it('存进去能读回来', () => {
    saveProgress('a', 0.42)
    expect(readProgress('a')).toBeCloseTo(0.42)
  })

  it('低于 3% 视为未读，不落盘', () => {
    saveProgress('b', 0.01)
    expect(readProgress('b')).toBe(0)
    expect(localStorage.getItem('banyue:pos:b')).toBeNull()
  })

  it('超过 97% 视为读完，清掉记录', () => {
    saveProgress('c', 0.5)
    expect(readProgress('c')).toBeCloseTo(0.5)
    saveProgress('c', 0.99)
    expect(readProgress('c')).toBe(0)
  })

  it('没存过返回 0', () => {
    expect(readProgress('never')).toBe(0)
  })

  it('脏数据不会崩，返回 0', () => {
    localStorage.setItem('banyue:pos:bad', 'not-a-number')
    expect(readProgress('bad')).toBe(0)
  })

  it('超范围的值被夹到 0..1', () => {
    localStorage.setItem('banyue:pos:big', '5')
    expect(readProgress('big')).toBe(1)
    localStorage.setItem('banyue:pos:neg', '-3')
    expect(readProgress('neg')).toBe(0)
  })

  it('不同文章互不影响', () => {
    saveProgress('x', 0.2)
    saveProgress('y', 0.8)
    expect(readProgress('x')).toBeCloseTo(0.2)
    expect(readProgress('y')).toBeCloseTo(0.8)
  })
})

describe('progressLabel', () => {
  it('未读没有文案', () => {
    expect(progressLabel(0)).toBeNull()
    expect(progressLabel(0.02)).toBeNull()
  })

  it('读过显示百分比', () => {
    expect(progressLabel(0.4)).toBe('读到 40%')
    expect(progressLabel(0.456)).toBe('读到 46%')
  })
})

describe('allProgress', () => {
  it('只返回读过的，按进度倒序', () => {
    saveProgress('one', 0.1)
    saveProgress('two', 0.8)
    saveProgress('three', 0)
    const out = allProgress(['one', 'two', 'three'])
    expect(out.map((item) => item.slug)).toEqual(['two', 'one'])
  })

  it('全都没读时返回空', () => {
    expect(allProgress(['a', 'b'])).toEqual([])
  })
})
