import { describe, expect, it } from 'vitest'
import { resolvePublicStorageReference, toStablePublicStorageReference } from './storage-url'

const IMAGE_PATH = '/storage/v1/object/public/menu-images/produtos/sushi.png'

describe('toStablePublicStorageReference', () => {
  it('remove o host antigo de um URL público do Storage', () => {
    expect(toStablePublicStorageReference(`http://192.168.1.67:54321${IMAGE_PATH}`)).toBe(IMAGE_PATH)
  })

  it('mantém referências já estáveis', () => {
    expect(toStablePublicStorageReference(IMAGE_PATH)).toBe(IMAGE_PATH)
  })

  it('não altera imagens externas nem assets da app', () => {
    expect(toStablePublicStorageReference('https://cdn.example.com/sushi.png')).toBe('https://cdn.example.com/sushi.png')
    expect(toStablePublicStorageReference('/demo-menu/sushi.png')).toBe('/demo-menu/sushi.png')
  })
})

describe('resolvePublicStorageReference', () => {
  it('usa o servidor atual para uma referência estável', () => {
    expect(resolvePublicStorageReference(IMAGE_PATH, 'https://172.20.10.2:54391')).toBe(
      `https://172.20.10.2:54391${IMAGE_PATH}`,
    )
  })

  it('corrige também URLs absolutos gravados com um IP antigo', () => {
    expect(
      resolvePublicStorageReference(`http://192.168.1.67:54321${IMAGE_PATH}`, 'http://10.0.0.8:54321'),
    ).toBe(`http://10.0.0.8:54321${IMAGE_PATH}`)
  })
})

