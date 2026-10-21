<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useStorage, useWindowSize } from '@vueuse/core'
import { PLAY_MODES, usePlayerStore } from '@/stores/player'
import { formatTime } from '@/lib/music'
import { hashCode } from '@/lib/cover'

const player = usePlayerStore()
const queueOpen = ref(false)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const orbCanvas = ref<HTMLCanvasElement | null>(null)
const pos = useStorage('banyue:player:pos', { right: 20, bottom: 20 })
const { width: windowWidth } = useWindowSize()
const dragging = ref(false)
let draggedDistance = 0

const visible = computed(() => Boolean(player.current))
const artStyle = computed(() => {
  const seed = player.current?.id ?? 'x'
  const hue = 158 + (hashCode(seed) % 58)
  return {
    background: `linear-gradient(150deg, hsl(${hue} 70% 46% / .85), hsl(${hue + 42} 76% 58% / .55))`,
  }
})
const modeInfo = computed(() => PLAY_MODES.find((item) => item.id === player.mode) ?? PLAY_MODES[0]!)
const playerStyle = computed(() =>
  windowWidth.value > 767 ? { right: `${pos.value.right}px`, bottom: `${pos.value.bottom}px` } : {},
)

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

let startX = 0
let startY = 0
let baseRight = 0
let baseBottom = 0

function startDrag(event: PointerEvent): void {
  if ((event.target as HTMLElement).closest('button') && !player.collapsed) return
  dragging.value = true
  draggedDistance = 0
  startX = event.clientX
  startY = event.clientY
  baseRight = pos.value.right
  baseBottom = pos.value.bottom
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', endDrag)
}

function onDrag(event: PointerEvent): void {
  if (!dragging.value) return
  draggedDistance = Math.max(
    draggedDistance,
    Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY),
  )
  pos.value = {
    right: clamp(baseRight - (event.clientX - startX), 8, window.innerWidth - 180),
    bottom: clamp(baseBottom - (event.clientY - startY), 8, window.innerHeight - 120),
  }
}

function endDrag(): void {
  dragging.value = false
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', endDrag)
}

/** 圆球上的点击：只有没拖动时才当点击（展开），拖动后松手不触发播放/暂停 */
function onOrbClick(): void {
  if (draggedDistance < 6) player.collapsed = false
  draggedDistance = 0
}

function onWheel(event: WheelEvent): void {
  const step = event.deltaY < 0 ? 0.05 : -0.05
  player.setVolume(player.volume + step)
}

function onSeek(event: MouseEvent): void {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  player.seek((event.clientX - rect.left) / rect.width)
}

function onVolume(event: Event): void {
  player.setVolume(Number((event.target as HTMLInputElement).value))
}

/* ---------- 频谱律动 ---------- */

let raf = 0
const spectrum = new Uint8Array(64)

function drawSpectrum(): void {
  raf = requestAnimationFrame(drawSpectrum)
  drawBars()
  drawOrb()
}

function drawBars(): void {
  const canvas = canvasEl.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  const { width, height } = canvas
  context.clearRect(0, 0, width, height)

  const analyser = player.analyser
  if (analyser) analyser.getByteFrequencyData(spectrum)

  const bars = 36
  const gap = 2
  const barWidth = (width - gap * (bars - 1)) / bars
  const gradient = context.createLinearGradient(0, height, width, 0)
  gradient.addColorStop(0, 'rgba(94, 234, 212, 0.85)')
  gradient.addColorStop(1, 'rgba(125, 211, 252, 0.85)')
  context.fillStyle = gradient

  const t = performance.now() / 600
  for (let i = 0; i < bars; i++) {
    const raw = analyser && player.playing ? (spectrum[i] ?? 0) / 255 : 0
    // 没有频谱数据时也给一点缓慢呼吸，避免完全静止
    const idle = 0.08 + 0.04 * Math.sin(t + i * 0.4)
    const level = Math.max(idle, raw ** 1.3)
    const barHeight = Math.max(2, level * height)
    const x = i * (barWidth + gap)
    context.beginPath()
    context.roundRect(x, height - barHeight, barWidth, barHeight, barWidth / 2)
    context.fill()
  }
}

