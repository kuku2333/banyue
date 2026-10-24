<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
/** 文章 / 标签页归到「首页」，阅读器归到「书架」，与顶部导航保持一致 */
const active = computed(() => {
  const name = String(route.name ?? 'home')
  if (['home', 'post', 'tag'].includes(name)) return 'home'
  if (['shelf', 'read'].includes(name)) return 'shelf'
  return name
})

const tabs = [
  {
    to: '/',
    name: 'home',
    label: '首页',
    d: 'M3 10.5L12 3l9 7.5M5 10v10h14V10',
  },
  {
    to: '/shelf',
    name: 'shelf',
    label: '书架',
    d: 'M4 4.5h6v15H4zM10 4.5h6v15h-6zM17.2 5.2l3 14.2',
  },
  {
    to: '/music',
    name: 'music',
    label: '听歌',
    d: 'M7 18a2.6 2.6 0 105.2 0V7.4l8-1.6v9.8',
  },
  {
    to: '/math',
    name: 'math',
    label: '数学',
    d: 'M4 4h16v16H4zM4 16l5-5 4 4 6-7',
  },
  {
    to: '/bili',
    name: 'bili',
    label: '下载',
    d: 'M12 4v11m0 0l-4-4m4 4l4-4M5 19h14',
  },
]
</script>

<template>
  <nav class="tabs" aria-label="移动端导航">
    <RouterLink v-for="tab in tabs" :key="tab.to" :to="tab.to" :class="{ on: active === tab.name }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path :d="tab.d" />
      </svg>
      {{ tab.label }}
    </RouterLink>
  </nav>
</template>
