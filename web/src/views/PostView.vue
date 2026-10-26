<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PostCard from '@/components/PostCard.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { useModerationStore } from '@/stores/moderation'
import { findPost, neighbours, relatedPosts } from '@/lib/content'
import { formatDate } from '@/lib/format'
import { readProgress, saveProgress, progressLabel } from '@/lib/reading'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const auth = useAuthStore()
const moderation = useModerationStore()

const slug = computed(() => String(route.params.slug ?? ''))
const post = computed(() => findPost(slug.value))
const isHidden = computed(() => moderation.isHidden(slug.value))
const canModerate = computed(() => Boolean(auth.user?.isAdmin))

async function toggleHidden(): Promise<void> {
  if (!canModerate.value) return
  if (isHidden.value) {
    await moderation.unhide(slug.value)
    return
  }
  if (!window.confirm('删除这篇文章？它会从所有列表里消失（可恢复）。')) return
  await moderation.hide(slug.value)
  await router.push('/')
}
/** 上下篇与相关阅读也要跳过被隐藏的文章，否则「删掉」的稿子还能从侧门点进来 */
const nav = computed(() => {
  const raw = neighbours(slug.value)
  return {
    prev: raw.prev && !moderation.isHidden(raw.prev.slug) ? raw.prev : undefined,
    next: raw.next && !moderation.isHidden(raw.next.slug) ? raw.next : undefined,
  }
})
const related = computed(() => moderation.visible(relatedPosts(slug.value)))
const activeHeading = ref('')
const proseEl = ref<HTMLElement | null>(null)
const restoredAt = ref(0)
/** 移动端目录抽屉的开关，桌面端用侧栏，不受影响 */
const tocOpen = ref(false)

const fontStyle = computed(() => ({
  '--font-scale': settings.fontScale === 'sm' ? '0.92' : settings.fontScale === 'lg' ? '1.12' : '1',
}))


function backToTop(): void {
  window.scrollTo({ top: 0, behavior: 'smooth' })
  restoredAt.value = 0
}

function scrollToHeading(id: string): void {
  const target = document.getElementById(id)
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // 移动端是抽屉式目录，跳完关掉
  tocOpen.value = false
}

/* 进度写盘的两个开关，放最前面避免 TDZ：
 * isDirty  —— 用户真的滚过才允许写，防止挂载瞬间把 0 写进去
 * restoring —— 恢复位置期间是代码在滚，跳过写盘 */
let isDirty = false
let restoring = 0

function onScroll(): void {
  const headings = post.value?.headings ?? []
  let current = headings[0]?.id ?? ''
  for (const heading of headings) {
    const el = document.getElementById(heading.id)
    if (el && el.getBoundingClientRect().top <= 120) current = heading.id
  }
  activeHeading.value = current

  const doc = document.documentElement
  const max = doc.scrollHeight - window.innerHeight
  if (max > 0) {
    // 恢复位置期间是代码在滚，不是用户阅读，跳过写盘
    if (restoring > 0) return
    isDirty = true
    saveProgress(slug.value, doc.scrollTop / max)
  }
}

async function decorateCodeBlocks(): Promise<void> {
  await nextTick()
  const root = proseEl.value
  if (!root) return
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.copy-btn')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy-btn'
    button.textContent = '复制'
    button.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.textContent ?? ''
      try {
        await navigator.clipboard.writeText(code)
        button.textContent = '已复制'
      } catch {
        button.textContent = '复制失败'
      }
      setTimeout(() => (button.textContent = '复制'), 1500)
    })
    pre.appendChild(button)
  })
}

/** 正文图片点击放大 */
const lightbox = ref<{ src: string; alt: string } | null>(null)

async function decorateImages(): Promise<void> {
  await nextTick()
  const root = proseEl.value
  if (!root) return
  root.querySelectorAll('img').forEach((img) => {
    if (img.dataset.zoomable === '1') return
    img.dataset.zoomable = '1'
    img.loading = 'lazy'
    img.decoding = 'async'
    // 键盘也能打开
    img.tabIndex = 0
    img.setAttribute('role', 'button')
    img.setAttribute('aria-label', `查看大图：${img.alt || '正文图片'}`)
    const open = (): void => {
      lightbox.value = { src: img.currentSrc || img.src, alt: img.alt || '' }
    }
    img.addEventListener('click', open)
    img.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
    })
  })
}

