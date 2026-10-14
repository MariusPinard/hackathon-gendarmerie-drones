@echo off
cd /d "%~dp0frontend"
where npm >nul 2>nul
if errorlevel 1 (
  echo Installez Node.js et npm, puis relancez ce fichier.
  pause
  exit /b 1
)
if not exist node_modules\.bin\vite.cmd (
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo V0.4 - Examen des analyses reelles enregistrees, sans validation operationnelle.
echo Dans l'interface : Examiner les six environnements, puis Afficher l'analyse enregistree.
echo Fermez ce terminal avec Ctrl+C pour arreter l'interface.
call npm run dev -- --open
if errorlevel 1 pause
