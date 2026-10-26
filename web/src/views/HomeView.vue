<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import PostCard from '@/components/PostCard.vue'
import { blogStats, posts, tagStats } from '@/lib/content'
import { useModerationStore } from '@/stores/moderation'
import { coverSvg } from '@/lib/cover'
import { formatDate } from '@/lib/format'
import { formatCount } from '@/lib/format'
import { progressLabel, recentReading } from '@/lib/reading'

const moderation = useModerationStore()
const route = useRoute()
const visiblePosts = computed(() => moderation.visible(posts))
const stats = computed(() => blogStats(visiblePosts.value))
const tags = computed(() => tagStats(visiblePosts.value).slice(0, 8))
const featured = computed(() => visiblePosts.value.find((post) => post.featured) ?? visiblePosts.value[0])
const featuredCover = computed(() => (featured.value ? coverSvg(featured.value.slug) : ''))

const activeTag = ref('全部')
const filtered = computed(() =>
  activeTag.value === '全部'
    ? visiblePosts.value
    : visiblePosts.value.filter((post) => post.tags.includes(activeTag.value)),
)

/**
 * 继续阅读：最近读过但没读完的文章。
 * 数据在 localStorage，不是响应式的，所以挂载和路由回首页时都要重读。
 */
const resume = ref<{ slug: string; ratio: number; touched: number; title: string; date: string }[]>([])

function loadResume(): void {
  const entries = recentReading(visiblePosts.value.map((post) => post.slug), 3)
  resume.value = entries
    .map((entry) => {
      const post = visiblePosts.value.find((item) => item.slug === entry.slug)
      return post ? { ...entry, title: post.title, date: post.date } : null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
}

onMounted(loadResume)
// 从文章页退回首页时组件可能被复用，路由一变就刷新
import { watch } from 'vue'
watch(
  () => route.fullPath,
  () => loadResume(),
)
</script>

<template>
  <section class="hero shell">
    <div>
      <span class="eyebrow">banyue · 雷半斩的个人站</span>
      <h1>把读过的、走过的，<br /><em>写慢一点</em>。</h1>
      <p>
        城市漫游、读书笔记，以及那些当时没想明白、后来也没想明白的事。没有算法推荐，只有时间倒序。
      </p>
      <div class="hero-actions">
        <RouterLink v-if="featured" class="btn btn--solid" :to="`/post/${featured.slug}`">
          先看这篇
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </RouterLink>
        <RouterLink class="btn" to="/about">关于这里</RouterLink>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><b>{{ stats.posts }}</b><span>篇文章</span></div>
      <div class="stat"><b>{{ stats.tags }}</b><span>个标签</span></div>
      <div class="stat"><b>{{ formatCount(stats.chars) }}</b><span>字</span></div>
      <div class="stat"><b>{{ stats.years }}</b><span>年记录</span></div>
    </div>
  </section>

  <div class="shell">
    <!-- 继续阅读：只在有未读完的文章时出现，不占常驻版面 -->
    <section v-if="resume.length" class="resume" aria-label="继续阅读">
      <div class="section-title">
        <h2>继续阅读</h2>
        <span class="muted small">上次停在这里</span>
      </div>
      <div class="resume-list">
        <RouterLink
          v-for="item in resume"
          :key="item.slug"
          class="resume-item"
          :to="`/post/${item.slug}`"
        >
          <div class="resume-main">
            <b>{{ item.title }}</b>
            <span class="muted small">{{ formatDate(item.date) }} · {{ progressLabel(item.ratio) }}</span>
          </div>
          <div class="resume-bar" aria-hidden="true">
            <i :style="{ width: `${Math.round(item.ratio * 100)}%` }" />
          </div>
        </RouterLink>
      </div>
    </section>

    <article v-if="featured" class="featured">
      <div class="featured__art" v-html="featuredCover" />
      <div class="featured__body">
        <span class="eyebrow">本期精选</span>
        <h2>
          <RouterLink :to="`/post/${featured.slug}`">{{ featured.title }}</RouterLink>
        </h2>
        <p>{{ featured.excerpt }}</p>
        <div class="meta">
          <time :datetime="featured.date">{{ formatDate(featured.date) }}</time>
          <span class="dot">{{ featured.read }} 分钟</span>
          <span v-for="tag in featured.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </div>
    </article>

    <div class="section-title">
      <h2>全部文章</h2>
      <RouterLink to="/archive">{{ visiblePosts.length }} 篇 · 看归档 →</RouterLink>
    </div>

    <div class="chips" role="tablist" aria-label="按标签筛选">
      <button
        type="button"
        class="chip"
        :class="{ on: activeTag === '全部' }"
        role="tab"
        :aria-selected="activeTag === '全部'"
        @click="activeTag = '全部'"
      >
        全部
      </button>
      <button
        v-for="tag in tags"
        :key="tag.name"
        type="button"
        class="chip"
        :class="{ on: activeTag === tag.name }"
        role="tab"
        :aria-selected="activeTag === tag.name"
        @click="activeTag = tag.name"
      >
        {{ tag.name }}<small>{{ tag.count }}</small>
      </button>
    </div>

    <div class="post-list" style="margin-top: 20px">
      <PostCard v-for="post in filtered" :key="post.slug" :post="post" />
      <p v-if="!filtered.length" class="empty">这个标签下还没有文章。</p>
    </div>
  </div>
</template>
