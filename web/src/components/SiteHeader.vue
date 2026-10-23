<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { onClickOutside } from '@vueuse/core'
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits<{ 'open-search': [] }>()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const menuOpen = ref(false)
const menuError = ref('')
const accountRef = ref<HTMLElement | null>(null)

onClickOutside(accountRef, () => {
  menuOpen.value = false
})

interface NavLink {
  to: string
  label: string
  names: string[]
}

const links: NavLink[] = [
  { to: '/', label: '首页', names: ['home', 'post', 'tag'] },
  { to: '/shelf', label: '书架', names: ['shelf', 'read'] },
  { to: '/music', label: '听歌', names: ['music'] },
  { to: '/bili', label: '下载', names: ['bili'] },
  { to: '/archive', label: '归档', names: ['archive'] },
  { to: '/tags', label: '标签', names: ['tags'] },
  { to: '/about', label: '关于', names: ['about'] },
]

const activeName = computed(() => String(route.name ?? 'home'))
const isActive = (link: NavLink): boolean => link.names.includes(activeName.value)

function toggleMenu(): void {
  menuError.value = ''
  menuOpen.value = !menuOpen.value
}

async function signOut(): Promise<void> {
  menuOpen.value = false
  await auth.logout()
}

/** 重新生成恢复码后复用「只剩这一次」的弹窗展示 */
async function regenerate(): Promise<void> {
  menuError.value = ''
  try {
    await auth.regenerateRecoveryCode()
    menuOpen.value = false
    auth.openDialog()
  } catch (error) {
    menuError.value = (error as Error).message
  }
}

function goCollections(): void {
  menuOpen.value = false
  void router.push('/collections')
}
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

      <div ref="accountRef" class="account">
        <button
          v-if="auth.loggedIn"
          type="button"
          class="user-chip"
          :aria-expanded="menuOpen"
          aria-haspopup="menu"
          :title="`@${auth.user?.username}`"
          @click="toggleMenu"
        >
          <span class="avatar">{{ auth.user?.displayName?.slice(0, 1) ?? '·' }}</span>
          <b>{{ auth.user?.displayName ?? auth.user?.username }}</b>
          <span v-if="auth.user?.isAdmin" class="admin-badge">管理员</span>
        </button>
        <button v-else class="login-btn" type="button" @click="auth.openDialog()">登录</button>

        <div v-if="menuOpen && auth.loggedIn" class="account-menu" role="menu">
          <p class="menu-head">
            <b>{{ auth.user?.displayName }}</b>
            <span>@{{ auth.user?.username }}</span>
          </p>
          <button type="button" role="menuitem" @click="goCollections">我的收藏夹</button>
          <button type="button" role="menuitem" @click="regenerate">重新生成恢复码</button>
          <button type="button" role="menuitem" class="danger" @click="signOut">退出登录</button>
          <p v-if="menuError" class="menu-error">{{ menuError }}</p>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.account {
  position: relative;
}

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

.admin-badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.15);
  border: 1px solid rgba(251, 191, 36, 0.4);
  color: #fbbf24;
  font-size: 0.66rem;
  line-height: 1.4;
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

.account-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 95;
  min-width: 176px;
  display: flex;
  flex-direction: column;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid var(--line-strong);
  background: var(--card);
  box-shadow: var(--shadow);
}

.account-menu button {
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--text-2);
  font-size: 0.8rem;
  text-align: left;
}

.account-menu button:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.account-menu button.danger:hover {
  color: var(--danger);
  background: rgba(251, 113, 133, 0.08);
}

.menu-head {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0 0 4px;
  padding: 6px 10px 8px;
  border-bottom: 1px solid var(--line);
}

.menu-head b {
  color: var(--text);
  font-size: 0.84rem;
  font-weight: 600;
}

.menu-head span {
  color: var(--dim);
  font-size: 0.72rem;
}

.menu-error {
  margin: 4px 0 0;
  padding: 0 10px 6px;
  color: var(--danger);
  font-size: 0.72rem;
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
