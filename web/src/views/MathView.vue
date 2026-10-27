<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import GraphCanvas from '@/components/GraphCanvas.vue'
import SketchCanvas from '@/components/SketchCanvas.vue'
import {
  deleteMathNotebook,
  deleteMathPage,
  emptyMathNotebook,
  emptyMathPage,
  getMathNotebook,
  listMathNotebooks,
  listMathPages,
  newId,
  putMathNotebook,
  putMathPage,
  type MathNotebook,
  type MathPage,
} from '@/lib/db'
import { compileExpr, definiteIntegral, derivativeOf, evaluate } from '@/lib/expr'
import { differentiate } from '@/lib/symbolic'

/** 数学工具：平面坐标系 + 草稿纸，可自由写画、作图、分页、保存。 */

/* ---------------- 状态 ---------------- */

const notebooks = ref<MathNotebook[]>([])
const currentNotebookId = ref('')
const pages = ref<MathPage[]>([])
const currentPageIndex = ref(0)

const loading = ref(false)
const message = ref('')
const error = ref('')

/* 草稿工具 */
type SketchTool = 'pen' | 'eraser' | 'text'
const sketchTool = ref<SketchTool>('pen')
const sketchColor = ref('#e9eff6')
const sketchWidth = ref(2.5)

/* 坐标工具 */
type GraphTool = 'pan' | 'draw' | 'point' | 'tangent' | 'normal' | 'perpendicular'
const graphTool = ref<GraphTool>('pan')
const graphColor = ref('#5eead4')

/* 函数输入 */
const exprInput = ref('')
const exprColor = ref('#5eead4')
const exprInputEl = ref<HTMLInputElement | null>(null)

/** 快捷插入：在光标处插入函数片段（sin( 等留括号方便续写） */
const FUNC_TOKENS: { label: string; insert: string; caret?: number }[] = [
  { label: 'sin', insert: 'sin()', caret: 4 },
  { label: 'cos', insert: 'cos()', caret: 4 },
  { label: 'tan', insert: 'tan()', caret: 4 },
  { label: 'exp', insert: 'exp()', caret: 4 },
  { label: 'ln', insert: 'ln()', caret: 3 },
  { label: '√', insert: 'sqrt()', caret: 5 },
  { label: '|x|', insert: 'abs()', caret: 4 },
  { label: 'x²', insert: '^2' },
  { label: 'xⁿ', insert: '^' },
  { label: 'π', insert: 'pi' },
  { label: '( )', insert: '()', caret: 1 },
  { label: '÷', insert: '/' },
]

function insertToken(token: { insert: string; caret?: number }): void {
  const el = exprInputEl.value
  const text = exprInput.value
  const start = el?.selectionStart ?? text.length
  const end = el?.selectionEnd ?? text.length
  const next = text.slice(0, start) + token.insert + text.slice(end)
  exprInput.value = next
  const pos = start + (token.caret ?? token.insert.length)
  // 等 DOM 更新后把光标放到插入内容里/后
  requestAnimationFrame(() => {
    if (!el) return
    el.focus()
    el.setSelectionRange(pos, pos)
  })
}

/** 常用公式模板：点一下直接填进输入框（覆盖式） */
const TEMPLATES: { label: string; expr: string }[] = [
  { label: '二次函数', expr: 'a*x^2 + b*x + c' },
  { label: '正弦波', expr: 'A*sin(w*x + phi)' },
  { label: '指数衰减', expr: 'A*exp(-k*x)' },
  { label: '圆（上半）', expr: 'sqrt(r^2 - x^2)' },
  { label: '有理式', expr: '1/(1 + x^2)' },
  { label: '对数曲线', expr: 'log(x, 2)' },
]

function applyTemplate(expr: string): void {
  exprInput.value = expr
  requestAnimationFrame(() => exprInputEl.value?.focus())
}