/** 收起时的小圆球：内圈随低频脉动，外圈是一圈随音乐起伏的频谱 */
function drawOrb(): void {
  const canvas = orbCanvas.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  const { width, height } = canvas
  context.clearRect(0, 0, width, height)

  const analyser = player.analyser
  const cx = width / 2
  const cy = height / 2
  const now = performance.now()
  const spin = player.playing ? now / 7000 : 0
  const bass =
    analyser && player.playing
      ? ((spectrum[1] ?? 0) + (spectrum[2] ?? 0) + (spectrum[3] ?? 0)) / 3 / 255
      : 0
  const pulse = Math.min(1, bass)

  // 中心光核：跟着低频一起呼吸
  const core = width * (0.15 + 0.07 * pulse)
  const glow = context.createRadialGradient(cx, cy, 0, cx, cy, core * 2)
  glow.addColorStop(0, `rgba(94, 234, 212, ${0.3 + 0.35 * pulse})`)
  glow.addColorStop(1, 'rgba(94, 234, 212, 0)')
  context.fillStyle = glow
  context.beginPath()
  context.arc(cx, cy, core * 2, 0, Math.PI * 2)
  context.fill()

  // 外圈频谱
  const bars = 28
  const baseRadius = width * 0.21
  const maxLength = width * 0.24
  for (let i = 0; i < bars; i++) {
    const angle = (i / bars) * Math.PI * 2 - Math.PI / 2 + spin
    const raw = analyser && player.playing ? (spectrum[(i * 2) % spectrum.length] ?? 0) / 255 : 0
    const idle = 0.26 + 0.14 * Math.sin(now / 380 + i * 0.7)
    const level = Math.max(idle, raw ** 1.1)
    const inner = baseRadius
    const outer = baseRadius + level * maxLength
    const x1 = cx + Math.cos(angle) * inner
    const y1 = cy + Math.sin(angle) * inner
    const x2 = cx + Math.cos(angle) * outer
    const y2 = cy + Math.sin(angle) * outer

    context.beginPath()
    context.lineCap = 'round'
    context.lineWidth = width * 0.05
    context.strokeStyle = `hsla(${166 + (i / bars) * 40}, 86%, ${60 + level * 14}%, ${0.55 + level * 0.45})`
    context.moveTo(x1, y1)
    context.lineTo(x2, y2)
    context.stroke()
  }
}

/** 全局快捷键：空格暂停/继续；展开状态下 ← → 切歌 */
function onGlobalKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target && (/^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable)) return
  if (!player.current) return
  if (event.code === 'Space' || event.key === ' ') {
    event.preventDefault()
    void player.toggle()
    return
  }
  if (player.collapsed) return
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    void player.shift(1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    void player.shift(-1)
  }
}

onMounted(() => {
  raf = requestAnimationFrame(drawSpectrum)
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', onGlobalKeydown)
  endDrag()
})
</script>

