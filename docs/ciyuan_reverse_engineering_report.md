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

---

## 8. 签名算法完整复现 (2026-10-14, Windows 会话)

> 本节是 HANDOFF 待办「实现签名(f8, MD5)的复现」的完成记录。
> **SALT 字面量不入本仓库**（凭据纪律），存于 `web/secrets.local.json`（已 .gitignore）。

### 8.1 算法结论

```
sign(input) = md5hex( md5hex( SALT + input ) )          # 双重 MD5, 小写 hex, SALT 前缀
SALT: 32 字节可打印字符串, 静态存于 libhell.so (两处 TU 各一份 std::string 副本)
```

两条使用路径（同一 native 函数 `me.alzz.Hell.sign(String)` → `Java_me_alzz_Hell_native_1sign`）:

| 路径 | input 组装 |
|---|---|
| HTTP JSON API (`/rank`,`/u/login`; 头 `t`+`sign`) | `{非空 query 参数(URL解码后), 非空 form 参数, "t=<ms>"} → 去重 → 字典序排序 → "&" 连接`（分隔符常量复用自 alipay SDK 混淆类 `a.f2893n = "&"`） |
| `/channel` protobuf (`sg`=f8) | `hex( Channel 信封去掉 sg 字段后的规范化序列化字节 )`（`p035n.dQfJj.QQcLE` = 小写 hex） |

### 8.2 提取方法 (可复现)

1. **JADX 反编译** (jadx 1.5.6 + Temurin JDK 21, 均为便携版): `me/alzz/Hell.java` →
   `sign/encrypt` 两个 native; 引用者仅两个混淆类:
   - `p021h1/D0WjR.java` (Retrofit/okhttp 层): query/form/t 组装 + 排序去重 + `&` 连接 → `Hell.sign`
   - `U0/H3NnV.java` (`dQfJj(GeneratedMessageV3)` = Channel 信封组装器): token/p/t/ua/v/vn/cd/sh/nd/mt/ij/req 全字段 → `build().toByteArray()` (不含 sg) → hex → `Hell.sign` → `setSg`
2. **libhell.so 静态分析** (pyelftools + capstone, 未剥符号且带 DWARF —— dev 构建直接发布):
   - `_ZL4SALT` ×2 @ .bss 0x58740/0x58760 (std::string 24B); 构造函数 `_GLOBAL__sub_I_hell.cpp`
     @0x24f58 / `_GLOBAL__sub_I_jni_app.cpp` @0x2542c 从 **.rodata 0x166ce 拷贝 32 字节字面量**
     (头部 {cap=0x31,size=32} @0x168f0), 即 SALT。
   - `Java_me_alzz_Hell_native_1sign` @0x25164 (712B) 反汇编:
     `isHookPMS(env)`/`hasMtHook(env)` 反 hook 检测(命中→返回 null) → `GetStringUTFChars` →
     `std::string::insert(0, SALT)` **前插盐** → `MD5::ctor(str)` → `MD5::toStr()` → **再做一轮
     MD5 ctor+toStr** → `NewStringUTF`。MD5 为自研 C++ 实现 (`/awsl/devil/src/main/cpp/md5.cpp`, 标准算法)。
3. **离线验证**: 仓库内 5 组抓包样本 (rank / login / channel×3) 全部命中;
   `python tools/ciyuan_channel_client.py verify` 可随时重验。

### 8.3 Channel 信封字段号 (从 ChannelOuterClass.java 权威确认)

```
req=1(Any)  token=2  p=3(bool)  v=4(versionCode=102)  vn=5("2.11.5")  ua=6  t=7(ms)
sg=8(sign)  cd=9(base64 cacheDir)  sh=10(APK证书MD5hex.hashCode()=1632386598)  nd=11(base64 nativeLibraryDir)
mt=12(mthook文件存在)  ij=13(cloudinject存在)      Result: code=1 errmsg=2 rsp=3
序列化: 按字段号升序; p/mt/ij=false 及空 token 不序列化; sg 计算时缺席, 发送时插在 f7/f9 之间。
cd/nd 为设备路径 base64, 服务端不校验内容, 可直接复用抓包值 (web/server.js 内置)。
```

### 8.4 业务消息 (proto 类权威字段号)

