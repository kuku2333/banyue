<script setup lang="ts">
import { ref } from 'vue'
import type { ParagraphComment } from '@/lib/paragraph-comments'

/** 阅读器里的一段：正文 + 段末评论数（点开展开） + 右键/长按写评论 */
const props = defineProps<{
  text: string
  comments: ParagraphComment[]
}>()
const emit = defineEmits<{
  'open-editor': []
  'remove': [comment: ParagraphComment]
}>()

const expanded = ref(false)

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

function formatTime(ts: number): string {
  const date = new Date(ts)
  return `${date.getMonth() + 1}-${date.getDate()}`
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
      :class="{ open: expanded }"
      @click="expanded = !expanded"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 2h9v6.5h-5L3 10.5V8.5H1.5z" /></svg>
      {{ props.comments.length }} 条评论
    </button>

    <div v-if="expanded" class="p-cmt-panel">
      <div v-for="comment in props.comments" :key="comment.id" class="p-cmt-item">
        <div class="p-cmt-who">
          <b>{{ comment.owner.displayName }}</b>
          <span>{{ formatTime(comment.createdAt) }}</span>
          <button
            v-if="comment.mine"
            type="button"
            class="p-cmt-del"
            title="删除"
            @click="emit('remove', comment)"
          >
            ×
          </button>
        </div>
        <p>{{ comment.body }}</p>
      </div>
      <button type="button" class="p-cmt-add" @click="emit('open-editor')">写评论</button>
    </div>
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
.p-cmt-count.open {
  background: color-mix(in oklab, var(--accent, #38bdf8) 22%, transparent);
}
.p-cmt-count svg {
  width: 11px;
  height: 11px;
  fill: currentColor;
}

.p-cmt-panel {
  margin: 2px 0 10px;
  padding: 8px 10px;
  border-left: 2px solid color-mix(in oklab, var(--accent, #38bdf8) 55%, transparent);
  background: color-mix(in oklab, var(--accent, #38bdf8) 6%, transparent);
  border-radius: 6px;
}
.p-cmt-item + .p-cmt-item {
  margin-top: 8px;
}
.p-cmt-who {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78em;
}
.p-cmt-who b {
  font-weight: 600;
}
.p-cmt-who span {
  opacity: 0.55;
}
.p-cmt-del {
  margin-left: auto;
  border: none;
  background: none;
  color: inherit;
  opacity: 0.5;
  cursor: pointer;
  font-size: 1.1em;
  line-height: 1;
}
.p-cmt-del:hover {
  opacity: 1;
}
.p-cmt-item p {
  margin: 2px 0 0;
  font-size: 0.85em;
  line-height: 1.6;
}
.p-cmt-add {
  margin-top: 8px;
  padding: 2px 10px;
  border: 1px dashed color-mix(in oklab, var(--accent, #38bdf8) 55%, transparent);
  border-radius: 999px;
  background: none;
  color: var(--accent, #38bdf8);
  font-size: 0.75em;
  cursor: pointer;
}
</style>
