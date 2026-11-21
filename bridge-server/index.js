const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn, execSync } = require('child_process');
const url = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.PORT || process.env.BRIDGE_PORT || 8000;
const ICECAST_URL = process.env.ICECAST_SOURCE_URL || process.env.ICECAST_URL;
const STREAM_BITRATE_KBPS = parseInt(process.env.STREAM_BITRATE || '192', 10);
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const HLS_DIR = path.join(os.tmpdir(), 'nexo-radio-hls');
const HLS_PLAYLIST_PATH = path.join(HLS_DIR, 'live.m3u8');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function resetHlsDir() {
  try {
    fs.rmSync(HLS_DIR, { recursive: true, force: true });
  } catch {}
  fs.mkdirSync(HLS_DIR, { recursive: true });
}
resetHlsDir();

// Resolve FFmpeg binary: prefer native system ffmpeg (Alpine/Docker), fallback to ffmpeg-static (Render Native Node)
function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  try {
    const sysPath = execSync('which ffmpeg', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (sysPath) return sysPath;
  } catch {}
  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath && fs.existsSync(staticPath)) return staticPath;
  } catch {}
  return 'ffmpeg';
}

const FFMPEG_BIN = resolveFfmpegPath();

// ============================================================================
// BROADCAST STATE & MP3 FRAME-ALIGNED RING BURST BUFFER
// ============================================================================
const listeners = new Set();
let isBroadcasting = false;
let activeSourceType = null; // 'studio-ws' | 'icecast-source' | null
let broadcasterSocket = null;
let ffmpegProc = null;
let upstreamIcecastReq = null;
let gracePeriodTimer = null;
const startedAt = Date.now();

// Burst-on-connect buffer: ~96 KB (~4 seconds of 192kbps MP3 CBR)
// Guarantees instant playback (<300ms) and absorbs mobile 4G/5G jitter
const MAX_BURST_BYTES = Math.round((STREAM_BITRATE_KBPS * 1000 / 8) * 4);
const burstChunks = [];
let burstTotalBytes = 0;

// Grace period (ms) before disconnecting listeners when broadcaster drops briefly
const BROADCASTER_GRACE_MS = 6500;

/**
 * Find the first valid MP3 frame sync header (0xFF followed by 0xE0 mask)
 * so new listeners start cleanly on an exact MP3 frame boundary with zero pops/clicks.
 */
function alignToMp3Frame(buf) {
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      return i === 0 ? buf : buf.subarray(i);
    }
  }
  return buf;
}

function pushToBurstBuffer(chunk) {
  burstChunks.push(chunk);
  burstTotalBytes += chunk.length;
  while (burstTotalBytes > MAX_BURST_BYTES && burstChunks.length > 1) {
    const removed = burstChunks.shift();
    burstTotalBytes -= removed.length;
  }
}

function broadcastMp3Chunk(chunk) {
  if (!chunk || chunk.length === 0) return;

  // 1. Update ring pre-buffer
  pushToBurstBuffer(chunk);

  // 2. Fan-out to all active HTTP listeners
  for (const client of listeners) {
    if (client.writable && !client.destroyed) {
      // Disconnect dead/stalled listeners whose socket buffer grew > 2 MB
      if (client.writableLength && client.writableLength > 2 * 1024 * 1024) {
        try { client.end(); } catch {}
        listeners.delete(client);
        continue;
      }
      try {
        client.write(chunk);
      } catch {
        listeners.delete(client);
      }
    } else {
      listeners.delete(client);
    }
  }

  // 3. Optional upstream Icecast forward
  if (upstreamIcecastReq && !upstreamIcecastReq.destroyed) {
    try {
      upstreamIcecastReq.write(chunk);
    } catch (err) {
      console.warn('[Icecast Upstream] Write error:', err.message);
    }
  }
}

function stopFfmpegTranscoder() {
  if (ffmpegProc) {
    const proc = ffmpegProc;
    ffmpegProc = null;
    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.end();
      }
    } catch {}
    try {
      proc.kill('SIGTERM');
    } catch {}
  }
}

/**
 * Spawn a dual-output low-latency FFmpeg transcoder:
 * 1) Universal MP3 192kbps CBR on stdout (Desktop, Android, Discord, VLC)
 * 2) Native Apple HLS AAC 128kbps (.m3u8 + 2s .ts segments) for iPhone / iPad / Safari
 */
