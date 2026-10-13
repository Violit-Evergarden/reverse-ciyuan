# 次元壁纸 (me.alzz.awsl) 逆向抓包 — 成果与经验报告

> **迁移说明(2026-10-13)**:本项目全部成果/经验/示例数据已迁移至
> `/Users/qiaoyuan/Desktop/project/reverse`(本文件位于其 `docs/` 下)。
> 文中 `/tmp/...` 为抓取时原始路径,现对应:`/tmp/ciyuan_*` → `reverse/data|samples/`,脚本 → `reverse/tools/`。
> 索引与快速上手见 `reverse/README.md`;**后续更新一律在该目录进行**。

> 对象:自己的 App「次元壁纸」v2.11.5,用于功能测试与网页版数据源建设。
> 日期:2026-10-13。环境:macOS + Android 模拟器(arm64 / Android 14)+ Frida 16.7.19。

---

## 1. 最终成果一览

| 项 | 结论 |
|---|---|
| 传输 | HTTP/2 over TLS,单连接多路复用;API 主机 `api.awsl.13th.tech` → `39.108.98.138:443` |
| 接口 1 | `POST /channel`,`application/x-protobuf`,body=`me.alzz.awsl.proto.LoadWallpaperReq`;响应 `me.alzz.awsl.proto.Result`(未登录返回"请重新登录") |
| 接口 2 | `GET /rank?token=`(**未登录可用**,token 空),响应 `application/json`,即壁纸排行数据源 |
| 接口 3 | `GET /i/<hash>.webp` 缩略图;原图见 `wallpaper.url` |
| 图片 CDN | `bitiful.cdn.13th.tech`、`pic1.imgdb.cn` |
| 签名 | 请求内含 MD5 签名(与 libhell.so 逆向结论一致) |
| **原图混淆** | `wallpaper.url` 的 `*.a` 文件 = **整文件单字节 XOR 混淆的 webp**;key 每文件不同,`key = raw[0] ^ 0x52` |
| **CDN 防盗链** | bitiful CDN 有 WAF:**必须带浏览器 User-Agent**(裸 curl/空 UA → 403);Referer 不需要 |

排行 JSON 结构(40 张,4 组 × 10):

```json
{ "code":0, "msg":"", "data": { "items": [
    { "title":"近7天壁纸排行", "wallpapers": [
        { "id","author","createdAt","pixivId","tags":[], "thumbUrl","updatedAt",
          "url","width","height","uploader","md5","comic","characters":[],"isR16" }
    ]}
] } }
```

组名:近7天壁纸排行 / 近7天锁屏排行 / 壁纸总榜 / 锁屏总榜。

---

## 2. `thumbUrl` 能开、`url` 打不开的原因(本次新增结论)

1. **WAF 拦截**:bitiful CDN 对无浏览器 UA 的请求返回 403(正文为通用 "This page could not be accessed")。
   实测:UA-only → 200;Referer-only → 403。`pic1.imgdb.cn` 的缩略图则无此限制。
2. **非标准图片容器**:`url` 的 `*.a` 文件 content-type 为 `application/x-archive`,扩展名 `.a`,
   浏览器即使取到也不会渲染,只会下载。
3. **真实格式**:该文件是**整文件单字节 XOR 混淆的 webp**。
   - 例 1:key=0x19,`RIFF`→`KP__`(曾被误认为固定魔数,实为 `RIFF^0x19`)。
   - 例 2:key=0x42。
   - 推导:`key = raw[0] ^ 0x52`(明文首字节必为 `R`),再校验 `x[8:12]=='WEBP'` 且
     `struct.unpack('<I', x[4:8]) == len(x)-8`。
4. 解码工具:`/tmp/ciyuan_decode_url.py`(单 url 或 `--all rank.json outdir/`)。
   已解出示例:`/tmp/ciyuan_orig_0.webp`、`_1.webp`、`_2.webp`(均校验通过)。

