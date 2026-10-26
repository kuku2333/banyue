<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  backupFileName,
  collectBackup,
  downloadJson,
  summarize,
  type BackupBundle,
  type BackupSummary,
} from '@/lib/backup'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const loading = ref(false)
const error = ref('')
const bundle = ref<BackupBundle | null>(null)
const summary = ref<BackupSummary | null>(null)
const exported = ref(false)

const rows = computed(() => {
  const s = summary.value
  if (!s) return []
  return [
    { label: '文章草稿', count: s.drafts },
    { label: '书架的书', count: s.books },
    { label: '本地音乐', count: s.songs },
    { label: '阅读书签', count: s.bookmarks },
    { label: '听歌笔记', count: s.songNotes },
    { label: '数学草稿本', count: s.mathNotebooks, hint: `${s.mathPages} 页` },
    { label: '云端资产', count: s.cloudAssets },
    { label: '歌单', count: s.playlists },
  ]
})

const total = computed(() => {
  const s = summary.value
  if (!s) return 0
  return s.drafts + s.books + s.songs + s.bookmarks + s.songNotes + s.mathNotebooks + s.cloudAssets + s.playlists
})

async function scan(): Promise<void> {
  loading.value = true
  error.value = ''
  exported.value = false
  try {
    const data = await collectBackup()
    bundle.value = data
    summary.value = summarize(data)
  } catch (err) {
    error.value = (err as Error).message || '读取数据失败'
  } finally {
    loading.value = false
  }
}

function close(): void {
  emit('update:open', false)
}

async function exportNow(): Promise<void> {
  if (!bundle.value) return
  // 导出时刷新一次时间戳，避免用户开着对话框很久后导出到旧时间
  const fresh: BackupBundle = { ...bundle.value, exportedAt: new Date().toISOString() }
  downloadJson(fresh, backupFileName())
  exported.value = true
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      bundle.value = null
      summary.value = null
      void scan()
    }
  },
)
</script>

<template>
  <Transition name="backup">
    <div
      v-if="open"
      class="backup-layer"
      role="dialog"
      aria-modal="true"
      aria-label="数据备份"
      @click.self="close"
    >
      <div class="backup-box">
        <header>
          <h2>数据备份</h2>
          <button type="button" class="close" aria-label="关闭" @click="close">×</button>
        </header>

        <p class="lead">
          把草稿、书架进度、音乐清单、数学草稿本打包成一个 JSON 文件。换设备或清缓存前先导出一份。
        </p>

        <p v-if="loading" class="muted small">正在读取本地数据…</p>
        <p v-else-if="error" class="error">{{ error }}</p>

        <template v-else-if="summary">
          <ul class="rows">
            <li v-for="row in rows" :key="row.label">
              <span>{{ row.label }}</span>
              <b>{{ row.count }}</b>
              <em v-if="row.hint">{{ row.hint }}</em>
            </li>
          </ul>

          <p v-if="!total" class="muted small">还没有可备份的数据。</p>

          <div v-if="bundle?.notIncluded.length" class="notes">
            <b>以下内容不在这份备份里</b>
            <ul>
              <li v-for="item in bundle.notIncluded" :key="item">{{ item }}</li>
            </ul>
          </div>

          <footer>
            <button type="button" class="btn" @click="close">关闭</button>
            <button type="button" class="btn primary" :disabled="!total" @click="exportNow">
              导出 JSON
            </button>
          </footer>
          <p v-if="exported" class="ok">已开始下载，检查浏览器下载列表。</p>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.backup-layer {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(4px);
}

.backup-box {
  width: min(520px, 100%);
  max-height: 86vh;
  overflow-y: auto;
  padding: 22px;
  border-radius: var(--radius);
  border: 1px solid var(--line-strong);
  background: var(--card);
  box-shadow: var(--shadow);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

h2 {
  margin: 0;
  font-size: 1.05rem;
}

.close {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--muted);
  font-size: 1.1rem;
}

.close:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

.lead {
  margin: 0 0 16px;
  color: var(--muted);
  font-size: 0.86rem;
  line-height: 1.6;
}

.rows {
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--line);
}

.rows li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 9px 2px;
  border-bottom: 1px solid var(--line);
  font-size: 0.88rem;
}

.rows li span {
  flex: 1;
  color: var(--text-2);
}

.rows li b {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.rows li em {
  color: var(--dim);
  font-size: 0.76rem;
  font-style: normal;
}

.notes {
  margin: 14px 0 0;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: var(--card-2);
  font-size: 0.82rem;
}

.notes b {
  display: block;
  margin-bottom: 6px;
  color: var(--text-2);
}

.notes ul {
  margin: 0;
  padding-left: 18px;
  color: var(--muted);
  line-height: 1.7;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

.error {
  color: var(--danger);
  font-size: 0.84rem;
}

.ok {
  margin: 10px 0 0;
  color: var(--accent);
  font-size: 0.82rem;
  text-align: right;
}

.backup-enter-active,
.backup-leave-active {
  transition: opacity 0.16s ease;
}

.backup-enter-from,
.backup-leave-to {
  opacity: 0;
}
</style>
