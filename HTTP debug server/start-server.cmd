@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title HTTP 调试服务器

set "BASE_DIR=%~dp0"
set "PARENT_DIR=%BASE_DIR%.."

rem ==================== 可编辑配置 ====================
rem false = HTTP；true = HTTPS（需要 PEM 私钥与证书）
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
rem ====================================================

set "NODE_EXE="
if not "%DEBUG_NODE_EXE%"=="" if exist "%DEBUG_NODE_EXE%" set "NODE_EXE=%DEBUG_NODE_EXE%"
if "!NODE_EXE!"=="" if exist "%PARENT_DIR%\node-v22.22.0-win-x64\node.exe" set "NODE_EXE=%PARENT_DIR%\node-v22.22.0-win-x64\node.exe"
if "!NODE_EXE!"=="" if exist "%PARENT_DIR%\node.exe" set "NODE_EXE=%PARENT_DIR%\node.exe"

if "!NODE_EXE!"=="" (
    where node >nul 2>nul
    if errorlevel 1 (
        echo [错误] 未找到 node.exe。
        echo [提示] 可设置 DEBUG_NODE_EXE 指向 node.exe 的完整路径。
        pause
        exit /b 1
    )
    set "NODE_EXE=node"
)

if not exist "%BASE_DIR%server.js" (
    echo [错误] 未找到 %BASE_DIR%server.js
    pause
    exit /b 1
)

if not exist "%DEBUG_SERVER_ROOT%" mkdir "%DEBUG_SERVER_ROOT%"

if /I "%DEBUG_SERVER_HTTPS%"=="true" (
    set "SERVER_PROTOCOL=https"
) else (
    set "SERVER_PROTOCOL=http"
)

echo ==========================================================
echo                    HTTP 调试服务器
echo ==========================================================
echo [信息] Node       : !NODE_EXE!
echo [信息] 地址       : !SERVER_PROTOCOL!://%DEBUG_SERVER_HOST%:%DEBUG_SERVER_PORT%
echo [信息] 静态目录   : %DEBUG_SERVER_ROOT%
echo [信息] HTTPS      : %DEBUG_SERVER_HTTPS%
if /I "%DEBUG_SERVER_HTTPS%"=="true" (
    echo [信息] 私钥       : %DEBUG_SERVER_HTTPS_KEY%
    echo [信息] 证书       : %DEBUG_SERVER_HTTPS_CERT%
)
echo ==========================================================
echo.

"!NODE_EXE!" "%BASE_DIR%server.js"

set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" echo [错误] 服务退出，退出码：%EXIT_CODE%
pause
endlocal
