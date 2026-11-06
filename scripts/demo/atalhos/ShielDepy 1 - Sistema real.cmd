@echo off
rem Abre o realworld (projeto real do GitHub) no VS Code, com a extensao gerada deste repositorio.
rem Na primeira vez clona e instala tudo; leva alguns minutos.
chcp 65001 >nul
cd /d "%~dp0..\..\.."
echo Atualizando as dependencias do ShielDepy...
call npm install --no-audit --no-fund
if errorlevel 1 goto erro
echo Preparando o projeto...
call npm run demo:real
if errorlevel 1 goto erro
echo Gerando a extensao...
call npm run package:vscode
if errorlevel 1 goto erro
for %%f in ("apps\vscode\shieldepy-*.vsix") do call code --install-extension "%%~ff" --force
if errorlevel 1 goto erro
call code --new-window "%USERPROFILE%\ShielDepy-real\realworld"
exit /b 0
:erro
echo.
echo Nao deu certo: veja a mensagem acima.
pause
exit /b 1
