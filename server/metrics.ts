/**
 * What a scraper reads (production roadmap 0.12.5): the numbers /health gives, as OpenMetrics text. Counts, sizes and durations only: nothing here
 * names a player, an address or a crew, so a dashboard can be shared. `GET /metrics` exists only when `METRICS_TOKEN` is set, and answers to that
 * token alone, because a stranger has no use for how busy the server is and someone with bad intentions does.
 */
export const OPENMETRICS_TYPE = 'application/openmetrics-text; version=1.0.0; charset=utf-8';

export interface Metric {
  name: string;
  help: string;
  /** a gauge moves both ways; a counter only rises, and OpenMetrics wants its sample to end in _total */ type: 'gauge' | 'counter';
  /** one value, or one per label */ value: number | Record<string, number>;
  /** the label's name, when `value` has several */ label?: string;
}

const escapeLabel = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export function openMetrics(metrics: readonly Metric[]): string {
  const out: string[] = [];
  for (const m of metrics) {
    out.push(`# HELP ${m.name} ${m.help}`, `# TYPE ${m.name} ${m.type}`);
    const sample = m.type === 'counter' ? `${m.name}_total` : m.name;
    if (typeof m.value === 'number') out.push(`${sample} ${m.value}`);
    else for (const [k, v] of Object.entries(m.value)) out.push(`${sample}{${m.label ?? 'kind'}="${escapeLabel(k)}"} ${v}`);
  }
  out.push('# EOF');
  return `${out.join('\n')}\n`;
}