> 结论:网页版若需原图,用 `url` + 浏览器 UA 下载后 XOR 解码;若只需展示,`thumbUrl`(webp)可直接用。

---

## 3. 抓包方法论(为什么 mitm 失败、最终用什么成功)

### 3.1 失败的路线(及原因)
1. **mitmproxy 常规代理**:App 的 API 客户端**代码级绕过系统代理**(直连 `39.108.98.138:443`),
   只有 Bugly 等 SDK 走代理 → 抓不到 API。
2. **系统 CA 运行时挂载(tmpfs)**:Android 的系统 CA 信任库在**开机时由 zygote/conscrypt 一次性载入内存**;
   开机后再挂证书,文件可见但内存缓存是旧的 → 仍 "Trust anchor not found"。
3. **mitmproxy transparent 模式(macOS)**:对直连到 mitm 端口的 TLS 不处理(flow 恒为 0 字节)→ 弃用。
4. **frida 17.x**:Java bridge 损坏(`Java` 全局 undefined,连 system_server 也如此)→ 无法 hook。

### 3.2 成功的路线
- **frida 16.7.19**(Java bridge 正常)**spawn-gate** 注入,hook Conscrypt 明文字节流:
  - `com.android.org.conscrypt.ConscryptEngineSocket$SSLOutputStream.write(byte[],int,int)/(byte[])` → 请求明文
  - `...$SSLInputStream.read(byte[],int,int)/(byte[])` → 响应明文
- 按 **连接对象身份**(`System.identityHashCode(this)`)分组,避免多条 TLS 连接的 stream 号互相覆盖。
- 类级 hook 对连接池复用的连接同样生效;但**已建立连接的首次请求**需在 spawn-gate 时就装好 hook。

### 3.3 环境与前置条件(缺一不可)
1. 模拟器带 `-writable-system`;`adb root`;`adb remount`(overlayfs)。
2. mitmproxy CA 以系统证书形式写入 `/system/etc/security/cacerts/<subject_hash_old>.0`
   (`restorecon` 自动给 `system_security_cacerts_file` context),**然后重启**,让 zygote 开机载入。
3. mitm 用 `--ignore-hosts` 放行 Google 连通性探测域名,否则 Android 判网络未 VALIDATED,App 不发请求。
4. 首启有**隐私协议弹窗**,需点"同意"(坐标见下)才会加载内容。
5. 底部 tab 为自绘视图,uiautomator dump 不到;真实坐标:**排行 ≈ (160,610)**(屏幕 320×640)。

---

## 4. 复现步骤

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# 1) 起模拟器(可写 system)并 root
emulator -avd ciyuan_aosp -no-window -no-audio -gpu swiftshader_indirect \
         -no-snapshot -memory 3072 -no-metrics -no-boot-anim -writable-system &
adb wait-for-device; adb root

# 2) 起 frida-server 16(17 的 Java bridge 坏了,勿用)
adb shell "nohup /data/local/tmp/frida-server-16 >/data/local/tmp/fs16.log 2>&1 &"

# 3) spawn-gate 抓取(前缀自定义)
/tmp/frida-venv/bin/python /tmp/spawn_dump_ctl.py /tmp/dump4.js 120 rank

# 4) 启动后点底部「排行」(160,610) 触发 /rank;滚动/查看更多触发更多请求

# 5) 解析:按 PRI preface 切连接 → 每连接独立 HPACK 解码器 → 按 stream 聚合 DATA
#    (参考 /tmp 下解析逻辑;protobuf 取 content-type=application/x-protobuf 的 DATA)

