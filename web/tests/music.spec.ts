import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTopSongs, fingerprint, formatTime, isAudioFile, resolvePreview, searchSongs, type Track } from '@/lib/music'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('formatTime', () => {
  it('把秒格式化成 m:ss', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(9)).toBe('0:09')
    expect(formatTime(75)).toBe('1:15')
    expect(formatTime(Number.NaN)).toBe('0:00')
  })
})

describe('isAudioFile', () => {
  it('识别的音频扩展名', () => {
    expect(isAudioFile('a.mp3')).toBe(true)
    expect(isAudioFile('b.FLAC')).toBe(true)
    expect(isAudioFile('c.txt')).toBe(false)
  })
})

describe('fingerprint', () => {
  it('对同一内容稳定，且是 16 位十六进制', async () => {
    const buffer = new TextEncoder().encode('same-bytes').buffer
    const first = await fingerprint(buffer, 'x')
    const second = await fingerprint(buffer, 'y')
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect(second).toBe(first)
  })

  it('内容不同指纹不同', async () => {
    const a = await fingerprint(new TextEncoder().encode('a').buffer, 'a')
    const b = await fingerprint(new TextEncoder().encode('b').buffer, 'b')
    expect(a).not.toBe(b)
  })
})

describe('fetchTopSongs', () => {
  it('解析 Apple RSS 结构（单个 entry 也兼容）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          feed: {
            entry: {
              'im:name': { label: '晴天' },
              'im:artist': { label: '周杰伦' },
              'im:image': [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
              id: { attributes: { 'im:id': '123' } },
            },
          },
        }),
      }),
    )

    const list = await fetchTopSongs('hk')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'apple-123', title: '晴天', artist: '周杰伦', art: 'c' })
  })

  it('榜单请求失败时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(fetchTopSongs('us')).rejects.toThrow('503')
  })
})

describe('searchSongs', () => {
  it('过滤掉没有试听地址的结果', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { trackId: 1, trackName: '有试听', artistName: '甲', previewUrl: 'https://x/1.m4a', artworkUrl100: 'a/100x100.jpg' },
            { trackId: 2, trackName: '没有试听', artistName: '乙' },
          ],
        }),
      }),
    )

    const list = await searchSongs('test')
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe('apple-1')
    expect(list[0]!.art).toBe('a/200x200.jpg')
  })
})

describe('resolvePreview', () => {
  it('已有试听地址直接返回', async () => {
    const url = await resolvePreview({ id: 'x', title: 't', artist: 'a', source: 'itunes', previewUrl: 'https://p' })
    expect(url).toBe('https://p')
  })

  it('没有试听地址时按歌手与歌名查一次并回填', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{ trackId: 9, trackName: '曲名', artistName: '歌手', previewUrl: 'https://p2', trackTimeMillis: 30000 }],
        }),
      }),
    )
    const track: Track = { id: 'apple-9', title: '曲名', artist: '歌手', source: 'itunes' }
    const url = await resolvePreview(track)
    expect(url).toBe('https://p2')
    expect(track.previewUrl).toBe('https://p2')
  })
})
