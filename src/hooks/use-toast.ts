import { createContext, useContext } from 'react'

// Feedback GLOBAL da app (toast no fundo do ecrã): "Pedido enviado", "Conta
// fechada", erros de rede. Para mensagens contextuais dentro de um formulário
// continua a usar-se o use-flash-message / estado local — um toast desaparece
// sozinho e o utilizador pode não o ver a tempo.
//
// O contexto vive aqui (ficheiro sem componentes) e não em toast.tsx, para o
// fast refresh do Vite continuar a funcionar nos componentes.

export type ToastVariant = 'success' | 'error' | 'info'

export type ToastApi = {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) {
    // Falhar cedo e com mensagem clara: o provider monta-se uma vez no main.tsx.
    throw new Error('useToast precisa do <ToastProvider> (montado no main.tsx)')
  }
  return api
}
