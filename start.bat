@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   AI画像チェッカー  起動
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [エラー] Node.js が見つかりません。https://nodejs.org からインストールしてください。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [初回] 依存パッケージをインストールします。少し時間がかかります...
  call npm install
  if errorlevel 1 (
    echo [エラー] インストールに失敗しました。
    pause
    exit /b 1
  )
)

echo 開発サーバを起動します。準備ができるとブラウザが自動で開きます。
echo （終了するには、このウィンドウで Ctrl+C を押してください）
echo.
call npm run dev -- --open

pause
