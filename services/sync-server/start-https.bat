@echo off
set "ROOT_DIR=%~dp0..\.."
echo [INFO] start-https.bat is now a compatibility wrapper.
echo [INFO] Use "%ROOT_DIR%\start.bat -prod -https" directly.
call "%ROOT_DIR%\start.bat" -prod -https -- %*
