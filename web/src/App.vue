<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import SiteHeader from '@/components/SiteHeader.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import MobileTabs from '@/components/MobileTabs.vue'
import SearchOverlay from '@/components/SearchOverlay.vue'
import PlayerBar from '@/components/PlayerBar.vue'
import AuthDialog from '@/components/AuthDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useModerationStore } from '@/stores/moderation'
import { useThemeStore } from '@/stores/theme'

const route = useRoute()
const auth = useAuthStore()
const moderation = useModerationStore()
const theme = useThemeStore()
const searchOpen = ref(false)
const progress = ref(0)
/** 系统主题监听器的清理函数 */
let unwatchSystem: (() => void) | null = null

function onScroll(): void {
  const doc = document.documentElement
  const max = doc.scrollHeight - window.innerHeight
  progress.value = max > 0 ? Math.min(100, Math.max(0, (doc.scrollTop / max) * 100)) : 0
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    searchOpen.value = true
  }
  if (event.key === 'Escape') searchOpen.value = false
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('keydown', onKeydown)
  onScroll()
  theme.apply()
  unwatchSystem = theme.watchSystem()
  void auth.ensure()
  void moderation.load()
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('keydown', onKeydown)
  unwatchSystem?.()
})

const isPost = computed(() => route.name === 'post')

// 换页后如果已经在顶部，浏览器不会派发 scroll 事件，进度条会停在上一条文章的位置
watch(
  () => route.fullPath,
  async () => {
    progress.value = 0
    await nextTick()
    onScroll()
  },
)
</script>

<template>
  <div class="progress" :style="{ width: `${progress}%`, opacity: isPost ? 1 : 0 }" aria-hidden="true" />

  <SiteHeader @open-search="searchOpen = true" />

  <main id="main" class="main">
    <RouterView v-slot="{ Component }">
      <Transition name="fade" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </main>

  <SiteFooter />
  <MobileTabs />
  <PlayerBar />
  <AuthDialog v-model:open="auth.dialogOpen" />
  <SearchOverlay v-model:open="searchOpen" />
</template>

<style scoped>
.progress {
  position: fixed;
  inset: 0 auto auto 0;
  height: 2px;
  z-index: 90;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  box-shadow: 0 0 12px rgba(94, 234, 212, 0.5);
  transition:
    width 0.1s linear,
    opacity 0.3s ease;
}

.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.fade-leave-to {
  opacity: 0;
}
</style>
