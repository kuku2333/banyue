<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const emit = defineEmits<{ 'open-search': [] }>()
const route = useRoute()

interface NavLink {
  to: string
  label: string
  names: string[]
}

const links: NavLink[] = [
  { to: '/', label: '首页', names: ['home', 'post', 'tag'] },
  { to: '/archive', label: '归档', names: ['archive'] },
  { to: '/tags', label: '标签', names: ['tags'] },
  { to: '/about', label: '关于', names: ['about'] },
]

const activeName = computed(() => String(route.name ?? 'home'))
const isActive = (link: NavLink): boolean => link.names.includes(activeName.value)
</script>

<template>
  <header class="site-header">
    <div class="nav">
      <RouterLink class="brand" to="/" aria-label="半页 首页">
        <span class="mark">半</span>
        <b>半页</b>
        <span>Half Page</span>
      </RouterLink>

      <nav class="nav-links" aria-label="主导航">
        <RouterLink v-for="link in links" :key="link.to" :to="link.to" :class="{ on: isActive(link) }">
          {{ link.label }}
        </RouterLink>
      </nav>

      <button class="icon-btn" type="button" aria-label="搜索（Ctrl+K）" @click="emit('open-search')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      </button>
    </div>
  </header>
</template>
