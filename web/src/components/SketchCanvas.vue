<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

/**
 * 草稿画布：像草稿纸一样。
 *  - 鼠标手写（钢笔）✓
 *  - 键盘输入文本（点击画布定位，打字输入）✓
 *  - 橡皮擦 ✓
 *  - 撤销 / 重做 ✓
 *  - 清空 ✓
 *  - 数据序列化为 JSON 字符串持久化 ✓
 */

interface Stroke {
  points: { x: number; y: number }[]
  color: string
  width: number
}

interface TextItem {
  x: number
  y: number
  text: string
  color: string
  size: number
}

type Tool = 'pen' | 'eraser' | 'text'

const props = defineProps<{
  tool: Tool
  color: string
  width: number
  serialized: string
}>()

const emit = defineEmits<{ 'update:serialized': [value: string] }>()

let lastEmitted = ''

const canvasRef = ref<HTMLCanvasElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)

const strokes = ref<Stroke[]>([])
const texts = ref<TextItem[]>([])

const cssW = ref(0)
const cssH = ref(0)
const dpr = ref(1)

/* 文本输入状态 */
const typing = ref(false)
const typingText = ref('')
const typingX = ref(0)
const typingY = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

/* 撤销重做栈 */
interface Snapshot {
  strokes: Stroke[]
  texts: TextItem[]
}
const undoStack = ref<Snapshot[]>([])
const redoStack = ref<Snapshot[]>([])

let drawing = false
let currentStroke: Stroke | null = null

function resize(): void {
  const el = canvasRef.value
  const wrap = wrapRef.value
  if (!el || !wrap) return
  const rect = wrap.getBoundingClientRect()
  cssW.value = Math.max(1, Math.round(rect.width))
  cssH.value = Math.max(1, Math.round(rect.height))
  dpr.value = window.devicePixelRatio || 1
  el.width = cssW.value * dpr.value
  el.height = cssH.value * dpr.value
  el.style.width = `${cssW.value}px`
  el.style.height = `${cssH.value}px`
  draw()
}

function draw(): void {
  const el = canvasRef.value
  if (!el) return
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr.value, 0, 0, dpr.value, 0, 0)
  ctx.clearRect(0, 0, cssW.value, cssH.value)

  // 草稿纸底色（淡格）
  ctx.fillStyle = '#12171f'
  ctx.fillRect(0, 0, cssW.value, cssH.value)
  drawPaperGrid(ctx)

  // 手写笔迹
  for (const stroke of strokes.value) {
    if (stroke.points.length < 2) {
      if (stroke.points.length === 1) {
        const p = stroke.points[0]!
        ctx.fillStyle = stroke.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, stroke.width / 2, 0, Math.PI * 2)
        ctx.fill()
      }
      continue
    }
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y)
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i]!.x, stroke.points[i]!.y)
    }
    ctx.stroke()
  }

  // 文本
  for (const t of texts.value) {
    ctx.fillStyle = t.color
    ctx.font = `${t.size}px var(--sans)`
    ctx.textBaseline = 'top'
    // 支持多行
    const lines = t.text.split('\n')
    lines.forEach((line, i) => {
      ctx.fillText(line, t.x, t.y + i * t.size * 1.4)
    })
  }
}

function drawPaperGrid(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = 'rgba(255,255,255,0.03)'
  ctx.lineWidth = 1
  const step = 24
  ctx.beginPath()
  for (let x = 0; x <= cssW.value; x += step) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, cssH.value)
  }
  for (let y = 0; y <= cssH.value; y += step) {
    ctx.moveTo(0, y)
    ctx.lineTo(cssW.value, y)
  }
  ctx.stroke()
}

/* ---------------- 序列化 ---------------- */

function snapshot(): Snapshot {
  return { strokes: JSON.parse(JSON.stringify(strokes.value)), texts: JSON.parse(JSON.stringify(texts.value)) }
}

function restore(snap: Snapshot): void {
  strokes.value = snap.strokes
  texts.value = snap.texts
  draw()
}

function pushUndo(): void {
  undoStack.value.push(snapshot())
  if (undoStack.value.length > 60) undoStack.value.shift()
  redoStack.value = []
}

function serialize(): string {
  return JSON.stringify({ strokes: strokes.value, texts: texts.value })
}

