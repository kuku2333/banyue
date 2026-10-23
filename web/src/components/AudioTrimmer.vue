<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * 音频剪辑器：解码 → 画波形 → 拖选区间 → 试听 → 导出 WAV
 * 纯前端实现，不依赖 ffmpeg。
 */
const props = defineProps<{
  src: string
  title?: string
}>()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const loading = ref(true)
const error = ref('')
const ready = ref(false)
const duration = ref(0)
const start = ref(0)
const end = ref(0)
const playing = ref(false)
const cursor = ref(0)
const busy = ref(false)
const progress = ref(0)

let ctx: AudioContext | null = null
let buffer: AudioBuffer | null = null
let source: AudioBufferSourceNode | null = null
let raf = 0
let startedAt = 0
let observer: ResizeObserver | null = null

const selection = computed(() => Math.max(0, end.value - start.value))

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  stop()
  cancelAnimationFrame(raf)
  observer?.disconnect()
  observer = null
  void ctx?.close()
  ctx = null
  buffer = null
})

watch(
  () => props.src,
  () => void load(),
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  ready.value = false
  progress.value = 0
  stop()
  try {
    const data = await fetchAudio(props.src)
    ctx = ctx ?? new AudioContext()
    const decoded = await ctx.decodeAudioData(data)
    buffer = decoded
    duration.value = decoded.duration
    start.value = 0
    end.value = decoded.duration
    // 先收掉 loading，canvas 才会被渲染出来，随后才能按真实尺寸绘制
    loading.value = false
    ready.value = true
    await nextTick()
    draw()
    observeSize()
  } catch (err) {
    error.value = (err as Error).message || '无法解码这段音频'
    loading.value = false
  }
}

/**
 * 分段拉取音频：B站 的 CDN 单次长连接容易断，按 1MB 分段 + 重试最稳。
 */
async function fetchAudio(url: string): Promise<ArrayBuffer> {
  const probe = await fetch(url, { headers: { range: 'bytes=0-0' } })
  if (!probe.ok) throw new Error(`读取音频失败（${probe.status}）`)
  const total = Number(/bytes \d+-\d+\/(\d+)/.exec(probe.headers.get('content-range') ?? '')?.[1] ?? 0)
  if (!total) {
    // 服务端不支持 Range，只能整段拉
    const full = await fetch(url)
    if (!full.ok) throw new Error(`读取音频失败（${full.status}）`)
    return full.arrayBuffer()
  }

  const chunkSize = 1 << 20
  const parts: Uint8Array[] = []
  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(total - 1, start + chunkSize - 1)
    let done = false
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      try {
        const response = await fetch(url, { headers: { range: `bytes=${start}-${end}` } })
        if (response.status === 206 || response.status === 200) {
          const buffer = await response.arrayBuffer()
          if (buffer.byteLength > 0) {
            parts.push(new Uint8Array(buffer))
            done = true
          }
        }
      } catch {
        /* 重试 */
      }
      if (!done) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
    if (!done) throw new Error('音频分段下载失败，可能链接已过期，重新解析一次')
    progress.value = Math.round(((start + chunkSize) / total) * 100)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.byteLength
  }
  return merged.buffer
}

/** 容器尺寸变化（旋转屏、窗口缩放）时重绘 */
function observeSize(): void {
  const canvas = canvasEl.value
  if (!canvas || observer) return
  observer = new ResizeObserver(() => draw())
  observer.observe(canvas)
}

