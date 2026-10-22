<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useShelfStore } from '@/stores/shelf'
import CollectionPicker from '@/components/CollectionPicker.vue'
import { formatDate } from '@/lib/format'
import { formatCount } from '@/lib/format'

const shelf = useShelfStore()
const dragging = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const message = ref('')
const busy = ref(false)
const pickerOpen = ref(false)
const pickerItem = ref<{ key: string; title: string; subtitle: string } | null>(null)

function addToCollection(book: { id: string; title: string; author: string; words: number }): void {
  pickerItem.value = {
    key: book.id,
    title: book.title,
    subtitle: [book.author, `${book.words} 字`].filter(Boolean).join(' · '),
  }
  pickerOpen.value = true
}

onMounted(() => {
  void shelf.refresh()
})

async function handleFiles(files: FileList | File[] | null): Promise<void> {
  if (!files || busy.value) return
  const list = Array.from(files)
  if (!list.length) return
  busy.value = true
  message.value = `正在导入 ${list.length} 个文件…`
  try {
    const result = await shelf.importFiles(list)
    const parts = [`新增 ${result.added} 本`]
    if (result.skipped) parts.push(`跳过 ${result.skipped} 本`)
    if (result.failed.length) parts.push(`失败 ${result.failed.length} 个（${result.failed[0]!.reason}）`)
    message.value = parts.join(' · ')
  } finally {
    busy.value = false
    setTimeout(() => (message.value = ''), 4000)
  }
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  void handleFiles(event.dataTransfer?.files ?? null)
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  void handleFiles(input.files)
  input.value = ''
}

async function remove(id: string, title: string): Promise<void> {
  if (!window.confirm(`从书架删除《${title}》？本地文件也会一起删掉。`)) return
  await shelf.remove(id)
}

const totalWords = computed(() => shelf.books.reduce((sum, book) => sum + book.words, 0))
const finished = computed(() => shelf.books.filter((book) => (book.progress ?? 0) >= 0.999).length)
</script>

<template>
  <div class="shell">
    <div class="page-head">
      <span class="eyebrow">Shelf · 本地书架</span>
      <h1>书架</h1>
      <p>
        书只存在这台设备的浏览器里（IndexedDB），不上传、不需要登录。
        <template v-if="shelf.books.length">
          共 {{ shelf.books.length }} 本 · {{ formatCount(totalWords) }} 字 · 读完 {{ finished }} 本。
        </template>
      </p>
    </div>

    <div
      class="dropzone"
      :class="{ dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 16V4m0 0L7 9m5-5l5 5" />
        <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
      </svg>
      <b>把 TXT / Markdown 拖进来</b>
      <span class="muted">或者</span>
      <button type="button" class="btn" :disabled="busy" @click="inputRef?.click()">选择文件</button>
      <input id="shelf-file-input" ref="inputRef" type="file" accept=".txt,.md,.markdown,text/plain" multiple hidden @change="onPick" />
      <p class="muted small">自动识别 UTF-8 / GBK，按「第 X 章」切分，识别不到就按字数切节。</p>
    </div>

    <p v-if="message" class="notice">{{ message }}</p>

    <div v-if="shelf.loading" class="empty">正在读取书架…</div>

    <div v-else-if="!shelf.books.length" class="empty">
      <p>书架还是空的。</p>
      <p class="muted small">导入一本 TXT，阅读位置、主题、字号都会记住。</p>
    </div>

    <div v-else class="book-grid">
      <article v-for="book in shelf.books" :key="book.id" class="book-card">
        <RouterLink :to="`/read/${book.id}`" class="book-main">
          <div class="book-spine" :data-seed="book.id.slice(-2)">{{ book.title.slice(0, 1) }}</div>
          <div class="book-info">
            <h3>{{ book.title }}</h3>
            <p class="muted small">
              <template v-if="book.author">{{ book.author }} · </template>{{ formatCount(book.words) }} 字 ·
              {{ book.chapterCount }} 章
            </p>
            <div class="book-progress" :aria-label="`已读 ${Math.round((book.progress ?? 0) * 100)}%`">
              <i :style="{ width: `${Math.round((book.progress ?? 0) * 100)}%` }" />
            </div>
            <p class="muted small">
              {{ (book.progress ?? 0) > 0 ? `已读 ${Math.round((book.progress ?? 0) * 100)}%` : '还没开始' }}
              · 导入于 {{ formatDate(new Date(book.createdAt).toISOString().slice(0, 10)) }}
            </p>
          </div>
        </RouterLink>
        <button type="button" class="book-del" :aria-label="`删除《${book.title}》`" @click="remove(book.id, book.title)">
          删除
        </button>
        <button type="button" class="book-collect" @click="addToCollection(book)">收藏夹</button>
      </article>
    </div>

    <CollectionPicker
      :open="pickerOpen"
      type="books"
      :item="pickerItem"
      @update:open="pickerOpen = $event"
    />
  </div>
</template>

<style scoped>
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 36px 20px;
  border-radius: var(--radius);
  border: 1px dashed var(--line-strong);
  background: linear-gradient(160deg, rgba(94, 234, 212, 0.04), transparent 60%);
  text-align: center;
  transition: 0.18s ease;
}

.dropzone.dragging {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.dropzone svg {
  width: 26px;
  height: 26px;
  color: var(--accent);
}

.dropzone b {
  font-size: 1rem;
}

.small {
  font-size: 0.8rem;
  margin: 0;
}

.notice {
  margin: 14px 0 0;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.85rem;
}

.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
  margin-top: 22px;
}

.book-card {
  position: relative;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--card);
  transition: 0.18s ease;
}

.book-card:hover {
  border-color: var(--accent-line);
  transform: translateY(-2px);
}

.book-main {
  display: flex;
  gap: 16px;
  padding: 16px;
}

.book-spine {
  flex: none;
  display: grid;
  place-items: center;
  width: 54px;
  height: 74px;
  border-radius: 6px 10px 10px 6px;
  background: linear-gradient(150deg, rgba(94, 234, 212, 0.22), rgba(125, 211, 252, 0.08));
  border: 1px solid var(--accent-line);
  border-left-width: 4px;
  color: var(--accent);
  font-family: var(--serif);
  font-size: 1.3rem;
}

.book-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.book-info h3 {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.02rem;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.book-progress {
  height: 3px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.book-progress i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
}

.book-del {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--dim);
  font-size: 0.75rem;
  opacity: 0;
  transition: 0.15s ease;
}

.book-card:hover .book-del,
.book-del:focus-visible {
  opacity: 1;
}

.book-del:hover {
  color: var(--danger);
  background: rgba(251, 113, 133, 0.1);
}

.book-collect {
  position: absolute;
  bottom: 10px;
  right: 10px;
  padding: 3px 9px;
  border-radius: 7px;
  border: 1px solid var(--line);
  color: var(--dim);
  font-size: 0.72rem;
  opacity: 0;
  transition: 0.15s ease;
}

.book-card:hover .book-collect,
.book-collect:focus-visible {
  opacity: 1;
}

.book-collect:hover {
  color: var(--accent);
  border-color: var(--accent-line);
}
</style>
