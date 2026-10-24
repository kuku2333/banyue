<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { compileExpr, derivativeOf, nearestPoint } from '@/lib/expr'
import type { MathPage } from '@/lib/db'

/**
 * 平面坐标系画布：
 *  - 网格 + 坐标轴 + 刻度
 *  - 滚轮缩放、拖拽平移
 *  - 函数曲线（输入表达式）
 *  - 几何元素：自由线、点、切线、法线、垂线
 *  - 自由画线模式（用笔在坐标系里画线）
 */

interface GraphFunction {
  expr: string
  color: string
  visible: boolean
}

interface Geometry {
  id: string
  type: 'line' | 'tangent' | 'normal' | 'perpendicular' | 'point'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  expr?: string
  refId?: string
}

const props = defineProps<{
  functions: GraphFunction[]
  geometry: Geometry[]
  view: MathPage['view']
  tool: 'pan' | 'draw' | 'point' | 'tangent' | 'normal' | 'perpendicular'
  drawingColor: string
  /** 选中某个几何元素（供删除/高亮） */
  selectedId?: string
}>()

const emit = defineEmits<{
  'update:view': [view: MathPage['view']]
  'add-geometry': [geometry: Omit<Geometry, 'id'>]
  'update-geometry': [geometry: Geometry]
  'select': [id: string | undefined]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)

/* 视口状态（world 坐标：中心点 cx,cy + 每像素多少世界单位 scale=像素数/世界单位） */
const view = ref<MathPage['view']>({ ...props.view })

/* 拖拽平移 */
let dragging = false
let dragStart = { px: 0, py: 0, cx: 0, cy: 0 }

/* 自由画线 / 几何元素拖拽状态 */
let drawStart: { x: number; y: number } | null = null
let currentDrawEnd: { x: number; y: number } | null = null
let hoverWorld: { x: number; y: number } | null = null

/* 画布尺寸 */
const cssW = ref(0)
const cssH = ref(0)
const dpr = ref(1)

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

/* 世界坐标 ↔ 屏幕像素 */
function worldToScreen(wx: number, wy: number): { x: number; y: number } {
  const cx = view.value.cx
  const cy = view.value.cy
  const s = view.value.scale
  return {
    x: (wx - cx) * s + cssW.value / 2,
    y: (cy - wy) * s + cssH.value / 2,
  }
}

function screenToWorld(px: number, py: number): { x: number; y: number } {
  const cx = view.value.cx
  const cy = view.value.cy
  const s = view.value.scale
  return {
    x: (px - cssW.value / 2) / s + cx,
    y: (cssH.value / 2 - py) / s + cy,
  }
}

/* 视口变化时通知父组件 + 重绘 */
function emitView(): void {
  emit('update:view', { ...view.value })
  draw()
}

/* ---------------- 绘制 ---------------- */

function draw(): void {
  const el = canvasRef.value
  if (!el) return
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr.value, 0, 0, dpr.value, 0, 0)
  ctx.clearRect(0, 0, cssW.value, cssH.value)

  drawGrid(ctx)
  drawAxes(ctx)
  for (const g of props.geometry) drawGeometry(ctx, g)
  for (const f of props.functions) drawFunction(ctx, f)
  if (drawStart && props.tool === 'draw' && currentDrawEnd) {
    drawTempLine(ctx, drawStart, currentDrawEnd)
  }
  if (drawStart && props.tool === 'perpendicular') {
    // 预览垂线：从外点向最近线作垂足
    const nearest = findNearestLine(drawStart.x, drawStart.y)
    if (nearest) {
      const foot = perpendicularFoot(nearest, drawStart.x, drawStart.y)
      drawTempLine(ctx, drawStart, foot)
    }
  }
  if (drawStart && props.tool !== 'draw' && props.tool !== 'perpendicular' && hoverWorld) {
    drawTempGeometry(ctx, drawStart, hoverWorld)
  }
}

function drawGrid(ctx: CanvasRenderingContext2D): void {
  const s = view.value.scale
  // 选择合适的网格步长（1/2/5 序列）
  const target = 60 // 像素间隔
  const raw = target / s
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  let step = mag
  if (norm < 1.5) step = mag
  else if (norm < 3.5) step = 2 * mag
  else if (norm < 7.5) step = 5 * mag
  else step = 10 * mag

  const left = screenToWorld(0, 0).x
  const right = screenToWorld(cssW.value, 0).x
  const bottom = screenToWorld(0, cssH.value).y
  const top = screenToWorld(0, 0).y

  ctx.lineWidth = 1
  // 主网格
  ctx.strokeStyle = 'rgba(255,255,255,0.045)'
  ctx.beginPath()
  for (let x = Math.floor(left / step) * step; x <= right; x += step) {
    const p = worldToScreen(x, 0)
    ctx.moveTo(p.x, 0)
    ctx.lineTo(p.x, cssH.value)
  }
  for (let y = Math.floor(bottom / step) * step; y <= top; y += step) {
    const p = worldToScreen(0, y)
    ctx.moveTo(0, p.y)
    ctx.lineTo(cssW.value, p.y)
  }
  ctx.stroke()
}

