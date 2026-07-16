import { useState } from 'react'
import { Download, Loader2, AlertTriangle } from 'lucide-react'
import { useAppUpdate, applyUpdateNow, checkForUpdate } from '../lib/ota'
import { useDict } from '../lib/i18n'

// Aviso de atualização da app. Dois estados:
//  - pending: há um bundle descarregado e pronto (aplica-se sozinho ao reabrir;
//    o botão deixa aplicar já com reload imediato).
//  - lastError sem pending: a última tentativa de OTA falhou — mostramos para
//    o staff não ficar sem saber porquê, com um "tentar de novo".
export function UpdateBanner() {
  const d = useDict()
  const { pending, lastError } = useAppUpdate()
  const [applying, setApplying] = useState(false)

  if (!pending && !lastError) return null

  async function handleApply() {
    setApplying(true)
    // applyUpdateNow recarrega a WebView — se chegar aqui de volta é porque falhou.
    await applyUpdateNow().catch(() => setApplying(false))
  }

  // Erro sem bundle pronto: avisar e deixar tentar de novo (não bloqueia nada).
  // flex-wrap: em ecrã estreito o botão desce para baixo do texto, centrado, em
  // vez de transbordar a barra.
  if (!pending) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 text-sm text-amber-400">
        <span className="inline-flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" />
          {d.layout.updateBanner.fetchFailed}
        </span>
        <button
          onClick={() => { checkForUpdate() }}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 px-3 py-1.5 text-xs font-semibold transition-colors active:scale-95 cursor-pointer"
        >
          {d.common.retry}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 bg-brand/10 border-b border-brand/20 px-4 py-2.5 text-sm text-brand">
      <span className="inline-flex items-center gap-2">
        <Download className="size-4 shrink-0" />
        {d.layout.updateBanner.available}
      </span>
      <button
        onClick={handleApply}
        disabled={applying}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand/20 hover:bg-brand/30 px-3 py-1.5 text-xs font-semibold transition-colors active:scale-95 cursor-pointer disabled:opacity-60"
      >
        {applying ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {d.layout.updateBanner.applyNow}
      </button>
    </div>
  )
}
