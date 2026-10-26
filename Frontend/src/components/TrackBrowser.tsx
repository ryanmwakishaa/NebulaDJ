import { useEffect, useState, type FormEvent } from 'react';
import {
  Search,
  Music2,
  TrendingUp,
  Clock,
  Disc3,
  ChevronDown,
  RefreshCw,
  Plus,
  Trash2,
} from 'lucide-react';
import { useTracksStore } from '@/store/tracksStore';
import { useDJStore } from '@/store/djStore';
import { api, type Playlist } from '@/lib/api';
import { formatDuration, formatEnergy } from '@/lib/format';

type SortKey = 'bpm' | 'energy' | 'title' | 'artist' | 'duration' | 'created';

const BUILT_IN_COLLECTIONS = ['All', 'Afro House', 'Warm Up', 'Peak Hour'] as const;

interface TrackBrowserProps {
  /** When true, only the header bar is shown. The component stays mounted, so search/filters are kept. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function TrackBrowser({
  collapsed = false,
  onToggleCollapsed,
}: TrackBrowserProps) {
  const {
    tracks,
    genres,
    keys,
    loading,
    error,
    query,
    setQuery,
    fetchTracks,
    fetchGenres,
    fetchKeys,
  } = useTracksStore();
  const dj = useDJStore();

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistError, setPlaylistError] = useState('');
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [collection, setCollection] = useState('All');
  const [newPlaylistName, setNewPlaylistName] = useState('');

  useEffect(() => {
    void fetchTracks();
    void fetchGenres();
    void fetchKeys();

    let cancelled = false;

    async function loadPlaylists() {
      setPlaylistLoading(true);
      setPlaylistError('');
      try {
        const data = await api.getPlaylists();
        if (!cancelled) setPlaylists(data);
      } catch {
        if (!cancelled) {
          setPlaylistError('Could not load playlists. Check that the backend is running.');
        }
      } finally {
        if (!cancelled) setPlaylistLoading(false);
      }
    }

    void loadPlaylists();
    return () => {
      cancelled = true;
    };
    // These store actions are intentionally called only when the component mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activePlaylist = playlists.find(
    (playlist) => collection === `playlist:${playlist.id}`,
  );

  const visibleTracks = tracks.filter((track) => {
    if (collection === 'All') return true;
    if (collection === 'Warm Up') return track.energy <= 0.4;
    if (collection === 'Peak Hour') return track.energy >= 0.7;
    if (collection === 'Afro House') {
      return track.genre?.toLowerCase().includes('afro');
    }
    if (activePlaylist) {
      return activePlaylist.track_ids.includes(String(track.id));
    }
    return true;
  });

  const handleCreatePlaylist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newPlaylistName.trim();
    if (!name) return;

    const existing = playlists.find(
      (playlist) => playlist.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      setCollection(`playlist:${existing.id}`);
      setNewPlaylistName('');
      return;
    }

    setPlaylistError('');
    try {
      const created = await api.createPlaylist(name);
      setPlaylists((current) => [...current, created]);
      setCollection(`playlist:${created.id}`);
      setNewPlaylistName('');
    } catch {
      setPlaylistError('Could not create playlist. Please try again.');
    }
  };

  const handleDeletePlaylist = async (playlistId: string) => {
    setPlaylistError('');
    try {
      await api.deletePlaylist(playlistId);
      setPlaylists((current) =>
        current.filter((playlist) => playlist.id !== playlistId),
      );
      if (collection === `playlist:${playlistId}`) setCollection('All');
    } catch {
      setPlaylistError('Could not delete playlist. Please try again.');
    }
  };

  const handleToggleTrack = async (playlistId: string, trackId: string) => {
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) return;

    const alreadyAdded = playlist.track_ids.includes(trackId);
    setPlaylistError('');
    try {
      const updated = alreadyAdded
        ? await api.removeTrackFromPlaylist(playlistId, trackId)
        : await api.addTrackToPlaylist(playlistId, trackId);
      setPlaylists((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch {
      setPlaylistError('Could not update playlist. Please try again.');
    }
  };

  const sortIcon = (key: SortKey, label: string, icon: React.ReactNode) => (
    <button
      key={key}
      onClick={() =>
        setQuery({
          sort: key,
          sort_dir:
            query.sort === key && query.sort_dir === 'asc' ? 'desc' : 'asc',
        })
      }
      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors ${
        query.sort === key
          ? 'bg-rbox-panel3 text-rbox-amber border border-rbox-amber/30'
          : 'text-rbox-dim hover:text-rbox-text border border-transparent'
      }`}
    >
      {icon}
      {label}
      {query.sort === key && (
        <span className="text-[8px]">{query.sort_dir === 'asc' ? '↑' : '↓'}</span>
      )}
    </button>
  );

  return (
    <div
      className={`flex flex-col ${collapsed ? '' : 'h-full'} bg-rbox-panel rounded-xl border border-rbox-line shadow-inset-deep overflow-hidden`}
    >
      {/* Header */}
      <div
        className={`px-4 py-2.5 bg-rbox-panel2 flex items-center justify-between ${
          collapsed ? '' : 'border-b border-rbox-line'
        }`}
      >
        <button
          onClick={onToggleCollapsed}
          disabled={!onToggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? 'Show track library' : 'Hide track library'}
          className="flex items-center gap-2 text-left group disabled:cursor-default"
        >
          {onToggleCollapsed && (
            <ChevronDown
              size={14}
              className={`text-rbox-dim group-hover:text-rbox-text transition-transform ${
                collapsed ? '-rotate-90' : ''
              }`}
            />
          )}
          <Disc3 size={16} className="text-rbox-amber" />
          <span className="text-sm font-display tracking-wider text-rbox-text">
            TRACK LIBRARY
          </span>
          <span className="text-[10px] font-mono text-rbox-dim ml-2">
            {visibleTracks.length} / {tracks.length} tracks{loading && ' · loading...'}
          </span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void fetchTracks()}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-rbox-dim hover:text-rbox-text rounded border border-rbox-line hover:border-rbox-dim transition-colors"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-mono text-rbox-dim">LOAD TO:</span>
            <button
              onClick={() => dj.setPendingDeck('A')}
              className={`px-2 py-0.5 text-[10px] font-mono rounded transition-all ${
                dj.pendingDeck === 'A'
                  ? 'bg-deck-a/20 text-deck-a border border-deck-a/50 shadow-glow-a'
                  : 'bg-rbox-panel3 text-rbox-dim border border-rbox-line'
              }`}
            >
              DECK A
            </button>
            <button
              onClick={() => dj.setPendingDeck('B')}
              className={`px-2 py-0.5 text-[10px] font-mono rounded transition-all ${
                dj.pendingDeck === 'B'
                  ? 'bg-deck-b/20 text-deck-b border border-deck-b/50 shadow-glow-b'
                  : 'bg-rbox-panel3 text-rbox-dim border border-rbox-line'
              }`}
            >
              DECK B
            </button>
          </div>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Search and filters */}
          <div className="flex items-center gap-2 px-3 py-2 bg-rbox-panel border-b border-rbox-line">
            <div className="relative flex-1">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-rbox-dim"
              />
              <input
                value={query.search ?? ''}
                onChange={(event) => setQuery({ search: event.target.value || undefined })}
                placeholder="Search tracks or artists..."
                className="w-full bg-rbox-panel2 border border-rbox-line rounded-lg pl-8 pr-3 py-1.5 text-xs text-rbox-text placeholder:text-rbox-dim focus:outline-none focus:border-rbox-amber/50 transition-colors"
              />
            </div>
            <select
              value={query.genre ?? 'all'}
              onChange={(event) =>
                setQuery({ genre: event.target.value === 'all' ? undefined : event.target.value })
              }
              className="bg-rbox-panel2 border border-rbox-line rounded-lg px-2 py-1.5 text-xs text-rbox-text focus:outline-none focus:border-rbox-amber/50 cursor-pointer"
            >
              <option value="all">All Genres</option>
              {genres.map((genre) => (
                <option key={genre} value={genre}>{genre}</option>
              ))}
            </select>
            <select
              value={query.key ?? 'all'}
              onChange={(event) =>
                setQuery({ key: event.target.value === 'all' ? undefined : event.target.value })
              }
              className="bg-rbox-panel2 border border-rbox-line rounded-lg px-2 py-1.5 text-xs text-rbox-text focus:outline-none focus:border-rbox-amber/50 cursor-pointer"
            >
              <option value="all">All Keys</option>
              {keys.map((key) => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
            <button
              onClick={() => setShowFilters((value) => !value)}
              className={`flex items-center gap-1 px-2 py-1.5 text-[10px] font-mono rounded-lg border transition-colors ${
                showFilters
                  ? 'bg-rbox-panel3 text-rbox-amber border-rbox-amber/30'
                  : 'bg-rbox-panel2 text-rbox-dim border-rbox-line hover:text-rbox-text'
              }`}
            >
              Filters
              <ChevronDown size={11} className={showFilters ? 'rotate-180' : ''} />
            </button>
          </div>

          {/* Advanced filters */}
          {showFilters && (
            <div className="flex items-center gap-3 px-3 py-2 bg-rbox-panel2/50 border-b border-rbox-line text-xs flex-wrap">
              <div className="flex items-center gap-1.5">
                <label className="text-[9px] font-mono text-rbox-dim">BPM</label>
                <input
                  type="number"
                  placeholder="min"
                  className="w-14 bg-rbox-panel2 border border-rbox-line rounded px-1.5 py-1 text-[10px] font-mono text-rbox-text focus:outline-none focus:border-rbox-amber/50"
                  value={query.min_bpm ?? ''}
                  onChange={(event) => setQuery({ min_bpm: event.target.value ? Number(event.target.value) : undefined })}
                />
                <span className="text-rbox-dim">-</span>
                <input
                  type="number"
                  placeholder="max"
                  className="w-14 bg-rbox-panel2 border border-rbox-line rounded px-1.5 py-1 text-[10px] font-mono text-rbox-text focus:outline-none focus:border-rbox-amber/50"
                  value={query.max_bpm ?? ''}
                  onChange={(event) => setQuery({ max_bpm: event.target.value ? Number(event.target.value) : undefined })}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-[9px] font-mono text-rbox-dim">ENERGY</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  placeholder="min"
                  className="w-16 bg-rbox-panel2 border border-rbox-line rounded px-1.5 py-1 text-[10px] font-mono text-rbox-text focus:outline-none focus:border-rbox-amber/50"
                  value={query.min_energy ?? ''}
                  onChange={(event) => setQuery({ min_energy: event.target.value ? Number(event.target.value) : undefined })}
                />
                <span className="text-rbox-dim">-</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  placeholder="max"
                  className="w-16 bg-rbox-panel2 border border-rbox-line rounded px-1.5 py-1 text-[10px] font-mono text-rbox-text focus:outline-none focus:border-rbox-amber/50"
                  value={query.max_energy ?? ''}
                  onChange={(event) => setQuery({ max_energy: event.target.value ? Number(event.target.value) : undefined })}
                />
              </div>
              <button
                onClick={() => setQuery({ min_bpm: undefined, max_bpm: undefined, min_energy: undefined, max_energy: undefined })}
                className="text-[9px] font-mono text-rbox-dim hover:text-rbox-text"
              >
                Clear
              </button>
            </div>
          )}

          {/* Collections and playlists */}
          <div className="px-3 py-2 border-b border-rbox-line bg-rbox-panel flex flex-col gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              {BUILT_IN_COLLECTIONS.map((name) => (
                <button
                  key={name}
                  onClick={() => setCollection(name)}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-mono border transition-colors ${
                    collection === name
                      ? 'bg-rbox-amber/10 text-rbox-amber border-rbox-amber/40'
                      : 'bg-rbox-panel2 text-rbox-dim border-rbox-line hover:text-rbox-text'
                  }`}
                >
                  {name}
                </button>
              ))}

              {playlists.map((playlist) => {
                const playlistCollection = `playlist:${playlist.id}`;
                const isActive = collection === playlistCollection;
                return (
                  <div
                    key={playlist.id}
                    className={`flex items-center rounded-lg border transition-colors ${
                      isActive ? 'bg-rbox-amber/10 border-rbox-amber/40' : 'bg-rbox-panel2 border-rbox-line'
                    }`}
                  >
                    <button
                      onClick={() => setCollection(playlistCollection)}
                      className={`px-2.5 py-1.5 text-[10px] font-mono ${isActive ? 'text-rbox-amber' : 'text-rbox-dim hover:text-rbox-text'}`}
                    >
                      {playlist.name}
                      <span className="ml-1 opacity-60">{playlist.track_ids.length}</span>
                    </button>
                    <button
                      onClick={() => void handleDeletePlaylist(playlist.id)}
                      title={`Delete ${playlist.name}`}
                      aria-label={`Delete playlist ${playlist.name}`}
                      className="px-1.5 py-1.5 text-rbox-dim hover:text-rbox-red"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}
              {playlistLoading && (
                <span className="text-[10px] font-mono text-rbox-dim">Loading playlists...</span>
              )}
            </div>

            <form onSubmit={handleCreatePlaylist} className="flex items-center gap-2">
              <input
                value={newPlaylistName}
                onChange={(event) => setNewPlaylistName(event.target.value)}
                placeholder="Create a playlist..."
                maxLength={40}
                aria-label="New playlist name"
                className="w-full max-w-xs bg-rbox-panel2 border border-rbox-line rounded-lg px-2.5 py-1.5 text-xs text-rbox-text placeholder:text-rbox-dim focus:outline-none focus:border-rbox-amber/50"
              />
              <button
                type="submit"
                disabled={!newPlaylistName.trim()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rbox-line bg-rbox-panel2 text-rbox-dim hover:text-rbox-amber hover:border-rbox-amber/40 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-mono"
              >
                <Plus size={12} /> Create
              </button>
            </form>
          </div>

          {/* Sort bar */}
          <div className="flex items-center gap-1 px-3 py-1.5 bg-rbox-panel2/50 border-b border-rbox-line flex-wrap">
            {sortIcon('bpm', 'BPM', <Music2 size={10} />)}
            {sortIcon('energy', 'ENERGY', <TrendingUp size={10} />)}
            {sortIcon('duration', 'TIME', <Clock size={10} />)}
            {sortIcon('title', 'NAME', null)}
            {sortIcon('artist', 'ARTIST', null)}
            {sortIcon('created', 'DATE', null)}
          </div>

          {/* Error banners */}
          {error && (
            <div className="px-3 py-2 bg-rbox-red/10 border-b border-rbox-red/30 text-[10px] font-mono text-rbox-red">
              {error}
            </div>
          )}
          {playlistError && (
            <div className="px-3 py-2 bg-rbox-red/10 border-b border-rbox-red/30 text-[10px] font-mono text-rbox-red">
              {playlistError}
            </div>
          )}

          {/* Track list */}
          <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-rbox-panel2 z-10">
                <tr className="text-rbox-dim text-[9px] font-mono uppercase tracking-wider">
                  <th className="text-left px-3 py-1.5 font-medium">#</th>
                  <th className="text-left px-2 py-1.5 font-medium">Title</th>
                  <th className="text-left px-2 py-1.5 font-medium hidden md:table-cell">Artist</th>
                  <th className="text-left px-2 py-1.5 font-medium hidden lg:table-cell">Genre</th>
                  <th className="text-center px-2 py-1.5 font-medium">Key</th>
                  <th className="text-right px-2 py-1.5 font-medium">BPM</th>
                  <th className="text-center px-2 py-1.5 font-medium hidden sm:table-cell">Energy</th>
                  <th className="text-right px-3 py-1.5 font-medium">Time</th>
                  <th className="text-left px-2 py-1.5 font-medium">Playlist</th>
                </tr>
              </thead>
              <tbody>
                {visibleTracks.map((track, index) => {
                  const isOnDeckA = dj.decks.A.track?.id === track.id;
                  const isOnDeckB = dj.decks.B.track?.id === track.id;
                  const targetDeck = dj.decks[dj.pendingDeck];
                  const currentBpm = targetDeck.track?.bpm ?? 0;
                  const bpmCompatible = currentBpm > 0 && Math.abs(track.bpm - currentBpm) <= 3;

                  return (
                    <tr
                      key={track.id}
                      onClick={() => dj.loadTrack(dj.pendingDeck, track)}
                      onDoubleClick={() => {
                        dj.loadTrack(dj.pendingDeck, track);
                        dj.play(dj.pendingDeck);
                      }}
                      className={`cursor-pointer border-b border-rbox-line/50 hover:bg-rbox-panel2/60 transition-colors group ${bpmCompatible ? 'bg-green-500/10' : ''}`}
                    >
                      <td className="px-3 py-2 text-rbox-dim font-mono text-[10px]">
                        {String(index + 1).padStart(2, '0')}
                        {isOnDeckA && <span className="ml-1 text-deck-a">A</span>}
                        {isOnDeckB && <span className="ml-1 text-deck-b">B</span>}
                      </td>
                      <td className="px-2 py-2 text-rbox-text font-medium truncate max-w-[180px]">{track.title}</td>
                      <td className="px-2 py-2 text-rbox-dim truncate max-w-[120px] hidden md:table-cell">{track.artist}</td>
                      <td className="px-2 py-2 text-rbox-dim hidden lg:table-cell">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rbox-panel3">{track.genre}</span>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className="text-[10px] font-mono text-rbox-amber">{track.key}</span>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-rbox-text">{track.bpm}</td>
                      <td className="px-2 py-2 text-center hidden sm:table-cell">
                        <div className="flex items-center justify-center gap-0.5" title={formatEnergy(track.energy)}>
                          {Array.from({ length: 5 }).map((_, index) => (
                            <div
                              key={index}
                              className="w-1 h-3 rounded-sm"
                              style={{
                                background: Math.ceil(track.energy * 5) > index
                                  ? index < 2 ? '#22c55e' : index < 4 ? '#fbbf24' : '#ef4444'
                                  : '#2a2d38',
                              }}
                            />
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-rbox-dim text-[10px]">{formatDuration(track.duration_sec)}</td>
                      <td
                        className="px-2 py-2"
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        <select
                          key={playlists.map((playlist) => `${playlist.id}:${playlist.track_ids.includes(String(track.id))}`).join('|')}
                          defaultValue=""
                          aria-label={`Manage playlists for ${track.title}`}
                          onChange={(event) => {
                            const playlistId = event.target.value;
                            if (!playlistId) return;
                            void handleToggleTrack(playlistId, String(track.id));
                            event.target.value = '';
                          }}
                          className="max-w-36 rounded border border-rbox-line bg-rbox-panel2 px-1.5 py-1 text-[10px] text-rbox-text"
                        >
                          <option value="">+ Playlist</option>
                          {playlists.map((playlist) => (
                            <option key={playlist.id} value={playlist.id}>
                              {playlist.track_ids.includes(String(track.id)) ? 'Remove from' : 'Add to'} {playlist.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {visibleTracks.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-16 text-rbox-dim text-xs gap-2">
                <Music2 size={32} className="opacity-30" />
                <span>
                  {activePlaylist
                    ? 'This playlist is empty. Add tracks using the Playlist column.'
                    : 'No tracks found. Try changing your search or filters.'}
                </span>
              </div>
            )}
            {loading && tracks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-rbox-dim text-xs gap-2">
                <RefreshCw size={24} className="animate-spin opacity-50" />
                <span>Loading tracks from backend...</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-1.5 bg-rbox-panel2 border-t border-rbox-line text-[9px] font-mono text-rbox-dim flex items-center justify-between">
            <span>Click a track to load to Deck {dj.pendingDeck}</span>
            <span>Backend: {import.meta.env.VITE_API_BASE_URL ? 'custom' : 'localhost:8000'}</span>
          </div>
        </>
      )}
    </div>
  );
}

export default TrackBrowser;
