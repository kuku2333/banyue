<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { renderMarkdown } from '@/lib/markdown'
import { useWriteStore } from '@/stores/write'
import { formatDate } from '@/lib/format'

const route = useRoute()
const router = useRouter()
const store = useWriteStore()

const textarea = ref<HTMLTextAreaElement | null>(null)
const mobilePane = ref<'edit' | 'preview'>('edit')
const toast = ref('')
const ready = ref(false)

const preview = computed(() => renderMarkdown(store.current?.content ?? '').html)
const savedLabel = computed(() => {
  if (store.saving) return '保存中…'
  if (!store.savedAt) return '尚未保存'
  return `已保存 ${new Date(store.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
})

function flash(message: string): void {
  toast.value = message
  setTimeout(() => (toast.value = ''), 2200)
}

async function ensureDraft(): Promise<void> {
  const id = String(route.params.id ?? '')
  if (id) {
    await store.open(id)
    if (!store.current) {
      flash('这份草稿不存在了')
      await router.replace('/write')
    }
  } else if (store.drafts.length) {
    await router.replace(`/write/${store.drafts[0]!.id}`)
    return
  }
  ready.value = true
}

async function createDraft(): Promise<void> {
  const draft = await store.create()
  await router.push(`/write/${draft.id}`)
  await nextTick()
  textarea.value?.focus()
}

async function openDraft(id: string): Promise<void> {
  await router.push(`/write/${id}`)
}

function onInput(): void {
  if (!store.current) return
  store.update({ content: textarea.value?.value ?? '' })
}

function onTitle(event: Event): void {
  store.update({ title: (event.target as HTMLInputElement).value })
}

function onTags(event: Event): void {
  store.update({ tags: (event.target as HTMLInputElement).value })
}

async function save(): Promise<void> {
  await store.saveNow()
  flash('已保存')
}

function exportMarkdown(): void {
  const markdown = store.exportMarkdown()
  if (markdown) flash('已导出 .md，可直接放进 src/content/posts/')
}

async function copyMarkdown(): Promise<void> {
  const ok = await store.copyMarkdown()
  flash(ok ? '已复制 Markdown 到剪贴板' : '复制失败，请手动导出')
}

async function remove(): Promise<void> {
  if (!store.current) return
  if (!window.confirm('删除这份草稿？删除后无法恢复。')) return
  await store.remove(store.current.id)
  await router.push('/write')
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void save()
  }
}

function onTab(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return
  event.preventDefault()
  const el = textarea.value
  if (!el) return
  const start = el.selectionStart
  const end = el.selectionEnd
  const value = el.value
  el.value = `${value.slice(0, start)}  ${value.slice(end)}`
  el.selectionStart = el.selectionEnd = start + 2
  store.update({ content: el.value })
}

watch(
  () => route.params.id,
  async () => {
    if (route.name !== 'write') return
    ready.value = false
    await store.refresh()
    await ensureDraft()
  },
)

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await store.refresh()
  await ensureDraft()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (store.dirty) void store.saveNow()
})
</script>

<template>
  <div class="write-shell">
    <aside class="draft-rail">
      <div class="rail-head">
        <b>草稿</b>
        <button type="button" class="icon-btn" aria-label="新建草稿" @click="createDraft">+</button>
      </div>
      <ul v-if="store.drafts.length">
        <li v-for="draft in store.drafts" :key="draft.id">
          <button
            type="button"
            class="draft-item"
            :class="{ on: draft.id === store.current?.id }"
            @click="openDraft(draft.id)"
          >
            <b>{{ draft.title.trim() || '未命名草稿' }}</b>
            <span>{{ formatDate(new Date(draft.updatedAt).toISOString().slice(0, 10), 'short') }} · {{ draft.content.replace(/\s+/g, '').length }} 字</span>
          </button>
        </li>
      </ul>
      <p v-else class="rail-empty">还没有草稿</p>
    </aside>

    <section v-if="store.current" class="editor">
      <header class="editor-head">
        <input
          class="title-input"
          :value="store.current.title"
          placeholder="标题"
          aria-label="标题"
          @input="onTitle"
        />
        <div class="editor-actions">
          <span class="save-state" :class="{ dirty: store.dirty }">{{ savedLabel }}</span>
          <button type="button" class="btn tiny" @click="save">保存</button>
          <button type="button" class="btn tiny" @click="exportMarkdown">导出 .md</button>
          <button type="button" class="btn tiny" @click="copyMarkdown">复制</button>
          <button type="button" class="btn tiny danger" @click="remove">删除</button>
        </div>
      </header>

      <div class="editor-meta">
        <input
          class="tags-input"
          :value="store.current.tags"
          placeholder="标签，逗号分隔（可选）"
          aria-label="标签"
          @input="onTags"
        />
        <span class="muted small">{{ store.words }} 字 · 自动保存已开启</span>
      </div>

      <div class="pane-switch">
        <button type="button" :class="{ on: mobilePane === 'edit' }" @click="mobilePane = 'edit'">编辑</button>
        <button type="button" :class="{ on: mobilePane === 'preview' }" @click="mobilePane = 'preview'">预览</button>
      </div>

      <div class="panes" :class="mobilePane">
        <textarea
          ref="textarea"
          class="editor-area"
          :value="store.current.content"
          placeholder="开始写吧。支持 Markdown：## 标题、**加粗**、> 引用、`代码`、- 列表…"
          spellcheck="false"
          @input="onInput"
          @keydown="onTab"
        />
        <!-- 预览只渲染白名单标签，原始 HTML 会被转义 -->
        <article class="preview prose" v-html="preview" />
      </div>
    </section>

    <section v-else-if="ready" class="empty write-empty">
      <h1>写作台</h1>
      <p>草稿只存在这台设备上，不需要登录。停手两秒会自动保存。</p>
      <button type="button" class="btn btn--solid" @click="createDraft">写第一篇</button>
    </section>

    <Transition name="toast">
      <p v-if="toast" class="toast">{{ toast }}</p>
    </Transition>
  </div>
</template>

<style scoped>
.write-shell {
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr);
  gap: 0;
  min-height: calc(100dvh - 64px);
  border-top: 1px solid var(--line);
}

.draft-rail {
  border-right: 1px solid var(--line);
  padding: 16px 10px;
  overflow-y: auto;
  max-height: calc(100dvh - 64px);
}

.rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 10px;
}

.rail-head b {
  font-size: 0.85rem;
}

.rail-head .icon-btn {
  width: 30px;
  height: 30px;
  font-size: 1.1rem;
}

.draft-rail ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.draft-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 10px;
  border-radius: 9px;
  text-align: left;
  line-height: 1.4;
}

.draft-item b {
  font-size: 0.82rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.draft-item span {
  color: var(--dim);
  font-size: 0.7rem;
}

.draft-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.draft-item.on {
  background: var(--accent-soft);
}

.draft-item.on b {
  color: var(--accent);
}

.rail-empty {
  padding: 20px 10px;
  color: var(--dim);
  font-size: 0.8rem;
  text-align: center;
}

.editor {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 18px 22px 0;
  height: calc(100dvh - 64px);
}

.editor-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.title-input {
  flex: 1;
  min-width: 200px;
  border: none;
  background: none;
  color: var(--text);
  font-family: var(--serif);
  font-size: 1.4rem;
  outline: none;
}

.title-input::placeholder {
  color: var(--dim);
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.save-state {
  color: var(--dim);
  font-size: 0.72rem;
  margin-right: 4px;
}

.save-state.dirty {
  color: var(--accent);
}

.btn.tiny {
  padding: 5px 10px;
  font-size: 0.75rem;
  border-radius: 8px;
}

.btn.tiny.danger:hover {
  color: var(--danger);
  border-color: rgba(251, 113, 133, 0.4);
}

.editor-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 10px 0;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}

.tags-input {
  flex: 1;
  border: none;
  background: none;
  color: var(--text-2);
  font-size: 0.8rem;
  outline: none;
}

.small {
  font-size: 0.72rem;
}

.pane-switch {
  display: none;
  gap: 6px;
  margin-bottom: 8px;
}

.pane-switch button {
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  font-size: 0.78rem;
  color: var(--muted);
}

.pane-switch button.on {
  color: var(--accent);
  border-color: var(--accent-line);
  background: var(--accent-soft);
}

.panes {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
  padding-bottom: 18px;
}

.editor-area {
  width: 100%;
  height: 100%;
  min-height: 320px;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-2);
  font-family: var(--mono);
  font-size: 0.9rem;
  line-height: 1.85;
  padding: 4px 2px;
}

.preview {
  overflow-y: auto;
  border-left: 1px solid var(--line);
  padding-left: 18px;
  font-size: 0.95rem;
  max-width: none;
}

.write-empty {
  grid-column: 1 / -1;
  padding: 12vh 0;
  text-align: center;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 95;
  margin: 0;
  padding: 10px 18px;
  border-radius: 999px;
  border: 1px solid var(--accent-line);
  background: rgba(14, 20, 27, 0.95);
  color: var(--accent);
  font-size: 0.82rem;
  box-shadow: var(--shadow);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (max-width: 1023px) {
  .write-shell {
    grid-template-columns: 1fr;
  }

  .draft-rail {
    border-right: none;
    border-bottom: 1px solid var(--line);
    max-height: 168px;
  }

  .editor {
    height: auto;
    min-height: calc(100dvh - 64px);
  }

  .pane-switch {
    display: flex;
  }

  .panes {
    grid-template-columns: 1fr;
  }

  .panes.edit .preview {
    display: none;
  }

  .panes.preview .editor-area {
    display: none;
  }

  .preview {
    border-left: none;
    padding-left: 0;
  }
}
</style>
