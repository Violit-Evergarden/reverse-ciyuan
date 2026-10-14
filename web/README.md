# 次元壁纸 · Web 版

与 APP (v2.11.5) **同源数据**的非官方网页版：发现流（游标分页）/ 作品合集（服务端过滤）/ 排行 / 详情与原图下载。
**零 npm 依赖**，仅需 Node.js ≥ 18。协议复现细节见 `../docs/ciyuan_reverse_engineering_report.md` §5/§8/§9。

## 快速开始

```bash
# 1) 配置本地机密 (不入库, 已被 ../.gitignore 忽略)
#    web/secrets.local.json:
#    {
#      "account": "你的账号",        # /u/login 用; 缺省时仅排行可用
#      "pwd":     "你的密码",
#      "salt":    "<32位SALT>",      # 从 libhell.so 提取, 见报告 §8
#      "token":   "可选,已有token"   # 缺省时自动登录获取
#    }

# 2) 启动
node server.js            # → http://127.0.0.1:8787  (PORT/HOST 环境变量可改)
```

## 后端 API (server.js)

| 路由 | 说明 | 对应 APP 协议 |
|---|---|---|
| `GET /api/rank` | 排行 4 组×10 | `GET /rank` (t+sign 头) |
| `GET /api/wallpapers?cursor=&comic=` | 首页流 100/页, 游标=上页末条 createdAt | `POST /channel` LoadWallpaperReq |
| `GET /api/search?keyword=&cursor=` | 服务端真搜索 (**需 Pro**; 非 Pro 返回 code=-5, 前端回落本地过滤) | `POST /channel` SearchWallpaperReq |
| `GET /api/comics` | 作品索引 (聚合最近 3 页) | 同上 (本地聚合) |
| `GET /api/img/thumb?u=` | 缩略图代理 (imgdb 302→百度CDN / bitiful http; **必须无 Referer**) | `GET <thumbUrl>` |
| `GET /api/img/orig?u=` | 原图代理: 下载 `*.a` → 单字节 XOR (`key=raw[0]^0x52`) → webp | `GET <url>` |
| `GET /api/status` | 配置自检 | — |

服务端职责：sign 双重 MD5 复现、Channel protobuf 信封组装/解析（手写 wire 编解码，零依赖）、
token 自动登录与失效重登（`errmsg` 含"重新登录"时）、图片磁盘缓存（`.cache/`，按 URL sha1）、
API 内存缓存（rank 10min / wallpapers 5min / comics 30min）。

## 前端 (frontend/, React 18 + Vite 5 + TS)

2026-10-14 由原生 ES module 迁移至 React（构建产物 `web/dist`，由 server.js 单端口伺服；
dev：`cd web/frontend && npm run dev` → 5173，/api 代理 8787；构建：`npm run build` 含 `tsc --noEmit`）。
状态层为零依赖外部 store（`src/store.ts` + `useSyncExternalStore`）；瀑布流为**纯函数贪心最短列**
（`src/masonry.ts distribute`，前缀稳定 → 声明式重算天然 append 不重排）；iOS web clip 就绪
（manifest + apple meta + 安全区 env() 适配）。

- **首页**：全局最新流（默认落地）+ sticky 过滤栏 + IntersectionObserver 无限滚动 + 懒加载骨架屏。
  瀑布流复刻 APP `StaggeredGridLayoutManager` 行优先语义（列数随断点 2–5 列，卡高由 `width/height` 先算）。
  ⚠️ 历史坑：CSS multi-column 列优先 + append 全版重排（首屏一行实为第 1/21/41/60/79 条）；经典滚动条
  宽度抖动触发重排只剩当批——均已在 React 版以纯函数 distribute + 列数判定根治。
- **交互模型 v2**：tab = **首页 / 分类 / 排行**；流视图承载 scope：`null` 全局 | `comic` 分类(**服务端过滤分页**) |
  `uploader`(池内过滤+下滑扩池) | `search`(**服务端真搜索, 仅 Pro**; 首次搜索自动探测, 非 Pro(`-5`)回落本地过滤并 toast)。
  **每个 scope 独立缓存** {pool,seen,cursor,done}：切换瞬时恢复、游标续载、互不清除。
  过滤以 sticky chips 显式呈现、可单独关闭；点「首页」tab = 回全局流；
  路由 `#/home #/cats #/rank #/comic/<名> #/uploader/<ID> #/search/<词>`；`gen` 代际 token 丢弃在途请求过期结果。
  面向用户文案不含逆向/协议术语。
- **分类**：聚合索引网格（最近 300 条）→ 点击进入该分类服务端过滤流
- **排行**：4 组 tab，与 APP 排行页同接口
- **详情弹窗**：先缩略图、后台渐进加载**原图**（XOR 解码流）无缝替换；元数据/标签/Pixiv 链接/原图下载
- **搜索**：无 Pro 时为池内过滤（作者/作品/标签/角色/ID/PixivID/策展账号 ID）；下滑可扩大搜索池
- **R16 开关**：localStorage 记忆


## 已知边界（实测于 2026-10-14, APP v2.11.5）

- `SearchWallpaperReq` → code=-5 "请先激活高级账户"（非 Pro 不可用）
- `RandomWallpaper.Req` / `ComicsReq` → code=-6 "请升级至最新版"（服务端已废弃该消息类型）
- 排行/首页流/作品过滤/登录/分页：全部正常
- token 过期后服务端自动用 secrets 中账号重登；账号密码变更时更新 secrets.local.json 即可
- 原图较大（可达 8MB+），首张加载数秒属正常；已做磁盘缓存

## 合规

仅供个人对自己账号数据的互操作性研究（授权逆向项目的一部分）。请勿公开部署、批量抓取或商用。
