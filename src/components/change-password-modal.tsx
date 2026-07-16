import { useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useDict } from '../lib/i18n'
import { Modal, ModalHeader, ModalFooter } from './modal'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

// Mínimo de password igual ao de criar utilizadores (users-tab.tsx): 12.
const MIN_PASSWORD = 12

// Mudar a PRÓPRIA password. supabase.auth.updateUser é a operação padrão do
// utilizador autenticado sobre a sua conta — não precisa de service_role nem de
// RPC. Componente reutilizável (qualquer dashboard de staff pode abri-lo).
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
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
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setDone(true)
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
      if (code === 'same_password') {
        setError(d.layout.changePasswordModal.samePasswordError)
      } else {
        setError(d.layout.changePasswordModal.genericError)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} aria-labelledby="change-password-title">
      <ModalHeader title={d.layout.myAccountLabel} titleId="change-password-title" closeDisabled={saving} />

      {done ? (
        <div className="space-y-4">
          <Alert>{d.layout.changePasswordModal.success}</Alert>
          <ModalFooter>
            <Button type="button" onClick={onClose}>{d.common.close}</Button>
          </ModalFooter>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="change-password">{d.layout.changePasswordModal.newPasswordLabel}</Label>
            <div className="relative">
              <Input
                id="change-password"
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
            <Label htmlFor="change-password-confirm">{d.common.password.confirmLabel}</Label>
            <Input
              id="change-password-confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {error && <Alert variant="destructive">{error}</Alert>}

          <ModalFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>{d.common.cancel}</Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Spinner className="size-4" />
                  {d.common.saving}
                </>
              ) : (
                d.layout.changePasswordModal.submit
              )}
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  )
}
