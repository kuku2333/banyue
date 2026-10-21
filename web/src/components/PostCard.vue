<script setup lang="ts">
import { computed } from 'vue'
import type { Post } from '@/lib/content'
import { coverSvg } from '@/lib/cover'
import { formatDate } from '@/lib/format'

const props = defineProps<{ post: Post }>()
const cover = computed(() => coverSvg(props.post.slug))
</script>

<template>
  <RouterLink class="post-card" :to="`/post/${post.slug}`">
    <div class="post-card__cover" v-html="cover" />
    <div class="post-card__body">
      <h3>{{ post.title }}</h3>
      <p>{{ post.excerpt }}</p>
      <div class="meta">
        <time :datetime="post.date">{{ formatDate(post.date) }}</time>
        <span class="dot">{{ post.read }} 分钟</span>
        <span v-for="tag in post.tags" :key="tag" class="tag">{{ tag }}</span>
      </div>
    </div>
  </RouterLink>
</template>
