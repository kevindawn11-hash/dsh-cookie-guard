# dsh-cookie-guard

A tiny fix for **DeepSeek Harness Desktop**: it caps the lifetime of the desktop
browser-session cookies (`dsh-auth-*`) from the default 30 days to 7 days, so
stale cookies can no longer pile up and overflow the request header — a failure
that prevents the app from starting at all.

- Declarative bundle patch only; no runtime code, no changes to the installed app,
  no Electron main-process hacks.
- Survives app updates (it lives in your profile, not in `app.asar`).
- Ships a standalone cleanup script for machines that are already stuck.

## Symptom

At launch the app shows:

```
DeepSeek Harness is unavailable
The application could not start or stopped unexpectedly.
```

The diagnostic report (`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-host.log`)
contains either:

```
desktop welcome: Web authentication failed
```

or the host logs an `HTTP 431` (Request Header Fields Too Large).

## Root cause

Not an account, network or plugin issue — it is unbounded cookie growth:

1. `@deepseek-ai/dsh-client-connection` names its cookie
   `"dsh-auth-" + sha256(host:port)` — one cookie per authority, port included.
2. The Desktop Host always launches with `--port 0` (`main()` in
   `dsh-desktop-host`), so every start gets a new random port.
3. Cookies default to `cookieMaxAgeDays: 30` and nothing ever prunes them.
4. The Electron welcome page fetches with Chromium `net.fetch`, which sends
   **every** historical `dsh-auth-*` cookie in one `Cookie` header.
5. Node's `maxHeaderSize` defaults to 16 KB; one cookie is ≈200 B, so
   **~90 cookies overflow the header**, the Host answers 431 and Electron throws
   `desktop welcome: Web authentication failed`.

Measured: 71 cookies (~12 KB) accumulated in 13 days were enough to reproduce.
At 3–5 launches/day, **any long-term desktop user hits this within a month**.
Web mode uses a fixed port and is unaffected — this is desktop-only, present in
both `0.2.1-rc.3` and `rc.5`.

## Install

### Option 1 — marketplace

Install `dsh-cookie-guard` from the DSH plugin marketplace, then restart the app.

### Option 2 — manual profile install

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add dsh-cookie-guard
```

Append `"dsh-cookie-guard"` to `dsh.profile.bundles` in the same `package.json`,
then restart DeepSeek Harness.

### Option 3 — cleanup only, no plugin

With DSH fully closed:

```powershell
node tools/prune-cookies.mjs
```

The script backs up `Network\Cookies`, then deletes every `dsh-auth-*` row.
The next launch issues a fresh cookie and the app recovers.

## How it works

The package is just a bundle patch:

```yaml
- id: connection
  config:
    cookieMaxAgeDays: 7
```

DSH applies bundle patches after `@deepseek-ai/dsh-web-app`, so this overrides the
`connection` node's config. A 7-day lifetime means at most "launches in 7 days"
cookies (< 35, ~7 KB), far from the 16 KB ceiling, while still covering sessions
that stay open for a week.

Use `1` for a tighter cap (daily restarts, but sessions older than a day expire);
increase it if you keep the app open longer.

## Verify

After a restart:

```powershell
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.APPDATA+'\\@deepseek-ai\\dsh-desktop\\Network\\Cookies');console.log(db.prepare(\"select name,expires_utc from cookies where name like 'dsh-auth-%'\").all())"
```

Chromium timestamps are microseconds since 1601.

## Limitations

A plugin runs inside the Host process; it cannot read or delete the Electron
main process's Chromium cookie store (exclusively locked at runtime). So a plugin
can only cap growth, not clean history. A real fix belongs upstream — two minimal
options are in [docs/upstream-issue.md](docs/upstream-issue.md):

1. Electron main: remove stale `dsh-auth-*` cookies before `host.start()`;
2. Connection service: name the cookie by host hash (`127.0.0.1`) so each start
   overwrites the same cookie instead of adding one.

## Compatibility

| DSH Desktop | Status |
| --- | --- |
| 0.2.1-rc.3 | reproduces, patch works |
| 0.2.1-rc.5 | reproduces, patch works |

Desktop (packaged Windows/macOS) only; CLI / `dsh web` is unaffected.

## License

MIT
