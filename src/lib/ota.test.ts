import { describe, expect, it, vi } from 'vitest'
import type { AppRelease } from '../@types/release'

// bundlePublicUrl fala com o cliente Supabase real (storage.from(...).getPublicUrl);
// mockamos o módulo para decideUpdateAction ficar puro nos testes, sem arrancar
// o supabase-js nem precisar da anon key.
vi.mock('./db/releases', () => ({
  getAppRelease: vi.fn(),
  bundlePublicUrl: vi.fn((objectPath: string) => `http://192.168.1.50:54321/storage/v1/object/public/app-bundles/${objectPath}`),
}))

import { decideUpdateAction, type PendingBundle } from './ota'

// Só os campos que decideUpdateAction lê; publishedAt é obrigatório no tipo
// mas irrelevante para a decisão.
function makeRelease(overrides: Partial<AppRelease> = {}): AppRelease {
  return {
    version: '1.1.0',
    objectPath: 'bundles/1.1.0.zip',
    checksum: 'abc123',
    publishedAt: '2026-07-01T10:00:00Z',
    ...overrides,
  }
}

describe('decideUpdateAction — sem novidade', () => {
  it('a versão do release é igual à que está a correr → skip', () => {
    const decision = decideUpdateAction('1.0.0', makeRelease({ version: '1.0.0' }), null)
    expect(decision).toEqual({ action: 'skip' })
  })

  it('o release já está pendente (mesma versão) → skip, não descarrega outra vez', () => {
    const pending: PendingBundle = { id: 'bundle-1', version: '1.1.0' }
    const decision = decideUpdateAction('1.0.0', makeRelease({ version: '1.1.0' }), pending)
    expect(decision).toEqual({ action: 'skip' })
  })

  it('um pending de OUTRA versão não bloqueia a descoberta de uma versão mais nova ainda', () => {
    // Cenário: já tínhamos a 1.1.0 pendente, mas entretanto saiu a 1.2.0.
    const pending: PendingBundle = { id: 'bundle-1', version: '1.1.0' }
    const decision = decideUpdateAction('1.0.0', makeRelease({ version: '1.2.0' }), pending)
    expect(decision.action).toBe('download')
  })
})

describe('decideUpdateAction — checksum obrigatório', () => {
  it('release sem checksum → rejeitar (defesa contra bundle adulterado na LAN)', () => {
    const decision = decideUpdateAction('1.0.0', makeRelease({ checksum: undefined }), null)
    expect(decision).toEqual({ action: 'reject-no-checksum' })
  })

  it('checksum vazio conta como ausente → rejeitar', () => {
    const decision = decideUpdateAction('1.0.0', makeRelease({ checksum: '' }), null)
    expect(decision).toEqual({ action: 'reject-no-checksum' })
  })
})

describe('decideUpdateAction — download', () => {
  it('versão nova com checksum → manda descarregar com o url do bucket', () => {
    const decision = decideUpdateAction(
      '1.0.0',
      makeRelease({ version: '1.1.0', objectPath: 'bundles/1.1.0.zip', checksum: 'abc123' }),
      null,
    )
    expect(decision).toEqual({
      action: 'download',
      url: 'http://192.168.1.50:54321/storage/v1/object/public/app-bundles/bundles/1.1.0.zip',
      version: '1.1.0',
      checksum: 'abc123',
    })
  })

  it('release encriptado E2E (com sessionKey) → a decisão transporta a sessionKey', () => {
    const decision = decideUpdateAction(
      '1.0.0',
      makeRelease({ version: '1.1.0', checksum: 'abc123', sessionKey: 'chave-aes-encriptada' }),
      null,
    )
    expect(decision.action).toBe('download')
    if (decision.action === 'download') {
      expect(decision.sessionKey).toBe('chave-aes-encriptada')
    }
  })

  it('release sem sessionKey (bundle não encriptado) → decisão não inclui a propriedade', () => {
    const decision = decideUpdateAction('1.0.0', makeRelease({ version: '1.1.0', checksum: 'abc123' }), null)
    expect(decision.action).toBe('download')
    if (decision.action === 'download') {
      expect(decision.sessionKey).toBeUndefined()
    }
  })

  it('downgrade: release com versão "menor" (string) ainda é tratado como novidade a aplicar', () => {
    // decideUpdateAction compara só por igualdade de string (não semver) — o
    // servidor é que decide o que publica. Isto documenta o comportamento atual:
    // qualquer versão DIFERENTE da que corre é candidata a download, mesmo que
    // pareça um "downgrade" textual.
    const decision = decideUpdateAction('2.0.0', makeRelease({ version: '1.9.0', checksum: 'abc123' }), null)
    expect(decision.action).toBe('download')
  })
})

describe('decideUpdateAction — pending nulo não rebenta', () => {
  it('primeira verificação (sem pending nenhum) trata pending como ausente', () => {
    const decision = decideUpdateAction('1.0.0', makeRelease({ version: '1.1.0', checksum: 'abc123' }), null)
    expect(decision.action).toBe('download')
  })
})
