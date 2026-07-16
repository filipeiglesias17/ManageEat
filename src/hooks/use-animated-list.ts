import { useEffect, useRef, useState } from 'react'

// Saída ANIMADA para listas realtime (Fase 4 do redesign POS).
//
// Problema: os subscribe* substituem a lista inteira a cada mudança — um item
// removido desaparece do DOM de repente, sem transição. Este hook segura os
// itens removidos por ~220ms marcados como `leaving`, para o componente lhes
// aplicar a animação de saída (animate-sink + colapso) antes de saírem do DOM.
//
// Uso no componente:
//   const entries = useAnimatedList(orders, (o) => o.id)
//   entries.map(({ item, key, leaving }) => (
//     <div key={key} className={`grid transition-[grid-template-rows] duration-200
//       ${leaving ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}>
//       <div className={`overflow-hidden ${leaving ? 'animate-sink' : ''}`}>…</div>
//     </div>
//   ))

export type AnimatedEntry<T> = { item: T; key: string; leaving: boolean }

// Tempo que um item removido fica no DOM em saída (animação de sink dura 180ms).
const EXIT_MS = 220

// Junta a lista nova com as entradas do render anterior. Função pura e exportada
// para ser testável em node (o hook só acrescenta os timers por cima).
// - Itens presentes na lista nova ficam/voltam a leaving=false (um item que
//   reapareceu — flap do realtime — cancela a saída).
// - Itens que desapareceram entram em leaving=true, mantidos na POSIÇÃO antiga
//   (senão a linha saltava para o fim durante a animação).
export function mergeAnimatedEntries<T>(
  previous: AnimatedEntry<T>[],
  items: T[],
  keyOf: (item: T) => string,
): { entries: AnimatedEntry<T>[]; newlyLeaving: string[]; reappeared: string[] } {
  const currentKeys = new Set(items.map(keyOf))
  const previousIndex = new Map(previous.map((entry, index) => [entry.key, index]))

  const entries: AnimatedEntry<T>[] = items.map((item) => ({ item, key: keyOf(item), leaving: false }))

  const newlyLeaving: string[] = []
  const reappeared: string[] = []

  previous.forEach((entry) => {
    if (currentKeys.has(entry.key)) {
      if (entry.leaving) reappeared.push(entry.key)
      return
    }
    if (!entry.leaving) newlyLeaving.push(entry.key)
    // Reinsere o item em saída na posição onde estava (clampada ao tamanho novo).
    const index = Math.min(previousIndex.get(entry.key) ?? entries.length, entries.length)
    entries.splice(index, 0, { ...entry, leaving: true })
  })

  return { entries, newlyLeaving, reappeared }
}

export function useAnimatedList<T>(items: T[], keyOf: (item: T) => string): AnimatedEntry<T>[] {
  const [entries, setEntries] = useState<AnimatedEntry<T>[]>(
    () => items.map((item) => ({ item, key: keyOf(item), leaving: false })),
  )
  // Um timer de remoção definitiva por key em saída.
  const timers = useRef(new Map<string, number>())
  // keyOf estável via ref: evita re-correr o efeito principal se o chamador
  // passar uma arrow function nova em cada render (o caso típico). A ref é
  // atualizada num efeito (refs não se escrevem durante o render).
  const keyOfRef = useRef(keyOf)
  useEffect(() => {
    keyOfRef.current = keyOf
  })

  useEffect(() => {
    setEntries((previous) => {
      const { entries: next, newlyLeaving, reappeared } = mergeAnimatedEntries(previous, items, keyOfRef.current)

      // Item reapareceu durante a saída: cancela a remoção agendada.
      reappeared.forEach((key) => {
        const timer = timers.current.get(key)
        if (timer) {
          clearTimeout(timer)
          timers.current.delete(key)
        }
      })

      // Item acabou de sair da lista: agenda a remoção definitiva do DOM.
      newlyLeaving.forEach((key) => {
        const timer = window.setTimeout(() => {
          timers.current.delete(key)
          setEntries((current) => current.filter((entry) => entry.key !== key))
        }, EXIT_MS)
        timers.current.set(key, timer)
      })

      return next
    })
  }, [items])

  // Limpar os timers pendentes ao desmontar.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => clearTimeout(timer))
      pending.clear()
    }
  }, [])

  return entries
}
