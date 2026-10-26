<script setup lang="ts">
// 图片灯箱：文章正文里的图片点一下放大看。
// 用 Teleport 挂到 body，避免被正文的 transform/overflow 裁掉。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ src: string; alt: string }>()
const emit = defineEmits<{ close: [] }>()

const scale = ref(1)
const offset = ref({ x: 0, y: 0 })
const dragging = ref(false)
let dragStart = { x: 0, y: 0, ox: 0, oy: 0 }

const style = computed(() => ({
  transform: `translate(${offset.value.x}px, ${offset.value.y}px) scale(${scale.value})`,
  cursor: dragging.value ? 'grabbing' : scale.value > 1 ? 'grab' : 'zoom-in',
}))

function onWheel(event: WheelEvent): void {
  event.preventDefault()
  const next = scale.value * (event.deltaY < 0 ? 1.15 : 1 / 1.15)
  scale.value = Math.min(6, Math.max(1, next))
  if (scale.value === 1) offset.value = { x: 0, y: 0 }
}

function onPointerDown(event: PointerEvent): void {
  if (scale.value <= 1) return
  dragging.value = true
  dragStart = { x: event.clientX, y: event.clientY, ox: offset.value.x, oy: offset.value.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  offset.value = {
    x: dragStart.ox + (event.clientX - dragStart.x),
    y: dragStart.oy + (event.clientY - dragStart.y),
  }
}

function onPointerUp(): void {
  dragging.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

watch(
  () => props.src,
  () => {
    scale.value = 1
    offset.value = { x: 0, y: 0 }
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.body.style.overflow = 'hidden'
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div class="lightbox" role="dialog" aria-modal="true" aria-label="图片预览" @click.self="emit('close')">
      <button type="button" class="lb-close" aria-label="关闭（Esc）" @click="emit('close')">×</button>
      <p v-if="scale > 1" class="lb-zoom">{{ Math.round(scale * 100) }}%</p>
      <img
        :src="src"
        :alt="alt"
        :style="style"
        draggable="false"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      />
      <p class="lb-hint">滚轮缩放 · 放大后可拖动 · Esc 关闭</p>
    </div>
  </Teleport>
</template>

<style scoped>
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 40px 20px;
  background: rgba(0, 0, 0, 0.86);
  backdrop-filter: blur(6px);
  overflow: hidden;
}

.lightbox img {
  max-width: min(96vw, 1400px);
  max-height: 84vh;
  border-radius: 8px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  transition: transform 0.12s ease-out;
  touch-action: none;
}

.lb-close {
  position: absolute;
  top: 18px;
  right: 20px;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 1.3rem;
  line-height: 1;
  background: rgba(255, 255, 255, 0.08);
}

.lb-close:hover {
  background: rgba(255, 255, 255, 0.18);
}

.lb-zoom {
  position: absolute;
  top: 24px;
  left: 24px;
  margin: 0;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.lb-hint {
  position: absolute;
  bottom: 20px;
  margin: 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.76rem;
}
</style>
