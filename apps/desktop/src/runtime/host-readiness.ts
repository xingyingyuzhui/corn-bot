/** Internal authentication URL: never return it to Renderer or write it to logs. */
export function validateLaunchUrl(input: string): URL {
  const url = new URL(input)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    !url.searchParams.get('token') ||
    url.hash
  )
    throw new Error('DSH supplied an invalid loopback authentication URL')
  return url
}

export function parseReadinessLine(line: string): URL | undefined {
  const match = /^dsh web: (http:\/\/\S+)/u.exec(line)
  return match?.[1] === undefined ? undefined : validateLaunchUrl(match[1])
}

export function redactHostDiagnostic(value: string): string {
  return value
    .replace(/([?&]token=)[^\s&]+/gu, '$1[redacted]')
    .replace(/(dsh-auth-[^=\s]+)=([^;\s]+)/gu, '$1=[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/gu, '[redacted]')
}
