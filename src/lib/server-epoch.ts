import { useSyncExternalStore } from 'react'

// "Época" do servidor: um contador que sobe sempre que o cliente Supabase é
// recriado por troca de servidor em runtime (ver updateSupabaseServerUrl em
// supabase.ts). Recriar o cliente orfaniza TODAS as subscrições Realtime que
// estavam ligadas ao cliente antigo — auth, profile, orders, sessions,
// service_calls, OTA — e os componentes não voltam a subscrever sozinhos.
//
// Como remontar um componente em React volta a correr os seus useEffect, usamos
// esta época como `key` no topo da app (ver AppRoot em main.tsx): quando sobe, a
// árvore inteira remonta e cada subscrição liga-se de novo ao cliente atual. É a
// forma mais simples e fiável de reanexar tudo, sem manter um registo manual de
// unsubscribers espalhado pela app.

let serverEpoch = 0
const listeners = new Set<() => void>()

export function getServerEpoch(): number {
  return serverEpoch
}

// Chamado por updateSupabaseServerUrl quando o servidor muda mesmo (cliente novo).
export function bumpServerEpoch(): void {
  serverEpoch++
  listeners.forEach((listener) => listener())
}

// Exportada para teste unitário — ver server-epoch.test.ts. É a mesma função
// que useServerEpoch passa ao useSyncExternalStore.
export function subscribeServerEpoch(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// useSyncExternalStore é a API do React para ler uma fonte externa (este
// contador) e re-renderizar quando muda. Damos-lhe como subscrever e como ler o
// valor atual; ele trata da sincronização sem perder uma troca que ocorra entre
// o render e o efeito (a descoberta de rede arranca antes do React montar).
export function useServerEpoch(): number {
  return useSyncExternalStore(subscribeServerEpoch, getServerEpoch)
}
