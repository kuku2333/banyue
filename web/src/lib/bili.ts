export interface BiliItem {
  rank: number
  title: string
  up: string
  view: number
  url: string
}

/** B 站音乐区排行快照：api.bilibili.com 在浏览器端拿不到（需 buvid + 反跨域），只能存快照 */
export const BILI_SNAP = '2026-10-21'

export const BILI_HOT: BiliItem[] = [
  { rank: 1, title: "给我们的组合起个名！", up: "田一名sir", view: 17863304, url: "https://www.bilibili.com/video/BV17VZpY1ENA" },
  { rank: 2, title: "20世纪美国乡村经典民谣《阳光彩虹小白马》", up: "我太高兴了", view: 5685988, url: "https://www.bilibili.com/video/BV1zKZrYAEi8" },
  { rank: 3, title: "循环歌单|【八方来财】|“【来财の小曲】谁懂憋佬仔出来时的救赎感”", up: "蛋某人音乐", view: 10059204, url: "https://www.bilibili.com/video/BV11eZ8Y5EVi" },
  { rank: 4, title: "盘点男组合那些神级翻唱，你最喜欢哪个组合呢？", up: "小王音乐盘点", view: 8594779, url: "https://www.bilibili.com/video/BV1DDZHYhE59" },
  { rank: 5, title: "\" 阳 光 唢 呐 小 白 马 \"", up: "浑元Rysn", view: 1644105, url: "https://www.bilibili.com/video/BV1RdZEY8E8T" },
  { rank: 6, title: "向佐VS药水哥！《剑灵2》双人对决mv《灵帧起手》上线", up: "剑灵2", view: 909882, url: "https://www.bilibili.com/video/BV1MXZJYpEuN" },
  { rank: 7, title: "【SMTR25】SMTR25 Introduction film_松河", up: "SMTR25", view: 3584643, url: "https://www.bilibili.com/video/BV1t1Z4YgEcM" },
  { rank: 8, title: "【AI蚊子】恋爱循环", up: "阮念゜", view: 956561, url: "https://www.bilibili.com/video/BV1KRZhYSE98" },
  { rank: 9, title: "中国唢呐硬控甲亢哥20秒！没有人能逃得过一首《通天大道宽又阔》！", up: "民乐也疯狂", view: 1972358, url: "https://www.bilibili.com/video/BV16gZpYmEqW" },
  { rank: 10, title: "他们朝我扔泥巴 我拿泥巴种荷花.", up: "我爱吃派大星", view: 5303306, url: "https://www.bilibili.com/video/BV15bZfY3E8B" },
]