/**
 * 恢复到上次位置。
 *
 * 挂载瞬间正文可能还没排完（图片、字体、代码块陆续撑高），此时
 * scrollHeight 偏小，按比例算出的目标也偏小，滚过去等于没到。
 * 做法：反复尝试，直到「页面能滚到目标附近」或次数用尽；
 * 全程压着 restoring，避免过程中的 scroll 事件把进度写回 0。
 */
function restorePosition(): void {
  const saved = readProgress(slug.value)
  if (saved < 0.03) return
  restoredAt.value = saved
  // 同步置位：从这一刻起 onScroll 不再写盘，直到滚到位
  restoring += 1

  let attempts = 0
  const TICK = 100
  const MAX_ATTEMPTS = 12

  const step = (): void => {
    attempts += 1
    const doc = document.documentElement
    const max = doc.scrollHeight - window.innerHeight
    const target = max > 0 ? max * saved : 0
    if (max > 0) window.scrollTo({ top: target, behavior: 'auto' })

    const arrived = max > 0 && Math.abs(window.scrollY - target) <= 30
    // 读到最后一段时滚不到精确比例，到底就算到位
    const atBottom =
      saved > 0.9 && max > 0 && window.scrollY + window.innerHeight >= doc.scrollHeight - 30

    if (arrived || atBottom || attempts >= MAX_ATTEMPTS) {
      // 稳定一帧再放开写盘，避免放手瞬间的抖动被记成新进度
      window.setTimeout(() => {
        restoring = Math.max(0, restoring - 1)
        // 恢复完成后把标记为真，后续滚动才会正常记录
        isDirty = false
      }, 250)
      return
    }
    window.setTimeout(step, TICK)
  }

  step()
}

/**
 * 把当前滚动比例落盘。
 * 只在「真的滚动过」之后才写：页面刚挂载或路由切换瞬间 scrollTop 还是 0，
 * 这时写会把已有进度清掉。
 */
function savePosition(): void {
  if (!isDirty) return
  const doc = document.documentElement
  const max = doc.scrollHeight - window.innerHeight
  if (max <= 0) return
  saveProgress(slug.value, doc.scrollTop / max)
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  // 关标签页前补一次，避免最后一段没记上
  window.addEventListener('pagehide', savePosition)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') savePosition()
  })
  void decorateCodeBlocks()
  void decorateImages()

  // 顺序与守卫都要紧：挂载瞬间 scrollTop 是 0，此时任何写盘都会把上次进度
  // 判成「未读」并删除。所以先看有没有存档，有就先把 restoring 压上，
  // 再跑初始化，最后交给 restorePosition 收尾。
  const saved = readProgress(slug.value)
  if (saved >= 0.03) restoring += 1
  onScroll()
  if (saved >= 0.03) {
    restoring = Math.max(0, restoring - 1)
    restorePosition()
  }
})

onBeforeUnmount(() => {
  savePosition()
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('pagehide', savePosition)
})

/**
 * 切换到另一篇文章时回到顶部。
 * 首次挂载不处理：那时要恢复上次位置，回顶部会把恢复结果冲掉。
 */
let mountedOnce = false
onMounted(() => {
  mountedOnce = true
})

watch(post, async () => {
  if (!mountedOnce) return
  restoredAt.value = 0
  // 换文章才回顶部；同一篇重新渲染不动滚动位置
  window.scrollTo({ top: 0 })
  activeHeading.value = post.value?.headings[0]?.id ?? ''
  await decorateCodeBlocks()
  await decorateImages()
})

