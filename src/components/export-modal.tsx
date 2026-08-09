import { useState } from 'react'
import { Download, AlertTriangle } from 'lucide-react'
import { Modal, ModalHeader } from './modal'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { ExportSection } from '../lib/report-xlsx'
import { presetRange, type Preset } from '../lib/stats'
import { LEGAL_NO_FISCAL, LEGAL_CONFIDENTIAL_RGPD } from '../lib/export-meta'
import { BetaBadge } from './ui/beta-badge'
import { useDict, type Translation } from '../lib/i18n'

// Opções escolhidas no modal e devolvidas a quem chama (a página de Análises).
export type ExportFormat = 'xlsx' | 'pdf' | 'csv' | 'saft'

export type ExportOptions = {
  format: ExportFormat
  from: string
  to: string
  sections: ExportSection[]
  purpose: string
}

interface Props {
  defaultFrom: string
  defaultTo: string
  busy: boolean
  error: string
  onExport: (opts: ExportOptions) => void
  onClose: () => void
}

// Ordem das secções mostradas no modal. As labels vêm do dicionário (d.stats.exportModal.sections),
// aqui só a chave que identifica cada uma  nomes em `report-xlsx.ts` usam kebab-case
// ('vendas-dia'), o dicionário usa camelCase ('vendasDia'); este mapa liga os dois.
const SECTION_KEYS: { key: ExportSection; dictKey: keyof Translation['stats']['exportModal']['sections'] }[] = [
  { key: 'resumo', dictKey: 'resumo' },
  { key: 'vendas-dia', dictKey: 'vendasDia' },
  { key: 'categorias', dictKey: 'categorias' },
  { key: 'itens', dictKey: 'itens' },
  { key: 'pagamentos', dictKey: 'pagamentos' },
  { key: 'iva', dictKey: 'iva' },
  { key: 'turnos', dictKey: 'turnos' },
  { key: 'rodizio', dictKey: 'rodizio' },
  { key: 'auditoria', dictKey: 'auditoria' },
]

// Todas as secções selecionadas  estado inicial dos checkboxes.
const ALL_SECTIONS: ExportSection[] = SECTION_KEYS.map(s => s.key)

// Ordem dos presets de período mostrados como botões rápidos (labels vêm do
// dicionário, iguais ao filtro principal do ecrã de Análises).
const PRESET_KEYS: { key: Preset; dictKey: keyof Translation['stats']['presets'] }[] = [
  { key: 'today', dictKey: 'today' },
  { key: '7d', dictKey: '7d' },
  { key: '30d', dictKey: '30d' },
  { key: '90d', dictKey: '90d' },
  { key: 'all', dictKey: 'all' },
]

// Descobre qual preset corresponde a um intervalo de datas  para realçar o
// preset ativo ao abrir (as datas vêm do filtro do ecrã de Análises). Datas
// vazias = "Tudo"; se nenhum preset bater certo, é um intervalo personalizado.
function presetForDates(from: string, to: string): Preset | null {
  if (!from && !to) return 'all'
  for (const { key } of PRESET_KEYS) {
    if (key === 'all') continue
    const range = presetRange(key)
    if (range && range.from === from && range.to === to) return key
  }
  return null
}

const FORMAT_KEYS: { key: ExportFormat; dictKey: keyof Translation['stats']['exportModal']['formats'] }[] = [
  { key: 'xlsx', dictKey: 'xlsx' },
  { key: 'pdf', dictKey: 'pdf' },
  { key: 'csv', dictKey: 'csv' },
  { key: 'saft', dictKey: 'saft' },
]

