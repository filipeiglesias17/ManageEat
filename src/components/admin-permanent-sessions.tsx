import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { QrCode, Trash, Printer } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { getSessions, createSession, deleteSession } from '../lib/db'
import type { QrSession } from '../lib/db'
import { parseTableNumber, randomHexId, sessionUrl, formatDate } from '../lib/helpers'
import { Modal, ModalHeader } from './modal'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { useMyShift } from '../lib/shift-context'
import { SHIFT_GATE_MESSAGE } from '../lib/shift-gate'
import { useConfirmingId } from '../hooks/use-confirming-id'
import { useDict } from '../lib/i18n'

export function AdminPermanentSessions() {
  const d = useDict()
  const [sessions, setSessions] = useState<QrSession[]>([])
  const [newTable, setNewTable] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<QrSession | null>(null)
  // O gerente precisa de turno aberto; o administrador está isento.
  const { canOperate } = useMyShift()
  // A confirmação pertence à sessão escolhida, não à tabela inteira.
  const deleteConfirm = useConfirmingId()

  const fetchPermanentSessions = useCallback(async () => {
    try {
      const all = await getSessions()
      setSessions(all.filter((s) => !s.expiresAt))
    } catch (err) {
      setError(d.admin.permanentSessions.loadErrorPrefix(err instanceof Error ? err.message : String(err)))
    }
  }, [d])

  useEffect(() => {
    void fetchPermanentSessions()
  }, [fetchPermanentSessions])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError('')
    // A base de dados aplica a mesma regra; esta guarda melhora a mensagem.
    if (!canOperate) { setError(SHIFT_GATE_MESSAGE); return }
    const num = parseTableNumber(newTable)
    if (num === null) { setError(d.admin.permanentSessions.invalidTableNumber); return }
    if (sessions.some((s) => s.tableNumber === num)) {
      setError(d.admin.permanentSessions.duplicateTableNumber)
      return
    }

    setCreating(true)
    try {
      const created = await createSession(
        { id: randomHexId(8), tableNumber: num, createdAt: new Date().toISOString() },
        { permanent: true },
      )
      setSessions((prev) => [...prev, created])
      setNewTable('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(d.admin.permanentSessions.createErrorPrefix(msg))
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(s: QrSession) {
    // Guarda adicional para chamadas que não passem pelo botão.
    if (!canOperate) { setError(SHIFT_GATE_MESSAGE); return }
    // Um QR com conta aberta tem de continuar acessível ao cliente.
    if (s.open === true) {
      setError(d.admin.permanentSessions.deleteBlockedOpenAccount(s.tableNumber))
      return
    }
    try {
      await deleteSession(s.id)
    } catch (err) {
      setError(d.admin.permanentSessions.deleteErrorPrefix(err instanceof Error ? err.message : String(err)))
      return
    }
    deleteConfirm.confirmed(s.id)
    setSessions((prev) => prev.filter((x) => x.id !== s.id))
    if (viewing?.id === s.id) setViewing(null)
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">{d.admin.permanentSessions.title}</h2>
      </div>

      <form onSubmit={handleCreate} className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          type="number"
          min="1"
          value={newTable}
          onChange={(e) => { setNewTable(e.target.value); setError('') }}
          placeholder={d.admin.permanentSessions.tableNumberPlaceholder}
          className="border border-input rounded-sm px-3 py-2 bg-background text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 text-sm w-40"
        />
        <Button
          type="submit"
          disabled={creating || !canOperate}
          title={canOperate ? undefined : SHIFT_GATE_MESSAGE}
        >
          <QrCode />
          {creating ? d.admin.permanentSessions.generating : d.admin.permanentSessions.generateButton}
        </Button>
      </form>

      {!canOperate && <p className="text-xs text-warning mb-4">{SHIFT_GATE_MESSAGE}</p>}

      {error && <Alert variant="destructive" className="mb-4">{error}</Alert>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-t-2 border-b-2 border-border min-w-[480px]">
          <thead>
            <tr>
              <th className="text-left py-3 px-4 font-medium text-foreground">{d.admin.permanentSessions.columns.table}</th>
              <th className="text-left py-3 px-4 font-medium text-foreground">{d.admin.permanentSessions.columns.created}</th>
              <th className="text-left py-3 px-4 font-medium text-foreground">{d.admin.permanentSessions.columns.actions}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr>
                <td colSpan={3} className="py-6 px-4 text-muted-foreground">{d.admin.permanentSessions.empty}</td>
              </tr>
            )}
            {sessions
              .slice()
              .sort((a, b) => a.tableNumber - b.tableNumber)
              .map((s) => (
                <tr key={s.id} className="border-b border-border">
                  <td className="py-3 px-4 font-medium">{d.admin.orders.tableLabel(s.tableNumber)}</td>
                  <td className="py-3 px-4 text-muted-foreground">
                    {formatDate(s.createdAt)}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setViewing(s)}
                        className="h-8 w-8 flex rounded-md justify-center items-center border border-border bg-card hover:bg-accent"
                        title={d.admin.permanentSessions.viewQr}
                        aria-label={d.admin.permanentSessions.viewQrOf(s.tableNumber)}
                      >
                        <QrCode className="size-4" />
                      </button>
                      <ConfirmButton
                        confirming={deleteConfirm.isConfirming(s.id)}
                        onRequestConfirm={() => deleteConfirm.requestConfirm(s.id)}
                        onConfirm={() => handleDelete(s)}
                        onCancel={deleteConfirm.cancel}
                        disabled={s.open === true || !canOperate}
                        triggerIcon={<Trash className="size-4" />}
                        triggerLabel={d.admin.permanentSessions.deleteOf(s.tableNumber)}
                        triggerTitle={
                          s.open === true
                            ? d.admin.permanentSessions.deleteBlockedTitle
                            : !canOperate
                              ? SHIFT_GATE_MESSAGE
                              : d.admin.permanentSessions.delete
                        }
                        triggerClassName="h-8 w-8 flex rounded-md justify-center items-center border border-border bg-card hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card"
                        confirmIcon={<Trash className="size-4" />}
                        confirmLabel={d.admin.permanentSessions.delete}
                        confirmTitle={d.admin.permanentSessions.deleteConfirmTitle(s.tableNumber)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {viewing && (
        <>
          <Modal maxWidth="max-w-md" onClose={() => setViewing(null)} aria-labelledby="qr-modal-title">
            <ModalHeader title={d.admin.permanentSessions.qrModal.titleFor(viewing.tableNumber)} titleId="qr-modal-title" />
            <div className="flex flex-col items-center gap-5">
              <div className="bg-white p-4 rounded-sm">
                <QRCodeSVG value={sessionUrl(viewing.id)} size={220} />
              </div>
              <div className="w-full bg-muted rounded-sm px-3 py-2 text-xs text-muted-foreground font-mono break-all text-center select-all">
                {sessionUrl(viewing.id)}
              </div>
              <Button size="lg" className="w-full mt-1" onClick={() => window.print()}>
                <Printer />
                {d.admin.permanentSessions.qrModal.printButton}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                {d.admin.permanentSessions.qrModal.neverExpires}
              </p>
            </div>
          </Modal>

          {createPortal(
            <div id="qr-print-section" className="hidden print:flex print:flex-col print:items-center print:justify-center print:fixed print:inset-0 print:bg-white print:text-black print:z-[99999]">
              <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                  body {
                    background: white !important;
                    color: black !important;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                  }
                  #root {
                    display: none !important;
                  }
                  #qr-print-section {
                    display: flex !important;
                    position: fixed !important;
                    inset: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    align-items: center !important;
                    justify-content: center !important;
                    background: white !important;
                    color: black !important;
                  }
                }
              ` }} />
              <div className="flex flex-col items-center justify-center text-center">
                <h1 className="text-6xl font-black mb-8 text-black tracking-wide">{d.admin.permanentSessions.print.tableLabel(viewing.tableNumber)}</h1>
                <div className="bg-white p-6 border-4 border-black rounded-lg shadow-sm">
                  <QRCodeSVG value={sessionUrl(viewing.id)} size={320} />
                </div>
                <p className="text-lg font-mono text-zinc-800 mt-8 select-all">
                  {sessionUrl(viewing.id)}
                </p>
                <p className="text-sm text-zinc-500 mt-4 font-sans">
                  {d.admin.permanentSessions.print.instructions}
                </p>
              </div>
            </div>,
            document.body
          )}
        </>
      )}
    </section>
  )
}