```
LoadWallpaperReq { endTime=1(游标,INT64_MAX=最新) comic=2 landscape=3 pixivId=4 }   # 抓包中 f3=0 即 landscape
LoadWallpaperRsp { wallpapers=1(repeated Wallpaper) }
Wallpaper { id=1 author=2 isR16=3 pixivId=4 tags=5 thumbUrl=6 url=7 width=8 height=9
            comic=10 characters=11 uploader=12 createdAt=13 }
SearchWallpaperReq { endTime=1 keyword=2 author=3 pixivId=4 }   RandomWallpaper: message 名就是 Req/Rsp
Comics: Comic{name=1,count=2,thumbUrl=3} ComicRsp{comics=1} ComicsReq
```

## 9. 协议级实测矩阵与 Web 版 (2026-10-14, 服务器实时验证)

| 接口 | 结果 | 说明 |
|---|---|---|
| `GET /rank` (t+sign) | ✅ | 4 组 × 10; **裸请求(缺 sign)返回 `code:-2 "请升级至最新版"`** —— 该文案是签名校验失败的误导性报错 |
| `POST /u/login` | ✅ | 响应 token 25 字符 |
| `POST /channel` LoadWallpaperReq | ✅ | 100 条/页; 游标分页(上页末条 createdAt)正确 |
| LoadWallpaperReq.comic 过滤 | ✅ | 服务端过滤, 100/100 命中 |
| SearchWallpaperReq | 🔒 | `code=-5 "请先激活高级账户"` —— **搜索是 Pro 付费功能** (账号 isPro=false) |
| RandomWallpaper `Req` / `ComicsReq` | ❌ | `code=-6 "请升级至最新版"` = 服务端不认识该 type_url, **已废弃** (type_url 无误: random_wallpaper.proto 的 message 名就是 Req) |

**图片链路新发现**:
- `pic1.imgdb.cn/i/*.webp` 缩略图 = **302 → `wkphoto.cdn.bcebos.com/*.jpg`(百度 CDN, 实为 jpeg)**;
  目标站防盗链**认 Referer**: 带任何 Referer → 403, 不带 → 200 (imgdb 自身有 `Referrer-Policy: no-referrer` 佐证)。
- `bitiful.cdn.13th.tech` 为 **http**(443 上是网宿共享证书, 域名不匹配); 需浏览器 UA; 原图 `*.a` XOR 解码验证通过 (8MB RIFF/WEBP, riff 长度自洽)。

**Web 版交付**: `web/` (零 npm 依赖, Node≥18; server.js 协议网关 + public/ 单页前端; 详见 `web/README.md`)。
新增工具: `tools/ciyuan_channel_client.py` (协议级客户端: verify/rank/login/feed, 离线签名验证),
`tools/dump_headers.py` (HTTP/2 抓包完整头导出)。
Live 验证数据: `data/ciyuan_channel_page1_live_20261014.json` (100 条实时首页流)。

**Web 瀑布流视觉顺序修复 (2026-10-14)**: 初版前端用 CSS multi-column 做瀑布流 (`columns: 5 280px`),
但多列布局是**列优先**填充 —— 5 列时第 1 列装数据第 1–20 条、第 2 列 21–40 条……首屏横读一行实为第
1/21/41/60/79 条; 且每次 append 新页, 浏览器对全容器重新均衡列高, **已显示的卡片整体跳位**。
APP 为竖向 StaggeredGrid(行优先、每条放入当前最矮列), 两者视觉顺序完全不一致(数据顺序本身一致:
`/channel` 响应 createdAt 严格降序, 请求与真机抓包同构 `LoadWallpaperReq{f1=INT64_MAX, f3=0}`)。
修复: `app.js masonrySpec/buildLayout/placeCard` 自维护 N 列容器(≤900px 2 列, 桌面 2–5 列),
卡高由数据 `width/height` 先算(aspect-ratio 内联, 图加载不回流), 新卡入累计高度最矮列、只追加不重排,
resize 仅列数/列宽变化时按 pool 原序重排。验证(无头浏览器 + stub 注入 live 100 条): 桌面首行=数据
第 1..n 条、100 条各落位一次、列高差 3%; 2 列断点视觉序严格 1,2,3…。空态 `column-span:all` 随之移除。