/* ---------- 代入求值 + 定积分 ---------- */
const evalX = ref('1')
const evalRows = computed(() => {
  const x = Number(evalX.value)
  if (!Number.isFinite(x)) return []
  return (currentPage.value?.functions ?? []).map((f) => {
    const compiled = compileExpr(f.expr)
    if (compiled.error || !compiled.fn) return { expr: f.expr, fx: NaN, dfx: NaN, error: compiled.error }
    const fx = evaluate(f.expr, { x })
    const dfx = derivativeOf(compiled.fn, x)
    return { expr: f.expr, fx, dfx, error: undefined }
  })
})

const integA = ref('0')
const integB = ref('1')
const integralRows = computed(() => {
  const a = Number(integA.value)
  const b = Number(integB.value)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return []
  return (currentPage.value?.functions ?? []).map((f) => {
    const compiled = compileExpr(f.expr)
    if (compiled.error || !compiled.fn) return { expr: f.expr, value: NaN, error: compiled.error }
    return { expr: f.expr, value: definiteIntegral(compiled.fn, a, b), error: undefined }
  })
})

/** 数值漂亮显示：整数/常规保留 4 位，过小用指数，NaN 显示 — */
function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  if (Math.abs(n) >= 1e-4 && Math.abs(n) < 1e7) return String(Number(n.toFixed(4)))
  return n.toExponential(3)
}

/* 几何选中 */
const selectedGeoId = ref<string | undefined>(undefined)

const sketchRef = ref<InstanceType<typeof SketchCanvas> | null>(null)
const notebookNameInput = ref('')

const currentPage = computed<MathPage | null>(() => pages.value[currentPageIndex.value] ?? null)

const PALETTE = ['#5eead4', '#7dd3fc', '#fbbf24', '#fb7185', '#a78bfa', '#34d399', '#f472b6', '#e9eff6']

/* ---------------- 初始化 ---------------- */

onMounted(async () => {
  await loadNotebooks()
  if (notebooks.value.length) {
    await openNotebook(notebooks.value[0]!.id)
  } else {
    await createNotebook()
  }
})

async function loadNotebooks(): Promise<void> {
  notebooks.value = await listMathNotebooks()
}

async function createNotebook(): Promise<void> {
  const nb = emptyMathNotebook('草稿本')
  await putMathNotebook(nb)
  const page = emptyMathPage(nb.id, 0)
  await putMathPage(page)
  await loadNotebooks()
  await openNotebook(nb.id)
  message.value = '已新建草稿本'
  setTimeout(() => (message.value = ''), 2500)
}

async function openNotebook(id: string): Promise<void> {
  const nb = await getMathNotebook(id)
  if (!nb) return
  currentNotebookId.value = id
  notebookNameInput.value = nb.name
  await loadPages(id)
}

async function loadPages(notebookId: string): Promise<void> {
  loading.value = true
  try {
    pages.value = await listMathPages(notebookId)
    const nb = await getMathNotebook(notebookId)
    if (nb) currentPageIndex.value = Math.min(Math.max(0, nb.currentPage), Math.max(0, pages.value.length - 1))
  } finally {
    loading.value = false
  }
}

/* ---------------- 分页 ---------------- */

async function addPage(): Promise<void> {
  if (!currentNotebookId.value) return
  const page = emptyMathPage(currentNotebookId.value, pages.value.length)
  await putMathPage(page)
  await loadPages(currentNotebookId.value)
  currentPageIndex.value = pages.value.length - 1
  await saveCurrentPageIndex()
}

async function removePage(): Promise<void> {
  const page = currentPage.value
  if (!page) return
  if (pages.value.length <= 1) {
    message.value = '至少保留一页'
    setTimeout(() => (message.value = ''), 2000)
    return
  }
  if (!window.confirm('删除这一页？')) return
  await deleteMathPage(page.id)
  await loadPages(currentNotebookId.value)
  if (currentPageIndex.value >= pages.value.length) currentPageIndex.value = pages.value.length - 1
  await saveCurrentPageIndex()
}

