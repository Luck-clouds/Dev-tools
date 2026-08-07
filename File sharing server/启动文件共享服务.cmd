@echo off
setlocal

set "BASE_DIR=%~dp0"
set "NODE_EXE="

if not "%DEBUG_NODE_EXE%"=="" if exist "%DEBUG_NODE_EXE%" set "NODE_EXE=%DEBUG_NODE_EXE%"
if "%NODE_EXE%"=="" if exist "%BASE_DIR%..\node-v22.22.0-win-x64\node.exe" set "NODE_EXE=%BASE_DIR%..\node-v22.22.0-win-x64\node.exe"
if "%NODE_EXE%"=="" if exist "%BASE_DIR%..\node.exe" set "NODE_EXE=%BASE_DIR%..\node.exe"
if "%NODE_EXE%"=="" set "NODE_EXE=node"

if not exist "%BASE_DIR%server.js" (
  echo [ERROR] server.js not found
  pause
  exit /b 1
)

"%NODE_EXE%" "%BASE_DIR%server.js"

endlocal

