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
const stripEl = ref<HTMLElement | null>(null)
const pageIndex = ref(0)
const pageCount = ref(1)
const pageWidth = ref(0)
const pageHeight = ref(0)
const scrollRatio = ref(0)
const tocOpen = ref(false)
const settingsOpen = ref(false)
const chromeVisible = ref(true)

const COLUMN_GAP = 64
const FLIP_MS = 620

type FlipDir = 'fwd' | 'bwd'

/** 3D 翻页状态：正在翻的那一页与它的角度 */
const flipping = ref<{ dir: FlipDir } | null>(null)
const angle = ref(0)
const dragging = ref(false)

const chapter = computed(() => chapters.value[chapterIndex.value] ?? null)
const paragraphs = computed(() => (chapter.value ? toParagraphs(chapter.value.content) : []))
const overallProgress = computed(() => {
  if (!chapters.value.length) return 0
  const within = settings.mode === 'paged' ? pageIndex.value / Math.max(pageCount.value, 1) : scrollRatio.value
  return Math.min(1, (chapterIndex.value + within) / chapters.value.length)
})
const themeClass = computed(() => `theme-${settings.theme}`)
const contentStyle = computed(() => ({
  fontSize: `${settings.fontSize}px`,
  lineHeight: String(settings.lineHeight),
  maxWidth: `${settings.columnWidth}rem`,
}))

/** 翻页时底层要显示「即将露出来的那一页」 */
const basePage = computed(() => {
  if (!flipping.value) return pageIndex.value
  return flipping.value.dir === 'fwd' ? pageIndex.value + 1 : pageIndex.value
})
/** 正在翻转的页：向前翻是当前页，向后翻是上一页 */
const leafPage = computed(() => {
  if (!flipping.value || flipping.value.dir === 'fwd') return pageIndex.value
  return Math.max(0, pageIndex.value - 1)
})
const leafVisible = computed(() => Boolean(flipping.value) && leafPage.value !== basePage.value)

function stripStyle(page: number): Record<string, string> {
  return {
    transform: `translateX(-${page * (pageWidth.value + COLUMN_GAP)}px)`,
    columnWidth: `${pageWidth.value}px`,
    columnGap: `${COLUMN_GAP}px`,
    height: `${pageHeight.value}px`,
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let flipTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!book.value) return
    const offset = settings.mode === 'paged' ? pageIndex.value / Math.max(pageCount.value, 1) : scrollRatio.value
    void saveProgress(book.value.id, chapterIndex.value, offset, overallProgress.value)
  }, 600)
}

async function measurePages(reset = false): Promise<void> {
  const viewport = viewportEl.value
  const strip = stripEl.value
  if (!viewport || !strip) return
  pageWidth.value = viewport.clientWidth
  pageHeight.value = viewport.clientHeight
  await nextTick()
  pageCount.value = Math.max(
    1,
    Math.round((strip.scrollWidth + COLUMN_GAP) / (pageWidth.value + COLUMN_GAP)),
  )
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
  await measurePages()
  if (result.book.lastOffset) {
    if (settings.mode === 'paged') pageIndex.value = Math.round(result.book.lastOffset * (pageCount.value - 1))
    else {
      const viewport = viewportEl.value
      if (viewport) viewport.scrollTop = result.book.lastOffset * (viewport.scrollHeight - viewport.clientHeight)
    }
  }
}

function commitFlip(): void {
  if (!flipping.value) return
  if (flipping.value.dir === 'fwd') pageIndex.value = Math.min(pageIndex.value + 1, pageCount.value - 1)
  else pageIndex.value = Math.max(pageIndex.value - 1, 0)
  flipping.value = null
  angle.value = 0
  scheduleSave()
}

