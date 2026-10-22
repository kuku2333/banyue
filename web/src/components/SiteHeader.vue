<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits<{ 'open-search': [] }>()
const route = useRoute()
const auth = useAuthStore()

interface NavLink {
  to: string
  label: string
  names: string[]
}

const links: NavLink[] = [
  { to: '/', label: '首页', names: ['home', 'post', 'tag'] },
  { to: '/shelf', label: '书架', names: ['shelf', 'read'] },
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

      <RouterLink class="icon-btn" to="/write" aria-label="写点东西">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
        </svg>
      </RouterLink>
      <RouterLink class="icon-btn" to="/music" aria-label="听歌">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="7" cy="18" r="2.6" />
          <circle cx="18" cy="15.6" r="2.6" />
          <path d="M9.6 18V7.4l11-2.2v10.4" />
        </svg>
      </RouterLink>
      <button class="icon-btn" type="button" aria-label="搜索（Ctrl+K）" @click="emit('open-search')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      </button>

      <RouterLink v-if="auth.loggedIn" class="user-chip" to="/collections" :title="`@${auth.user?.username}`">
        <span class="avatar">{{ auth.user?.displayName?.slice(0, 1) ?? '·' }}</span>
        <b>{{ auth.user?.displayName ?? auth.user?.username }}</b>
      </RouterLink>
      <button v-else class="login-btn" type="button" @click="auth.openDialog()">登录</button>
    </div>
  </header>
</template>

<style scoped>
.user-chip {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  color: var(--text-2);
  font-size: 0.8rem;
  transition: 0.15s ease;
}

.user-chip:hover {
  border-color: var(--accent-line);
  color: var(--accent);
}

.user-chip .avatar {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.72rem;
}

.user-chip b {
  font-weight: 500;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.login-btn {
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  color: var(--text-2);
  font-size: 0.8rem;
}

.login-btn:hover {
  color: var(--accent);
  border-color: var(--accent-line);
}

@media (max-width: 767px) {
  .user-chip b {
    display: none;
  }

  .user-chip {
    padding: 4px;
  }
}
</style>
