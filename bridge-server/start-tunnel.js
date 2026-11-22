const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_LOCAL_PATH = path.join(ROOT_DIR, '.env.local');
const CLOUDFLARED_BIN = path.join(__dirname, 'cloudflared.exe');
const PORT = process.env.PORT || '8000';

// 1. Load Supabase credentials from ../.env.local
function loadEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    vars[key] = val;
  }
  return vars;
}

const envVars = loadEnvFile(ENV_LOCAL_PATH);
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || envVars.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function syncBridgeUrlToSupabase(bridgeUrl) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[Sync] Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local');
    return;
  }

  const endpoint = new URL('/rest/v1/station_state?id=eq.current', SUPABASE_URL);
  const body = JSON.stringify({
    current_song_url: bridgeUrl,
    updated_at: new Date().toISOString(),
  });

  const req = https.request(
    endpoint,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal',
      },
    },
    (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('\n==============================================================');
        console.log('  ✅ RADIO NEXO ONLINE — SINCRONIZADO CON RADIONEXO.CO');
        console.log(`  📡 Túnel HTTPS:  ${bridgeUrl}`);
        console.log(`  🎧 Stream MP3:   ${bridgeUrl}/live`);
        console.log(`  🍎 Stream iOS:   ${bridgeUrl}/hls/live.m3u8`);
        console.log('  🎙️  Ya puedes abrir radionexo.co/studio y darle ENTRAR AL AIRE');
        console.log('  ⚠️  Deja esta ventana abierta mientras transmites.');
        console.log('==============================================================\n');
      } else {
        console.error(`[Sync] Error actualizando Supabase (HTTP ${res.statusCode})`);
      }
    }
  );

  req.on('error', (err) => {
    console.error('[Sync] Error de red con Supabase:', err.message);
  });

  req.write(body);
  req.end();
}

// 2. Start local MP3 + Apple HLS bridge-server
console.log('[1/2] Iniciando NEXO Radio Bridge Server (MP3 128k + Apple HLS iOS)...');
const bridgeProc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: {
    ...process.env,
    PORT,
    STREAM_BITRATE: process.env.STREAM_BITRATE || '128',
  },
  stdio: 'inherit',
});

bridgeProc.on('exit', (code) => {
  console.log(`[Bridge] Servidor detenido (código ${code}).`);
  process.exit(code || 0);
});

// 3. Start Cloudflare Quick Tunnel (100% gratis, tráfico ilimitado, HTTPS + WSS automático)
setTimeout(() => {
  if (!fs.existsSync(CLOUDFLARED_BIN)) {
    console.error('[Error] No se encontró bridge-server/cloudflared.exe');
    process.exit(1);
  }

  console.log('[2/2] Abriendo túnel HTTPS ilimitado con Cloudflare...');
  const tunnelProc = spawn(
    CLOUDFLARED_BIN,
    ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let syncedUrl = null;
  const handleTunnelOutput = (chunk) => {
    const text = chunk.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match && match[0] !== syncedUrl) {
      syncedUrl = match[0];
      syncBridgeUrlToSupabase(syncedUrl);
    }
  };

  tunnelProc.stdout.on('data', handleTunnelOutput);
  tunnelProc.stderr.on('data', handleTunnelOutput);

  tunnelProc.on('exit', (code) => {
    console.log(`[Cloudflare Tunnel] Cerrado (código ${code}).`);
    try { bridgeProc.kill(); } catch {}
    process.exit(code || 0);
  });

  process.on('SIGINT', () => {
    console.log('\nCerrando transmisión de Radio Nexo...');
    try { tunnelProc.kill(); } catch {}
    try { bridgeProc.kill(); } catch {}
    process.exit(0);
  });
}, 1000);
