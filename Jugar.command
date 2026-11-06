#!/bin/bash
# Banquillo (macOS): doble clic para actualizar, arrancar el juego y abrirlo en el navegador.
cd "$(dirname "$0")" || exit 1
echo "Buscando actualizaciones..."
git pull --ff-only origin main || echo "(sin conexión o con cambios locales: se juega con la versión actual)"
if [ ! -d node_modules ]; then
  echo "Instalando dependencias, solo la primera vez..."
  npm install
fi
echo "Abriendo Banquillo en http://localhost:5173 (cierra esta ventana para salir del juego)"
npm run dev -- --open
