<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useShelfStore } from '@/stores/shelf'
import { useAuthStore } from '@/stores/auth'
import CollectionPicker from '@/components/CollectionPicker.vue'
import BatchBar from '@/components/BatchBar.vue'
import { assetUrl, deleteAsset, formatSize, getStorage, listAssets, uploadAsset, type CloudAsset, type StorageUsage } from '@/lib/cloud'
import { cleanBookText, decodeText, splitChapters } from '@/lib/books'
import { getBook, putBook } from '@/lib/db'
import { formatDate, localDateStamp } from '@/lib/format'
import { formatCount } from '@/lib/format'

const shelf = useShelfStore()
const auth = useAuthStore()
const dragging = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const cloudInputRef = ref<HTMLInputElement | null>(null)
const message = ref('')
const busy = ref(false)
const pickerOpen = ref(false)
const pickerItem = ref<{ key: string; title: string; subtitle: string } | null>(null)

const cloudBooks = ref<CloudAsset[]>([])
const cloudLoading = ref(false)
const cloudBusy = ref('')
const cloudError = ref('')
const storage = ref<StorageUsage | null>(null)

async function loadCloud(): Promise<void> {
  cloudLoading.value = true
  cloudError.value = ''
  try {
    const [books, usage] = await Promise.all([listAssets('book'), getStorage()])
    cloudBooks.value = books
    storage.value = usage
  } catch (err) {
    cloudError.value = (err as Error).message
  } finally {
    cloudLoading.value = false
  }
}

/** 直接从磁盘选文件传到云端（不必先导入本地书架） */
async function onCloudPick(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  if (!auth.loggedIn) {
    auth.openDialog()
    return
  }
  cloudBusy.value = 'new'
  cloudError.value = ''
  let added = 0
  try {
    for (const file of files) {
      if (!/\.(txt|md|markdown)$/i.test(file.name)) {
        cloudError.value = `${file.name} 不是 TXT / Markdown`
        continue
      }
      await uploadAsset('book', file, {
        title: file.name.replace(/\.[^.]+$/, ''),
        filename: file.name,
      })
      added++
    }
    if (added) {
      message.value = `已上传 ${added} 本书到云端`
      setTimeout(() => (message.value = ''), 3000)
      await loadCloud()
    }
  } catch (err) {
    cloudError.value = (err as Error).message
  } finally {
    cloudBusy.value = ''
  }
}

/** 把本机的一本书上传到云端（用章节内容重新拼出文本） */
async function uploadBook(book: { id: string; title: string; author: string }): Promise<void> {
  if (!auth.loggedIn) {
    auth.openDialog()
    return
  }
  cloudBusy.value = book.id
  cloudError.value = ''
  try {
    const data = await getBook(book.id)
    if (!data) throw new Error('找不到这本书的内容')
    const text = data.chapters.map((chapter) => `${chapter.title}\n\n${chapter.content}`).join('\n\n')
    await uploadAsset('book', new Blob([text], { type: 'text/plain' }), {
      title: book.title,
      subtitle: book.author,
      filename: `${book.title}.txt`,
    })
    message.value = `已把《${book.title}》传到云端`
    setTimeout(() => (message.value = ''), 3000)
    await loadCloud()
  } catch (err) {
    cloudError.value = (err as Error).message
  } finally {
    cloudBusy.value = ''
  }
}

/** 从云端下载到本地书架，走与导入文件相同的分章流程 */
async function downloadBook(asset: CloudAsset): Promise<void> {
  cloudBusy.value = asset.id
  cloudError.value = ''
  try {
    const response = await fetch(assetUrl(asset.id))
    if (!response.ok) throw new Error(`下载失败（${response.status}）`)
    const buffer = await response.arrayBuffer()
    const { text, encoding } = decodeText(buffer)
    const cleaned = cleanBookText(text)
    const chapters = splitChapters(cleaned)
    const id = `${Date.now().toString(36)}-cloud`
    await putBook(
      {
        id,
        title: asset.title,
        author: asset.subtitle,
        format: 'txt',
        size: asset.size,
        words: cleaned.replace(/\s+/g, '').length,
        chapterCount: chapters.length,
        encoding,
        createdAt: Date.now(),
        progress: 0,
      },
      chapters,
    )
    await shelf.refresh()
    message.value = `《${asset.title}》已加入书架`
    setTimeout(() => (message.value = ''), 3000)
  } catch (err) {
    cloudError.value = (err as Error).message
  } finally {
    cloudBusy.value = ''
  }
}

async function removeCloud(asset: CloudAsset): Promise<void> {
  if (!window.confirm(`从云端删除《${asset.title}》？`)) return
  await deleteAsset(asset.id)
  await loadCloud()
}

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
  void loadCloud()
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