async function goPage(index: number): Promise<void> {
  if (index < 0 || index >= pages.value.length) return
  currentPageIndex.value = index
  await saveCurrentPageIndex()
}

async function saveCurrentPageIndex(): Promise<void> {
  const nb = await getMathNotebook(currentNotebookId.value)
  if (!nb) return
  nb.currentPage = currentPageIndex.value
  nb.updatedAt = Date.now()
  await putMathNotebook(nb)
}

/* ---------------- 保存 ---------------- */

async function savePage(): Promise<void> {
  const page = currentPage.value
  if (!page) return
  page.updatedAt = Date.now()
  await putMathPage(page)
  const nb = await getMathNotebook(currentNotebookId.value)
  if (nb) {
    nb.updatedAt = Date.now()
    await putMathNotebook(nb)
  }
  message.value = '已保存'
  setTimeout(() => (message.value = ''), 1800)
}

/* 草稿内容实时更新 */
function onSketchUpdate(serialized: string): void {
  const page = currentPage.value
  if (!page) return
  page.sketch = serialized
}

function onGraphViewUpdate(view: MathPage['view']): void {
  const page = currentPage.value
  if (!page) return
  page.view = view
}

function onAddGeometry(geo: Omit<MathPage['geometry'][number], 'id'>): void {
  const page = currentPage.value
  if (!page) return
  page.geometry.push({ ...geo, id: newId('g') })
}

function onSelectGeometry(id: string | undefined): void {
  selectedGeoId.value = id
}

/* ---------------- 函数管理 ---------------- */

function addFunction(): void {
  const page = currentPage.value
  if (!page) return
  const expr = exprInput.value.trim()
  if (!expr) return
  const compiled = compileExpr(expr)
  if (compiled.error) {
    error.value = compiled.error
    setTimeout(() => (error.value = ''), 3000)
    return
  }
  page.functions.push({ expr, color: exprColor.value, visible: true })
  exprInput.value = ''
}

function removeFunction(index: number): void {
  const page = currentPage.value
  if (!page) return
  page.functions.splice(index, 1)
  if (showDerivative.value === index) showDerivative.value = -1
}

function toggleFunction(index: number): void {
  const page = currentPage.value
  if (!page) return
  page.functions[index]!.visible = !page.functions[index]!.visible
}

/* ---------- 符号求导展示 ---------- */

/** 当前展开导数的函数下标，-1 表示没展开 */
const showDerivative = ref(-1)

const derivativeResult = computed(() => {
  const index = showDerivative.value
  const fn = index >= 0 ? currentPage.value?.functions[index] : undefined
  if (!fn) return null
  return { expr: fn.expr, ...differentiate(fn.expr) }
})

const derivativeText = computed(() => {
  const result = derivativeResult.value
  if (!result) return ''
  return result.error ? `f′(x) = 无法求导` : `f′(x) = ${result.text}`
})

const derivativeError = computed(() => derivativeResult.value?.error ?? '')

function toggleDerivative(index: number): void {
  showDerivative.value = showDerivative.value === index ? -1 : index
}

/* ---------- 导出坐标系为 PNG ---------- */

const graphRef = ref<{ exportPng: () => string } | null>(null)