// 路由表里没有每篇文章的标题，这里补上（分享 / 标签页显示更清楚）
watch(
  () => post.value?.title,
  (title) => {
    document.title = title ? `${title} · 半月` : '半月'
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="post && (!isHidden || canModerate)" class="shell">
    <div class="post-layout">
      <article>
        <header class="post-head">
          <div class="meta">
            <time :datetime="post.date">{{ formatDate(post.date) }}</time>
            <span class="dot">{{ post.read }} 分钟</span>
            <span class="dot">{{ post.chars }} 字</span>
            <RouterLink v-for="tag in post.tags" :key="tag" class="tag" :to="`/tag/${encodeURIComponent(tag)}`">
              {{ tag }}
            </RouterLink>
          </div>
          <h1>{{ post.title }}</h1>
          <p class="muted">{{ post.excerpt }}</p>
          <div class="post-tools">
            <button type="button" class="tool-btn toc-toggle" :class="{ on: tocOpen }" @click="tocOpen = !tocOpen">
              目录
            </button>
            <button type="button" class="tool-btn" @click="settings.cycleFontScale()">
              字号 {{ settings.fontScale === 'sm' ? '小' : settings.fontScale === 'lg' ? '大' : '中' }}
            </button>
            <button type="button" class="tool-btn" :class="{ on: settings.lineHeight === 'loose' }" @click="settings.toggleLineHeight()">
              行距 {{ settings.lineHeight === 'loose' ? '宽松' : '标准' }}
            </button>
            <button type="button" class="tool-btn" @click="backToTop">回到顶部</button>
            <span v-if="restoredAt" class="tool-btn on" style="cursor: default">已回到上次位置（{{ progressLabel(restoredAt) }}）</span>
            <button v-if="canModerate" type="button" class="tool-btn" @click="toggleHidden">
              {{ isHidden ? '恢复文章' : '删除文章' }}
            </button>
          </div>
          <p v-if="isHidden" class="hidden-note">这篇文章已被管理员删除，仅管理员可见。</p>
        </header>

        <!-- 正文：仅渲染 markdown-it 白名单输出，原始 HTML 被转义 -->
        <div
          ref="proseEl"
          class="prose"
          :class="{ 'measure-loose': settings.lineHeight === 'loose' }"
          :style="fontStyle"
          v-html="post.html"
        />

        <footer class="post-foot">
          <nav class="post-nav" aria-label="上下篇">
            <RouterLink v-if="nav.prev" :to="`/post/${nav.prev.slug}`">
              <span>较新一篇</span>
              <b>{{ nav.prev.title }}</b>
            </RouterLink>
            <span v-else>已经是最新一篇</span>
            <RouterLink v-if="nav.next" class="right" :to="`/post/${nav.next.slug}`">
              <span>更早一篇</span>
              <b>{{ nav.next.title }}</b>
            </RouterLink>
            <span v-else class="right">已经是最后一篇</span>
          </nav>

          <section v-if="related.length">
            <div class="section-title" style="margin: 0 0 14px"><h2>相关阅读</h2></div>
            <div class="post-list">
              <PostCard v-for="item in related" :key="item.slug" :post="item" />
            </div>
          </section>
        </footer>
      </article>

      <aside v-if="post.headings.length" class="toc" aria-label="目录">
        <h4>目录</h4>
        <a
          v-for="heading in post.headings"
          :key="heading.id"
          :href="`#${heading.id}`"
          :class="['depth-' + heading.level, { on: activeHeading === heading.id }]"
          @click.prevent="scrollToHeading(heading.id)"
        >
          {{ heading.text }}
        </a>
      </aside>

      <!-- 移动端目录抽屉：小屏侧栏隐藏，改用此覆盖层 -->
      <Teleport to="body">
        <div v-if="tocOpen && post.headings.length" class="toc-drawer" role="dialog" aria-label="目录">
          <div class="toc-drawer__head">
            <span>目录</span>
            <button type="button" class="toc-drawer__x" aria-label="关闭目录" @click="tocOpen = false">×</button>
          </div>
          <a
            v-for="heading in post.headings"
            :key="heading.id"
            :href="`#${heading.id}`"
            :class="['depth-' + heading.level, { on: activeHeading === heading.id }]"
            @click.prevent="scrollToHeading(heading.id)"
          >
            {{ heading.text }}
          </a>
        </div>
      </Teleport>
    </div>
  </div>

  <div v-else class="shell">
    <div class="empty">
      <h1>这篇文章不在了</h1>
      <p>可能改过地址，或者从来没有存在过。</p>
      <RouterLink class="btn" to="/">回首页</RouterLink>
    </div>
  </div>

  <ImageLightbox
    v-if="lightbox"
    :src="lightbox.src"
    :alt="lightbox.alt"
    @close="lightbox = null"
  />
</template>

<style scoped>
.hidden-note {
  margin: 10px 0 0;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(251, 113, 133, 0.35);
  background: rgba(251, 113, 133, 0.08);
  color: var(--danger);
  font-size: 0.8rem;
}
</style>
