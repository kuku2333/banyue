<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toParagraphs } from '@/lib/books'
import { getBook, saveProgress, type BookRecord } from '@/lib/db'
import { useReaderStore, READER_THEMES } from '@/stores/reader'
import type { Chapter } from '@/lib/books'

const route = useRoute()
const router = useRouter()
const settings = useReaderStore()

const bookId = computed(() => String(route.params.id ?? ''))
const book = ref<BookRecord | null>(null)
const chapters = ref<Chapter[]>([])
const chapterIndex = ref(0)
const loading = ref(true)
const notFound = ref(false)

const viewportEl = ref<HTMLElement | null>(null)
const columnsEl = ref<HTMLElement | null>(null)
const pageIndex = ref(0)
const pageCount = ref(1)
const pageWidth = ref(0)
const scrollRatio = ref(0)
const tocOpen = ref(false)
const settingsOpen = ref(false)
const chromeVisible = ref(true)

const COLUMN_GAP = 48

const chapter = computed(() => chapters.value[chapterIndex.value] ?? null)
const paragraphs = computed(() => (chapter.value ? toParagraphs(chapter.value.content) : []))
const overallProgress = computed(() => {
  if (!chapters.value.length) return 0
  const within = settings.mode === 'paged' ? pageIndex.value / Math.max(pageCount.value, 1) : scrollRatio.value
  return Math.min(1, (chapterIndex.value + within) / chapters.value.length)
})
const themeClass = computed(() => `theme-${settings.theme}`)
const pageStyle = computed(() => ({
  transform: `translateX(-${pageIndex.value * (pageWidth.value + COLUMN_GAP)}px)`,
  columnWidth: `${pageWidth.value}px`,
  columnGap: `${COLUMN_GAP}px`,
}))
const contentStyle = computed(() => ({
  fontSize: `${settings.fontSize}px`,
  lineHeight: String(settings.lineHeight),
  maxWidth: `${settings.columnWidth}rem`,
}))

let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!book.value) return
    const offset = settings.mode === 'paged' ? pageIndex.value / Math.max(pageCount.value, 1) : scrollRatio.value
    void saveProgress(book.value.id, chapterIndex.value, offset, overallProgress.value)
  }, 600)
}

function measurePages(reset = false): void {
  const viewport = viewportEl.value
  const columns = columnsEl.value
  if (!viewport || !columns) return
  pageWidth.value = viewport.clientWidth
  columns.style.height = `${viewport.clientHeight}px`
  pageCount.value = Math.max(1, Math.round((columns.scrollWidth + COLUMN_GAP) / (pageWidth.value + COLUMN_GAP)))
  if (reset) pageIndex.value = 0
  pageIndex.value = Math.min(pageIndex.value, pageCount.value - 1)
}

async function loadBook(): Promise<void> {
  loading.value = true
  const result = await getBook(bookId.value)
  if (!result) {
    notFound.value = true
    loading.value = false
    return
  }
  book.value = result.book
  chapters.value = result.chapters
  chapterIndex.value = Math.min(result.book.lastChapter ?? 0, Math.max(result.chapters.length - 1, 0))
  notFound.value = false
  loading.value = false
  await nextTick()
  measurePages()
  if (result.book.lastOffset) {
    if (settings.mode === 'paged') pageIndex.value = Math.round(result.book.lastOffset * (pageCount.value - 1))
    else {
      const viewport = viewportEl.value
      if (viewport) viewport.scrollTop = result.book.lastOffset * (viewport.scrollHeight - viewport.clientHeight)
    }
  }
}

function nextChapter(): void {
  if (chapterIndex.value < chapters.value.length - 1) {
    chapterIndex.value++
    pageIndex.value = 0
    scheduleSave()
  } else {
    scheduleSave()
  }
}

function turn(delta: number): void {
  if (settings.mode === 'paged') {
    const target = pageIndex.value + delta
    if (target >= 0 && target < pageCount.value) pageIndex.value = target
    else if (delta > 0) nextChapter()
    else if (chapterIndex.value > 0) {
      chapterIndex.value--
      nextTick().then(() => {
        measurePages()
        pageIndex.value = pageCount.value - 1
      })
    }
    scheduleSave()
    return
  }
  const viewport = viewportEl.value
  if (!viewport) return
  viewport.scrollBy({ top: delta * viewport.clientHeight * 0.9, behavior: 'smooth' })
}