<template>
  <Transition name="player">
    <aside
      v-if="visible && !player.collapsed"
      class="player"
      :class="{ dragging }"
      :style="playerStyle"
      @wheel.prevent="onWheel"
    >
      <div v-if="queueOpen" class="queue-panel">
        <header>
          <b>播放队列</b>
          <span>{{ player.queue.length }} 首 · {{ modeInfo.label }}</span>
          <button type="button" class="p-icon" aria-label="关闭队列" @click="queueOpen = false">×</button>
        </header>
        <ol>
          <li
            v-for="(track, i) in player.queue"
            :key="`${track.id}-${i}`"
            :class="{ on: i === player.index }"
          >
            <button type="button" class="q-main" @click="player.jumpTo(i)">
              <b>{{ track.title }}</b>
              <span>{{ track.artist || (track.local ? '本地文件' : '') }}</span>
            </button>
            <button type="button" class="q-del" aria-label="从队列移除" @click="player.removeAt(i)">×</button>
          </li>
        </ol>
      </div>

      <div class="p-head" :data-analyser="player.analyser ? 'on' : 'off'" @pointerdown="startDrag">
        <div class="p-art" :style="artStyle">
          <span v-if="!player.current?.art">♪</span>
          <img v-else :src="player.current.art" alt="" loading="lazy" />
          <i class="p-ring" :class="{ on: player.playing }" />
        </div>
        <div class="p-meta">
          <b>{{ player.current?.title }}</b>
          <span>{{ player.current?.artist || '未知歌手' }}</span>
        </div>
        <button
          type="button"
          class="p-icon"
          :class="{ on: queueOpen }"
          aria-label="播放队列"
          @click="queueOpen = !queueOpen"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
          >
            <path d="M4 7h12M4 12h12M4 17h8" />
            <path d="M18 9v8l3-2" />
          </svg>
        </button>
        <button type="button" class="p-icon" aria-label="收起播放器" @click="player.collapsed = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 12h12" />
          </svg>
        </button>
        <button type="button" class="p-icon" aria-label="关闭播放器" @click="player.close()">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <canvas ref="canvasEl" class="p-spectrum" width="600" height="56" aria-hidden="true" />

      <div
        class="p-bar"
        role="slider"
        :aria-valuenow="Math.round(player.progress * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
        @click="onSeek"
      >
        <i :style="{ width: `${player.progress * 100}%` }" />
      </div>

      <div class="p-controls">
        <span class="p-time">{{ formatTime(player.currentTime) }} / {{ formatTime(player.duration) }}</span>
        <button
          type="button"
          class="p-icon"
          :disabled="!player.hasPrev"
          aria-label="上一首"
          @click="player.prev()"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M19 20L9 12l10-8z" />
            <path d="M5 19V5" />
          </svg>
        </button>
        <button
          type="button"
          class="p-main"
          :aria-label="player.playing ? '暂停' : '播放'"
          @click="player.toggle()"
        >
          <svg v-if="player.playing" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5h3v14H8zM13 5h3v14h-3z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </button>
        <button
          type="button"
          class="p-icon"
          :disabled="!player.hasNext"
          aria-label="下一首"
          @click="player.next()"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M5 4l10 8-10 8z" />
            <path d="M19 5v14" />
          </svg>
        </button>
        <button
          type="button"
          class="p-icon p-fav"
          :class="{ on: player.current ? player.isFavorite(player.current.id) : false }"
          aria-label="收藏"
          @click="player.current && player.toggleFavorite(player.current)"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
          >
            <path d="M12 4.6l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1L4.5 10l5.2-.8z" />
          </svg>
        </button>
      </div>

      <div class="p-extra">
        <button type="button" class="p-mode" :title="modeInfo.label" @click="player.cycleMode()">
          <span aria-hidden="true">{{ modeInfo.icon }}</span
          >{{ modeInfo.label }}
        </button>
        <label class="p-vol">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 9v6h4l5 4V5L8 9z" />
            <path d="M17 8.5a5 5 0 010 7" />
          </svg>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="player.volume"
            aria-label="音量"
            @input="onVolume"
          />
        </label>
      </div>

      <p v-if="player.error" class="p-error">{{ player.error }}</p>
    </aside>
  </Transition>

  <button
    v-if="visible && player.collapsed"
    type="button"
    class="orb"
    :class="{ playing: player.playing }"
    :style="playerStyle"
    :aria-label="player.playing ? '暂停' : '播放'"
    @pointerdown="startDrag"
    @click="onOrbClick"
  >
    <canvas ref="orbCanvas" class="orb-canvas" width="240" height="240" aria-hidden="true" />
    <span class="orb-icon" aria-hidden="true">
      <svg v-if="player.playing" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5h3v14H8zM13 5h3v14h-3z" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
    </span>
  </button>
</template>

<style scoped>
.player {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 85;
  width: 320px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid var(--line-strong);
  background: rgba(14, 20, 27, 0.94);
  backdrop-filter: blur(18px) saturate(140%);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
  color: var(--text);
}