# 6) 原图解码
/tmp/frida-venv/bin/python /tmp/ciyuan_decode_url.py --all /tmp/ciyuan_rank.json /tmp/origs/
```

---

## 5. 登录与首页壁纸资源 API(登录后,2026-10-13 补充)

### 5.1 登录
- `POST /u/login`,`content-type: application/x-www-form-urlencoded`
- body:`account=<urlencoded email>&pwd=<urlencoded password>`(明文,未加签)
- 响应 JSON:
  ```json
  { "code":0, "msg":"", "data":{ "phone","id","email","isPro","username","token" } }
  ```
  例:`token = "<TOKEN 已脱敏>"`。错误时 `code:-2,"账号或密码错误"`。
- 产物:`/tmp/ciyuan_login_resp.json`

### 5.2 首页壁纸资源获取 API(登录后)
- 入口:登录后进入首页(发现)即触发 `POST /channel`(protobuf),**token 放在 protobuf 顶层 f2**,
  不走 HTTP 头(请求头仅 content-type/ua/accept-encoding)。
- 请求 `LoadWallpaperReq` 字段映射(440 B,已登录):
  | 字段 | 含义 | 示例 |
  |---|---|---|
  | f1 | Any{ type_url=…LoadWallpaperReq, 内层 f1=INT64_MAX, f3=0 } | 分页/游标 |
  | **f2** | **token** | <TOKEN 已脱敏> |
  | f4 | varint | 102 |
  | f5 | 版本 | 2.11.5 |
  | f6 | User-Agent | Mozilla/5.0 … Chrome/121 |
  | f7 | 时间戳 ms | 1791898161211 |
  | f8 | MD5 签名 | aeafec8f… |
  | f9 / f11 | base64 路径(cache / lib) | L2RhdGEv… |
- 响应 `me.alzz.awsl.proto.Result` → `Any{ type_url=…LoadWallpaperRsp }`,`f2.f1` = **repeated Wallpaper,本次 100 条**(29.4 KB)。
- Wallpaper proto 字段映射(与 /rank JSON 一一对应):
  | 字段 | 含义 | 示例 |
  |---|---|---|
  | f1 | id | bae96e78…(32hex) |
  | f2 | author | 方方土 |
  | f4 | pixivId | 134316952 |
  | f5 | tags[](repeated) | 光脚/躺卧/白发/… |
  | f6 | thumbUrl | https://pic1.imgdb.cn/i/….webp |
  | f7 | url(原图,XOR 混淆) | http://bitiful.cdn.13th.tech/….a |
  | f8 / f9 | width / height | 4724 / 8266 |
  | f10 | comic | 碧蓝档案 |
  | f11 | characters[](repeated) | (可空) |
  | f12 | uploader | 5ed707f6… |
  | f13 | createdAt ms | 1791819980455 |
- 首页缩略图:`GET /i/<hash>.webp`(本次 5 张,image/webp)。
- 产物:`/tmp/ciyuan_home_channel_req.pb`、`/tmp/ciyuan_home_channel_resp.pb`

### 5.3 分页 / 下滑懒加载机制(2026-10-13 补充)
下滑"加载更多"分两层,机制不同:
1. **缩略图懒加载(客户端)**:首页 /channel 一次返回 **100 条**;下滑时仅为已返回条目按需拉
   `GET /i/<hash>.webp`,**不发任何列表接口**。即图片懒加载是客户端行为,与接口参数无关。
2. **列表翻页(服务端,游标分页)**:滑到 100 条底部才触发下一次 `POST /channel`,
   分页由**请求 protobuf 参数**控制 —— 内层 `LoadWallpaperReq.f1` 为**游标=上一页最后一条的 createdAt(ms)**:
   | 页 | 内层 f1(游标) | 内层 f3 | 返回 |
   |---|---|---|---|
   | 第 1 页 | 9223372036854775807 (INT64_MAX, 表示"从最新开始") | 0 | 100 条 |
   | 第 2 页 | 1790006586512 (= 第 1 页最后一条 f13 createdAt) | 0 | 100 条 |
   - 响应**不显式返回 next-cursor**;客户端取本页最后一条 wallpaper 的 f13(createdAt) 作为下次游标。
   - 每次请求还需重算 `f7`(请求时间戳 ms) 与 `f8`(MD5 签名);token(顶层 f2) 不变。
   - 原始抓包:`data/raw_page2/`(page2 的 /channel 请求/响应 + 缩略图连接)。

---

## 6. 经验 / 坑清单(给后续会话)

1. **frida 版本**:17.x Java bridge 在本环境损坏;固定用 **16.7.19**(python+server 同版本)。
2. **attach 用 PID**,frida 按显示名(中文"次元壁纸")列进程,包名 attach 会 ProcessNotFoundError。
3. **系统 CA 必须开机前落盘 + 重启**;运行时挂载无效(内存信任缓存)。
4. **网络 VALIDATED** 是 App 发请求的前提;放行 Google 探测域名。
5. **隐私弹窗 / 自绘 tab** 靠截图+几何换算定位,别信 uiautomator(自绘视图 dump 不到,且可能返回旧文件)。
6. **多连接 stream 合并**是解析 HTTP/2 抓包最常见的坑:请求侧可按 `PRI * HTTP/2.0` 切连接,
   响应侧没有 preface → 必须靠连接身份标签(或 socket 级标记)分组。
7. **App 绕过系统代理**很常见(自建 OkHttp/直连);不要假设代理模式能抓到,准备明文流 hook 兜底。
8. **CDN 防盗链**:bitiful 只认浏览器 UA;原图是 per-file 单字节 XOR 的 webp,key 由首字节推导。
9. 抓包窗口内**刷新/切 tab 不一定重发请求**(连接池复用 + 缓存);要新请求就 spawn-gate 重开或换入口。
10. `/channel` 未登录返回"请重新登录";`/rank` 未登录可用 → 数据源优先用 `/rank`。
11. **登录态**:token 不在 HTTP 头,而在 `/channel` protobuf 顶层 f2;登录接口 `/u/login` 为表单明文。
    抓登录后接口前必须先登录,且 App 重启后登录态保留(SharedPreferences),可 spawn-gate 重抓。
12. **盲操 UI 易错**:侧边栏"制作氢壁纸"等入口会弹系统照片选择器,坐标点和登录按钮接近;
    每步操作后应截图确认当前界面,再决定下一步坐标。
13. **续接连接无法解析头**:attach 到已建立连接时,捕获文件不含 `PRI * HTTP/2.0` preface,HPACK 无法解码;
    此时可直接 grep 明文 body(form/JSON),或重启 App 用 spawn-gate 拿完整连接。

---

## 7. 交付文件清单

| 文件 | 说明 |
|---|---|
| `/tmp/ciyuan_rank.json` | ★ 排行接口 JSON(40 张壁纸元数据+URL) |
| `/tmp/ciyuan_decode_url.py` | ★ 原图(url)下载+XOR 解码工具 |
| `/tmp/ciyuan_orig_0/1/2.webp` | 解码后的原图示例(校验通过) |
| `/tmp/ciyuan_sample_511bdb.webp` | 缩略图示例 |
| `/tmp/ciyuan_channel_req.pb` / `_resp.pb` | /channel protobuf 请求/响应 |
| `/tmp/ciyuan_rank_http2_req_frames.bin` / `_resp_frames.bin` | 排行会话 HTTP/2 明文帧 |
| `/tmp/ciyuan_http2_req_frames.bin` / `_resp_frames.bin` | 首轮 /channel HTTP/2 明文帧 |
| `/tmp/ciyuan_capture_summary.txt` | 抓包摘要(接口/结构/CDN) |
| `/tmp/ciyuan_login_resp.json` | 登录响应 JSON(含 token/username/id) |
| `/tmp/ciyuan_home_channel_req.pb` | 登录后首页 /channel 请求 protobuf(含 token) |
| `/tmp/ciyuan_home_channel_resp.pb` | 登录后首页 /channel 响应 protobuf(100 张 Wallpaper) |
| `/tmp/dump4.js` `/tmp/spawn_dump_ctl.py` | 明文捕获 hook 与控制器 |
| `/tmp/ciyuan_reverse_engineering_report.md` | 本报告 |