function onScroll(): void {
  if (settings.mode !== 'scroll') return
  const viewport = viewportEl.value
  if (!viewport) return
  const max = viewport.scrollHeight - viewport.clientHeight
  scrollRatio.value = max > 0 ? Math.min(1, Math.max(0, viewport.scrollTop / max)) : 0
  scheduleSave()
}

function jumpTo(index: number): void {
  chapterIndex.value = index
  pageIndex.value = 0
  tocOpen.value = false
  nextTick(() => {
    measurePages(true)
    viewportEl.value?.scrollTo({ top: 0 })
  })
  scheduleSave()
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target && /input|textarea/i.test(target.tagName)) return
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case ' ':
      event.preventDefault()
      turn(1)
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      event.preventDefault()
      turn(-1)
      break
    case 'Escape':
      if (tocOpen.value || settingsOpen.value) {
        tocOpen.value = false
        settingsOpen.value = false
      } else {
        void router.push('/shelf')
      }
      break
  }
}

function onResize(): void {
  if (settings.mode === 'paged') measurePages()
}

watch(() => settings.mode, async () => {
  await nextTick()
  if (settings.mode === 'paged') measurePages(true)
  else viewportEl.value?.scrollTo({ top: 0 })
})

watch([() => settings.fontSize, () => settings.columnWidth, () => settings.lineHeight], async () => {
  await nextTick()
  if (settings.mode === 'paged') measurePages()
})

onMounted(() => {
  void loadBook()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  if (saveTimer) clearTimeout(saveTimer)
  if (book.value) {
    const offset = settings.mode === 'paged' ? pageIndex.value / Math.max(pageCount.value, 1) : scrollRatio.value
    void saveProgress(book.value.id, chapterIndex.value, offset, overallProgress.value)
  }
})
</script>

