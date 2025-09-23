#!/usr/bin/env bash
set -euo pipefail

# Hora local Buenos Aires
export TZ=America/Argentina/Buenos_Aires

DOW=$(date +%u)   # 1=Mon ... 7=Sun
HH=$(date +%H)    # 00..23
MM=$(date +%M)    # 00..59

# Ventana: Lunes(1) a Sábado(6), 09:30..23:30
IN_DAY=false
[[ $DOW -ge 1 && $DOW -le 6 ]] && IN_DAY=true

IN_TIME=false
# 10:00..22:59
if [[ $HH -ge 10 && $HH -le 22 ]]; then
  IN_TIME=true
# 09:30..09:59
elif [[ $HH -eq 9 && $MM -ge 30 ]]; then
  IN_TIME=true
# 23:00..23:30
elif [[ $HH -eq 23 && $MM -le 30 ]]; then
  IN_TIME=true
fi

if ! $IN_DAY || ! $IN_TIME; then
  echo "[hydrate-window] fuera de ventana, no hago nada. ($DOW $HH:$MM)"
  exit 0
fi

# --- tu comando real (incremental, sin rebuild) ---
MELI_HISTORY_DEBUG=0 node scripts/hydrate-history.js \
  --from=$(date -u -d '7 days ago' +%F) \
  --to=$(date -u +%F) \
  --delivered=false \
  --sort=updated_desc --limit=1200 --skip=0 \
  --timefield=estado

  
