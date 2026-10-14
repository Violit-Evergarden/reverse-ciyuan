# CLAUDE.md — 次元壁纸逆向项目(每次会话必读)

本目录是「次元壁纸」(me.alzz.awsl,用户自己的 App)逆向/抓包项目的**唯一成果目录**。
git remote:`https://github.com/Violit-Evergarden/reverse-ciyuan`(main)。

## 会话开始先读
1. `HANDOFF.md` — 接手交接:项目是什么、已完成/待办、标准抓取流程、关键坑、环境重建。
2. `README.md` — 索引 + 核心结论速查 + 快速上手命令。
3. `docs/ciyuan_reverse_engineering_report.md` — 全部细节(方法论/字段映射/经验清单)。

## 硬性约定
- **所有新成果/经验/示例数据都写回本目录**(docs/ tools/ data/ samples/),并更新 README 与报告,然后 `git commit`(push 前确认无凭据)。
- **凭据(密码/token/手机号/邮箱)一律不入库**;需要登录态向用户索取。
- 抓包方法:Frida **16.7.19**(17.x Java bridge 坏)hook Conscrypt 明文字节流;App 绕过系统代理,勿用 mitm 代理模式。
- 环境重建:`bash tools/setup_env.sh`;解析:`tools/parse_http2.py`、`tools/parse_proto.py`;原图解码:`tools/ciyuan_decode_url.py`。

## 核心结论速查
- `POST /channel`(protobuf,token=顶层 f2)首页/列表;游标分页:内层 f1=上一页最后一条 createdAt(ms),首页 INT64_MAX,每页 100 条。
- `GET /rank?token=` 未登录可用的排行 JSON;`GET /i/*.webp` 缩略图(下滑懒加载=客户端行为)。
- 原图 `*.a`=单字节 XOR webp,`key=raw[0]^0x52`;bitiful CDN 需浏览器 UA 否则 403。
