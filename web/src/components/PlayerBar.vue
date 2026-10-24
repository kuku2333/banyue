<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { PLAY_MODES, usePlayerStore } from '@/stores/player'
import PlaylistPicker from '@/components/PlaylistPicker.vue'
import { api } from '@/lib/api'
import CommentsPanel from '@/components/CommentsPanel.vue'
import { formatTime } from '@/lib/music'
import { hashCode } from '@/lib/cover'

const player = usePlayerStore()
const queueOpen = ref(false)
const pickerOpen = ref(false)
/* 编辑当前曲目信息 */
const editOpen = ref(false)
const editTitle = ref('')
const editArtist = ref('')
const editBusy = ref(false)
const editError = ref('')

function openEdit(): void {
  const track = player.current
  if (!track) return
  editTitle.value = track.title
  editArtist.value = track.artist === '本地文件' ? '' : (track.artist ?? '')
  editError.value = ''
  editOpen.value = true
}

async function saveEdit(): Promise<void> {
  const track = player.current
  if (!track || editBusy.value) return
  const title = editTitle.value.trim()
  const artist = editArtist.value.trim()
  if (!title) {
    editError.value = '歌名不能为空'
    return
  }
  editBusy.value = true
  editError.value = ''
  try {
    if (track.id.startsWith('cloud-')) {
      // 云端：改 assets 的 title / subtitle
      await api(`/api/assets/${encodeURIComponent(track.id.slice(6))}`, {
        method: 'PATCH',
        body: { title, artist },
      })
    } else if (track.local) {
      // 本地：直接改 IndexedDB 里的记录
      const { getTrackBlob, addTrack, listTracks } = await import('@/lib/db')
      const all = await listTracks()
      const record = all.find((item) => item.id === track.id)
      if (record) await addTrack({ ...record, title, artist })
      void getTrackBlob
    } else {
      throw new Error('榜单/搜索来的曲目不能改名')
    }
    // 同步内存里的队列
    const queue = player.queue
    const index = queue.findIndex((item) => item.id === track.id)
    if (index >= 0) {
      queue[index] = { ...queue[index]!, title, artist }
    }
    // 通知列表页重新读库（唱片墙/唱片机立刻跟着变）
    player.markLibraryChanged()
    editOpen.value = false
  } catch (err) {
    editError.value = (err as Error).message
  } finally {
    editBusy.value = false
  }
}

const commentsOpen = ref(false)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const orbCanvas = ref<HTMLCanvasElement | null>(null)
const pos = useStorage('banyue:player:pos', { right: 16, bottom: 96 })
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
// 位置样式对所有屏幕生效（此前手机端返回空对象，导致拖动了也不动）
const playerStyle = computed(() => ({
  right: `${pos.value.right}px`,
  bottom: `${pos.value.bottom}px`,
}))

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** 按面板实际尺寸算拖动边界，避免手机上拖出屏幕 */
function dragBounds() {
  const el = document.querySelector('.player') ?? document.querySelector('.orb')
  const rect = el?.getBoundingClientRect()
  return {
    maxRight: Math.max(8, window.innerWidth - (rect?.width ?? 320) - 8),
    maxBottom: Math.max(8, window.innerHeight - (rect?.height ?? 180) - 8),
  }
}

let startX = 0
let startY = 0
let baseRight = 0
let baseBottom = 0

/** 面板空白处都能拖；按钮、进度条、队列里不触发拖动（队列要能滚） */
const NO_DRAG = 'button, input, a, .queue-panel, .p-bar, [data-no-drag]'

function startDrag(event: PointerEvent): void {
  const target = event.target as HTMLElement
  // 圆球自身就是 button，但它是拖动手柄，优先放行
  if (!target.closest('[data-drag]') && target.closest(NO_DRAG)) return
  dragging.value = true
  draggedDistance = 0
  startX = event.clientX
  startY = event.clientY
  // 存储的位置可能越界（换设备、屏幕变小），先校正到可视区内，否则拖动会被 clamp 卡死
  const bounds = dragBounds()
  baseRight = clamp(pos.value.right, 8, bounds.maxRight)
  baseBottom = clamp(pos.value.bottom, 8, bounds.maxBottom)
  pos.value = { right: baseRight, bottom: baseBottom }
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', endDrag)
  // 手机上手指移出元素/被系统打断时也要收尾，否则拖动会「粘住」
  window.addEventListener('pointercancel', endDrag)
}

function onDrag(event: PointerEvent): void {
  if (!dragging.value) return
  event.preventDefault()
  draggedDistance = Math.max(
    draggedDistance,
    Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY),
  )
  const bounds = dragBounds()
  pos.value = {
    right: clamp(baseRight - (event.clientX - startX), 8, bounds.maxRight),
    bottom: clamp(baseBottom - (event.clientY - startY), 8, bounds.maxBottom),
  }
}

