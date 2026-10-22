<script setup lang="ts">
import { computed } from 'vue'
import { archiveGroups, posts } from '@/lib/content'
import { useModerationStore } from '@/stores/moderation'
import { formatMonth } from '@/lib/format'

const moderation = useModerationStore()
const visible = computed(() => moderation.visible(posts))
const groups = computed(() => archiveGroups(visible.value))
const total = computed(() => visible.value.length)
</script>

<template>
  <div class="shell">
    <div class="page-head">
      <span class="eyebrow">Archive</span>
      <h1>归档</h1>
      <p>按时间倒序，共 {{ total }} 篇。</p>
    </div>

    <div class="archive">
      <section v-for="group in groups" :key="group.year">
        <h2 class="archive__year">{{ group.year }}</h2>
        <div v-for="month in group.months" :key="month.month">
          <h3 class="archive__month">{{ formatMonth(month.month) }}</h3>
          <RouterLink v-for="post in month.posts" :key="post.slug" class="archive-row" :to="`/post/${post.slug}`">
            <time :datetime="post.date">{{ post.date.slice(5) }}</time>
            <span>{{ post.title }}</span>
            <span class="count">{{ post.read }} 分钟</span>
          </RouterLink>
        </div>
      </section>
    </div>
  </div>
</template>
