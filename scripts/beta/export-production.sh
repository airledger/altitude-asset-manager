#!/usr/bin/env bash
# Reads the records beta needs from PRODUCTION into CSV files. Read-only: everything runs inside one
# READ ONLY transaction, so Postgres itself refuses any write. Also gives one consistent snapshot.
# Usage: PGPASSWORD=<production db password> export-production.sh <connection-url> <out-dir>
set -euo pipefail
DB="$1"; OUT="$2"; mkdir -p "$OUT"
psql "$DB" -X -q -v ON_ERROR_STOP=1 <<SQL
begin transaction isolation level repeatable read read only;
\copy (select instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at from auth.users) to '$OUT/users.csv' with (format csv, header)
\copy (select provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at from auth.identities) to '$OUT/identities.csv' with (format csv, header)
\copy (select id, name, slug, logo_url, created_by, created_at from public.orgs) to '$OUT/orgs.csv' with (format csv, header)
\copy (select org_id, user_id, email, role, created_at from public.members) to '$OUT/members.csv' with (format csv, header)
\copy (select user_id from public.platform_admins) to '$OUT/platform_admins.csv' with (format csv, header)
\copy (select require_invite, legacy_org from public.platform) to '$OUT/platform.csv' with (format csv, header)
\copy (select org_id, col, id, data, updated_at from public.docs) to '$OUT/docs.csv' with (format csv, header)
commit;
SQL
# Row counts only (header excluded); never print the data itself.
for f in "$OUT"/*.csv; do echo "$(basename "$f" .csv): $(($(wc -l < "$f") - 1))"; done
