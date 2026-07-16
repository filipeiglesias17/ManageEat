// Atualizações OTA (over-the-air) do código da app.
//
// Como funciona: o servidor do restaurante guarda a "versão atual" (tabela
// app_release) e o .zip do bundle (Storage 'app-bundles'). Aqui, em runtime e
// só em nativo, comparamos a versão a correr com a publicada; se for mais nova,
// descarregamos o zip pela LAN e agendamo-lo para o próximo arranque (next).
// Um botão/prompt permite aplicar já (set → reload). Ver db/releases.ts e a
// migração 20260625120000_app_releases.sql.
//
// Limite: OTA só troca a camada web (JS/HTML/CSS). Mudanças nativas/plugins
// exigem novo binário.

import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater, type BundleInfo } from '@capgo/capacitor-updater'
import { getAppRelease, bundlePublicUrl } from './db/releases'
import type { AppRelease } from '../@types/release'

// Versão do bundle a correr, injetada no build (ver vite.config.ts). É a fonte
// de verdade do "o que está instalado neste momento".
export function getRunningVersion(): string {
  return import.meta.env.VITE_BUILD_VERSION ?? 'dev'
}

// Bundle já descarregado e pronto a aplicar. Persistido para sobreviver a
// reabrir a app (e para a UI mostrar o aviso "Atualizar agora").
const PENDING_KEY = 'manage-eat-ota-pending'

export interface PendingBundle {
  id: string
  version: string
}

export interface UpdateState {
  pending: PendingBundle | null
  // Último erro ao procurar/descarregar uma atualização (rede, 404, RLS…). Dá
  // visibilidade em vez de falhar em silêncio: o banner mostra-o com "tentar de
  // novo". Null quando está tudo bem.
  lastError: string | null
}

function readPending(): PendingBundle | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(PENDING_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PendingBundle
  } catch {
    return null
  }
}

let state: UpdateState = { pending: readPending(), lastError: null }
const listeners = new Set<(s: UpdateState) => void>()

function setState(next: UpdateState) {
  state = next
  listeners.forEach((listener) => listener({ ...state }))
}

export function subscribeUpdate(listener: (s: UpdateState) => void) {
  listeners.add(listener)
  listener({ ...state })
  return () => {
    listeners.delete(listener)
  }
}

// Hook para a UI (banner "Atualizar agora").
export function useAppUpdate(): UpdateState {
  const [s, setS] = useState<UpdateState>({ ...state })
  useEffect(() => subscribeUpdate(setS), [])
  return s
}

// Confirma ao plugin que a app arrancou bem → ativa o rollback automático: um
// bundle que rebente antes disto é revertido para o anterior (segurança num POS).
export async function notifyReady(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await CapacitorUpdater.notifyAppReady()
  } catch {
    // Sem plugin nativo (ex: build antigo) — ignorar.
  }
}

let checking = false

// A máquina de estados de decisão (versão, checksum, pending já igual) vive
// à parte do I/O (rede, download, localStorage) precisamente para poder ser
// testada sem mockar o Capacitor/@capgo — ver ota.test.ts.
export type UpdateDecision =
  // Nada novo: já estou nesta versão, ou já a tenho pendente para o próximo arranque.
  | { action: 'skip' }
  // Release existe mas sem checksum: recusar é a defesa contra um bundle
  // adulterado numa LAN cleartext (ver comentário em baixo sobre E2E).
  | { action: 'reject-no-checksum' }
  // Há uma versão nova e íntegra: descarregar e agendar para o próximo arranque.
  | {
      action: 'download'
      url: string
      version: string
      checksum: string
      sessionKey?: string
    }

// Decide o que fazer com o release publicado, dada a versão a correr e o que
// já está pendente. Pura: não faz rede nem toca em localStorage/Capacitor.
export function decideUpdateAction(
  runningVersion: string,
  release: AppRelease,
  pending: PendingBundle | null,
): UpdateDecision {
  // Já estou nesta versão, ou já a descarreguei e está pendente → nada a fazer.
  if (release.version === runningVersion) return { action: 'skip' }
  if (pending?.version === release.version) return { action: 'skip' }

  // O checksum é obrigatório: numa LAN cleartext é a defesa contra um bundle
  // adulterado. Com encriptação E2E (publicKey no binário), o checksum vem
  // assinado com a chave privada e o sessionKey traz a chave AES — a app só
  // aceita um bundle que tenha sido assinado/encriptado por nós.
  if (!release.checksum) return { action: 'reject-no-checksum' }

  return {
    action: 'download',
    url: bundlePublicUrl(release.objectPath),
    version: release.version,
    checksum: release.checksum,
    // Só nos bundles encriptados (E2E). Sem sessionKey, o download é como antes.
    ...(release.sessionKey ? { sessionKey: release.sessionKey } : {}),
  }
}

// Procura uma versão mais recente; se existir, descarrega-a em fundo e agenda-a
// para o próximo arranque. Silencioso de propósito: offline/erro mantém o
// bundle atual e não interrompe o serviço.
export async function checkForUpdate(): Promise<void> {
  if (!Capacitor.isNativePlatform() || checking) return
  checking = true
  try {
    const release = await getAppRelease()
    // Conseguimos falar com o servidor → limpar um erro anterior, se houver.
    if (state.lastError) setState({ pending: state.pending, lastError: null })
    if (!release) return

    const decision = decideUpdateAction(getRunningVersion(), release, state.pending)
    if (decision.action === 'skip') return
    if (decision.action === 'reject-no-checksum') {
      setState({ pending: state.pending, lastError: 'Atualização recusada: release sem checksum de integridade.' })
      return
    }

    const bundle: BundleInfo = await CapacitorUpdater.download({
      url: decision.url,
      version: decision.version,
      checksum: decision.checksum,
      ...(decision.sessionKey ? { sessionKey: decision.sessionKey } : {}),
    })

    // Aplicar no PRÓXIMO arranque (não recarrega quem está a usar a app agora).
    await CapacitorUpdater.next({ id: bundle.id })

    const pending: PendingBundle = { id: bundle.id, version: bundle.version }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    }
    setState({ pending, lastError: null })
  } catch (err) {
    // Não interrompe o serviço (mantém o bundle atual), mas dá visibilidade: o
    // banner passa a mostrar o erro + "tentar de novo". Sem isto, uma falha de
    // OTA (404, RLS, LAN em baixo) passava completamente despercebida.
    console.warn('[ota] checkForUpdate falhou:', err)
    setState({ pending: state.pending, lastError: String(err) })
  } finally {
    checking = false
  }
}

// Aplica já o bundle pendente (reload imediato da WebView). Para o botão/prompt.
export async function applyUpdateNow(): Promise<void> {
  const pending = state.pending
  if (!pending) return
  // set() recarrega a WebView com o novo bundle — não corre código a seguir.
  await CapacitorUpdater.set({ id: pending.id })
}

// Depois de o novo bundle arrancar, a versão a correr passa a ser a que estava
// pendente: limpamos o aviso. Chamado no boot nativo.
export function clearPendingIfApplied(): void {
  const pending = state.pending
  if (pending && pending.version === getRunningVersion()) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(PENDING_KEY)
    setState({ pending: null, lastError: null })
  }
}
