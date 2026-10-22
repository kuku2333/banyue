<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toParagraphs } from '@/lib/books'
import { getBook, saveProgress, type BookRecord } from '@/lib/db'
import { useReaderStore, READER_THEMES } from '@/stores/reader'
import { usePlayerStore } from '@/stores/player'
import { useAuthStore } from '@/stores/auth'
import { bookKeyFor } from '@/lib/keys'
import {
  deleteParagraphComment,
  fetchChapterComments,
  fetchLocalParagraphNotes,
  paragraphKey,
  postParagraphComment,
  type ParagraphComment,
} from '@/lib/paragraph-comments'
import BookmarkPanel from '@/components/BookmarkPanel.vue'
import ParagraphLine from '@/components/ParagraphLine.vue'
import ParagraphCommentDialog from '@/components/ParagraphCommentDialog.vue'
import type { Chapter } from '@/lib/books'

const route = useRoute()
const router = useRouter()
const settings = useReaderStore()
const player = usePlayerStore()
const auth = useAuthStore()
const bookmarkOpen = ref(false)

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

const GUTTER = 56
const FLIP_MS = 620
const SPREAD_MIN_WIDTH = 900

type FlipDir = 'fwd' | 'bwd'

/** 3D 翻页状态：正在翻的那一页与它的角度 */
const flipping = ref<{ dir: FlipDir } | null>(null)
const angle = ref(0)
const dragging = ref(false)
const viewportWidth = ref(0)

const chapter = computed(() => chapters.value[chapterIndex.value] ?? null)
const paragraphs = computed(() => (chapter.value ? toParagraphs(chapter.value.content) : []))
const overallProgress = computed(() => {
  if (!chapters.value.length) return 0
  const within =
    settings.mode === 'paged' ? pageIndex.value / Math.max(pageCount.value, 1) : scrollRatio.value
  return Math.min(1, (chapterIndex.value + within) / chapters.value.length)
})
const themeClass = computed(() => `theme-${settings.theme}`)
const bookmarkKey = computed(() =>
  book.value ? bookKeyFor({ title: book.value.title, author: book.value.author, words: book.value.words }) : '',
)
const bookmarkRatio = computed(() =>
  settings.mode === 'paged' ? pageIndex.value / Math.max(pageCount.value, 1) : scrollRatio.value,
)

/* 段落评论：key = chapter:paragraph，云端公开 + 未登录仅本机 */
const paragraphComments = ref<Record<string, ParagraphComment[]>>({})

async function loadParagraphComments(): Promise<void> {
  const key = bookmarkKey.value
  const chapterNo = chapterIndex.value
  const total = paragraphs.value.length
  const [cloud, local] = await Promise.all([
    fetchChapterComments(key, chapterNo),
    fetchLocalParagraphNotes(
      key,
      chapterNo,
      Array.from({ length: total }, (_, i) => i),
    ),
  ])
  // 异步返回时可能已切章/切书，丢弃过期结果
  if (key !== bookmarkKey.value || chapterNo !== chapterIndex.value) return
  const map: Record<string, ParagraphComment[]> = {}
  for (const comment of [...cloud, ...local]) {
    const k = paragraphKey(chapterNo, comment.paragraph)
    ;(map[k] ??= []).push(comment)
  }
  paragraphComments.value = map
}

function commentsFor(index: number): ParagraphComment[] {
  return paragraphComments.value[paragraphKey(chapterIndex.value, index)] ?? []
}

const commentDialogOpen = ref(false)
const commentParagraph = ref(0)
const commentBusy = ref(false)
const commentError = ref('')

function openCommentEditor(index: number): void {
  commentParagraph.value = index
  commentError.value = ''
  commentDialogOpen.value = true
}

/*
 * 翻页热区（hit-area）盖在段落上层，右键/长按会先落在热区上，
 * 这里临时放开指针找到鼠标下的真实段落，再转发给评论窗。
 */
function findParagraphAt(x: number, y: number): HTMLElement | null {
  const hit = document.querySelector<HTMLElement>('.hit-area')
  if (hit) hit.style.pointerEvents = 'none'
  const el = document.elementFromPoint(x, y)
  if (hit) hit.style.pointerEvents = ''
  return (el as HTMLElement | null)?.closest<HTMLElement>('[data-para]') ?? null
}

