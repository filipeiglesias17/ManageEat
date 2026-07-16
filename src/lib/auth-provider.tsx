import { useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { getProfile, subscribeProfile } from './db'
import { AuthContext } from './auth-context'
import type { AppProfile } from '../@types/user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<AppProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Guarda contra setState depois de desmontar (em dev o StrictMode monta o
    // efeito duas vezes) e contra eventos que chegam fora de ordem quando há
    // várias abas a trocar de conta ao mesmo tempo.
    let cancelled = false

    // Subscrição em tempo real ao profile do utilizador atual. Guardada aqui
    // para a podermos terminar sempre que a conta muda ou o componente desmonta.
    let profileUnsub: (() => void) | null = null
    function stopProfileWatch() {
      if (profileUnsub) {
        profileUnsub()
        profileUnsub = null
      }
    }

    // Mantida fora do callback do onAuthStateChange: o supabase-js desaconselha
    // chamar métodos de auth (ex.: signOut) de forma síncrona dentro do callback
    // (pode bloquear). O callback só dispara esta função, que corre à parte.
    async function handleSession(sbUser: User | null) {
      // Qualquer mudança de conta invalida a subscrição anterior.
      stopProfileWatch()

      if (!sbUser) {
        if (cancelled) return
        setUser(null)
        setProfile(null)
        setLoading(false)
        return
      }

      // Utilizadores anónimos (fluxo /mesa/:sessionId) não têm profile —
      // só interessa o uid para correlacionar pedidos. Deixamos passar.
      if (sbUser.is_anonymous) {
        if (cancelled) return
        setUser(sbUser)
        setProfile(null)
        setLoading(false)
        return
      }

      // Staff: ler o profile. O getProfile é um pedido ao Postgres que PODE
      // falhar — tipicamente quando duas abas trocam de conta quase ao mesmo
      // tempo (a leitura do profile do uid antigo passa a ser negada pela RLS
      // depois de o auth mudar). Sem try/catch, essa rejeição rebentava o
      // callback antes do setLoading(false) e a app ficava presa no ecrã preto
      // de loading. Por isso: o loading tem SEMPRE de terminar.
      try {
        const p = await getProfile(sbUser.id)
        if (cancelled) return

        // Sem profile ou profile desativado: sessão inválida. Forçar signOut —
        // o listener re-dispara com user=null e limpa tudo (incl. loading).
        if (!p || !p.active) {
          await supabase.auth.signOut()
          return
        }

        setUser(sbUser)
        setProfile(p)
        setLoading(false)

        // Ouvir o próprio profile em tempo real: se o admin desativar a conta
        // (active:false) ou a apagar, terminamos a sessão na hora, sem esperar
        // por um refresh. Também mantém username/role sincronizados se mudarem.
        profileUnsub = subscribeProfile(sbUser.id, (live) => {
          if (cancelled) return
          if (!live || !live.active) {
            supabase.auth.signOut()
            return
          }
          setProfile(live)
        })
      } catch (err) {
        // Falha a carregar o profile — tipicamente a RLS a negar o uid antigo
        // quando duas abas trocam de conta quase ao mesmo tempo. Não deixamos
        // uma sessão "meia" (user autenticado + profile=null): isso mostrava o
        // Login com a sessão ainda ativa por baixo, um estado ambíguo. Fazemos
        // signOut para o estado ficar coerente — o listener re-dispara com
        // user=null e limpa tudo (incl. loading). Um novo login volta a tentar.
        console.error('Falha ao carregar o profile do utilizador:', err)
        if (cancelled) return
        try {
          await supabase.auth.signOut()
        } catch (signOutErr) {
          // signOut falhou (raro). Forçamos um estado limpo de "sem sessão"
          // para o loading terminar sempre e não ficarmos presos no arranque.
          console.error('signOut após falha de profile também falhou:', signOutErr)
          setUser(null)
          setProfile(null)
          setLoading(false)
        }
      }
    }

    // Limite de 2.5 segundos para resolver o loading inicial.
    // Evita ecrã preto eterno se o servidor local ou cloud estiver inacessível/offline.
    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        console.warn('Initial session loading timed out. Proceeding to fallback state.')
        setLoading(false)
      }
    }, 2500)

    // onAuthStateChange dispara já com a sessão inicial (INITIAL_SESSION), por
    // isso o loading resolve sem precisarmos de um getSession() à parte.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      clearTimeout(timeoutId)
      handleSession(session?.user ?? null)
    })

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      stopProfileWatch()
      subscription.unsubscribe()
    }
  }, [])

  async function logout() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
