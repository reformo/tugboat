import { invoke } from '@tauri-apps/api/core';
import { agentName, type AgentKind } from '../projects/projects';
import { showDialog } from '../ui/dialogs';
import { setBusy } from '../ui/loading';
import { RequestState } from '../ui/request-state';
import { cachedCount, cacheWrites, emptyUsage, formatPercentage, money, usageCount } from './usage-format';
import type { UsageSummary } from './usage-types';

type BreakdownRow = { agentKind: AgentKind; model: string | null; effort: string | null; usage: UsageSummary };
type Dimension = 'agentKind' | 'model' | 'effort';
type Sort = 'tokens' | 'cost' | Dimension;
type Column = { label: string; sortBy?: Sort; className?: string };
type Group = { values: (string | null)[]; usage: UsageSummary };
type CalendarRange = { start: Date; end: Date };

const dimensionLabels = { agentKind: 'Agent', model: 'Model', effort: 'Effort' };
const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const usageFields = Object.keys(emptyUsage) as (keyof UsageSummary)[];
const dateLabel = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const presetDays: Readonly<Partial<Record<string, number>>> = { today: 1, 'last-7-days': 7, 'last-30-days': 30 };

function presetDates(preset: string): CalendarRange | null {
  const days = presetDays[preset];
  if (days === undefined && preset !== 'this-month') return null;
  const now = new Date();
  // Use UTC dates as calendar values so that moving a day does not depend on its local length.
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const start = new Date(end);
  start.setUTCDate(days === undefined ? 1 : end.getUTCDate() - days + 1);
  return { start, end };
}

function localMidnight(date: Date, dayOffset = 0): number {
  const midnight = new Date(2000, 0, 1);
  return midnight.setFullYear(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + dayOffset);
}

function displayLabel(row: BreakdownRow, dimension: Dimension): string | null {
  if (dimension === 'agentKind') return agentName(row.agentKind);
  return row[dimension];
}

function compareLabels(dimension: Dimension, first: string | null, second: string | null): number {
  if (first === second) return 0;
  if (first === null) return 1;
  if (second === null) return -1;
  if (dimension === 'effort') {
    const order = (value: string) => effortOrder.includes(value) ? effortOrder.indexOf(value) : effortOrder.length;
    const difference = order(first) - order(second);
    if (difference) return difference;
  }
  return first.localeCompare(second);
}

function groupUsage(rows: BreakdownRow[], dimensions: Dimension[], sort: Sort): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const values = dimensions.map(dimension => displayLabel(row, dimension));
    const key = JSON.stringify(values);
    const group = groups.get(key) ?? { values, usage: { ...emptyUsage } };
    for (const field of usageFields) group.usage[field] += row.usage[field];
    groups.set(key, group);
  }
  const order = sort === 'tokens' || sort === 'cost' ? dimensions : [sort, ...dimensions.filter(dimension => dimension !== sort)];
  return [...groups.values()].sort((first, second) => {
    if (sort === 'tokens' && first.usage.total !== second.usage.total) return second.usage.total - first.usage.total;
    if (sort === 'cost') {
      const priced = (usage: UsageSummary) => Number(usage.requests > usage.unpricedRequests);
      const difference = priced(second.usage) - priced(first.usage) || second.usage.costUsd - first.usage.costUsd;
      if (difference) return difference;
    }
    for (const dimension of order) {
      const index = dimensions.indexOf(dimension);
      const difference = compareLabels(dimension, first.values[index], second.values[index]);
      if (difference) return difference;
    }
    return 0;
  });
}

function shareCell(tokenShare: number | null): HTMLTableCellElement {
  const cell = document.createElement('td');
  const content = document.createElement('div');
  content.className = 'project-usage-share-content';
  const track = document.createElement('span');
  track.className = 'project-usage-share-track';
  track.setAttribute('aria-hidden', 'true');
  track.hidden = tokenShare === null;
  const bar = document.createElement('span');
  bar.style.width = (tokenShare ?? 0) * 100 + '%';
  track.append(bar);
  const value = document.createElement('span');
  value.textContent = tokenShare === null ? 'Unknown' : formatPercentage(tokenShare);
  content.append(track, value);
  cell.append(content);
  return cell;
}