/* 批量删除（本地书架 / 云端书库） */
const selectMode = ref<'shelf' | 'cloud' | null>(null)
const selected = ref<string[]>([])
const batchBusy = ref(false)

function enterSelectMode(scope: 'shelf' | 'cloud'): void {
  selectMode.value = scope
  selected.value = []
}
function exitSelectMode(): void {
  selectMode.value = null
  selected.value = []
}
function isSelected(id: string): boolean {
  return selected.value.includes(id)
}
function toggleSelect(id: string): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((item) => item !== id)
    : [...selected.value, id]
}

const cloudDeletableIds = computed(() =>
  cloudBooks.value.filter((asset) => asset.mine || auth.user?.isAdmin).map((asset) => asset.id),
)
function currentIds(): string[] {
  return selectMode.value === 'cloud' ? cloudDeletableIds.value : shelf.books.map((book) => book.id)
}
function toggleAllCurrent(): void {
  const ids = currentIds()
  selected.value = selected.value.length >= ids.length ? [] : [...ids]
}

/** 批量删除：确认后按当前区删本地书或云端书 */
async function batchDelete(): Promise<void> {
  if (!selected.value.length || batchBusy.value) return
  const count = selected.value.length
  const isCloud = selectMode.value === 'cloud'
  if (!window.confirm(isCloud ? `从云端删除选中的 ${count} 本书？` : `从书架删除选中的 ${count} 本书？本地文件也会删掉。`)) {
    return
  }
  batchBusy.value = true
  try {
    if (isCloud) {
      for (const id of selected.value) {
        try {
          await deleteAsset(id)
        } catch {
          /* 单本失败继续 */
        }
      }
      await loadCloud()
    } else {
      for (const id of selected.value) await shelf.remove(id)
    }
    exitSelectMode()
  } catch (err) {
    cloudError.value = (err as Error).message
  } finally {
    batchBusy.value = false
  }
}

