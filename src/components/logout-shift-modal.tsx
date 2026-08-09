import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Modal, ModalFooter, ModalHeader } from './modal'
import { Button } from '@/components/ui/button'
import { closeShift } from '../lib/db'
import { formatDateTime } from '../lib/helpers'
import { useDict } from '../lib/i18n'
import type { Shift } from '../@types/shift'

interface Props {
  // Turno aberto de quem está a sair.
  shift: Shift
  uid: string
  onLogout: () => Promise<void>
  onCancel: () => void
}

// Aviso ao sair com o turno ainda aberto. Terminar sessão não fecha o turno
// de propósito — pausas e trocas de aparelho são legítimas — mas quem se ia
// embora esquecido tem aqui o botão certo. (Quem sair na mesma e se esquecer,
// o auto-fecho das definições apanha o turno mais tarde.)
export function LogoutShiftModal({ shift, uid, onLogout, onCancel }: Props) {
  const d = useDict()
  const [busy, setBusy] = useState<'punch' | 'logout' | null>(null)
  const [error, setError] = useState('')

  async function handlePunchOutAndLogout() {
    setBusy('punch')
    setError('')
    try {
      await closeShift(shift.id, uid)
      await onLogout()
    } catch (err) {
      setError(err instanceof Error ? err.message : d.layout.shiftStatusBar.punchOutError)
      setBusy(null)
    }
  }

  async function handleLogoutOnly() {
    setBusy('logout')
    try {
      await onLogout()
    } catch {
      // Se o signOut falhar (raro), volta a dar para tentar.
      setBusy(null)
    }
  }

  return (
    <Modal onClose={busy ? undefined : onCancel} aria-labelledby="logout-shift-title">
      <ModalHeader title={d.layout.logoutShiftModal.title} titleId="logout-shift-title" closeDisabled={!!busy} />
      <p className="text-sm text-muted-foreground">
        {d.layout.logoutShiftModal.body(formatDateTime(shift.openedAt, { timeStyle: 'short' }))}
      </p>
      {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
      <ModalFooter>
        <Button type="button" variant="ghost" size="lg" onClick={onCancel} disabled={!!busy}>
          {d.common.cancel}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={handleLogoutOnly} disabled={!!busy}>
          {busy === 'logout' ? d.layout.logoutShiftModal.loggingOut : d.layout.logoutShiftModal.logoutOnly}
        </Button>
        <Button type="button" size="lg" onClick={handlePunchOutAndLogout} disabled={!!busy}>
          <LogOut className="size-4" />
          {busy === 'punch' ? d.layout.logoutShiftModal.loggingOut : d.layout.logoutShiftModal.punchOutAndLogout}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