function startFlip(dir: FlipDir): void {
  if (flipping.value) return
  if (flipTimer) clearTimeout(flipTimer)
  flipping.value = { dir }
  angle.value = dir === 'fwd' ? 0 : -180
  void nextTick(() => {
    // 等两帧：先让起始角度画出来，再改终点角度才会触发 transition
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        angle.value = dir === 'fwd' ? -180 : 0
        flipTimer = setTimeout(commitFlip, FLIP_MS)
      })
    })
  })
}

async function goPrevChapter(): Promise<void> {
  if (chapterIndex.value <= 0) return
  chapterIndex.value--
  flipping.value = null
  angle.value = 0
  await nextTick()
  await measurePages()
  pageIndex.value = pageCount.value - 1
  scheduleSave()
}

function goNextChapter(): void {
  if (chapterIndex.value >= chapters.value.length - 1) {
    scheduleSave()
    return
  }
  chapterIndex.value++
  pageIndex.value = 0
  flipping.value = null
  angle.value = 0
  void nextTick(() => measurePages(true))
  scheduleSave()
}

async function turn(delta: number): Promise<void> {
  if (settings.mode !== 'paged') {
    const viewport = viewportEl.value
    if (!viewport) return
    viewport.scrollBy({ top: delta * viewport.clientHeight * 0.9, behavior: 'smooth' })
    return
  }
  if (flipping.value) return
  if (delta > 0) {
    if (pageIndex.value + 1 < pageCount.value) startFlip('fwd')
    else goNextChapter()
  } else if (pageIndex.value > 0) {
    startFlip('bwd')
  } else {
    await goPrevChapter()
  }
}

/* ---------------- 跟手拖拽翻页 ---------------- */

let dragStartX = 0
let dragWidth = 1
let dragDir: FlipDir | null = null
let suppressClick = false

