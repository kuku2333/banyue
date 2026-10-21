<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const active = computed(() => String(route.name ?? 'home'))

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
    to: '/archive',
    name: 'archive',
    label: '归档',
    d: 'M4 4h16v4H4zM5 8v11h14V8M10 12h4',
  },
  {
    to: '/tags',
    name: 'tags',
    label: '标签',
    d: 'M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01',
  },
  {
    to: '/music',
    name: 'music',
    label: '听歌',
    d: 'M7 18a2.6 2.6 0 105.2 0V7.4l8-1.6v9.8',
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
