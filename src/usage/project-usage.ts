import { invoke } from '@tauri-apps/api/core';
import { agentName, type AgentKind } from '../projects/projects';
import { showDialog } from '../ui/dialogs';
import { setBusy } from '../ui/loading';
import { RequestState } from '../ui/request-state';
import { cachedCount, cacheWrites, emptyUsage, formatPercentage, money, usageCount } from './usage-format';
import type { UsageSummary } from './usage-types';

type BreakdownRow = { agentKind: AgentKind; model: string | null; effort: string | null; usage: UsageSummary };
type Dimension = 'agentKind' | 'model' | 'effort';
type Sort = 'tokens' | 'cost' | 'group' | Dimension;
type Group = { values: (string | null)[]; usage: UsageSummary };

const dimensionLabels = { agentKind: 'Agent', model: 'Model', effort: 'Effort' };
const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const usageFields = Object.keys(emptyUsage) as (keyof UsageSummary)[];

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
  const order = sort in dimensionLabels ? [sort as Dimension, ...dimensions.filter(dimension => dimension !== sort)] : dimensions;
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

function chartRow(labels: string[], tokenShare: number | null): HTMLLIElement {
  const row = document.createElement('li');
  const label = document.createElement('span');
  label.textContent = labels.join(' · ');
  const track = document.createElement('span');
  track.className = 'project-usage-chart-track';
  track.setAttribute('aria-hidden', 'true');
  track.hidden = tokenShare === null;
  const bar = document.createElement('span');
  bar.style.width = (tokenShare ?? 0) * 100 + '%';
  track.append(bar);
  const value = document.createElement('span');
  value.textContent = tokenShare === null ? 'Unknown' : formatPercentage(tokenShare);
  row.append(label, track, value);
  return row;
}

export function initializeProjectUsage(currentProjectId: () => string | null, updateTerminalLayout: () => Promise<void>) {
  const button = document.querySelector<HTMLButtonElement>('#open-project-usage')!;
  const dialog = document.querySelector<HTMLDialogElement>('#project-usage-dialog')!;
  const close = dialog.querySelector<HTMLButtonElement>('#close-project-usage')!;
  const group = dialog.querySelector<HTMLSelectElement>('#project-usage-group')!;
  const sort = dialog.querySelector<HTMLSelectElement>('#project-usage-sort')!;
  const status = dialog.querySelector<HTMLElement>('#project-usage-status')!;
  const retry = dialog.querySelector<HTMLButtonElement>('#retry-project-usage')!;
  const results = dialog.querySelector<HTMLElement>('#project-usage-results')!;
  const chart = results.querySelector('#project-usage-chart')!;
  const head = results.querySelector('thead tr')!;
  const body = results.querySelector('tbody')!;
  const requests = new RequestState();
  let rows: BreakdownRow[] = [];

  function render(): void {
    const dimensions: Dimension[] = group.value === 'all' ? ['agentKind', 'model', 'effort'] : [group.value as Dimension];
    for (const option of sort.options) {
      if (option.value in dimensionLabels) option.hidden = option.disabled = group.value !== 'all';
    }
    if (sort.selectedOptions[0]?.disabled) sort.value = 'group';
    const headings = [...dimensions.map(dimension => dimensionLabels[dimension]), 'Input', 'Cached input', 'Cache writes', 'Output', 'Total tokens', 'Estimated API equivalent'];
    head.replaceChildren(...headings.map((label, index) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      if (index >= dimensions.length) cell.className = 'number-column';
      return cell;
    }));
    const groups = groupUsage(rows, dimensions, sort.value as Sort);
    const projectTotal = groups.reduce((total, { usage }) => total + usage.total, 0);
    const chartRows = document.createDocumentFragment();
    const tableRows = document.createDocumentFragment();
    for (const { values: labels, usage } of groups) {
      const groupLabels = labels.map(label => label ?? 'Unknown');
      const tokenShare = usage.unmeasuredTurns && !usage.requests ? null : usage.total / (projectTotal || 1);
      chartRows.append(chartRow(groupLabels, tokenShare));
      const row = document.createElement('tr');
      const values = [usageCount(usage, 'input'), cachedCount(usage), cacheWrites(usage), usageCount(usage, 'output'), usageCount(usage, 'total'), money(usage)];
      for (const label of groupLabels) {
        const cell = document.createElement('th');
        cell.scope = 'row';
        cell.textContent = label;
        row.append(cell);
      }
      for (const value of values) row.insertCell().textContent = value;
      tableRows.append(row);
    }
    chart.replaceChildren(chartRows);
    chart.scrollTop = 0;
    body.replaceChildren(tableRows);
  }

  async function load(): Promise<void> {
    const identifier = currentProjectId();
    if (!dialog.open || identifier === null) return;
    const revision = requests.begin();
    const current = () => dialog.open && currentProjectId() === identifier && requests.accepts(revision);
    rows = [];
    results.hidden = true;
    retry.hidden = true;
    status.hidden = false;
    status.textContent = 'Loading project usage…';
    setBusy(status, true);
    try {
      const recorded = await invoke<BreakdownRow[]>('project_usage_breakdown', { identifier });
      if (!current()) return;
      rows = recorded;
      render();
      status.textContent = rows.length ? '' : 'No usage has been recorded for this project.';
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
    sort.value = 'tokens';
    render();
    showDialog(dialog, button.id);
    close.focus();
    void updateTerminalLayout();
    void load();
  });
  group.addEventListener('change', render);
  sort.addEventListener('change', render);
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
