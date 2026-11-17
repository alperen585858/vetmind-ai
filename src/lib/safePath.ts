/**
 * In-app navigation guard (issue #24). Only same-origin absolute paths pass:
 * "/vakalar/x" is fine; "//evil.com", "/\\evil.com", "https://…", "javascript:…" fall back.
 * React Router v7 fixed the backslash open-redirect; keep this for data-driven paths
 * (notification links, rewritten URLs) so untrusted strings never reach navigate/Link.
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
