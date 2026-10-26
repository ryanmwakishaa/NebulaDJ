import { create } from 'zustand';
import WaveSurfer from 'wavesurfer.js';
import type { DeckId, DeckState, Track } from '@/types';
import { createInitialDeck } from '@/types';
import { api } from '@/lib/api';

// Web Audio nodes for a single deck's EQ/filter chain
interface AudioChain {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  filter: BiquadFilterNode;
  volumeGain: GainNode;
  crossGain: GainNode;
  analyser: AnalyserNode;
  destination: AudioNode;
}

interface DJStoreState {
  decks: Record<DeckId, DeckState>;
  crossfade: number; // 0..1 (0.5 = center)
  masterVolume: number;
  wavesurfers: Record<DeckId, WaveSurfer | null>;
  audioChains: Record<DeckId, AudioChain | null>;
  sharedCtx: AudioContext | null;
  masterGain: GainNode | null;
  pendingDeck: DeckId;

  // Actions
  initAudio: () => void;
  loadTrack: (deck: DeckId, track: Track) => Promise<void>;
  togglePlay: (deck: DeckId) => void;
  play: (deck: DeckId) => void;
  pause: (deck: DeckId) => void;
  stop: (deck: DeckId) => void;
  cue: (deck: DeckId) => void;
  seek: (deck: DeckId, sec: number) => void;
  setVolume: (deck: DeckId, v: number) => void;
  setRate: (deck: DeckId, r: number) => void;
  setEQ: (deck: DeckId, band: 'low' | 'mid' | 'high', v: number) => void;
  setFilter: (deck: DeckId, v: number) => void;
  setCrossfade: (v: number) => void;
  setMasterVolume: (v: number) => void;
  sync: (source: DeckId, target: DeckId) => void;
  setPendingDeck: (deck: DeckId) => void;
  getAnalyser: (deck: DeckId) => AnalyserNode | null;
  updatePosition: (deck: DeckId, sec: number) => void;
}

function computeCrossGains(xfade: number): [number, number] {
  // equal-power crossfade
  const a = Math.cos((xfade * Math.PI) / 2);
  const b = Math.cos(((1 - xfade) * Math.PI) / 2);
  return [a, b];
}

