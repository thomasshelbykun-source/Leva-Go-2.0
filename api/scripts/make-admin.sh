#!/usr/bin/env bash
# Dá o papel de super-administrador a uma conta já registada (usar uma vez, no arranque).
# Uso: scripts/make-admin.sh +258841234567 [--remote]
set -euo pipefail
PHONE="${1:?Indique o telefone no formato +258...}"
TARGET="${2:---local}"
[[ "$PHONE" =~ ^\+2588[2-7][0-9]{7}$ ]] || { echo "Telefone inválido: $PHONE" >&2; exit 1; }
EXTRA=()
[[ "$TARGET" == "--local" ]] && EXTRA=(--persist-to .wrangler/state)
npx wrangler d1 execute levago "$TARGET" "${EXTRA[@]}" --command \
  "INSERT OR IGNORE INTO user_roles (user_id, role) SELECT id, 'super_admin' FROM users WHERE phone = '$PHONE'; INSERT OR IGNORE INTO user_roles (user_id, role) SELECT id, 'admin' FROM users WHERE phone = '$PHONE';"
