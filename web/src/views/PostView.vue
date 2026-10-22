<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PostCard from '@/components/PostCard.vue'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { useModerationStore } from '@/stores/moderation'
import { findPost, neighbours, relatedPosts } from '@/lib/content'
import { formatDate } from '@/lib/format'

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
const restored = ref(false)

const fontStyle = computed(() => ({
  '--font-scale': settings.fontScale === 'sm' ? '0.92' : settings.fontScale === 'lg' ? '1.12' : '1',
}))

const positionKey = computed(() => `banyue:pos:${slug.value}`)

function backToTop(): void {
  window.scrollTo({ top: 0, behavior: 'smooth' })
  restored.value = false
}

function scrollToHeading(id: string): void {
  const target = document.getElementById(id)
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

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
    const ratio = doc.scrollTop / max
    if (ratio > 0.03 && ratio < 0.97) localStorage.setItem(positionKey.value, String(ratio))
    else localStorage.removeItem(positionKey.value)
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

function restorePosition(): void {
  const saved = Number(localStorage.getItem(positionKey.value) ?? '0')
  if (!saved || saved < 0.03) return
  const doc = document.documentElement
  window.scrollTo({ top: (doc.scrollHeight - window.innerHeight) * saved, behavior: 'auto' })
  restored.value = true
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  void decorateCodeBlocks()
  restorePosition()
  onScroll()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
})

watch(post, async () => {
  window.scrollTo({ top: 0 })
  restored.value = false
  activeHeading.value = post.value?.headings[0]?.id ?? ''
  await decorateCodeBlocks()
})

// 路由表里没有每篇文章的标题，这里补上（分享 / 标签页显示更清楚）
watch(
  () => post.value?.title,
  (title) => {
    document.title = title ? `${title} · 半页` : '半页'
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
            <button type="button" class="tool-btn" @click="settings.cycleFontScale()">
              字号 {{ settings.fontScale === 'sm' ? '小' : settings.fontScale === 'lg' ? '大' : '中' }}
            </button>
            <button type="button" class="tool-btn" :class="{ on: settings.lineHeight === 'loose' }" @click="settings.toggleLineHeight()">
              行距 {{ settings.lineHeight === 'loose' ? '宽松' : '标准' }}
            </button>
            <button type="button" class="tool-btn" @click="backToTop">回到顶部</button>
            <span v-if="restored" class="tool-btn on" style="cursor: default">已回到上次位置</span>
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
    </div>
  </div>

  <div v-else class="shell">
    <div class="empty">
      <h1>这篇文章不在了</h1>
      <p>可能改过地址，或者从来没有存在过。</p>
      <RouterLink class="btn" to="/">回首页</RouterLink>
    </div>
  </div>
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
