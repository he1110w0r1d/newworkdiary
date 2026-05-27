set -eu

if [ -n "${DATABASE_URL:-}" ]; then
  npm run db:migrate
fi

exec npx tsx server/index.ts
