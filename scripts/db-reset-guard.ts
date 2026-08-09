// Guarda do `db:reset`.
//
// PORQUÊ: o reset corre `supabase db reset`, que APAGA toda a base de dados e
// reaplica as migrações. Como esta app corre em localhost MESMO EM PRODUÇÃO (na
// máquina on-premise de cada restaurante), um reset acidental apagaria o menu,
// pedidos, contas e histórico REAIS. A regra nº1 é nunca perder dados.
//
// Para aplicar MIGRAÇÕES novas NÃO se usa isto — usa-se `npm run db:migrate`
// (`supabase migration up`), que aplica só as pendentes SEM apagar nada.
//
// Este guard garante que um reset:
//   1) só corre com confirmação explícita (escrever o nome do projeto), e
//   2) RECUSA correr sem terminal interativo (sem TTY) a não ser com --force —
//      assim um script, hook ou agente não o dispara sem querer;
//   3) tira SEMPRE um snapshot pré-reset antes de apagar (recuperável com
//      `npm run db:restore`), exceto se passares --no-backup de propósito.
//
// Uso:  npm run db:reset           (interativo: pede o nome do projeto)
//       npm run db:reset:force     (sem pergunta, à mesma com backup) → --force
//       ... --no-backup            (saltar o snapshot; fortemente desaconselhado)

import { execSync } from 'node:child_process'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

// Tem de bater certo com o project_id em supabase/config.toml.
const PROJECT = 'manage-eat'
const args = process.argv.slice(2)
const force = args.includes('--force') || args.includes('-y')
const noBackup = args.includes('--no-backup')

function sh(cmd: string) {
  execSync(cmd, { stdio: 'inherit' })
}

async function main() {
  if (!force) {
    // Sem TTY (automação, hook, agente) recusamos: o reset é destrutivo e nunca
    // deve acontecer sem uma pessoa a confirmar. Quem quiser mesmo em automação
    // usa db:reset:force (que à mesma faz backup antes).
    if (!stdin.isTTY) {
      console.error('✗ db:reset recusado: sem terminal interativo, e isto APAGA todos os dados.')
      console.error('  • Para aplicar migrações novas (sem apagar): npm run db:migrate')
      console.error('  • Para resetar mesmo assim em automação:       npm run db:reset:force')
      process.exit(1)
    }
    console.warn('\n⚠️  db:reset APAGA TODA a base de dados local: menu, pedidos, contas, histórico.')
    console.warn('   Em produção (máquina do restaurante) isto perde dados REAIS.')
    console.warn('   → Para aplicar migrações novas usa antes:  npm run db:migrate  (não apaga)\n')
    const rl = readline.createInterface({ input: stdin, output: stdout })
    const answer = await rl.question(`   Escreve "${PROJECT}" para confirmar o reset (ou Enter para cancelar): `)
    rl.close()
    if (answer.trim() !== PROJECT) {
      console.error('\n✗ Confirmação não corresponde. Reset CANCELADO (nada foi apagado).')
      process.exit(1)
    }
  }

  // Snapshot pré-reset: a rede de segurança que permite `npm run db:restore`.
  if (!noBackup) {
    console.log('• A tirar snapshot pré-reset (recuperável com npm run db:restore)…')
    sh('npx tsx scripts/db-backup.ts --auto --reason pre-reset')
  } else {
    console.warn('• --no-backup: a saltar o snapshot pré-reset (sem rede de segurança).')
  }

  console.log('• A correr supabase db reset…')
  sh('npx supabase db reset')
}

main().catch((err) => {
  console.error('✗ db:reset falhou:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