function drawAxes(ctx: CanvasRenderingContext2D): void {
  const s = view.value.scale
  const target = 60
  const raw = target / s
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  let step = mag
  if (norm < 1.5) step = mag
  else if (norm < 3.5) step = 2 * mag
  else if (norm < 7.5) step = 5 * mag
  else step = 10 * mag

  const origin = worldToScreen(0, 0)
  // x 轴
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(0, origin.y)
  ctx.lineTo(cssW.value, origin.y)
  ctx.stroke()
  // y 轴
  ctx.beginPath()
  ctx.moveTo(origin.x, 0)
  ctx.lineTo(origin.x, cssH.value)
  ctx.stroke()

  // 刻度
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.font = '10px ui-monospace, monospace'
  ctx.textAlign = 'center'
  const left = screenToWorld(0, 0).x
  const right = screenToWorld(cssW.value, 0).x
  const bottom = screenToWorld(0, cssH.value).y
  const top = screenToWorld(0, 0).y

  // x 轴刻度
  for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
    if (Math.abs(x) < step / 100) continue
    const p = worldToScreen(x, 0)
    ctx.fillText(fmtTick(x), p.x, origin.y + 14)
  }
  // y 轴刻度
  ctx.textAlign = 'right'
  for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
    if (Math.abs(y) < step / 100) continue
    const p = worldToScreen(0, y)
    ctx.fillText(fmtTick(y), origin.x - 6, p.y + 3)
  }
  ctx.textAlign = 'left'
  // 原点
  ctx.fillText('0', origin.x + 6, origin.y + 14)
  // 轴标签
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.textAlign = 'left'
  ctx.fillText('x', cssW.value - 14, origin.y - 6)
  ctx.fillText('y', origin.x + 8, 14)
}

function fmtTick(v: number): string {
  if (Number.isInteger(v)) return String(v)
  return String(Math.round(v * 100) / 100)
}

function drawFunction(ctx: CanvasRenderingContext2D, f: GraphFunction): void {
  if (!f.visible) return
  const compiled = compileExpr(f.expr)
  if (compiled.error) return
  const fn = compiled.fn
  const left = screenToWorld(0, 0).x
  const right = screenToWorld(cssW.value, 0).x
  const step = (right - left) / cssW.value

  ctx.strokeStyle = f.color
  ctx.lineWidth = 2
  ctx.beginPath()
  let penDown = false
  for (let px = 0; px <= cssW.value; px++) {
    const x = left + px * step
    const y = fn(x)
    if (!Number.isFinite(y)) {
      penDown = false
      continue
    }
    const p = worldToScreen(x, y)
    // 跳出可视区太大就断线，避免渐近线画到天边
    if (p.y < -2000 || p.y > cssH.value + 2000) {
      penDown = false
      continue
    }
    if (!penDown) {
      ctx.moveTo(p.x, p.y)
      penDown = true
    } else {
      ctx.lineTo(p.x, p.y)
    }
  }
  ctx.stroke()
}

