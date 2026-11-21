const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const ffmpegStatic = require('ffmpeg-static');
if (ffmpegStatic) {
  process.env.FFMPEG_PATH = ffmpegStatic;
}

const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  entersState,
} = require('@discordjs/voice');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const AUDIO_SOURCE = process.env.AUDIO_SOURCE || 'url'; // 'url' (Stream oficial) o 'device' (Cable VB local)
const STREAM_URL = process.env.STREAM_URL || 'https://nexo-radio-bridge-axxt.onrender.com/live';
const AUDIO_DEVICE = process.env.AUDIO_DEVICE || 'CABLE Output (VB-Audio Virtual Cable)';
const BITRATE = process.env.BITRATE || '128k';
const BASS_BOOST = process.env.BASS_BOOST || '2';

if (!TOKEN || !GUILD_ID || !CHANNEL_ID) {
  console.error('\n[Error de configuración] Falta configurar las variables en discord-bot/.env');
  console.error('Asegúrate de definir DISCORD_TOKEN, GUILD_ID y VOICE_CHANNEL_ID.\n');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

let voiceConnection = null;
let audioPlayer = null;
let ffmpegProcess = null;
let isReconnecting = false;

function stopAudioSource() {
  if (ffmpegProcess) {
    try {
      ffmpegProcess.kill('SIGTERM');
    } catch {}
    ffmpegProcess = null;
  }
}

function startAudioStream() {
  if (!audioPlayer) {
    audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 250,
      },
    });

    audioPlayer.on(AudioPlayerStatus.Playing, () => {
      console.log(`[Radio Nexo Bot] >>> EN VIVO: OggOpus ${BITRATE} Estéreo Hi-Fi · Modo Música Fullband (Uzox Engine) · Bass Boost +${BASS_BOOST}dB · Anti-Clipping Activo <<<`);
      if (client.user) {
        client.user.setActivity(`RADIO NEXO · ${BITRATE} Hi-Fi`, { type: ActivityType.Listening });
      }
    });

    audioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (!ffmpegProcess) {
        console.log('[Radio Nexo Bot] Audio inactivo. Reconectando en 2s...');
        scheduleStreamReconnect(2000);
      }
    });

    audioPlayer.on('error', (error) => {
      console.warn('[Radio Nexo Bot] Aviso en reproductor:', error.message);
    });
  }

  stopAudioSource();

  try {
    let ffmpegArgs = [];
    // Filtro audiófilo: Headroom limpio (-1.2dB) + graves cálidos (+2dB @ 80Hz) + Soft-Clipping analógico (cero chasquidos/suciedad)
    const audioFilter = `aresample=48000,volume=0.88,bass=g=${BASS_BOOST}:f=80:w=0.5,asoftclip=type=tanh`;

    if (AUDIO_SOURCE === 'device') {
      console.log(`[Radio Nexo Bot] Capturando audio local directo de: "${AUDIO_DEVICE}"`);
      ffmpegArgs = [
        '-vn',
        '-sample_rate', '48000',
        '-channels', '2',
        '-f', 'dshow',
        '-rtbufsize', '64M',
        '-thread_queue_size', '1024',
        '-i', `audio=${AUDIO_DEVICE}`,
        '-af', audioFilter,
        '-c:a', 'libopus',
        '-b:a', BITRATE,
        '-vbr', 'on',
        '-application', 'audio',
        '-frame_duration', '20',
        '-packet_loss', '0',
        '-f', 'ogg',
        'pipe:1',
      ];
    } else {
      console.log(`[Radio Nexo Bot] Conectando a flujo digital de la radio: ${STREAM_URL}`);
      ffmpegArgs = [
        '-vn',
        '-fflags', '+nobuffer+discardcorrupt',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-thread_queue_size', '1024',
        '-i', STREAM_URL,
        '-af', audioFilter,
        '-c:a', 'libopus',
        '-b:a', BITRATE,
        '-vbr', 'on',
        '-application', 'audio',
        '-frame_duration', '20',
        '-packet_loss', '0',
        '-f', 'ogg',
        'pipe:1',
      ];
    }

    ffmpegProcess = spawn(ffmpegStatic, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    ffmpegProcess.on('error', (err) => {
      console.error('[Radio Nexo Bot] Error en FFmpeg:', err.message);
      scheduleStreamReconnect(3000);
    });

    ffmpegProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`[Radio Nexo Bot] Flujo finalizó (código ${code}). Reconectando en 2s...`);
        scheduleStreamReconnect(2000);
      }
    });

    // Pipeline OggOpus directo:
    // Pasa los paquetes Opus masterizados directamente al protocolo de voz de Discord sin recompresión
    const resource = createAudioResource(ffmpegProcess.stdout, {
      inputType: StreamType.OggOpus,
      inlineVolume: false,
    });

    audioPlayer.play(resource);

    if (voiceConnection) {
      voiceConnection.subscribe(audioPlayer);
    }
  } catch (err) {
    console.error('[Radio Nexo Bot] Error al crear recurso de audio:', err.message);
    scheduleStreamReconnect(3000);
  }
}

