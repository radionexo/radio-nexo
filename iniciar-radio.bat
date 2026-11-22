@echo off
title RADIO NEXO - Servidor de Transmision (Gratis e Ilimitado)
color 0E
echo.
echo  ==========================================================
echo    RADIO NEXO - INICIANDO ANTENA DE TRANSMISION EN VIVO
echo    MP3 + Apple HLS (iOS) + Cloudflare Tunnel Ilimitado
echo  ==========================================================
echo.
cd /d "%~dp0bridge-server"
node start-tunnel.js
pause
