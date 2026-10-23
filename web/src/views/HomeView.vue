<script setup lang="ts">
import { computed, ref } from 'vue'
import PostCard from '@/components/PostCard.vue'
import { blogStats, posts, tagStats } from '@/lib/content'
import { useModerationStore } from '@/stores/moderation'
import { coverSvg } from '@/lib/cover'
import { formatDate } from '@/lib/format'
import { formatCount } from '@/lib/format'

const moderation = useModerationStore()
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
