@echo off
rem Demo da loja: checkout com os 6 achados, a branch de correcao e o portal local.
rem Deixe esta janela aberta: ela mantem o portal no ar (Ctrl+C encerra).
chcp 65001 >nul
cd /d "%~dp0..\..\.."
echo Atualizando as dependencias do ShielDepy...
call npm install --no-audit --no-fund
if errorlevel 1 goto fim
call npm run demo -- --compilar
:fim
pause
