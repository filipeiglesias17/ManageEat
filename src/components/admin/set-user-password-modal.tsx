import { useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { AppProfile } from '../../@types/user'
import { adminSetUserPassword } from '../../lib/db'
import { useDict } from '../../lib/i18n'
import { Modal, ModalHeader, ModalFooter } from '../modal'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

// Mínimo igual ao de criar contas e ao self "A minha conta" (12).
const MIN_PASSWORD = 12

// Admin redefine a password de OUTRO utilizador. Ao contrário do self modal
// (supabase.auth.updateUser), aqui a operação é privilegiada e passa pelo RPC
// admin_set_user_password (o browser nunca tem a service_role). A própria BD
// valida is_admin() e recusa alvos admin — a UI só é oferecida ao admin.
export function SetUserPasswordModal({ user, onClose }: { user: AppProfile; onClose: () => void }) {
  const d = useDict()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < MIN_PASSWORD) {
      setError(d.common.password.tooShort(MIN_PASSWORD))
      return
    }
    if (password !== confirmPassword) {
      setError(d.common.password.mismatch)
      return
    }

    setSaving(true)
    try {
      await adminSetUserPassword(user.uid, password)
      setDone(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(d.users.setPasswordModal.errorPrefix(msg))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-sm" aria-labelledby="set-user-password-title">
      <ModalHeader title={d.users.setPasswordModal.title(user.username)} titleId="set-user-password-title" closeDisabled={saving} />

      {done ? (
        <div className="space-y-4">
          <Alert>{d.users.setPasswordModal.success(user.username)}</Alert>
          <ModalFooter>
            <Button type="button" onClick={onClose}>{d.common.close}</Button>
          </ModalFooter>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <p className="text-xs text-muted-foreground">{d.users.setPasswordModal.description}</p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="set-user-password">{d.users.setPasswordModal.newPasswordLabel}</Label>
            <div className="relative">
              <Input
                id="set-user-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? d.common.password.hide : d.common.password.show}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{d.common.password.minHint(MIN_PASSWORD)}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="set-user-password-confirm">{d.common.password.confirmLabel}</Label>
            <Input
              id="set-user-password-confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {error && <Alert variant="destructive">{error}</Alert>}

          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>{d.common.cancel}</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <><Spinner className="size-4" />{d.users.setPasswordModal.submitting}</> : d.users.setPasswordModal.submit}
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  )
}
