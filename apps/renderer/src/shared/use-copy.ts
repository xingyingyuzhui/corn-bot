import { useNotice } from './notice.tsx'

/**
 * Copies text and announces "已复制". On failure it announces `failure` when
 * given; callers that show the error inline pass nothing and use the result.
 */
export function useCopy() {
  const notify = useNotice()
  return async (text: string, failure?: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      if (failure) notify(failure)
      return false
    }
    notify('已复制')
    return true
  }
}
