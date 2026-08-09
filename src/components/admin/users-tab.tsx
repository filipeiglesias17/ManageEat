import { useState, type FormEvent } from 'react'
import { UserPlus, Pencil, Trash, UserCheck, Users, Eye, EyeOff, KeyRound } from 'lucide-react'
import type { AppProfile, UserRole } from '../../@types/user'
import { adminCreateUser, updateProfile, deactivateProfile } from '../../lib/db'
import { parseTableNumber } from '../../lib/helpers'
import { useUserForm } from '../../hooks/use-user-form'
import { useConfirmingId } from '../../hooks/use-confirming-id'
import { useAuth } from '../../lib/auth-context'
import { useDict } from '../../lib/i18n'
import { SetUserPasswordModal } from './set-user-password-modal'
import { Modal, ModalHeader } from '../modal'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { EmptyState } from '@/components/ui/empty-state'

interface UsersTabProps {
  users: AppProfile[]
  setUsers: React.Dispatch<React.SetStateAction<AppProfile[]>>
  managedRoles: UserRole[]
}

const roleColor: Record<string, string> = {
  gerente:   'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  empregado: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  cliente:   'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  cozinha:   'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
}

//  Peças partilhadas entre a tabela (desktop) e os cartões (telemóvel)
// Recebem os handlers por props para as duas vistas usarem a mesma lógica.

