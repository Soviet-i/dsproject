# 线路视图 API 标准（就是右侧路线列表）

用于右侧“推荐路线”列表的数据来源。前端通过 **POST JSON** 获取线路规划结果，并渲染到右侧栏上半部分。

## 1. 接口约定

- **Method**: `POST`
- **Content-Type**: `application/json`
- **Path**: 由前端设置 `路线规划 API 地址`

## 2. 请求体

```json
{
  "query": "大兴机场到国贸怎么走？",
  "origin": "大兴机场",
  "destination": "国贸",
  "language": "zh",
  "client": "metro-app",
  "version": "v1"
}
```

字段说明：

- `query`（可选）：用户输入原文，后端可自行解析起终点。
- `origin` / `destination`（可选）：明确起终点（若已解析）。
- `language`：界面语言（`zh` / `en`）。
- `client` / `version`：客户端标识与协议版本（用于灰度/兼容）。

## 3. 响应体

```json
{
  "requestId": "req_123456",
  "origin": "大兴机场",
  "destination": "国贸",
  "generatedAt": "2026-03-26T08:00:00Z",
  "routes": [
    {
      "routeId": "r1",
      "title": "大兴机场 → 国贸",
      "desc": "大兴机场线 + 10号线 · 1次换乘",
      "duration": 52,
      "badge": "最快",
      "color1": "#D85A30",
      "color2": "#185FA5",
      "label1": "大兴机场线",
      "label2": "10号线",
      "switchAt": 2,
      "stations": [
        { "name": "大兴机场", "x": 0.10, "y": 0.85 },
        { "name": "大兴机场北", "x": 0.23, "y": 0.72 }
      ]
    }
  ]
}
```

字段说明：

- `routes[]`：用于右侧路线列表渲染。
- `title`：路线标题（若缺省，前端将使用 `origin → destination`）。
- `desc`：路线描述（必填，前端展示在子标题）。
- `duration`：耗时分钟（数字）。
- `badge`：徽标（如“最快”“步行最少”）。
- `color1` / `color2` / `label1` / `label2`：线路配色与名称。
- `stations`：可选，用于未来地图高亮（保持与前端坐标一致）。

## 4. 失败响应

```json
{
  "requestId": "req_123456",
  "error": "invalid origin or destination"
}
```

前端会在右侧栏显示错误提示，并回退到内置示例路线。