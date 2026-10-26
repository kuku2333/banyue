import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DraftRecord } from '@/lib/db'

const drafts = new Map<string, DraftRecord>()

vi.mock('@/lib/db', () => ({
  listDrafts: async () => [...drafts.values()].sort((a, b) => b.updatedAt - a.updatedAt),
  // Dexie 每次读出来都是新对象，这里也返回副本，避免测试里「改内存就等于写盘」
  getDraft: async (id: string) => {
    const draft = drafts.get(id)
    return draft ? { ...draft } : undefined
  },
  putDraft: async (draft: DraftRecord) => {
    drafts.set(draft.id, { ...draft })
  },
  deleteDraft: async (id: string) => {
    drafts.delete(id)
  },
}))

const { useWriteStore } = await import('@/stores/write')

function seed(id: string, content: string): DraftRecord {
  const now = Date.now()
  const draft: DraftRecord = { id, title: id, content, tags: '', excerpt: '', createdAt: now, updatedAt: now }
  drafts.set(id, draft)
  return draft
}

describe('写作台自动保存', () => {
  beforeEach(() => {
    drafts.clear()
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('切换草稿前会把防抖里的改动写盘', async () => {
    seed('a', '原来的内容')
    seed('b', '另一份')
    const store = useWriteStore()
    await store.open('a')

    store.update({ content: '刚敲进去的一整段' })
    expect(drafts.get('a')?.content).toBe('原来的内容')

    // 不等 800ms 防抖，直接切走
    await store.open('b')

    expect(drafts.get('a')?.content).toBe('刚敲进去的一整段')
    expect(store.current?.id).toBe('b')
    expect(store.dirty).toBe(false)
  })

  it('保存期间继续输入不会把新内容盖回旧快照', async () => {
    seed('c', '初始')
    const store = useWriteStore()
    await store.open('c')

    store.update({ content: '第一版' })
    const saving = store.saveNow()
    // 模拟保存请求还没回来时用户又敲了字
    store.update({ content: '第一版 + 第二版' })
    await saving

    expect(drafts.get('c')?.content).toBe('第一版')
    expect(store.current?.content).toBe('第一版 + 第二版')
    expect(store.dirty).toBe(true)
  })

  it('崩溃兜底：镜像比库新时 open 用镜像覆盖', async () => {
    seed('d', '库里的旧版')
    const store = useWriteStore()
    await store.open('d')

    // 编辑后只写了镜像（模拟关页时 IndexedDB 没落盘）
    store.update({ content: '最后敲的字，还没防抖落库' })
    expect(drafts.get('d')?.content).toBe('库里的旧版')

    // 重新打开这份草稿，应拿镜像覆盖旧库内容
    await store.open('d')
    expect(store.current?.content).toBe('最后敲的字，还没防抖落库')
    expect(drafts.get('d')?.content).toBe('最后敲的字，还没防抖落库')

    // 镜像已被消费掉，不会重复恢复
    await store.open('d')
    expect(store.current?.content).toBe('最后敲的字，还没防抖落库')
    expect(localStorage.getItem('banyue:draft-mirror')).toBeNull()
  })

  it('干净落库后会清掉镜像', async () => {
    seed('e', '内容')
    const store = useWriteStore()
    await store.open('e')
    store.update({ content: '改一下' })
    await store.saveNow()
    expect(localStorage.getItem('banyue:draft-mirror')).toBeNull()
    expect(drafts.get('e')?.content).toBe('改一下')
  })
})