function onPointerDown(event: PointerEvent): void {
  if (settings.mode !== 'paged' || flipping.value) return
  dragStartX = event.clientX
  dragWidth = Math.max(viewportEl.value?.clientWidth ?? 1, 1)
  dragDir = null
  suppressClick = false
  dragging.value = true
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function detachDrag(): void {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const dx = event.clientX - dragStartX
  if (!dragDir) {
    if (Math.abs(dx) < 6) return
    const forward = dx < 0
    if (forward && pageIndex.value + 1 >= pageCount.value) return
    if (!forward && pageIndex.value <= 0) return
    dragDir = forward ? 'fwd' : 'bwd'
    suppressClick = true
    flipping.value = { dir: dragDir }
    angle.value = dragDir === 'fwd' ? 0 : -180
  }
  const progress = Math.min(1, Math.abs(dx) / dragWidth)
  angle.value = dragDir === 'fwd' ? -180 * progress : -180 * (1 - progress)
}

function onPointerUp(): void {
  detachDrag()
  if (!dragging.value) return
  dragging.value = false
  if (!flipping.value || !dragDir) {
    suppressClick = false
    return
  }
  const progress = Math.abs(angle.value) / 180
  const done = dragDir === 'fwd' ? progress > 0.28 : progress < 0.72
  if (done) {
    angle.value = dragDir === 'fwd' ? -180 : 0
    flipTimer = setTimeout(commitFlip, FLIP_MS * 0.55)
  } else {
    angle.value = dragDir === 'fwd' ? 0 : -180
    flipTimer = setTimeout(() => {
      flipping.value = null
      angle.value = 0
    }, FLIP_MS * 0.55)
  }
  dragDir = null
  setTimeout(() => (suppressClick = false), 60)
}

/** 点击左右区域翻页；刚拖拽过就不算点击 */
function tapTurn(delta: number): void {
  if (suppressClick) return
  void turn(delta)
}

function onScroll(): void {
  if (settings.mode !== 'scroll') return
  const viewport = viewportEl.value
  if (!viewport) return
  const max = viewport.scrollHeight - viewport.clientHeight
  scrollRatio.value = max > 0 ? Math.min(1, Math.max(0, viewport.scrollTop / max)) : 0
  scheduleSave()
}

async function jumpTo(index: number): Promise<void> {
  chapterIndex.value = index
  pageIndex.value = 0
  flipping.value = null
  angle.value = 0
  tocOpen.value = false
  await nextTick()
  await measurePages(true)
  viewportEl.value?.scrollTo({ top: 0 })
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
    >
      <div
        v-if="settings.mode === 'paged'"
        class="book"
        @pointerdown="onPointerDown"
      >
        <div class="page base">
          <div class="clip">
            <div ref="stripEl" class="strip" :style="stripStyle(basePage)">
              <div class="reader-content" :style="contentStyle">
                <h2>{{ chapter?.title }}</h2>
                <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
              </div>
            </div>
          </div>
          <span class="page-shade" />
        </div>

        <div
          v-if="leafVisible"
          class="page leaf"
          :class="{ dragging }"
          :style="{ transform: `rotateY(${angle}deg)` }"
        >
          <div class="clip">
            <div class="strip" :style="stripStyle(leafPage)">
              <div class="reader-content" :style="contentStyle">
                <h2>{{ chapter?.title }}</h2>
                <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
              </div>
            </div>
          </div>
          <span class="page-curl" />
        </div>

        <div class="hit-area">
          <button type="button" class="tap left" aria-label="上一页" @click="tapTurn(-1)" />
          <button type="button" class="tap mid" aria-label="显示/隐藏工具栏" @click="chromeVisible = !chromeVisible" />
          <button type="button" class="tap right" aria-label="下一页" @click="tapTurn(1)" />
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
  --paper: #151f2b;
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
  --paper: #fbf7ef;
}

.reader.theme-green {
  --r-bg: #dfe8d6;
  --r-fg: #2b3527;
  --r-dim: #6c7a63;
  --r-line: rgba(0, 0, 0, 0.12);
  --r-accent: #4b7a3f;
  --paper: #e6eedd;
}

.reader.theme-night {
  --r-bg: #05070a;
  --r-fg: #9aa6b2;
  --r-dim: #57616c;
  --r-line: rgba(255, 255, 255, 0.06);
  --r-accent: #6f8a9c;
  --paper: #080b10;
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

.reader-viewport.scroll {
  overflow-y: auto;
}

/* ---------- 3D 翻书 ---------- */

.book {
  position: relative;
  height: 100%;
  perspective: 2600px;
  perspective-origin: 50% 50%;
  touch-action: pan-y;
}

.page {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--paper, #121a26);
  border-radius: 3px;
}

.page.base {
  box-shadow: inset -26px 0 46px -30px rgba(0, 0, 0, 0.55);
}

/* 右侧书页边缘 + 左侧书脊，单页也有「书」的厚度 */
.page.base::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 7px;
  background: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.06) 0 1px, transparent 1px 3px);
  opacity: 0.7;
  pointer-events: none;
}

.book::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 30px;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.45), transparent);
  z-index: 3;
  pointer-events: none;
}

/* 3D 变换会让 overflow 失效，内容统一放在独立裁剪层 */
.clip {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 3px;
}

.strip {
  column-fill: auto;
  will-change: transform;
}

.leaf {
  transform-origin: left center;
  /* 不用 preserve-3d，否则 overflow 裁剪失效，翻页时文字会溢出页外 */
  backface-visibility: hidden;
  transition: transform 0.62s cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: transform;
  box-shadow:
    -14px 0 34px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.05);
  cursor: grab;
}

.leaf.dragging {
  transition: none;
  cursor: grabbing;
}

.page-shade {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.16), transparent 8%, transparent 88%, rgba(0, 0, 0, 0.22));
  opacity: 0.55;
}

.page-curl {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.22), transparent 12%);
}

.hit-area {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 26% 48% 26%;
}

.hit-area .tap {
  border: none;
  background: transparent;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.reader-scroll {
  padding: 24px 0 40px;
}

.reader-content {
  margin: 0 auto;
  padding: 26px 0 30px;
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
