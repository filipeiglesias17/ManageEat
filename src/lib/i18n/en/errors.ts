// Namespace 'errors' do dicionário EN — o tipo espelha o PT: uma chave a
// faltar aqui é erro de compilação (paridade garantida pelo gate).

import type { errors as pt } from '../pt/errors'

export const errors: typeof pt = {
  // ── err_ (Postgres error codes) ─────────────────────────────────────────
  err_shift_required: 'You need to clock in before you can do this.',

  err_order_discount_staff_only: 'Only staff can apply a discount.',
  err_order_session_required: 'This order needs to be linked to a table session.',
  err_order_session_not_found: "This table's session no longer exists.",
  err_order_table_mismatch: "The order's table doesn't match the session.",
  err_order_session_closed: "This table's account isn't open.",
  err_order_session_expired: "This table's session has expired.",
  err_order_customer_no_table: "Your customer account isn't linked to a table.",
  err_order_customer_table_mismatch: (tableNumber: string) =>
    `You can only order for table ${tableNumber} on your profile.`,
  err_order_item_not_found: 'This item no longer exists on the menu.',
  err_order_item_unavailable: (name: string) => `"${name}" is no longer available.`,
  err_order_quantity_invalid: (name: string) => `The quantity for "${name}" is invalid.`,
  err_order_quantity_out_of_range: (name: string) =>
    `The quantity for "${name}" must be between 1 and 99.`,
  err_order_notes_too_long: (name: string) => `The notes for "${name}" are too long.`,
  err_order_removed_ingredient_invalid: (name: string) =>
    `One of the removed ingredients for "${name}" is no longer valid.`,
  err_order_rodizio_item_no_discount: "An item included in the rodízio can't have a discount.",
  err_order_item_discount_staff_only: 'Only staff can apply a discount to an item.',
  err_order_item_discount_incomplete: (name: string) => `The discount for "${name}" is incomplete.`,
  err_order_item_discount_invalid: (name: string) => `The discount for "${name}" is invalid.`,
  err_order_item_discount_over_100: "An item discount can't exceed 100%.",
  err_order_item_discount_exceeds_price: "An item discount can't exceed the item's price.",
  err_order_discount_incomplete: 'The overall discount is incomplete.',
  err_order_discount_invalid: 'The overall discount is invalid.',
  err_order_discount_over_100: "The overall discount can't exceed 100%.",
  err_order_discount_exceeds_subtotal: "The overall discount can't exceed the subtotal.",
  err_order_status_transition_invalid: "That order status change isn't allowed.",

  err_rodizio_snapshot_mismatch: "The rodízio details don't match the session.",
  err_rodizio_snapshot_invalid: 'The rodízio details are invalid.',
  err_rodizio_settings_mismatch: "The rodízio doesn't match the restaurant's current settings.",

  err_payment_session_required: 'This payment needs to be linked to a table session.',
  err_payment_table_mismatch: "The payment's table doesn't match the session.",
  err_payment_session_closed: "This table's account isn't open.",
  err_payment_shift_required: 'You need to be clocked in to close accounts.',
  err_payment_shift_invalid_or_closed: 'The given shift is invalid or already closed.',
  err_payment_shift_owner_mismatch: 'The shift must be your own.',
  err_payment_pending_orders: 'There are unfinished orders on this account.',
  err_payment_nothing_to_pay: 'This account has nothing to pay.',
  err_payment_amount_mismatch:
    "The total doesn't match the recalculated amount — check the account again.",

  err_session_pending_orders: (count: string) =>
    `There are ${count} order(s) still to be delivered — deliver or cancel them before closing.`,
  err_session_delete_open_account:
    'This permanent QR code has an open account — close the account before deleting it.',

  err_shift_staff_only: 'Only staff can clock in.',
  err_shift_close_forbidden: "Only the shift's owner or a manager can close it.",
  err_shift_already_closed: "This shift is already closed and can't be changed.",
  err_shift_update_forbidden: 'The only allowed change is clocking out.',

  err_rate_limited_orders: 'Too many orders in a row for this table — wait a moment.',
  err_rate_limited_service_calls: 'Too many calls in a row — wait a moment.',

  err_service_call_session_required: 'This call needs to be linked to a table session.',
  err_service_call_table_mismatch: "The call's table doesn't match the session.",
  err_service_call_session_closed: "This table's account isn't open.",
  err_service_call_session_expired: "This table's session has expired.",
  err_service_call_customer_table_mismatch: "You can only call for your profile's table.",
  err_service_call_duplicate_active: "There's already an active call of this type for this table.",
  err_service_call_only_status_changes: "Only the call's status can change.",
  err_service_call_resolved_immutable: "A resolved call can't be reopened.",
  err_service_call_status_transition_invalid: "That call status change isn't allowed.",

  // Admin repõe a password de outra conta (admin_set_user_password).
  err_user_password_admin_only: 'Only an administrator can change another account\'s password.',
  err_user_password_too_short: 'The password must be at least 12 characters long.',
  err_user_not_found: 'That account no longer exists.',
  err_user_password_admin_target: 'You cannot change another administrator\'s password here.',

  // Invariantes internas que a UI normal nunca dispara (payload forjado,
  // caminhos GUC só de servidor) — ver a migração 20260707150000_error_codes.sql
  // para a lista completa de onde isto aparece.
  err_invalid_operation: "This operation isn't allowed.",

  // Código Postgres desconhecido (função nova ainda sem tradução aqui).
  // Mostra o código para o staff conseguir reportar o problema.
  unknown: (code: string) => `An unexpected error occurred (${code}). Try again or call the waiter.`,

  // ── claim_ (claim_session_with_code reason codes) ───────────────────────
  claim_bloqueado: 'Too many wrong attempts — locked for 5 minutes.',
  claim_codigo_incorreto: 'Incorrect code.',
  claim_sessao_fechada: "This table's account isn't open yet.",
  claim_sessao_inexistente_ou_expirada: "Session doesn't exist or has expired.",
  claim_login_necessario: 'You need to be signed in.',

  // ── Erros lançados diretamente no cliente (fora de um trigger) ──────────
  sessionTableAlreadyOpen: (tableNumber: number) =>
    `Table ${tableNumber} already has an open account/session.`,
  menuImageUploadNotConfirmed: "The server didn't confirm the image upload.",
  menuImageUploadFailed: "Couldn't upload the image.",
  shiftAlreadyOpen: 'You already have an open shift.',
  userAlreadyExists: 'An account with that username already exists.',
  userAuthCreateFailed: 'Failed to create the authentication account.',
  exportTooLarge: (maxRows: number) =>
    `Export too large (>${maxRows} records). Choose a shorter date range.`,
}