<template>
  <div v-if="loading" class="empty shell">正在打开…</div>

  <div v-else-if="notFound" class="empty shell">
    <h1>这本书不在书架上</h1>
    <RouterLink class="btn" to="/shelf">回书架</RouterLink>
  </div>

  <div v-else-if="book" class="reader" :class="themeClass">
    <header class="reader-bar" :class="{ hidden: !chromeVisible }">
      <button type="button" class="r-btn" aria-label="返回书架" @click="router.push('/shelf')">←</button>
      <div class="r-title">
        <b>{{ book.title }}</b>
        <span>{{ chapterIndex + 1 }} / {{ chapters.length }} · {{ chapter?.title }}</span>
      </div>
      <div class="r-actions">
        <button type="button" class="r-btn" :class="{ on: tocOpen }" @click="tocOpen = !tocOpen">目录</button>
        <button type="button" class="r-btn" :class="{ on: settingsOpen }" @click="settingsOpen = !settingsOpen">设置</button>
        <button type="button" class="r-btn" @click="settings.mode = settings.mode === 'paged' ? 'scroll' : 'paged'">
          {{ settings.mode === 'paged' ? '翻页' : '滚动' }}
        </button>
      </div>
    </header>

    <div
      ref="viewportEl"
      class="reader-viewport"
      :class="settings.mode"
      @scroll.passive="onScroll"
      @click="chromeVisible = !chromeVisible"
    >
      <div
        v-if="settings.mode === 'paged'"
        ref="columnsEl"
        class="reader-columns"
        :style="pageStyle"
        @click.stop
      >
        <div class="reader-content" :style="contentStyle">
          <h2>{{ chapter?.title }}</h2>
          <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
        </div>
      </div>

      <div v-else class="reader-scroll" @click.stop>
        <div class="reader-content" :style="contentStyle">
          <h2>{{ chapter?.title }}</h2>
          <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
        </div>
      </div>
    </div>

    <footer class="reader-foot">
      <button type="button" class="r-btn" :disabled="chapterIndex === 0 && pageIndex === 0" @click="turn(-1)">上一页</button>
      <div class="r-progress">
        <i :style="{ width: `${overallProgress * 100}%` }" />
        <span>{{ Math.round(overallProgress * 100) }}%</span>
      </div>
      <span v-if="settings.mode === 'paged'" class="r-pages">{{ pageIndex + 1 }} / {{ pageCount }}</span>
      <button type="button" class="r-btn" :disabled="chapterIndex === chapters.length - 1 && pageIndex >= pageCount - 1" @click="turn(1)">
        下一页
      </button>
    </footer>

    <Transition name="drawer">
      <aside v-if="tocOpen" class="toc-drawer">
        <header>
          <h3>目录</h3>
          <button type="button" class="r-btn" aria-label="关闭目录" @click="tocOpen = false">×</button>
        </header>
        <ol>
          <li v-for="(item, index) in chapters" :key="index">
            <button type="button" :class="{ on: index === chapterIndex }" @click="jumpTo(index)">
              <span>{{ String(index + 1).padStart(2, '0') }}</span>
              {{ item.title }}
            </button>
          </li>
        </ol>
      </aside>
    </Transition>

    <Transition name="drawer">
      <aside v-if="settingsOpen" class="settings-drawer">
        <header>
          <h3>阅读设置</h3>
          <button type="button" class="r-btn" aria-label="关闭设置" @click="settingsOpen = false">×</button>
        </header>

        <section>
          <h4>主题</h4>
          <div class="theme-row">
            <button
              v-for="item in READER_THEMES"
              :key="item.id"
              type="button"
              class="theme-dot"
              :class="[`dot-${item.id}`, { on: settings.theme === item.id }]"
              :title="item.hint"
              @click="settings.setTheme(item.id)"
            >
              {{ item.name }}
            </button>
          </div>
        </section>

        <section>
          <h4>字号</h4>
          <div class="stepper">
            <button type="button" class="r-btn" @click="settings.bumpFont(-1)">A−</button>
            <span>{{ settings.fontSize }} px</span>
            <button type="button" class="r-btn" @click="settings.bumpFont(1)">A+</button>
          </div>
        </section>

        <section>
          <h4>行距</h4>
          <div class="stepper">
            <button type="button" class="r-btn" @click="settings.bumpLineHeight(-0.1)">−</button>
            <span>{{ settings.lineHeight.toFixed(1) }}</span>
            <button type="button" class="r-btn" @click="settings.bumpLineHeight(0.1)">+</button>
          </div>
        </section>

        <section>
          <h4>版心</h4>
          <div class="stepper">
            <button type="button" class="r-btn" @click="settings.bumpWidth(-2)">窄</button>
            <span>{{ settings.columnWidth }} rem</span>
            <button type="button" class="r-btn" @click="settings.bumpWidth(2)">宽</button>
          </div>
        </section>

        <p class="hint">← → 翻页 · 空格下一页 · Esc 退出</p>
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
.reader {
  --r-bg: #0a0e13;
  --r-fg: #d7e0ea;
  --r-dim: #7d8b9c;
  --r-line: rgba(255, 255, 255, 0.08);
  --r-accent: #5eead4;
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  background: var(--r-bg);
  color: var(--r-fg);
}

.reader.theme-paper {
  --r-bg: #f6f1e7;
  --r-fg: #2f2a24;
  --r-dim: #8b8172;
  --r-line: rgba(0, 0, 0, 0.12);
  --r-accent: #a06a2c;
}

.reader.theme-green {
  --r-bg: #dfe8d6;
  --r-fg: #2b3527;
  --r-dim: #6c7a63;
  --r-line: rgba(0, 0, 0, 0.12);
  --r-accent: #4b7a3f;
}

.reader.theme-night {
  --r-bg: #05070a;
  --r-fg: #9aa6b2;
  --r-dim: #57616c;
  --r-line: rgba(255, 255, 255, 0.06);
  --r-accent: #6f8a9c;
}

.reader-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--r-line);
  transition: opacity 0.2s ease;
}

.reader-bar.hidden {
  opacity: 0;
  pointer-events: none;
}

.r-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-right: auto;
}

