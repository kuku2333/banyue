// 构建后处理：GitHub Pages 不会把未知路径回退到 index.html，
// 复制一份 404.html 让 SPA 路由在子路径刷新时也能接管。
import { copyFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const index = path.join(dist, 'index.html')

try {
  await access(index)
} catch {
  console.error('找不到 dist/index.html，请先运行 vite build')
  process.exit(1)
}

await copyFile(index, path.join(dist, '404.html'))
console.log('postbuild: dist/404.html 已生成（SPA 回退）')
