import { describe, it, expect } from 'vitest'
import { parsePort, buildServerUrl, normalizeServerUrl } from './validation'

// Estas funções são o caminho crítico de que depende a app conseguir LIGAR ao
// servidor do restaurante (e, por isso, receber atualizações OTA). Fixam-se aqui
// os casos que partiam no iPhone (vírgula em vez de ponto, porta colada no IP).

describe('buildServerUrl', () => {
  it('converte as vírgulas do teclado iOS PT em pontos', () => {
    expect(buildServerUrl('192,168,1,67', 54321)).toBe('http://192.168.1.67:54321')
  })

  it('remove "http://" e barras finais coladas pelo utilizador', () => {
    expect(buildServerUrl('http://192.168.1.67/', 54321)).toBe('http://192.168.1.67:54321')
  })

  it('usa a porta embutida se o utilizador colar "IP:porta" no campo do IP', () => {
    expect(buildServerUrl('192.168.1.67:1234', 54321)).toBe('http://192.168.1.67:1234')
  })

  it('devolve null quando o host fica vazio', () => {
    expect(buildServerUrl('   ', 54321)).toBeNull()
  })
})

describe('parsePort', () => {
  it('aceita uma porta válida', () => {
    expect(parsePort('54321')).toBe(54321)
  })

  it('rejeita 0, fora de gama e não-numérico', () => {
    expect(parsePort('0')).toBeNull()
    expect(parsePort('70000')).toBeNull()
    expect(parsePort('abc')).toBeNull()
  })
})

describe('normalizeServerUrl', () => {
  it('remove a barra final e aceita http(s)', () => {
    expect(normalizeServerUrl('http://192.168.1.67:54321/')).toBe('http://192.168.1.67:54321')
  })

  it('rejeita protocolos que não sejam http(s) e o vazio', () => {
    expect(normalizeServerUrl('ftp://192.168.1.67')).toBeNull()
    expect(normalizeServerUrl('   ')).toBeNull()
  })
})
