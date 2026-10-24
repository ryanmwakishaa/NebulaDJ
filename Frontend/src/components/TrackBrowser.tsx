import { useEffect, useState } from 'react';
import { Search, Music2, TrendingUp, Clock, Disc3, ChevronDown, RefreshCw } from 'lucide-react';
import { useTracksStore } from '@/store/tracksStore';
import { useDJStore } from '@/store/djStore';
import { formatDuration, formatEnergy } from '@/lib/format';

type SortKey = 'bpm' | 'energy' | 'title' | 'artist' | 'duration' | 'created';

export function TrackBrowser() {
  const { tracks, genres, keys, loading, error, query, setQuery, fetchTracks, fetchGenres, fetchKeys } =
    useTracksStore();
  const dj = useDJStore();
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchTracks();
    fetchGenres();
    fetchKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortIcon = (key: SortKey, label: string, icon: React.ReactNode) => (
    <button
      onClick={() => setQuery({ sort: key, sort_dir: query.sort === key && query.sort_dir === 'asc' ? 'desc' : 'asc' })}
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
    <div className="flex flex-col h-full bg-rbox-panel rounded-xl border border-rbox-line shadow-inset-deep overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 bg-rbox-panel2 border-b border-rbox-line flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Disc3 size={16} className="text-rbox-amber" />
          <span className="text-sm font-display tracking-wider text-rbox-text">TRACK LIBRARY</span>
          <span className="text-[10px] font-mono text-rbox-dim ml-2">
            {tracks.length} tracks{loading && ' · loading...'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchTracks()}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-rbox-dim hover:text-rbox-text rounded border border-rbox-line hover:border-rbox-dim transition-colors"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
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

      {/* Search + filters */}
      <div className="flex items-center gap-2 px-3 py-2 bg-rbox-panel border-b border-rbox-line">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-rbox-dim" />
          <input
            value={query.search ?? ''}
            onChange={(e) => setQuery({ search: e.target.value || undefined })}
            placeholder="Search tracks or artists..."
            className="w-full bg-rbox-panel2 border border-rbox-line rounded-lg pl-8 pr-3 py-1.5 text-xs text-rbox-text placeholder:text-rbox-dim focus:outline-none focus:border-rbox-amber/50 transition-colors"
          />
        </div>
        <select
          value={query.genre ?? 'all'}
          onChange={(e) => setQuery({ genre: e.target.value === 'all' ? undefined : e.target.value })}
          className="bg-rbox-panel2 border border-rbox-line rounded-lg px-2 py-1.5 text-xs text-rbox-text focus:outline-none focus:border-rbox-amber/50 cursor-pointer"
        >
          <option value="all">All Genres</option>
          {genres.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <select
          value={query.key ?? 'all'}
          onChange={(e) => setQuery({ key: e.target.value === 'all' ? undefined : e.target.value })}
          className="bg-rbox-panel2 border border-rbox-line rounded-lg px-2 py-1.5 text-xs text-rbox-text focus:outline-none focus:border-rbox-amber/50 cursor-pointer"
        >
          <option value="all">All Keys</option>
          {keys.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1 px-2 py-1.5 text-[10px] font-mono rounded-lg border transition-colors ${
            showFilters ? 'bg-rbox-panel3 text-rbox-amber border-rbox-amber/30' : 'bg-rbox-panel2 text-rbox-dim border-rbox-line hover:text-rbox-text'
          }`}
        >
          Filters <ChevronDown size={11} className={showFilters ? 'rotate-180' : ''} />
        </button>
      </div>

      {/* Advanced filters row */}
      {showFilters && (
        <div className="flex items-center gap-3 px-3 py-2 bg-rbox-panel2/50 border-b border-rbox-line text-xs">
          <div className="flex items-center gap-1.5">
            <label className="text-[9px] font-mono text-rbox-dim">BPM</label>
            <input
              type="number"
              placeholder="min"
              className="w-14 bg-rbox-panel2 border border-rbox-line rounded px-1.5 py-1 text-[10px] font-mono text-rbox-text focus:outline-none focus:border-rbox-amber/50"
              value={query.min_bpm ?? ''}
              onChange={(e) => setQuery({ min_bpm: e.target.value ? Number(e.target.value) : undefined })}
            />
            <span className="text-rbox-dim">-</span>
            <input
              type="number"
              placeholder="max"
              className="w-14 bg-rbox-panel2 border border-rbox-line rounded px-1.5 py-1 text-[10px] font-mono text-rbox-text focus:outline-none focus:border-rbox-amber/50"
              value={query.max_bpm ?? ''}
              onChange={(e) => setQuery({ max_bpm: e.target.value ? Number(e.target.value) : undefined })}
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
              onChange={(e) => setQuery({ min_energy: e.target.value ? Number(e.target.value) : undefined })}
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
              onChange={(e) => setQuery({ max_energy: e.target.value ? Number(e.target.value) : undefined })}
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

      {/* Sort bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 bg-rbox-panel2/50 border-b border-rbox-line flex-wrap">
        {sortIcon('bpm', 'BPM', <Music2 size={10} />)}
        {sortIcon('energy', 'ENERGY', <TrendingUp size={10} />)}
        {sortIcon('duration', 'TIME', <Clock size={10} />)}
        {sortIcon('title', 'NAME', null)}
        {sortIcon('artist', 'ARTIST', null)}
        {sortIcon('created', 'DATE', null)}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 bg-rbox-red/10 border-b border-rbox-red/30 text-[10px] font-mono text-rbox-red">
          {error}
        </div>
      )}

      {/* Track list */}
      <div className="flex-1 overflow-y-auto scroll-thin">
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
            </tr>
          </thead>
          <tbody>
            {tracks.map((track, i) => {
              const isOnDeckA = dj.decks.A.track?.id === track.id;
              const isOnDeckB = dj.decks.B.track?.id === track.id;
              return (
                <tr
                  key={track.id}
                  onClick={() => dj.loadTrack(dj.pendingDeck, track)}
                  className="cursor-pointer border-b border-rbox-line/50 hover:bg-rbox-panel2/60 transition-colors group"
                >
                  <td className="px-3 py-2 text-rbox-dim font-mono text-[10px]">
                    {String(i + 1).padStart(2, '0')}
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
                      {Array.from({ length: 5 }).map((_, idx) => (
                        <div
                          key={idx}
                          className="w-1 h-3 rounded-sm"
                          style={{
                            background: Math.ceil(track.energy * 5) > idx
                              ? idx < 2 ? '#22c55e' : idx < 4 ? '#fbbf24' : '#ef4444'
                              : '#2a2d38',
                          }}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-rbox-dim text-[10px]">{formatDuration(track.duration_sec)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {tracks.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-16 text-rbox-dim text-xs gap-2">
            <Music2 size={32} className="opacity-30" />
            <span>No tracks found. Make sure your backend is running and the library has been analyzed.</span>
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
    </div>
  );
}
