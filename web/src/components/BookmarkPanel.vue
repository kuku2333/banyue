<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import {
  addLocalBookmark,
  deleteLocalBookmark,
  listLocalBookmarks,
  type LocalBookmark,
} from '@/lib/db'

interface CloudBookmark {
  id: string
  chapter: number
  chapterTitle: string
  ratio: number
  note: string
  createdAt: number
  owner: { username: string; displayName: string }
  mine: boolean
}

const props = defineProps<{
  open: boolean
  bookKey: string
  chapter: number
  chapterTitle: string
  ratio: number
}>()
const emit = defineEmits<{ 'update:open': [value: boolean]; jump: [chapter: number] }>()

const auth = useAuthStore()
const note = ref('')
const cloud = ref<CloudBookmark[]>([])
const mineLocal = ref<LocalBookmark[]>([])
const loading = ref(false)
const message = ref('')
const error = ref('')

type Row = {
  key: string
  id: string
  chapter: number
  chapterTitle: string
  ratio: number
  note: string
  owner: string
  mine: boolean
  local: boolean
}

const rows = computed<Row[]>(() => {
  const cloudRows: Row[] = cloud.value.map((item) => ({
    key: `c-${item.id}`,
    id: item.id,
    chapter: item.chapter,
    chapterTitle: item.chapterTitle,
    ratio: item.ratio,
    note: item.note,
    owner: item.owner.displayName,
    mine: item.mine,
    local: false,
  }))
  const localRows: Row[] = mineLocal.value.map((item) => ({
    key: `l-${item.id}`,
    id: item.id,
    chapter: item.chapter,
    chapterTitle: item.chapterTitle,
    ratio: item.ratio,
    note: item.note,
    owner: '本机',
    mine: true,
    local: true,
  }))
  return [...cloudRows, ...localRows].sort((a, b) => a.chapter - b.chapter || a.ratio - b.ratio)
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    mineLocal.value = await listLocalBookmarks(props.bookKey)
    if (auth.loggedIn) {
      const data = await api<{ bookmarks: CloudBookmark[] }>(`/api/books/${encodeURIComponent(props.bookKey)}/bookmarks`)
      cloud.value = data.bookmarks
    } else {
      cloud.value = []
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    message.value = ''
    note.value = ''
    await auth.ensure()
    await load()
  },
)

async function add(): Promise<void> {
  const text = note.value.trim()
  if (auth.loggedIn) {
    try {
      await api(`/api/books/${encodeURIComponent(props.bookKey)}/bookmarks`, {
        method: 'POST',
        body: {
          chapter: props.chapter,
          chapterTitle: props.chapterTitle,
          ratio: props.ratio,
          note: text,
        },
      })
      message.value = '已加到云端书签，别人也能看到'
    } catch (err) {
      error.value = (err as Error).message
      return
    }
  } else {
    await addLocalBookmark({
      id: `lb-${Date.now().toString(36)}`,
      bookKey: props.bookKey,
      chapter: props.chapter,
      chapterTitle: props.chapterTitle,
      ratio: props.ratio,
      note: text,
      createdAt: Date.now(),
    })
    message.value = auth.loggedIn ? '' : '已存在这台电脑上（登录后会变成公开书签）'
  }
  note.value = ''
  await load()
}

async function remove(row: Row): Promise<void> {
  if (row.local) {
    await deleteLocalBookmark(row.id)
  } else {
    await api(`/api/bookmarks/${row.id}`, { method: 'DELETE' })
  }
  await load()
}
</script>

<template>
  <Transition name="drawer">
    <aside v-if="open" class="bookmark-drawer">
      <header>
        <div>
          <h3>书签</h3>
          <p class="muted small">第 {{ chapter + 1 }} 章 · {{ Math.round(ratio * 100) }}%</p>
        </div>
        <button type="button" class="close" aria-label="关闭" @click="emit('update:open', false)">×</button>
      </header>

      <div class="add">
        <input v-model="note" maxlength="500" placeholder="写点什么（可留空）" aria-label="书签留言" @keyup.enter="add" />
        <button type="button" class="primary" @click="add">在此加书签</button>
      </div>
      <p class="hint muted small">
        {{ auth.loggedIn ? '书签是公开的：别人能看到是谁、在哪、写了什么。' : '未登录：书签只存在这台设备上。' }}
      </p>

      <p v-if="message" class="notice">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="loading" class="muted small">加载中…</p>

      <ol v-if="rows.length" class="marks">
        <li v-for="row in rows" :key="row.key">
          <button type="button" class="jump" @click="emit('jump', row.chapter)">
            <b>{{ row.chapterTitle || `第 ${row.chapter + 1} 章` }}</b>
            <span>{{ Math.round(row.ratio * 100) }}%</span>
          </button>
          <p v-if="row.note" class="note">{{ row.note }}</p>
          <div class="meta">
            <span class="who">{{ row.owner }}</span>
            <span v-if="row.local" class="tag">仅本机</span>
            <button v-if="row.mine" type="button" class="del" @click="remove(row)">删除</button>
          </div>
        </li>
      </ol>
      <p v-else-if="!loading" class="muted small">还没有书签。</p>
    </aside>
  </Transition>
</template>

<style scoped>
.bookmark-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(360px, 92vw);
  padding: 14px 16px;
  background: var(--r-bg, var(--bg));
  border-left: 1px solid var(--r-line, var(--line));
  box-shadow: -20px 0 40px rgba(0, 0, 0, 0.35);
  overflow-y: auto;
  z-index: 6;
  color: var(--r-fg, var(--text));
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

h3 {
  margin: 0 0 2px;
  font-size: 0.98rem;
}

.close {
  color: var(--r-dim, var(--dim));
  font-size: 1.2rem;
  line-height: 1;
}

.small {
  font-size: 0.74rem;
  margin: 0;
}

.add {
  display: flex;
  gap: 8px;
}

.add input {
  flex: 1;
  min-height: 38px;
  padding: 8px 11px;
  border-radius: 8px;
  border: 1px solid var(--r-line, var(--line));
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  outline: none;
}

.primary {
  min-height: 38px;
  padding: 0 12px;
  border-radius: 8px;
  background: linear-gradient(120deg, var(--accent), var(--accent-2));
  color: #06211d;
  font-weight: 600;
  font-size: 0.78rem;
}

.hint {
  margin: 8px 0 10px;
}

.notice {
  margin: 0 0 10px;
  color: var(--accent);
  font-size: 0.76rem;
}

.error {
  margin: 0 0 10px;
  color: var(--danger);
  font-size: 0.76rem;
}

.marks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.marks li {
  padding: 10px;
  border-radius: 9px;
  border: 1px solid var(--r-line, var(--line));
  background: rgba(255, 255, 255, 0.03);
}

.jump {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  text-align: left;
  color: inherit;
}

.jump b {
  font-size: 0.84rem;
  font-weight: 500;
}

.jump span {
  color: var(--r-dim, var(--dim));
  font-size: 0.72rem;
}

.note {
  margin: 6px 0;
  font-size: 0.82rem;
  line-height: 1.6;
  color: var(--r-fg, var(--text));
  white-space: pre-wrap;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--r-dim, var(--dim));
  font-size: 0.72rem;
}

.tag {
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--r-line, var(--line));
}

.del {
  margin-left: auto;
  color: var(--r-dim, var(--dim));
  font-size: 0.72rem;
}

.del:hover {
  color: var(--danger);
}
</style>