function endDrag(): void {
  dragging.value = false
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
}

/** 圆球上的点击：只有没拖动时才当点击（展开），拖动后松手不触发播放/暂停 */
function onOrbClick(): void {
  if (draggedDistance < 6) player.collapsed = false
  draggedDistance = 0
}

function onWheel(event: WheelEvent): void {
  // 队列面板本身要能滚，别把滚轮全吃掉
  if ((event.target as HTMLElement | null)?.closest('.queue-panel')) return
  event.preventDefault()
  const step = event.deltaY < 0 ? 0.05 : -0.05
  player.setVolume(player.volume + step)
}

/* ---------- 队列拖拽排序 ---------- */

const dragFrom = ref<number | null>(null)
const dragTo = ref<number | null>(null)

function onQueueDown(event: PointerEvent, i: number): void {
  // 点在删除按钮上不启动拖拽
  if ((event.target as HTMLElement).closest('.q-del')) return
  dragFrom.value = i
  dragTo.value = i
}

function onQueueMove(event: PointerEvent): void {
  if (dragFrom.value === null) return
  const el = document.elementFromPoint(event.clientX, event.clientY)
  const li = el?.closest('li')
  if (!li || !li.parentElement) return
  const items = [...li.parentElement.children]
  const at = items.indexOf(li as HTMLElement)
  if (at >= 0) dragTo.value = at
}

function onQueueUp(): void {
  if (dragFrom.value !== null && dragTo.value !== null && dragFrom.value !== dragTo.value) {
    player.moveTo(dragFrom.value, dragTo.value)
  }
  dragFrom.value = null
  dragTo.value = null
}

/* ---------- 睡眠定时 ---------- */

const SLEEP_STEPS = [0, 15, 30, 60, 90]

const sleepLabel = computed(() => {
  const left = player.sleepRemaining
  if (left <= 0) return '定时'
  const m = Math.floor(left / 60)
  const s = left % 60
  return `${m}:${String(s).padStart(2, '0')}`
})

/** 依次循环：关 → 15 → 30 → 60 → 90 → 关 */
function cycleSleep(): void {
  if (player.sleepRemaining > 0) {
    player.clearSleepTimer()
    return
  }
  const used = Number(sessionStorage.getItem('banyue:sleep:last') ?? 0)
  const at = SLEEP_STEPS.indexOf(used)
  const next = SLEEP_STEPS[(at + 1) % SLEEP_STEPS.length]!
  if (next === 0) {
    player.clearSleepTimer()
    return
  }
  sessionStorage.setItem('banyue:sleep:last', String(next))
  player.setSleepTimer(next)
}

/* ---------- 进度条：点击跳转 + 拖动 ---------- */

const seekEl = ref<HTMLElement | null>(null)

function seekAt(clientX: number): void {
  const el = seekEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (!rect.width) return
  player.seek((clientX - rect.left) / rect.width)
}

function onSeekMove(event: PointerEvent): void {
  seekAt(event.clientX)
}

function onSeekUp(): void {
  window.removeEventListener('pointermove', onSeekMove)
  window.removeEventListener('pointerup', onSeekUp)
  window.removeEventListener('pointercancel', onSeekUp)
}

/** 按下即跳到该位置，然后跟着手指/鼠标继续拖 */
function startSeek(event: PointerEvent): void {
  if (!player.duration) return
  event.preventDefault()
  event.stopPropagation()
  seekAt(event.clientX)
  window.addEventListener('pointermove', onSeekMove)
  window.addEventListener('pointerup', onSeekUp)
  window.addEventListener('pointercancel', onSeekUp)
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
/** 静音前的音量，M 键恢复用 */
let lastVolume = 0.8

function onGlobalKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target && (/^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable)) return
  // 焦点在按钮/链接上时，空格是原生「点击」语义，交给它们自己处理，避免和这里来回抵消
  if (target?.closest('button, a, [role="button"]')) return
  if (!player.current) return
  if (event.code === 'Space' || event.key === ' ') {
    event.preventDefault()
    void player.toggle()
    return
  }
  if (player.collapsed) return
  // 阅读器打开时 ← → 是翻页，别顺手把歌也切了
  if (document.querySelector('.reader')) return
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    void player.shift(1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    void player.shift(-1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    player.setVolume(player.volume + 0.05)
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    player.setVolume(player.volume - 0.05)
  } else if (event.key === 'm' || event.key === 'M') {
    // 静音开关：记住静音前的音量
    if (player.volume > 0) {
      lastVolume = player.volume
      player.setVolume(0)
    } else {
      player.setVolume(lastVolume || 0.8)
    }
  } else if (event.key === 'f' || event.key === 'F') {
    if (player.current) player.toggleFavorite(player.current)
  } else if (/^[1-9]$/.test(event.key)) {
    // 数字键跳到 10%~90%
    event.preventDefault()
    player.seek(Number(event.key) / 10)
  }
}

