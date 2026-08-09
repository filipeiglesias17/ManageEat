import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mockamos ./supabase para controlar o "servidor ativo" e evitar o arranque real
// do cliente Supabase (que exigiria a anon key). sessionUrl só usa getCurrentSupabaseUrl.
vi.mock('./supabase', () => ({
  getCurrentSupabaseUrl: vi.fn(() => 'http://192.168.1.50:54321'),
}))

import { sessionUrl } from './helpers'
import { getCurrentSupabaseUrl } from './supabase'

const mockActiveServer = vi.mocked(getCurrentSupabaseUrl)

// O vitest corre em Node (sem DOM), por isso montamos um window falso só com o
// que o sessionUrl lê: o flag do Capacitor e o location.
function setWindow(opts: { capacitor: boolean; hostname: string; port: string; origin: string }) {
  vi.stubGlobal('window', {
    Capacitor: opts.capacitor ? {} : undefined,
    location: { hostname: opts.hostname, port: opts.port, origin: opts.origin },
  })
}

describe('sessionUrl', () => {
  beforeEach(() => {
    mockActiveServer.mockReturnValue('http://192.168.1.50:54321')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // O QR é mostrado quase sempre DENTRO da app nativa (empregado/admin). O link
  // tem de ser http://<IP-LAN>:<porta-web> para o telemóvel do cliente abrir no
  // browser — nunca capacitor:// nem o IP sem porta.
  it('app nativa iOS (capacitor://localhost) → http LAN com a porta web', () => {
    setWindow({ capacitor: true, hostname: 'localhost', port: '', origin: 'capacitor://localhost' })
    expect(sessionUrl('abc')).toBe('http://192.168.1.50:5173/table/abc')
  })

  it('app nativa Android (https://localhost) → http LAN com a porta web', () => {
    setWindow({ capacitor: true, hostname: 'localhost', port: '', origin: 'https://localhost' })
    expect(sessionUrl('abc')).toBe('http://192.168.1.50:5173/table/abc')
  })

  it('browser de secretária num host de rede → usa a própria origin', () => {
    setWindow({ capacitor: false, hostname: '192.168.1.50', port: '5173', origin: 'http://192.168.1.50:5173' })
    expect(sessionUrl('abc')).toBe('http://192.168.1.50:5173/table/abc')
  })

  // Regressão crítica: com servidor manual (IP mudou desde o build) o QR tem de
  // usar a PORTA WEB (5173), nunca a porta do Supabase (54321) do servidor ativo.
  it('servidor manual com IP mudado → QR usa a porta web 5173, nunca a 54321', () => {
    mockActiveServer.mockReturnValue('http://192.168.1.77:54321')
    setWindow({ capacitor: true, hostname: 'localhost', port: '', origin: 'capacitor://localhost' })
    expect(sessionUrl('abc')).toBe('http://192.168.1.77:5173/table/abc')
  })

  it('dev em loopback (localhost:5173) → constrói http LAN a partir do servidor ativo', () => {
    setWindow({ capacitor: false, hostname: 'localhost', port: '5173', origin: 'http://localhost:5173' })
    expect(sessionUrl('abc')).toBe('http://192.168.1.50:5173/table/abc')
  })
})
