
import axios, { type AxiosInstance } from 'axios';
import type {
  Track,
  WaveformResponse,
  LibraryAnalysisProgress,
  AISet,
  AISetRequest,
  NextTrackRecommendation,
  MixRenderStatus,
  MixRenderRequest,
  AIMode,
} from '@/types';

// Set VITE_API_BASE_URL in Frontend/.env.local if your backend
// is not running on localhost:8000.
const BASE_URL = (
  (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8000'
).replace(/\/+$/, '');

const client: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// --------------------
// Track queries
// --------------------

export interface TrackQuery {
  search?: string;
  genre?: string;
  min_bpm?: number;
  max_bpm?: number;
  min_energy?: number;
  max_energy?: number;
  key?: string;
  sort?: 'bpm' | 'energy' | 'title' | 'artist' | 'duration' | 'created';
  sort_dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

// --------------------
// Playlist types
// --------------------

export interface Playlist {
  id: string;
  name: string;
  track_ids: string[];
  created_at: string;
}

// --------------------
// URL helpers
// --------------------

function resolveAudioUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

// --------------------
// API methods
// --------------------

export const api = {
  // --------------------
  // Tracks
  // --------------------

  async getTracks(query: TrackQuery = {}): Promise<Track[]> {
    const { data } = await client.get<Track[]>('/tracks', {
      params: query,
    });

    return data;
  },

  async getTrack(id: string): Promise<Track> {
    const { data } = await client.get<Track>(
      `/tracks/${encodeURIComponent(id)}`,
    );

    return data;
  },

  async getTrackAudioUrl(id: string): Promise<string> {
    const { data } = await client.get<{ url: string }>(
      `/tracks/${encodeURIComponent(id)}/audio`,
    );

    return resolveAudioUrl(data.url);
  },

  async getWaveform(id: string): Promise<WaveformResponse> {
    const { data } = await client.get<WaveformResponse>(
      `/tracks/${encodeURIComponent(id)}/waveform`,
    );

    return data;
  },

  async getGenres(): Promise<string[]> {
    const { data } = await client.get<string[]>('/tracks/genres');

    return data;
  },

  async getKeys(): Promise<string[]> {
    const { data } = await client.get<string[]>('/tracks/keys');

    return data;
  },

  // --------------------
  // Library analysis
  // --------------------

  async analyzeLibrary(): Promise<LibraryAnalysisProgress> {
    const { data } =
      await client.post<LibraryAnalysisProgress>('/library/analyze');

    return data;
  },

  async getAnalysisProgress(): Promise<LibraryAnalysisProgress> {
    const { data } = await client.get<LibraryAnalysisProgress>(
      '/library/analyze/progress',
    );

    return data;
  },

  // --------------------
  // Playlists
  // Requires matching endpoints in main.py
  // --------------------

  async getPlaylists(): Promise<Playlist[]> {
    const { data } = await client.get<Playlist[]>('/playlists');

    return data;
  },

  async createPlaylist(name: string): Promise<Playlist> {
    const { data } = await client.post<Playlist>('/playlists', {
      name: name.trim(),
    });

    return data;
  },

  async deletePlaylist(id: string): Promise<void> {
    await client.delete(`/playlists/${encodeURIComponent(id)}`);
  },

  async addTrackToPlaylist(
    playlistId: string,
    trackId: string,
  ): Promise<Playlist> {
    const { data } = await client.post<Playlist>(
      `/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`,
    );

    return data;
  },

  async removeTrackFromPlaylist(
    playlistId: string,
    trackId: string,
  ): Promise<Playlist> {
    const { data } = await client.delete<Playlist>(
      `/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`,
    );

    return data;
  },

  // --------------------
  // AI sets
  // --------------------

  async generateAISet(req: AISetRequest): Promise<AISet> {
    const { data } = await client.post<AISet>('/ai/set', req);

    return data;
  },

  async getAISets(): Promise<AISet[]> {
    const { data } = await client.get<AISet[]>('/ai/sets');

    return data;
  },

  async getAISet(id: string): Promise<AISet> {
    const { data } = await client.get<AISet>(
      `/ai/sets/${encodeURIComponent(id)}`,
    );

    return data;
  },

  // --------------------
  // AI recommendations
  // --------------------

  async getNextTrackRecommendations(
    currentTrackId: string,
    mode: AIMode = 'auto',
    limit = 8,
  ): Promise<NextTrackRecommendation[]> {
    const { data } = await client.get<NextTrackRecommendation[]>(
      `/ai/recommendations/${encodeURIComponent(currentTrackId)}`,
      {
        params: {
          mode,
          limit,
        },
      },
    );

    return data;
  },

  async getRecommendationsForDeck(
    deckAtrackId?: string,
    deckBtrackId?: string,
    mode: AIMode = 'auto',
    limit = 8,
  ): Promise<NextTrackRecommendation[]> {
    const params: Record<string, string | number> = {
      mode,
      limit,
    };

    if (deckAtrackId) {
      params.deck_a = deckAtrackId;
    }

    if (deckBtrackId) {
      params.deck_b = deckBtrackId;
    }

    const { data } = await client.get<NextTrackRecommendation[]>(
      '/ai/recommendations',
      {
        params,
      },
    );

    return data;
  },

  // --------------------
  // Mix rendering
  // --------------------

  async renderMix(req: MixRenderRequest): Promise<MixRenderStatus> {
    const { data } = await client.post<MixRenderStatus>(
      '/mix/render',
      req,
    );

    return data;
  },

  async getMixStatus(id: string): Promise<MixRenderStatus> {
    const { data } = await client.get<MixRenderStatus>(
      `/mix/${encodeURIComponent(id)}`,
    );

    return data;
  },

  getMixDownloadUrl(id: string): string {
    return `${BASE_URL}/api/mix/${encodeURIComponent(id)}/download`;
  },

  // --------------------
  // Health check
  // --------------------

  async healthCheck(): Promise<{
    status: string;
    version: string;
  }> {
    const { data } = await client.get<{
      status: string;
      version: string;
    }>('/health');

    return data;
  },
};

export { BASE_URL };
export default api;
