import { validateLaunchUrl } from './host-readiness.ts'

/** Node-only secret-bearing handle. No serialization or renderer access. */
export class HostAuth {
  readonly origin: string
  #cookie: string

  private constructor(origin: string, cookie: string) {
    this.origin = origin
    this.#cookie = cookie
  }

  static async exchange(input: URL): Promise<HostAuth> {
    const url = validateLaunchUrl(input.href)
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    const cookie = response.headers
      .getSetCookie()
      .find((item) => item.startsWith('dsh-auth-'))
      ?.split(';')[0]
    if (
      response.status !== 303 ||
      !cookie ||
      response.headers.get('location') !== './'
    ) {
      throw new Error('DSH launch-token exchange failed')
    }
    return new HostAuth(url.origin, cookie)
  }

  headers(): Record<string, string> {
    return { Cookie: this.#cookie }
  }

  url(path: string): URL {
    if (
      !path.startsWith('/api/') ||
      path.startsWith('//') ||
      path.includes('?') ||
      path.includes('#')
    )
      throw new Error('Only Host API paths are allowed')
    const url = new URL(path, this.origin)
    if (url.origin !== this.origin || !url.pathname.startsWith('/api/'))
      throw new Error('Invalid Host API path')
    return url
  }
}