function onHitContextMenu(event: MouseEvent): void {
  const target = findParagraphAt(event.clientX, event.clientY)
  if (!target) return
  openCommentEditor(Number(target.dataset.para ?? 0))
}

/** 评论按钮/评论面板也埋在热区下面：点击要转发给它们，不能翻页 */
const INTERACTIVE_SELECTOR = '.p-cmt-count, .p-cmt-panel, .sel-check'

function forwardTapClick(event: MouseEvent): boolean {
  const hit = document.querySelector<HTMLElement>('.hit-area')
  if (hit) hit.style.pointerEvents = 'none'
  const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
  if (hit) hit.style.pointerEvents = ''
  if (!el?.closest(INTERACTIVE_SELECTOR)) return false
  // 点真实元素（按钮/复选框自身），不是外层容器
  el.click()
  return true
}

/* 手机长按热区也要能写评论；长按触发后吞掉随后的 click，免得又翻页 */
let longPressTimer: number | undefined
let longPressMoved = false
let longPressFired = false

function onHitTouchStart(event: TouchEvent): void {
  longPressMoved = false
  const touch = event.touches[0]
  if (!touch) return
  const { clientX, clientY } = touch
  longPressTimer = window.setTimeout(() => {
    if (longPressMoved) return
    const target = findParagraphAt(clientX, clientY)
    if (!target) return
    longPressFired = true
    openCommentEditor(Number(target.dataset.para ?? 0))
  }, 550)
}
function onHitTouchMove(): void {
  longPressMoved = true
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = undefined
  }
}
function onHitTouchEnd(): void {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = undefined
  }
}

async function submitParagraphComment(body: string): Promise<void> {
  commentBusy.value = true
  commentError.value = ''
  try {
    await postParagraphComment(bookmarkKey.value, chapterIndex.value, commentParagraph.value, body, auth.loggedIn)
    await loadParagraphComments()
    commentDialogOpen.value = false
  } catch (err) {
    commentError.value = (err as Error).message
  } finally {
    commentBusy.value = false
  }
}

async function removeParagraphComment(comment: ParagraphComment): Promise<void> {
  try {
    await deleteParagraphComment(comment)
    await loadParagraphComments()
  } catch (err) {
    commentError.value = (err as Error).message
  }
}

const commentChapterTitle = computed(() => chapter.value?.title ?? '')
const commentPreview = computed(() => {
  const text = paragraphs.value[commentParagraph.value] ?? ''
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
})
const contentStyle = computed(() => ({
  fontSize: `${settings.fontSize}px`,
  lineHeight: String(settings.lineHeight),
}))

/** 版心设置换算成列宽，并受视口限制 */
const preferredColumnPx = computed(() => settings.columnWidth * 16)
const bookWidth = computed(() => (layout.value === 'spread' ? pageWidth.value * 2 + GUTTER : pageWidth.value))
const halfLeftStyle = computed(() => ({ width: `${pageWidth.value}px`, left: '0px' }))
const halfRightStyle = computed(() =>
  layout.value === 'spread'
    ? { width: `${pageWidth.value}px`, left: `${pageWidth.value + GUTTER}px` }
    : { width: `${pageWidth.value}px`, left: '0px' },
)
const leafPositionStyle = computed(() => {
  if (layout.value === 'single') return { width: `${pageWidth.value}px`, left: '0px' }
  return leafOnLeft.value
    ? { width: `${pageWidth.value}px`, left: '0px' }
    : { width: `${pageWidth.value}px`, left: `${pageWidth.value + GUTTER}px` }
})

/** 双页对开需要够宽，否则自动退回单页 */
const layout = computed<'single' | 'spread'>(() =>
  settings.layout === 'spread' && viewportWidth.value >= SPREAD_MIN_WIDTH ? 'spread' : 'single',
)
const step = computed(() => (layout.value === 'spread' ? 2 : 1))

/** 底层显示的是翻完之后的那一屏 */
const baseStart = computed(() => {
  if (!flipping.value) return pageIndex.value
  return flipping.value.dir === 'fwd'
    ? pageIndex.value + step.value
    : Math.max(0, pageIndex.value - step.value)
})

