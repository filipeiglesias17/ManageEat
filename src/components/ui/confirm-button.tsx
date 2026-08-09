import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { ButtonVariantProps } from '@/components/ui/button-variants'
import { useDict } from '../../lib/i18n'

// Botão de ação com confirmação inline (ver shift-status-bar.tsx):
// no WebView nativo o confirm() do browser fica feio e inconsistente, por
// isso trocamos por um 2º passo dentro da própria UI.
//
// Uso: o pai controla `confirming` (normalmente com o hook useConfirmingId,
// que trata do caso "várias linhas numa tabela" — cada linha só entra em
// confirmação por causa do seu próprio id, nunca todas ao mesmo tempo).
//
// - 1º clique -> chama onRequestConfirm (o pai marca esta linha como "a confirmar").
// - Enquanto confirming=true, mostra "Cancelar" + o botão de confirmação.
// - 2º clique (no botão de confirmação) -> chama onConfirm.
type ConfirmButtonProps = {
  confirming: boolean
  onRequestConfirm: () => void
  onConfirm: () => void
  onCancel: () => void
  disabled?: boolean
  // Aparência do botão "gatilho" (visível quando confirming=false).
  triggerIcon: ReactNode
  triggerLabel: string
  triggerTitle?: string
  triggerClassName?: string
  // Aparência do botão de confirmação (visível quando confirming=true).
  confirmIcon?: ReactNode
  confirmLabel?: string
  confirmTitle?: string
  confirmClassName?: string
  // Aviso curto e VISÍVEL ao lado dos botões durante a confirmação. Ao
  // contrário do confirmTitle (tooltip), aparece no toque — num tablet o
  // tooltip nunca abre, por isso o que for importante (ex.: "isto também
  // afeta X") tem de vir aqui.
  confirmHint?: ReactNode
  size?: ButtonVariantProps['size']
}

export function ConfirmButton({
  confirming,
  onRequestConfirm,
  onConfirm,
  onCancel,
  disabled = false,
  triggerIcon,
  triggerLabel,
  triggerTitle,
  triggerClassName,
  confirmIcon,
  confirmLabel,
  confirmTitle,
  confirmClassName,
  confirmHint,
  size = 'sm',
}: ConfirmButtonProps) {
  const d = useDict()
  // Sem confirmLabel próprio (a maioria dos usos), cai no "Confirmar" genérico.
  const resolvedConfirmLabel = confirmLabel ?? d.common.confirm

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={onRequestConfirm}
        disabled={disabled}
        className={triggerClassName}
        title={triggerTitle}
        aria-label={triggerLabel}
      >
        {triggerIcon}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {confirmHint && <span className="text-xs text-warning">{confirmHint}</span>}
      <Button
        type="button"
        variant="ghost"
        size={size}
        onClick={onCancel}
        disabled={disabled}
        aria-label={d.common.cancelAction(triggerLabel.toLowerCase())}
      >
        {d.common.cancel}
      </Button>
      <Button
        type="button"
        variant="destructive"
        size={size}
        onClick={onConfirm}
        disabled={disabled}
        title={confirmTitle}
        className={confirmClassName}
        aria-label={confirmTitle ?? triggerLabel}
      >
        {confirmIcon}
        {resolvedConfirmLabel}
      </Button>
    </div>
  )
}
