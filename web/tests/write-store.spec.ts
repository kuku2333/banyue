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
})
