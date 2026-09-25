@echo off
setlocal
title MOTOR TRT - servidor local
REM Siempre sirve desde la carpeta donde vive este .bat, sin importar desde donde se ejecute.
cd /d "%~dp0"

REM Si quedo un servidor viejo colgado en el puerto 8735, se cierra antes de arrancar.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8735" ^| findstr "LISTENING"') do (
    echo Cerrando proceso viejo en el puerto 8735 ^(PID %%p^)...
    taskkill /F /PID %%p >nul 2>&1
)

python --version >nul 2>&1
if %ERRORLEVEL%==0 (
    python serve.py 8735
    goto :eof
)
py -3 --version >nul 2>&1
if %ERRORLEVEL%==0 (
    py -3 serve.py 8735
    goto :eof
)
echo [ERROR] No se encontro Python. Instalalo desde https://www.python.org/downloads/
pause
endlocal