**字段/经验补充 (同日)**:
- `Wallpaper.pixivId` 为 **string** 字段且语义混杂: 8~9 位纯数字 = pixiv 作品 ID; **32 位 hex = 站外源标识**
  (rank 榜中占比不低)。APP 反编译全源码**无 `pixiv.net` 字符串** —— APP 从不外链 pixiv, 仅作元数据展示与
  `LoadWallpaperReq.pixivId` 站内过滤。Web 版仅对纯数字 ID 生成外链并提示"原作可能已删除/转私有"。
  (顺带修复 server.js 早期把 f4 按 varint 解析、JSON 输出 Buffer 对象的 bug —— 前端曾拼出
  `pixiv.net/artworks/[object Object]` 导致 404。)
- **公开仓库脱敏纪律** (上传 github.com/Violit-Evergarden/reverse-ciyuan 时执行):
  `data/raw_login/` 含**明文账号密码**(req bin)、**明文 token+手机号+邮箱**(resp bin) → **不入库**
  (.gitignore, 仅本地保留); `data/ciyuan_home_channel_req.pb` 与 `data/raw_page2/page2_req_channel.bin`
  中的旧 token 等长替换为 `REDACTED_TOKEN_0123456789` (该两样本的 sg 离线校验随之作废, verify 自动 SKIP);
  `web/secrets.local.json` (账号/SALT/token) 从不跟踪。
  ⚠️ **历史提交 95b4537 已公开包含上述明文** —— 建议用户修改 APP 密码, 或用 git-filter-repo 重写历史后强推。

## 10. 壁纸来源与策展模型分析 (2026-10-14)

统计口径: live 首页 100 条 (`data/ciyuan_channel_page1_live_20261014.json`) + rank 40 条。

- **pixivId 三类语义**: ① 纯数字 = pixiv 作品 ID (live 81 / rank 28); ② `<作品ID>-<页码>` =
  多图投稿的第 N 页 (live 12 / rank 2, 页码自 1); ③ 32hex = 站外源标识 (live 8 / rank 10)。
  → **pixiv 来源占比 ≈ 93/100 (首页流)、30/40 (rank)**。
- **`-N` 页码语义已线上实锤**: `pixivId=141694730-2` ↔ pixiv `/artworks/141694730` 为 2 页投稿 (页面计数 1/2),
  APP author=Ankry 与 pixiv 画师一致; `112019081` ↔ Okkimon 一致。APP 的 tags/characters 比 pixiv 原标签更细
  (策展人补的角色/服饰标签)。
- **author = pixiv 画师; uploader = APP 账号 ID** (Mongo ObjectId 风 24hex 或 32hex), 140 条中 author==uploader
  为 **0** → 全部为转载/导入, 无画师本人投稿。
- **uploader 集中度**: 140 条仅 15 个不同 uploader, 单账号 `5ed707f645e7ff0008317888` 占 **94 条**
  (live 首屏前若干条全属它) → **少数策展/运营账号批量导入**, 非社区 UGC。结合 APP 反编译全无 `pixiv.net`
  字符串: 采集与策展发生在服务端/策展工具链, APP 与 Web 只是元数据消费端; 图片转存自有 CDN
  (imgdb/bcebos/bitiful), 不热链 pixiv。
- **32hex 类 (无 pixiv 来源) 特征**: author/tags 多为空、元数据稀疏; comic 集中于国产 IP (原神/鸣潮/龙族);
  分辨率常为官方壁纸规格 (3840×2160、4096×2748、3296×5120); 与 md5(url/thumbUrl/id/author) 均不匹配 (0/18)
  → 系 APP 后端的**站外源标识** (官方壁纸包/国内平台等), 无后端权限下无法离线解析原始站点。
- **默认流质量高的原因**: 人工策展转载 pixiv 高人气作品 + 元数据增补, 与 pixiv 官方入口无关。
  pixiv 侧对照: 官方排行 `www.pixiv.net/ranking.php` (daily/weekly/monthly/rookie/original/AI 及 R-18 各档)、
  官方策展杂志 **pixivision**、标签搜索+人气顺(premium)/宽高比筛选; **pixiv 无官方"壁纸"垂直站或 tab** ——
  本 APP 实质上即"pixiv 壁纸策展前端" (转存图 + 尺寸元数据 + 站内策展榜)。
- **APP 榜 ≠ pixiv 榜**: `/rank` 为站内指标 4 组 (壁纸/锁屏 × 近7天/总榜), 与 pixiv ranking 无对应关系。
- **策展账号扫描工具**: `tools/curator_scan.py --pages N` 翻页首页流按 uploader 聚合, 产出带 pixiv 链接的
  markdown 报告; 首跑 `data/curator_scan_20261014.md` (20 页/2000 条/120 账号): 头号策展账号
  `5ed707f645e7ff0008317888` 1035 条 (pixiv 源 1020); **618 条老数据 (2025-12-07~2026-07-02) 无 uploader
  字段** (该字段为后期新增), 其余为长尾普通用户 (各 1~38 条)。Web 端详情弹窗「策展账号」chip / 搜索框
  粘贴账号 ID 可在已加载池内过滤其转载。
