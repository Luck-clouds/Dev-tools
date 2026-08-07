@echo off
setlocal enabledelayedexpansion
title Chat Room Server

set "BASE_DIR=%~dp0"
set "PARENT_DIR=%BASE_DIR%.."
set "NODE_EXE="

rem Use an explicitly configured Node executable first.
if not "%DEBUG_NODE_EXE%"=="" if exist "%DEBUG_NODE_EXE%" set "NODE_EXE=%DEBUG_NODE_EXE%"

rem Fall back to the portable Node.js bundled beside this service.
if "!NODE_EXE!"=="" if exist "%PARENT_DIR%\node-v22.22.0-win-x64\node.exe" set "NODE_EXE=%PARENT_DIR%\node-v22.22.0-win-x64\node.exe"
if "!NODE_EXE!"=="" if exist "%PARENT_DIR%\node.exe" set "NODE_EXE=%PARENT_DIR%\node.exe"

rem Finally try the Node.js available in PATH.
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

if not exist "%BASE_DIR%config.js" (
    echo ERROR: config.js was not found.
    pause
    exit /b 1
)

if not exist "%BASE_DIR%frontend\package.json" (
    echo ERROR: The Vue frontend project was not found.
    pause
    exit /b 1
)

if not exist "%BASE_DIR%node_modules\ws" (
    echo ERROR: The WebSocket dependency is not installed.
    echo Run npm install inside the Chat room server directory.
    pause
    exit /b 1
)

rem Build the Vue application before starting the chat service.
if exist "%PARENT_DIR%\node-v22.22.0-win-x64\corepack.cmd" (
    call "%PARENT_DIR%\node-v22.22.0-win-x64\corepack.cmd" pnpm --dir "%BASE_DIR%frontend" run build >nul 2>&1
) else (
    where pnpm >nul 2>nul
    if errorlevel 1 (
        echo ERROR: pnpm was not found.
        pause
        exit /b 1
    )
    call pnpm --dir "%BASE_DIR%frontend" run build >nul 2>&1
)

if errorlevel 1 (
    echo ERROR: The Vue frontend build failed.
    pause
    exit /b 1
)

pushd "%BASE_DIR%"
"!NODE_EXE!" --no-warnings "server.js"
set "EXIT_CODE=%ERRORLEVEL%"
popd

if not "%EXIT_CODE%"=="0" echo ERROR: Server exited with code %EXIT_CODE%.
pause
endlocal
