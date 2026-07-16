export type UserRole = 'admin' | 'gerente' | 'empregado' | 'cliente' | 'cozinha'

// Perfil aplicacional de um utilizador autenticado. Vive na tabela `profiles`
// (id = auth.users.id) e é a fonte de verdade para role, username e estado
// ativo. A password nunca é guardada aqui — está no Supabase Auth.
export type AppProfile = {
  uid: string
  username: string
  role: UserRole
  active: boolean
  createdAt: string
  // Mesa fixa de uma conta `cliente` (tablet do restaurante numa mesa). Só faz
  // sentido para role 'cliente'; é o admin que a define. A RLS dos pedidos
  // exige que o pedido do cliente seja para esta mesa.
  tableNumber?: number
}
