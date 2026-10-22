<script setup lang="ts">
/** 批量管理底部条：全选 / 已选数 / 删除选中 / 退出 */
const props = defineProps<{
  count: number
  total: number
  busy: boolean
  label?: string
}>()
const emit = defineEmits<{
  'toggle-all': []
  delete: []
  cancel: []
}>()
</script>

<template>
  <div class="batch-bar" role="toolbar" aria-label="批量管理">
    <button type="button" class="b-chip" @click="emit('toggle-all')">
      {{ props.count >= props.total && props.total > 0 ? '取消全选' : '全选' }}
    </button>
    <span class="b-count">已选 {{ props.count }}</span>
    <div class="b-actions">
      <button type="button" class="b-del" :disabled="props.count === 0 || props.busy" @click="emit('delete')">
        {{ props.busy ? '删除中…' : `${props.label ?? '删除'}选中（${props.count}）` }}
      </button>
      <button type="button" class="b-cancel" :disabled="props.busy" @click="emit('cancel')">退出</button>
    </div>
  </div>
</template>

<style scoped>
.batch-bar {
  position: fixed;
  left: 50%;
  bottom: calc(18px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 95;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: color-mix(in oklab, var(--bg-2, #10151d) 92%, transparent);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.4);
  font-size: 0.88rem;
  white-space: nowrap;
}
.b-chip {
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  padding: 4px 12px;
  background: none;
  color: inherit;
  cursor: pointer;
}
.b-count {
  opacity: 0.75;
}
.b-actions {
  display: flex;
  gap: 8px;
}
.b-del {
  border: none;
  border-radius: 999px;
  padding: 5px 14px;
  background: #e2574c;
  color: #fff;
  cursor: pointer;
  font-weight: 600;
}
.b-del:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.b-cancel {
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  padding: 5px 12px;
  background: none;
  color: inherit;
  cursor: pointer;
}

@media (max-width: 767px) {
  .batch-bar {
    width: calc(100% - 24px);
    justify-content: space-between;
    gap: 8px;
    font-size: 0.82rem;
    padding: 9px 10px;
    border-radius: 14px;
  }
}
</style>