/** 正在翻的那一页：单页时是整页；对开时向前翻是右页、向后翻是左页 */
const leafPage = computed(() => {
  if (layout.value === 'spread') {
    return flipping.value?.dir === 'bwd' ? pageIndex.value : pageIndex.value + 1
  }
  return flipping.value?.dir === 'bwd' ? Math.max(0, pageIndex.value - 1) : pageIndex.value
})

const leafVisible = computed(() => Boolean(flipping.value))
const leafOnLeft = computed(() => layout.value === 'spread' && flipping.value?.dir === 'bwd')

const leafStyle = computed(() => ({
  transform: `rotateY(${angle.value}deg)`,
  transformOrigin: leafOnLeft.value ? 'right center' : 'left center',
}))

/** 页面左右留白：印刷品不会把字排到纸边 */
const pageMargin = computed(() => Math.max(26, Math.round(pageWidth.value * 0.075)))
const columnWidth = computed(() => Math.max(140, pageWidth.value - pageMargin.value * 2))

function stripStyle(page: number): Record<string, string> {
  return {
    transform: `translateX(-${page * pageWidth.value}px)`,
    columnWidth: `${columnWidth.value}px`,
    columnGap: `${pageMargin.value * 2}px`,
    height: `${pageHeight.value}px`,
    paddingLeft: `${pageMargin.value}px`,
    paddingRight: `${pageMargin.value}px`,
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let flipTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!book.value) return
    const offset =
      settings.mode === 'paged' ? pageIndex.value / Math.max(pageCount.value, 1) : scrollRatio.value
    void saveProgress(book.value.id, chapterIndex.value, offset, overallProgress.value)
  }, 600)
}

async function measurePages(reset = false): Promise<void> {
  const viewport = viewportEl.value
  const strip = stripEl.value
  if (!viewport || !strip) return
  viewportWidth.value = viewport.clientWidth
  pageWidth.value =
    layout.value === 'spread'
      ? Math.min(preferredColumnPx.value, Math.floor((viewport.clientWidth - GUTTER) / 2))
      : Math.min(preferredColumnPx.value, viewport.clientWidth)
  pageHeight.value = viewport.clientHeight
  await nextTick()
  pageCount.value = Math.max(1, Math.round((strip.scrollWidth + pageMargin.value) / pageWidth.value))
  if (reset) pageIndex.value = 0
  pageIndex.value = Math.min(pageIndex.value, pageCount.value - 1)
}

async function loadBook(): Promise<void> {
  const id = bookId.value
  loading.value = true
  const result = await getBook(id)
  // 读取是异步的，期间可能又切了书
  if (id !== bookId.value) return
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
    if (settings.mode === 'paged')
      pageIndex.value = Math.round(result.book.lastOffset * (pageCount.value - 1))
    else {
      const viewport = viewportEl.value
      if (viewport)
        viewport.scrollTop = result.book.lastOffset * (viewport.scrollHeight - viewport.clientHeight)
    }
  }
}

function commitFlip(): void {
  if (!flipping.value) return
  if (flipping.value.dir === 'fwd') {
    pageIndex.value = Math.min(pageIndex.value + step.value, pageCount.value - 1)
  } else {
    pageIndex.value = Math.max(pageIndex.value - step.value, 0)
  }
  flipping.value = null
  angle.value = 0
  scheduleSave()
}

/** 把 0→1 的翻页进度映射成角度：对开时右页向左倒、左页向右倒；单页沿用旧行为 */
function angleFor(dir: FlipDir, progress: number): number {
  if (layout.value === 'spread') return dir === 'fwd' ? -180 * progress : 180 * progress
  return dir === 'fwd' ? -180 * progress : -180 * (1 - progress)
}

function progressFor(dir: FlipDir, value: number): number {
  const absolute = Math.abs(value) / 180
  if (layout.value === 'spread') return absolute
  return dir === 'fwd' ? absolute : 1 - absolute
}