function startFfmpegTranscoder(inputFormat, hlsOnly = false) {
  stopFfmpegTranscoder();
  if (!fs.existsSync(HLS_DIR)) {
    fs.mkdirSync(HLS_DIR, { recursive: true });
  }

  const segPattern = path.join(HLS_DIR, 'seg_%05d.ts');

  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-fflags', '+nobuffer+discardcorrupt+genpts',
    '-flags', 'low_delay',
  ];

  if (inputFormat) {
    args.push('-f', inputFormat);
  } else {
    args.push('-probesize', '32768', '-analyzeduration', '500000');
  }

  args.push('-i', 'pipe:0', '-vn');

  if (hlsOnly) {
    // Secondary HLS muxer when Virtual DJ already sends clean MP3
    args.push(
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '5',
      '-hls_flags', 'delete_segments+omit_endlist+temp_file',
      '-hls_segment_filename', segPattern,
      HLS_PLAYLIST_PATH
    );
  } else {
    // Primary Dual Output: MP3 192k CBR + Native Apple HLS AAC 128k
    args.push(
      '-filter_complex', '[0:a]aresample=async=1:first_pts=0,asplit=2[a_mp3][a_hls]',
      '-map', '[a_mp3]',
      '-c:a', 'libmp3lame',
      '-b:a', `${STREAM_BITRATE_KBPS}k`,
      '-ar', '44100',
      '-ac', '2',
      '-reservoir', '0',
      '-f', 'mp3',
      'pipe:1',
      '-map', '[a_hls]',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '5',
      '-hls_flags', 'delete_segments+omit_endlist+temp_file',
      '-hls_segment_filename', segPattern,
      HLS_PLAYLIST_PATH
    );
  }

  console.log(`[Transcoder] Iniciando FFmpeg (${hlsOnly ? 'HLS-only' : `MP3 ${STREAM_BITRATE_KBPS}k + Apple HLS AAC 128k`}, input: ${inputFormat || 'auto'})`);

  const proc = spawn(FFMPEG_BIN, args, {
    stdio: ['pipe', hlsOnly ? 'ignore' : 'pipe', 'pipe'],
  });

  ffmpegProc = proc;

  if (!hlsOnly && proc.stdout) {
    proc.stdout.on('data', (mp3Chunk) => {
      broadcastMp3Chunk(mp3Chunk);
    });
  }

  proc.stderr.on('data', (errData) => {
    const msg = errData.toString().trim();
    if (msg) {
      console.warn(`[FFmpeg] ${msg}`);
    }
  });

  proc.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') {
      console.warn('[FFmpeg stdin] Error:', err.message);
    }
  });

  proc.on('error', (err) => {
    console.error('[Transcoder] Error al iniciar FFmpeg:', err.message);
    if (ffmpegProc === proc) {
      ffmpegProc = null;
    }
  });

  proc.on('exit', (code, signal) => {
    console.log(`[Transcoder] FFmpeg finalizó (code=${code}, signal=${signal})`);
    if (ffmpegProc === proc) {
      ffmpegProc = null;
    }
  });

  return proc;
}

function detectInputFormat(firstChunk) {
  if (!firstChunk || firstChunk.length < 4) return null;
  // EBML / WebM / Matroska magic bytes: 1A 45 DF A3
  if (firstChunk[0] === 0x1a && firstChunk[1] === 0x45 && firstChunk[2] === 0xdf && firstChunk[3] === 0xa3) {
    return 'webm';
  }
  // Ogg magic bytes: "OggS"
  if (firstChunk.toString('ascii', 0, 4) === 'OggS') {
    return 'ogg';
  }
  // MP4 / fMP4: contains "ftyp"
  if (firstChunk.indexOf('ftyp') !== -1) {
    return 'mp4';
  }
  return null;
}

