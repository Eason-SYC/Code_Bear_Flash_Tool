@echo off
chcp 65001 > nul
echo Starting Code Bear Flasher Local Server...
cd /d "%~dp0"
npx http-server -p 8080 -c-1
pause