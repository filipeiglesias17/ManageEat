import { useState } from 'react'
import { Modal, ModalHeader } from './modal'
import { Button } from '@/components/ui/button'
import type { Order } from '../@types/order'
import { CANCEL_REASON_PRESETS } from '../lib/order-cancel'
import { safeQuantity, safeItemName } from '../lib/order-utils'

interface Props {
  // Pedido a cancelar (mostramos os itens no cabeçalho para confirmação).
  order: Order
  tableNumber: number
  // A escrita do cancelamento vive no componente pai (regista o autor/refresca a
  // lista). Aqui só pedimos a confirmação + motivo e devolvemos o motivo.
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
}

// Modal partilhado de cancelamento de um pedido (motivo obrigatório, com presets
// rápidos). Usado pelo painel da mesa e pelo fecho de conta — uma só fonte para
// a UI e a validação não divergirem.
export function CancelOrderModal({ order, tableNumber, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handleClose() {
    // Não deixar fechar a meio da gravação para o utilizador não ficar na dúvida.
    if (submitting) return
    onClose()
  }

  async function handleConfirm() {
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('Indica o motivo do cancelamento.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onConfirm(trimmed)
      // Sucesso: fecha o modal. O pai limpa o estado e atualiza a lista.
      onClose()
    } catch (err) {
      setError(`Não foi possível cancelar: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal onClose={handleClose} maxWidth="max-w-md" aria-labelledby="cancel-order-title">
      <ModalHeader
        title={`Cancelar pedido — Mesa ${tableNumber}`}
        titleId="cancel-order-title"
        closeDisabled={submitting}
      />
      {/* Itens do pedido colados ao título (o -mt compensa o mb-4 do header)
          para o staff confirmar o que vai cancelar. */}
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        {order.items.map((i) => `${safeQuantity(i.quantity)}× ${safeItemName(i.menuItemName)}`).join(', ')}
      </p>

      <div className="space-y-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="cancel-order-reason" className="text-sm text-muted-foreground">Motivo do cancelamento</label>
          <div className="flex flex-wrap gap-2">
            {CANCEL_REASON_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => { setReason(preset); setError('') }}
                className={`rounded-full border px-3 py-1 text-xs transition-colors cursor-pointer ${reason === preset ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted-foreground hover:bg-accent'}`}
              >
                {preset}
              </button>
            ))}
          </div>
          <textarea
            id="cancel-order-reason"
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError('') }}
            rows={3}
            maxLength={500}
            placeholder="Escreve o motivo ou escolhe um acima…"
            className="resize-none rounded-lg border border-input bg-background px-3 py-2 text-base sm:text-sm text-foreground outline-none focus:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" size="lg" onClick={handleClose} disabled={submitting}>
            Voltar
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="lg"
            onClick={handleConfirm}
            disabled={submitting || !reason.trim()}
          >
            {submitting ? 'A cancelar…' : 'Confirmar cancelamento'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
