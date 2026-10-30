# dsh-cookie-guard

[![npm](https://img.shields.io/npm/v/dsh-cookie-guard)](https://www.npmjs.com/package/dsh-cookie-guard)
[![license](https://img.shields.io/npm/l/dsh-cookie-guard)](LICENSE)

一个针对 **DeepSeek Harness Desktop** 的轻量修复包：把桌面端浏览器会话 cookie
（`dsh-auth-*`）的生命周期从默认 30 天收敛到 7 天，避免历史 cookie 无限累积后
把请求头撑爆，导致应用启动失败。

- 纯配置型 bundle patch，无运行时逻辑，不改 DSH 安装文件，不碰 Electron 主进程。
- 随 DSH 版本升级自动生效（升级不会覆盖你的 profile 配置）。
- 附带一个独立的 cookie 清理脚本，用于已经"卡死"的机器。

## 症状

启动时弹出：

```
DeepSeek Harness is unavailable
The application could not start or stopped unexpectedly.
```

诊断日志（`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-host.log`）里是：

```
desktop welcome: Web authentication failed
```

或主进程日志出现 `HTTP 431`（Request Header Fields Too Large）。

## 根因

这不是账号、网络或插件问题，而是 cookie 只增不减：

1. `@deepseek-ai/dsh-client-connection` 的 cookie 名是
   `"dsh-auth-" + sha256(host:port)`，即**每种 authority（含端口）一条 cookie**。
2. Desktop Host 固定用 `--port 0` 启动（`dsh-desktop-host` 的 `main()` 参数），
   每次启动都是新的随机端口。
3. cookie 默认 `cookieMaxAgeDays: 30`，且代码里**没有任何清理逻辑**。
4. Electron 主进程欢迎页用 Chromium `net.fetch` 携带整个 cookie 罐，
   **所有历史端口**的 `dsh-auth-*` 都会被塞进同一个 `Cookie` 头。
5. Node 端 `maxHeaderSize` 默认 16 KB；单条 cookie ≈ 200 B，
   **约 90 条即溢出**，Host 直接 431，Electron 抛
   `desktop welcome: Web authentication failed`。

实测：13 天残留 71 条（约 12 KB），已能稳定复现。按每天启动 3~5 次估算，
**任何长期使用的桌面端用户在一个月内都会踩中**。Web 模式用固定端口，不受影响，
所以这是桌面端专属缺陷（`0.2.1-rc.3` 与 `rc.5` 均存在）。

## 安装

需要 Node.js >= 22，以及自带 desktop profile 的 DSH 版本（`0.2.1-rc.3` 及以后）。

### 方式一：一条命令（推荐）

```sh
dsh plugin --profile desktop add dsh-cookie-guard
```

执行后重启 DeepSeek Harness。社区插件市场（[dsh-plugin.org](https://dsh-plugin.org)、
`dsh-market`）走的是同一条安装路径。

### 方式二：从源码安装

```sh
dsh plugin --profile desktop add github:kevindawn11-hash/dsh-cookie-guard
```

### 方式三：手动加入 profile

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add dsh-cookie-guard
```

然后在同目录 `package.json` 的 `dsh.profile.bundles` 末尾追加 `"dsh-cookie-guard"`，
重启 DeepSeek Harness。

### 方式四：只清理，不装插件

完全退出 DSH 后：

```powershell
node tools/prune-cookies.mjs
```

脚本会自动备份 `Network\Cookies`，再删除全部 `dsh-auth-*` 记录。
下次启动会重新签发一条新的 cookie，应用即可恢复。

## 原理

本包只有一个 `cordis.patch.yml`：

```yaml
- id: connection
  config:
    cookieMaxAgeDays: 7
```

DSH 的 bundle patch 层在 `@deepseek-ai/dsh-web-app` 之后应用，直接覆盖
`connection` 节点的配置。7 天生命周期意味着稳态下最多只有"7 天内启动次数"条
cookie（通常 < 35 条，约 7 KB），远离 16 KB 上限，同时仍能覆盖"整周不关机"的
常驻会话。

想更激进可改成 `1`（适合每天都会重启的用户，但应用连续运行超过 1 天会掉会话）；
反之可调大。

## 验证

重启后确认新 cookie 的过期时间约为 7 天后：

```powershell
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.APPDATA+'\\@deepseek-ai\\dsh-desktop\\Network\\Cookies');console.log(db.prepare(\"select name,expires_utc from cookies where name like 'dsh-auth-%'\").all())"
```

（Chromium 时间戳为 1601 纪元，微秒。）

## 局限

插件跑在 Host 进程里，**读不到也删不掉 Electron 主进程的 Chromium cookie 库**
（运行时被独占锁），所以插件只能"限制增长"，不能"清理历史"。
真正的根治需要上游改动，两种最小方案见 [docs/upstream-issue.md](docs/upstream-issue.md)：

1. Electron 主进程在 `host.start()` 前清理旧 `dsh-auth-*`（一次 `cookies.remove` 循环）；
2. 连接服务把 cookie 名改为按 host 哈希（`127.0.0.1`），每次启动覆盖同一条。

## 兼容性

| DSH Desktop | 状态 |
| --- | --- |
| 0.2.1-rc.3 | 复现，patch 生效 |
| 0.2.1-rc.5 | 复现，patch 生效 |

仅桌面端（Windows/macOS 打包版）；CLI / `dsh web` 不需要。

## License

MIT