.player.dragging {
  cursor: grabbing;
  user-select: none;
}

.p-spectrum {
  width: 100%;
  height: 28px;
  margin: 10px 0 2px;
  opacity: 0.9;
}

.p-head {
  cursor: grab;
  touch-action: none;
}

/* ---------- 收起后的小圆球 ---------- */

.orb {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 85;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 115%, rgba(94, 234, 212, 0.22), rgba(12, 18, 24, 0.97) 68%);
  border: 1px solid var(--line-strong);
  box-shadow:
    0 14px 34px rgba(0, 0, 0, 0.55),
    inset 0 0 20px rgba(94, 234, 212, 0.12);
  cursor: grab;
  touch-action: none;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.orb:hover {
  transform: scale(1.04);
  box-shadow:
    0 16px 38px rgba(0, 0, 0, 0.6),
    inset 0 0 24px rgba(94, 234, 212, 0.2);
}

.orb.playing {
  animation: orb-breathe 2.4s ease-in-out infinite;
}

@keyframes orb-breathe {
  0%,
  100% {
    box-shadow:
      0 14px 34px rgba(0, 0, 0, 0.55),
      inset 0 0 20px rgba(94, 234, 212, 0.12),
      0 0 0 0 rgba(94, 234, 212, 0.28);
  }
  50% {
    box-shadow:
      0 14px 34px rgba(0, 0, 0, 0.55),
      inset 0 0 26px rgba(94, 234, 212, 0.24),
      0 0 0 8px rgba(94, 234, 212, 0);
  }
}

.orb-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.orb-icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  color: var(--accent);
  filter: drop-shadow(0 0 6px rgba(94, 234, 212, 0.45));
}

.orb-icon svg {
  width: 18px;
  height: 18px;
}

.queue-panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 10px);
  max-height: 280px;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--line-strong);
  background: rgba(14, 20, 27, 0.98);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.queue-panel header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}

.queue-panel header b {
  font-size: 0.82rem;
}

.queue-panel header span {
  margin-right: auto;
  color: var(--dim);
  font-size: 0.72rem;
}

.queue-panel ol {
  margin: 0;
  padding: 6px;
  list-style: none;
  overflow-y: auto;
}

.queue-panel li {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 8px;
}

.queue-panel li.on {
  background: var(--accent-soft);
}

.q-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 6px 8px;
  text-align: left;
  line-height: 1.35;
}

.q-main b {
  font-size: 0.78rem;
  font-weight: 500;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.q-main span {
  color: var(--dim);
  font-size: 0.68rem;
}

.q-del {
  padding: 4px 8px;
  color: var(--dim);
  font-size: 0.8rem;
  opacity: 0;
}

.queue-panel li:hover .q-del {
  opacity: 1;
}

.q-del:hover {
  color: var(--danger);
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
  border: 1px dashed rgba(94, 234, 212, 0.35);
  opacity: 0;
}

.p-ring.on {
  opacity: 1;
  animation: spin 6s linear infinite;
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

.p-time {
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

.p-icon:hover:not(:disabled),
.p-icon.on {
  color: var(--accent);
  background: var(--accent-soft);
}

.p-icon:disabled {
  opacity: 0.3;
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

.p-extra {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.p-mode {
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  color: var(--text-2);
  font-size: 0.72rem;
}

.p-mode span {
  margin-right: 6px;
  color: var(--accent);
}

.p-mode:hover {
  color: var(--accent);
  border-color: var(--accent-line);
}

.p-vol {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: var(--dim);
}

.p-vol svg {
  width: 14px;
  height: 14px;
}

.p-vol input {
  width: 74px;
  accent-color: var(--accent);
}

.p-error {
  margin: 8px 0 0;
  color: var(--danger);
  font-size: 0.72rem;
  text-align: center;
}

.player-enter-active,
.player-leave-active {
  transition:
    transform 0.24s ease,
    opacity 0.24s ease;
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
