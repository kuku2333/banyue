<script setup lang="ts">
import type { ParagraphComment } from '@/lib/paragraph-comments'

/** 阅读器里的一段：正文 + 段末评论数（点击弹评论窗） + 右键/长按写评论 */
const props = defineProps<{
  text: string
  comments: ParagraphComment[]
}>()
const emit = defineEmits<{
  'open-editor': []
}>()

let touchTimer: number | undefined
let touchMoved = false

function onTouchStart(): void {
  touchMoved = false
  touchTimer = window.setTimeout(() => {
    if (!touchMoved) emit('open-editor')
  }, 550)
}
function onTouchMove(): void {
  touchMoved = true
  if (touchTimer) {
    clearTimeout(touchTimer)
    touchTimer = undefined
  }
}
function onTouchEnd(): void {
  if (touchTimer) {
    clearTimeout(touchTimer)
    touchTimer = undefined
  }
}
</script>

<template>
  <div class="para-wrap" :class="{ 'has-comments': props.comments.length > 0 }">
    <p
      class="para-text"
      @contextmenu.prevent="emit('open-editor')"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend="onTouchEnd"
    >
      {{ props.text }}
    </p>

    <button
      v-if="props.comments.length > 0"
      type="button"
      class="p-cmt-count"
      title="查看评论"
      @click="emit('open-editor')"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 2h9v6.5h-5L3 10.5V8.5H1.5z" /></svg>
      {{ props.comments.length }} 条评论
    </button>
  </div>
</template>

<style scoped>
.p-cmt-count {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin: 2px 0 6px;
  padding: 1px 8px;
  border: 1px solid color-mix(in oklab, var(--accent, #38bdf8) 40%, transparent);
  border-radius: 999px;
  background: color-mix(in oklab, var(--accent, #38bdf8) 10%, transparent);
  color: var(--accent, #38bdf8);
  font-size: 0.72em;
  cursor: pointer;
}
.p-cmt-count:hover {
  background: color-mix(in oklab, var(--accent, #38bdf8) 22%, transparent);
}
.p-cmt-count svg {
  width: 11px;
  height: 11px;
  fill: currentColor;
}
</style>
