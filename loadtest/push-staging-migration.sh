#!/usr/bin/env bash
# Push migrasi Supabase ke STAGING (bukan production).
# Password DB dibaca dari .env.staging (SUPABASE_DB_PASSWORD) — tidak perlu
# diketik manual dan tidak pernah masuk repo (file di-gitignore).
#
# Jalankan: bash loadtest/push-staging-migration.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.staging ]; then
    echo "FATAL: .env.staging tidak ditemukan." >&2
    exit 1
fi

PW=$(grep -E '^SUPABASE_DB_PASSWORD=' .env.staging | head -1 | cut -d'=' -f2-)
if [ -z "$PW" ]; then
    echo "FATAL: SUPABASE_DB_PASSWORD belum diisi di .env.staging" >&2
    exit 1
fi

STAGING_REF="vkkgnredrfqqraonynte"
# Koneksi via pooler ap-southeast-1 (region staging = Singapore).
# Hostname db.<ref> hanya resolve AAAA/IPv6 dan ditolak banyak jaringan;
# pooler ap-south-1 TIDAK mengenal tenant staging (ENOTFOUND) —
# hanya aws-0-ap-southeast-1 yang mengenal. User pooler: postgres.<ref>.
POOLER_HOST="aws-0-ap-southeast-1.pooler.supabase.com"
# Percent-encode password (karakter seperti # @ : / bisa merusak URL koneksi)
PW_ENC=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$PW")
DB_URL="postgres://postgres.${STAGING_REF}:${PW_ENC}@${POOLER_HOST}:5432/postgres"

echo "==> Push migrasi ke STAGING (${STAGING_REF}, via ${POOLER_HOST})..."
supabase db push --db-url "$DB_URL"
echo "==> Selesai. Verifikasi: supabase migration list --db-url (staging) atau cek kolom baru via REST."
