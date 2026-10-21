<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import PostCard from '@/components/PostCard.vue'
import { postsByTag, tagStats } from '@/lib/content'

const route = useRoute()
const tag = computed(() => decodeURIComponent(String(route.params.tag ?? '')))
const list = computed(() => postsByTag(tag.value))
const others = computed(() => tagStats().filter((item) => item.name !== tag.value).slice(0, 10))
</script>

<template>
  <div class="shell">
    <div class="page-head">
      <span class="eyebrow">Tag</span>
      <h1>{{ tag }}</h1>
      <p>{{ list.length }} 篇文章</p>
    </div>

    <div v-if="list.length" class="post-list">
      <PostCard v-for="post in list" :key="post.slug" :post="post" />
    </div>
    <p v-else class="empty">这个标签下还没有文章。</p>

    <div class="section-title"><h2>其他标签</h2></div>
    <div class="chips">
      <RouterLink v-for="item in others" :key="item.name" class="chip" :to="`/tag/${encodeURIComponent(item.name)}`">
        {{ item.name }}<small>{{ item.count }}</small>
      </RouterLink>
    </div>
  </div>
</template>
