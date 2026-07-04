@echo off
setlocal
title Curso ETABS + IA - INICIAR la app

if not exist "%~dp0servidor\osenv312\Scripts\python.exe" (
  echo [X] La app no esta instalada todavia: corre primero INSTALAR.bat
  pause
  exit /b 1
)
if not exist "%~dp0panel\node_modules" (
  echo [X] Falta instalar el panel: corre primero INSTALAR.bat
  pause
  exit /b 1
)

echo ==============================================================
echo    CURSO ETABS + IA  -  arrancando la app...
echo    Se abriran 2 ventanas negras (SERVIDOR y PANEL).
echo    NO las cierres mientras trabajas.
echo ==============================================================
start "SERVIDOR ETABS + IA (no cerrar)" /d "%~dp0servidor" cmd /k osenv312\Scripts\python.exe etabs_server.py
start "PANEL ETABS + IA (no cerrar)" /d "%~dp0panel" cmd /k npm run dev

echo Esperando a que arranquen (unos segundos)...
timeout /t 8 /nobreak >nul
start http://localhost:5173
echo.
echo Abri la app en tu navegador: http://localhost:5173
echo Si la pagina salio en blanco, espera 5 segundos y refresca con F5.
echo (Recuerda: ETABS abierto para conectar, y el boton SERVIDOR debe estar en verde.)
timeout /t 6 >nul
exit

