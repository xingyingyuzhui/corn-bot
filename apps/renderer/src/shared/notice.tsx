import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import './notice.css'

const NOTICE_MS = 2_400

const NoticeContext = createContext<(message: string) => void>(() => {})

export function useNotice(): (message: string) => void {
  return useContext(NoticeContext)
}

/** One polite live region for short, non-blocking explanations. */
export function NoticeProvider({ children }: { readonly children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback((next: string) => {
    clearTimeout(timer.current)
    setMessage(next)
    timer.current = setTimeout(() => setMessage(null), NOTICE_MS)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <NoticeContext.Provider value={show}>
      {children}
      <div className="corn-notice" role="status" aria-live="polite">
        {message ? (
          <span className="corn-notice__bubble">{message}</span>
        ) : null}
      </div>
    </NoticeContext.Provider>
  )
}