export const useDJStore = create<DJStoreState>((set, get) => ({
  decks: { A: createInitialDeck(), B: createInitialDeck() },
  crossfade: 0.5,
  masterVolume: 0.85,
  wavesurfers: { A: null, B: null },
  audioChains: { A: null, B: null },
  sharedCtx: null,
  masterGain: null,
  pendingDeck: 'A',

 initAudio: () => {
    if (get().sharedCtx) return;

    const ctx = new AudioContext();

    const master = ctx.createGain();
    master.gain.value = get().masterVolume;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;

    master.connect(limiter);
    limiter.connect(ctx.destination);

    set({
        sharedCtx: ctx,
        masterGain: master
    });
},

  loadTrack: async (deck, track) => {
    get().initAudio();
    const state = get();

    // Destroy old wavesurfer if exists
    const oldWs = state.wavesurfers[deck];
    if (oldWs) {
      oldWs.destroy();
    }

    // Get audio URL from backend
    let audioUrl: string;
    try {
      audioUrl = await api.getTrackAudioUrl(track.id);
    } catch {
      // fallback: construct from track if it already has a URL
      audioUrl = track.audio_url ?? '';
    }

    // Reset deck state for the new track
    set((s) => ({
      decks: {
        ...s.decks,
        [deck]: {
          ...createInitialDeck(),
          track,
          volume: s.decks[deck].volume,
          eqHigh: s.decks[deck].eqHigh,
          eqMid: s.decks[deck].eqMid,
          eqLow: s.decks[deck].eqLow,
          filter: s.decks[deck].filter,
          bpm: track.bpm,
          durationSec: track.duration_sec,
        },
      },
    }));

    // We need a media element to route through Web Audio.
    // WaveSurfer.js v7 uses an HTMLMediaElement internally when using MediaElement backend.
    // We'll create our own audio element and pass it to WaveSurfer.
    const audioEl = new Audio();
    audioEl.crossOrigin = 'anonymous';
    audioEl.src = audioUrl;
    audioEl.preload = 'auto';
 
    const ctx = get().sharedCtx;

    if (!ctx) {
    throw new Error(
        "AudioContext failed to initialize"
    );
   }
    const source = ctx.createMediaElementSource(audioEl);
    const eqLow = ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 250;
    eqLow.gain.value = 0;

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1200;
    eqMid.Q.value = 0.8;
    eqMid.gain.value = 0;

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 3500;
    eqHigh.gain.value = 0;

    const filter = ctx.createBiquadFilter();
    filter.type = 'allpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1;

    const volumeGain = ctx.createGain();
    volumeGain.gain.value = get().decks[deck].volume;

    const [gainA, gainB] = computeCrossGains(get().crossfade);
    const crossGain = ctx.createGain();
    crossGain.gain.value = deck === 'A' ? gainA : gainB;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;

    // Chain: source -> eqLow -> eqMid -> eqHigh -> filter -> volumeGain -> crossGain -> analyser -> master
    source.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(filter);
    filter.connect(volumeGain);
    volumeGain.connect(crossGain);
    crossGain.connect(analyser);
    analyser.connect(get().masterGain!);

    const chain: AudioChain = {
      ctx,
      source,
      eqLow,
      eqMid,
      eqHigh,
      filter,
      volumeGain,
      crossGain,
      analyser,
      destination: get().masterGain!,
    };

    // Create WaveSurfer using the media element
    const ws = WaveSurfer.create({
      media: audioEl,
      container: `#waveform-${deck}`,
      waveColor: deck === 'A' ? '#2dd4bf55' : '#fb718555',
      progressColor: deck === 'A' ? '#2dd4bf' : '#fb7185',
      cursorColor: '#ffffff',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      height: 72,
      normalize: true,
      interact: true,
    });

    ws.on('ready', () => {
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: { ...s.decks[deck], isReady: true, durationSec: ws.getDuration() },
        },
      }));
      // Apply current EQ/filter values
      const d = get().decks[deck];
      get().setEQ(deck, 'high', d.eqHigh);
      get().setEQ(deck, 'mid', d.eqMid);
      get().setEQ(deck, 'low', d.eqLow);
      get().setFilter(deck, d.filter);
      get().setRate(deck, d.rate);
    });

    ws.on('audioprocess', () => {
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: { ...s.decks[deck], positionSec: ws.getCurrentTime() },
        },
      }));
    });

    ws.on('timeupdate', (currentTime: number) => {
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: { ...s.decks[deck], positionSec: currentTime },
        },
      }));
    });

    ws.on('play', () => {
      set((s) => ({
        decks: { ...s.decks, [deck]: { ...s.decks[deck], isPlaying: true } },
      }));
    });

    ws.on('pause', () => {
      set((s) => ({
        decks: { ...s.decks, [deck]: { ...s.decks[deck], isPlaying: false } },
      }));
    });

    ws.on('finish', () => {
      set((s) => ({
        decks: { ...s.decks, [deck]: { ...s.decks[deck], isPlaying: false, positionSec: 0 } },
      }));
    });

    set((s) => ({
      wavesurfers: { ...s.wavesurfers, [deck]: ws },
      audioChains: { ...s.audioChains, [deck]: chain },
    }));
  },

  togglePlay: (deck) => {
    const ws = get().wavesurfers[deck];
    if (!ws) return;
    const ctx = get().sharedCtx;
    if (ctx?.state === 'suspended') ctx.resume();
    ws.playPause();
  },

  play: (deck) => {
    const ws = get().wavesurfers[deck];
    if (!ws) return;
    const ctx = get().sharedCtx;
    if (ctx?.state === 'suspended') ctx.resume();
    ws.play();
  },

  pause: (deck) => {
    const ws = get().wavesurfers[deck];
    if (!ws) return;
    ws.pause();
  },

  stop: (deck) => {
    const ws = get().wavesurfers[deck];
    if (!ws) return;
    ws.pause();
    ws.seekTo(0);
    set((s) => ({
      decks: { ...s.decks, [deck]: { ...s.decks[deck], isPlaying: false, positionSec: 0 } },
    }));
  },

  cue: (deck) => {
    const ws = get().wavesurfers[deck];
    if (!ws) return;
    ws.pause();
    ws.seekTo(0);
    set((s) => ({
      decks: { ...s.decks, [deck]: { ...s.decks[deck], isPlaying: false, positionSec: 0 } },
    }));
  },

  seek: (deck, sec) => {
    const ws = get().wavesurfers[deck];
    if (!ws) return;
    const dur = ws.getDuration();
    if (dur > 0) ws.seekTo(sec / dur);
    set((s) => ({
      decks: { ...s.decks, [deck]: { ...s.decks[deck], positionSec: sec } },
    }));
  },

  setVolume: (deck, v) => {
    const chain = get().audioChains[deck];
    chain?.volumeGain.gain.setTargetAtTime(v, chain.ctx.currentTime, 0.01);
    set((s) => ({ decks: { ...s.decks, [deck]: { ...s.decks[deck], volume: v } } }));
  },

  setRate: (deck, r) => {
    const ws = get().wavesurfers[deck];
    if (ws) ws.setPlaybackRate(r, true);
    const track = get().decks[deck].track;
    set((s) => ({
      decks: {
        ...s.decks,
        [deck]: { ...s.decks[deck], rate: r, bpm: track ? Math.round(track.bpm * r) : 0 },
      },
    }));
  },

  setEQ: (deck, band, v) => {
    const chain = get().audioChains[deck];
    if (chain) {
      const gain = (v - 1) * 24; // -24..+12 dB
      const node = band === 'low' ? chain.eqLow : band === 'mid' ? chain.eqMid : chain.eqHigh;
      node.gain.setTargetAtTime(gain, chain.ctx.currentTime, 0.02);
    }
    set((s) => ({
      decks: {
        ...s.decks,
        [deck]: {
          ...s.decks[deck],
          eqLow: band === 'low' ? v : s.decks[deck].eqLow,
          eqMid: band === 'mid' ? v : s.decks[deck].eqMid,
          eqHigh: band === 'high' ? v : s.decks[deck].eqHigh,
        },
      },
    }));
  },

  setFilter: (deck, v) => {
    const chain = get().audioChains[deck];
    if (chain) {
      if (Math.abs(v) < 0.02) {
        chain.filter.type = 'allpass';
        chain.filter.frequency.value = 1000;
      } else if (v < 0) {
        chain.filter.type = 'lowpass';
        chain.filter.frequency.value = 200 + (1 + v) * 18000;
        chain.filter.Q.value = 1.5;
      } else {
        chain.filter.type = 'highpass';
        chain.filter.frequency.value = 30 + v * 4000;
        chain.filter.Q.value = 1.5;
      }
    }
    set((s) => ({ decks: { ...s.decks, [deck]: { ...s.decks[deck], filter: v } } }));
  },

  setCrossfade: (v) => {
    const [gainA, gainB] = computeCrossGains(v);
    const chains = get().audioChains;
    const ctx = get().sharedCtx;
    if (ctx) {
      chains.A?.crossGain.gain.setTargetAtTime(gainA, ctx.currentTime, 0.02);
      chains.B?.crossGain.gain.setTargetAtTime(gainB, ctx.currentTime, 0.02);
    }
    set({ crossfade: v });
  },

  setMasterVolume: (v) => {
    const ctx = get().sharedCtx;
    const master = get().masterGain;
    if (ctx && master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    set({ masterVolume: v });
  },

  sync: (source, target) => {
    const srcDeck = get().decks[source];
    const tgtDeck = get().decks[target];
    const tgtWs = get().wavesurfers[target];
    if (!srcDeck.track || !tgtDeck.track || !tgtWs) return;

    // Match BPM via rate adjustment
    const srcEffectiveBpm = srcDeck.track.bpm * srcDeck.rate;
    const newRate = srcEffectiveBpm / tgtDeck.track.bpm;
    const clamped = Math.max(0.5, Math.min(2.0, newRate));
    get().setRate(target, clamped);

    // Align position
    const srcPos = get().wavesurfers[source]?.getCurrentTime() ?? 0;
    tgtWs.seekTo(srcPos / (tgtWs.getDuration() || 1));
  },

  setPendingDeck: (deck) => set({ pendingDeck: deck }),

  getAnalyser: (deck) => get().audioChains[deck]?.analyser ?? null,

  updatePosition: (deck, sec) => {
    set((s) => ({ decks: { ...s.decks, [deck]: { ...s.decks[deck], positionSec: sec } } }));
  },
}));