function exportGraph(): void {
  const dataUrl = graphRef.value?.exportPng() ?? ''
  if (!dataUrl) return
  const link = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  link.href = dataUrl
  link.download = `banyue-graph-${stamp}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function removeGeometry(id: string): void {
  const page = currentPage.value
  if (!page) return
  page.geometry = page.geometry.filter((g) => g.id !== id)
  if (selectedGeoId.value === id) selectedGeoId.value = undefined
}

function clearGeometry(): void {
  const page = currentPage.value
  if (!page) return
  page.geometry = []
}

/* ---------------- 本子管理 ---------------- */

async function renameNotebook(): Promise<void> {
  const name = notebookNameInput.value.trim()
  if (!name || !currentNotebookId.value) return
  const nb = await getMathNotebook(currentNotebookId.value)
  if (!nb) return
  nb.name = name.slice(0, 40)
  await putMathNotebook(nb)
  await loadNotebooks()
  message.value = '已重命名'
  setTimeout(() => (message.value = ''), 1800)
}

async function removeNotebook(): Promise<void> {
  if (!currentNotebookId.value) return
  if (!window.confirm('删除整个草稿本？里面的所有页都会消失。')) return
  await deleteMathNotebook(currentNotebookId.value)
  await loadNotebooks()
  if (notebooks.value.length) {
    await openNotebook(notebooks.value[0]!.id)
  } else {
    await createNotebook()
  }
}

/* ---------------- 键盘快捷键 ---------------- */

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void savePage()
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    if (event.shiftKey) {
      sketchRef.value?.redo()
    } else {
      sketchRef.value?.undo()
    }
  }
  // 1-8 快速选工具（草稿工具）
  if (!typingInInput(event)) {
    const key = event.key
    if (key === 'p') sketchTool.value = 'pen'
    else if (key === 'e') sketchTool.value = 'eraser'
    else if (key === 't') sketchTool.value = 'text'
    else if (key === '1') graphTool.value = 'pan'
    else if (key === '2') graphTool.value = 'draw'
    else if (key === '3') graphTool.value = 'point'
    else if (key === '4') graphTool.value = 'tangent'
    else if (key === '5') graphTool.value = 'normal'
    else if (key === '6') graphTool.value = 'perpendicular'
  }
}

function typingInInput(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

/* 离开页面前自动保存 */
onMounted(() => {
  window.addEventListener('beforeunload', () => {
    void savePage()
  })
})

/* 自动保存（防抖） */
let autosaveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => currentPage.value,
  () => {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => {
      void savePage()
    }, 1500)
  },
  { deep: true },
)
</script>

<template>
  <div class="shell math-shell">
    <div class="page-head math-head">
      <div>
        <span class="eyebrow">Math · 数学草稿</span>
        <h1>数学工具</h1>
      </div>
      <div class="head-actions">
        <input v-model="notebookNameInput" class="nb-name" maxlength="40" @change="renameNotebook" />
        <button type="button" class="btn small-btn" @click="savePage">保存</button>
        <button type="button" class="btn small-btn" @click="createNotebook">新建本子</button>
      </div>
    </div>

    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="notice error">{{ error }}</p>

    <!-- 本子列表 -->
    <div v-if="notebooks.length > 1" class="nb-tabs">
      <button
        v-for="nb in notebooks"
        :key="nb.id"
        type="button"
        class="chip"
        :class="{ on: nb.id === currentNotebookId }"
        @click="openNotebook(nb.id)"
      >
        {{ nb.name }}
      </button>
      <button type="button" class="chip danger-chip" title="删除当前本子" @click="removeNotebook">删本子</button>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <!-- 草稿工具 -->
      <div class="tool-group">
        <span class="tool-label">草稿</span>
        <button type="button" class="tool-btn" :class="{ on: sketchTool === 'pen' }" title="手写笔 (P)" @click="sketchTool = 'pen'">✎ 笔</button>
        <button type="button" class="tool-btn" :class="{ on: sketchTool === 'eraser' }" title="橡皮擦 (E)" @click="sketchTool = 'eraser'">◻ 擦</button>
        <button type="button" class="tool-btn" :class="{ on: sketchTool === 'text' }" title="文字 (T)" @click="sketchTool = 'text'">T 字</button>
        <button type="button" class="tool-btn" title="撤销 (Ctrl+Z)" @click="sketchRef?.undo()">↶</button>
        <button type="button" class="tool-btn" title="重做 (Ctrl+Shift+Z)" @click="sketchRef?.redo()">↷</button>
        <button type="button" class="tool-btn danger" title="清空草稿" @click="sketchRef?.clear()">清空</button>
        <input v-model.number="sketchWidth" type="range" min="1" max="12" step="0.5" class="width-slider" title="笔粗细" />
      </div>

      <!-- 坐标工具 -->
      <div class="tool-group">
        <span class="tool-label">坐标</span>
        <button type="button" class="tool-btn" :class="{ on: graphTool === 'pan' }" title="平移 (1)" @click="graphTool = 'pan'">✥ 移</button>
        <button type="button" class="tool-btn" :class="{ on: graphTool === 'draw' }" title="自由画线 (2)" @click="graphTool = 'draw'">∿ 线</button>
        <button type="button" class="tool-btn" :class="{ on: graphTool === 'point' }" title="画点 (3)" @click="graphTool = 'point'">• 点</button>
        <button type="button" class="tool-btn" :class="{ on: graphTool === 'tangent' }" title="切线 (4)" @click="graphTool = 'tangent'">╱ 切线</button>
        <button type="button" class="tool-btn" :class="{ on: graphTool === 'normal' }" title="法线 (5)" @click="graphTool = 'normal'">┴ 法线</button>
        <button type="button" class="tool-btn" :class="{ on: graphTool === 'perpendicular' }" title="垂线 (6)" @click="graphTool = 'perpendicular'">⊥ 垂线</button>
        <button
          v-if="selectedGeoId"
          type="button"
          class="tool-btn danger"
          title="删除选中的几何元素"
          @click="removeGeometry(selectedGeoId)"
        >
          删选中
        </button>
        <button type="button" class="tool-btn danger" title="清空所有几何元素" @click="clearGeometry">清几何</button>
      </div>

      <!-- 颜色 -->
      <div class="tool-group colors">
        <button
          v-for="c in PALETTE"
          :key="c"
          type="button"
          class="color-dot"
          :class="{ on: sketchColor === c }"
          :style="{ background: c }"
          :title="c"
          @click="sketchColor = c; graphColor = c"
        />
      </div>
    </div>

    <!-- 函数输入 -->
    <div class="func-bar">
      <input
        ref="exprInputEl"
        v-model="exprInput"
        class="expr-input"
        placeholder="输入函数，如 sin(x)、x^2、2x+1、sqrt(x)…"
        @keydown.enter="addFunction"
      />
      <input v-model="exprColor" type="color" class="expr-color" title="曲线颜色" />
      <button type="button" class="btn small-btn" @click="addFunction">画曲线</button>
      <div class="token-row">
        <button
          v-for="t in FUNC_TOKENS"
          :key="t.label"
          type="button"
          class="token-btn"
          :title="`插入 ${t.insert}`"
          @click="insertToken(t)"
        >
          {{ t.label }}
        </button>
      </div>
      <div v-if="currentPage?.functions.length" class="func-list">
        <span
          v-for="(f, i) in currentPage.functions"
          :key="i"
          class="func-chip"
          :class="{ off: !f.visible, derived: showDerivative === i }"
        >
          <i :style="{ background: f.color }" />
          <code>{{ f.expr }}</code>
          <button
            type="button"
            class="x"
            :title="showDerivative === i ? '收起导数' : '显示 f′(x)'"
            @click="toggleDerivative(i)"
          >
            ′
          </button>
          <button type="button" class="x" title="隐藏/显示" @click="toggleFunction(i)">{{ f.visible ? '👁' : '—' }}</button>
          <button type="button" class="x" title="删除" @click="removeFunction(i)">×</button>
        </span>
      </div>
      <!-- 导数结果条：只在展开时出现，不挤占常驻空间 -->
      <p v-if="derivativeText" class="derivative-line">
        <code>{{ derivativeText }}</code>
        <span v-if="derivativeError" class="muted small">（{{ derivativeError }}）</span>
      </p>

      <!-- 代入求值：算 f(x) 与 f'(x) 数值 -->
      <div v-if="currentPage?.functions.length" class="calc-row">
        <label class="calc-label">代入 x =</label>
        <input v-model="evalX" class="calc-input" type="text" inputmode="decimal" aria-label="代入的 x 值" />
        <span class="muted small">数值结果</span>
        <div class="calc-out">
          <span v-for="(row, i) in evalRows" :key="i" class="calc-item">
            <code>{{ row.expr }}</code>
            <b>f = {{ row.error ? '—' : formatNum(row.fx) }}</b>
            <b class="muted">f′ = {{ row.error ? '—' : formatNum(row.dfx) }}</b>
          </span>
        </div>
      </div>

      <!-- 定积分：数值近似（辛普森法） -->
      <div v-if="currentPage?.functions.length" class="calc-row">
        <label class="calc-label">∫ 从</label>
        <input v-model="integA" class="calc-input" type="text" inputmode="decimal" aria-label="积分下限" />
        <label class="calc-label">到</label>
        <input v-model="integB" class="calc-input" type="text" inputmode="decimal" aria-label="积分上限" />
        <span class="muted small">面积 ≈</span>
        <div class="calc-out">
          <span v-for="(row, i) in integralRows" :key="i" class="calc-item">
            <code>{{ row.expr }}</code>
            <b>≈ {{ row.error ? '—' : formatNum(row.value) }}</b>
          </span>
        </div>
      </div>

      <!-- 公式模板库 -->
      <div class="template-row">
        <span class="muted small">公式模板：</span>
        <button
          v-for="t in TEMPLATES"
          :key="t.label"
          type="button"
          class="template-btn"
          :title="t.expr"
          @click="applyTemplate(t.expr)"
        >
          {{ t.label }}
        </button>
      </div>
    </div>

    <!-- 工作区 -->
    <div class="work-area">
      <!-- 左侧：草稿 -->
      <div class="pane sketch-pane">
        <div class="pane-title">草稿纸 <span class="muted small">鼠标写画 · 点「T字」后点击可打字</span></div>
        <SketchCanvas
          ref="sketchRef"
          :tool="sketchTool"
          :color="sketchColor"
          :width="sketchWidth"
          :serialized="currentPage?.sketch ?? ''"
          @update:serialized="onSketchUpdate"
        />
      </div>

      <!-- 右侧：坐标系 -->
      <div class="pane graph-pane">
        <div class="pane-title">坐标系 <span class="muted small">滚轮缩放 · 拖拽平移</span></div>
        <GraphCanvas
          ref="graphRef"
          v-if="currentPage"
          :functions="currentPage.functions"
          :geometry="currentPage.geometry"
          :view="currentPage.view"
          :tool="graphTool"
          :drawing-color="graphColor"
          :selected-id="selectedGeoId"
          @update:view="onGraphViewUpdate"
          @add-geometry="onAddGeometry"
          @select="onSelectGeometry"
        />
        <div class="geo-list">
          <span class="muted small" v-if="currentPage?.geometry.length">几何元素 {{ currentPage.geometry.length }} 个</span>
          <button type="button" class="btn small-btn" title="把当前坐标系存成图片" @click="exportGraph">
            导出 PNG
          </button>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div class="pager">
      <button type="button" class="btn small-btn" :disabled="currentPageIndex === 0" @click="goPage(currentPageIndex - 1)">← 上一页</button>
      <span class="page-indicator">第 {{ currentPageIndex + 1 }} / {{ pages.length }} 页</span>
      <button type="button" class="btn small-btn" :disabled="currentPageIndex >= pages.length - 1" @click="goPage(currentPageIndex + 1)">下一页 →</button>
      <button type="button" class="btn small-btn" @click="addPage">＋ 加页</button>
      <button type="button" class="btn small-btn danger" @click="removePage">删本页</button>
    </div>
  </div>
</template>

<style scoped>
.math-shell {
  padding-bottom: 48px;
}
.math-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}
.nb-name {
  padding: 8px 14px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--bg-soft);
  color: var(--text);
  font-size: 0.9rem;
  outline: none;
}
.nb-name:focus {
  border-color: var(--accent-line);
}
.nb-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0 16px;
}
.danger-chip {
  color: var(--danger) !important;
  border-color: rgba(251, 113, 133, 0.4) !important;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  margin-bottom: 12px;
}
.tool-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.tool-label {
  color: var(--dim);
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  margin-right: 4px;
}
.tool-btn {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  color: var(--text-2);
  font-size: 0.82rem;
  white-space: nowrap;
}
.tool-btn:hover {
  color: var(--accent);
  border-color: var(--accent-line);
}
.tool-btn.on {
  color: var(--accent);
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.tool-btn.danger {
  color: var(--danger);
}
.tool-btn.danger:hover {
  border-color: rgba(251, 113, 133, 0.4);
  background: rgba(251, 113, 133, 0.08);
}
.width-slider {
  width: 80px;
  accent-color: var(--accent);
}
.colors {
  gap: 5px;
}
.color-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
}
.color-dot.on {
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
}
.func-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  margin-bottom: 12px;
}
.expr-input {
  flex: 1;
  min-width: 200px;
  padding: 8px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.9rem;
  outline: none;
}
.expr-input:focus {
  border-color: var(--accent-line);
}
.expr-color {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: none;
  cursor: pointer;
}
.func-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
}
.func-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 8px;
  border: 1px solid var(--line);
  font-size: 0.78rem;
}
.func-chip i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.func-chip.off {
  opacity: 0.45;
}
.func-chip code {
  font-family: var(--mono);
  font-size: 0.78rem;
}
/* 展开导数时高亮当前这一条 */
.func-chip.derived {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.derivative-line {
  margin: 8px 0 0;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  border: 1px dashed var(--accent-line);
  background: var(--card-2);
  font-size: 0.82rem;
}
.derivative-line code {
  font-family: var(--mono);
  color: var(--accent);
}

/* 快捷函数插入 */
.token-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  width: 100%;
}
.token-btn,
.template-btn {
  padding: 4px 9px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 0.76rem;
  cursor: pointer;
}
.token-btn:hover,
.template-btn:hover {
  border-color: var(--accent-line);
  color: var(--accent);
}

/* 代入求值 / 定积分 一行 */
.calc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
  margin-top: 8px;
}
.calc-label {
  font-size: 0.8rem;
  color: var(--muted);
}
.calc-input {
  width: 72px;
  padding: 5px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--mono);
  outline: none;
}
.calc-input:focus {
  border-color: var(--accent-line);
}
.calc-out {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.calc-item {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 7px;
  border: 1px solid var(--line);
  font-size: 0.78rem;
}
.calc-item code {
  font-family: var(--mono);
  color: var(--accent);
}

/* 公式模板库 */
.template-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  width: 100%;
  margin-top: 8px;
}

.func-chip .x {
  color: var(--dim);
  font-size: 0.8rem;
  padding: 0 2px;
}
.func-chip .x:hover {
  color: var(--danger);
}
.work-area {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: 14px;
  margin-bottom: 16px;
}
.pane {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px;
  background: var(--card);
}
.pane-title {
  margin-bottom: 10px;
  font-size: 0.88rem;
  font-weight: 600;
}
.geo-list {
  margin-top: 8px;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
}
.page-indicator {
  color: var(--muted);
  font-size: 0.85rem;
  min-width: 90px;
  text-align: center;
}
.notice {
  margin: 8px 0;
  color: var(--accent);
  font-size: 0.85rem;
}
.notice.error {
  color: var(--danger);
}
.small-btn {
  padding: 6px 14px;
  font-size: 0.8rem;
}

@media (max-width: 900px) {
  .work-area {
    grid-template-columns: 1fr;
  }
}
</style>
