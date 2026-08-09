import { afterEach, describe, expect, it, vi } from 'vitest'

// Mockamos ./supabase para controlar override/last-good/default sem arrancar o
// cliente Supabase real (o mesmo padrão de helpers.test.ts).
vi.mock('./supabase', () => ({
  getServerOverride: vi.fn(() => null),
  getCurrentSupabaseUrl: vi.fn(() => 'http://192.168.1.50:54321'),
  getBuildDefaultUrl: vi.fn(() => 'http://192.168.1.10:54321'),
  getLastGoodServer: vi.fn(() => null),
  rememberLastGoodServer: vi.fn(),
  updateSupabaseServerUrl: vi.fn(),
}))

import { checkUrlHealth, hostFromUrl, serverCandidates } from './network-discovery'
import { getBuildDefaultUrl, getLastGoodServer, getServerOverride } from './supabase'

const mockOverride = vi.mocked(getServerOverride)
const mockLastGood = vi.mocked(getLastGoodServer)
const mockBuildDefault = vi.mocked(getBuildDefaultUrl)

describe('hostFromUrl', () => {
  it('extrai o hostname de um url válido', () => {
    expect(hostFromUrl('http://192.168.1.50:54321')).toBe('192.168.1.50')
  })

  it('devolve null para um url inválido (não rebenta a UI)', () => {
    expect(hostFromUrl('isto-nao-e-um-url')).toBeNull()
  })
})

describe('serverCandidates — prioridade dos candidatos', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('com override manual definido, é o ÚNICO candidato (o utilizador fixou-o de propósito)', () => {
    mockOverride.mockReturnValue('http://192.168.1.99:54321')
    mockLastGood.mockReturnValue('http://192.168.1.50:54321')
    mockBuildDefault.mockReturnValue('http://192.168.1.10:54321')

    expect(serverCandidates()).toEqual([{ url: 'http://192.168.1.99:54321', okStatus: 'connected_local' }])
  })

  it('sem override, tenta primeiro o último servidor bom e depois o IP do build', () => {
    mockOverride.mockReturnValue(null)
    mockLastGood.mockReturnValue('http://192.168.1.50:54321')
    mockBuildDefault.mockReturnValue('http://192.168.1.10:54321')

    expect(serverCandidates()).toEqual([
      { url: 'http://192.168.1.50:54321', okStatus: 'connected_local' },
      { url: 'http://192.168.1.10:54321', okStatus: 'connected_fallback' },
    ])
  })

  it('sem last-good nem override, o único candidato é o IP de build', () => {
    mockOverride.mockReturnValue(null)
    mockLastGood.mockReturnValue(null)
    mockBuildDefault.mockReturnValue('http://192.168.1.10:54321')

    expect(serverCandidates()).toEqual([{ url: 'http://192.168.1.10:54321', okStatus: 'connected_fallback' }])
  })

  it('last-good igual ao build default não duplica o candidato (mantém a 1.ª prioridade)', () => {
    mockOverride.mockReturnValue(null)
    mockLastGood.mockReturnValue('http://192.168.1.10:54321')
    mockBuildDefault.mockReturnValue('http://192.168.1.10:54321')

    expect(serverCandidates()).toEqual([{ url: 'http://192.168.1.10:54321', okStatus: 'connected_local' }])
  })
})

describe('checkUrlHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resposta 200 (response.ok) → servidor saudável', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true }) as Response),
    )
    await expect(checkUrlHealth('http://192.168.1.50:54321')).resolves.toBe(true)
  })

  it('resposta não-ok (ex: 404/500) → servidor não saudável', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }) as Response),
    )
    await expect(checkUrlHealth('http://192.168.1.50:54321')).resolves.toBe(false)
  })

  it('fetch rejeita (rede em baixo/timeout) → servidor não saudável, não propaga o erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network error')
      }),
    )
    await expect(checkUrlHealth('http://192.168.1.50:54321')).resolves.toBe(false)
  })
})
