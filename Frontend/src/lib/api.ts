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

// The Python backend runs on localhost:8000 by default.
// Override via VITE_API_BASE_URL if your backend is elsewhere.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8000';

const client: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// ============ Library / Tracks ============

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

export const api = {
  // ---- Tracks ----
  async getTracks(query: TrackQuery = {}): Promise<Track[]> {
    const { data } = await client.get<Track[]>('/tracks', { params: query });
    return data;
  },

  async getTrack(id: string): Promise<Track> {
    const { data } = await client.get<Track>(`/tracks/${id}`);
    return data;
  },

  async getTrackAudioUrl(id: string): Promise<string> {
    const { data } = await client.get<{ url: string }>(`/tracks/${id}/audio`);
    return data.url;
  },

  async getWaveform(id: string): Promise<WaveformResponse> {
    const { data } = await client.get<WaveformResponse>(`/tracks/${id}/waveform`);
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

  // ---- Library Analysis ----
  async analyzeLibrary(): Promise<LibraryAnalysisProgress> {
    const { data } = await client.post<LibraryAnalysisProgress>('/library/analyze');
    return data;
  },

  async getAnalysisProgress(): Promise<LibraryAnalysisProgress> {
    const { data } = await client.get<LibraryAnalysisProgress>('/library/analyze/progress');
    return data;
  },

  // ---- AI ----
  async generateAISet(req: AISetRequest): Promise<AISet> {
    const { data } = await client.post<AISet>('/ai/set', req);
    return data;
  },

  async getAISets(): Promise<AISet[]> {
    const { data } = await client.get<AISet[]>('/ai/sets');
    return data;
  },

  async getAISet(id: string): Promise<AISet> {
    const { data } = await client.get<AISet>(`/ai/sets/${id}`);
    return data;
  },

  async getNextTrackRecommendations(
    currentTrackId: string,
    mode: AIMode = 'auto',
    limit = 8,
  ): Promise<NextTrackRecommendation[]> {
    const { data } = await client.get<NextTrackRecommendation[]>(
      `/ai/recommendations/${currentTrackId}`,
      { params: { mode, limit } },
    );
    return data;
  },

  async getRecommendationsForDeck(
    deckAtrackId?: string,
    deckBtrackId?: string,
    mode: AIMode = 'auto',
    limit = 8,
  ): Promise<NextTrackRecommendation[]> {
    const params: Record<string, unknown> = { mode, limit };
    if (deckAtrackId) params.deck_a = deckAtrackId;
    if (deckBtrackId) params.deck_b = deckBtrackId;
    const { data } = await client.get<NextTrackRecommendation[]>('/ai/recommendations', {
      params,
    });
    return data;
  },

  // ---- Mix Rendering ----
  async renderMix(req: MixRenderRequest): Promise<MixRenderStatus> {
    const { data } = await client.post<MixRenderStatus>('/mix/render', req);
    return data;
  },

  async getMixStatus(id: string): Promise<MixRenderStatus> {
    const { data } = await client.get<MixRenderStatus>(`/mix/${id}`);
    return data;
  },

  getMixDownloadUrl(id: string): string {
    return `${BASE_URL}/api/mix/${id}/download`;
  },

  // ---- Health ----
  async healthCheck(): Promise<{ status: string; version: string }> {
    const { data } = await client.get<{ status: string; version: string }>('/health');
    return data;
  },
};

export { BASE_URL };
export default api;