function scheduleBroadcastTermination(sourceName) {
  console.log(`[Broadcast] Emisión pausada/desconectada (${sourceName}). Ventana de gracia de ${BROADCASTER_GRACE_MS}ms antes de cerrar oyentes...`);
  stopFfmpegTranscoder();
  broadcasterSocket = null;

  if (gracePeriodTimer) {
    clearTimeout(gracePeriodTimer);
  }

  gracePeriodTimer = setTimeout(() => {
    gracePeriodTimer = null;
    if (broadcasterSocket || ffmpegProc || activeSourceType === 'icecast-source') {
      // A broadcaster reconnected during the grace window! Keep listeners alive!
      return;
    }

    console.log(`[Broadcast] Fin definitivo de emisión (${sourceName}). Cerrando ${listeners.size} oyentes para fallback.`);
    isBroadcasting = false;
    activeSourceType = null;
    burstChunks.length = 0;
    burstTotalBytes = 0;
    resetHlsDir();

    for (const client of listeners) {
      try { client.end(); } catch {}
    }
    listeners.clear();

    if (upstreamIcecastReq) {
      try { upstreamIcecastReq.end(); } catch {}
      upstreamIcecastReq = null;
    }
  }, BROADCASTER_GRACE_MS);
}

// ============================================================================
// HTTP SERVER: STREAMING (/live), SOURCE (/live PUT/SOURCE), UPLOADS, STATUS
// ============================================================================
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 1. File Upload Endpoint: POST /upload?name=song.mp3
  if (req.method === 'POST' && parsed.pathname === '/upload') {
    const rawName = parsed.query?.name ? String(parsed.query.name) : 'audio.mp3';
    const safeExt = path.extname(rawName) || '.mp3';
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
    const targetPath = path.join(UPLOADS_DIR, filename);
    const writeStream = fs.createWriteStream(targetPath);

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || `localhost:${PORT}`;
      const fileUrl = `${protocol}://${host}/uploads/${filename}`;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ url: fileUrl, filename }));
    });

    writeStream.on('error', (err) => {
      console.error('[Upload] Error saving file:', err);
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // 2. Serve Uploaded Files: GET /uploads/:filename
  if (req.method === 'GET' && parsed.pathname.startsWith('/uploads/')) {
    const filename = path.basename(parsed.pathname);
    const targetPath = path.join(UPLOADS_DIR, filename);

    if (!fs.existsSync(targetPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('File not found');
      return;
    }

    const stat = fs.statSync(targetPath);
    const total = stat.size;
    const range = req.headers.range;
    const isImage = /\.(jpg|jpeg|png|webp)$/i.test(filename);
    const contentType = isImage ? 'image/jpeg' : 'audio/mpeg';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(targetPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(targetPath).pipe(res);
    }
    return;
  }

  // 3. Icecast / Shoutcast Source Endpoint (Virtual DJ, Mixxx, BUTT, OBS)
  const isSourceMount =
    parsed.pathname === '/live' ||
    parsed.pathname === '/live.mp3' ||
    parsed.pathname === '/broadcast' ||
    parsed.pathname === '/stream' ||
    parsed.pathname === '/stream.mp3' ||
    parsed.pathname === '/';

  if ((req.method === 'SOURCE' || req.method === 'PUT' || req.method === 'POST') && isSourceMount) {
    const authHeader = req.headers['authorization'] || '';
    const icePassword = req.headers['ice-password'] || req.headers['icy-password'] || parsed.query?.password || '';
    const expectedPassword = process.env.BRIDGE_PASSWORD || 'nexoradio2026';

    let authorized = true;
    if (expectedPassword) {
      if (icePassword && icePassword !== expectedPassword) {
        authorized = false;
      } else if (authHeader.startsWith('Basic ')) {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
        const parts = decoded.split(':');
        const pwd = parts.length > 1 ? parts[1] : parts[0];
        if (pwd && pwd !== expectedPassword) authorized = false;
      }
    }

    if (!authorized) {
      console.warn('[Icecast Source] Intento de conexión con contraseña inválida.');
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Invalid credentials\n');
      return;
    }

    if (gracePeriodTimer) {
      clearTimeout(gracePeriodTimer);
      gracePeriodTimer = null;
    }

    const incomingType = (req.headers['content-type'] || 'audio/mpeg').toLowerCase();
    const isAlreadyMp3 = incomingType.includes('mpeg') || incomingType.includes('mp3');

    console.log(`[Icecast Source] Virtual DJ / Encodificador conectado vía ${req.method} en ${parsed.pathname} (${incomingType})`);
    isBroadcasting = true;
    activeSourceType = 'icecast-source';
    stopFfmpegTranscoder();

    if (isAlreadyMp3) {
      // Pass MP3 directly to MP3 listeners AND feed lightweight HLS-only muxer for iOS Safari
      startFfmpegTranscoder('mp3', true);
    } else {
      // Transcode non-MP3 external source (e.g. Ogg/AAC) into both MP3 CBR & Apple HLS
      startFfmpegTranscoder(null, false);
    }

    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Connection': 'keep-alive',
    });
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    req.on('data', (chunk) => {
      if (isAlreadyMp3) {
        broadcastMp3Chunk(chunk);
      }
      if (ffmpegProc && ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) {
        try { ffmpegProc.stdin.write(chunk); } catch {}
      }
    });

    const handleSourceEnd = (reason) => {
      if (activeSourceType === 'icecast-source') {
        activeSourceType = null;
        scheduleBroadcastTermination(`Virtual DJ (${reason})`);
      }
    };

    req.on('end', () => handleSourceEnd('end'));
    req.on('close', () => handleSourceEnd('close'));
    return;
  }

  // 4. Health / Status endpoint
  if (parsed.pathname === '/status') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store',
    });
    res.end(
      JSON.stringify({
        status: 'online',
        version: '2.1.0-mp3-hls-ios',
        isBroadcasting,
        sourceType: activeSourceType,
        listenersCount: listeners.size,
        port: PORT,
        format: 'audio/mpeg',
        hlsReady: fs.existsSync(HLS_PLAYLIST_PATH),
        hlsUrl: '/hls/live.m3u8',
        bitrate: STREAM_BITRATE_KBPS,
        burstBytes: burstTotalBytes,
        ffmpegReady: Boolean(FFMPEG_BIN),
        upstreamIcecast: Boolean(ICECAST_URL),
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      })
    );
    return;
  }

  // 4.5 Native Apple HLS Stream for iPhone / iPad / Safari (/hls/live.m3u8 & /hls/seg_*.ts)
  if ((req.method === 'GET' || req.method === 'HEAD') && parsed.pathname.startsWith('/hls/')) {
    const fileName = path.basename(parsed.pathname);
    if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    const filePath = path.join(HLS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache, no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end('HLS stream initializing');
      return;
    }

    const isPlaylist = fileName.endsWith('.m3u8');
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': isPlaylist ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      'Content-Length': stat.size,
      'Cache-Control': isPlaylist ? 'no-cache, no-store, must-revalidate' : 'public, max-age=15',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // 5. Universal Live MP3 Audio Stream (/live, /live.mp3, /stream, /stream.mp3)
  if (
    parsed.pathname === '/live' ||
    parsed.pathname === '/live.mp3' ||
    parsed.pathname === '/stream' ||
    parsed.pathname === '/stream.mp3'
  ) {
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache, no-store',
        'Access-Control-Allow-Origin': '*',
        'icy-br': String(STREAM_BITRATE_KBPS),
      });
      res.end();
      return;
    }
    if (req.socket) {
      try { req.socket.setNoDelay(true); } catch {}
      try { req.socket.setKeepAlive(true, 10000); } catch {}
    }

    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store, no-transform, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Connection': 'keep-alive',
      'Transfer-Encoding': 'chunked',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
      'icy-name': 'RADIO NEXO - En Vivo',
      'icy-genre': 'Hits / Pop / Electronic',
      'icy-pub': '1',
      'icy-br': String(STREAM_BITRATE_KBPS),
    });

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    listeners.add(res);
    console.log(`[Stream] Nuevo oyente MP3 conectado. Total oyentes: ${listeners.size} (pre-buffer: ${(burstTotalBytes / 1024).toFixed(1)} KB)`);

    // Immediately flush MP3 frame-aligned pre-buffer (~4s) for instant zero-stutter start
    if (burstChunks.length > 0) {
      try {
        const combined = Buffer.concat(burstChunks);
        const aligned = alignToMp3Frame(combined);
        if (aligned.length > 0) {
          res.write(aligned);
        }
      } catch (err) {
        console.warn('[Stream] Error enviando pre-buffer MP3:', err.message);
      }
    }

    req.on('close', () => {
      listeners.delete(res);
      console.log(`[Stream] Oyente desconectado. Total oyentes: ${listeners.size}`);
    });

    return;
  }

  // Fallback for root
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`NEXO RADIO Broadcast-Grade MP3 Bridge v2.0 is running.\nStream: /live (audio/mpeg ${STREAM_BITRATE_KBPS}kbps)\nStatus: /status`);
});