.r-title b {
  font-family: var(--serif);
  font-size: 0.95rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.r-title span {
  color: var(--r-dim);
  font-size: 0.72rem;
}

.r-actions {
  display: flex;
  gap: 6px;
}

.r-btn {
  padding: 6px 12px;
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid var(--r-line);
  color: var(--r-fg);
  font-size: 0.82rem;
  transition: 0.15s ease;
}

.r-btn:hover:not(:disabled),
.r-btn.on {
  color: var(--r-accent);
  border-color: var(--r-accent);
}

.r-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.reader-viewport {
  position: relative;
  flex: 1;
  overflow: hidden;
  padding: 0 4vw;
}

.reader-viewport.paged {
  display: block;
}

.reader-columns {
  height: 100%;
  column-fill: auto;
  transition: transform 0.32s cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: transform;
}

.reader-viewport.scroll {
  overflow-y: auto;
}

.reader-scroll {
  padding: 24px 0 40px;
}

.reader-content {
  margin: 0 auto;
  padding: 12px 0 24px;
  font-family: var(--serif);
  color: var(--r-fg);
}

.reader-content h2 {
  margin: 0 0 1.2em;
  font-size: 1.2em;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.reader-content p {
  margin: 0 0 1.05em;
  text-indent: 2em;
  text-align: justify;
}

.reader-foot {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  border-top: 1px solid var(--r-line);
}

.r-progress {
  position: relative;
  flex: 1;
  height: 3px;
  border-radius: 3px;
  background: var(--r-line);
  overflow: visible;
}

.r-progress i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--r-accent);
}

.r-progress span {
  position: absolute;
  right: 0;
  top: -20px;
  color: var(--r-dim);
  font-size: 0.7rem;
}

.toc-drawer,
.settings-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(340px, 88vw);
  background: var(--r-bg);
  border-left: 1px solid var(--r-line);
  box-shadow: -20px 0 40px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  z-index: 5;
}

.toc-drawer header,
.settings-drawer header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--r-line);
}

.toc-drawer h3,
.settings-drawer h3 {
  margin: 0;
  font-size: 0.95rem;
  white-space: nowrap;
}

.r-pages {
  color: var(--r-dim);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  min-width: 48px;
  text-align: right;
}

.toc-drawer ol {
  margin: 0;
  padding: 8px;
  list-style: none;
  overflow-y: auto;
}

.toc-drawer button {
  width: 100%;
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--r-fg);
  font-size: 0.84rem;
  text-align: left;
}

.toc-drawer button span {
  color: var(--r-dim);
  font-variant-numeric: tabular-nums;
}

.toc-drawer button:hover,
.toc-drawer button.on {
  background: color-mix(in srgb, var(--r-accent) 12%, transparent);
  color: var(--r-accent);
}

.settings-drawer section {
  padding: 14px 16px;
  border-bottom: 1px solid var(--r-line);
}

.settings-drawer h4 {
  margin: 0 0 10px;
  color: var(--r-dim);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.theme-row {
  display: flex;
  gap: 8px;
}

.theme-dot {
  flex: 1;
  padding: 10px 6px;
  border-radius: 8px;
  border: 1px solid var(--r-line);
  font-size: 0.85rem;
}

.theme-dot.dot-ink {
  background: #0a0e13;
  color: #d7e0ea;
}

.theme-dot.dot-paper {
  background: #f6f1e7;
  color: #2f2a24;
}

.theme-dot.dot-green {
  background: #dfe8d6;
  color: #2b3527;
}

.theme-dot.dot-night {
  background: #05070a;
  color: #9aa6b2;
}

.theme-dot.on {
  border-color: var(--r-accent);
  box-shadow: 0 0 0 1px var(--r-accent) inset;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stepper span {
  flex: 1;
  text-align: center;
  font-size: 0.85rem;
  color: var(--r-dim);
}

.hint {
  margin: auto 0 0;
  padding: 14px 16px;
  color: var(--r-dim);
  font-size: 0.75rem;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.24s ease, opacity 0.24s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

@media (max-width: 767px) {
  .r-actions .r-btn {
    padding: 6px 9px;
    font-size: 0.76rem;
  }

  .r-title b {
    font-size: 0.85rem;
  }

  .reader-viewport {
    padding: 0 20px;
  }
}
</style>