function drawGeometry(ctx: CanvasRenderingContext2D, g: Geometry): void {
  const p1 = worldToScreen(g.x1, g.y1)
  const p2 = worldToScreen(g.x2, g.y2)
  const selected = g.id === props.selectedId
  ctx.strokeStyle = selected ? '#ffd166' : g.color
  ctx.lineWidth = selected ? 2.4 : 1.8

  if (g.type === 'point') {
    ctx.fillStyle = selected ? '#ffd166' : g.color
    ctx.beginPath()
    ctx.arc(p1.x, p1.y, 4, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(p2.x, p2.y)
  ctx.stroke()

  // 端点小方块
  ctx.fillStyle = selected ? '#ffd166' : g.color
  for (const p of [p1, p2]) {
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6)
  }
}

function drawTempLine(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const p1 = worldToScreen(a.x, a.y)
  const p2 = worldToScreen(b.x, b.y)
  ctx.strokeStyle = props.drawingColor
  ctx.lineWidth = 1.8
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(p2.x, p2.y)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawTempGeometry(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }): void {
  // 根据当前工具预览即将画出的几何元素
  if (props.tool === 'point') {
    const p = worldToScreen(a.x, a.y)
    ctx.fillStyle = props.drawingColor
    ctx.beginPath()
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  // 线类：直接连线
  const p1 = worldToScreen(a.x, a.y)
  const p2 = worldToScreen(b.x, b.y)
  ctx.strokeStyle = props.drawingColor
  ctx.lineWidth = 1.8
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(p2.x, p2.y)
  ctx.stroke()
  ctx.setLineDash([])
}

/* ---------------- 交互 ---------------- */

function onPointerDown(event: PointerEvent): void {
  const el = canvasRef.value
  if (!el) return
  el.setPointerCapture(event.pointerId)
  const pos = pointerPos(event)
  const world = screenToWorld(pos.x, pos.y)

  if (props.tool === 'pan') {
    dragging = true
    dragStart = { px: pos.x, py: pos.y, cx: view.value.cx, cy: view.value.cy }
    return
  }

  // 绘图模式
  if (props.tool === 'draw') {
    drawStart = { x: world.x, y: world.y }
    currentDrawEnd = { x: world.x, y: world.y }
    return
  }
  if (props.tool === 'point') {
    emit('add-geometry', {
      type: 'point',
      x1: world.x,
      y1: world.y,
      x2: world.x,
      y2: world.y,
      color: props.drawingColor,
    })
    return
  }
  if (props.tool === 'tangent') {
    const result = computeTangentAt(world)
    if (result) {
      emit('add-geometry', { type: 'tangent', ...result, color: props.drawingColor })
    }
    return
  }
  if (props.tool === 'normal') {
    const result = computeNormalAt(world)
    if (result) {
      emit('add-geometry', { type: 'normal', ...result, color: props.drawingColor })
    }
    return
  }
  if (props.tool === 'perpendicular') {
    // 垂线：先选一条已有线，再点位置
    drawStart = { x: world.x, y: world.y }
    return
  }
}

function onPointerMove(event: PointerEvent): void {
  const pos = pointerPos(event)
  const world = screenToWorld(pos.x, pos.y)
  hoverWorld = { x: world.x, y: world.y }

  if (dragging) {
    const dx = pos.x - dragStart.px
    const dy = pos.y - dragStart.py
    view.value.cx = dragStart.cx - dx / view.value.scale
    view.value.cy = dragStart.cy + dy / view.value.scale
    emitView()
    return
  }
  if (drawStart && props.tool === 'draw') {
    currentDrawEnd = { x: world.x, y: world.y }
    draw()
    return
  }
  if (drawStart && props.tool === 'perpendicular') {
    draw()
  }
  draw()
}

function onPointerUp(event: PointerEvent): void {
  const el = canvasRef.value
  if (el) el.releasePointerCapture(event.pointerId)

  if (dragging) {
    dragging = false
    emitView()
    return
  }
  if (drawStart && props.tool === 'draw') {
    // 完成一条自由线
    if (Math.abs(drawStart.x - (currentDrawEnd?.x ?? drawStart.x)) > 0.001 || Math.abs(drawStart.y - (currentDrawEnd?.y ?? drawStart.y)) > 0.001) {
      emit('add-geometry', {
        type: 'line',
        x1: drawStart.x,
        y1: drawStart.y,
        x2: currentDrawEnd?.x ?? drawStart.x,
        y2: currentDrawEnd?.y ?? drawStart.y,
        color: props.drawingColor,
      })
    }
    drawStart = null
    currentDrawEnd = null
    draw()
    return
  }
  if (drawStart && props.tool === 'perpendicular') {
    // 从点击的线外一点，向最近的线作垂线
    const nearest = findNearestLine(drawStart.x, drawStart.y)
    if (nearest) {
      const foot = perpendicularFoot(nearest, drawStart.x, drawStart.y)
      emit('add-geometry', {
        type: 'perpendicular',
        x1: drawStart.x,
        y1: drawStart.y,
        x2: foot.x,
        y2: foot.y,
        color: props.drawingColor,
        refId: nearest.id,
      })
    }
    drawStart = null
    draw()
    return
  }
}

function pointerPos(event: PointerEvent): { x: number; y: number } {
  const el = canvasRef.value!
  const rect = el.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function onWheel(event: WheelEvent): void {
  event.preventDefault()
  const el = canvasRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const px = event.clientX - rect.left
  const py = event.clientY - rect.top
  const before = screenToWorld(px, py)
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
  view.value.scale = Math.min(2000, Math.max(0.5, view.value.scale * factor))
  const after = screenToWorld(px, py)
  view.value.cx += before.x - after.x
  view.value.cy += before.y - after.y
  emitView()
}

/* 切线：在鼠标位置附近找最近函数上的点，算斜率画切线 */
function computeTangentAt(world: { x: number; y: number }): { x1: number; y1: number; x2: number; y2: number; expr: string } | null {
  let best: { expr: string; x: number; y: number; slope: number; d: number } | null = null
  for (const f of props.functions) {
    if (!f.visible) continue
    const compiled = compileExpr(f.expr)
    if (compiled.error) continue
    // 左右两个方向都搜，取更近的
    for (const dir of [1, -1] as const) {
      const np = nearestPoint(compiled.fn, world.x, world.y, world.x, dir)
      if (!np) continue
      const d = (np.x - world.x) ** 2 + (np.y - world.y) ** 2
      const slope = derivativeOf(compiled.fn, np.x)
      if (!Number.isFinite(slope)) continue
      if (!best || d < best.d) best = { expr: f.expr, x: np.x, y: np.y, slope, d }
    }
  }
  if (!best) return null
  // 切线延伸 2 个世界单位
  const len = 2
  const dx = len / Math.sqrt(1 + best.slope ** 2)
  const dy = best.slope * dx
  return {
    x1: best.x - dx,
    y1: best.y - dy,
    x2: best.x + dx,
    y2: best.y + dy,
    expr: best.expr,
  }
}

/* 法线：斜率为 -1/slope */
function computeNormalAt(world: { x: number; y: number }): { x1: number; y1: number; x2: number; y2: number; expr: string } | null {
  const tan = computeTangentAt(world)
  if (!tan) return null
  // 从切点算斜率
  const slope = (tan.y2 - tan.y1) / (tan.x2 - tan.x1)
  const normalSlope = -1 / slope
  const len = 2
  const dx = len / Math.sqrt(1 + normalSlope ** 2)
  const dy = normalSlope * dx
  const midX = (tan.x1 + tan.x2) / 2
  const midY = (tan.y1 + tan.y2) / 2
  return {
    x1: midX - dx,
    y1: midY - dy,
    x2: midX + dx,
    y2: midY + dy,
    expr: tan.expr,
  }
}

function findNearestLine(wx: number, wy: number): Geometry | null {
  let best: Geometry | null = null
  let bestDist = Infinity
  for (const g of props.geometry) {
    if (g.type === 'point') continue
    const d = pointToSegment(wx, wy, g.x1, g.y1, g.x2, g.y2)
    if (d < bestDist) {
      bestDist = d
      best = g
    }
  }
  // 只接受 1.5 世界单位内的线
  return bestDist < 1.5 ? best : null
}

function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function perpendicularFoot(line: Geometry, px: number, py: number): { x: number; y: number } {
  const dx = line.x2 - line.x1
  const dy = line.y2 - line.y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: line.x1, y: line.y1 }
  const t = ((px - line.x1) * dx + (py - line.y1) * dy) / len2
  return { x: line.x1 + t * dx, y: line.y1 + t * dy }
}

/* 点击空白取消选中 */
function onClickCanvas(event: MouseEvent): void {
  if (props.tool !== 'pan') return
  // 检测是否点中几何元素
  const el = canvasRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top)
  const hit = findNearestLine(world.x, world.y)
  emit('select', hit?.id)
}

onMounted(() => {
  resize()
  window.addEventListener('resize', resize)
  watch(
    () => props.view,
    (v) => {
      view.value = { ...v }
      draw()
    },
    { deep: true },
  )
  watch(
    () => [props.functions, props.geometry, props.tool, props.selectedId, props.drawingColor],
    () => draw(),
    { deep: true },
  )
})
</script>

<template>
  <div ref="wrapRef" class="graph-wrap" @wheel="onWheel">
    <canvas
      ref="canvasRef"
      class="graph-canvas"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @click="onClickCanvas"
    />
    <div class="graph-hint">
      {{ tool === 'pan' ? '拖拽平移 · 滚轮缩放' : tool === 'draw' ? '按住拖动自由画线' : tool === 'tangent' ? '点击曲线上的点画切线' : tool === 'normal' ? '点击曲线上的点画法线' : tool === 'perpendicular' ? '先点目标位置，再对最近的线作垂线' : '点击放置点' }}
    </div>
  </div>
</template>

<style scoped>
.graph-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  background: #0b1017;
  border-radius: 12px;
  overflow: hidden;
  touch-action: none;
  cursor: crosshair;
}
.graph-canvas {
  display: block;
}
.graph-hint {
  position: absolute;
  left: 10px;
  bottom: 10px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(10, 14, 19, 0.75);
  color: var(--dim);
  font-size: 0.72rem;
  pointer-events: none;
}
</style>
