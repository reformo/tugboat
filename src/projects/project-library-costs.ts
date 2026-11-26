import { invoke } from '@tauri-apps/api/core';
import { moneyAmount } from '../usage/usage-format';
import type { Coverage, UsageSummary } from '../usage/usage-types';

interface ProjectLibraryCost {
  projectId: string;
  environmentId: string;
  usage: UsageSummary | null;
  coverage: Coverage;
}

export function initializeProjectLibraryCosts() {
  const list = document.getElementById('recent-project-list')!;
  const coverageNote = document.getElementById('project-cost-coverage-note')!;
  let costs: Map<string, ProjectLibraryCost> | undefined;
  let reading = false;
  let revision = 0;

  function render(): void {
    coverageNote.hidden = true;
    for (const cell of list.querySelectorAll<HTMLElement>('.project-total-cost')) {
      const cost = costs?.get(cell.dataset.costProject!);
      const usage = cost?.environmentId === cell.dataset.costEnvironment ? cost?.usage : null;
      cell.title = '';
      cell.removeAttribute('aria-describedby');
      cell.textContent = costs ? 'Unavailable' : '…';
      cell.classList.remove('has-cost');
      if (!usage || !Number.isFinite(usage.costUsd)) {
        cell.title = costs ? 'Saved usage could not be read for this project.' : 'Loading saved usage.';
        continue;
      }
      if (!usage.requests && !usage.unmeasuredTurns) {
        cell.textContent = 'No usage';
        cell.title = 'No usage has been recorded for this project.';
        continue;
      }
      if (usage.requests > 0 && usage.requests === usage.unpricedRequests) {
        cell.textContent = 'Unpriced';
        cell.title = 'Recorded requests have no saved prices.';
        continue;
      }
      if (!usage.requests) {
        cell.textContent = 'Unknown';
        cell.title = 'Saved turns have no request measurements.';
        continue;
      }
      cell.textContent = moneyAmount(usage.costUsd);
      cell.classList.add('has-cost');
      if (cost?.coverage !== 'complete' || usage.unpricedRequests || usage.unmeasuredTurns) {
        const marker = document.createElement('sup');
        marker.setAttribute('aria-hidden', 'true');
        marker.textContent = '*';
        cell.append(marker);
        cell.setAttribute('aria-describedby', coverageNote.id);
        coverageNote.hidden = false;
      }
    }
  }

  async function refresh(): Promise<void> {
    if (list.closest('[hidden], [inert]') || !list.querySelector('.project-total-cost')) return;
    ++revision;
    if (reading) return;
    reading = true;
    let request: number;
    do {
      request = revision;
      try {
        const result = await invoke<ProjectLibraryCost[]>('project_library_costs');
        costs = new Map(result.map(cost => [cost.projectId, cost]));
      } catch {
        costs = new Map();
      }
      render();
      if (list.closest('[hidden], [inert]')) break;
    } while (revision !== request);
    reading = false;
  }

  return { render, refresh };
}