export function ExportModal({ defaultFrom, defaultTo, busy, error, onExport, onClose }: Props) {
  const d = useDict()
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  // Preset de período realçado (como no ecrã de Análises). Começa no que bater
  // com as datas iniciais; passa a null (personalizado) se o utilizador editar
  // as datas à mão.
  const [activePreset, setActivePreset] = useState<Preset | null>(() => presetForDates(defaultFrom, defaultTo))
  const [sections, setSections] = useState<ExportSection[]>(ALL_SECTIONS)
  const [purpose, setPurpose] = useState('')

  // As secções só fazem sentido nos formatos por dataset (XLSX e CSV). O PDF tem
  // estrutura própria e o SAF-T é XML fiscal  nenhum usa esta lista.
  const usesSections = format === 'xlsx' || format === 'csv'

  // Aplica um preset: realça-o e preenche as datas (ou esvazia-as, no "Tudo").
  function applyPreset(p: Preset) {
    setActivePreset(p)
    const range = presetRange(p)
    if (range) {
      setFrom(range.from)
      setTo(range.to)
    } else {
      // "Tudo" = sem limites → strings vazias (os fetches tratam isto).
      setFrom('')
      setTo('')
    }
  }

  // Editar uma data à mão desliga o realce do preset (passa a personalizado).
  function handleFromChange(value: string) {
    setFrom(value)
    setActivePreset(null)
  }

  function handleToChange(value: string) {
    setTo(value)
    setActivePreset(null)
  }

  // Liga/desliga uma secção na lista, mantendo a ordem original irrelevante para
  // os builders (eles filtram pelo conjunto).
  function toggleSection(key: ExportSection) {
    setSections(prev => {
      if (prev.includes(key)) return prev.filter(s => s !== key)
      return [...prev, key]
    })
  }

  //  Validação
  // "De" não pode ser depois de "Até" quando ambas as datas estão preenchidas.
  const dateRangeInvalid = Boolean(from && to && from > to)
  // Em XLSX/CSV é preciso pelo menos uma secção.
  const needsSection = usesSections && sections.length === 0

  let validationMessage = ''
  if (dateRangeInvalid) {
    validationMessage = d.stats.exportModal.invalidDateRange
  } else if (needsSection) {
    validationMessage = d.stats.exportModal.needsSection
  }

  const canExport = !busy && !dateRangeInvalid && !needsSection

  function handleSubmit() {
    if (!canExport) return
    onExport({ format, from, to, sections, purpose: purpose.trim() })
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg" aria-labelledby="export-modal-title">
      <div className="space-y-6">

        {/*  Título*/}
        <div>
          <ModalHeader title={d.stats.exportModal.title} titleId="export-modal-title" closeDisabled={busy} />
          <p className="text-xs text-muted-foreground -mt-3">
            {d.stats.exportModal.subtitle}
          </p>
        </div>

        {/*  Formato*/}
        <fieldset className="space-y-2">
          <legend className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">
            {d.stats.exportModal.formatLegend}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {FORMAT_KEYS.map(opt => {
              const isActive = format === opt.key
              return (
                <label
                  key={opt.key}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer transition-all duration-200 ${
                    isActive
                      ? 'border-brand/40 bg-brand/10 text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <input
                    type="radio"
                    name="export-format"
                    value={opt.key}
                    checked={isActive}
                    onChange={() => setFormat(opt.key)}
                    className="accent-brand size-4 shrink-0"
                  />
                  <span className="text-xs font-bold">{d.stats.exportModal.formats[opt.dictKey]}</span>
                  {opt.key === 'saft' && <BetaBadge />}
                </label>
              )
            })}
          </div>

          {/* Aviso específico do SAF-T (experimental). O ícone é só reforço
              visual; a mensagem por extenso é que transmite o significado. */}
          {format === 'saft' && (
            <Alert variant="warning" icon={<AlertTriangle aria-hidden="true" />}>
              <span className="font-bold">{d.stats.exportModal.saftWarningLabel}</span> {d.stats.exportModal.saftWarningText}
            </Alert>
          )}
        </fieldset>

        {/*  Período*/}
        <fieldset className="space-y-2">
          <legend className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">
            {d.stats.exportModal.periodLegend}
          </legend>
          <div className="flex flex-wrap gap-1 bg-muted/40 p-1 rounded-lg border border-border shadow-inner w-fit">
            {PRESET_KEYS.map(p => {
              const isActive = activePreset === p.key
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  aria-pressed={isActive}
                  aria-label={d.stats.exportModal.presetAriaLabel(d.stats.presets[p.dictKey])}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-all duration-200 ${
                    isActive
                      ? 'bg-brand/15 text-brand shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {d.stats.presets[p.dictKey]}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-end gap-4 pt-1">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="export-from" className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                {d.stats.dateRange.from}
              </label>
              <input
                id="export-from"
                type="date"
                value={from}
                onChange={e => handleFromChange(e.target.value)}
                className="bg-background border border-input rounded-lg px-3 py-2 text-base sm:text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors w-full sm:w-40"
              />
            </div>
            <span className="text-muted-foreground pb-2.5 text-xs">—</span>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="export-to" className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                {d.stats.dateRange.to}
              </label>
              <input
                id="export-to"
                type="date"
                value={to}
                onChange={e => handleToChange(e.target.value)}
                className="bg-background border border-input rounded-lg px-3 py-2 text-base sm:text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors w-full sm:w-40"
              />
            </div>
          </div>
          {!from && !to && (
            <p className="text-[11px] text-muted-foreground">{d.stats.exportModal.noDatesHint}</p>
          )}
        </fieldset>

        {/*  Secções (só XLSX e CSV)*/}
        {usesSections && (
          <fieldset className="space-y-2">
            <legend className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">
              {d.stats.exportModal.sectionsLegend}
            </legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {SECTION_KEYS.map(opt => {
                const checked = sections.includes(opt.key)
                return (
                  <label
                    key={opt.key}
                    className="flex items-center gap-2.5 py-1.5 cursor-pointer text-foreground/80 hover:text-foreground transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSection(opt.key)}
                      className="accent-brand size-4 shrink-0"
                    />
                    <span className="text-xs font-semibold">{d.stats.exportModal.sections[opt.dictKey]}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        )}

        {/*  Finalidade*/}
        <div className="space-y-1.5">
          <label htmlFor="export-purpose" className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
            {d.stats.exportModal.purposeLabel}
          </label>
          <input
            id="export-purpose"
            type="text"
            value={purpose}
            onChange={e => setPurpose(e.target.value)}
            placeholder={d.stats.exportModal.purposePlaceholder}
            aria-describedby="export-purpose-help"
            className="bg-background border border-input rounded-lg px-3 py-2 text-base sm:text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors w-full"
          />
          <p id="export-purpose-help" className="text-[11px] text-muted-foreground">
            {d.stats.exportModal.purposeHelp}
          </p>
        </div>

        {/*  Mensagens de validação e erro
            O Alert já marca com role="alert" (leitor de ecrã anuncia assim que
            aparece). A cor é só reforço: o texto explica sempre o problema. */}
        {validationMessage && <Alert variant="warning">{validationMessage}</Alert>}
        {error && <Alert variant="destructive">{error}</Alert>}

        {/*  Ações*/}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>
            {d.common.cancel}
          </Button>
          <Button type="button" size="lg" onClick={handleSubmit} disabled={!canExport}>
            <Download aria-hidden="true" className="size-4" />
            <span>{busy ? d.stats.exportModal.submitBusy : d.stats.exportModal.submit}</span>
          </Button>
        </div>

        {/*  Aviso legal (sempre visível)
            Texto legível por extenso (não fica só em title/placeholder) e marcado
            como nota para o leitor de ecrã. É o mesmo aviso que entra no ficheiro
            exportado, vindo da fonte única em export-meta.ts. */}
        <div role="note" aria-labelledby="export-legal-title" className="pt-4 border-t border-border space-y-1.5">
          <h3 id="export-legal-title" className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
            {d.stats.exportModal.legalTitle}
          </h3>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{LEGAL_NO_FISCAL}</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{LEGAL_CONFIDENTIAL_RGPD}</p>
        </div>

      </div>
    </Modal>
  )
}