function startFlip(dir: FlipDir): void {
  if (flipping.value) return
  if (flipTimer) clearTimeout(flipTimer)
  flipping.value = { dir }
  angle.value = angleFor(dir, 0)
  void nextTick(() => {
    // 等两帧：先让起始角度画出来，再改终点角度才会触发 transition
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        angle.value = angleFor(dir, 1)
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
    if (pageIndex.value + step.value < pageCount.value) startFlip('fwd')
    else if (pageIndex.value + 1 < pageCount.value) {
      pageIndex.value += 1
      scheduleSave()
    } else goNextChapter()
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
    if (forward && pageIndex.value + step.value >= pageCount.value) return
    if (!forward && pageIndex.value <= 0) return
    dragDir = forward ? 'fwd' : 'bwd'
    suppressClick = true
    flipping.value = { dir: dragDir }
    angle.value = angleFor(dragDir, 0)
  }
  const progress = Math.min(1, Math.abs(dx) / dragWidth)
  angle.value = angleFor(dragDir, progress)
}

function onPointerUp(): void {
  detachDrag()
  if (!dragging.value) return
  dragging.value = false
  if (!flipping.value || !dragDir) {
    suppressClick = false
    return
  }
  const done = progressFor(dragDir, angle.value) > 0.28
  angle.value = angleFor(dragDir, done ? 1 : 0)
  flipTimer = setTimeout(
    done
      ? commitFlip
      : () => {
          flipping.value = null
          angle.value = 0
        },
    FLIP_MS * 0.55,
  )
  dragDir = null
  setTimeout(() => (suppressClick = false), 60)
}

/** 点击左右区域翻页；刚拖拽过就不算点击 */
function onMidTap(event: MouseEvent): void {
  if (longPressFired) {
    longPressFired = false
    return
  }
  if (forwardTapClick(event)) return
  chromeVisible.value = !chromeVisible.value
}

function tapTurn(delta: number, event: MouseEvent): void {
  // 长按刚唤起评论窗，别让松手后的 click 又翻页
  if (longPressFired) {
    longPressFired = false
    return
  }
  if (suppressClick) return
  // 点在评论按钮/评论面板上：转发点击，不翻页
  if (forwardTapClick(event)) return
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
      event.preventDefault()
      void turn(1)
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      event.preventDefault()
      void turn(-1)
      break
    case ' ':
      // 有歌已载入时，空格交给播放器（暂停/继续）；阅读器改用 ← → 翻页
      if (player.current) return
      event.preventDefault()
      void turn(1)
      break
    case 'Escape':
      if (tocOpen.value || settingsOpen.value || bookmarkOpen.value) {
        tocOpen.value = false
        settingsOpen.value = false
        bookmarkOpen.value = false
      } else {
        void router.push('/shelf')
      }
      break
  }
}

function onResize(): void {
  if (settings.mode === 'paged') measurePages()
}

watch(
  () => settings.mode,
  async () => {
    await nextTick()
    if (settings.mode === 'paged') measurePages(true)
    else viewportEl.value?.scrollTo({ top: 0 })
  },
)

watch([() => settings.fontSize, () => settings.columnWidth, () => settings.lineHeight], async () => {
  await nextTick()
  if (settings.mode === 'paged') measurePages()
})

// 在阅读器里直接跳到另一本书时组件会被复用，必须自己重新加载
watch(bookId, () => {
  void loadBook()
})

// 切章/切书后拉该章的段落评论
watch([chapterIndex, bookmarkKey], () => {
  void loadParagraphComments()
})

