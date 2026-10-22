<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ParagraphComment } from '@/lib/paragraph-comments'

/** 段落评论弹窗：显示该段评论 + 发表框（右键/长按段落弹出） */
const props = defineProps<{
  open: boolean
  chapterTitle: string
  paragraphPreview: string
  comments: ParagraphComment[]
  loggedIn: boolean
  busy: boolean
  error: string
}>()
const emit = defineEmits<{
  submit: [body: string]
  remove: [comment: ParagraphComment]
  'update:open': [value: boolean]
}>()

const body = ref('')

watch(
  () => props.open,
  (open) => {
    if (open) body.value = ''
  },
)

function submit(): Promise<void> | void {
  const text = body.value.trim()
  if (!text || props.busy) return
  emit('submit', text)
  body.value = ''
}
</script>

<template>
  <Transition name="auth">
    <div
      v-if="props.open"
      class="auth-layer"
      role="dialog"
      aria-modal="true"
      aria-label="段落评论"
      @click.self="emit('update:open', false)"
    >
      <div class="auth-box">
        <header>
          <h2>段落评论</h2>
          <button type="button" class="close" aria-label="关闭" @click="emit('update:open', false)">×</button>
        </header>

        <p class="lead">
          {{ props.chapterTitle }}
          <span class="preview">{{ props.paragraphPreview }}</span>
        </p>

        <ol v-if="props.comments.length" class="cmt-list">
          <li v-for="comment in props.comments" :key="comment.id">
            <div class="who">
              <b>{{ comment.owner.displayName }}</b>
              <button
                v-if="comment.mine"
                type="button"
                class="del"
                title="删除"
                @click="emit('remove', comment)"
              >
                ×
              </button>
            </div>
            <p>{{ comment.body }}</p>
          </li>
        </ol>
        <p v-else class="muted">还没有人评论，说点什么吧。</p>

        <form class="form" @submit.prevent="submit">
          <textarea
            v-model="body"
            rows="3"
            maxlength="500"
            placeholder="写下你对这段的想法（最多 500 字）"
            :disabled="props.busy"
          />
          <p v-if="props.error" class="error">{{ props.error }}</p>
          <p v-if="!props.loggedIn" class="hint">未登录时评论仅保存在本机，登录后评论公开可见。</p>
          <button type="submit" class="submit" :disabled="props.busy || !body.trim()">
            {{ props.busy ? '发送中…' : '发表评论' }}
          </button>
        </form>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.auth-layer {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(4, 8, 14, 0.62);
}
.auth-box {
  width: min(420px, 100%);
  max-height: min(78vh, 640px);
  overflow: auto;
  padding: 18px;
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  background: var(--bg-2);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
}
.auth-box header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.auth-box h2 {
  margin: 0;
  font-size: 1.05rem;
}
.close {
  border: none;
  background: none;
  color: inherit;
  font-size: 1.3rem;
  cursor: pointer;
  opacity: 0.6;
}
.close:hover {
  opacity: 1;
}
.lead {
  margin: 8px 0 12px;
  font-size: 0.82rem;
  opacity: 0.75;
}
.preview {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 4px;
  opacity: 0.85;
}
.cmt-list {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}
.cmt-list li {
  padding: 8px 10px;
  border-left: 2px solid color-mix(in oklab, var(--accent, #38bdf8) 55%, transparent);
  background: color-mix(in oklab, var(--accent, #38bdf8) 6%, transparent);
  border-radius: 6px;
}
.cmt-list li + li {
  margin-top: 8px;
}
.who {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
}
.who .del {
  margin-left: auto;
  border: none;
  background: none;
  color: inherit;
  opacity: 0.5;
  cursor: pointer;
  font-size: 1.1em;
}
.who .del:hover {
  opacity: 1;
}
.cmt-list li p {
  margin: 2px 0 0;
  font-size: 0.88rem;
  line-height: 1.65;
}
.muted {
  opacity: 0.6;
  font-size: 0.85rem;
}
.form textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--bg);
  color: inherit;
  font: inherit;
  font-size: 0.88rem;
  resize: vertical;
}
.form textarea:focus {
  outline: 2px solid color-mix(in oklab, var(--accent, #38bdf8) 55%, transparent);
}
.submit {
  width: 100%;
  margin-top: 10px;
  padding: 9px;
  border: none;
  border-radius: 8px;
  background: var(--accent, #38bdf8);
  color: #04121e;
  font-weight: 600;
  cursor: pointer;
}
.submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  margin: 8px 0 0;
  color: #f87171;
  font-size: 0.82rem;
}
.hint {
  margin: 8px 0 0;
  opacity: 0.65;
  font-size: 0.78rem;
}
</style>
