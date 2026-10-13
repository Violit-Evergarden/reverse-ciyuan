# HANDOFF — 给接手 agent 的交接文档

> 读我之后请再读 `README.md`(索引/速查)与 `docs/ciyuan_reverse_engineering_report.md`(全部细节)。
> 本目录 `/Users/qiaoyuan/Desktop/project/reverse`(或克隆后的路径)是唯一事实源;**所有新成果/经验都更新在本目录**,不要散落到 /tmp。

## 项目是什么
对用户**自己的** App「次元壁纸」(`me.alzz.awsl`, v2.11.5)做授权逆向/抓包,产出网页版可用的数据源与协议文档。
方法:Android 模拟器 + **Frida 16.7.19** spawn-gate/attach,hook **Conscrypt 明文字节流**
(`ConscryptEngineSocket$SSLOutputStream.write` / `$SSLInputStream.read`),dump TLS 解密后的 HTTP/2 明文。
**不用 mitm 代理**:App 的 API 代码级绕过系统代理直连;mitmproxy 在 macOS 的 transparent 模式不处理直连。

## 当前进度(已完成)
1. 未登录:`GET /rank?token=` → JSON,4 组×10 张(`data/ciyuan_rank.json`)。
2. 登录:`POST /u/login`(form)→ JSON 带 token(`data/ciyuan_login_resp.json`)。
3. 登录后首页:`POST /channel`(protobuf,token 在顶层 f2)→ `LoadWallpaperRsp`,100 条/页
   (`data/ciyuan_home_channel_req.pb` / `_resp.pb`)。
4. 分页:游标分页,内层 `LoadWallpaperReq.f1` = 上一页最后一条 createdAt(ms),首页 INT64_MAX;
   响应不带 next-cursor。下滑缩略图懒加载=客户端 `/i/*.webp`,无列表接口。
5. 原图混淆:`wallpaper.url` 的 `*.a` = 整文件单字节 XOR 的 webp,`key = raw[0]^0x52`;
   bitiful CDN 需浏览器 UA 否则 403。解码工具 `tools/ciyuan_decode_url.py`。
6. 工具:`tools/parse_http2.py`(帧+HPACK+抽 body)、`tools/parse_proto.py`(wire 打印,`--path` 下钻)、
   `tools/frida/*`(hook+控制器)。

## 2026-10-14 会话新增进展 (Windows)
1. **签名算法完全复现** ✅:`sign(x)=md5hex(md5hex(SALT+x))`(libhell.so 未剥符号+带 DWARF,
   capstone 反汇编 `native_sign`@0x25164 直接读出:反hook检测→SALT前插→双重MD5)。
   SALT 32B 字面量在 .rodata 0x166ce,由 `_GLOBAL__sub_I_*` 构造到 .bss `_ZL4SALT`。
   HTTP 路径 input=排序去重 `k=v`(query/form+t) 以 `&` 连接;/channel 路径 input=hex(去 sg 序列化)。
   仓库内 5 组抓包样本全部离线验证通过。**SALT 字面量不入仓库**,在 `web/secrets.local.json`。
2. **协议级客户端** `tools/ciyuan_channel_client.py`:无需 App/模拟器直接调 API(verify/rank/login/feed)。
3. **实测矩阵**:rank✅ login✅ channel✅ 分页✅ comic服务端过滤✅;**搜索=Pro付费墙(-5)**;
   随机/漫画源已废弃(-6 "请升级至最新版"=type_url 未知;缺 HTTP sign 也报这个误导文案,注意区分)。
4. **网页版交付** `web/`:零 npm 依赖(Node≥18)。server.js=协议网关(sign/protobuf/token自动重登/
   图片代理:XOR原图解码+缩略图无Referer防盗链),public/=瀑布流单页(发现/作品/排行/详情原图/本地搜索/R16开关)。
   启动 `node web/server.js` → http://127.0.0.1:8787。
5. 图片链路新知:imgdb 缩略图 302→百度 bcebos(实为 jpeg,**带 Referer 403**);bitiful 为 http(443 证书不匹配)。
6. 新工具:`tools/dump_headers.py`(HTTP/2 完整头导出——发现 /rank /u/login 需要 t+sign 头的关键)。
7. **pixivId 语义**:string 字段,混杂数字 ID 与 32hex 站外标识;APP 无 pixiv 外链;web 仅纯数字外链(见报告 §9)。
8. **公开仓库上传+脱敏**(github.com/Violit-Evergarden/reverse-ciyuan):raw_login 不入库、token 等长打码、
   secrets 不跟踪(见报告 §9 脱敏纪律)。**本仓库唯一事实源自 2026-10-14 起为 `D:\MyFiles\reverse\reverse-ciyuan-main`**。

## 待办 / 可继续的方向
- ~~用 token 做协议级复现~~ ✅ 已完成(见上);~~签名(f8)复现~~ ✅ 已完成。
- 搜索接口需 Pro 账户,现 Web 版为本地过滤;若购入 Pro 可直接启用 SearchWallpaperReq(字段号已备好,报告 §8.4)。
- 更多接口(下载计数上报 Download、用户数据 Data/UserManage)未实测,type_url 命名已从 proto 类确认,按需接入。
- token 失效策略:web 服务端已自动重登;长期不活 token 过期时间未知,失效时自动兜底。
- 如需更多接口:spawn-gate 抓取 + 对应 UI 操作(坐标见下)。

## 环境重建(另一台电脑)
运行 `tools/setup_env.sh`(或按其步骤手动):venv(frida==16.7.19)+ frida-server + AVD + 可写 system +
系统 CA + frida 启动。**关键坑**:frida 必须 16.x(17.x Java bridge 坏);系统 CA 必须开机前落盘+重启;
attach 用 PID;底部 tab 自绘,uiautomator 不可靠,排行≈(160,610)、发现≈(53,610)(320×640 屏)。

## 抓取一条新接口的标准流程
1. `python3 tools/frida/spawn_dump_ctl.py tools/frida/dump4.js <秒> <前缀>`(spawn-gate,拿完整连接 preface)。
2. 用 `adb shell input tap/swipe` 操作 UI 触发目标接口;每步后截图确认界面。
3. `python3 tools/parse_http2.py /tmp/<前缀>_req_c<cid>.bin out/` 解头+body;protobuf 用 `parse_proto.py`。
4. 结果归档到 `data/`(raw_<场景>/ + 解析产物),经验写入报告与 README。

## 账号(凭据不入库)
登录凭据**不写入本仓库**(公开库风险)。需要时向用户索取;登录接口与 token 位置见报告 §5。
历史 token 样例已脱敏;真实 token 过期后重新登录抓取即可。