onMounted(() => {
  void loadBook()
  void loadParagraphComments()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  detachDrag()
  if (saveTimer) clearTimeout(saveTimer)
  // 翻页动画的定时器会在组件卸载后继续跑，顺手清掉
  if (flipTimer) clearTimeout(flipTimer)
  if (book.value) {
    const offset =
      settings.mode === 'paged' ? pageIndex.value / Math.max(pageCount.value, 1) : scrollRatio.value
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
        <button type="button" class="r-btn" :class="{ on: bookmarkOpen }" @click="bookmarkOpen = !bookmarkOpen">
          书签
        </button>
        <button type="button" class="r-btn" :class="{ on: tocOpen }" @click="tocOpen = !tocOpen">目录</button>
        <button
          type="button"
          class="r-btn"
          :class="{ on: settingsOpen }"
          @click="settingsOpen = !settingsOpen"
        >
          设置
        </button>
      </div>
    </header>

    <div ref="viewportEl" class="reader-viewport" :class="settings.mode" @scroll.passive="onScroll">
      <div
        v-if="settings.mode === 'paged'"
        class="book"
        :class="layout"
        :style="{ width: `${bookWidth}px` }"
        @pointerdown="onPointerDown"
      >
        <div v-if="layout === 'spread'" class="half left" :style="halfLeftStyle">
          <div class="clip">
            <div class="strip" :style="stripStyle(baseStart)">
              <div class="reader-content" :style="contentStyle">
                <h2>{{ chapter?.title }}</h2>
                <ParagraphLine
                  v-for="(paragraph, index) in paragraphs"
                  :key="index"
                  :data-para="index"
                  :text="paragraph"
                  :comments="commentsFor(index)"
                  @open-editor="openCommentEditor(index)"
                  @remove="removeParagraphComment"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="half right" :style="halfRightStyle">
          <div class="clip">
            <div
              ref="stripEl"
              class="strip"
              :style="stripStyle(layout === 'spread' ? baseStart + 1 : baseStart)"
            >
              <div class="reader-content" :style="contentStyle">
                <h2>{{ chapter?.title }}</h2>
                <ParagraphLine
                  v-for="(paragraph, index) in paragraphs"
                  :key="index"
                  :data-para="index"
                  :text="paragraph"
                  :comments="commentsFor(index)"
                  @open-editor="openCommentEditor(index)"
                  @remove="removeParagraphComment"
                />
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="leafVisible"
          class="page leaf"
          :class="{ dragging, left: leafOnLeft, single: layout === 'single' }"
          :style="[leafStyle, leafPositionStyle]"
        >
          <div class="clip">
            <div class="strip" :style="stripStyle(leafPage)">
              <div class="reader-content" :style="contentStyle">
                <h2>{{ chapter?.title }}</h2>
                <ParagraphLine
                  v-for="(paragraph, index) in paragraphs"
                  :key="index"
                  :data-para="index"
                  :text="paragraph"
                  :comments="commentsFor(index)"
                  @open-editor="openCommentEditor(index)"
                  @remove="removeParagraphComment"
                />
              </div>
            </div>
          </div>
          <span class="page-curl" />
        </div>

        <span v-if="layout === 'spread'" class="spine" aria-hidden="true" />

        <div
          class="hit-area"
          @contextmenu.prevent="onHitContextMenu($event)"
          @touchstart.passive="onHitTouchStart"
          @touchmove.passive="onHitTouchMove"
          @touchend="onHitTouchEnd"
        >
          <button type="button" class="tap left" aria-label="上一页" @click="tapTurn(-1, $event)" />
          <button
            type="button"
            class="tap mid"
            aria-label="显示/隐藏工具栏"
            @click="onMidTap($event)"
          />
          <button type="button" class="tap right" aria-label="下一页" @click="tapTurn(1, $event)" />
        </div>
      </div>

      <div v-else class="reader-scroll" @click.stop>
        <div class="reader-content" :style="contentStyle">
          <h2>{{ chapter?.title }}</h2>
          <ParagraphLine
                  v-for="(paragraph, index) in paragraphs"
                  :key="index"
                  :data-para="index"
                  :text="paragraph"
                  :comments="commentsFor(index)"
                  @open-editor="openCommentEditor(index)"
                  @remove="removeParagraphComment"
                />
        </div>
      </div>
    </div>

    <footer class="reader-foot">
      <button type="button" class="r-btn" :disabled="chapterIndex === 0 && pageIndex === 0" @click="turn(-1)">
        上一页
      </button>
      <div class="r-progress">
        <i :style="{ width: `${overallProgress * 100}%` }" />
        <span>{{ Math.round(overallProgress * 100) }}%</span>
      </div>
      <span v-if="settings.mode === 'paged'" class="r-pages">{{ pageIndex + 1 }} / {{ pageCount }}</span>
      <button
        type="button"
        class="r-btn"
        :disabled="chapterIndex === chapters.length - 1 && pageIndex >= pageCount - 1"
        @click="turn(1)"
      >
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
          <h4>翻页方式</h4>
          <div class="seg">
            <button type="button" :class="{ on: settings.mode === 'paged' }" @click="settings.mode = 'paged'">
              翻页
            </button>
            <button
              type="button"
              :class="{ on: settings.mode === 'scroll' }"
              @click="settings.mode = 'scroll'"
            >
              滚动
            </button>
          </div>
        </section>

        <section>
          <h4>版式</h4>
          <div class="seg">
            <button
              type="button"
              :class="{ on: settings.layout === 'spread' }"
              @click="settings.layout = 'spread'"
            >
              左右对开
            </button>
            <button
              type="button"
              :class="{ on: settings.layout === 'single' }"
              @click="settings.layout = 'single'"
            >
              单页
            </button>
          </div>
          <p class="seg-hint">屏幕较窄时自动使用单页。</p>
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

        <p class="hint">← → 翻页 · 空格下一页 · Esc 退出 · 也可以按住页面左右拖动</p>
      </aside>
    </Transition>

    <BookmarkPanel
      :open="bookmarkOpen"
      :book-key="bookmarkKey"
      :chapter="chapterIndex"
      :chapter-title="chapter?.title ?? ''"
      :ratio="bookmarkRatio"
      @update:open="bookmarkOpen = $event"
      @jump="jumpTo"
    />

    <ParagraphCommentDialog
      :open="commentDialogOpen"
      :chapter-title="commentChapterTitle"
      :paragraph-preview="commentPreview"
      :comments="commentsFor(commentParagraph)"
      :logged-in="auth.loggedIn"
      :busy="commentBusy"
      :error="commentError"
      @submit="submitParagraphComment"
      @remove="removeParagraphComment"
      @update:open="commentDialogOpen = $event"
    />
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
  display: flex;
  justify-content: center;
  padding: 0 20px;
}

/* ---------- 3D 翻书 ---------- */

.book {
  position: relative;
  height: 100%;
  margin: 0 auto;
  perspective: 2600px;
  perspective-origin: 50% 50%;
  touch-action: pan-y;
  filter: drop-shadow(0 26px 32px rgba(0, 0, 0, 0.45));
}

/* 书壳：书页四周露出来的那一圈「装订」 */
.book::before {
  content: '';
  position: absolute;
  inset: -18px -26px -24px;
  border-radius: 14px;
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.015) 0 2px, transparent 2px 4px),
    linear-gradient(150deg, #2a3646 0%, #17202b 46%, #090e14 100%);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.07),
    inset 0 -4px 10px rgba(0, 0, 0, 0.7),
    0 26px 50px -22px rgba(0, 0, 0, 0.85);
  z-index: 0;
}

/* 书底下的投影 */
.book::after {
  content: '';
  position: absolute;
  left: 4%;
  right: 4%;
  bottom: -40px;
  height: 34px;
  border-radius: 50%;
  background: radial-gradient(50% 100% at 50% 0%, rgba(0, 0, 0, 0.5), transparent 72%);
  filter: blur(6px);
  z-index: -1;
  pointer-events: none;
}

/* 对开时左右各占一半，中间是书脊 */
.half {
  position: absolute;
  top: 0;
  bottom: 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(0, 0, 0, 0.04) 52%, rgba(0, 0, 0, 0.1)),
    var(--paper, #121a26);
  border-radius: 3px;
  z-index: 1;
}

.book.spread .half.left {
  left: 0;
  border-radius: 5px 1px 1px 5px;
  box-shadow:
    inset -22px 0 36px -26px rgba(0, 0, 0, 0.85),
    inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.book.spread .half.right {
  right: 0;
  border-radius: 1px 5px 5px 1px;
  box-shadow:
    inset 22px 0 36px -26px rgba(0, 0, 0, 0.85),
    inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.book.single .half.right {
  border-radius: 5px;
  box-shadow:
    inset 0 0 26px -18px rgba(0, 0, 0, 0.7),
    inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

/* 书页叠边：外侧露出一叠纸的厚度 */
.book.spread .half::after {
  content: '';
  position: absolute;
  top: 7px;
  bottom: 7px;
  width: 7px;
  pointer-events: none;
  background: repeating-linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.12) 0 1px,
    rgba(0, 0, 0, 0.16) 1px 2px,
    transparent 2px 4px
  );
  opacity: 0.75;
  z-index: -1;
}

.book.spread .half.left::after {
  left: -7px;
  border-radius: 4px 0 0 4px;
}

.book.spread .half.right::after {
  right: -7px;
  border-radius: 0 4px 4px 0;
}

/* 上下书口：书页叠起来的那条线 */
.book.spread .half::before {
  content: '';
  position: absolute;
  left: 5px;
  right: 5px;
  height: 5px;
  pointer-events: none;
  background: repeating-linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.1) 0 1px,
    rgba(0, 0, 0, 0.14) 1px 2px,
    transparent 2px 4px
  );
  opacity: 0.55;
  z-index: -1;
}

