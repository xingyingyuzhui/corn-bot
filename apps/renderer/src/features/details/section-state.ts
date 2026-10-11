/**
 * Read state of one management section. An unconnected section says so
 * instead of showing an empty list or a zero count.
 */
export type SectionState =
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty'; readonly text: string }
  | { readonly kind: 'error'; readonly reason: string }

export type ManagedSection =
  | 'workspace'
  | 'routines'
  | 'identity'
  | 'skills'
  | 'artifacts'
  | 'memory'

/** Section states for one Bot; M1 binds a fixture, M2 a Main-backed read. */
export type SectionSource = (
  botId: string,
  section: ManagedSection,
) => SectionState