/** 批量模式下点卡片改为选中（不跳阅读页） */
function onCardClick(event: MouseEvent, id: string): void {
  if (!selectMode.value) return
  event.preventDefault()
  toggleSelect(id)
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
        默认只存在这台设备的浏览器里（IndexedDB）；登录后可以把书传到云端，别人也能下载。
        <template v-if="shelf.books.length">
          本地共 {{ shelf.books.length }} 本 · {{ formatCount(totalWords) }} 字 · 读完 {{ finished }} 本。
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
      <button
        v-if="shelf.books.length"
        type="button"
        class="btn"
        :class="{ on: selectMode === 'shelf' }"
        @click="selectMode === 'shelf' ? exitSelectMode() : enterSelectMode('shelf')"
      >
        {{ selectMode === 'shelf' ? '完成' : '批量管理' }}
      </button>
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
      <article
        v-for="book in shelf.books"
        :key="book.id"
        class="book-card"
        :class="{ selected: selectMode === 'shelf' && isSelected(book.id) }"
      >
        <RouterLink
          :to="`/read/${book.id}`"
          class="book-main"
          @click="onCardClick($event, book.id)"
        >
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
              · 导入于 {{ formatDate(localDateStamp(book.createdAt)) }}
            </p>
          </div>
          <label v-if="selectMode === 'shelf'" class="sel-check" @click.stop>
            <input type="checkbox" :checked="isSelected(book.id)" @change="toggleSelect(book.id)" />
          </label>
        </RouterLink>
        <template v-if="!selectMode">
          <button type="button" class="book-del" :aria-label="`删除《${book.title}》`" @click="remove(book.id, book.title)">
            删除
          </button>
          <button type="button" class="book-collect" @click="addToCollection(book)">收藏夹</button>
          <button
            type="button"
            class="book-cloud"
            :disabled="cloudBusy === book.id"
            @click="uploadBook(book)"
          >
            {{ cloudBusy === book.id ? '上传中…' : '传到云端' }}
          </button>
        </template>
      </article>
    </div>

    <div class="section-title cloud-head">
      <h2>云端书库</h2>
      <span class="muted small">
        公开 · 谁上传的都能看到
        <template v-if="storage">
          · 我的空间已用 {{ formatSize(storage.used) }} / {{ formatSize(storage.quota) }}
        </template>
      </span>
      <div class="cloud-actions">
        <input
          id="cloud-book-input"
          ref="cloudInputRef"
          type="file"
          accept=".txt,.md,.markdown,text/plain"
          multiple
          hidden
          @change="onCloudPick"
        />
        <button
          type="button"
          class="btn small-btn"
          :disabled="cloudBusy === 'new'"
          @click="auth.loggedIn ? cloudInputRef?.click() : auth.openDialog()"
        >
          {{ cloudBusy === 'new' ? '上传中…' : '上传书到云端' }}
        </button>
        <button
          v-if="cloudDeletableIds.length"
          type="button"
          class="btn small-btn"
          :class="{ on: selectMode === 'cloud' }"
          @click="selectMode === 'cloud' ? exitSelectMode() : enterSelectMode('cloud')"
        >
          {{ selectMode === 'cloud' ? '完成' : '批量管理' }}
        </button>
      </div>
    </div>
    <p v-if="cloudError" class="error">{{ cloudError }}</p>
    <p v-if="cloudLoading" class="muted small">正在加载云端书库…</p>
    <p v-else-if="!cloudBooks.length" class="muted small">云端还没有书。把书架里的书「传到云端」就会出现在这里。</p>
    <ul v-else class="cloud-list">
      <li
        v-for="asset in cloudBooks"
        :key="asset.id"
        :class="{ selected: selectMode === 'cloud' && isSelected(asset.id) }"
        @click="selectMode === 'cloud' && (asset.mine || auth.user?.isAdmin) && toggleSelect(asset.id)"
      >
        <label
          v-if="selectMode === 'cloud' && (asset.mine || auth.user?.isAdmin)"
          class="sel-check"
          @click.stop
        >
          <input type="checkbox" :checked="isSelected(asset.id)" @change="toggleSelect(asset.id)" />
        </label>
        <div class="cloud-main">
          <b>{{ asset.title }}</b>
          <span>
            {{ asset.subtitle || '未知作者' }} · {{ formatSize(asset.size) }} ·
            {{ asset.owner.displayName }}<template v-if="asset.mine">（我）</template>
          </span>
        </div>
        <template v-if="!selectMode">
          <button type="button" class="cloud-btn" :disabled="cloudBusy === asset.id" @click="downloadBook(asset)">
            {{ cloudBusy === asset.id ? '下载中…' : '下载到书架' }}
          </button>
          <button v-if="asset.mine || auth.user?.isAdmin" type="button" class="cloud-del" @click="removeCloud(asset)">
            删除
          </button>
        </template>
      </li>
    </ul>

    <CollectionPicker
      :open="pickerOpen"
      type="books"
      :item="pickerItem"
      @update:open="pickerOpen = $event"
    />

    <BatchBar
      v-if="selectMode"
      :count="selected.length"
      :total="currentIds().length"
      :busy="batchBusy"
      :label="selectMode === 'cloud' ? '云端删除' : '删除'"
      @toggle-all="toggleAllCurrent"
      @delete="batchDelete"
      @cancel="exitSelectMode"
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
  padding: 16px 16px 44px;
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

.book-cloud {
  position: absolute;
  bottom: 10px;
  right: 78px;
  padding: 3px 9px;
  border-radius: 7px;
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.72rem;
  opacity: 0.85;
  transition: 0.15s ease;
}

.book-cloud:hover {
  opacity: 1;
  color: var(--accent);
  border-color: var(--accent-line);
}

.cloud-head {
  margin-top: 40px;
  align-items: baseline;
  gap: 12px;
}

.cloud-head h2 {
  white-space: nowrap;
}

.cloud-head > span {
  margin-right: auto;
}

.cloud-actions {
  display: flex;
  gap: 8px;
}

.small-btn {
  padding: 6px 14px;
  font-size: 0.8rem;
}

.cloud-head .small-btn {
  margin-left: 10px;
}

.cloud-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--line);
}

.cloud-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 6px;
  border-bottom: 1px solid var(--line);
}

.cloud-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cloud-main b {
  font-size: 0.9rem;
  font-weight: 500;
}

.cloud-main span {
  color: var(--muted);
  font-size: 0.76rem;
}

.cloud-btn,
.cloud-del {
  padding: 5px 11px;
  border-radius: 8px;
  border: 1px solid var(--line);
  color: var(--text-2);
  font-size: 0.75rem;
}

.cloud-btn:hover {
  color: var(--accent);
  border-color: var(--accent-line);
}

.cloud-del {
  color: var(--dim);
}

.cloud-del:hover {
  color: var(--danger);
}

.error {
  color: var(--danger);
  font-size: 0.8rem;
}

/* 批量管理选中态 */
.book-card.selected,
.cloud-list li.selected {
  outline: 2px solid color-mix(in oklab, var(--accent, #38bdf8) 65%, transparent);
  background: color-mix(in oklab, var(--accent, #38bdf8) 10%, transparent);
}
.sel-check {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  padding: 2px;
  border-radius: 6px;
  background: color-mix(in oklab, var(--bg, #0b0f16) 70%, transparent);
  cursor: pointer;
}
.sel-check input {
  width: 18px;
  height: 18px;
  accent-color: var(--accent, #38bdf8);
  cursor: pointer;
}
.cloud-list li {
  position: relative;
}
</style>