.book.spread .half.left::before,
.book.spread .half.right::before {
  top: -5px;
}

/* 书脊：中间的凹陷与压痕 */
.spine {
  position: absolute;
  top: -3px;
  bottom: -3px;
  left: 50%;
  width: 54px;
  transform: translateX(-50%);
  pointer-events: none;
  border-radius: 3px;
  background:
    radial-gradient(140% 70% at 50% 50%, rgba(255, 255, 255, 0.06), transparent 62%),
    linear-gradient(
      90deg,
      rgba(0, 0, 0, 0.82),
      rgba(0, 0, 0, 0.42) 18%,
      #0b1017 48%,
      #0b1017 52%,
      rgba(0, 0, 0, 0.42) 82%,
      rgba(0, 0, 0, 0.82)
    );
  box-shadow:
    inset 0 0 30px rgba(0, 0, 0, 0.85),
    0 0 0 1px rgba(255, 255, 255, 0.03);
  z-index: 2;
}

/* 书页在书脊处的弯曲阴影 */
.spine::before,
.spine::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 26px;
  pointer-events: none;
}

.spine::before {
  left: -26px;
  background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.4));
}

.spine::after {
  right: -26px;
  background: linear-gradient(270deg, transparent, rgba(0, 0, 0, 0.4));
}

