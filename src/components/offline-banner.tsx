import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { useDict } from '../lib/i18n'

export function OfflineBanner() {
  const d = useDict()
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const handleOnline  = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (online) return null

  return (
    <div className="flex items-center justify-center gap-2 bg-red-950 border-b border-red-800 px-4 py-2 text-sm text-red-300">
      <WifiOff className="size-4 shrink-0" />
      <span>
        {d.layout.offlineBanner.message}
      </span>
    </div>
  )
}
