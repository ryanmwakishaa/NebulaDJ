import { useEffect, useState } from 'react';
import {
  Sparkles,
  Zap,
  Flame,
  Sunrise,
  Sunset,
  Moon,
  HeartPulse,
  Wand2,
  Download,
  Loader2,
  ChevronRight,
  ArrowRight,
  TrendingUp,
  Activity,
  Music,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';
import { useAIStore } from '@/store/aiStore';
import { useDJStore } from '@/store/djStore';
import { AutoDJControls } from '@/components/AutoDJControls';
import type { AIMode, AISetTrack, NextTrackRecommendation } from '@/types';
import { formatDuration } from '@/lib/format';
import { api, type Playlist } from '@/lib/api';

const AI_MODES: { mode: AIMode; label: string; icon: React.ReactNode; desc: string; color: string }[] = [
  { mode: 'auto', label: 'Generate AI Set', icon: <Sparkles size={15} />, desc: 'Auto-select tracks for a seamless mix', color: '#2dd4bf' },
  { mode: 'build_energy', label: 'Build Energy', icon: <TrendingUp size={15} />, desc: 'Gradually increase energy throughout the set', color: '#fbbf24' },
  { mode: 'peak_hour', label: 'Peak Hour', icon: <Flame size={15} />, desc: 'High-energy tracks for the dancefloor peak', color: '#ef4444' },
  { mode: 'warm_up', label: 'Warm Up', icon: <Sunrise size={15} />, desc: 'Groovy, lower-energy opening tracks', color: '#fb923c' },
  { mode: 'afro_house_journey', label: 'Afro House Journey', icon: <Wand2 size={15} />, desc: 'Deep, rhythmic Afro house progression', color: '#22c55e' },
  { mode: 'sunset_session', label: 'Sunset Session', icon: <Sunset size={15} />, desc: 'Melodic, atmospheric vibes for golden hour', color: '#f97316' },
  { mode: 'recovery_mode', label: 'Recovery Mode', icon: <Moon size={15} />, desc: 'Cool-down tracks to close the night', color: '#60a5fa' },
];

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[8px] font-mono text-rbox-dim w-10 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-rbox-panel3 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${value * 100}%`, background: color }}
        />
      </div>
      <span className="text-[8px] font-mono w-7 text-right" style={{ color }}>
        {Math.round(value * 100)}
      </span>
    </div>
  );
}

function SetTrackRow({ item }: { item: AISetTrack }) {
  const dj = useDJStore();
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-rbox-panel2/60 rounded-md border border-rbox-line/50 hover:border-rbox-line transition-colors group">
      <span
        className="text-[10px] font-mono font-bold w-5 text-center shrink-0"
        style={{ color: item.deck === 'A' ? '#2dd4bf' : '#fb7185' }}
      >
        {item.deck}
      </span>
      <span className="text-[9px] font-mono text-rbox-dim w-4 text-center shrink-0">{item.position + 1}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-rbox-text font-medium truncate">{item.track.title}</div>
        <div className="text-[10px] text-rbox-dim truncate">{item.track.artist}</div>
      </div>
      <span className="text-[9px] font-mono text-rbox-amber shrink-0">{item.track.key}</span>
      <span className="text-[10px] font-mono text-rbox-text shrink-0">{item.track.bpm}</span>
      <span className="text-[9px] font-mono text-rbox-dim shrink-0 hidden lg:inline">{formatDuration(item.track.duration_sec)}</span>
      <button
        onClick={() => dj.loadTrack(item.deck, item.track)}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-mono px-1.5 py-0.5 rounded bg-rbox-panel3 text-rbox-dim hover:text-rbox-text border border-rbox-line"
      >
        LOAD
      </button>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: NextTrackRecommendation }) {
  const dj = useDJStore();
  const score = rec.compatibility_score;
  const scoreColor = score > 0.8 ? '#22c55e' : score > 0.6 ? '#fbbf24' : score > 0.4 ? '#fb923c' : '#ef4444';

  return (
    <div className="bg-rbox-panel2/60 rounded-lg border border-rbox-line/50 p-2.5 hover:border-rbox-line transition-colors group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-rbox-text truncate">{rec.track.title}</div>
          <div className="text-[10px] text-rbox-dim truncate">{rec.track.artist}</div>
        </div>
        <div className="flex flex-col items-center shrink-0">
          <div
            className="text-lg font-display leading-none"
            style={{ color: scoreColor }}
          >
            {Math.round(score * 100)}
          </div>
          <span className="text-[7px] font-mono text-rbox-dim">MATCH</span>
        </div>
      </div>

      {/* Compatibility breakdown */}
      <div className="space-y-1 mb-2">
        <ScoreBar label="BPM" value={rec.bpm_compatibility} color="#2dd4bf" />
        <ScoreBar label="HARM" value={rec.harmonic_compatibility} color="#fbbf24" />
        <ScoreBar label="ENER" value={rec.energy_compatibility} color="#fb7185" />
        <ScoreBar label="GENRE" value={rec.genre_affinity} color="#22c55e" />
      </div>

      {/* Explanation */}
      <p className="text-[10px] text-rbox-dim leading-relaxed mb-2 line-clamp-3">{rec.explanation}</p>

      {/* Metadata + load buttons */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[9px] font-mono">
          <span className="text-rbox-amber">{rec.track.key}</span>
          <span className="text-rbox-text">{rec.track.bpm} BPM</span>
          <span className="text-rbox-dim hidden sm:inline">{rec.track.genre}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => dj.loadTrack('A', rec.track)}
            className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-deck-a/15 text-deck-a border border-deck-a/30 hover:bg-deck-a/25 transition-colors"
          >
            →A
          </button>
          <button
            onClick={() => dj.loadTrack('B', rec.track)}
            className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-deck-b/15 text-deck-b border border-deck-b/30 hover:bg-deck-b/25 transition-colors"
          >
            →B
          </button>
        </div>
      </div>
      <div className="mt-1.5 text-[8px] font-mono text-rbox-dim italic">
        Transition: {rec.recommended_transition}
      </div>
    </div>
  );
}

export function AIPanel() {
  const ai = useAIStore();
  const dj = useDJStore();
  const [activeTab, setActiveTab] = useState<'set' | 'recommendations' | 'mix'>('set');

  // Set length: 0 means "as many tracks as this set type allows"
  const [setLength, setSetLength] = useState<number>(0);
  const [targetDuration, setTargetDuration] = useState<number>(30);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>('');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>('Afro House');

  useEffect(() => {
    api.getPlaylists().then(setPlaylists).catch(() => setPlaylists([]));
  }, []);
  const maxTracks = (ai.currentSet as unknown as { max_tracks?: number } | null)?.max_tracks;

  const deckAtrack = dj.decks.A.track;
  const deckBtrack = dj.decks.B.track;

  // Auto-fetch recommendations when decks change
  useEffect(() => {
    if (deckAtrack || deckBtrack) {
      ai.fetchRecommendations(deckAtrack?.id, deckBtrack?.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckAtrack?.id, deckBtrack?.id]);

  const handleGenerate = () => {
    ai.generateSet({
      seedTrackId: deckAtrack?.id,
      deckATrackId: deckAtrack?.id,
      deckBTrackId: deckBtrack?.id,
      numTracks: setLength,
      playlistId: selectedPlaylistId || undefined,
      genre: selectedGenre || undefined,
      durationMinutes: setLength ? undefined : targetDuration || undefined,
    });
  };

  const handleRenderMix = () => {
    if (ai.currentSet) {
      ai.renderMix(ai.currentSet.id);
    }
  };

  const renderStatus = ai.renderStatus;
  const isComplete = renderStatus?.status === 'complete' && renderStatus.download_url;

  return (
    <div className="flex flex-col h-full bg-rbox-panel rounded-xl border border-rbox-line shadow-inset-deep overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 bg-rbox-panel2 border-b border-rbox-line flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-deck-a to-deck-b flex items-center justify-center">
            <Sparkles size={14} className="text-rbox-bg" />
          </div>
          <div>
            <span className="text-sm font-display tracking-wider text-rbox-text">AI DJ ENGINE</span>
            <p className="text-[8px] font-mono text-rbox-dim tracking-widest">POWERED BY VIRTUALDJ</p>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-1">
          {(['set', 'recommendations', 'mix'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                activeTab === tab
                  ? 'bg-rbox-panel3 text-rbox-amber border border-rbox-amber/30'
                  : 'text-rbox-dim hover:text-rbox-text border border-transparent'
              }`}
            >
              {tab === 'set' ? 'SET' : tab === 'recommendations' ? 'RECS' : 'MIX'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin">
        {/* ---- SET TAB ---- */}
        {activeTab === 'set' && (
          <div className="p-3 space-y-3">
            <div className="text-[10px] font-mono text-rbox-dim uppercase tracking-wider">
              AI Set Generation Modes
            </div>

            {/* Mix source and constraints */}
            <div className="space-y-2 rounded-lg border border-rbox-line bg-rbox-panel2/50 p-3">
              <label className="block text-[10px] font-mono text-rbox-dim uppercase tracking-wider">
                Source playlist
                <select
                  value={selectedPlaylistId}
                  onChange={(e) => setSelectedPlaylistId(e.target.value)}
                  disabled={ai.isGenerating}
                  className="mt-1 block w-full text-xs normal-case bg-rbox-panel3 text-rbox-text border border-rbox-line rounded px-2 py-1.5 disabled:opacity-50"
                >
                  <option value="">Entire library</option>
                  {playlists.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.name} ({playlist.track_ids.length} tracks)
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[10px] font-mono text-rbox-dim uppercase tracking-wider">
                Genre filter
                <select
                  value={selectedGenre}
                  onChange={(e) => setSelectedGenre(e.target.value)}
                  disabled={ai.isGenerating}
                  className="mt-1 block w-full text-xs normal-case bg-rbox-panel3 text-rbox-text border border-rbox-line rounded px-2 py-1.5 disabled:opacity-50"
                >
                  <option value="Afro House">Afro House only</option>
                  <option value="">Any genre</option>
                </select>
              </label>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-mono text-rbox-dim uppercase tracking-wider">Target duration</span>
                <select
                  value={targetDuration}
                  onChange={(e) => { setTargetDuration(Number(e.target.value)); setSetLength(0); }}
                  disabled={ai.isGenerating}
                  className="text-[10px] font-mono bg-rbox-panel3 text-rbox-text border border-rbox-line rounded px-2 py-1 disabled:opacity-50"
                >
                  <option value={0}>Max for mode</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-mono text-rbox-dim uppercase tracking-wider">Exact track count (optional)</span>
                <select
                  value={setLength}
                  onChange={(e) => setSetLength(Number(e.target.value))}
                  disabled={ai.isGenerating}
                  className="text-[10px] font-mono bg-rbox-panel3 text-rbox-text border border-rbox-line rounded px-2 py-1 disabled:opacity-50"
                >
                  <option value={0}>Use target duration</option>
                  {[8, 12, 20, 30, 50].map((n) => (
                    <option key={n} value={n}>{n} tracks</option>
                  ))}
                </select>
              </div>
              <p className="text-[9px] text-rbox-dim">
                A selected playlist is a strict boundary. If it doesn't contain enough matching tracks, generation fails instead of pulling from the full library.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {AI_MODES.map((mode) => (
                <button
                  key={mode.mode}
                  onClick={() => {
                    ai.setMode(mode.mode);
                    ai.generateSet({
                      mode: mode.mode,
                      seedTrackId: deckAtrack?.id,
                      deckATrackId: deckAtrack?.id,
                      deckBTrackId: deckBtrack?.id,
                      numTracks: setLength,
                      playlistId: selectedPlaylistId || undefined,
                      genre: selectedGenre || undefined,
                      durationMinutes: setLength ? undefined : targetDuration || undefined,
                    });
                  }}
                  disabled={ai.isGenerating}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-rbox-line bg-rbox-panel2/60 hover:bg-rbox-panel2 transition-all text-left group disabled:opacity-50"
                  style={{ borderLeftColor: mode.color, borderLeftWidth: '3px' }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: mode.color + '22', color: mode.color }}
                  >
                    {mode.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-rbox-text">{mode.label}</div>
                    <div className="text-[10px] text-rbox-dim truncate">{mode.desc}</div>
                  </div>
                  {ai.currentMode === mode.mode && ai.isGenerating && (
                    <Loader2 size={14} className="text-rbox-amber animate-spin shrink-0" />
                  )}
                  {ai.currentMode === mode.mode && !ai.isGenerating && ai.currentSet && (
                    <CheckCircle2 size={14} className="text-rbox-green shrink-0" />
                  )}
                </button>
              ))}
            </div>

            {/* Error */}
            {ai.generateError && (
              <div className="flex items-start gap-2 px-3 py-2 bg-rbox-red/10 border border-rbox-red/30 rounded-lg text-[10px] font-mono text-rbox-red">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{ai.generateError}</span>
              </div>
            )}

            {/* Generated set results */}
            {ai.currentSet && !ai.isGenerating && (
              <div className="space-y-2">
                <div className="flex items-center justify-between pt-2 border-t border-rbox-line">
                  <span className="text-[10px] font-mono text-rbox-dim uppercase tracking-wider">
                    Generated Set
                  </span>
                  <div className="flex items-center gap-2 text-[9px] font-mono text-rbox-dim">
                    <span className="text-rbox-amber">{ai.currentSet.tracks.length} tracks</span>
                    <span>{formatDuration(ai.currentSet.total_duration_sec)}</span>
                    <span>{Math.round(ai.currentSet.avg_bpm)} avg BPM</span>
                  </div>
                </div>

                {maxTracks ? (
                  <div className="text-[9px] font-mono text-rbox-dim">
                    This mode can use up to {maxTracks} tracks from your library
                  </div>
                ) : null}

                {/* Energy curve mini-chart */}
                <div className="bg-rbox-panel2/60 rounded-lg border border-rbox-line/50 p-2">
                  <div className="text-[8px] font-mono text-rbox-dim mb-1">ENERGY CURVE</div>
                  <div className="flex items-end gap-px h-10">
                    {ai.currentSet.energy_curve.map((e, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t-sm transition-all"
                        style={{
                          height: `${e * 100}%`,
                          background: e > 0.7 ? '#ef4444' : e > 0.4 ? '#fbbf24' : '#22c55e',
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Track list */}
                <div className="space-y-1">
                  {ai.currentSet.tracks.map((item) => (
                    <SetTrackRow key={`${item.position}-${item.track.id}`} item={item} />
                  ))}
                </div>

                {/* Auto-DJ */}
                <AutoDJControls />

                {/* Generate Mix button */}
                <button
                  onClick={() => setActiveTab('mix')}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-deck-a/20 to-deck-b/20 border border-rbox-amber/30 text-rbox-amber text-xs font-mono hover:from-deck-a/30 hover:to-deck-b/30 transition-all"
                >
                  <Zap size={14} /> Generate Mix & Export MP3 <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ---- RECOMMENDATIONS TAB ---- */}
        {activeTab === 'recommendations' && (
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-rbox-dim uppercase tracking-wider">
                Next Track Recommendations
              </span>
              <button
                onClick={() => ai.fetchRecommendations(deckAtrack?.id, deckBtrack?.id)}
                disabled={ai.recsLoading}
                className="text-[9px] font-mono text-rbox-dim hover:text-rbox-text flex items-center gap-1"
              >
                <Activity size={10} className={ai.recsLoading ? 'animate-pulse' : ''} /> Refresh
              </button>
            </div>

            {/* Current deck context */}
            {(deckAtrack || deckBtrack) && (
              <div className="flex items-center gap-2 px-2 py-1.5 bg-rbox-panel2/60 rounded-lg border border-rbox-line/50">
                <span className="text-[8px] font-mono text-rbox-dim">CONTEXT:</span>
                {deckAtrack && (
                  <span className="text-[9px] font-mono text-deck-a truncate">
                    A: {deckAtrack.title}
                  </span>
                )}
                {deckBtrack && (
                  <span className="text-[9px] font-mono text-deck-b truncate">
                    B: {deckBtrack.title}
                  </span>
                )}
              </div>
            )}

            {!deckAtrack && !deckBtrack && (
              <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                <Music size={28} className="text-rbox-dim opacity-40" />
                <span className="text-[10px] text-rbox-dim">
                  Load a track to a deck to get AI-powered recommendations
                </span>
              </div>
            )}

            {ai.recsError && (
              <div className="flex items-start gap-2 px-3 py-2 bg-rbox-red/10 border border-rbox-red/30 rounded-lg text-[10px] font-mono text-rbox-red">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{ai.recsError}</span>
              </div>
            )}

            {ai.recsLoading && (
              <div className="flex items-center justify-center py-8 gap-2">
                <Loader2 size={20} className="text-rbox-amber animate-spin" />
                <span className="text-[10px] font-mono text-rbox-dim">Analyzing compatibility...</span>
              </div>
            )}

            {!ai.recsLoading && ai.recommendations.length > 0 && (
              <div className="space-y-2">
                {ai.recommendations.map((rec) => (
                  <RecommendationCard key={rec.track.id} rec={rec} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- MIX TAB ---- */}
        {activeTab === 'mix' && (
          <div className="p-3 space-y-3">
            <div className="text-[10px] font-mono text-rbox-dim uppercase tracking-wider">
              Mix Rendering & Export
            </div>

            {!ai.currentSet && (
              <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                <HeartPulse size={28} className="text-rbox-dim opacity-40" />
                <span className="text-[10px] text-rbox-dim">
                  Generate an AI set first, then render it as a downloadable MP3
                </span>
                <button
                  onClick={() => setActiveTab('set')}
                  className="mt-2 px-3 py-1.5 text-[10px] font-mono rounded-lg bg-rbox-panel3 text-rbox-text border border-rbox-line hover:border-rbox-amber/50 transition-colors"
                >
                  Go to Set Generation <ArrowRight size={11} className="inline" />
                </button>
              </div>
            )}

            {ai.currentSet && (
              <>
                {/* Set summary */}
                <div className="bg-rbox-panel2/60 rounded-lg border border-rbox-line/50 p-3 space-y-1.5">
                  <div className="text-xs font-semibold text-rbox-text">Current AI Set</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-[8px] font-mono text-rbox-dim">TRACKS</div>
                      <div className="text-sm font-mono text-rbox-text">{ai.currentSet.tracks.length}</div>
                    </div>
                    <div>
                      <div className="text-[8px] font-mono text-rbox-dim">DURATION</div>
                      <div className="text-sm font-mono text-rbox-text">{formatDuration(ai.currentSet.total_duration_sec)}</div>
                    </div>
                    <div>
                      <div className="text-[8px] font-mono text-rbox-dim">AVG BPM</div>
                      <div className="text-sm font-mono text-rbox-text">{Math.round(ai.currentSet.avg_bpm)}</div>
                    </div>
                  </div>
                </div>

                {/* Render button */}
                <button
                  onClick={handleRenderMix}
                  disabled={ai.isRendering}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-gradient-to-r from-deck-a/25 to-deck-b/25 border border-rbox-amber/40 text-rbox-amber font-mono text-sm hover:from-deck-a/35 hover:to-deck-b/35 transition-all disabled:opacity-50"
                >
                  {ai.isRendering ? (
                    <><Loader2 size={16} className="animate-spin" /> Rendering Mix...</>
                  ) : (
                    <><Zap size={16} /> Generate Mix</>
                  )}
                </button>

                {/* Render progress */}
                {renderStatus && renderStatus.status !== 'complete' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-rbox-dim">{renderStatus.status.toUpperCase()}</span>
                      <span className="text-rbox-amber">{Math.round(renderStatus.progress * 100)}%</span>
                    </div>
                    <div className="h-2 bg-rbox-panel3 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-deck-a to-rbox-amber rounded-full transition-all duration-1000"
                        style={{ width: `${renderStatus.progress * 100}%` }}
                      />
                    </div>
                    {renderStatus.message && (
                      <p className="text-[9px] font-mono text-rbox-dim">{renderStatus.message}</p>
                    )}
                  </div>
                )}

                {/* Render error */}
                {ai.renderError && (
                  <div className="flex items-start gap-2 px-3 py-2 bg-rbox-red/10 border border-rbox-red/30 rounded-lg text-[10px] font-mono text-rbox-red">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>{ai.renderError}</span>
                  </div>
                )}

                {/* Download */}
                {isComplete && (
                  <div className="bg-rbox-green/10 border border-rbox-green/30 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2 text-rbox-green">
                      <CheckCircle2 size={16} />
                      <span className="text-xs font-mono">Mix rendered successfully!</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-rbox-dim">
                      <span>Duration: {formatDuration(renderStatus!.duration_sec ?? 0)}</span>
                      <span>Size: {renderStatus!.file_size_mb?.toFixed(1) ?? '--'} MB</span>
                    </div>
                    <a
                      href={api.getMixDownloadUrl(renderStatus!.id)}
                      download
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-rbox-green/20 border border-rbox-green/40 text-rbox-green font-mono text-xs hover:bg-rbox-green/30 transition-all"
                    >
                      <Download size={15} /> Download MP3
                    </a>
                  </div>
                )}

                {/* Render history note */}
                <div className="text-[9px] font-mono text-rbox-dim text-center pt-2">
                  The backend renders time-stretched, phrase-aligned, crossfaded mixes with harmonic mixing
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}