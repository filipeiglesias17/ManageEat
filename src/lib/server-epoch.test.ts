import { describe, expect, it, vi } from 'vitest'

// Cada teste importa o módulo de novo (vi.resetModules) porque serverEpoch é
// um contador com estado module-level partilhado — sem isto, um teste via a
// época já subida por outro teste anterior.
describe('bumpServerEpoch', () => {
  it('a época nasce em 0 num módulo fresco (nenhuma troca de servidor ainda)', async () => {
    vi.resetModules()
    const { getServerEpoch } = await import('./server-epoch')
    expect(getServerEpoch()).toBe(0)
  })

  it('incrementa a época a cada troca de servidor', async () => {
    vi.resetModules()
    const { getServerEpoch, bumpServerEpoch } = await import('./server-epoch')

    bumpServerEpoch()
    expect(getServerEpoch()).toBe(1)
    bumpServerEpoch()
    expect(getServerEpoch()).toBe(2)
  })

  it('avisa todos os subscritores sempre que a época sobe', async () => {
    vi.resetModules()
    const { bumpServerEpoch, subscribeServerEpoch } = await import('./server-epoch')

    const listenerA = vi.fn()
    const listenerB = vi.fn()
    subscribeServerEpoch(listenerA)
    subscribeServerEpoch(listenerB)

    bumpServerEpoch()

    expect(listenerA).toHaveBeenCalledTimes(1)
    expect(listenerB).toHaveBeenCalledTimes(1)
  })

  it('um subscritor que cancelou a subscrição deixa de ser avisado (evita fugas de memória num remount)', async () => {
    vi.resetModules()
    const { bumpServerEpoch, subscribeServerEpoch } = await import('./server-epoch')

    const listener = vi.fn()
    const unsubscribe = subscribeServerEpoch(listener)
    unsubscribe()

    bumpServerEpoch()

    expect(listener).not.toHaveBeenCalled()
  })
})
