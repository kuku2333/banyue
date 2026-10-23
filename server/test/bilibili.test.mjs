import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isAllowedBiliUrl, parseVideoId, safeFileName } from '../src/bilibili.mjs'

test('B站：从链接/BV号/av号解析视频标识', () => {
  assert.deepEqual(parseVideoId('https://www.bilibili.com/video/BV1GJ411x7h7'), {
    type: 'bvid',
    id: 'BV1GJ411x7h7',
  })
  assert.deepEqual(parseVideoId('BV1GJ411x7h7'), { type: 'bvid', id: 'BV1GJ411x7h7' })
  assert.deepEqual(parseVideoId('https://www.bilibili.com/video/av80433022?p=1'), { type: 'aid', id: '80433022' })
  assert.deepEqual(parseVideoId('80433022'), { type: 'aid', id: '80433022' })
  assert.equal(parseVideoId('随便一段文字'), null)
  assert.equal(parseVideoId(''), null)
})

test('B站：媒体代理只放行 B站 相关域名', () => {
  assert.equal(isAllowedBiliUrl('https://xy106x41x209x206xy.mcdn.bilivideo.cn:8082/v1/resource/a.m4s'), true)
  assert.equal(isAllowedBiliUrl('https://upos-sz-mirrorcos.bilivideo.com/a.m4s'), true)
  assert.equal(isAllowedBiliUrl('https://i1.hdslb.com/bfs/archive/a.jpg'), true)
  // 不该被当成任意 URL 代理（SSRF）
  assert.equal(isAllowedBiliUrl('http://127.0.0.1:8787/api/me'), false)
  assert.equal(isAllowedBiliUrl('https://evil.com/a.mp4'), false)
  assert.equal(isAllowedBiliUrl('file:///etc/passwd'), false)
  assert.equal(isAllowedBiliUrl('不是 URL'), false)
})

test('B站：下载文件名去掉非法字符', () => {
  assert.equal(safeFileName('标题', '.mp4'), '标题.mp4')
  assert.equal(safeFileName('a/b:c*d?"<>|', '.m4a'), 'a b c d.m4a')
  assert.equal(safeFileName('', '.mp4'), 'bilibili.mp4')
  assert.ok(safeFileName('x'.repeat(200), '.mp4').length <= 88)
})
