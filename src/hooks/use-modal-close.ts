import { createContext, useContext } from 'react'

// Contexto interno do Modal: expõe o requestClose (fecho COM animação de saída)
// aos filhos — botões X e "Cancelar" dos modais custom. Vive num ficheiro de
// hook (sem componentes) para o fast refresh do Vite não se queixar.
export const ModalCloseContext = createContext<(() => void) | null>(null)

// Devolve o fecho animado do Modal mais próximo, ou null fora de um Modal /
// num Modal sem onClose. O chamador decide o fallback (normalmente chamar o
// onClose cru, que fecha sem animação).
export function useModalClose(): (() => void) | null {
  return useContext(ModalCloseContext)
}