/** 面板在屏内时，把存储的位置校正回可视区（换设备/地址栏收起/旋转后旧位置可能越界） */
function correctPosition(): void {
  const el = document.querySelector('.player') ?? document.querySelector('.orb')
  if (!el) return
  const bounds = dragBounds()
  pos.value = {
    right: clamp(pos.value.right, 8, bounds.maxRight),
    bottom: clamp(pos.value.bottom, 8, bounds.maxBottom),
  }
}

onMounted(() => {
  raf = requestAnimationFrame(drawSpectrum)
  window.addEventListener('keydown', onGlobalKeydown)
  correctPosition()
  window.addEventListener('resize', correctPosition)
  player.bindMediaSession()
  player.updateMediaSession()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('resize', correctPosition)
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
      @wheel="onWheel"
      @pointerdown="startDrag"
    >
      <div v-if="queueOpen" class="queue-panel">
        <header>
          <b>播放队列</b>
          <span>{{ player.queue.length }} 首 · {{ modeInfo.label }}</span>
          <button type="button" class="p-icon" aria-label="关闭队列" @click="queueOpen = false">×</button>
        </header>
        <ol @pointermove="onQueueMove" @pointerup="onQueueUp" @pointercancel="onQueueUp">
          <li
            v-for="(track, i) in player.queue"
            :key="`${track.id}-${i}`"
            :class="{ on: i === player.index, dragging: dragFrom === i, 'drop-target': dragTo === i && dragFrom !== null && dragFrom !== i }"
            @pointerdown="onQueueDown($event, i)"
          >
            <span class="q-grip" aria-hidden="true">⋮⋮</span>
            <button type="button" class="q-main" @click="player.jumpTo(i)">
              <b>{{ track.title }}</b>
              <span>{{ track.artist || (track.local ? '本地文件' : '') }}</span>
            </button>
            <button type="button" class="q-del" aria-label="从队列移除" @click="player.removeAt(i)">×</button>
          </li>
        </ol>
      </div>

      <div class="p-head" :data-analyser="player.analyser ? 'on' : 'off'">
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
        ref="seekEl"
        class="p-bar"
        role="slider"
        tabindex="0"
        :aria-valuenow="Math.round(player.progress * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`播放进度 ${formatTime(player.currentTime)} / ${formatTime(player.duration)}`"
        @pointerdown="startSeek"
        @keydown.left.prevent="player.seek(player.progress - 0.01)"
        @keydown.right.prevent="player.seek(player.progress + 0.01)"
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
          >{{ modeInfo.short }}</button>
        <button
          type="button"
          class="p-mode"
          :class="{ on: player.rate !== 1 }"
          title="播放速度"
          @click="player.cycleRate()"
        >
          {{ player.rate }}×
        </button>
        <button
          type="button"
          class="p-mode"
          :class="{ on: player.sleepRemaining > 0 }"
          :title="player.sleepRemaining > 0 ? '点一下取消定时' : '睡眠定时：到点自动暂停'"
          @click="cycleSleep"
        >
          {{ sleepLabel }}
        </button>
        <button type="button" class="p-mode" title="改歌名 / 歌手" @click="openEdit">编辑</button>
        <button type="button" class="p-mode" @click="pickerOpen = true">歌单</button>
        <button type="button" class="p-mode" @click="commentsOpen = true">评论</button>
      </div>

      <div class="p-vol">
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
    data-drag
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

  <Transition name="auth">
    <div v-if="editOpen" class="edit-layer" role="dialog" aria-modal="true" aria-label="编辑歌曲信息" @click.self="editOpen = false">
      <div class="edit-box">
        <header>
          <h2>编辑歌曲信息</h2>
          <button type="button" class="edit-close" aria-label="关闭" @click="editOpen = false">×</button>
        </header>
        <label>
          <span>歌名</span>
          <input v-model="editTitle" maxlength="120" />
        </label>
        <label>
          <span>歌手</span>
          <input v-model="editArtist" maxlength="120" placeholder="留空表示未知歌手" />
        </label>
        <p v-if="editError" class="edit-err">{{ editError }}</p>
        <button type="button" class="edit-save" :disabled="editBusy" @click="saveEdit">
          {{ editBusy ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </Transition>

  <PlaylistPicker
    :open="pickerOpen"
    :track-title="player.current?.title ?? ''"
    :track-artist="player.current?.artist ?? ''"
    :track-hash="player.current?.hash ?? ''"
    :track-asset-id="player.current?.id?.startsWith('cloud-') ? player.current.id.slice(6) : ''"
    @update:open="pickerOpen = $event"
  />

  <CommentsPanel :open="commentsOpen" :track="player.current" @update:open="commentsOpen = $event" />
</template>

<style scoped>
.edit-layer {
  position: fixed;
  inset: 0;
  z-index: 130;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(4, 8, 12, 0.66);
}
.edit-box {
  width: min(360px, 100%);
  padding: 18px;
  border: 1px solid #2b3642;
  border-radius: 14px;
  background: #141b23;
  color: #e7edf2;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
}
.edit-box header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.edit-box h2 {
  margin: 0;
  font-size: 1rem;
}
.edit-close {
  border: none;
  background: none;
  color: inherit;
  font-size: 1.3rem;
  opacity: 0.6;
  cursor: pointer;
}
.edit-box label {
  display: block;
  margin-bottom: 10px;
}
.edit-box label span {
  display: block;
  margin-bottom: 4px;
  font-size: 0.76rem;
  opacity: 0.6;
}
.edit-box input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid #2b3642;
  border-radius: 8px;
  background: #0d1319;
  color: #e7edf2;
  font-size: 0.9rem;
}
.edit-save {
  width: 100%;
  margin-top: 6px;
  padding: 10px;
  border: none;
  border-radius: 9px;
  background: #4cc2ff;
  color: #06222e;
  font-weight: 600;
  cursor: pointer;
}
.edit-save:disabled {
  opacity: 0.5;
}
.edit-err {
  margin: 0 0 8px;
  color: #ff7b72;
  font-size: 0.8rem;
}

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
  /* 空白处可拖 */
  cursor: grab;
  touch-action: none;
}
.player.dragging {
  cursor: grabbing;
  user-select: none;
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
  /* 面板整体 touch-action: none 是为了拖动，队列里要还原成能滚 */
  touch-action: pan-y;
  cursor: default;
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
  touch-action: none;
}

.queue-panel li.on {
  background: var(--accent-soft);
}

/* 拖拽排序时的反馈 */
.queue-panel li.dragging {
  opacity: 0.45;
}

.queue-panel li.drop-target {
  box-shadow: inset 0 2px 0 var(--accent);
}

.q-grip {
  flex: none;
  padding: 0 2px;
  color: var(--dim);
  font-size: 0.7rem;
  letter-spacing: -2px;
  cursor: grab;
  user-select: none;
}

.queue-panel li:active .q-grip {
  cursor: grabbing;
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

/* 可见的细条只有 4px，但热区撑到 22px——否则很难点中 */
.p-bar {
  position: relative;
  height: 22px;
  margin: 3px 0 0;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
  outline: none;
}

/* 细条本体：用伪元素画，热区不受影响 */
.p-bar::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
}

.p-bar i {
  position: relative;
  display: block;
  height: 4px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  pointer-events: none;
}

/* 拖动/悬停时给个抓取反馈 */
.p-bar:hover::before {
  background: rgba(255, 255, 255, 0.16);
}

.p-bar:focus-visible::before {
  box-shadow: 0 0 0 2px rgba(94, 234, 212, 0.5);
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
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.p-mode {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px 6px;
  border-radius: 8px;
  border: 1px solid var(--line);
  color: var(--text-2);
  font-size: 0.72rem;
  line-height: 1.3;
  /* 关键：禁止文字竖排（被挤窄时会逐字换行） */
  white-space: nowrap;
  writing-mode: horizontal-tb;
  overflow: hidden;
  text-overflow: ellipsis;
}

.p-mode span {
  color: var(--accent);
}

.p-mode:hover {
  color: var(--accent);
  border-color: var(--accent-line);
}

/* 倍速 / 睡眠定时开启时高亮 */
.p-mode.on {
  color: var(--accent);
  border-color: var(--accent-line);
  background: var(--accent-soft);
}

/* 音量独占一行，横向铺满，不再挤在按钮行末尾 */
.p-vol {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 8px;
  color: var(--dim);
}

.p-vol svg {
  flex: none;
  width: 15px;
  height: 15px;
}

.p-vol input {
  flex: 1;
  width: 100%;
  min-width: 0;
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
  /* 只限宽度，不设 left/right——位置交给拖动的 right/bottom，否则两者打架 */
  .player {
    width: min(320px, calc(100vw - 24px));
    bottom: calc(84px + env(safe-area-inset-bottom));
  }
}
</style>
