---
title: "写代码时踩过的三个坑：从一段真实的脚本说起"
excerpt: "这篇文章用来演示代码高亮、图片放大和排版细节——同时记录三个我自己真踩过的坑。"
date: 2026-10-26
read: 6
tags: ["技术笔记", "踩坑"]
featured: false
---
这篇既是笔记，也是这个站点的功能演示。往下滑你会看到带语言标签的代码块，图片点一下可以放大看细节。

![正弦曲线示意图，点一下可以放大看看](/demo/curve.png)

## 一、异步函数里忘了 await，错误被吞掉

先看一段代码。这是我在批量导入歌词时写的，看起来没有任何问题：

```js
async function importLyrics(files) {
  const results = []
  for (const file of files) {
    const text = await file.text()
    const title = parseTitle(file.name)
    // 这里少了一个 await
    saveLyrics(title, text)
    results.push(title)
  }
  return results
}
```

`saveLyrics` 是异步的，少了 `await` 之后：函数返回时保存还没完成，而任何异常都变成了一个没人处理的 rejected promise——控制台不会报错，数据就是没写进去。

**症状**：日志说"成功 12 首"，实际库里只有 9 首。

**修法**：加 `await`，或者用 `Promise.allSettled` 并发跑并收集失败项：

```ts
type ImportResult = { title: string; ok: boolean; reason?: string }

async function importLyrics(files: File[]): Promise<ImportResult[]> {
  const settled = await Promise.allSettled(
    files.map(async (file) => {
      const text = await file.text()
      const title = parseTitle(file.name)
      await saveLyrics(title, text)
      return title
    }),
  )
  return settled.map((item, index) =>
    item.status === 'fulfilled'
      ? { title: String(item.value), ok: true }
      : { title: files[index]?.name ?? '未知', ok: false, reason: String(item.reason) },
  )
}
```

`Promise.allSettled` 的好处是：一首失败不影响其他，而且失败原因能拿到。

## 二、Python 脚本输出中文变成乱码

在 Windows 上跑 Python 脚本给 Node 用，结果 Node 收到的全是 `?`。原因很简单——Windows 控制台默认 GBK：

```python
import json
import sys

# Windows 下默认 stdout 是 gbk，输出中文会变成问号
sys.stdout.reconfigure(encoding="utf-8")

data = {"title": "小王子", "tags": ["文学", "童话"]}
print(json.dumps(data, ensure_ascii=False))
```

`safeWrite` 之前我用了 `ensure_ascii=False`，以为这样就行——其实问题在**输出流编码**，不在 JSON 序列化。必须同时做两件事。

## 三、Bash 里的变量名和系统变量撞了

这个坑最隐蔽。我写了个脚本处理 PID：

```bash
# 错：pid 是只读的系统变量，赋值会失败
for pid in 1 2 3; do
  echo "$pid"
done
```

报错是 `pid: readonly variable`。改成 `my_pid` 就好了：

```bash
for my_pid in 1 2 3; do
  echo "处理进程 $my_pid"
done
```

同样的坑还有 `$PATH`、`$HOME`、`$USER`——这些都不能重新赋值。

## 小结

| 坑 | 症状 | 修法 |
|---|---|---|
| 少写 `await` | 数据没写进去但日志说成功 | `Promise.allSettled` + 收集失败 |
| Python 输出编码 | 中文变问号 | `sys.stdout.reconfigure` |
| Bash 变量名 | readonly variable | 换名字 |

三个坑的共同点：**都不报错，或者报错的位置离真正的原因很远**。写代码最耗时间的从来不是写，是找。
