import { useCallback, useEffect, useState } from 'react'

// Aviso partilhado de "ligação ao servidor perdida" para os dashboards em tempo
// real (cozinha, empregado, admin).
//
// PORQUÊ o período de graça: as subscrições fazem a 1.ª leitura logo no arranque,
// às vezes antes do token de sessão do Supabase assentar — essa leitura falha por
// um instante e recupera sozinha. Sem graça, o banner piscava num ecrã que na
// verdade está a funcionar (falso alarme). Só mostramos o aviso se o erro
// PERSISTIR além de `graceMs`; um blip transitório nunca chega a aparecer.
//
// markOk/markError são estáveis (não mudam entre renders), por isso dá para os
// passar diretamente aos subscribe* sem recriar os efeitos.
export function useConnectionAlert(graceMs = 3000) {
  const [failing, setFailing] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!failing) {
      // Deixou de falhar → esconde já. É sincronização do próprio efeito (mesmo
      // padrão aceite no resto do protótipo).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(false)
      return
    }
    // Só mostra se o erro persistir além do período de graça.
    const timer = setTimeout(() => setVisible(true), graceMs)
    return () => clearTimeout(timer)
  }, [failing, graceMs])

  // useCallback com [] → referências estáveis (setFailing já é estável), para os
  // efeitos que as usam não re-subscreverem a cada render.
  const markOk = useCallback(() => setFailing(false), [])
  const markError = useCallback(() => setFailing(true), [])

  return { visible, markOk, markError }
}
