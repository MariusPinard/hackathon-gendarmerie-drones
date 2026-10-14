@echo off
cd /d "%~dp0frontend"
echo V0.4 - Examen des analyses reelles enregistrees, sans validation operationnelle.
echo Dans l'interface : Examiner les six environnements, puis Afficher l'analyse enregistree.
echo Fermez ce terminal avec Ctrl+C pour arreter l'interface.
call npm run dev -- --open
if errorlevel 1 pause
