# 上游 issue 草稿

> 目标仓库：DeepSeek Harness（`@deepseek-ai/dsh-desktop` / `@deepseek-ai/dsh-client-connection`）
> 标题：Desktop startup fails with HTTP 431 after enough launches — `dsh-auth-*` cookies accumulate per random port and are never pruned

## Environment

- DSH Desktop 0.2.1-rc.5 (also reproduced on 0.2.1-rc.3), Windows 11 x64, Electron 44.7.0, Node 24.21.0
- Channel: nightly

## Steps to reproduce

重复冷启动桌面端即可，无需任何插件或特殊配置：

1. 每天正常打开/关闭应用若干次（实测 13 天 ≈ 71 次）。
2. 再次启动时弹出 `The application could not start or stopped unexpectedly.`
3. `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-host.log` 中：
   `desktop welcome: Web authentication failed`，并且 Node 端返回 **431**。

## Analysis

- `client-connection` 的 cookie 名：`"dsh-auth-" + base64url(sha256(authority))`，
  `authority` 为 `host:port`（`cookieName(authority)`），所以**端口变化就产生一条新 cookie**。
- `dsh-desktop-host` 的 `main()` 固定传 `--port 0`，每次启动端口随机。
- cookie `Max-Age` 默认 `cookieMaxAgeDays = 30`，全链路没有清理。
- Electron 欢迎页 `connectDesktopWelcome` 使用 `net.fetch(..., { credentials: "include" })`，
  Chromium 会把**该源的所有历史 cookie**（每个旧端口一条）都放进同一个 `Cookie` 头。
- Node 默认 `maxHeaderSize = 16 KB`，单条 cookie ≈ 200 B → 约 90 条即超限，
  请求在进入连接服务之前就被 HTTP 解析器拒绝（431）。

实测数据：71 条 `dsh-auth-*`（≈12.2 KB）已可稳定复现；`Network\Cookies` 里可见
每条 cookie 的 `host_key = 127.0.0.1`，payload 中的 `authority` 各不相同。

## Suggested fixes（任选其一）

1. **Electron 主进程启动前清理（最小改动，推荐）**

   在 `DesktopHostProcess.start()`（实际是 shell 的 `start()`）里，`host.start()` 之前：

   ```js
   const stale = (await session.defaultSession.cookies.get({}))
     .filter((c) => c.name.startsWith("dsh-auth-"));
   await Promise.all(stale.map((c) =>
     session.defaultSession.cookies.remove(
       `http://${c.domain || "127.0.0.1"}${c.path}`, c.name).catch(() => {})));
   ```

   每次启动都会由 launch URL 重新签发一条，清理旧的无副作用。

2. **cookie 名按 host 而不是 authority**

   `cookieName()` 改为按 `host` 哈希，并把 `authority` 放进签名 payload 校验。
   这样每次启动覆盖同一条 cookie，数量恒定。

3. **兜底**：`dsh-host-webserver` 创建 server 时显式
   `createServer({ maxHeaderSize: 512 * 1024 })`，避免任何头部异常直接打死启动。

## Impact

所有长期使用桌面端的用户（每天 ≥3 次启动）在一个月内必然触发；表现为"应用打不开"，
且报错信息（`Web authentication failed`）与真实原因（431）不一致，用户几乎无法自救。
Web 模式因端口固定不受影响。

## Workaround

见 `dsh-cookie-guard`：bundle patch 把 `connection.cookieMaxAgeDays` 收敛到 7 天，
并提供一次性清理 `Network\Cookies` 中 `dsh-auth-*` 的脚本。
