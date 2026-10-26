import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BACKUP_VERSION, backupFileName, downloadJson, summarize, type BackupBundle } from '@/lib/backup'

function makeBundle(overrides: Partial<BackupBundle> = {}): BackupBundle {
  return {
    version: BACKUP_VERSION,
    exportedAt: '2026-10-26T12:00:00.000Z',
    origin: 'http://localhost:5173',
    preferences: {},
    drafts: [],
    books: [],
    songs: [],
    bookmarks: [],
    songNotes: [],
    mathNotebooks: [],
    cloudAssets: [],
    playlists: [],
    notIncluded: [],
    ...overrides,
  }
}

describe('backupFileName', () => {
  it('带日期与时间，便于区分多次导出', () => {
    const name = backupFileName(new Date(2026, 9, 26, 20, 5))
    expect(name).toBe('banyue-backup-20261026-2005.json')
  })

  it('月和日补零', () => {
    const name = backupFileName(new Date(2026, 0, 3, 9, 7))
    expect(name).toBe('banyue-backup-20260103-0907.json')
  })

  it('扩展名是 json', () => {
    expect(backupFileName()).toMatch(/\.json$/)
  })
})

describe('summarize', () => {
  it('统计各类条目数量', () => {
    const bundle = makeBundle({
      drafts: [{}, {}],
      books: [{}, {}, {}],
      songs: [{}],
      bookmarks: [{}],
      songNotes: [{}],
      mathNotebooks: [
        { name: '本子一', createdAt: 1, updatedAt: 2, pages: [] },
        { name: '本子二', createdAt: 1, updatedAt: 2, pages: [] },
      ],
      cloudAssets: [{ kind: 'track', title: 'a', size: 1, createdAt: 1 }],
      playlists: [],
    })
    const s = summarize(bundle)
    expect(s.drafts).toBe(2)
    expect(s.books).toBe(3)
    expect(s.songs).toBe(1)
    expect(s.bookmarks).toBe(1)
    expect(s.songNotes).toBe(1)
    expect(s.mathNotebooks).toBe(2)
    expect(s.cloudAssets).toBe(1)
    expect(s.playlists).toBe(0)
  })

  it('mathPages 累加所有本子的页数', () => {
    const bundle = makeBundle({
      mathNotebooks: [
        { name: 'a', createdAt: 1, updatedAt: 2, pages: [{}, {}] as never },
        { name: 'b', createdAt: 1, updatedAt: 2, pages: [{}] as never },
      ],
    })
    expect(summarize(bundle).mathPages).toBe(3)
  })

  it('空备份各项为 0', () => {
    const s = summarize(makeBundle())
    expect(Object.values(s).every((v) => v === 0)).toBe(true)
  })
})

describe('downloadJson', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('创建可点击的下载链接并清理', () => {
    const clicks: string[] = []
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'a') {
        el.click = () => clicks.push((el as HTMLAnchorElement).download)
      }
      return el
    })

    downloadJson({ hello: 'world' }, 'test.json')
    expect(createObjectURL).toHaveBeenCalled()
    expect(clicks).toEqual(['test.json'])
    vi.unstubAllGlobals()
  })
})

describe('备份包结构', () => {
  it('版本号是正整数', () => {
    expect(Number.isInteger(BACKUP_VERSION)).toBe(true)
    expect(BACKUP_VERSION).toBeGreaterThan(0)
  })

  it('notIncluded 能说明未备份内容', () => {
    const bundle = makeBundle({ notIncluded: ['音乐音频文件（体积大）'] })
    expect(bundle.notIncluded[0]).toContain('音乐')
  })
})
