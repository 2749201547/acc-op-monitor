@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo 这台电脑还没装 Node.js，无法直接运行。
  echo 请先安装 Node.js LTS：https://nodejs.org
  echo 装好后双击本文件即可，不必再手动 npm install。
  start https://nodejs.org/zh-cn/download
  pause
  exit /b 1
)

node scripts\launch.mjs
if errorlevel 1 pause