/* 3D 变换会让 overflow 失效，内容统一放在独立裁剪层 */
.clip {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.strip {
  column-fill: auto;
  will-change: transform;
}

.leaf {
  position: absolute;
  top: 0;
  bottom: 0;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(0, 0, 0, 0.05) 60%, rgba(0, 0, 0, 0.12)),
    var(--paper, #121a26);
  /* 不用 preserve-3d，否则 overflow 裁剪失效，翻页时文字会溢出页外 */
  backface-visibility: hidden;
  transition: transform 0.62s cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: transform;
  box-shadow:
    -18px 0 40px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.06);
  cursor: grab;
  z-index: 3;
}

.book.spread .leaf {
  border-radius: 1px 5px 5px 1px;
}

.book.spread .leaf.left {
  border-radius: 5px 1px 1px 5px;
}

.book.spread .leaf.left {
  border-radius: 4px 2px 2px 4px;
}

.book.single .leaf {
  border-radius: 4px;
}

.leaf.dragging {
  transition: none;
  cursor: grabbing;
}

.page-curl {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.22), transparent 12%);
}

.leaf.left .page-curl {
  background: linear-gradient(270deg, rgba(0, 0, 0, 0.22), transparent 12%);
}

.hit-area {
  position: absolute;
  inset: 0;
  z-index: 4;
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
  width: min(100%, 46rem);
  padding: 36px 30px 64px;
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

.seg {
  display: flex;
  gap: 6px;
}

.seg button {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--r-line);
  color: var(--r-fg);
  font-size: 0.82rem;
}

.seg button.on {
  color: var(--r-accent);
  border-color: var(--r-accent);
  background: color-mix(in srgb, var(--r-accent) 12%, transparent);
}

.seg-hint {
  margin: 8px 0 0;
  color: var(--r-dim);
  font-size: 0.72rem;
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
  transition:
    transform 0.24s ease,
    opacity 0.24s ease;
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
