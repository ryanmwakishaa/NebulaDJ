// ============ Backend API Types ============

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  genre: string;
  bpm: number;
  key: string; // Camelot key e.g. "8A"
  energy: number; // 0..1
  duration_sec: number;
  file_path: string;
  artwork_url?: string | null;
  waveform_url?: string | null;
  audio_url?: string | null;
  first_downbeat_sec?: number;
  bitrate?: number;
  file_format?: string;
  created_at?: string;
}

export interface WaveformResponse {
  track_id: string;
  peaks: number[]; // normalized 0..1
  sample_rate: number;
  duration_sec: number;
}

export interface LibraryAnalysisProgress {
  status: 'idle' | 'scanning' | 'analyzing' | 'complete' | 'error';
  total: number;
  processed: number;
  current_track?: string;
  message?: string;
}

// ============ AI Types ============

export type AIMode =
  | 'auto'
  | 'build_energy'
  | 'peak_hour'
  | 'warm_up'
  | 'afro_house_journey'
  | 'sunset_session'
  | 'recovery_mode';

export interface AISetRequest {
  mode: AIMode;
  seed_track_id?: string;
  deck_a_track_id?: string;
  deck_b_track_id?: string;
  num_tracks?: number;
  target_bpm?: number;
  playlist_id?: string;
  genre?: string;
  duration_minutes?: number;
}

export interface AISetTrack {
  track: Track;
  deck: 'A' | 'B';
  position: number; // position in set
  transition_type: string;
  mix_in_sec: number;
  mix_out_sec: number;
}

export interface AISet {
  id: string;
  mode: AIMode;
  tracks: AISetTrack[];
  total_duration_sec: number;
  avg_bpm: number;
  energy_curve: number[];
  created_at: string;
}

export interface NextTrackRecommendation {
  track: Track;
  compatibility_score: number; // 0..1
  bpm_compatibility: number;
  harmonic_compatibility: number;
  energy_compatibility: number;
  genre_affinity: number;
  explanation: string;
  recommended_transition: string;
}

export interface MixRenderRequest {
  set_id: string;
  format?: 'mp3';
  quality?: 'high' | 'standard';
}

export interface MixRenderStatus {
  id: string;
  set_id: string;
  status: 'queued' | 'rendering' | 'complete' | 'error';
  progress: number; // 0..1
  download_url?: string;
  duration_sec?: number;
  file_size_mb?: number;
  message?: string;
}

// ============ DJ Deck State ============

export type DeckId = 'A' | 'B';

export interface DeckState {
  track: Track | null;
  isPlaying: boolean;
  isReady: boolean;
  volume: number; // 0..1
  rate: number; // playback rate (0.92..1.08)
  positionSec: number;
  durationSec: number;
  eqHigh: number; // 0..2 (1 = neutral)
  eqMid: number;
  eqLow: number;
  filter: number; // -1..1 (0 = off)
  bpm: number; // effective bpm (track bpm * rate)
  cuePoint: number;
}

export const createInitialDeck = (): DeckState => ({
  track: null,
  isPlaying: false,
  isReady: false,
  volume: 0.8,
  rate: 1.0,
  positionSec: 0,
  durationSec: 0,
  eqHigh: 1,
  eqMid: 1,
  eqLow: 1,
  filter: 0,
  bpm: 0,
  cuePoint: 0,
});
