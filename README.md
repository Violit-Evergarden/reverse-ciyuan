# reverse — 次元壁纸 (me.alzz.awsl) 逆向工作目录

> **本目录是该逆向项目所有成果 / 经验 / 示例数据的唯一存放与更新位置。**
> 后续任何新抓包、新接口解析、新经验,都更新本目录(文档进 `docs/`,工具进 `tools/`,数据进 `data/`,样例进 `samples/`),并同步更新 `docs/ciyuan_reverse_engineering_report.md` 与本 README。
> 迁移自 `/tmp`(2026-10-13);报告内的 `/tmp/...` 路径为抓取时原始路径,现对应本目录文件。

对象:自己的 App「次元壁纸」v2.11.5,用于功能测试与网页版数据源建设。
方法:Frida 16.7.19 spawn-gate hook Conscrypt 明文字节流,dump TLS 解密后的 HTTP/2 明文(详见报告 §3)。

---

## 目录结构

```
reverse/
├── README.md                      本文件(索引 + 快速上手)
├── docs/
│   ├── ciyuan_reverse_engineering_report.md   ★ 总报告(成果/方法论/经验/字段映射)
│   └── ciyuan_capture_summary.txt             抓包摘要(接口/结构/CDN)
├── tools/
│   ├── ciyuan_channel_client.py   ★★ 协议级客户端(无需App): 签名复现/verify/rank/login/feed (2026-10-14)
│   ├── ciyuan_decode_url.py       ★ 原图(url)下载 + 单字节 XOR 解码
│   ├── parse_http2.py             HTTP/2 明文帧解析(切连接/HPACK/按 stream 抽 body)
│   ├── parse_proto.py             protobuf wire-format 递归打印(无需 .proto,支持 --path 下钻)
│   ├── dump_headers.py            HTTP/2 抓包完整请求/响应头导出(复现精确请求头用)
│   └── frida/
│       ├── dump4.js               明文流 hook(请求/响应双向,带连接身份 cid)
│       ├── dump5.js               dump4 + 单字节 write(int) 补全
│       ├── spawn_dump_ctl.py      spawn-gate 捕获控制器(参数: script 秒数 前缀 [pid])
│       └── attach_dump_ctl.py     attach 捕获控制器(参数: script 秒数 前缀 pid)
├── data/
│   ├── ciyuan_rank.json           ★ 排行接口 JSON(4 组 × 10 = 40 张壁纸,未登录可得)
│   ├── ciyuan_login_resp.json     ★ 登录响应 JSON(token/username/id/phone/isPro)
│   ├── ciyuan_home_channel_req.pb  ★ 登录后首页 /channel 请求 protobuf(含 token)
│   ├── ciyuan_home_channel_resp.pb ★ 登录后首页 /channel 响应 protobuf(100 张 Wallpaper)
│   ├── ciyuan_channel_req.pb / _resp.pb   未登录 /channel 请求/响应(LoadWallpaperReq / Result"请重新登录")
│   ├── ciyuan_http2_req_frames.bin / _resp_frames.bin        首轮 /channel 会话 HTTP/2 明文帧
│   ├── ciyuan_rank_http2_req_frames.bin / _resp_frames.bin   排行会话 HTTP/2 明文帧
│   ├── ciyuan_channel_page1_live_20261014.json  ★ 协议级客户端实时拉取的首页流(100条,签名复现验证)
│   ├── raw_login/                 登录会话按连接分组的原始明文(login+channel+图片)
│   ├── raw_rank/                  排行会话按连接分组的原始明文
│   └── raw_page2/                 第 2 页(懒加载翻页)/channel 请求/响应 + 缩略图请求 (18MB 缩略图响应体已删, 需要时重抓)
├── web/                           ★★ 网页版(零 npm 依赖, Node≥18): server.js 协议网关 + public/ 单页前端
│   ├── README.md                  启动/配置/API/边界说明
│   └── secrets.local.json         账号/SALT/token (本地机密, .gitignore 不入库)
└── samples/
    ├── thumb_sample.webp          缩略图样例
    └── ui/                        关键界面截图(侧边栏/登录页/排行/登录后首页)
    (原图样例不入库: 体积大且随时可用 tools/ciyuan_decode_url.py --all 再生)
```

---

## 核心结论速查

