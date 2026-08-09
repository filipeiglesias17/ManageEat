// Golden-test das funções SQL canónicas.
//
// As funções de validação grandes (orders/payments/sessions) vivem agora numa
// FONTE ÚNICA em supabase/sql/functions/<nome>.sql, reaplicada por uma migração.
// Este teste garante o contrato going-forward: cada ficheiro canónico tem de ser
// IGUAL à última definição dessa função nas migrações. Se alguém mudar a regra só
// numa migração (e esquecer o canónico) ou só no canónico (e esquecer a migração),
// este teste falha — impedindo o drift que motivou a consolidação.
//
// É puro sistema-de-ficheiros (não toca na BD), por isso corre no `npm run gate`
// normal, sem precisar do Supabase a correr.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const FUNCTIONS_DIR = path.resolve('supabase/sql/functions')
const MIGRATIONS_DIR = path.resolve('supabase/migrations')

// Normaliza para comparar "conteúdo" e não whitespace acidental: CRLF→LF, tira
// espaços no fim de cada linha e linhas vazias no fim. NÃO mexe no conteúdo real.
function normalize(sql: string): string {
  return sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
}

// Extrai o bloco `create or replace function public.<nome>() … $$;` de um texto
// SQL. Devolve null se a função não estiver lá. As funções usam `$$` só a abrir
// (`as $$`) e a fechar (`$$;`), por isso a 1.ª linha que é exatamente `$$;` a
// seguir ao `create` é o terminador do corpo.
function extractFunctionBlock(sql: string, funcName: string): string | null {
  const lines = sql.replace(/\r\n/g, '\n').split('\n')
  const startRe = new RegExp(`^create or replace function public\\.${funcName}\\s*\\(`)
  let start = -1
  // Última ocorrência dentro do ficheiro (defensivo; normalmente só há uma).
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) start = i
  }
  if (start === -1) return null
  for (let end = start + 1; end < lines.length; end++) {
    if (lines[end].trim() === '$$;') {
      return lines.slice(start, end + 1).join('\n')
    }
  }
  return null
}

// Nome da função a partir do próprio ficheiro canónico (a 1.ª linha `create …`).
function funcNameFromCanonical(sql: string): string | null {
  const m = sql.match(/^create or replace function public\.([a-z_]+)\s*\(/m)
  return m ? m[1] : null
}

function migrationFilesSorted(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort() // timestamps no nome → ordem cronológica
}

// A última migração (cronológica) que define `funcName`, e o bloco extraído.
function lastMigrationBlock(funcName: string): { file: string; block: string } | null {
  let result: { file: string; block: string } | null = null
  for (const file of migrationFilesSorted()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    const block = extractFunctionBlock(sql, funcName)
    if (block) result = { file, block }
  }
  return result
}

describe('funções SQL canónicas === última definição nas migrações', () => {
  const canonicalFiles = readdirSync(FUNCTIONS_DIR).filter((f) => f.endsWith('.sql'))

  it('há pelo menos uma função canónica', () => {
    expect(canonicalFiles.length).toBeGreaterThan(0)
  })

  for (const file of canonicalFiles) {
    it(`${file} está em sincronia com as migrações`, () => {
      const canonical = readFileSync(path.join(FUNCTIONS_DIR, file), 'utf-8')
      const funcName = funcNameFromCanonical(canonical)
      expect(funcName, `${file} tem de começar por "create or replace function public.<nome>()"`).not.toBeNull()

      // Invariante simpática: o nome do ficheiro combina com o nome da função.
      expect(file).toBe(`${funcName}.sql`)

      const latest = lastMigrationBlock(funcName as string)
      expect(
        latest,
        `nenhuma migração define public.${funcName} — a consolidação tem de reaplicar a função`,
      ).not.toBeNull()

      // O coração do teste: canónico === última definição nas migrações.
      expect(
        normalize(latest!.block),
        `public.${funcName} diverge: o ficheiro canónico e a última migração (${latest!.file}) ` +
          'estão diferentes. Edita os dois em conjunto (canónico + migração fina que o reaplica).',
      ).toBe(normalize(canonical))
    })
  }
})