function scheduleStreamReconnect(delayMs) {
  if (isReconnecting) return;
  isReconnecting = true;
  setTimeout(() => {
    isReconnecting = false;
    startAudioStream();
  }, delayMs);
}

async function connectToVoiceChannel() {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    if (!guild) {
      console.error(`[Error] No se encontró el servidor con ID: ${GUILD_ID}`);
      return;
    }

    const channel = await guild.channels.fetch(CHANNEL_ID);
    if (!channel || !channel.isVoiceBased()) {
      console.error(`[Error] El canal con ID ${CHANNEL_ID} no existe o no es un canal de voz.`);
      return;
    }

    console.log(`[Radio Nexo Bot] Conectando al canal de voz: #${channel.name} (${guild.name})...`);
    const botMember = guild.members.me || await guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);
    console.log(`[Radio Nexo Bot] Permisos: Connect=${permissions.has('Connect')}, Speak=${permissions.has('Speak')}`);

    voiceConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    voiceConnection.on('stateChange', (oldState, newState) => {
      if (oldState.status !== newState.status) {
        console.log(`[Radio Nexo Bot] Estado de voz: ${oldState.status} -> ${newState.status}`);
        if (newState.status === VoiceConnectionStatus.Ready) {
          console.log('[Radio Nexo Bot] ¡Conexión de voz establecida con Discord!');
          startAudioStream();
        }
      }
    });

    voiceConnection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(voiceConnection, VoiceConnectionStatus.Signalling, 5000),
          entersState(voiceConnection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        console.warn('[Radio Nexo Bot] Desconectado del canal de voz. Intentando reconectar...');
        stopAudioSource();
        if (voiceConnection) {
          voiceConnection.destroy();
          voiceConnection = null;
        }
        setTimeout(connectToVoiceChannel, 3000);
      }
    });

    voiceConnection.on('error', (err) => {
      console.error('[Radio Nexo Bot] Error en la conexión de voz:', err.message);
    });
  } catch (err) {
    console.error('[Radio Nexo Bot] Error al inicializar conexión al canal de voz:', err.message);
    setTimeout(connectToVoiceChannel, 5000);
  }
}

client.once('ready', () => {
  console.log(`\n======================================================`);
  console.log(` RADIO NEXO - BOT DE DISCORD (MOTOR UZOX / OggOpus Hi-Fi)`);
  console.log(` Conectado como: ${client.user.tag}`);
  console.log(` Modo de audio: ${AUDIO_SOURCE === 'device' ? 'Captura local VB-Cable' : 'Flujo directo de la radio'}`);
  console.log(` Motor: FFmpeg libopus directo -> StreamType.OggOpus`);
  console.log(` Calidad: ${BITRATE} Estéreo 48kHz (Modo Fullband Música)`);
  console.log(` Bass Boost: +${BASS_BOOST}dB @ 90Hz (con Limitador Anti-Clipping)`);
  console.log(`======================================================\n`);

  connectToVoiceChannel();
});

process.on('SIGINT', () => {
  stopAudioSource();
  process.exit(0);
});

process.on('exit', () => {
  stopAudioSource();
});

client.login(TOKEN).catch((err) => {
  console.error('[Radio Nexo Bot] Error de inicio de sesión con Discord Token:', err.message);
  console.error('Verifica que tu DISCORD_TOKEN en .env sea correcto y no haya expirado.');
});
