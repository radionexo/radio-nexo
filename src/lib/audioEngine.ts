import { AudioLevels, Song } from './types';
import { radioStore } from './radioStore';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private audioSourceNode: MediaElementAudioSourceNode | null = null;

  private musicGainNode: GainNode | null = null;
  private micGainNode: GainNode | null = null;
  private masterGainNode: GainNode | null = null;
  private monitorGainNode: GainNode | null = null;

  private musicAnalyser: AnalyserNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;

  private micStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micHighpassNode: BiquadFilterNode | null = null;
  private micWarmthNode: BiquadFilterNode | null = null;
  private micMudCutNode: BiquadFilterNode | null = null;
  private micPresenceNode: BiquadFilterNode | null = null;
  private micAirNode: BiquadFilterNode | null = null;
  private micPreampNode: GainNode | null = null;
  private micCompressorNode: DynamicsCompressorNode | null = null;
  private masterDestination: MediaStreamAudioDestinationNode | null = null;

  // Microphone preferences
  private selectedDeviceId: string | null = null;
  private micMode: 'studio' | 'standard' = 'studio';
  private broadcastEnhance = true;

  private mediaRecorder: MediaRecorder | null = null;
  private broadcastWs: WebSocket | null = null;

  // State
  private isBroadcasting = false;
  private isMicOnAir = false;
  private needsUserInteraction = false;
  private musicVolume = 0.85;
  private micVolume = 1.0; // Default 100% (0dB unity gain) for clean, zero-saturation broadcast
  private masterVolume = 1.0;
  private duckedMusicRatio = 0.15; // 15% ducking when speaking

  private currentSong: Song | null = null;
  private isPlaying = false;
  private airTimeSeconds = 0;
  private airTimerInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private broadcastReconnectTimeout: NodeJS.Timeout | null = null;
  private wasPlayingBeforeMic = false;

  private onStateChangeCallbacks: Set<() => void> = new Set();
  private onLevelCallbacks: Set<(levels: AudioLevels) => void> = new Set();
  private animFrameId: number | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const savedMicVol = localStorage.getItem('nexo_mic_volume');
      if (savedMicVol) {
        const parsed = parseFloat(savedMicVol);
        if (!isNaN(parsed) && parsed >= 0) {
          this.micVolume = parsed > 1.5 ? 1.0 : parsed;
        }
      }
      const savedMusicVol = localStorage.getItem('nexo_music_volume');
      if (savedMusicVol) {
        const parsed = parseFloat(savedMusicVol);
        if (!isNaN(parsed) && parsed >= 0) this.musicVolume = parsed;
      }
      this.selectedDeviceId = localStorage.getItem('nexo_mic_device_id') || null;
      const savedMode = localStorage.getItem('nexo_mic_mode');
      if (savedMode === 'standard' || savedMode === 'studio') {
        this.micMode = savedMode;
      } else {
        this.micMode = 'studio';
      }
      const savedEnhance = localStorage.getItem('nexo_mic_enhance');
      if (savedEnhance !== null) {
        this.broadcastEnhance = savedEnhance !== 'false';
      }
      window.addEventListener('beforeunload', () => {
        // Automatically ensure mic is taken off the air on page reload
        radioStore.updateStationState({ is_mic_active: false });
        this.persistSession();
      });
    }
  }

  public init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.audioElement = new Audio();
      this.audioElement.crossOrigin = 'anonymous';

      // Setup audio routing
      this.audioSourceNode = this.ctx.createMediaElementSource(this.audioElement);
      this.musicGainNode = this.ctx.createGain();
      this.micGainNode = this.ctx.createGain();
      this.masterGainNode = this.ctx.createGain();
      this.monitorGainNode = this.ctx.createGain();

      this.musicGainNode.gain.setValueAtTime(this.musicVolume, this.ctx.currentTime);
      this.micGainNode.gain.setValueAtTime(0, this.ctx.currentTime);
      this.masterGainNode.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
      this.monitorGainNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

      // Analysers for VU meters
      this.musicAnalyser = this.ctx.createAnalyser();
      this.micAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser = this.ctx.createAnalyser();

      this.musicAnalyser.fftSize = 64;
      this.micAnalyser.fftSize = 64;
      this.masterAnalyser.fftSize = 64;

      // Master broadcast destination with transparent peak limiter (-1.5dB ceiling, zero clipping)
      this.masterDestination = this.ctx.createMediaStreamDestination();
      const masterLimiter = this.ctx.createDynamicsCompressor();
      masterLimiter.threshold.setValueAtTime(-1.5, this.ctx.currentTime);
      masterLimiter.knee.setValueAtTime(6.0, this.ctx.currentTime);
      masterLimiter.ratio.setValueAtTime(12.0, this.ctx.currentTime);
      masterLimiter.attack.setValueAtTime(0.005, this.ctx.currentTime);
      masterLimiter.release.setValueAtTime(0.15, this.ctx.currentTime);

      // Routing:
      // Music -> musicGain -> masterGain (and musicAnalyser in parallel)
      this.audioSourceNode.connect(this.musicGainNode);
      this.musicGainNode.connect(this.masterGainNode);
      this.musicGainNode.connect(this.musicAnalyser);

      // Master -> masterLimiter -> masterDestination (to broadcast stream) & masterAnalyser
      this.masterGainNode.connect(masterLimiter);
      masterLimiter.connect(this.masterDestination);
      this.masterGainNode.connect(this.masterAnalyser);

      // Inaudible continuous clock keepalive (-100dB) into masterDestination:
      // Prevents Chrome/Edge MediaRecorder from stalling or dropping frames during song changes/silence
      try {
        const keepaliveOsc = this.ctx.createOscillator();
        const keepaliveGain = this.ctx.createGain();
        keepaliveOsc.frequency.setValueAtTime(20, this.ctx.currentTime);
        keepaliveGain.gain.setValueAtTime(0.00001, this.ctx.currentTime);
        keepaliveOsc.connect(keepaliveGain);
        keepaliveGain.connect(this.masterDestination);
        keepaliveOsc.start();
      } catch {}

      // Master -> monitorGain -> speakers (for DJ monitoring in studio)
      this.masterGainNode.connect(this.monitorGainNode);
      this.monitorGainNode.connect(this.ctx.destination);

      // Audio element listeners
      this.audioElement.addEventListener('error', () => {
        console.warn('[AudioEngine Watchdog] Error en elemento de audio, auto-recuperando vía nextTrack...');
        if (this.currentSong && typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('nexo_audio_playback_failed', {
              detail: {
                song: this.currentSong,
                message: 'Error al cargar el stream o archivo de audio.',
              },
            })
          );
        }
        // Auto-recover so the station NEVER halts playback on corrupted/broken track
        setTimeout(() => {
          this.nextTrack();
        }, 500);
      });

      this.audioElement.addEventListener('ended', () => {
        this.handleTrackEnded();
      });

      this.audioElement.addEventListener('timeupdate', () => {
        if (this.audioElement && this.currentSong) {
          const progress = Math.floor(this.audioElement.currentTime);
          radioStore.updateStationState({
            current_song_progress: progress,
          });
          this.persistSession();
          this.notify();
        }
      });

      this.startMeterLoop();
    } catch (err) {
      console.error('Failed to initialize AudioContext:', err);
    }
  }

  private startMeterLoop() {
    const musicBuf = new Uint8Array(32);
    const micBuf = new Uint8Array(32);
    const masterBuf = new Uint8Array(32);

    const calcLevel = (analyser: AnalyserNode | null, buf: any, sensitivity: number = 1.4): number => {
      if (!analyser) return 0;
      analyser.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        sum += buf[i];
      }
      const avg = sum / buf.length;
      return Math.min(100, Math.round((avg / 255) * 100 * sensitivity));
    };

    const loop = () => {
      if (this.onLevelCallbacks.size > 0) {
        const levels: AudioLevels = {
          music: this.isPlaying ? calcLevel(this.musicAnalyser, musicBuf, 1.2) : 0,
          mic: this.isMicOnAir ? calcLevel(this.micAnalyser, micBuf, 1.15) : 0,
          master: calcLevel(this.masterAnalyser, masterBuf, 1.15),
        };
        this.onLevelCallbacks.forEach((cb) => cb(levels));
      }
      this.animFrameId = requestAnimationFrame(loop);
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  // --- PLAYBACK CONTROLS ---
  public async playSong(song: Song, startTime: number = 0) {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch {}
    }

    if (!this.audioElement) return;

    this.currentSong = song;
    this.audioElement.src = song.file_url;
    if (startTime > 0) {
      const setTime = () => {
        if (this.audioElement && startTime > 0) {
          this.audioElement.currentTime = startTime;
        }
      };
      this.audioElement.addEventListener('loadedmetadata', setTime, { once: true });
    }
    this.audioElement.load();

    try {
      await this.audioElement.play();
      this.isPlaying = true;
      if (startTime > 0) {
        this.audioElement.currentTime = startTime;
      }
      if (!this.isBroadcasting && typeof window !== 'undefined' && localStorage.getItem('nexo_broadcast_enabled') !== 'false') {
        this.startBroadcasting();
      }
      radioStore.updateStationState({
        current_song_id: song.id,
        current_song_title: song.title,
        current_song_artist: song.artist,
        current_song_cover: song.cover_url,
        current_song_url: song.file_url,
        current_song_duration: song.duration,
        current_song_progress: Math.floor(startTime),
      });
      this.needsUserInteraction = false;
      this.persistSession();
      this.notify();
    } catch (err) {
      console.warn('Playback error, attempting fallback to local audio:', err);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('nexo_audio_playback_failed', {
            detail: {
              song,
              error: err,
              message: 'El archivo de audio no pudo reproducirse (enlace roto o inaccesible).',
            },
          })
        );
      }
      try {
        this.audioElement.src = '/songs/summer.mp3';
        if (startTime > 0) {
          this.audioElement.currentTime = startTime;
        }
        this.audioElement.load();
        await this.audioElement.play();
        this.isPlaying = true;
        if (startTime > 0) {
          this.audioElement.currentTime = startTime;
        }
        radioStore.updateStationState({
          current_song_id: song.id,
          current_song_title: song.title,
          current_song_artist: song.artist,
          current_song_cover: song.cover_url,
          current_song_url: '/songs/summer.mp3',
          current_song_duration: song.duration,
          current_song_progress: Math.floor(startTime),
        });
        this.needsUserInteraction = false;
        this.persistSession();
        this.notify();
      } catch (e2) {
        console.error('Final audio play error:', e2);
      }
    }
  }

  public async togglePlay() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch {}
    }

    if (!this.audioElement) return;

    if (this.isPlaying) {
      this.audioElement.pause();
      this.isPlaying = false;
    } else {
      if (!this.currentSong) {
        const queue = radioStore.getQueue();
        if (queue.length > 0) {
          await this.playSong(queue[0]);
          return;
        } else {
          const songs = await radioStore.getSongs();
          if (songs && songs.length > 0) {
            await this.playSong(songs[0]);
            return;
          }
        }
      }
      try {
        await this.audioElement.play();
        this.isPlaying = true;
        if (!this.isBroadcasting && typeof window !== 'undefined' && localStorage.getItem('nexo_broadcast_enabled') !== 'false') {
          this.startBroadcasting();
        }
      } catch (e) {
        console.warn('togglePlay error:', e);
      }
    }
    this.persistSession();
    this.notify();
  }

  public async nextTrack() {
    if (this.isMicOnAir) {
      console.log('[AudioEngine] nextTrack cancelado porque el DJ está al aire');
      return;
    }

    const queue = radioStore.getQueue();
    if (queue.length > 0) {
      const nextSong = queue[0];
      radioStore.removeFromQueue(0);
      await this.playSong(nextSong);
      return;
    }

    // AutoDJ 24/7 continuous rotation:
    // When queue is empty, automatically advance to another song from library
    try {
      const songs = await radioStore.getSongs();
      if (songs && songs.length > 0) {
        const currentIndex = this.currentSong
          ? songs.findIndex((s) => s.id === this.currentSong?.id)
          : -1;
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % songs.length : 0;
        await this.playSong(songs[nextIndex]);
        return;
      }
    } catch (err) {
      console.warn('[AudioEngine AutoDJ] Error seleccionando siguiente canción:', err);
    }

    // Emergency local fallback to ensure audio never stops
    if (this.audioElement) {
      this.audioElement.currentTime = 0;
      try {
        await this.audioElement.play();
        this.isPlaying = true;
        this.notify();
      } catch {}
    }
  }

  public prevTrack() {
    if (this.audioElement) {
      this.audioElement.currentTime = 0;
    }
  }

  private handleTrackEnded() {
    if (this.isMicOnAir) return;
    this.nextTrack();
  }

  // --- DUCKING & MICROPHONE ---
  private closeMicStream() {
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    if (this.micSourceNode) {
      try { this.micSourceNode.disconnect(); } catch {}
      this.micSourceNode = null;
    }
  }

  private setupMicChain() {
    if (!this.ctx || !this.micSourceNode || !this.micGainNode) return;

    try { this.micSourceNode.disconnect(); } catch {}

    if (this.broadcastEnhance) {
      // Gentle mastering-grade broadcast polish (safe for full music + voice mixes, zero saturation)
      // 1. Sub-bass cleanup at 35Hz (preserves full musical bass while removing DC/sub rumble)
      this.micHighpassNode = this.ctx.createBiquadFilter();
      this.micHighpassNode.type = 'highpass';
      this.micHighpassNode.frequency.setValueAtTime(35, this.ctx.currentTime);
      this.micHighpassNode.Q.setValueAtTime(0.707, this.ctx.currentTime);

      // 2. Subtle Warmth at 180Hz (+0.8dB)
      this.micWarmthNode = this.ctx.createBiquadFilter();
      this.micWarmthNode.type = 'peaking';
      this.micWarmthNode.frequency.setValueAtTime(180, this.ctx.currentTime);
      this.micWarmthNode.Q.setValueAtTime(0.9, this.ctx.currentTime);
      this.micWarmthNode.gain.setValueAtTime(0.8, this.ctx.currentTime);

      // 3. Mild Mud Cleanup at 450Hz (-0.8dB)
      this.micMudCutNode = this.ctx.createBiquadFilter();
      this.micMudCutNode.type = 'peaking';
      this.micMudCutNode.frequency.setValueAtTime(450, this.ctx.currentTime);
      this.micMudCutNode.Q.setValueAtTime(1.1, this.ctx.currentTime);
      this.micMudCutNode.gain.setValueAtTime(-0.8, this.ctx.currentTime);

      // 4. Clean Clarity at 3.5kHz (+1.0dB)
      this.micPresenceNode = this.ctx.createBiquadFilter();
      this.micPresenceNode.type = 'peaking';
      this.micPresenceNode.frequency.setValueAtTime(3500, this.ctx.currentTime);
      this.micPresenceNode.Q.setValueAtTime(1.0, this.ctx.currentTime);
      this.micPresenceNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

      // 5. Gentle Air at 10kHz (+0.8dB)
      this.micAirNode = this.ctx.createBiquadFilter();
      this.micAirNode.type = 'highshelf';
      this.micAirNode.frequency.setValueAtTime(10000, this.ctx.currentTime);
      this.micAirNode.gain.setValueAtTime(0.8, this.ctx.currentTime);

      // 6. Clean Headroom Trim (-0.7dB = 0.92x) so EQ never clips mastered music
      this.micPreampNode = this.ctx.createGain();
      this.micPreampNode.gain.setValueAtTime(0.92, this.ctx.currentTime);

      // 7. Smooth Broadcast Bus Compressor (transparent leveling, no pumping)
      this.micCompressorNode = this.ctx.createDynamicsCompressor();
      this.micCompressorNode.threshold.setValueAtTime(-10, this.ctx.currentTime);
      this.micCompressorNode.knee.setValueAtTime(14, this.ctx.currentTime);
      this.micCompressorNode.ratio.setValueAtTime(2.0, this.ctx.currentTime);
      this.micCompressorNode.attack.setValueAtTime(0.015, this.ctx.currentTime);
      this.micCompressorNode.release.setValueAtTime(0.2, this.ctx.currentTime);

      // Connect: source -> highpass -> warmth -> mudCut -> presence -> air -> preamp -> compressor -> micGainNode
      this.micSourceNode.connect(this.micHighpassNode);
      this.micHighpassNode.connect(this.micWarmthNode);
      this.micWarmthNode.connect(this.micMudCutNode);
      this.micMudCutNode.connect(this.micPresenceNode);
      this.micPresenceNode.connect(this.micAirNode);
      this.micAirNode.connect(this.micPreampNode);
      this.micPreampNode.connect(this.micCompressorNode);
      this.micCompressorNode.connect(this.micGainNode);
    } else {
      // Pure Unity-Gain Direct Bypass (0dB = 1.0x, zero coloration — ideal for Virtual DJ / External Mixer)
      this.micPreampNode = this.ctx.createGain();
      this.micPreampNode.gain.setValueAtTime(1.0, this.ctx.currentTime);
      this.micSourceNode.connect(this.micPreampNode);
      this.micPreampNode.connect(this.micGainNode);
    }

    if (this.masterGainNode) {
      try { this.micGainNode.connect(this.masterGainNode); } catch {}
    }
    if (this.micAnalyser) {
      try { this.micGainNode.connect(this.micAnalyser); } catch {}
    }
  }

  public async enterOnAir(): Promise<boolean> {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (!this.ctx || !this.musicGainNode || !this.micGainNode) return false;

    try {
      // 1. Request microphone access if not already opened
      if (!this.micStream) {
        const audioConstraints: MediaTrackConstraints = {
          // In studio mode (recommended), we disable browser VoIP telephone filters so your real microphone shines!
          echoCancellation: this.micMode === 'standard',
          noiseSuppression: this.micMode === 'standard',
          autoGainControl: false,
          channelCount: { ideal: 2 },
          sampleRate: { ideal: 48000 },
        };

        if (this.selectedDeviceId) {
          audioConstraints.deviceId = { ideal: this.selectedDeviceId };
        }

        try {
          this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
          });
        } catch (constraintErr) {
          console.warn('Fallback to basic audio constraints:', constraintErr);
          this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
        }

        this.micSourceNode = this.ctx.createMediaStreamSource(this.micStream);
        this.setupMicChain();
      }

      const now = this.ctx.currentTime;
      // 2. Pause internal studio music player so it doesn't clash with Virtual DJ / live voice
      this.wasPlayingBeforeMic = this.isPlaying;
      if (this.audioElement && this.isPlaying) {
        try {
          this.audioElement.pause();
          this.isPlaying = false;
        } catch {}
      }
      this.musicGainNode.gain.cancelScheduledValues(now);
      this.musicGainNode.gain.setValueAtTime(0, now);

      // 3. Ramp mic in over 200ms
      this.micGainNode.gain.cancelScheduledValues(now);
      this.micGainNode.gain.setValueAtTime(this.micGainNode.gain.value, now);
      this.micGainNode.gain.linearRampToValueAtTime(this.micVolume, now + 0.2);

      // Lower monitor speaker for mic to prevent feedback in studio
      if (this.monitorGainNode) {
        this.monitorGainNode.gain.setValueAtTime(0.35, now);
      }

      this.isMicOnAir = true;
      const existingState = radioStore.getStationState();
      const hasCustomTitle =
        existingState.current_song_title &&
        existingState.current_song_title !== 'Summer Vibes' &&
        existingState.current_song_title !== 'NEXO Stream' &&
        existingState.current_song_title !== 'Radio Nexo';
      radioStore.updateStationState({
        is_mic_active: true,
        current_song_title: hasCustomTitle ? existingState.current_song_title : 'DJ EN VIVO',
        current_song_artist: hasCustomTitle ? existingState.current_song_artist : 'Sesión en Directo · Radio Nexo',
      });
      this.persistSession();
      this.notify();
      return true;
    } catch (err) {
      console.error('Microphone access denied or error:', err);
      throw err;
    }
  }

  public exitOnAir() {
    if (!this.ctx || !this.musicGainNode || !this.micGainNode) return;

    const now = this.ctx.currentTime;

    // 1. Fade out microphone in 200ms
    this.micGainNode.gain.cancelScheduledValues(now);
    this.micGainNode.gain.setValueAtTime(this.micGainNode.gain.value, now);
    this.micGainNode.gain.linearRampToValueAtTime(0.0001, now + 0.2);

    // 2. Restore normal music volume and auto-resume music if it was playing before
    this.musicGainNode.gain.cancelScheduledValues(now);
    this.musicGainNode.gain.setValueAtTime(this.musicVolume, now);

    if (this.wasPlayingBeforeMic && this.audioElement && this.currentSong) {
      try {
        this.audioElement.play().catch(console.warn);
        this.isPlaying = true;
      } catch {}
    }
    this.wasPlayingBeforeMic = false;

    // Restore monitor volume
    if (this.monitorGainNode) {
      this.monitorGainNode.gain.setValueAtTime(1.0, now);
    }

    this.isMicOnAir = false;
    if (this.currentSong) {
      radioStore.updateStationState({
        is_mic_active: false,
        current_song_id: this.currentSong.id,
        current_song_title: this.currentSong.title,
        current_song_artist: this.currentSong.artist,
        current_song_cover: this.currentSong.cover_url || '/cover_default.webp',
        current_song_url: this.currentSong.file_url,
        current_song_duration: this.currentSong.duration,
      });
    } else {
      radioStore.updateStationState({
        is_mic_active: false,
        current_song_title: 'Radio Nexo',
        current_song_artist: 'En Vivo',
      });
    }
    this.persistSession();
    this.notify();
  }

  public toggleMic() {
    if (this.isMicOnAir) {
      this.exitOnAir();
    } else {
      this.enterOnAir();
    }
  }

  // --- AUDIO INPUT DEVICE & QUALITY CONTROLS ---
  public async getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audioinput');
    } catch (e) {
      console.warn('Error enumerating audio devices:', e);
      return [];
    }
  }

  public async setAudioInputDevice(deviceId: string) {
    this.selectedDeviceId = deviceId;
    if (typeof window !== 'undefined') {
      localStorage.setItem('nexo_mic_device_id', deviceId);
    }
    if (this.isMicOnAir) {
      this.closeMicStream();
      await this.enterOnAir();
    } else if (this.micStream) {
      this.closeMicStream();
    }
    this.notify();
  }

  public async setMicMode(mode: 'studio' | 'standard') {
    this.micMode = mode;
    if (typeof window !== 'undefined') {
      localStorage.setItem('nexo_mic_mode', mode);
    }
    if (this.isMicOnAir) {
      this.closeMicStream();
      await this.enterOnAir();
    } else if (this.micStream) {
      this.closeMicStream();
    }
    this.notify();
  }

  public setBroadcastEnhance(enabled: boolean) {
    this.broadcastEnhance = enabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem('nexo_mic_enhance', enabled ? 'true' : 'false');
    }
    if (this.micSourceNode) {
      this.setupMicChain();
    }
    this.notify();
  }

  // --- VOLUME FADERS ---
  public setMusicVolume(vol: number) {
    this.musicVolume = Math.max(0, Math.min(1.5, vol));
    if (this.musicGainNode && this.ctx) {
      const now = this.ctx.currentTime;
      const effective = this.isMicOnAir ? this.musicVolume * this.duckedMusicRatio : this.musicVolume;
      this.musicGainNode.gain.cancelScheduledValues(now);
      this.musicGainNode.gain.linearRampToValueAtTime(effective, now + 0.05);
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('nexo_music_volume', this.musicVolume.toString());
      } catch {}
    }
    this.notify();
  }

  public setMicVolume(vol: number) {
    this.micVolume = Math.max(0, Math.min(2.5, vol));
    if (this.micGainNode && this.ctx && this.isMicOnAir) {
      const now = this.ctx.currentTime;
      this.micGainNode.gain.cancelScheduledValues(now);
      this.micGainNode.gain.linearRampToValueAtTime(this.micVolume, now + 0.05);
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('nexo_mic_volume', this.micVolume.toString());
      } catch {}
    }
    this.notify();
  }

  public setMasterVolume(vol: number) {
    this.masterVolume = Math.max(0, Math.min(1.5, vol));
    if (this.masterGainNode && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGainNode.gain.cancelScheduledValues(now);
      this.masterGainNode.gain.linearRampToValueAtTime(this.masterVolume, now + 0.05);
    }
    this.notify();
  }

  // --- BROADCAST TRANSMISSION TO BRIDGE / ICECAST (AUTO-HEALING) ---
  public startBroadcasting() {
    this.init();
    if (!this.masterDestination) return;

    if (this.isBroadcasting) return;

    this.isBroadcasting = true;
    if (typeof window !== 'undefined') {
      localStorage.setItem('nexo_broadcast_enabled', 'true');
    }

    // Start on-air broadcast timer (preserving air time across refresh)
    if (this.airTimerInterval) {
      clearInterval(this.airTimerInterval);
    }
    this.airTimeSeconds = this.airTimeSeconds || 0;
    this.airTimerInterval = setInterval(() => {
      this.airTimeSeconds++;
      radioStore.updateStationState({
        air_time_seconds: this.airTimeSeconds,
      });
      if (this.airTimeSeconds % 5 === 0) {
        this.persistSession();
      }
      this.notify();
    }, 1000);

    radioStore.updateStationState({ is_live: true });
    this.persistSession();
    this.notify();

    this.launchBroadcastStream();
  }

  private launchBroadcastStream() {
    if (!this.masterDestination || !this.isBroadcasting) return;

    try {
      const stream = this.masterDestination.stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : '';

      const options = mimeType ? { mimeType, audioBitsPerSecond: 192000 } : { audioBitsPerSecond: 192000 };
      this.mediaRecorder = new MediaRecorder(stream, options);

      // Dynamically resolve active Bridge WebSocket URL:
      // 1. Live tunnel URL synced in Supabase station_state.current_song_url (Cloudflare Tunnel / custom bridge)
      // 2. NEXT_PUBLIC_BRIDGE_WS_URL env var
      // 3. Default fallback
      const stateUrl = radioStore.getStationState()?.current_song_url || '';
      const isDynamicBridge =
        stateUrl.startsWith('https://') &&
        !stateUrl.endsWith('.mp3') &&
        !stateUrl.includes('/songs/');
      const dynamicWsUrl = isDynamicBridge
        ? `${stateUrl.replace(/^https:\/\//i, 'wss://').replace(/\/+$/, '')}/broadcast`
        : '';
      const defaultWsUrl = 'wss://nexo-radio-bridge-axxt.onrender.com/broadcast';
      const wsUrl = dynamicWsUrl || process.env.NEXT_PUBLIC_BRIDGE_WS_URL || defaultWsUrl;
      const initialChunkQueue: ArrayBuffer[] = [];

      try {
        this.broadcastWs = new WebSocket(wsUrl);
        this.broadcastWs.binaryType = 'arraybuffer';

        this.broadcastWs.onopen = () => {
          console.log('[Broadcast] Conectado exitosamente al servidor puente MP3 en', wsUrl);
          while (initialChunkQueue.length > 0) {
            const chunk = initialChunkQueue.shift();
            if (chunk) this.broadcastWs?.send(chunk);
          }

          // Keepalive heartbeat ping every 10s to prevent cloud/Render proxy idle disconnects
          if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = setInterval(() => {
            if (this.broadcastWs && this.broadcastWs.readyState === WebSocket.OPEN) {
              try {
                this.broadcastWs.send(new Uint8Array([1, 2, 3, 4]));
              } catch {}
            }
          }, 10000);
        };

        // Automatic self-healing: fast 1s reconnect (inside bridge's 6.5s grace period -> 0 dropped listeners!)
        this.broadcastWs.onclose = () => {
          console.warn('[Broadcast Watchdog] Conexión WebSocket cerrada con el puente.');
          if (this.isBroadcasting) {
            console.log('[Broadcast Watchdog] Reconexión rápida en 1s (transparente para oyentes)...');
            if (this.broadcastReconnectTimeout) clearTimeout(this.broadcastReconnectTimeout);
            this.broadcastReconnectTimeout = setTimeout(() => {
              if (this.isBroadcasting) {
                this.restartBroadcasterPipeline();
              }
            }, 1000);
          }
        };

        this.broadcastWs.onerror = (e) => {
          console.warn('[Broadcast] Error en WebSocket del puente:', e);
        };
      } catch (wsErr) {
        console.warn('Could not establish WebSocket to bridge:', wsErr);
      }

      this.mediaRecorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          const buffer = await e.data.arrayBuffer();
          if (this.broadcastWs && this.broadcastWs.readyState === WebSocket.OPEN) {
            // Backpressure protection: avoid memory buildup if uplink temporarily stalls
            if (this.broadcastWs.bufferedAmount < 512 * 1024) {
              this.broadcastWs.send(buffer);
            }
          } else if (initialChunkQueue.length < 15) {
            initialChunkQueue.push(buffer);
          }
        }
      };

      this.mediaRecorder.onerror = (e) => {
        console.warn('[Broadcast Watchdog] Error en MediaRecorder:', e);
        if (this.isBroadcasting) {
          this.restartBroadcasterPipeline();
        }
      };

      // Emit chunks every 200ms for smooth, low-jitter cadence into FFmpeg MP3 transcoder
      this.mediaRecorder.start(200);
    } catch (err) {
      console.error('Failed to start media recorder / broadcast:', err);
      if (this.isBroadcasting) {
        if (this.broadcastReconnectTimeout) clearTimeout(this.broadcastReconnectTimeout);
        this.broadcastReconnectTimeout = setTimeout(() => {
          if (this.isBroadcasting) this.restartBroadcasterPipeline();
        }, 3000);
      }
    }
  }

  public restartBroadcasterPipeline() {
    if (!this.isBroadcasting) return;
    console.log('[Broadcast Watchdog] Auto-recuperando transmisión (parando y reiniciando pipeline de forma transparente)...');

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch {}
    }
    this.mediaRecorder = null;

    if (this.broadcastWs) {
      try { this.broadcastWs.close(); } catch {}
      this.broadcastWs = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.launchBroadcastStream();
  }

  public stopBroadcasting() {
    this.isBroadcasting = false;
    if (this.broadcastReconnectTimeout) {
      clearTimeout(this.broadcastReconnectTimeout);
      this.broadcastReconnectTimeout = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {}
    }
    this.mediaRecorder = null;
    if (this.broadcastWs) {
      try {
        this.broadcastWs.close();
      } catch {}
      this.broadcastWs = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.airTimerInterval) {
      clearInterval(this.airTimerInterval);
      this.airTimerInterval = null;
    }
    this.airTimeSeconds = 0;
    if (typeof window !== 'undefined') {
      localStorage.setItem('nexo_broadcast_enabled', 'false');
    }
    this.persistSession();
    radioStore.updateStationState({ is_live: false });
    this.notify();
  }

  public toggleBroadcasting() {
    if (this.isBroadcasting) {
      this.stopBroadcasting();
    } else {
      this.startBroadcasting();
    }
  }

  // --- SESSION PERSISTENCE & AUTO-RESTORE (F5 ZERO-DROP RECOVERY) ---
  public persistSession() {
    if (typeof window === 'undefined') return;
    try {
      if (this.isBroadcasting || this.isMicOnAir) {
        const liveSession = {
          isLiveBroadcast: true,
          isBroadcasting: this.isBroadcasting,
          isMicOnAir: this.isMicOnAir,
          airTimeSeconds: this.airTimeSeconds,
          savedAt: Date.now(),
        };
        localStorage.setItem('nexo_live_broadcast_session_v1', JSON.stringify(liveSession));
      } else {
        localStorage.removeItem('nexo_live_broadcast_session_v1');
      }
    } catch {}
  }

  public async restoreSession(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (this.isBroadcasting && this.isMicOnAir) return true;

    try {
      const broadcastEnabled = localStorage.getItem('nexo_broadcast_enabled') === 'true';
      const savedLiveRaw = localStorage.getItem('nexo_live_broadcast_session_v1');
      let savedLive: {
        isLiveBroadcast?: boolean;
        isBroadcasting?: boolean;
        isMicOnAir?: boolean;
        airTimeSeconds?: number;
        savedAt?: number;
      } | null = null;

      if (savedLiveRaw) {
        try {
          savedLive = JSON.parse(savedLiveRaw);
        } catch {}
      }

      const shouldResumeLive = broadcastEnabled || Boolean(savedLive?.isBroadcasting || savedLive?.isMicOnAir);
      if (!shouldResumeLive) {
        radioStore.updateStationState({ is_mic_active: false });
        return false;
      }

      // Preserve air time across F5 refresh
      if (savedLive?.airTimeSeconds) {
        const elapsed = Math.max(0, Math.floor((Date.now() - (savedLive.savedAt || Date.now())) / 1000));
        this.airTimeSeconds = savedLive.airTimeSeconds + (elapsed < 180 ? elapsed : 0);
      }

      const attachGestureFallback = () => {
        this.needsUserInteraction = true;
        this.notify();

        const oneTimeResume = async () => {
          window.removeEventListener('click', oneTimeResume);
          window.removeEventListener('keydown', oneTimeResume);
          window.removeEventListener('touchstart', oneTimeResume);
          await this.resumeFromGesture();
        };

        window.addEventListener('click', oneTimeResume, { once: true });
        window.addEventListener('keydown', oneTimeResume, { once: true });
        window.addEventListener('touchstart', oneTimeResume, { once: true });
      };

      try {
        await this.enterOnAir();
        if (!this.isBroadcasting) {
          this.startBroadcasting();
        }

        // If browser suspended AudioContext until user gesture, prompt 1-click wake
        if (this.ctx && this.ctx.state === 'suspended') {
          try {
            await this.ctx.resume();
          } catch {}
        }

        if (this.ctx && this.ctx.state === 'suspended') {
          attachGestureFallback();
          return false;
        }

        this.needsUserInteraction = false;
        this.persistSession();
        this.notify();
        return true;
      } catch (err) {
        console.warn('[Studio Auto-Resume] Requiere interacción tras F5:', err);
        attachGestureFallback();
        return false;
      }
    } catch (e) {
      console.warn('Error in restoreSession:', e);
    }
    return false;
  }

  public async resumeFromGesture() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {}
    }
    try {
      const shouldResumeLive =
        typeof window !== 'undefined' &&
        (localStorage.getItem('nexo_broadcast_enabled') === 'true' ||
          Boolean(localStorage.getItem('nexo_live_broadcast_session_v1')));

      if (shouldResumeLive) {
        if (!this.isMicOnAir) {
          await this.enterOnAir();
        }
        if (!this.isBroadcasting) {
          this.startBroadcasting();
        }
      }
      this.needsUserInteraction = false;
      this.persistSession();
      this.notify();
    } catch (e) {
      console.warn('Error resuming live broadcast from gesture:', e);
    }
  }

  // --- LIVE STUDIO SOUNDBOARD (INJECTED DIRECTLY INTO MASTER BROADCAST BUS) ---
  public async playSoundEffect(effect: 'airhorn' | 'applause' | 'riser' | 'chime' | 'boom' | 'jingle') {
    this.init();
    if (!this.ctx || !this.masterGainNode) return;
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch {}
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const fxGain = ctx.createGain();
    fxGain.gain.setValueAtTime(0.45, now);
    fxGain.connect(this.masterGainNode);

    if (effect === 'airhorn') {
      // Classic DJ Triple-Tone Airhorn
      const freqs = [392, 493.88, 587.33, 783.99];
      freqs.forEach((f) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f * 0.96, now);
        osc.frequency.exponentialRampToValueAtTime(f, now + 0.05);
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.22, now + 0.03);
        g.gain.setValueAtTime(0.22, now + 0.55);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
        osc.connect(g);
        g.connect(fxGain);
        osc.start(now);
        osc.stop(now + 0.88);
      });
    } else if (effect === 'applause') {
      // Filtered stereo-like crowd applause burst
      const duration = 1.8;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        const env = Math.sin((i / bufferSize) * Math.PI);
        const clapMod = 0.65 + 0.35 * Math.sin(i * 0.0045);
        data[i] = (Math.random() * 2 - 1) * env * clapMod;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(1600, now);
      bandpass.Q.setValueAtTime(0.8, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.65, now);
      noise.connect(bandpass);
      bandpass.connect(g);
      g.connect(fxGain);
      noise.start(now);
    } else if (effect === 'riser') {
      // Smooth DJ synth sweep riser
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 1.15);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, now);
      filter.frequency.exponentialRampToValueAtTime(4500, now + 1.15);
      g.gain.setValueAtTime(0.01, now);
      g.gain.linearRampToValueAtTime(0.35, now + 1.05);
      g.gain.exponentialRampToValueAtTime(0.001, now + 1.25);
      osc.connect(filter);
      filter.connect(g);
      g.connect(fxGain);
      osc.start(now);
      osc.stop(now + 1.3);
    } else if (effect === 'chime') {
      // Warm radio studio bell / greeting chime
      [880, 1318.51, 1760].forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        const t = now + idx * 0.08;
        osc.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.28, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
        osc.connect(g);
        g.connect(fxGain);
        osc.start(t);
        osc.stop(t + 0.8);
      });
    } else if (effect === 'boom') {
      // Punchy sub bass drop impact
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(34, now + 0.55);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.75, now + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
      osc.connect(g);
      g.connect(fxGain);
      osc.start(now);
      osc.stop(now + 0.8);
    } else if (effect === 'jingle') {
      // Signature 4-note Radio Nexo gold ident sting
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        const t = now + idx * 0.11;
        osc.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.32, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + (idx === 3 ? 0.9 : 0.35));
        osc.connect(g);
        g.connect(fxGain);
        osc.start(t);
        osc.stop(t + 1.0);
      });
    }
  }

  // --- SUBSCRIBERS ---
  public subscribe(callback: () => void) {
    this.onStateChangeCallbacks.add(callback);
    return () => {
      this.onStateChangeCallbacks.delete(callback);
    };
  }

  public subscribeLevels(callback: (levels: AudioLevels) => void) {
    this.onLevelCallbacks.add(callback);
    return () => {
      this.onLevelCallbacks.delete(callback);
    };
  }

  private notify() {
    this.onStateChangeCallbacks.forEach((cb) => {
      try {
        cb();
      } catch {}
    });
  }

  // --- GETTERS ---
  public getState() {
    return {
      isPlaying: this.isPlaying,
      isMicOnAir: this.isMicOnAir,
      isBroadcasting: this.isBroadcasting,
      needsUserInteraction: this.needsUserInteraction,
      musicVolume: this.musicVolume,
      micVolume: this.micVolume,
      masterVolume: this.masterVolume,
      currentSong: this.currentSong,
      currentTime: this.audioElement ? Math.floor(this.audioElement.currentTime) : 0,
      duration: this.audioElement && !isNaN(this.audioElement.duration) ? Math.floor(this.audioElement.duration) : (this.currentSong?.duration || 0),
      airTimeSeconds: this.airTimeSeconds,
      selectedDeviceId: this.selectedDeviceId,
      micMode: this.micMode,
      broadcastEnhance: this.broadcastEnhance,
    };
  }
}

export const audioEngine = new AudioEngine();
