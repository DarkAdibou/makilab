const TAG_COLORS = [
  '#5423e7', '#22c55e', '#f59e0b', '#ef4444',
  '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6',
];

export function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]!;
}

export function humanCron(expr: string): string {
  const parts = expr.split(' ');
  if (parts.length !== 5) return expr;
  const [min, hour, dom, , dow] = parts;
  const dayNames: Record<string, string> = {
    '0': 'dimanche', '1': 'lundi', '2': 'mardi', '3': 'mercredi',
    '4': 'jeudi', '5': 'vendredi', '6': 'samedi', '7': 'dimanche',
  };
  if (dow !== '*' && dom === '*' && hour !== '*')
    return `${dayNames[dow!] ?? `jour ${dow}`} ${hour}h${min === '0' ? '' : min}`;
  if (dow === '*' && dom === '*' && hour !== '*')
    return `Tous les jours ${hour}h${min === '0' ? '' : min}`;
  if (dom !== '*' && dow === '*' && hour !== '*')
    return `Le ${dom} du mois ${hour}h${min === '0' ? '' : min}`;
  return expr;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'maintenant';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}j`;
}

export function parseTags(tagsJson: string | null | undefined): string[] {
  try { return JSON.parse(tagsJson || '[]'); } catch { return []; }
}
