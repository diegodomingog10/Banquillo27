#!/usr/bin/env bash
# Descarga los datos reales desde Kaggle (necesita ~/.kaggle/kaggle.json o una sesión con la credencial guardada).
# Se guardan en data/real/, que no se publica (.gitignore).
set -euo pipefail
cd "$(dirname "$0")/../.."
dl() { # $1 = dataset (usuario/nombre), $2 = carpeta
  mkdir -p "data/real/$2"
  local auth=()
  if [ -f "$HOME/.kaggle/kaggle.json" ]; then
    local u k
    u=$(python3 -I -c 'import json,os;print(json.load(open(os.path.expanduser("~/.kaggle/kaggle.json")))["username"])')
    k=$(python3 -I -c 'import json,os;print(json.load(open(os.path.expanduser("~/.kaggle/kaggle.json")))["key"])')
    auth=(-u "$u:$k")
  fi
  curl -sS -L --fail "${auth[@]}" -o "data/real/$2/data.zip" "https://www.kaggle.com/api/v1/datasets/download/$1"
  unzip -o -q "data/real/$2/data.zip" ${3:-} -d "data/real/$2/extracted"
}
dl mikedpad/ea-sports-fc27-player-ratings fc27-kaggle
dl davidcariboo/player-scores transfermarkt "players.csv clubs.csv competitions.csv countries.csv player_valuations.csv"
echo "Datos descargados en data/real/. Ahora: npm run real-db"