function draw(): void {
  const canvas = canvasEl.value
  if (!canvas || !buffer) return
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const g = canvas.getContext('2d')
  if (!g) return
  // 每次重绘重置变换，避免 scale 累积
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, width, height)

  const data = buffer.getChannelData(0)
  const step = Math.max(1, Math.floor(data.length / width))
  const mid = height / 2

  // 选区高亮
  const sx = (start.value / duration.value) * width
  const ex = (end.value / duration.value) * width
  g.fillStyle = 'rgba(76, 194, 255, 0.12)'
  g.fillRect(sx, 0, Math.max(1, ex - sx), height)

  // 波形
  g.fillStyle = '#7cc4ff'
  for (let x = 0; x < width; x++) {
    let min = 1
    let max = -1
    const from = x * step
    const to = Math.min(data.length, from + step)
    for (let i = from; i < to; i++) {
      const v = data[i] ?? 0
      if (v < min) min = v
      if (v > max) max = v
    }
    const half = Math.max(0.5, ((max - min) / 2) * mid * 0.92)
    g.fillRect(x, mid - half, 1, half * 2)
  }

  // 选区边界
  g.fillStyle = 'rgba(255, 255, 255, 0.55)'
  g.fillRect(sx, 0, 1, height)
  g.fillRect(ex - 1, 0, 1, height)

  // 播放指针
  if (playing.value) {
    const cx = (cursor.value / duration.value) * width
    g.fillStyle = '#ffd166'
    g.fillRect(cx, 0, 2, height)
  }
}

function pickTime(clientX: number): number {
  const canvas = canvasEl.value
  if (!canvas) return 0
  const rect = canvas.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return ratio * duration.value
}

let dragging: 'start' | 'end' | null = null

/** 统一处理 pointer / mouse / touch 三类坐标 */
function clientXOf(event: PointerEvent | MouseEvent | TouchEvent): number {
  if ('touches' in event) return event.touches[0]?.clientX ?? event.changedTouches[0]?.clientX ?? 0
  return event.clientX
}

function beginDrag(clientX: number): void {
  if (!ready.value) return
  const t = pickTime(clientX)
  // 靠近哪个边界就拖哪个；否则以点击处为新区间起点
  const tolerance = duration.value * 0.02
  if (Math.abs(t - start.value) < tolerance) dragging = 'start'
  else if (Math.abs(t - end.value) < tolerance) dragging = 'end'
  else {
    dragging = 'start'
    start.value = t
    if (end.value < t) end.value = t
  }
  draw()
}

function moveDrag(clientX: number): void {
  if (!dragging) return
  const t = pickTime(clientX)
  if (dragging === 'start') start.value = Math.min(t, end.value)
  else end.value = Math.max(t, start.value)
  draw()
}

function endDrag(): void {
  dragging = null
  draw()
}

function onPointerDown(event: PointerEvent): void {
  beginDrag(clientXOf(event))
  ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  moveDrag(clientXOf(event))
}

function onMouseDown(event: MouseEvent): void {
  // 真实浏览器里 pointerdown 已经处理过，这里避免重复设置区间
  if (!dragging) beginDrag(clientXOf(event))
  const up = (): void => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', up)
    endDrag()
  }
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', up)
}

function onMouseMove(event: MouseEvent): void {
  moveDrag(clientXOf(event))
}

function onTouchStart(event: TouchEvent): void {
  beginDrag(clientXOf(event))
}

function onTouchMove(event: TouchEvent): void {
  moveDrag(clientXOf(event))
}

function stop(): void {
  if (source) {
    try {
      source.stop()
    } catch {
      /* 已停止 */
    }
    source.disconnect()
    source = null
  }
  playing.value = false
  cancelAnimationFrame(raf)
}

