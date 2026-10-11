/**
 * Development-only fixture routes, selected with `#fixture=<name>` on the
 * Vite dev server. Production builds always use the default fixture, so
 * demo-only states (voice, failed sends) can never appear in the app.
 */
export const FIXTURE_ROUTES = ['default', 'ui-states'] as const
export type FixtureRoute = (typeof FIXTURE_ROUTES)[number]

export function parseFixtureRoute(hash: string, dev: boolean): FixtureRoute {
  if (!dev) return 'default'
  const name = new URLSearchParams(hash.replace(/^#/u, '')).get('fixture')
  return FIXTURE_ROUTES.find((route) => route === name) ?? 'default'
}
