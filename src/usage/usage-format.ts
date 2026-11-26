import type { UsageSummary } from './usage-types';

export const emptyUsage: UsageSummary = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0, costUsd: 0, unpricedRequests: 0, requests: 0, completedTurns: 0, assumedTierRequests: 0, missingCacheRequests: 0, missingCachedRequests: 0, missingCacheWriteRequests: 0, unmeasuredTurns: 0 };
export function count(value: number): string { return new Intl.NumberFormat('en-US').format(value); }
function compactCount(value: number): string { return value >= 10000 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value) : count(value); }
const percentageFormat = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
export function formatPercentage(fraction: number): string { return percentageFormat.format(fraction); }
export function cachePercentage(cached: number, input: number): string {
  return formatPercentage(input > 0 ? cached / input : 0);
}
export function usageCount(usage: UsageSummary, field: 'input' | 'output' | 'total', compact = false): string {
  const value = compact ? compactCount(usage[field]) : count(usage[field]);
  if (!usage.unmeasuredTurns) return value;
  return usage.requests ? value + ' + unknown' : 'Unknown';
}
export function cachedCount(usage: UsageSummary, compact = false): string {
  const value = compact ? compactCount(usage.cached) : count(usage.cached);
  if (usage.missingCachedRequests === usage.requests && usage.requests > 0 || usage.unmeasuredTurns && !usage.requests) return 'Unknown';
  if (usage.missingCachedRequests || usage.unmeasuredTurns) return value + ' + unknown';
  return value + ' (' + cachePercentage(usage.cached, usage.input) + ')';
}
export function cacheWrites(usage: UsageSummary): string {
  if (usage.missingCacheWriteRequests === usage.requests && usage.requests > 0 || usage.unmeasuredTurns && !usage.requests) return 'Unknown';
  if (usage.missingCacheWriteRequests || usage.unmeasuredTurns) return count(usage.cacheWrite) + ' + unknown';
  return count(usage.cacheWrite);
}
function missingMoney(usage: UsageSummary): string | null {
  if (usage.unmeasuredTurns && !usage.requests) return 'Unknown';
  if (usage.unpricedRequests && usage.requests === usage.unpricedRequests) return 'Unavailable';
  return null;
}
export function moneyAmount(costUsd: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(costUsd);
}
function unknownSuffix(usage: UsageSummary): string { return usage.unmeasuredTurns ? ' + unknown' : ''; }
export function money(usage: UsageSummary): string {
  return missingMoney(usage) ?? moneyAmount(usage.costUsd) + (usage.unpricedRequests ? ' + unpriced' : '') + unknownSuffix(usage);
}
function unpricedMarker(requests: number): HTMLElement {
  const explanation = 'Excludes ' + count(requests) + ' unpriced request' + (requests === 1 ? '' : 's');
  const marker = document.createElement('sup'); marker.className = 'unpriced-marker'; marker.title = explanation;
  const symbol = document.createElement('span'); symbol.setAttribute('aria-hidden', 'true'); symbol.textContent = '*';
  const label = document.createElement('span'); label.className = 'visually-hidden'; label.textContent = ' (' + explanation.toLowerCase() + ')';
  marker.append(symbol, label); return marker;
}
// Shows a partial amount with an asterisk instead of the "+ unpriced" text.
export function renderMoney(target: HTMLElement, usage: UsageSummary): void {
  const missing = missingMoney(usage);
  target.textContent = missing ?? moneyAmount(usage.costUsd);
  if (missing !== null) return;
  if (usage.unpricedRequests) target.append(unpricedMarker(usage.unpricedRequests));
  target.append(unknownSuffix(usage));
}
export function summaryText(usage: UsageSummary): string {
  return usageCount(usage, 'total') + ' tokens · ' + usageCount(usage, 'input') + ' input · ' + cachedCount(usage) + ' cached input · ' + cacheWrites(usage) + ' cache writes · ' + usageCount(usage, 'output') + ' output · ' + money(usage) + ' estimated API equivalent';
}
