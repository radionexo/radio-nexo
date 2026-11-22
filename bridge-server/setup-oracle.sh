#!/usr/bin/env bash
set -e

echo "=================================================="
echo "  RADIO NEXO - Instalador Oracle Cloud (HTTPS)"
echo "  Dominio: https://stream.radionexo.co"
echo "=================================================="

# 1. Abrir puertos 80 y 443 en iptables de Ubuntu Oracle Cloud
echo "[1/3] Abriendo puertos 80 y 443 en el firewall interno..."
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save || true
fi

# 2. Instalar Docker y Docker Compose si no están presentes
if ! command -v docker >/dev/null 2>&1; then
  echo "[2/3] Instalando Docker..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
else
  echo "[2/3] Docker ya está instalado."
fi

# 3. Levantar bridge-server + Caddy (HTTPS automático con Let's Encrypt)
echo "[3/3] Compilando e iniciando NEXO Radio Bridge + Caddy HTTPS..."
sudo docker compose up -d --build

echo ""
echo "=================================================="
echo "  LISTO! Verifica en 15 segundos:"
echo "  https://stream.radionexo.co/status"
echo "=================================================="
