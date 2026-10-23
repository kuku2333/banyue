// B站解析与流代理：解析 BV/av/URL、取清晰度与音视频流、带 Referer 的流代理。
// 不依赖第三方包；下载与播放由前端/服务端流式转发。
import { createHash } from 'node:crypto'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const API = 'https://api.bilibili.com'

/** 只允许 B站域名，避免被当成任意 URL 代理（SSRF） */
const ALLOWED_HOSTS = [
  '.bilivideo.com',
  '.bilivideo.cn',
  '.akamaized.net',
  '.bilibili.com',
  '.hdslb.com',
  '.szbdyd.com',
]

export function isAllowedBiliUrl(raw) {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    return ALLOWED_HOSTS.some((suffix) => url.hostname === suffix.slice(1) || url.hostname.endsWith(suffix))
  } catch {
    return false
  }
}

function headers() {
  const base = {
    'user-agent': UA,
    referer: 'https://www.bilibili.com/',
    origin: 'https://www.bilibili.com',
  }
  // 配置了 BANYUE_BILI_SESSDATA 就能拿到高清（1080P 等）
  const sessdata = process.env.BANYUE_BILI_SESSDATA
  if (sessdata) base.cookie = `SESSDATA=${sessdata}`
  return base
}

async function apiJson(path) {
  const response = await fetch(API + path, { headers: headers() })
  if (!response.ok) throw new Error(`B站接口 HTTP ${response.status}`)
  return response.json()
}

/** 从链接/BV号/av号里取出标识 */
export function parseVideoId(input) {
  const text = String(input ?? '').trim()
  const bv = /BV[0-9A-Za-z]{10}/.exec(text)
  if (bv) return { type: 'bvid', id: bv[0] }
  const av = /av(\d+)/i.exec(text)
  if (av) return { type: 'aid', id: av[1] }
  if (/^\d+$/.test(text)) return { type: 'aid', id: text }
  return null
}

/** 解析视频基本信息（含分P） */
export async function resolveVideo(input) {
  const parsed = parseVideoId(input)
  if (!parsed) throw new Error('没认出 BV 号 / av 号 / 链接')
  const query = parsed.type === 'bvid' ? `bvid=${parsed.id}` : `aid=${parsed.id}`
  const json = await apiJson(`/x/web-interface/view?${query}`)
  if (json.code !== 0 || !json.data) throw new Error(json.message || '视频不存在或已被删除')
  const data = json.data
  return {
    bvid: data.bvid,
    aid: data.aid,
    title: data.title,
    cover: data.pic,
    duration: data.duration,
    owner: data.owner?.name ?? '',
    desc: (data.desc ?? '').slice(0, 200),
    pages: (data.pages ?? []).map((page) => ({
      cid: page.cid,
      page: page.page,
      title: page.part,
      duration: page.duration,
    })),
  }
}

/** 清晰度名称（B站返回的是数字 id） */
const QUALITY_LABEL = {
  127: '8K',
  126: '杜比视界',
  125: 'HDR',
  120: '4K',
  116: '1080P60',
  112: '1080P+',
  80: '1080P',
  74: '720P60',
  64: '720P',
  32: '480P',
  16: '360P',
  6: '240P',
}

function label(id) {
  return QUALITY_LABEL[id] ?? `${id}P`
}

/**
 * 取某分P的播放信息：可下载的视频清晰度 + dash 流地址。
 * 注意：未登录通常只能拿到 480P/360P；配置 SESSDATA 才有高清。
 */
export async function getPlayInfo(aid, cid) {
  const json = await apiJson(
    `/x/player/playurl?avid=${aid}&cid=${cid}&qn=116&fnval=4048&fourk=1&platform=pc`,
  )
  if (json.code !== 0 || !json.data) throw new Error(json.message || '取播放地址失败')
  const data = json.data

  const dash = data.dash
  if (!dash) {
    // 兜底：老接口给的是整段 durl（flv/mp4），没有分离音轨
    return {
      qualities: [],
      videos: [],
      audios: [],
      segments: (data.durl ?? []).map((item) => ({ url: item.url, size: item.size })),
    }
  }

  const videos = (dash.video ?? []).map((item) => ({
    quality: item.id,
    label: label(item.id),
    width: item.width,
    height: item.height,
    codec: item.codecs?.startsWith('hev') || item.codecs?.startsWith('hvc') ? 'hevc' : item.codecs?.startsWith('av01') ? 'av1' : 'avc',
    bandwidth: item.bandwidth,
    url: item.baseUrl ?? item.base_url,
  }))
  // 同一清晰度可能有 hevc/avc/av1 多份，前端默认挑 avc（兼容性最好）
  const seen = new Set()
  const qualities = []
  for (const video of videos) {
    if (seen.has(video.quality)) continue
    seen.add(video.quality)
    qualities.push({ quality: video.quality, label: video.label, width: video.width, height: video.height })
  }
  qualities.sort((a, b) => b.quality - a.quality)

  const audios = (dash.audio ?? []).map((item) => ({
    id: item.id,
    bandwidth: item.bandwidth,
    codec: item.codecs ?? '',
    url: item.baseUrl ?? item.base_url,
  }))
  audios.sort((a, b) => b.bandwidth - a.bandwidth)

  return { qualities, videos, audios, segments: [] }
}

/** 代理 B站流：带 Referer 抓取并透传给客户端（支持 Range，便于拖动进度/断点） */
export async function proxyBiliStream(url, range) {
  if (!isAllowedBiliUrl(url)) throw new Error('只允许代理 B站 的媒体地址')
  const response = await fetch(url, {
    headers: {
      ...headers(),
      ...(range ? { range } : {}),
    },
  })
  if (!response.ok && response.status !== 206) {
    throw new Error(`抓取失败 HTTP ${response.status}`)
  }
  return response
}

/** 给下载的文件起个安全的名字 */
export function safeFileName(text, ext) {
  const base = String(text ?? 'bilibili')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base || 'bilibili'}${ext}`
}

/** 兼容点：图片代理也需要 Referer（封面防盗链） */
export function coverHeaders() {
  return headers()
}

/** 统一的 md5（后续如需 wbi 签名可用） */
export function md5(text) {
  return createHash('md5').update(text).digest('hex')
}