// ============================================================================
// WEBSOCKET SERVER FOR NEXO STUDIO BROWSER BROADCASTER
// ============================================================================
const wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 });

server.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url).pathname;

  if (pathname === '/broadcast') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  console.log('[Broadcaster] NEXO Studio conectado al puente MP3.');

  // Cancel any pending disconnect grace period — seamless reconnect!
  if (gracePeriodTimer) {
    clearTimeout(gracePeriodTimer);
    gracePeriodTimer = null;
    console.log('[Broadcaster] Reconexión transparente dentro de la ventana de gracia (0 oyentes desconectados).');
  }

  // Close previous studio socket cleanly if one was lingering
  if (broadcasterSocket && broadcasterSocket !== ws) {
    try { broadcasterSocket.terminate(); } catch {}
  }

  isBroadcasting = true;
  activeSourceType = 'studio-ws';
  broadcasterSocket = ws;
  let transcoderStarted = false;

  // Optional: Connect to external Icecast server if configured
  setupIcecastUpstream();

  ws.on('message', (data) => {
    // Ignore small keepalive heartbeat pings (< 8 bytes)
    if (!data || data.length < 8) return;

    const chunk = Buffer.from(data);

    // Lazy-start FFmpeg on the first real audio chunk so we can auto-detect WebM vs MP4 vs Ogg
    if (!transcoderStarted || !ffmpegProc) {
      const detectedFormat = detectInputFormat(chunk);
      startFfmpegTranscoder(detectedFormat);
      transcoderStarted = true;
    }

    if (ffmpegProc && ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) {
      try {
        ffmpegProc.stdin.write(chunk);
      } catch (err) {
        console.warn('[Broadcaster] Error escribiendo en FFmpeg stdin:', err.message);
      }
    }
  });

  ws.on('close', () => {
    if (broadcasterSocket === ws) {
      scheduleBroadcastTermination('NEXO Studio WebSocket (close)');
    }
  });

  ws.on('error', (err) => {
    console.error('[Broadcaster] WebSocket error:', err.message);
    if (broadcasterSocket === ws) {
      scheduleBroadcastTermination('NEXO Studio WebSocket (error)');
    }
  });
});

