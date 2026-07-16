import { useEffect, useRef, useState, type ReactNode, type AnimationEvent as ReactAnimationEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ModalCloseContext, useModalClose } from '../hooks/use-modal-close'
import { useDict } from '../lib/i18n'

// Elementos que podem receber foco por teclado dentro do modal.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Lista dos focáveis VISÍVEIS do modal. Filtra offsetParent === null para
// ignorar elementos escondidos (display:none), que não devem entrar no ciclo
// do Tab.
function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  return Array.from(nodes).filter((el) => el.offsetParent !== null)
}

// Rede de segurança do fecho animado: se o animationend nunca disparar, o
// modal fecha na mesma passado este tempo (animação dura 180ms).
const CLOSE_FALLBACK_MS = 300

interface Props {
  children: ReactNode
  maxWidth?: string
  // Opcional: quando passado, permite fechar o modal com Escape ou clicando
  // fora do card.
  onClose?: () => void
  'aria-labelledby'?: string
}

export function Modal({ children, maxWidth = 'max-w-md', onClose, 'aria-labelledby': ariaLabelledby }: Props) {
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  // Fecho ANIMADO: em vez de desmontar de repente, `closing` troca as animações
  // de entrada (fade-in/pop-in) pelas de saída (fade-out/pop-out) e o onClose
  // real só corre quando a animação do card termina (ou no timeout de
  // segurança — mesmo padrão do theme-switching em theme.ts).
  const [closing, setClosing] = useState(false)
  const closeFallbackTimer = useRef<number | null>(null)

  function requestClose() {
    if (!onClose || closing) return
    setClosing(true)
    closeFallbackTimer.current = window.setTimeout(() => onClose(), CLOSE_FALLBACK_MS)
  }

  function handleCardAnimationEnd(e: ReactAnimationEvent<HTMLDivElement>) {
    // Só a animação do próprio card conta — filhos também disparam animationend.
    if (!closing || e.target !== e.currentTarget) return
    if (closeFallbackTimer.current) clearTimeout(closeFallbackTimer.current)
    onClose?.()
  }

  useEffect(() => {
    return () => {
      if (closeFallbackTimer.current) clearTimeout(closeFallbackTimer.current)
    }
  }, [])

  // Efeito de Foco: Corre apenas quando o modal é montado e desmontado.
  // Evita a perda de foco nos inputs internos quando o onClose muda de referência.
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement

    if (modalRef.current) {
      modalRef.current.focus()
    }

    return () => {
      if (previousFocus.current) previousFocus.current.focus()
    }
  }, [])

  // Bloqueia o scroll do fundo enquanto o modal está aberto. Sem isto, em
  // telemóvel o dedo "fura" o modal e arrasta a página por baixo (scroll-bleed).
  // Guarda e repõe o valor anterior para o caso de modais empilhados.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  // Efeito de Atalho (Escape): Registado quando o modal é montado ou onClose muda.
  useEffect(() => {
    if (!onClose) return

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', handleKey)

    return () => {
      window.removeEventListener('keydown', handleKey)
    }
    // requestClose lê onClose/closing do render atual; re-registar quando mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, closing])

  // Prende o Tab dentro do modal (padrão WAI-ARIA dialog): no último elemento
  // volta ao primeiro e no primeiro (ou no container) salta para o último, para
  // o foco nunca escapar para o conteúdo de fundo.
  function trapTab(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return

    const focusables = getFocusable(modalRef.current)
    if (focusables.length === 0) {
      // Sem nada focável, manter o foco no próprio diálogo.
      e.preventDefault()
      return
    }

    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement

    if (e.shiftKey) {
      if (active === first || active === modalRef.current) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  // Portal para o document.body. Sem isto, o modal é renderizado dentro do
  // conteúdo da página; wrappers com animações de opacidade/transform
  // (animate-fade-in/rise/pop-in) criam um stacking context que "aprisiona" o
  // `fixed inset-0` e faz a navbar (z-40) pintar POR CIMA do modal — o título e
  // o X ficam escondidos sob a barra ("desformatado ao topo"). No body, o
  // overlay fica na raiz e cobre a app toda, incluindo a navbar.
  return createPortal(
    <div
      // O padding inclui as safe-area insets (env(safe-area-inset-*)) além de
      // 1rem de folga. Sem isto, no iPhone (viewport-fit=cover) o topo do card
      // — onde vive o botão de fechar (X) — escorrega para baixo do notch /
      // Dynamic Island e fica inalcançável ao toque. Cobre também o home
      // indicator no fundo e o notch lateral em landscape.
      className={`fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)] pl-[calc(env(safe-area-inset-left)+1rem)] pr-[calc(env(safe-area-inset-right)+1rem)] ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={requestClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledby}
        tabIndex={-1}
        onKeyDown={trapTab}
        onAnimationEnd={handleCardAnimationEnd}
        // max-h + overflow-y-auto: em ecrãs baixos (telemóvel, ou teclado aberto)
        // o conteúdo alto faz scroll dentro do card em vez de transbordar para
        // fora da viewport e deixar o botão de ação (Pedir/Guardar) inalcançável.
        // Descontamos também as safe-area insets para que, mesmo cheio, o card
        // caiba na área visível e o topo (botão X) nunca passe sob o notch.
        className={`bg-card border border-border px-4 py-5 sm:px-8 sm:py-6 rounded-lg shadow-xl w-full outline-none ${closing ? 'animate-pop-out' : 'animate-pop-in'} max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] overflow-y-auto custom-scrollbar ${maxWidth}`}
        // Cliques dentro do card não fecham o modal — só o overlay é que fecha.
        onClick={(e) => e.stopPropagation()}
      >
        {/* Os filhos (ModalHeader, botões "Cancelar") fecham via useModalClose
            para a saída ser sempre animada. */}
        <ModalCloseContext.Provider value={onClose ? requestClose : null}>
          {children}
        </ModalCloseContext.Provider>
      </div>
    </div>,
    document.body,
  )
}

// ── Header e Footer padrão dos modais ────────────────────────────────
//
// Antes, cada modal custom copiava o mesmo layout de título + botão X. Estes
// dois subcomponentes normalizam isso (e o X já fecha com animação, via
// useModalClose).

interface ModalHeaderProps {
  title: ReactNode
  // id do título, para ligar ao aria-labelledby passado ao Modal.
  titleId?: string
  // Desativa o X durante submissões (evita fechar a meio de um pedido à BD).
  closeDisabled?: boolean
}

export function ModalHeader({ title, titleId, closeDisabled }: ModalHeaderProps) {
  const d = useDict()
  const requestClose = useModalClose()

  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <h2 id={titleId} className="text-lg font-semibold text-foreground">{title}</h2>
      {requestClose && (
        <button
          type="button"
          aria-label={d.common.close}
          onClick={requestClose}
          disabled={closeDisabled}
          className="shrink-0 -m-1 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 disabled:pointer-events-none"
        >
          <X className="size-5" />
        </button>
      )}
    </div>
  )
}

export function ModalFooter({ children }: { children: ReactNode }) {
  // Em ecrã estreito os botões empilham com a ação principal EM CIMA
  // (flex-col-reverse); em ecrã largo alinham à direita, principal no fim.
  return (
    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 mt-4 border-t border-border">
      {children}
    </div>
  )
}
