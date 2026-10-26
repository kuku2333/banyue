<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

// 分组列出站内的键盘快捷键，新增快捷键时记得同步这里
const groups: { title: string; items: { keys: string[]; desc: string }[] }[] = [
  {
    title: '全局',
    items: [
      { keys: ['Ctrl', 'K'], desc: '打开全站搜索' },
      { keys: ['?'], desc: '打开本快捷键帮助' },
      { keys: ['Esc'], desc: '关闭弹层 / 搜索 / 帮助' },
    ],
  },
  {
    title: '播放器',
    items: [
      { keys: ['空格'], desc: '播放 / 暂停' },
      { keys: ['←'], desc: '后退 5 秒' },
      { keys: ['→'], desc: '前进 5 秒' },
      { keys: ['↑', '↓'], desc: '音量 + / −' },
      { keys: ['M'], desc: '静音' },
      { keys: ['F'], desc: '切换迷你 / 全屏' },
      { keys: ['1', '–', '9'], desc: '跳到对应百分比进度（按 1=10% … 9=90%）' },
    ],
  },
  {
    title: '阅读器',
    items: [
      { keys: ['↑', '↓'], desc: '上一页 / 下一页（翻页模式）' },
      { keys: ['1', '–', '9'], desc: '跳到对应百分比进度' },
    ],
  },
]

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="shortcut-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="键盘快捷键"
      @click.self="emit('close')"
    >
      <div class="shortcut-panel">
        <header class="shortcut-head">
          <h2>键盘快捷键</h2>
          <button type="button" class="shortcut-x" aria-label="关闭" @click="emit('close')">×</button>
        </header>
        <div class="shortcut-body">
          <section v-for="group in groups" :key="group.title" class="shortcut-group">
            <h3>{{ group.title }}</h3>
            <ul>
              <li v-for="item in group.items" :key="item.desc">
                <span class="keys">
                  <kbd v-for="key in item.keys" :key="key">{{ key }}</kbd>
                </span>
                <span class="desc">{{ item.desc }}</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.shortcut-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  backdrop-filter: blur(2px);
}

.shortcut-panel {
  width: min(560px, 100%);
  max-height: 86vh;
  overflow: auto;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
}

.shortcut-head {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}

.shortcut-head h2 {
  margin: 0;
  font-size: 1.05rem;
}

.shortcut-x {
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
}

.shortcut-x:hover {
  color: var(--text);
}

.shortcut-body {
  padding: 8px 20px 20px;
}

.shortcut-group h3 {
  margin: 16px 0 8px;
  font-size: 0.82rem;
  letter-spacing: 0.06em;
  color: var(--accent);
  text-transform: uppercase;
}

.shortcut-group ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.shortcut-group li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}

.keys {
  flex: 0 0 auto;
  display: inline-flex;
  gap: 4px;
  min-width: 96px;
}

kbd {
  display: inline-block;
  min-width: 22px;
  padding: 2px 7px;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 0.78rem;
  text-align: center;
  color: var(--text);
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 6px;
}

.desc {
  color: var(--text);
  font-size: 0.9rem;
}
</style>
