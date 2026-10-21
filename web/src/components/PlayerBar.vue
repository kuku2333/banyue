<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { formatTime } from '@/lib/music'
import { hashCode } from '@/lib/cover'

const player = usePlayerStore()
const dragStart = ref(false)

const visible = computed(() => Boolean(player.current))
const artStyle = computed(() => {
  const seed = player.current?.id ?? 'x'
  const hue = 158 + (hashCode(seed) % 58)
  return {
    background: `linear-gradient(150deg, hsl(${hue} 70% 46% / .85), hsl(${hue + 42} 76% 58% / .55))`,
  }
})

function onSeek(event: MouseEvent): void {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  player.seek((event.clientX - rect.left) / rect.width)
}
</script>

<template>
  <Transition name="player">
    <aside v-if="visible" class="player" :class="{ collapsed: player.collapsed }">
      <button
        v-if="player.collapsed"
        type="button"
        class="capsule"
        :aria-label="player.playing ? '暂停' : '播放'"
        @click="player.collapsed = false"
      >
        <span class="pulse" :class="{ on: player.playing }" />
        <b>{{ player.current?.title }}</b>
      </button>

      <template v-else>
        <div class="p-head">
          <div class="p-art" :style="artStyle">
            <span v-if="!player.current?.art">♪</span>
            <img v-else :src="player.current.art" alt="" loading="lazy" />
            <i class="p-ring" :class="{ on: player.playing }" />
          </div>
          <div class="p-meta">
            <b>{{ player.current?.title }}</b>
            <span>{{ player.current?.artist || '未知歌手' }}</span>
          </div>
          <button type="button" class="p-icon" aria-label="收起播放器" @click="player.collapsed = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M6 12h12" />
            </svg>
          </button>
          <button type="button" class="p-icon" aria-label="关闭播放器" @click="player.close()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div class="p-bar" role="slider" :aria-valuenow="Math.round(player.progress * 100)" aria-valuemin="0" aria-valuemax="100" @click="onSeek">
          <i :style="{ width: `${player.progress * 100}%` }" />
          <span v-if="dragStart" class="p-time">{{ formatTime(player.currentTime) }}</span>
        </div>

        <div class="p-controls">
          <span class="p-time">{{ formatTime(player.currentTime) }} / {{ formatTime(player.duration) }}</span>
          <button type="button" class="p-icon" :disabled="!player.hasPrev" aria-label="上一首" @click="player.prev()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 20L9 12l10-8z" /><path d="M5 19V5" />
            </svg>
          </button>
          <button type="button" class="p-main" :aria-label="player.playing ? '暂停' : '播放'" @click="player.toggle()">
            <svg v-if="player.playing" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5h3v14H8zM13 5h3v14h-3z" /></svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </button>
          <button type="button" class="p-icon" :disabled="!player.hasNext" aria-label="下一首" @click="player.next()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 4l10 8-10 8z" /><path d="M19 5v14" />
            </svg>
          </button>
          <button
            type="button"
            class="p-icon p-fav"
            :class="{ on: player.current ? player.isFavorite(player.current.id) : false }"
            aria-label="收藏"
            @click="player.current && player.toggleFavorite(player.current)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">
              <path d="M12 4.6l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1L4.5 10l5.2-.8z" />
            </svg>
          </button>
        </div>

        <p v-if="player.error" class="p-error">{{ player.error }}</p>
      </template>
    </aside>
  </Transition>
</template>

<style scoped>
.player {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 85;
  width: 300px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid var(--line-strong);
  background: rgba(14, 20, 27, 0.92);
  backdrop-filter: blur(18px) saturate(140%);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
  color: var(--text);
}

.player.collapsed {
  width: auto;
  padding: 0;
  border-radius: 999px;
}

.capsule {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  max-width: 220px;
}

.capsule b {
  font-size: 0.82rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dim);
  flex: none;
}

.pulse.on {
  background: var(--accent);
  box-shadow: 0 0 0 0 rgba(94, 234, 212, 0.6);
  animation: pulse 1.6s infinite;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(94, 234, 212, 0.5);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(94, 234, 212, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(94, 234, 212, 0);
  }
}

.p-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.p-art {
  position: relative;
  width: 46px;
  height: 46px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-family: var(--serif);
  color: rgba(6, 33, 29, 0.85);
  overflow: hidden;
  flex: none;
}

.p-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.p-ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 1px solid rgba(94, 234, 212, 0.35);
  opacity: 0;
  transition: opacity 0.2s;
}

.p-ring.on {
  opacity: 1;
  animation: spin 6s linear infinite;
  border-style: dashed;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.p-meta {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.p-meta b {
  font-size: 0.86rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.p-meta span {
  color: var(--muted);
  font-size: 0.72rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.p-bar {
  position: relative;
  height: 4px;
  margin: 12px 0 10px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  cursor: pointer;
}

.p-bar i {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
}

.p-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.p-controls .p-time {
  color: var(--dim);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  margin-right: auto;
}

.p-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--text-2);
}

.p-icon svg {
  width: 16px;
  height: 16px;
}

.p-icon:hover:not(:disabled) {
  color: var(--accent);
  background: var(--accent-soft);
}

.p-icon:disabled {
  opacity: 0.3;
}

.p-icon.on {
  color: var(--accent);
}

.p-main {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(140deg, var(--accent), var(--accent-2));
  color: #06211d;
}

.p-main svg {
  width: 18px;
  height: 18px;
}

.p-error {
  margin: 8px 0 0;
  color: var(--danger);
  font-size: 0.72rem;
  text-align: center;
}

.player-enter-active,
.player-leave-active {
  transition: transform 0.24s ease, opacity 0.24s ease;
}

.player-enter-from,
.player-leave-to {
  transform: translateY(12px);
  opacity: 0;
}

@media (max-width: 767px) {
  .player {
    right: 12px;
    left: 12px;
    width: auto;
    bottom: calc(76px + env(safe-area-inset-bottom));
  }
}
</style>