function columnHeading({ label, sortBy, className }: Column, sort: Sort): HTMLTableCellElement {
  const cell = document.createElement('th');
  cell.scope = 'col';
  cell.className = className ?? '';
  if (sortBy === undefined) {
    cell.textContent = label;
    return cell;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.sortBy = sortBy;
  button.textContent = label;
  button.setAttribute('aria-label', 'Sort by ' + label);
  if (sortBy === sort) cell.setAttribute('aria-sort', sort === 'tokens' || sort === 'cost' ? 'descending' : 'ascending');
  cell.append(button);
  return cell;
}

export function initializeProjectUsage(currentProjectId: () => string | null, updateTerminalLayout: () => Promise<void>) {
  const button = document.querySelector<HTMLButtonElement>('#open-project-usage')!;
  const dialog = document.querySelector<HTMLDialogElement>('#project-usage-dialog')!;
  const close = dialog.querySelector<HTMLButtonElement>('#close-project-usage')!;
  const group = dialog.querySelector<HTMLSelectElement>('#project-usage-group')!;
  const details = dialog.querySelector<HTMLInputElement>('#project-usage-token-details')!;
  const range = dialog.querySelector<HTMLSelectElement>('#project-usage-date-range')!;
  const customDates = dialog.querySelector<HTMLFormElement>('#project-usage-custom-dates')!;
  const startDate = customDates.querySelector<HTMLInputElement>('#project-usage-start-date')!;
  const endDate = customDates.querySelector<HTMLInputElement>('#project-usage-end-date')!;
  const dateSummary = dialog.querySelector<HTMLElement>('#project-usage-date-summary')!;
  const status = dialog.querySelector<HTMLElement>('#project-usage-status')!;
  const retry = dialog.querySelector<HTMLButtonElement>('#retry-project-usage')!;
  const results = dialog.querySelector<HTMLElement>('#project-usage-results')!;
  const head = results.querySelector('thead tr')!;
  const body = results.querySelector('tbody')!;
  const requests = new RequestState();
  let rows: BreakdownRow[] = [];
  let sort: Sort = 'tokens';
  let appliedDates: CalendarRange | null = null;

  function renderDateSummary(): void {
    dateSummary.hidden = appliedDates === null && customDates.hidden;
    if (dateSummary.hidden) {
      dateSummary.textContent = '';
      return;
    }
    const dates = appliedDates ? dateLabel.formatRange(appliedDates.start, appliedDates.end) : 'all time';
    dateSummary.textContent = 'Showing ' + dates + ' · ' + Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  function render(): void {
    const dimensions: Dimension[] = group.value === 'all' ? ['agentKind', 'model', 'effort'] : [group.value as Dimension];
    if (sort !== 'tokens' && sort !== 'cost' && !dimensions.includes(sort)) sort = dimensions[0];
    const columns: Column[] = [
      ...dimensions.map(dimension => ({ label: dimensionLabels[dimension], sortBy: dimension })),
      { label: 'Token share', className: 'project-usage-share' },
      { label: 'Total tokens', sortBy: 'tokens', className: 'number-column' },
      { label: 'Estimated API equivalent', sortBy: 'cost', className: 'number-column' },
    ];
    if (details.checked) {
      for (const label of ['Input', 'Cached input', 'Cache writes', 'Output']) columns.push({ label, className: 'number-column' });
    }
    head.replaceChildren(...columns.map(column => columnHeading(column, sort)));
    const groups = groupUsage(rows, dimensions, sort);
    const projectTotal = groups.reduce((total, { usage }) => total + usage.total, 0);
    const tableRows = document.createDocumentFragment();
    for (const { values: labels, usage } of groups) {
      const tokenShare = usage.unmeasuredTurns && !usage.requests ? null : usage.total / (projectTotal || 1);
      const row = document.createElement('tr');
      for (const label of labels) {
        const cell = document.createElement('th');
        cell.scope = 'row';
        cell.textContent = label ?? 'Unknown';
        row.append(cell);
      }
      row.append(shareCell(tokenShare));
      const values = [usageCount(usage, 'total'), money(usage)];
      if (details.checked) values.push(usageCount(usage, 'input'), cachedCount(usage), cacheWrites(usage), usageCount(usage, 'output'));
      for (const value of values) row.insertCell().textContent = value;
      tableRows.append(row);
    }
    body.replaceChildren(tableRows);
  }

  async function load(): Promise<void> {
    const identifier = currentProjectId();
    if (!dialog.open || identifier === null) return;
    const dates = appliedDates;
    const dateRange = dates ? {
      startMilliseconds: localMidnight(dates.start),
      endExclusiveMilliseconds: localMidnight(dates.end, 1),
    } : null;
    const revision = requests.begin();
    const current = () => dialog.open && currentProjectId() === identifier && requests.accepts(revision);
    rows = [];
    results.hidden = true;
    retry.hidden = true;
    status.hidden = false;
    status.textContent = 'Loading project usage…';
    setBusy(status, true);
    renderDateSummary();
    try {
      const recorded = await invoke<BreakdownRow[]>('project_usage_breakdown', { identifier, dateRange });
      if (!current()) return;
      rows = recorded;
      render();
      const emptyMessage = dateRange ? 'No usage has been recorded in this date range.' : 'No usage has been recorded for this project.';
      status.textContent = rows.length ? '' : emptyMessage;
      status.hidden = rows.length > 0;
      results.hidden = !rows.length;
    } catch (error) {
      if (!current()) return;
      status.textContent = 'Could not load project usage. ' + String(error);
      retry.hidden = false;
    } finally {
      if (current()) {
        requests.finish(revision);
        setBusy(status, false);
      }
    }
  }

  button.addEventListener('click', () => {
    if (dialog.open || currentProjectId() === null) return;
    group.value = 'agentKind';
    sort = 'tokens';
    details.checked = false;
    results.scrollLeft = 0;
    range.value = 'all-time';
    customDates.hidden = true;
    appliedDates = null;
    showDialog(dialog, button.id);
    close.focus();
    void updateTerminalLayout();
    void load();
  });
  group.addEventListener('change', render);
  details.addEventListener('change', render);
  head.addEventListener('click', event => {
    const control = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-sort-by]');
    if (!control || control.dataset.sortBy === sort) return;
    sort = control.dataset.sortBy as Sort;
    render();
    head.querySelector<HTMLButtonElement>(`[data-sort-by="${sort}"]`)?.focus({ preventScroll: true });
  });
  range.addEventListener('change', () => {
    customDates.hidden = range.value !== 'custom';
    if (customDates.hidden) {
      appliedDates = presetDates(range.value);
      void load();
      return;
    }
    startDate.valueAsDate = appliedDates?.start ?? null;
    endDate.valueAsDate = appliedDates?.end ?? null;
    endDate.min = startDate.value || startDate.min;
    renderDateSummary();
  });
  startDate.addEventListener('input', () => { endDate.min = startDate.value || startDate.min; });
  customDates.addEventListener('submit', event => {
    event.preventDefault();
    const start = startDate.valueAsDate;
    const end = endDate.valueAsDate;
    if (!start || !end || start > end) return;
    appliedDates = { start, end };
    void load();
  });
  retry.addEventListener('click', () => { close.focus(); void load(); });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    requests.invalidate();
    rows = [];
    setBusy(status, false);
    void updateTerminalLayout();
  });
  return { button, dialog };
}
