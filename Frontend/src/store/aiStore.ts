import { create } from 'zustand';
import type { AISet, AISetTrack, AIMode, NextTrackRecommendation, MixRenderStatus } from '@/types';
import { api } from '@/lib/api';

interface AIState {
  // Set generation
  currentMode: AIMode;
  isGenerating: boolean;
  currentSet: AISet | null;
  setHistory: AISet[];
  generateError: string | null;

  // Recommendations
  recommendations: NextTrackRecommendation[];
  recsLoading: boolean;
  recsError: string | null;

  // Mix rendering
  renderStatus: MixRenderStatus | null;
  isRendering: boolean;
  renderError: string | null;

  // Actions
  setMode: (mode: AIMode) => void;
  generateSet: (params: {
    seedTrackId?: string;
    deckATrackId?: string;
    deckBTrackId?: string;
    numTracks?: number;
  }) => Promise<void>;
  fetchRecommendations: (deckATrackId?: string, deckBTrackId?: string) => Promise<void>;
  renderMix: (setId: string) => Promise<void>;
  pollRenderStatus: (renderId: string) => Promise<void>;
  clearError: () => void;
}

export const useAIStore = create<AIState>((set, get) => ({
  currentMode: 'auto',
  isGenerating: false,
  currentSet: null,
  setHistory: [],
  generateError: null,

  recommendations: [],
  recsLoading: false,
  recsError: null,

  renderStatus: null,
  isRendering: false,
  renderError: null,

  setMode: (mode) => set({ currentMode: mode }),

  generateSet: async (params) => {
    const { currentMode } = get();
    set({ isGenerating: true, generateError: null });
    try {
      const aiSet = await api.generateAISet({
        mode: currentMode,
        seed_track_id: params.seedTrackId,
        deck_a_track_id: params.deckATrackId,
        deck_b_track_id: params.deckBTrackId,
        num_tracks: params.numTracks,
      });
      set((s) => ({
        isGenerating: false,
        currentSet: aiSet,
        setHistory: [aiSet, ...s.setHistory].slice(0, 10),
      }));
    } catch (err) {
      set({
        isGenerating: false,
        generateError: err instanceof Error ? err.message : 'Failed to generate AI set',
      });
    }
  },

  fetchRecommendations: async (deckATrackId, deckBTrackId) => {
    const { currentMode } = get();
    set({ recsLoading: true, recsError: null });
    try {
      const recs = await api.getRecommendationsForDeck(
        deckATrackId,
        deckBTrackId,
        currentMode,
        8,
      );
      set({ recommendations: recs, recsLoading: false });
    } catch (err) {
      set({
        recsLoading: false,
        recsError: err instanceof Error ? err.message : 'Failed to get recommendations',
      });
    }
  },

  renderMix: async (setId) => {
    set({ isRendering: true, renderError: null, renderStatus: null });
    try {
      const status = await api.renderMix({ set_id: setId, format: 'mp3', quality: 'high' });
      set({ renderStatus: status, isRendering: false });
      if (status.status === 'queued' || status.status === 'rendering') {
        get().pollRenderStatus(status.id);
      }
    } catch (err) {
      set({
        isRendering: false,
        renderError: err instanceof Error ? err.message : 'Failed to start mix render',
      });
    }
  },

  pollRenderStatus: async (renderId) => {
    const poll = async () => {
      try {
        const status = await api.getMixStatus(renderId);
        set({ renderStatus: status });
        if (status.status === 'queued' || status.status === 'rendering') {
          setTimeout(poll, 1500);
        } else if (status.status === 'error') {
          set({ isRendering: false, renderError: status.message ?? 'Render failed' });
        } else if (status.status === 'complete') {
          set({ isRendering: false });
        }
      } catch (err) {
        set({
          isRendering: false,
          renderError: err instanceof Error ? err.message : 'Failed to poll render status',
        });
      }
    };
    setTimeout(poll, 1500);
  },

  clearError: () =>
    set({ generateError: null, recsError: null, renderError: null }),
}));