| 项 | 结论 |
|---|---|
| API 主机 | `api.awsl.13th.tech`(39.108.98.138:443),HTTP/2 over TLS,单连接多路复用 |
| 图片 CDN | `bitiful.cdn.13th.tech`(需浏览器 UA,否则 403)、`pic1.imgdb.cn`(无限制) |
| 登录 | `POST /u/login`,form-urlencoded;响应 JSON 带 `token` |
| token 位置 | **`/channel` protobuf 顶层 f2**(不走 HTTP 头) |
| 首页壁纸 API | `POST /channel`(protobuf `LoadWallpaperReq`)→ `LoadWallpaperRsp`,`f2.f1`=repeated Wallpaper |
| 排行(未登录) | `GET /rank?token=` → JSON,4 组 × 10 张 |
| 缩略图 | `GET /i/<hash>.webp` |
| **分页/懒加载** | 首页一次返 100 条;下滑仅客户端懒加载缩略图(`/i/*.webp`,无列表接口);滑到底触发下一页 `/channel`,**游标=内层 f1=上一页最后一条 createdAt(ms)**,首页为 INT64_MAX;响应不带 next-cursor |
| 原图混淆 | `wallpaper.url` 的 `*.a` = 整文件单字节 XOR 的 webp;`key = raw[0] ^ 0x52` |
| Wallpaper 字段 | proto f1 id / f2 author / **f3 isR16** / f4 pixivId / f5 tags[] / f6 thumbUrl / f7 url / f8 width / f9 height / f10 comic / f11 characters[] / f12 uploader / f13 createdAt |
| **签名算法** ★已复现 | `sign(x) = md5hex(md5hex(SALT + x))`(libhell.so `native_sign`,双重 MD5 前插盐)。HTTP: x=排序去重的 `k=v`(query/form+t) 以 `&` 连接;`/channel`: x=`hex(不含 sg 的 Channel 序列化)`。SALT 32B 在 .rodata 0x166ce,字面量存 `web/secrets.local.json`(不入库)。详见报告 §8 |
| 缺签名报错 | `code:-2 "请升级至最新版"`(误导文案,实为签名校验失败);`-5`=需 Pro;`-6`=type_url 未知/已废弃 |
| 搜索 = Pro 付费 | `SearchWallpaperReq{endTime=1,keyword=2,author=3,pixivId=4}` → `"请先激活高级账户"` |
| 随机/漫画源已废弃 | `RandomWallpaper.Req`、`ComicsReq` → `-6 "请升级至最新版"`(实测 2026-10-14) |
| comic 服务端过滤 | `LoadWallpaperReq.f2=作品名` 有效(100/100 命中);f3=landscape(0=竖屏流) |
| 缩略图重定向链 | `pic1.imgdb.cn/i/*.webp` → 302 → `wkphoto.cdn.bcebos.com/*.jpg`(百度CDN,实为 jpeg);**带 Referer→403,不带→200** |
| Channel 信封 | req=1 token=2 p=3 v=4(102) vn=5 ua=6 t=7 **sg=8** cd=9 sh=10(证书MD5hex.hashCode=1632386598) nd=11 mt=12 ij=13;cd/nd 服务端不校验可复用抓包值 |
| pixivId 语义 | **string 字段**:纯数字=pixiv 作品 ID(可带 `-页码` 后缀=多图投稿第 N 页,已线上实锤);**32位hex=站外源标识**(无 pixiv 源,多为国产 IP 官方壁纸规格)。来源模型:少数策展账号批量转载 pixiv 高人气作品(单账号占 94/140;author=画师 ≠ uploader=APP账号)。详见报告 §10 |
| Web 部署 | 线上 https://www.violet37.cn (nginx TLS → systemd ciyuan-web → 8787); 日常 `tools/web_verify.sh && tools/deploy.sh`; 凭据/SSH 目标在 gitignored `web/*.local.json`; 全经验见报告 §11 |
| 公开仓库脱敏 | `data/raw_login/`(明文账密/token/手机号)**不入库**(.gitignore,仅本地);两处含旧 token 的 pb 已等长打码 `REDACTED_TOKEN_*`(其 sg 校验作废,verify 自动 SKIP);`web/secrets.local.json` 从不跟踪。⚠️ 历史提交 95b4537 曾公开含明文→**建议改密码或重写历史** |

---

## 快速上手

```bash
cd /Users/qiaoyuan/Desktop/project/reverse

# 1) 解析某个 HTTP/2 明文帧文件
python3 tools/parse_http2.py data/ciyuan_rank_http2_resp_frames.bin /tmp/out/

# 2) 打印 protobuf 结构(可下钻, 如首页响应 f3.f2.f1 = Wallpaper 列表)
python3 tools/parse_proto.py data/ciyuan_home_channel_resp.pb 3 --path 3,2,1

# 3) 解码原图
python3 tools/ciyuan_decode_url.py --all data/ciyuan_rank.json /tmp/origs/

# 4) 协议级客户端(无需 App/模拟器, 2026-10-14 新增)
python tools/ciyuan_channel_client.py verify              # 离线验证签名算法(抓包样本 4/4)
python tools/ciyuan_channel_client.py rank                # 实时排行
python tools/ciyuan_channel_client.py feed --comic 原神 --pages 2   # 实时首页流/作品过滤

# 5) 网页版(先配 web/secrets.local.json, 见 web/README.md)
node web/server.js                                        # → http://127.0.0.1:8787

# 6) 重新抓包(需模拟器 + frida-server 16, 见报告 §4)
python3 tools/frida/spawn_dump_ctl.py tools/frida/dump4.js 120 newcap
```

## 环境要点(易踩坑)

- frida 用 **16.7.19**(17.x Java bridge 损坏);attach 用 **PID**(进程显示名为中文)。
- 系统 CA 必须**开机前**写入 `/system` 并重启;mitm 需 `--ignore-hosts` 放行 Google 探测。
- App 的 API **绕过系统代理直连**,mitm 代理/transparent 均无效 → 用 Conscrypt 明文流 hook。
- 底部 tab 为自绘视图,uiautomator 不可靠;排行 tab 真实坐标 ≈ (160,610)(320×640 屏)。
- 首启有隐私协议弹窗需点"同意";侧边栏误点会弹系统照片选择器。