function UserRoleBadges({ user }: { user: AppProfile }) {
  const d = useDict()
  const roleLabel = d.users.roleLabel as Record<string, string>
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs px-2 py-1 rounded-full font-medium ${roleColor[user.role]}`}>
        {roleLabel[user.role]}
      </span>
      {user.role === 'cliente' && user.tableNumber != null && (
        <span className="text-xs px-2 py-1 rounded-full font-medium bg-muted text-foreground">
          {d.users.tableLabel(user.tableNumber)}
        </span>
      )}
    </div>
  )
}

function UserStatusBadge({ user }: { user: AppProfile }) {
  const d = useDict()
  return (
    <span className={`text-xs px-2 py-1 rounded-full font-medium ${user.active ? 'bg-brand/15 text-brand' : 'bg-muted text-muted-foreground'}`}>
      {user.active ? d.users.status.active : d.users.status.inactive}
    </span>
  )
}

type UserActionsProps = {
  user: AppProfile
  // Desativa todos os botões enquanto uma ação de linha está a decorrer.
  actionInProgress: boolean
  // uid do utilizador cujo botão "Desativar" está no passo de confirmação
  // por uid, para clicar numa linha não confirmar as outras.
  confirmingUid: string | null
  onEdit: (user: AppProfile) => void
  onRequestDeactivate: (uid: string) => void
  onCancelDeactivate: () => void
  onDeactivate: (uid: string) => void
  onReactivate: (uid: string) => void
  // Só o admin pode mudar a password de terceiros (a BD reforça-o); a UI só o
  // mostra a admin e para contas não-admin.
  canSetPassword: boolean
  onSetPassword: (user: AppProfile) => void
}

function UserActions({ user, actionInProgress, confirmingUid, onEdit, onRequestDeactivate, onCancelDeactivate, onDeactivate, onReactivate, canSetPassword, onSetPassword }: UserActionsProps) {
  const d = useDict()
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onEdit(user)}
        disabled={actionInProgress}
        className="h-9 w-9 flex rounded-md justify-center items-center border border-border bg-card hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
        title={d.users.actions.edit}
        aria-label={d.users.actions.editOf(user.username)}
      >
        <Pencil className="size-4" />
      </button>
      {canSetPassword && (
        <button
          onClick={() => onSetPassword(user)}
          disabled={actionInProgress}
          className="h-9 w-9 flex rounded-md justify-center items-center border border-border bg-card hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          title={d.users.actions.setPassword}
          aria-label={d.users.actions.setPasswordOf(user.username)}
        >
          <KeyRound className="size-4" />
        </button>
      )}
      {user.active ? (
        <ConfirmButton
          confirming={confirmingUid === user.uid}
          onRequestConfirm={() => onRequestDeactivate(user.uid)}
          onConfirm={() => onDeactivate(user.uid)}
          onCancel={onCancelDeactivate}
          disabled={actionInProgress}
          triggerIcon={<Trash className="size-4" />}
          triggerLabel={d.users.actions.deactivateOf(user.username)}
          triggerTitle={d.users.actions.deactivate}
          triggerClassName="h-9 w-9 flex rounded-md justify-center items-center border border-border bg-card hover:bg-destructive hover:text-destructive-foreground hover:border-destructive disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          confirmIcon={<Trash className="size-4" />}
          confirmLabel={d.users.actions.deactivate}
          confirmTitle={d.users.actions.deactivateConfirmTitle(user.username)}
        />
      ) : (
        <button
          onClick={() => onReactivate(user.uid)}
          disabled={actionInProgress}
          className="h-9 w-9 flex rounded-md justify-center items-center border border-border bg-card text-brand hover:bg-brand hover:text-white hover:border-brand disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={d.users.actions.reactivate}
          aria-label={d.users.actions.reactivateOf(user.username)}
        >
          <UserCheck className="size-4" />
        </button>
      )}
    </div>
  )
}

// Cartão de utilizador para ecrãs pequenos  os mesmos dados e ações da tabela.
function UserCard({ user, ...actionProps }: UserActionsProps) {
  return (
    <li className="bg-card border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <span className={`text-sm font-medium ${user.active ? '' : 'text-muted-foreground'}`}>{user.username}</span>
        <UserStatusBadge user={user} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <UserRoleBadges user={user} />
        <UserActions user={user} {...actionProps} />
      </div>
    </li>
  )
}

export function UsersTab({ users, setUsers, managedRoles }: UsersTabProps) {
  const d = useDict()
  const { profile } = useAuth()
  // Só o admin muda passwords de terceiros (a BD reforça-o via is_admin()).
  const callerIsAdmin = profile?.role === 'admin'
  const roleLabel = d.users.roleLabel as Record<string, string>
  const [showUserForm, setShowUserForm] = useState(false)
  const [editingUser, setEditingUser] = useState<AppProfile | null>(null)
  // Utilizador cuja password o admin está a mudar (abre o modal dedicado).
  const [passwordUser, setPasswordUser] = useState<AppProfile | null>(null)
  
  const createUserForm = useUserForm()
  const editUserForm = useUserForm()
  
  const [showCreatePassword, setShowCreatePassword] = useState(false)
  // uid da linha com uma ação (desativar/reativar) a decorrer: trava o
  // duplo-clique e desativa os botões enquanto a chamada não termina.
  const [actingUid, setActingUid] = useState<string | null>(null)
  const [rowError, setRowError] = useState('')
  // A confirmação de desativação é controlada por uid.
  const deactivateConfirm = useConfirmingId()

  // Fechar o modal de criação limpa também o erro, para não reaparecer velho.
  function closeCreateUser() {
    setShowUserForm(false)
    createUserForm.setError('')
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault()
    createUserForm.setError('')
    if (createUserForm.fields.username.trim().length < 2) { createUserForm.setError(d.users.errors.usernameTooShort); return }
    if (createUserForm.fields.password.trim().length < 12) { createUserForm.setError(d.users.errors.passwordTooShort); return }

    const existing = users.find((u) => u.username.toLowerCase() === createUserForm.fields.username.trim().toLowerCase())
    if (existing) {
      createUserForm.setError(existing.active
        ? d.users.errors.usernameTaken
        : d.users.errors.usernameTakenInactive)
      return
    }

    let clienteTable: number | undefined
    if (createUserForm.fields.role === 'cliente') {
      const tableNumber = parseTableNumber(createUserForm.fields.tableNumber)
      if (tableNumber === null) { createUserForm.setError(d.users.errors.tableNumberRequired); return }
      clienteTable = tableNumber
    }

    createUserForm.setSaving(true)
    try {
      const created = await adminCreateUser({
        username: createUserForm.fields.username.trim(),
        password: createUserForm.fields.password.trim(),
        role: createUserForm.fields.role,
        tableNumber: clienteTable,
      })
      setUsers((prev) => [...prev, created])
      createUserForm.reset()
      setShowUserForm(false)
      setShowCreatePassword(false)
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
      if (code === 'weak_password') {
        createUserForm.setError(d.users.errors.weakPassword)
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        createUserForm.setError(d.users.createModal.errorPrefix(msg))
      }
    } finally {
      createUserForm.setSaving(false)
    }
  }

  function openEditUser(user: AppProfile) {
    setEditingUser(user)
    editUserForm.load(user)
  }

  function closeEditUser() {
    setEditingUser(null)
    editUserForm.reset()
  }

  async function handleEditUser(e: FormEvent) {
    e.preventDefault()
    if (!editingUser) return
    editUserForm.setError('')
    if (editUserForm.fields.username.trim().length < 2) { editUserForm.setError(d.users.errors.usernameTooShort); return }

    const taken = users.some((u) => u.username.toLowerCase() === editUserForm.fields.username.trim().toLowerCase() && u.uid !== editingUser.uid)
    if (taken) { editUserForm.setError(d.users.errors.usernameTaken); return }

    const data: { username: string; role: UserRole; tableNumber?: number } = {
      username: editUserForm.fields.username.trim(),
      role: editUserForm.fields.role,
    }
    if (editUserForm.fields.role === 'cliente') {
      const tableNumber = parseTableNumber(editUserForm.fields.tableNumber)
      if (tableNumber === null) { editUserForm.setError(d.users.errors.tableNumberRequired); return }
      data.tableNumber = tableNumber
    }
    editUserForm.setSaving(true)
    try {
      await updateProfile(editingUser.uid, data)
      setUsers((prev) => prev.map((u) => u.uid === editingUser.uid ? { ...u, ...data } : u))
      closeEditUser()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      editUserForm.setError(d.users.editModal.errorPrefix(msg))
    } finally {
      editUserForm.setSaving(false)
    }
  }

  async function handleDeleteUser(uid: string) {
    if (actingUid) return
    setRowError('')
    setActingUid(uid)
    try {
      await deactivateProfile(uid)
      // Só atualizamos a lista depois de a BD confirmar  evita mostrar um
      // estado que afinal não foi gravado se a chamada falhar.
      setUsers((prev) => prev.map((u) => u.uid === uid ? { ...u, active: false } : u))
      deactivateConfirm.confirmed(uid)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRowError(d.users.errors.deactivateFailedPrefix(msg))
    } finally {
      setActingUid(null)
    }
  }

  async function handleReactivateUser(uid: string) {
    if (actingUid) return
    setRowError('')
    setActingUid(uid)
    try {
      await updateProfile(uid, { active: true })
      setUsers((prev) => prev.map((u) => u.uid === uid ? { ...u, active: true } : u))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRowError(d.users.errors.reactivateFailedPrefix(msg))
    } finally {
      setActingUid(null)
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold flex items-center gap-2">
          {d.users.title}
        </h1>
        <Button size="lg" onClick={() => setShowUserForm(true)}>
          <UserPlus />
          {d.users.createButton}
        </Button>
      </div>

      {rowError && <Alert variant="destructive">{rowError}</Alert>}

      {users.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={d.users.empty.title}
          description={d.users.empty.description}
          compact
        />
      ) : (
        <>
          {/* Tabela só em ecrã largo; no telemóvel a lista de cartões abaixo
              mostra os mesmos dados sem scroll horizontal. */}
          <div className="hidden sm:block bg-card border border-border rounded-lg overflow-hidden shadow-sm mb-4">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm min-w-[480px]">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left py-4 px-5 font-semibold text-foreground">{d.users.columns.user}</th>
                    <th className="text-left py-4 px-5 font-semibold text-foreground">{d.users.columns.role}</th>
                    <th className="text-left py-4 px-5 font-semibold text-foreground">{d.users.columns.status}</th>
                    <th className="text-left py-4 px-5 font-semibold text-foreground">{d.users.columns.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((user) => (
                    <tr key={user.uid} className="hover:bg-accent transition-colors">
                      <td className={`py-3 px-5 font-medium ${user.active ? '' : 'text-muted-foreground'}`}>{user.username}</td>
                      <td className="py-3 px-5">
                        <UserRoleBadges user={user} />
                      </td>
                      <td className="py-3 px-4">
                        <UserStatusBadge user={user} />
                      </td>
                      <td className="py-3 px-4">
                        <UserActions
                          user={user}
                          actionInProgress={actingUid !== null}
                          confirmingUid={deactivateConfirm.confirmingId}
                          onEdit={openEditUser}
                          onRequestDeactivate={deactivateConfirm.requestConfirm}
                          onCancelDeactivate={deactivateConfirm.cancel}
                          onDeactivate={handleDeleteUser}
                          onReactivate={handleReactivateUser}
                          canSetPassword={callerIsAdmin && user.role !== 'admin'}
                          onSetPassword={setPasswordUser}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="sm:hidden space-y-2">
            {users.map((user) => (
              <UserCard
                key={user.uid}
                user={user}
                actionInProgress={actingUid !== null}
                confirmingUid={deactivateConfirm.confirmingId}
                onEdit={openEditUser}
                onRequestDeactivate={deactivateConfirm.requestConfirm}
                onCancelDeactivate={deactivateConfirm.cancel}
                onDeactivate={handleDeleteUser}
                onReactivate={handleReactivateUser}
                canSetPassword={callerIsAdmin && user.role !== 'admin'}
                onSetPassword={setPasswordUser}
              />
            ))}
          </ul>
        </>
      )}

      {/*  Modal: Mudar password (só admin)*/}
      {passwordUser && (
        <SetUserPasswordModal user={passwordUser} onClose={() => setPasswordUser(null)} />
      )}

      {/*  Modal: Criar Utilizador*/}
      {showUserForm && (
        <Modal maxWidth="max-w-sm" onClose={closeCreateUser} aria-labelledby="new-user-title">
          <ModalHeader title={d.users.createModal.title} titleId="new-user-title" closeDisabled={createUserForm.saving} />
          <form onSubmit={handleCreateUser} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{d.users.createModal.usernameLabel}</label>
              <input
                value={createUserForm.fields.username}
                onChange={(e) => createUserForm.setField('username', e.target.value)}
                autoComplete="off"
                className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{d.users.createModal.passwordLabel}</label>
              <div className="relative">
                <input
                  type={showCreatePassword ? 'text' : 'password'}
                  value={createUserForm.fields.password}
                  onChange={(e) => createUserForm.setField('password', e.target.value)}
                  autoComplete="new-password"
                  className="border border-input rounded-sm px-3 py-2 pr-10 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <button
                  type="button"
                  onClick={() => setShowCreatePassword((v) => !v)}
                  aria-label={showCreatePassword ? d.common.password.hide : d.common.password.show}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showCreatePassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{d.users.createModal.roleLabel}</label>
              <select
                value={createUserForm.fields.role}
                onChange={(e) => createUserForm.setField('role', e.target.value as UserRole)}
                className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {managedRoles.map((r) => (
                  <option key={r} value={r}>{roleLabel[r]}</option>
                ))}
              </select>
            </div>

            {createUserForm.fields.role === 'cliente' && (
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">{d.users.createModal.tableLabel}</label>
                <input
                  type="number"
                  min="1"
                  value={createUserForm.fields.tableNumber}
                  onChange={(e) => createUserForm.setField('tableNumber', e.target.value)}
                  className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <p className="text-xs text-muted-foreground">{d.users.tableHelp}</p>
              </div>
            )}

            <p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-sm px-3 py-2">
              {d.users.createModal.footnote}
            </p>

            {createUserForm.error && <Alert variant="destructive">{createUserForm.error}</Alert>}

            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={closeCreateUser}>
                {d.common.cancel}
              </Button>
              <Button type="submit" disabled={createUserForm.saving}>
                {createUserForm.saving ? d.users.createModal.submitting : d.users.createModal.submit}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/*  Modal: Editar Utilizador*/}
      {editingUser && (
        <Modal maxWidth="max-w-sm" onClose={closeEditUser} aria-labelledby="edit-user-title">
          <ModalHeader title={d.users.editModal.title} titleId="edit-user-title" closeDisabled={editUserForm.saving} />
          <form onSubmit={handleEditUser} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{d.users.editModal.usernameLabel}</label>
              <input
                value={editUserForm.fields.username}
                onChange={(e) => editUserForm.setField('username', e.target.value)}
                autoComplete="off"
                className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>

            <p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-sm px-3 py-2">
              {d.users.editModal.passwordNote}
            </p>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{d.users.editModal.roleLabel}</label>
              <select
                value={editUserForm.fields.role}
                onChange={(e) => editUserForm.setField('role', e.target.value as UserRole)}
                className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {managedRoles.map((r) => (
                  <option key={r} value={r}>{roleLabel[r]}</option>
                ))}
              </select>
            </div>

            {editUserForm.fields.role === 'cliente' && (
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">{d.users.editModal.tableLabel}</label>
                <input
                  type="number"
                  min="1"
                  value={editUserForm.fields.tableNumber}
                  onChange={(e) => editUserForm.setField('tableNumber', e.target.value)}
                  className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <p className="text-xs text-muted-foreground">{d.users.tableHelp}</p>
              </div>
            )}

            {editUserForm.error && <Alert variant="destructive">{editUserForm.error}</Alert>}

            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={closeEditUser}>
                {d.common.cancel}
              </Button>
              <Button type="submit" disabled={editUserForm.saving}>
                {editUserForm.saving ? d.users.editModal.submitting : d.users.editModal.submit}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
