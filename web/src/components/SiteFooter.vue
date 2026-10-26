<script setup lang="ts">
const year = new Date().getFullYear()
defineEmits<{ 'open-shortcuts': [] }>()
</script>

<template>
  <footer class="site-footer">
    <div class="foot-inner">
      <p>© {{ year }} 半月 · 雷半斩 —— 文字慢一点，日子也慢一点。</p>
      <div class="fnav">
        <RouterLink to="/">首页</RouterLink>
        <RouterLink to="/archive">归档</RouterLink>
        <RouterLink to="/tags">标签</RouterLink>
        <RouterLink to="/about">关于</RouterLink>
        <button type="button" class="foot-help" title="键盘快捷键 ( ? )" @click="$emit('open-shortcuts')">快捷键 ?</button>
      </div>
    </div>
  </footer>
</template>
