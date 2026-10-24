import { create } from 'zustand';
import { api, type TrackQuery } from '@/lib/api';
import type { Track } from '@/types';

interface TracksState {
  tracks: Track[];
  genres: string[];
  keys: string[];
  loading: boolean;
  error: string | null;
  query: TrackQuery;
  setQuery: (q: Partial<TrackQuery>) => void;
  fetchTracks: () => Promise<void>;
  fetchGenres: () => Promise<void>;
  fetchKeys: () => Promise<void>;
}

export const useTracksStore = create<TracksState>((set, get) => ({
  tracks: [],
  genres: [],
  keys: [],
  loading: false,
  error: null,
  query: { sort: 'bpm', sort_dir: 'asc', limit: 100 },

  setQuery: (q) => {
    set((s) => ({ query: { ...s.query, ...q } }));
    get().fetchTracks();
  },

  fetchTracks: async () => {
    const { query } = get();
    set({ loading: true, error: null });
    try {
      const tracks = await api.getTracks(query);
      set({ tracks, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load tracks',
      });
    }
  },

  fetchGenres: async () => {
    try {
      const genres = await api.getGenres();
      set({ genres });
    } catch {
      // non-critical
    }
  },

  fetchKeys: async () => {
    try {
      const keys = await api.getKeys();
      set({ keys });
    } catch {
      // non-critical
    }
  },
}));
