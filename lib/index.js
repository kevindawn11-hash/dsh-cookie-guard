/**
 * dsh-cookie-guard
 *
 * 这个包没有任何运行时逻辑：真正的修复是声明式的，写在 cordis.patch.yml 里，
 * 由 DSH 的 bundle patch 机制在 `@deepseek-ai/dsh-web-app` 之后覆盖
 * `connection.cookieMaxAgeDays`。
 *
 * 保留一个合法的 cordis 插件入口，是为了让包本身可被加载、出现在 loader 日志里，
 * 方便用户确认"插件已生效"。
 */

export const name = 'dsh-cookie-guard'

export const inject = []

/**
 * Cordis apply 入口。故意保持空操作：不注册服务、不注入渲染层、
 * 不改动任何 DSH 内部对象。
 */
export function apply(ctx) {
  ctx?.logger?.('cookie-guard')?.info?.(
    'dsh-cookie-guard loaded: connection.cookieMaxAgeDays capped via bundle patch',
  )
}
