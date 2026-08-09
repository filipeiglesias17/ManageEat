import { describe, it, expect } from 'vitest'
import { validateItemFields, buildItemPayload, type ItemFormFields } from './item-form'
// As mensagens de erro vêm do dicionário PT (idioma por defeito nos testes,
// que correm em Node sem localStorage — ver readStoredLang em lib/i18n).
// Importar daqui em vez de repetir os literais evita que o teste e o
// dicionário divirjam sem se dar por isso.
import { admin } from './i18n/pt/admin'

const errors = admin.menu.form.errors

// Campos válidos por defeito; cada teste muda só o que interessa.
function fields(overrides: Partial<ItemFormFields> = {}): ItemFormFields {
  return {
    name: 'Bife',
    description: 'Bom',
    price: '12.50',
    categoryId: 'cat-1',
    discount: '',
    vat: '',
    ingredients: [],
    tags: [],
    rodizio: false,
    image: '',
    ...overrides,
  }
}

describe('validateItemFields', () => {
  it('aceita campos válidos', () => {
    expect(validateItemFields(fields())).toBeNull()
  })

  it('rejeita nome com menos de 2 caracteres', () => {
    expect(validateItemFields(fields({ name: 'A' }))).toBe(errors.nameTooShort)
  })

  it('rejeita preço vazio, não numérico ou <= 0', () => {
    expect(validateItemFields(fields({ price: '' }))).toBe(errors.invalidPrice)
    expect(validateItemFields(fields({ price: 'abc' }))).toBe(errors.invalidPrice)
    expect(validateItemFields(fields({ price: '0' }))).toBe(errors.invalidPrice)
  })

  it('exige categoria', () => {
    expect(validateItemFields(fields({ categoryId: '' }))).toBe(errors.categoryRequired)
  })

  it('rejeita desconto fora de 0–100, mas aceita vazio', () => {
    expect(validateItemFields(fields({ discount: '150' }))).toBe(errors.discountRange)
    expect(validateItemFields(fields({ discount: '-1' }))).toBe(errors.discountRange)
    expect(validateItemFields(fields({ discount: '' }))).toBeNull()
    expect(validateItemFields(fields({ discount: '20' }))).toBeNull()
  })

  it('rejeita IVA fora de 0–100, mas aceita vazio', () => {
    expect(validateItemFields(fields({ vat: '200' }))).toBe(errors.vatRange)
    expect(validateItemFields(fields({ vat: '' }))).toBeNull()
    expect(validateItemFields(fields({ vat: '23' }))).toBeNull()
  })
})

describe('buildItemPayload', () => {
  it('converte e limpa os campos', () => {
    const payload = buildItemPayload(fields({ name: '  Bife  ', price: '12.50', discount: '10' }))
    expect(payload.name).toBe('Bife')
    expect(payload.price).toBe(12.5)
    expect(payload.discount).toBe(10)
    expect(payload.rodizioAvailable).toBe(false)
  })

  it('desconto vazio vira null', () => {
    expect(buildItemPayload(fields({ discount: '' })).discount).toBeNull()
  })

  it('omite vatRate quando vazio e inclui-o quando definido', () => {
    expect(buildItemPayload(fields({ vat: '' })).vatRate).toBeUndefined()
    expect(buildItemPayload(fields({ vat: '13' })).vatRate).toBe(13)
  })

  it('imagem vazia vira null; com URL fica a URL', () => {
    expect(buildItemPayload(fields({ image: '' })).image).toBeNull()
    expect(buildItemPayload(fields({ image: 'http://x/img.png' })).image).toBe('http://x/img.png')
  })
})
