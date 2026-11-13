/**
 * In-app navigation guard (issue #24). Only same-origin absolute paths pass:
 * "/vakalar/x" is fine; "//evil.com", "/\\evil.com", "https://…", "javascript:…" fall back.
 * React Router 6.30 still has a moderate open-redirect via backslash (fixed only in v7),
 * so paths that come from data (notification links, rewritten URLs) go through this.
 */
export function safeInternalPath(path: string | null | undefined, fallback = '/'): string {
  if (!path) return fallback
  const p = path.trim()
  if (!p.startsWith('/')) return fallback
  // Protocol-relative or backslash tricks: browsers treat "\" like "/" in URLs.
  if (p.startsWith('//') || p.startsWith('/\\')) return fallback
  if (p.includes('\\')) return fallback
  // Control characters (tabs/newlines are stripped by URL parsers and can hide "//").
  if (/[\u0000-\u001f]/.test(p)) return fallback
  return p
}
