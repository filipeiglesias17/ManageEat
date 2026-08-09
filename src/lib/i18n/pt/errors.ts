// Namespace 'errors' do dicionário PT. Preenchido à medida que as páginas
// migram as strings para aqui (interpolações = funções).
//
// Duas famílias de chaves:
// 1) `err_<área>_<motivo>`  códigos-máquina que vêm do Postgres (RLS/triggers,
//    ver supabase/migrations/20260707150000_error_codes.sql). `AppDbError`
//    (src/lib/db/base.ts) lê a mensagem daqui pelo código; nunca hard-coded no
//    SQL. `unknown` é o genérico para um código que não exista aqui (ex.:
//    função nova que ainda não foi traduzida).
// 2) `claim_<reason>`  os reason-codes do RPC `claim_session_with_code`
//    (ver src/lib/db/sessions.ts), que já eram machine-codes antes desta
//    migração (o padrão que estamos a generalizar).
// 3) O resto (ex.: `sessionTableAlreadyOpen`, `menuImageUploadFailed`) são
//    mensagens de erro lançadas diretamente no cliente (fora de um trigger),
//    movidas para aqui para teres a mesma tradução PT/EN em todo o lado.

export const errors = {
  //  err_ (códigos do Postgres)
  err_shift_required: 'É preciso picar o ponto antes de operar.',

  err_order_discount_staff_only: 'Só o staff pode aplicar desconto.',
  err_order_session_required: 'Este pedido precisa de estar ligado a uma sessão de mesa.',
  err_order_session_not_found: 'A sessão desta mesa já não existe.',
  err_order_table_mismatch: 'A mesa do pedido não corresponde à sessão.',
  err_order_session_closed: 'A conta desta mesa não está aberta.',
  err_order_session_expired: 'A sessão desta mesa expirou.',
  err_order_customer_no_table: 'A tua conta de cliente não está associada a nenhuma mesa.',
  err_order_customer_table_mismatch: (tableNumber: string) =>
    `Só podes pedir para a mesa ${tableNumber} do teu perfil.`,
  err_order_item_not_found: 'Este item já não existe no menu.',
  err_order_item_unavailable: (name: string) => `O item "${name}" deixou de estar disponível.`,
  err_order_quantity_invalid: (name: string) => `A quantidade de "${name}" é inválida.`,
  err_order_quantity_out_of_range: (name: string) =>
    `A quantidade de "${name}" tem de estar entre 1 e 99.`,
  err_order_notes_too_long: (name: string) => `As notas de "${name}" são demasiado longas.`,
  err_order_removed_ingredient_invalid: (name: string) =>
    `Um dos ingredientes removidos de "${name}" já não é válido.`,
  err_order_rodizio_item_no_discount: 'Um item incluído no rodízio não aceita desconto.',
  err_order_item_discount_staff_only: 'Só o staff pode aplicar desconto a um item.',
  err_order_item_discount_incomplete: (name: string) => `O desconto de "${name}" está incompleto.`,
  err_order_item_discount_invalid: (name: string) => `O desconto de "${name}" é inválido.`,
  err_order_item_discount_over_100: 'O desconto de um item não pode passar 100%.',
  err_order_item_discount_exceeds_price: 'O desconto de um item não pode ultrapassar o preço.',
  err_order_discount_incomplete: 'O desconto global está incompleto.',
  err_order_discount_invalid: 'O desconto global é inválido.',
  err_order_discount_over_100: 'O desconto global não pode passar 100%.',
  err_order_discount_exceeds_subtotal: 'O desconto global não pode ultrapassar o subtotal.',
  err_order_status_transition_invalid: 'Essa mudança de estado do pedido não é permitida.',

  err_rodizio_snapshot_mismatch: 'Os dados do rodízio não correspondem aos da sessão.',
  err_rodizio_snapshot_invalid: 'Os dados do rodízio são inválidos.',
  err_rodizio_settings_mismatch: 'O rodízio não corresponde às definições atuais do restaurante.',

  err_payment_session_required: 'Este pagamento precisa de estar ligado a uma sessão de mesa.',
  err_payment_table_mismatch: 'A mesa do pagamento não corresponde à sessão.',
  err_payment_session_closed: 'A conta desta mesa não está aberta.',
  err_payment_shift_required: 'É preciso estar em turno para fechar contas.',
  err_payment_shift_invalid_or_closed: 'O turno indicado é inválido ou já está fechado.',
  err_payment_shift_owner_mismatch: 'O turno tem de ser o teu próprio turno.',
  err_payment_pending_orders: 'Há pedidos por concluir nesta conta.',
  err_payment_nothing_to_pay: 'Esta conta não tem nenhum valor a pagar.',
  err_payment_amount_mismatch:
    'O total não corresponde ao valor recalculado — confirma a conta de novo.',

  err_session_pending_orders: (count: string) =>
    `Há ${count} pedido(s) por entregar nesta conta — entrega ou cancela antes de fechar.`,
  err_session_delete_open_account:
    'Este QR permanente tem a conta aberta — fecha a conta antes de apagar.',

  err_shift_staff_only: 'Só staff pode picar entrada.',
  err_shift_close_forbidden: 'Só o próprio ou um responsável pode fechar o turno.',
  err_shift_already_closed: 'Este turno já está fechado e não pode ser alterado.',
  err_shift_update_forbidden: 'A única alteração permitida é picar a saída.',

  err_rate_limited_orders: 'Demasiados pedidos seguidos nesta mesa — aguarda um momento.',
  err_rate_limited_service_calls: 'Demasiadas chamadas seguidas — aguarda um momento.',

  err_service_call_session_required: 'Esta chamada precisa de estar ligada a uma sessão de mesa.',
  err_service_call_table_mismatch: 'A mesa da chamada não corresponde à sessão.',
  err_service_call_session_closed: 'A conta desta mesa não está aberta.',
  err_service_call_session_expired: 'A sessão desta mesa expirou.',
  err_service_call_customer_table_mismatch: 'Só podes chamar para a mesa do teu perfil.',
  err_service_call_duplicate_active: 'Já existe uma chamada ativa deste tipo para esta mesa.',
  err_service_call_only_status_changes: 'Só o estado da chamada pode mudar.',
  err_service_call_resolved_immutable: 'Uma chamada já resolvida não pode voltar atrás.',
  err_service_call_status_transition_invalid: 'Essa mudança de estado da chamada não é permitida.',

  // Admin redefine password de utilizador (admin_set_user_password).
  err_user_password_admin_only: 'Só um administrador pode mudar a password de outra conta.',
  err_user_password_too_short: 'A password tem de ter pelo menos 12 caracteres.',
  err_user_not_found: 'Essa conta já não existe.',
  err_user_password_admin_target: 'Não é possível mudar a password de outro administrador por aqui.',

  // Invariantes internas que a UI normal nunca dispara (payload forjado,
  // caminhos só acessíveis por GUC do servidor)  ver a migração
  // 20260707150000_error_codes.sql para a lista completa de onde aparece.
  err_invalid_operation: 'Esta operação não é permitida.',

  // Código do Postgres desconhecido (função nova ainda não traduzida aqui).
  // Mostra o código para o staff poder reportar o problema.
  unknown: (code: string) => `Ocorreu um erro inesperado (${code}). Tenta novamente ou chama o empregado.`,

  //  claim_ (reason-codes de claim_session_with_code)
  claim_bloqueado: 'Demasiadas tentativas erradas — bloqueado durante 5 minutos.',
  claim_codigo_incorreto: 'Código incorreto.',
  claim_sessao_fechada: 'A conta desta mesa ainda não está aberta.',
  claim_sessao_inexistente_ou_expirada: 'Sessão inexistente ou expirada.',
  claim_login_necessario: 'É preciso iniciar sessão.',

  //  Erros lançados diretamente no cliente (fora de um trigger)
  sessionTableAlreadyOpen: (tableNumber: number) =>
    `A mesa ${tableNumber} já tem uma conta/sessão aberta.`,
  menuImageUploadNotConfirmed: 'O servidor não confirmou o upload da imagem.',
  menuImageUploadFailed: 'Não foi possível enviar a imagem.',
  shiftAlreadyOpen: 'Já tens um turno aberto.',
  userAlreadyExists: 'Já existe uma conta com esse utilizador.',
  userAuthCreateFailed: 'Falha a criar a conta de autenticação.',
  exportTooLarge: (maxRows: number) =>
    `Exportação demasiado grande (>${maxRows} registos). Escolhe um intervalo de datas mais curto.`,
}
