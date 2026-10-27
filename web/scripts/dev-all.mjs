// 一条命令同时拉起前端（vite）与后端（node server），方便本地联调。
// 退出时两个子进程一起关，避免后端「悄悄挂掉」导致满屏「请求失败」。
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(import.meta.url), '../../')
const node = process.execPath
const pnpm = path.resolve(root, '../node_modules/.bin/pnpm')
const hasPnpm = (await import('node:fs')).existsSync(pnpm)

const children = []

function start(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  const tag = `[${name}] `
  child.stdout.on('data', (b) => process.stdout.write(tag + b.toString().replace(/\n(?!$)/g, '\n' + tag)))
  child.stderr.on('data', (b) => process.stderr.write(tag + b.toString().replace(/\n(?!$)/g, '\n' + tag)))
  child.on('exit', (code) => {
    console.log(`${tag} exited (${code})`)
    shutdown()
  })
  children.push(child)
}

start('fe', hasPnpm ? pnpm : node, hasPnpm ? ['run', 'dev'] : ['node_modules/vite/bin/vite.js'], root)
start('be', node, ['../server/src/index.mjs'], root)

let shutting = false
function shutdown() {
  if (shutting) return
  shutting = true
  for (const c of children) {
    try {
      c.kill()
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(0), 200)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
console.log('[dev:all] 前端 + 后端已启动，Ctrl+C 一起关闭')