function playSelection(): void {
  if (!buffer || !ctx) return
  if (playing.value) {
    stop()
    draw()
    return
  }
  stop()
  source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  const from = start.value
  const length = Math.max(0.02, end.value - start.value)
  source.start(0, from, length)
  startedAt = ctx.currentTime
  playing.value = true
  cursor.value = from
  source.onended = () => {
    playing.value = false
    draw()
  }
  const tick = (): void => {
    if (!playing.value || !ctx) return
    cursor.value = Math.min(end.value, from + (ctx.currentTime - startedAt))
    draw()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

/** 把选中的片段编码成 16-bit PCM WAV */
function exportSelection(): void {
  if (!buffer) return
  busy.value = true
  try {
    const rate = buffer.sampleRate
    const from = Math.floor(start.value * rate)
    const to = Math.min(buffer.length, Math.floor(end.value * rate))
    const frames = Math.max(1, to - from)
    const channels = Math.min(2, buffer.numberOfChannels)
    const bytesPerSample = 2
    const blockAlign = channels * bytesPerSample
    const dataSize = frames * blockAlign
    const out = new ArrayBuffer(44 + dataSize)
    const view = new DataView(out)

    const writeText = (offset: number, text: string): void => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
    }
    writeText(0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    writeText(8, 'WAVE')
    writeText(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, channels, true)
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * blockAlign, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, 16, true)
    writeText(36, 'data')
    view.setUint32(40, dataSize, true)

    const channelData: Float32Array[] = []
    for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c))
    let offset = 44
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        const sample = Math.max(-1, Math.min(1, channelData[c]?.[from + i] ?? 0))
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
        offset += 2
      }
    }

    const blob = new Blob([out], { type: 'audio/wav' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const name = `${props.title || 'clip'}-${start.value.toFixed(1)}s-${end.value.toFixed(1)}s`
    anchor.href = url
    anchor.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.wav`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  } finally {
    busy.value = false
  }
}

function resetSelection(): void {
  start.value = 0
  end.value = duration.value
  draw()
}

function nudge(which: 'start' | 'end', delta: number): void {
  if (which === 'start') start.value = Math.min(Math.max(0, start.value + delta), end.value - 0.02)
  else end.value = Math.max(Math.min(duration.value, end.value + delta), start.value + 0.02)
  draw()
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${m}:${String(s).padStart(2, '0')}.${ms}`
}

defineExpose({ resetSelection })
</script>

<template>
  <div class="trimmer">
    <p v-if="loading" class="muted small">
      正在读取音频{{ progress > 0 ? ` ${progress}%` : '…' }}
    </p>
    <p v-else-if="error" class="notice">{{ error }}</p>

    <template v-else-if="ready">
      <canvas
        ref="canvasEl"
        class="wave"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @mousedown="onMouseDown"
        @touchstart.passive="onTouchStart"
        @touchmove.passive="onTouchMove"
        @touchend="endDrag"
      />

      <div class="times">
        <span>起点 {{ fmt(start) }}</span>
        <span class="sel">选中 {{ fmt(selection) }}</span>
        <span>终点 {{ fmt(end) }}</span>
      </div>

      <div class="row">
        <button type="button" class="btn" @click="playSelection">
          {{ playing ? '停止试听' : '试听选中' }}
        </button>
        <button type="button" class="btn" @click="nudge('start', -0.1)">起点 -0.1s</button>
        <button type="button" class="btn" @click="nudge('start', 0.1)">起点 +0.1s</button>
        <button type="button" class="btn" @click="nudge('end', -0.1)">终点 -0.1s</button>
        <button type="button" class="btn" @click="nudge('end', 0.1)">终点 +0.1s</button>
        <button type="button" class="btn" @click="resetSelection">全选</button>
        <button type="button" class="btn primary" :disabled="busy || selection < 0.1" @click="exportSelection">
          {{ busy ? '导出中…' : '导出剪切片段 WAV' }}
        </button>
      </div>
      <p class="muted small">在波形上拖动可调整起点/终点；导出为无损 WAV。</p>
    </template>
  </div>
</template>

<style scoped>
.trimmer {
  margin-top: 14px;
}
.wave {
  width: 100%;
  height: 140px;
  border: 1px solid #2b3642;
  border-radius: 10px;
  background: #0d1319;
  cursor: crosshair;
  touch-action: none;
}
.times {
  display: flex;
  justify-content: space-between;
  margin: 6px 0 10px;
  font-size: 0.78rem;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}
.times .sel {
  color: #7cc4ff;
  opacity: 1;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.btn.primary {
  background: #4cc2ff;
  border-color: transparent;
  color: #06222e;
  font-weight: 600;
}
.btn.primary:disabled {
  opacity: 0.5;
}
</style>
