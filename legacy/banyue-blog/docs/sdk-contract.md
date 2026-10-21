# 后端接口契约

`blog.html` 只认一个对象：

```js
window.__SMART_PAGE__.database
```

实现下面 6 个方法，云端三块功能（写作台 / 云端书库 / 云端音乐）就能原样跑起来；
其余功能（博客、书架、本地音乐、收藏）完全不依赖它。

---

## 1. `query({ databaseId, pageSize, startCursor, sorts })`

```js
const res = await db.query({
  databaseId: 'xxx',
  pageSize: 200,                 // 上限 200
  startCursor: undefined,        // 上一页返回的 nextCursor
  sorts: [{ property: '更新时间', direction: 'descending' }]
});
// res = { results: [record...], nextCursor: string|null, hasMore: boolean }
```

`record` 是**扁平对象**，键就是字段名，主键为 `_id`：

```json
{
  "_id": "rec_123",
  "标题": "第一篇云笔记",
  "内容": "## 小标题\n\n正文…",
  "类型": "笔记",
  "标签": "测试",
  "更新时间": "2026-10-21T08:00:00.000Z",
  "文件": [{ "attachmentId": "att_1", "name": "a.mp3", "fileSize": 88200 }]
}
```

页面自己翻页（`hasMore` + `nextCursor`，最多 20 页），后端单次只返回一页即可。

> 兼容性：读取时用 `pvVal()` / `pvAtts()` 包了一层，字段值写成
> `{ text: "..." }` / `{ number: 1 }` / `{ date: "..." }` 这种 oneof 结构也能解析。

---

## 2. `addRecord({ databaseId, properties })`

```js
await db.addRecord({
  databaseId: 'xxx',
  properties: {
    '标题': { text: '标题' },
    '内容': { text: '正文' },
    '类型': { select: '笔记' },
    '标签': { text: '标签A,标签B' },
    '更新时间': { date: '2026-10-21T08:00:00.000Z' },
    '文件': { attachment: [attachmentItem] }   // 来自 uploadFile
  }
});
// 返回 { id } 或 { _id }，页面两者都认
```

## 3. `updateRecord({ databaseId, recordId, properties })`

增量更新，只覆盖传入字段，返回 `{ id }`。

## 4. `deleteRecord({ databaseId, recordId })`

返回 `{}` 即可。

---

## 5. `uploadFile({ nodeId, file })`

```js
const item = await db.uploadFile({ nodeId: databaseId, file: fileObject });
// => { attachmentId, name, fileSize, fileType, mediaType }
```

拿到 `item` 后才能写进 attachment 字段。注意参数名是 `nodeId`（不是 `databaseId`）。

## 6. `getDownloadUrl({ nodeId, attachmentId })`

```js
const { downloadUrl } = await db.getDownloadUrl({ nodeId: databaseId, attachmentId });
```

返回可直接 `fetch` 的地址（预签名 / 带 token）。页面会取回 blob 再播放或入库，
所以这个地址必须允许浏览器跨域读取（`Access-Control-Allow-Origin`）。

---

## 最小实现示例

```js
window.__SMART_PAGE__ = {
  database: {
    async query(p) {
      const r = await api.get('/records', {
        db: p.databaseId, limit: p.pageSize, cursor: p.startCursor, sorts: p.sorts
      });
      return { results: r.items, nextCursor: r.next, hasMore: !!r.next };
    },
    async addRecord(p) {
      return api.post('/records', { db: p.databaseId, properties: p.properties });
    },
    async updateRecord(p) {
      return api.patch('/records/' + p.recordId, { properties: p.properties });
    },
    async deleteRecord(p) {
      return api.del('/records/' + p.recordId + '?db=' + p.databaseId);
    },
    async uploadFile(p) {
      const fd = new FormData();
      fd.append('file', p.file);
      return api.post('/upload?db=' + p.nodeId, fd);   // -> { attachmentId, name, fileSize, ... }
    },
    async getDownloadUrl(p) {
      return api.get('/download-url', { db: p.nodeId, id: p.attachmentId });
    }
  }
};
```

### 注意

- **分页**：`query` 必须支持 `pageSize`（上限 200）和游标，否则页面拉不全数据。
- **401**：未登录时写操作返回 401，页面会把提示改成「需要登录」，而不是一直转圈。
- **CORS**：`getDownloadUrl` 返回的地址要允许跨域 `fetch`。
- **并发**：页面是串行调用（一次一条），不需要处理批量事务。

---

## 页面侧的状态码约定

| 情况 | 页面表现 |
| --- | --- |
| `query` 返回空 | 显示「还没有内容」类空态，不报错 |
| `addRecord` 抛 401 | 写作台提示「需要登录才能保存」，内容留在输入框 |
| `getDownloadUrl` 抛 401 | 提示「下载需要登录」，不跳转 |
| 网络错误 | 提示具体错误信息，可重试 |
