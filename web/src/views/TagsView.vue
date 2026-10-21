<script setup lang="ts">
import { computed } from 'vue'
import { posts, tagStats } from '@/lib/content'

const tags = computed(() => tagStats())
const total = computed(() => posts.length)
</script>

<template>
  <div class="shell">
    <div class="page-head">
      <span class="eyebrow">Tags</span>
      <h1>标签</h1>
      <p>{{ total }} 篇文章，散在 {{ tags.length }} 个标签里。</p>
    </div>

    <div class="tag-grid">
      <RouterLink v-for="tag in tags" :key="tag.name" class="tag-card" :to="`/tag/${encodeURIComponent(tag.name)}`">
        <b>{{ tag.name }}</b>
        <span>{{ tag.count }} 篇</span>
      </RouterLink>
    </div>
  </div>
</template>