- **uploader ID → 昵称: 普通客户端不可得** (2026-10-14 实测): dex 消息全表仅 20 个 Req/Rsp, 用户系只有
  `UserManage{GetUserInfoReq/Rsp, DeleteUser*, ForbidUser*}` 与 `Data.UserWallpaper`; `GetUserInfoReq`
  经 `/channel` 实测 **code=-4 无权限**(管理员族, 与 Delete/Forbid 同级); HTTP 侧 `/u/info|get|profile|
  other|wallpaper|list` 均 -2(无此路由); 消息表无任何公开 profile 消息 → APP 自身也不展示上传者昵称。
  **可解码的账号信息**: 24hex ID = Mongo ObjectId, 前 4 字节大端 = 账号创建时间 (`curator_scan.py oid_created`,
  如头号策展号 5ed707f6… = 2020-06-03 注册); 32hex 非 ObjectId 不可解。扫描同时导出
  `data/curator_scan_<day>.json` (按账号聚合的结构化数据)。

## 11. Web 工程 / 部署 / 移动端经验清单 (2026-10-14 夜, 供后续会话/agent 接手)

**架构**: `web/frontend` (React 18 + Vite 5 + TS; 零依赖外部 store `useSyncExternalStore`;
瀑布流=纯函数贪心最短列 `masonry.ts distribute`, 前缀稳定) → 构建 `web/dist`;
`web/server.js` 单端口伺服 (协议网关 + 静态, 零 npm 依赖); 线上 nginx(TLS 复用既有 LE 证书) →
systemd `ciyuan-web` → 127.0.0.1:8787; 入口 **https://www.violet37.cn**。
**门禁**: cookie 会话 180 天 (`secrets.gate`, `POST /gate` 换 cookie; 前端 API 401 自动跳门禁页) ——
不用 nginx Basic Auth: iOS 上 Basic Auth 凭据仅存内存, 杀 Safari/web clip 即失效。
**部署闭环**: `bash tools/web_verify.sh && bash tools/deploy.sh`
(后者读 gitignored `web/deploy.local.json`: ssh 目标/域名/门禁密码; 流程 build→rsync→restart→带 cookie 健康检查)。
一次性初始化 `tools/deploy_init.sh`(幂等; nginx 1.18 需 `listen 443 ssl http2;`)。

**交互模型**: tab=首页/分类/排行; 流视图承载 scope(null|comic 服务端过滤|uploader 池内|search 仅 Pro),
各 scope 独立缓存 {pool,seen,cursor,done} 切换瞬时恢复; 详情=哈希后缀 `/w/<id>`(同文档遍历, 侧滑零重载);
移动端详情=全屏舞台+底部弹层; **手势仅触屏启用** (`pointer:coarse` 门禁), PC 端 ✕/Esc 关闭、右栏常显。

**坑清单 (全部实测根因+修复)**:
- CSS multi-column 列优先 + append 全版重排 → 瀑布流必须最短列贪心; 经典滚动条 ~10px 宽度抖动
  不得作为重排信号 (仅列数/间距变化才重排), 否则每次 append 只剩当批。
