@echo off
setlocal enabledelayedexpansion
title HTTP Debug Server

set "BASE_DIR=%~dp0"
set "PARENT_DIR=%BASE_DIR%.."

rem Keep configuration in environment variables so this script remains ASCII-only.
if "%DEBUG_SERVER_HTTPS%"=="" set "DEBUG_SERVER_HTTPS=false"
if "%DEBUG_SERVER_HOST%"=="" set "DEBUG_SERVER_HOST=127.0.0.1"
if "%DEBUG_SERVER_ROOT%"=="" set "DEBUG_SERVER_ROOT=%BASE_DIR%public"

if /I "%DEBUG_SERVER_HTTPS%"=="true" (
    if "%DEBUG_SERVER_PORT%"=="" set "DEBUG_SERVER_PORT=8443"
    if "%DEBUG_SERVER_HTTPS_KEY%"=="" set "DEBUG_SERVER_HTTPS_KEY=%BASE_DIR%cert\server-key.pem"
    if "%DEBUG_SERVER_HTTPS_CERT%"=="" set "DEBUG_SERVER_HTTPS_CERT=%BASE_DIR%cert\server-cert.pem"
) else (
    if "%DEBUG_SERVER_PORT%"=="" set "DEBUG_SERVER_PORT=5050"
)

set "NODE_EXE="
if not "%DEBUG_NODE_EXE%"=="" if exist "%DEBUG_NODE_EXE%" set "NODE_EXE=%DEBUG_NODE_EXE%"
if "!NODE_EXE!"=="" if exist "%PARENT_DIR%\node-v22.22.0-win-x64\node.exe" set "NODE_EXE=%PARENT_DIR%\node-v22.22.0-win-x64\node.exe"
if "!NODE_EXE!"=="" if exist "%PARENT_DIR%\node.exe" set "NODE_EXE=%PARENT_DIR%\node.exe"

if "!NODE_EXE!"=="" (
    where node >nul 2>nul
    if errorlevel 1 (
        echo ERROR: node.exe was not found.
        echo Set DEBUG_NODE_EXE to the full path of node.exe and try again.
        pause
        exit /b 1
    )
    set "NODE_EXE=node"
)

if not exist "%BASE_DIR%server.js" (
    echo ERROR: server.js was not found.
    pause
    exit /b 1
)

if not exist "%DEBUG_SERVER_ROOT%" mkdir "%DEBUG_SERVER_ROOT%"

pushd "%BASE_DIR%"
"!NODE_EXE!" --no-warnings "server.js"
set "EXIT_CODE=%ERRORLEVEL%"
popd

if not "%EXIT_CODE%"=="0" echo ERROR: Server exited with code %EXIT_CODE%.
pause
endlocal
