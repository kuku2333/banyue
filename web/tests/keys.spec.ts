import { describe, expect, it } from 'vitest'
import { bookKeyFor, isCloudTrack, trackKeyFor } from '@/lib/keys'

describe('bookKeyFor', () => {
  it('同一本书得到同一个键（忽略首尾空格与大小写）', () => {
    const a = bookKeyFor({ title: ' 置身事内 ', author: '兰小欢', words: 120000 })
    const b = bookKeyFor({ title: '置身事内', author: '兰小欢', words: 120000 })
    expect(a).toBe(b)
    expect(a).toMatch(/^book-[a-z0-9]+$/)
  })

  it('字数不同视为不同的书', () => {
    expect(bookKeyFor({ title: '书', words: 100 })).not.toBe(bookKeyFor({ title: '书', words: 101 }))
  })

  it('没作者也能算', () => {
    expect(bookKeyFor({ title: '无作者', words: 10 })).toMatch(/^book-/)
  })
})

describe('曲目类型', () => {
  it('apple 前缀是云端歌，本地文件不是', () => {
    expect(isCloudTrack({ id: 'apple-1', title: '', artist: '', source: 'itunes' })).toBe(true)
    expect(isCloudTrack({ id: 'abc', title: '', artist: '', source: 'local', local: true })).toBe(false)
  })

  it('云端歌的键就是曲目 id', () => {
    expect(trackKeyFor({ id: 'apple-42', title: '', artist: '', source: 'itunes' })).toBe('apple-42')
  })
})
