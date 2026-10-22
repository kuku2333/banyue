import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  deleteDraft,
  getDraft,
  listDrafts,
  putDraft,
  type DraftRecord,
} from '@/lib/db'
import { autoExcerpt, downloadText, newDraft, slugify, toPostMarkdown } from '@/lib/drafts'

export const useWriteStore = defineStore('write', () => {
  const drafts = ref<DraftRecord[]>([])
  const current = ref<DraftRecord | null>(null)
  const saving = ref(false)
  const savedAt = ref<number | null>(null)
  const dirty = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  /** 每次编辑都 +1：用它判断「这一份内容有没有被改过」，比 updatedAt 的毫秒精度可靠 */
  let editRevision = 0

  const words = computed(() => (current.value ? current.value.content.replace(/\s+/g, '').length : 0))

  async function refresh(): Promise<void> {
    drafts.value = await listDrafts()
  }

  async function open(id: string): Promise<void> {
    // 还压在 800ms 防抖里的改动先落盘，否则切到别的草稿就把它丢了
    if (timer) await saveNow()
    const draft = await getDraft(id)
    current.value = draft ?? null
    savedAt.value = draft?.updatedAt ?? null
    dirty.value = false
    editRevision = 0
  }

  async function create(): Promise<DraftRecord> {
    const draft = newDraft()
    await putDraft(draft)
    await refresh()
    current.value = draft
    savedAt.value = draft.updatedAt
    dirty.value = false
    editRevision = 0
    return draft
  }

  function update(patch: Partial<Pick<DraftRecord, 'title' | 'content' | 'tags' | 'excerpt'>>): void {
    if (!current.value) return
    Object.assign(current.value, patch, { updatedAt: Date.now() })
    editRevision += 1
    dirty.value = true
    scheduleSave()
  }

  function scheduleSave(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void saveNow()
    }, 800)
  }

  async function saveNow(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const draft = current.value
    if (!draft) return
    const revision = editRevision
    saving.value = true
    try {
      const snapshot: DraftRecord = {
        ...draft,
        excerpt: draft.excerpt.trim() || autoExcerpt(draft.content),
        updatedAt: Date.now(),
      }
      await putDraft(snapshot)
      // 保存是异步的：写盘期间用户可能还在敲字，别把旧快照盖回编辑器
      if (current.value?.id === snapshot.id && editRevision === revision) {
        current.value = snapshot
        savedAt.value = snapshot.updatedAt
        dirty.value = false
      }
      await refresh()
    } finally {
      saving.value = false
    }
  }

  async function remove(id: string): Promise<void> {
    await deleteDraft(id)
    if (current.value?.id === id) current.value = null
    await refresh()
  }

  /** 导出成可放进 src/content/posts/ 的 .md */
  function exportMarkdown(): string | null {
    if (!current.value) return null
    const markdown = toPostMarkdown(current.value)
    downloadText(`${slugify(current.value.title, current.value.createdAt)}.md`, markdown)
    return markdown
  }

  async function copyMarkdown(): Promise<boolean> {
    if (!current.value) return false
    try {
      await navigator.clipboard.writeText(toPostMarkdown(current.value))
      return true
    } catch {
      return false
    }
  }

  return {
    drafts,
    current,
    saving,
    savedAt,
    dirty,
    words,
    refresh,
    open,
    create,
    update,
    saveNow,
    remove,
    exportMarkdown,
    copyMarkdown,
  }
})
