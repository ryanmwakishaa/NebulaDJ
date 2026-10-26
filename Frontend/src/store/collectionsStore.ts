
import { create } from 'zustand';

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

interface CollectionsState {
  playlists: Playlist[];
  createPlaylist: (name: string) => void;
  deletePlaylist: (id: string) => void;
  toggleTrack: (playlistId: string, trackId: string) => void;
}

const STORAGE_KEY = 'nebuladj-playlists-v1';

function loadPlaylists(): Playlist[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) as Playlist[] : [];
  } catch {
    return [];
  }
}

function savePlaylists(playlists: Playlist[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
  } catch (error) {
    console.error('Could not save playlists:', error);
  }
}

export const useCollectionsStore = create<CollectionsState>((set, get) => ({
  playlists: loadPlaylists(),

  createPlaylist: (name) => {
    const cleanName = name.trim();
    if (!cleanName) return;

    const duplicate = get().playlists.some(
      (playlist) =>
        playlist.name.toLowerCase() === cleanName.toLowerCase()
    );

    if (duplicate) return;

    const playlist: Playlist = {
      id: crypto.randomUUID(),
      name: cleanName,
      trackIds: [],
      createdAt: Date.now(),
    };

    const playlists = [...get().playlists, playlist];
    savePlaylists(playlists);
    set({ playlists });
  },

  deletePlaylist: (id) => {
    const playlists = get().playlists.filter(
      (playlist) => playlist.id !== id
    );

    savePlaylists(playlists);
    set({ playlists });
  },

  toggleTrack: (playlistId, trackId) => {
    const playlists = get().playlists.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;

      const alreadyAdded = playlist.trackIds.includes(trackId);

      return {
        ...playlist,
        trackIds: alreadyAdded
          ? playlist.trackIds.filter((id) => id !== trackId)
          : [...playlist.trackIds, trackId],
      };
    });

    savePlaylists(playlists);
    set({ playlists });
  },
}));
