export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatEnergy(energy: number): string {
  if (energy <= 0.3) return 'Low';
  if (energy <= 0.5) return 'Medium';
  if (energy <= 0.7) return 'High';
  if (energy <= 0.85) return 'Very High';
  return 'Peak';
}
