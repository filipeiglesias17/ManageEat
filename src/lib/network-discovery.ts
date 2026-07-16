import { useState, useEffect } from 'react';
import { Network, type ConnectionStatus } from '@capacitor/network';
import {
  getServerOverride,
  getCurrentSupabaseUrl,
  getBuildDefaultUrl,
  getLastGoodServer,
  rememberLastGoodServer,
  updateSupabaseServerUrl,
} from './supabase';

export interface DiscoveryState {
  networkConnected: boolean;
  connectionType: 'wifi' | 'cellular' | 'none' | 'unknown';
  searching: boolean;
  resolvedServerUrl: string | null;
  resolvedServerIp: string | null;
  status: 'offline' | 'searching' | 'connected_local' | 'connected_fallback' | 'unreachable';
}

const isCapacitor = typeof window !== 'undefined' && !!(window as Window & { Capacitor?: unknown }).Capacitor;

let currentState: DiscoveryState = {
  networkConnected: true,
  connectionType: 'unknown',
  searching: false,
  resolvedServerUrl: null,
  resolvedServerIp: null,
  status: 'searching',
};

const listeners = new Set<(state: DiscoveryState) => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener({ ...currentState }));
}

export function subscribeToDiscovery(listener: (state: DiscoveryState) => void) {
  listeners.add(listener);
  listener({ ...currentState });
  return () => {
    listeners.delete(listener);
  };
}

export function useNetworkDiscovery() {
  const [state, setState] = useState<DiscoveryState>({ ...currentState });
  useEffect(() => {
    return subscribeToDiscovery(setState);
  }, []);
  return state;
}

export function getDiscoveryState(): DiscoveryState {
  return { ...currentState };
}

// Health check to check if Supabase/PostgREST is alive
export async function checkUrlHealth(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    // Com apikey válida, a raiz OpenAPI responde 200 — usamos isso como
    // sinal de "servidor vivo".
    return response.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

// (Descoberta automática por zeroconf removida: o plugin capacitor-zeroconf não
//  é compatível com SPM e nunca funcionou no iOS. A ligação ao servidor faz-se
//  pelo IP injetado no build (VITE_LOCAL_NETWORK_HOST) e pelo servidor manual
//  das Definições de ligação — ver handleNetworkStatusChange abaixo.)

// Extrai o hostname de um URL (para a etiqueta "Servidor Local (IP: …)").
// Exportada para teste unitário — ver network-discovery.test.ts.
export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export interface ServerCandidate {
  url: string;
  okStatus: 'connected_local' | 'connected_fallback';
}

// Lista ordenada de candidatos a servidor. O manual (override) é autoritário:
// se estiver definido é o ÚNICO candidato (o utilizador fixou-o de propósito).
// Em automático tentamos o último servidor bom e só depois o IP queimado no
// build — assim a app religa a um endereço conhecido sem reconfiguração manual.
// Exportada para teste unitário — ver network-discovery.test.ts.
export function serverCandidates(): ServerCandidate[] {
  const override = getServerOverride();
  if (override) return [{ url: override, okStatus: 'connected_local' }];

  const candidates: ServerCandidate[] = [];
  const lastGood = getLastGoodServer();
  if (lastGood) candidates.push({ url: lastGood, okStatus: 'connected_local' });
  candidates.push({ url: getBuildDefaultUrl(), okStatus: 'connected_fallback' });

  // Sem duplicados (last-good pode ser igual ao default), mantendo a 1.ª prioridade.
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

// Tenta os candidatos por ordem; o 1.º que responde fica ativo e é lembrado.
// `updateSupabaseServerUrl` é no-op se o URL não mudar (preserva o Realtime);
// se o URL MUDAR mesmo (ex.: IP do Mac alterado), recria o cliente e sobe a
// "época" do servidor, o que remonta a app e religa as subscrições ao cliente
// novo (ver updateSupabaseServerUrl + AppRoot em main.tsx). Se nenhum candidato
// responde → 'unreachable' (leva o utilizador às Definições de ligação em vez
// de um Login que falha).
async function resolveBestServer() {
  for (const candidate of serverCandidates()) {
    const alive = await checkUrlHealth(candidate.url);
    if (!alive) continue;

    updateSupabaseServerUrl(candidate.url);
    const activeUrl = getCurrentSupabaseUrl();
    rememberLastGoodServer(activeUrl);
    currentState = {
      ...currentState,
      searching: false,
      status: candidate.okStatus,
      resolvedServerUrl: activeUrl,
      resolvedServerIp: hostFromUrl(activeUrl),
    };
    notifyListeners();
    return;
  }

  currentState = {
    ...currentState,
    searching: false,
    status: 'unreachable',
    resolvedServerUrl: null,
    resolvedServerIp: null,
  };
  notifyListeners();
}

async function handleNetworkStatusChange(status: ConnectionStatus) {
  currentState = {
    ...currentState,
    networkConnected: status.connected,
    connectionType: status.connectionType,
  };

  // 1) Sem rede → offline. NÃO trocamos o cliente: o supabase-js re-liga sozinho
  //    quando a rede volta, por isso as subscrições Realtime sobrevivem ao blip
  //    (e um servidor manual definido não é apagado).
  if (!status.connected) {
    currentState = {
      ...currentState,
      searching: false,
      status: 'offline',
      resolvedServerUrl: null,
      resolvedServerIp: null,
    };
    notifyListeners();
    return;
  }

  // 2) Fora do Capacitor (web/dev) o browser fala direto com o Supabase — não
  //    há descoberta nem health screen; mantemos o comportamento anterior.
  if (!isCapacitor) {
    currentState = { ...currentState, searching: false, status: 'connected_fallback' };
    notifyListeners();
    return;
  }

  // 3) Capacitor com rede: procurar o melhor servidor (manual → último bom →
  //    IP do build). Mostramos "a procurar" durante os health checks; se nenhum
  //    candidato responder, 'unreachable' leva o utilizador às Definições de
  //    ligação. (A descoberta zeroconf não funciona no iOS hoje — não é SPM.)
  currentState = { ...currentState, searching: true, status: 'searching' };
  notifyListeners();
  await resolveBestServer();
}

// Reavalia a ligação a pedido: após gravar/limpar o servidor manual, ou no botão
// "Tentar de Novo". Reutiliza toda a lógica de handleNetworkStatusChange.
export async function refreshConnection() {
  if (typeof window === 'undefined') return;
  try {
    const status = await Network.getStatus();
    await handleNetworkStatusChange(status);
  } catch {
    // Em web/dev o plugin pode não responder; assumir online para não bloquear.
    await handleNetworkStatusChange({ connected: true, connectionType: 'wifi' } as ConnectionStatus);
  }
}

// Explicit initialization function to start network listeners
export function initNetworkDiscovery() {
  if (typeof window === 'undefined') return;

  Network.getStatus().then((status) => {
    handleNetworkStatusChange(status);
  }).catch((err) => {
    console.error('Failed to get initial network status:', err);
  });

  Network.addListener('networkStatusChange', (status) => {
    handleNetworkStatusChange(status);
  });
}
