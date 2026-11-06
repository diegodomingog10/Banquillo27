@echo off
rem Banquillo: doble clic para actualizar, arrancar el juego y abrirlo en el navegador.
title Banquillo
cd /d "%~dp0"
echo Buscando actualizaciones...
git pull --ff-only origin main
if not exist node_modules (
  echo Instalando dependencias, solo la primera vez...
  call npm install
)
echo Abriendo Banquillo en http://localhost:5173  (cierra esta ventana para salir del juego)
call npm run dev -- --open
pause
