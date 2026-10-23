<script setup lang="ts">
import { computed } from 'vue'
import { blogStats } from '@/lib/content'
import { formatCount } from '@/lib/format'

const stats = computed(() => blogStats())

const timeline = [
  { year: '2026', text: '把博客从「一个文件」重写成 Vue 3 应用，内容搬进 Markdown，开始有构建、测试和部署流程。' },
  { year: '2025', text: '开始用纸笔记录每天读完的页数，年底整理成了第一份年度书单。' },
  { year: '2024', text: '搬到现在这座城市，写作的重心从「去过哪里」变成「留下来了什么」。' },
  { year: '2023', text: '写下第一篇长文，关于一家没有招牌的旧书店。' },
]

const books = [
  { title: '置身事内', author: '兰小欢', note: '把身边那台看不见的机器拆开看了一遍。' },
  { title: '夜航西飞', author: '柏瑞尔·马卡姆', note: '在书店站着一个下午读完的半本。' },
  { title: '克拉拉与太阳', author: '石黑一雄', note: '关于「被需要」这件事最温柔的一次反诘。' },
  { title: '万历十五年', author: '黄仁宇', note: '读完才发现，平静的一年里全是裂缝。' },
]
</script>

<template>
  <div class="shell">
    <div class="page-head">
      <span class="eyebrow">About</span>
      <h1>关于这页</h1>
      <p>一个人，一台电脑，和一些没写完的句子。</p>
    </div>

    <div class="post-layout" style="padding-top: 8px">
      <article class="prose" style="--font-scale: 1">
        <p>
          我叫雷半斩，写代码，也写字。这里原本只是一个练手项目，后来慢慢变成我存放「想清楚了的事」的地方
          —— 现在它已经是第二版：Vue 3 + Vite + TypeScript，内容放在 Markdown 里，构建产物是纯静态文件。
        </p>
        <p>
          我不做评论，不接入统计，不弹订阅框。你读到哪一段觉得对，那是你自己的事；觉得不对，关掉就好。
        </p>

        <h2>写作时间线</h2>
        <ul>
          <li v-for="item in timeline" :key="item.year">
            <strong>{{ item.year }}</strong> —— {{ item.text }}
          </li>
        </ul>

        <h2>最近在看的书</h2>
        <ul>
          <li v-for="book in books" :key="book.title">
            <strong>《{{ book.title }}》</strong> · {{ book.author }} —— {{ book.note }}
          </li>
        </ul>

        <h2>写在最后</h2>
        <p>
          文章随代码一起发布，构建出来是纯静态文件；书、草稿和本地音乐的笔记只存在你自己的设备上。
          账号是可选的，只用来认领公开的收藏夹、书签和评论。没有追踪，没有广告，也没有「升级到会员」。
        </p>
      </article>

      <aside class="toc">
        <h4>站点数据</h4>
        <p class="muted" style="padding: 0 10px; font-size: 0.85rem">
          {{ stats.posts }} 篇文章<br />
          {{ stats.tags }} 个标签<br />
          {{ formatCount(stats.chars) }} 字<br />
          {{ stats.years }} 年的记录
        </p>
        <h4 style="margin-top: 18px">联系方式</h4>
        <p class="muted" style="padding: 0 10px; font-size: 0.85rem">
          GitHub · kuku2333<br />
          邮箱 · hi@banyue.example
        </p>
      </aside>
    </div>
  </div>
</template>