function setupIcecastUpstream() {
  if (!ICECAST_URL || upstreamIcecastReq) return;

  try {
    const parsedIcecast = new URL(ICECAST_URL);
    const options = {
      hostname: parsedIcecast.hostname,
      port: parsedIcecast.port || 8000,
      path: parsedIcecast.pathname || '/live',
      method: 'PUT',
      headers: {
        'Content-Type': 'audio/mpeg',
        'Ice-Name': 'NEXO RADIO',
        'Ice-Genre': 'Hits',
        'Ice-Public': '1',
        'Ice-Audio-Info': `ice-samplerate=44100;ice-bitrate=${STREAM_BITRATE_KBPS};ice-channels=2`,
      },
    };

    if (parsedIcecast.username || parsedIcecast.password) {
      const auth = Buffer.from(`${parsedIcecast.username || 'source'}:${parsedIcecast.password || ''}`).toString('base64');
      options.headers['Authorization'] = `Basic ${auth}`;
    }

    upstreamIcecastReq = http.request(options, (res) => {
      console.log(`[Icecast Upstream] Connected with status: ${res.statusCode}`);
    });

    upstreamIcecastReq.on('error', (err) => {
      console.warn(`[Icecast Upstream] Connection failed: ${err.message}`);
      upstreamIcecastReq = null;
    });
  } catch (err) {
    console.warn('[Icecast Upstream] Setup failed:', err.message);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`NEXO RADIO Broadcast-Grade MP3 Bridge v2.0 Active`);
  console.log(`- HTTP Stream URL: http://localhost:${PORT}/live (audio/mpeg ${STREAM_BITRATE_KBPS}kbps CBR)`);
  console.log(`- WS Broadcast:    ws://localhost:${PORT}/broadcast`);
  console.log(`- Status:          http://localhost:${PORT}/status`);
  console.log(`- FFmpeg Binary:   ${FFMPEG_BIN}`);
  console.log(`- Burst PreBuffer: ${(MAX_BURST_BYTES / 1024).toFixed(0)} KB (~4s)`);
  if (ICECAST_URL) {
    console.log(`- Icecast Upstream: ${ICECAST_URL}`);
  }
  console.log(`=================================================`);
});