function loadSerialized(raw: string): void {
  if (!raw) {
    strokes.value = []
    texts.value = []
    draw()
    return
  }
  try {
    const data = JSON.parse(raw) as { strokes?: Stroke[]; texts?: TextItem[] }
    strokes.value = data.strokes ?? []
    texts.value = data.texts ?? []
  } catch {
    strokes.value = []
    texts.value = []
  }
  draw()
}

watch(
  () => props.serialized,
  (v) => {
    // 外部换页时加载；当前正在编辑时不回刷
    if (v !== lastEmitted) loadSerialized(v)
  },
)

function emitData(): void {
  lastEmitted = serialize()
  emit('update:serialized', lastEmitted)
}

/* ---------------- 交互 ---------------- */

function pointerPos(event: PointerEvent): { x: number; y: number } {
  const el = canvasRef.value!
  const rect = el.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function onPointerDown(event: PointerEvent): void {
  if (props.tool === 'text') {
    // 点击放置文本框
    const pos = pointerPos(event)
    startTextInput(pos.x, pos.y)
    return
  }
  const el = canvasRef.value
  if (!el) return
  el.setPointerCapture(event.pointerId)
  drawing = true
  const pos = pointerPos(event)
  const color = props.tool === 'eraser' ? '#12171f' : props.color
  const width = props.tool === 'eraser' ? props.width * 6 : props.width
  currentStroke = { points: [pos], color, width }
  pushUndo()
}

function onPointerMove(event: PointerEvent): void {
  if (!drawing || !currentStroke) return
  const pos = pointerPos(event)
  // 平滑：太近的点不重复加
  const last = currentStroke.points[currentStroke.points.length - 1]
  if (last && Math.hypot(pos.x - last.x, pos.y - last.y) < 1.5) return
  currentStroke.points.push(pos)
  draw()
}

function onPointerUp(event: PointerEvent): void {
  if (!drawing) return
  const el = canvasRef.value
  if (el) el.releasePointerCapture(event.pointerId)
  drawing = false
  if (currentStroke) {
    strokes.value.push(currentStroke)
    currentStroke = null
    emitData()
    draw()
  }
}

/* ---------------- 文本输入 ---------------- */

function startTextInput(x: number, y: number): void {
  typing.value = true
  typingText.value = ''
  typingX.value = x
  typingY.value = y
  // 下一帧聚焦输入框
  requestAnimationFrame(() => inputRef.value?.focus())
}

function commitText(): void {
  if (!typing.value) return
  typing.value = false
  const text = typingText.value
  if (!text.trim()) return
  pushUndo()
  texts.value.push({ x: typingX.value, y: typingY.value, text, color: props.color, size: 14 })
  typingText.value = ''
  emitData()
  draw()
}

/* ---------------- 撤销 / 重做 / 清空 ---------------- */

function undo(): void {
  const snap = undoStack.value.pop()
  if (!snap) return
  redoStack.value.push(snapshot())
  restore(snap)
  emitData()
}

function redo(): void {
  const snap = redoStack.value.pop()
  if (!snap) return
  undoStack.value.push(snapshot())
  restore(snap)
  emitData()
}

function clear(): void {
  pushUndo()
  strokes.value = []
  texts.value = []
  emitData()
  draw()
}

defineExpose({ undo, redo, clear })

onMounted(() => {
  resize()
  window.addEventListener('resize', resize)
})
</script>

<template>
  <div ref="wrapRef" class="sketch-wrap">
    <canvas
      ref="canvasRef"
      class="sketch-canvas"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />
    <input
      v-if="typing"
      ref="inputRef"
      v-model="typingText"
      class="text-input"
      :style="{ left: `${typingX}px`, top: `${typingY}px`, color: color }"
      placeholder="输入文字，回车确认"
      @blur="commitText"
      @keydown.enter.prevent="commitText"
      @keydown.escape="typing = false; typingText = ''"
    />
  </div>
</template>

<style scoped>
.sketch-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 260px;
  border-radius: 12px;
  overflow: hidden;
  touch-action: none;
}
.sketch-canvas {
  display: block;
  cursor: crosshair;
}
.text-input {
  position: absolute;
  min-width: 120px;
  padding: 2px 6px;
  border: 1px solid var(--accent-line);
  border-radius: 6px;
  background: rgba(10, 14, 19, 0.9);
  outline: none;
  font-size: 14px;
  font-family: var(--sans);
  z-index: 5;
}
</style>
