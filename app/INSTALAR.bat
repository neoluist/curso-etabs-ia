@echo off
setlocal
title Curso ETABS + IA - INSTALAR la app (una sola vez)
echo ==============================================================
echo    CURSO ETABS + IA  -  Instalacion de la app (una sola vez)
echo ==============================================================
echo.

rem ---------- 1) Python 3.12 (el launcher py con version EXPLICITA) ----------
py -3.12 -c "import sys" >nul 2>&1
if errorlevel 1 (
  echo [X] No encuentro Python 3.12 en tu PC.
  echo.
  echo     Instala Python 3.12 desde  https://www.python.org/downloads/
  echo     - Cualquier 3.12.x sirve: 3.12.10, 3.12.13, etc.
  echo     - Si ya tienes OTRO Python ^(3.13, 3.14^) no pasa nada:
  echo       pueden convivir; este instalador usa "py -3.12" explicito.
  echo.
  echo     Luego vuelve a dar doble clic a este INSTALAR.bat
  pause
  exit /b 1
)
for /f %%v in ('py -3.12 -c "import sys;print(sys.version.split()[0])"') do set PYVER=%%v
echo [1/4] Python %PYVER% encontrado.

rem ---------- 2) Entorno del servidor ----------
cd /d "%~dp0servidor"
if exist osenv312\Scripts\python.exe (
  echo [2/4] El entorno osenv312 ya existe, lo reutilizo.
) else (
  echo [2/4] Creando el entorno del servidor ^(osenv312^)... puede tardar un momento.
  py -3.12 -m venv osenv312
  if errorlevel 1 (
    echo [X] No se pudo crear el entorno osenv312.
    pause
    exit /b 1
  )
)

rem ---------- 3) Cajas del servidor ----------
echo [3/4] Instalando las cajas del servidor (fastapi, uvicorn, comtypes, openpyxl)...
osenv312\Scripts\python.exe -m pip install --upgrade pip --quiet
osenv312\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 (
  echo [X] Fallo la instalacion de las cajas del servidor.
  echo     Revisa tu conexion a internet y vuelve a intentar.
  pause
  exit /b 1
)

rem ---------- 4) Cajas del panel (Node) ----------
where npm >nul 2>&1
if errorlevel 1 (
  echo [X] No encuentro npm ^(Node.js^).
  echo     Instala Node.js LTS desde  https://nodejs.org  ^(lo viste en la Parte 1^)
  echo     y vuelve a correr este instalador.
  pause
  exit /b 1
)
cd /d "%~dp0panel"
echo [4/4] Instalando las cajas del panel (npm install)... tarda unos minutos, es normal.
call npm install
if errorlevel 1 (
  echo [X] Fallo npm install. Revisa tu conexion a internet y vuelve a intentar.
  pause
  exit /b 1
)

echo.
echo ==============================================================
echo    LISTO. La app quedo instalada.
echo    A partir de ahora usa  INICIAR.bat  cada vez que trabajes.
echo ==============================================================
pause

