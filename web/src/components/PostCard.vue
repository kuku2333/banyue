<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Post } from '@/lib/content'
import { coverSvg } from '@/lib/cover'
import { formatDate } from '@/lib/format'
import { progressLabel, readProgress } from '@/lib/reading'

const props = defineProps<{ post: Post }>()
const cover = computed(() => coverSvg(props.post.slug))
const route = useRoute()

/**
 * 阅读进度存在 localStorage 里，不是响应式数据。
 * 从文章页退回列表时组件会被复用，computed 不会自己重算，
 * 所以每次路由变化、以及组件挂载时都主动读一次。
 */
const progress = ref(0)

function refresh(): void {
  progress.value = readProgress(props.post.slug)
}

onMounted(refresh)
onActivated(refresh)

// 路由切回列表（name 变回 home/tag）时刷新
watch(
  () => route.fullPath,
  () => refresh(),
)

const label = computed(() => progressLabel(progress.value))
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
        <span v-if="label" class="read-progress">{{ label }}</span>
        <span v-for="tag in post.tags" :key="tag" class="tag">{{ tag }}</span>
      </div>
      <!-- 细进度条：不占额外高度，一眼看出读到哪 -->
      <div v-if="progress > 0" class="read-bar" aria-hidden="true">
        <i :style="{ width: `${Math.round(progress * 100)}%` }" />
      </div>
    </div>
  </RouterLink>
</template>

<style scoped>
.read-progress {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.read-bar {
  position: relative;
  height: 2px;
  margin-top: 10px;
  border-radius: 2px;
  background: var(--line);
  overflow: hidden;
}

.read-bar i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
}
</style>