- `navigator.share` 必须紧贴用户手势: 现场 fetch 再 share 必失败 (Chrome "Must be handling a user
  gesture" / iOS "request not allowed"); 对策=卡片 pointerdown 预取 + 单飞 in-flight + 点击时 blob 在手
  手势内分享; iOS standalone 无下载 UI, `<a download>` 静默失败, 只能走分享面板。
- 门禁页必须 fetch 提交 + `location.replace`, 原生 form POST 会留历史条目 → 返回手势回密码框。
- `pushState('')` 空 URL 条目在 iOS 侧滑触发整页重载 → 一律用哈希条目。
- `setPointerCapture` 对合成/无效 pointerId 抛 NotFoundError → 整条手势链静默失效, 必须 try/catch。
- 僵尸标签: index `no-cache` 允许同标签复用旧 bundle → index/门禁 `no-store`; assets 内容哈希长缓存。
- 上游 CDN 偶发 200 错误页 (地理/限流, journal 实锤 "XOR 解码失败") → 解码容错 (RIFF/JPEG/PNG 明文直通)
  + 重试一次 + 坏数据绝不入缓存; `/api/img/orig` 按 magic 定 content-type。
- 上游脏数据 `tags:[""]` → 解析层过滤空 tags/characters + 渲染层二次防御。
- 进度回调按请求绑定; 全局单例回调会让上一张在途请求的进度打进新弹窗 (横跳)。
- `origUrl` 等弹窗级状态必须在 `[w]` effect 里重置, 否则背景残留上一张。

**内存/性能**: 原图 blob LRU 384MB 字节上限 (重进详情 57ms 出图); 显示降采样 ≤2048px
(2775×5551 解码位图 ~60MB → ~12MB, 移动端多图不爆内存), 原 blob 仅分享/下载用;
服务端磁盘缓存 1.5GB LRU; 单飞 + abort 旧请求; 缩略图 lazy + 骨架屏。

**验证**: `tools/web_verify.sh` 7 断言 (语法/门禁/API/静态); 布局与手势走 chrome-devtools 无头断言
(emulate viewport + networkConditions; loopback 不受限速, 测进度环需用线上域); 线上健康检查带门禁 cookie。

**凭据纪律**: `web/secrets.local.json` (account/pwd/salt/token/gate) 与 `web/deploy.local.json`
(ssh 目标/域名/gate) 均 gitignored; 服务器端 secrets 600; SSH 仅密钥 (PasswordAuthentication no);
旧服务备份 `/root/old-backup-20261014.tgz`, mihomo 代理保留未动。

### 11.1 部署实战细节 (2026-10-14, 腾讯云轻量上海)
- 控制台自动化不可靠: 腾讯云 console SPA 在无头浏览器里启动 40–75s 且随机失败; **正路是 ssh**。
  无 SSH 凭据时的一次性注入流程: 控制台重置密码(在线重置不关机) → `expect` 跑一次
  `ssh + sudo` 把开发机 `id_ed25519.pub` 写进 ubuntu/root 的 `authorized_keys` → 之后全程密钥直连;
  注入完成立即 `PasswordAuthentication no` 废止临时密码。
- 旧服务清理纪律: 先 `tar czf /root/old-backup-<date>.tgz` 再停删(systemd disable --now /
  pm2 delete + save / 摘 nginx sites-enabled); 用途不明的常驻进程(如 mihomo)**默认保留**, 清单给用户确认。
- nginx 1.18 (Ubuntu 22.04 默认) 不认独立 `http2 on;` 指令 → 必须 `listen 443 ssl http2;`。
- 已有 Let's Encrypt 证书时直接复用 `/etc/letsencrypt/live/<域>/`(certbot 续期链不动); 无证书才走
  `certbot --nginx` 新签; ACME challenge 路径要 `auth_basic off`。
- 健康检查/脚本访问带门禁站点: `curl -c jar -d code=<gate> https://<域>/gate` 换 cookie 后 `-b jar`。
- **mihomo(Clash)共存确认**: 仅 loopback 监听、无 tun 段/无 tun 设备/无代理环境变量/出口 IP=自身公网 IP →
  本站流量直连不经代理; Node 原生 http/https 不读 proxy 环境变量, 双重保险。若未来误开 TUN:
  `ip link | grep tun` + config `tun:` 段确认 → `tun.enable:false` 或对上游域名加 DIRECT 规则 → restart mihomo。
- **fetch + FormData 默认发 multipart/form-data**: 服务端若只按 urlencoded 解析
  (`new URLSearchParams(body)`) 会取不到字段 → 表单"密码永远错误"。门禁页曾因此全浏览器端 401
  (验证只覆盖了 curl/urlencoded 与手搓 URLSearchParams, 漏了真实页面路径)。
  修复双保险: 客户端改 `new URLSearchParams(new FormData(form))`; 服务端按 content-type
  兼容解析 multipart。**教训: 表单类接口必须用真实页面路径做端到端验证, 不能只测 API 形状。**
- 无头验证注意: CDP 网络限速**不作用于 loopback**, 测加载进度环等慢路径要用线上域名;
  `resize_page` 在窗口被系统夹小时失真, 用 `emulate viewport` 更可靠; 合成 PointerEvent 的
  `setPointerCapture` 会抛 NotFoundError(代码已 try/catch, 写测试时无需处理)。
