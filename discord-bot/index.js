const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const STREAM_URL = process.env.STREAM_URL || 'https://nexo-radio-bridge-axxt.onrender.com/live';

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
let isReconnecting = false;

function playRadioStream() {
  if (!audioPlayer) {
    audioPlayer = createAudioPlayer();

    audioPlayer.on(AudioPlayerStatus.Playing, () => {
      console.log('[Radio Nexo Bot] Transmitiendo audio en vivo en Discord exitosamente.');
      if (client.user) {
        client.user.setActivity('RADIO NEXO · En Vivo', { type: ActivityType.Listening });
      }
    });

    audioPlayer.on(AudioPlayerStatus.Idle, () => {
      console.log('[Radio Nexo Bot] El flujo finalizó o recicló conexión. Reconectando en 2s...');
      scheduleStreamReconnect(2000);
    });

    audioPlayer.on('error', (error) => {
      console.warn('[Radio Nexo Bot] Aviso en reproductor de audio:', error.message);
      scheduleStreamReconnect(3000);
    });
  }

  try {
    const resourceUrl = `${STREAM_URL}?t=${Date.now()}`;
    console.log(`[Radio Nexo Bot] Conectando a fuente de audio: ${resourceUrl}`);
    const resource = createAudioResource(resourceUrl, {
      inlineVolume: true,
    });
    if (resource.volume) {
      resource.volume.setVolume(0.95);
    }
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
    playRadioStream();
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

    console.log(`[Radio Nexo Bot] Conectando al canal de voz: #${channel.name} (${guild.name}) - Tipo: ${channel.type}...`);
    const botMember = guild.members.me || await guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);
    console.log(`[Radio Nexo Bot] Permisos: Connect=${permissions.has('Connect')}, Speak=${permissions.has('Speak')}, ViewChannel=${permissions.has('ViewChannel')}`);

    voiceConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    voiceConnection.on('debug', (msg) => {
      console.log(`[Voice Debug] ${msg}`);
    });

    voiceConnection.on('stateChange', (oldState, newState) => {
      console.log(`[Radio Nexo Bot] Estado de voz: ${oldState.status} -> ${newState.status}`);
      if (newState.status === VoiceConnectionStatus.Ready) {
        console.log('[Radio Nexo Bot] ¡Conexión de voz establecida con Discord!');
        playRadioStream();
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
        voiceConnection.destroy();
        voiceConnection = null;
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
  console.log(`\n========================================`);
  console.log(` RADIO NEXO - BOT DE DISCORD INICIADO`);
  console.log(` Conectado como: ${client.user.tag}`);
  console.log(`========================================\n`);

  client.user.setActivity('RADIO NEXO', { type: ActivityType.Listening });
  connectToVoiceChannel();
});

client.login(TOKEN).catch((err) => {
  console.error('[Radio Nexo Bot] Error de inicio de sesión con Discord Token:', err.message);
  console.error('Verifica que tu DISCORD_TOKEN en .env sea correcto y no haya expirado.');
});
