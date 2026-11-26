import { invoke } from '@tauri-apps/api/core';
import { setWorkspaceNetworkActivity } from '../app/workspace-status';
import { closeDialog, dialogOpen, showDialog } from '../ui/dialogs';
import { RequestState } from '../ui/request-state';
import { setBusy } from '../ui/loading';

interface Activity {
  time: number;
  direction: 'outgoing' | 'incoming';
  origin: 'codex' | 'claude-code' | 'guest-terminal' | null;
  process: string | null;
  pid: number | null;
  endpoint: string;
  protocol: 'tcp' | 'udp';
  result: 'connecting' | 'connected' | 'forwarded' | 'answered' | 'blocked' | 'failed';
  sent: number | null;
  received: number | null;
}

export interface ActivityUpdate {
  projectId: string;
  environmentId: string;
  activity: Activity;
}

interface Page {
  rows: Activity[];
  next: [number, number] | null;
  incomplete: boolean;
}

const origins = { codex: 'Codex', 'claude-code': 'Claude Code', 'guest-terminal': 'Guest terminal' };
const results = { connecting: 'Connecting', connected: 'Connected', forwarded: 'Forwarded', answered: 'Answered', blocked: 'Blocked by policy', failed: 'Connection failed' };
const size = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const time = new Intl.DateTimeFormat(undefined, { hourCycle: 'h23', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  const unit = Math.min(4, Math.floor(Math.log10(Math.max(bytes, 1)) / 3));
  return size.format(bytes / 1000 ** unit) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][unit];
}

export function initializeNetworkActivity(
  selected: () => { id: string; environmentId: string; name: string } | null,
  updateTerminalLayout: () => Promise<void>,
) {
  const button = document.querySelector<HTMLButtonElement>('#open-network-activity')!;
  const dialog = document.querySelector<HTMLElement>('#network-activity-dialog')!;
  const close = dialog.querySelector<HTMLButtonElement>('#close-network-activity')!;
  const projectName = dialog.querySelector<HTMLElement>('#network-activity-project')!;
  const status = dialog.querySelector<HTMLElement>('#network-activity-status')!;
  const incomplete = dialog.querySelector<HTMLElement>('#network-activity-incomplete')!;
  const refresh = dialog.querySelector<HTMLButtonElement>('#refresh-network-activity')!;
  const older = dialog.querySelector<HTMLButtonElement>('#older-network-activity')!;
  const table = dialog.querySelector<HTMLElement>('.table-scroll')!;
  const body = dialog.querySelector('tbody')!;
  const requests = new RequestState();
  let next: Page['next'] = null;

  async function load(before: Page['next']): Promise<void> {
    const project = selected();
    if (!dialogOpen(dialog) || !project || requests.pending()) return;
    const revision = requests.begin();
    const current = () => dialogOpen(dialog) && selected()?.id === project.id &&
      selected()?.environmentId === project.environmentId && requests.accepts(revision);
    refresh.setAttribute('aria-disabled', 'true');
    older.setAttribute('aria-disabled', 'true');
    status.textContent = 'Loading network activity…';
    setBusy(table, true);
    try {
      const page = await invoke<Page>('read_project_network_activity', {
        identifier: project.id, environmentId: project.environmentId, before,
      });
      if (!current()) return;
      if (!before) body.replaceChildren();
      for (const activity of page.rows) {
        const row = body.insertRow();
        const values = [
          time.format(activity.time),
          activity.direction === 'incoming' ? 'Incoming' : 'Outgoing',
          activity.origin ? origins[activity.origin] : 'Unknown',
          (activity.process ?? 'Unknown') + (activity.pid ? ' (' + activity.pid + ')' : ''),
          activity.endpoint,
          activity.protocol.toUpperCase(),
          results[activity.result],
          formatBytes(activity.sent),
          formatBytes(activity.received),
        ];
        for (const value of values) row.insertCell().textContent = value;
        row.cells[0].title = new Date(activity.time).toLocaleString();
      }
      next = page.next;
      if (!next && document.activeElement === older) refresh.focus();
      older.hidden = !next;
      table.hidden = body.rows.length === 0;
      incomplete.hidden = !page.incomplete;
      status.textContent = table.hidden ? 'No network activity has been recorded for this project.' : '';
    } catch {
      if (current()) status.textContent = 'Could not read network activity. Try again.';
    } finally {
      if (current()) {
        requests.finish(revision);
        refresh.removeAttribute('aria-disabled');
        older.removeAttribute('aria-disabled');
        setBusy(table, false);
      }
    }
  }

  button.addEventListener('click', () => {
    const project = selected();
    if (dialogOpen(dialog) || !project) return;
    requests.invalidate();
    next = null;
    projectName.textContent = project.name;
    body.replaceChildren();
    table.hidden = older.hidden = incomplete.hidden = true;
    showDialog(dialog, button.id);
    void updateTerminalLayout();
    void load(null);
  });
  refresh.addEventListener('click', () => { void load(null); });
  older.addEventListener('click', () => { if (next) void load(next); });
  close.addEventListener('click', () => closeDialog(dialog));
  dialog.addEventListener('close', () => {
    if (dialogOpen(dialog)) return;
    requests.invalidate();
    body.replaceChildren();
    projectName.textContent = '';
    setBusy(table, false);
    void updateTerminalLayout();
  });
  return {
    dialog,
    reset() {
      setWorkspaceNetworkActivity(null);
    },
    accept({ projectId, environmentId, activity }: ActivityUpdate) {
      const project = selected();
      if (!project || project.id !== projectId || project.environmentId !== environmentId) return;
      const direction = activity.direction === 'incoming' ? 'Incoming' : 'Outgoing';
      const connection = direction + ' ' + activity.protocol.toUpperCase();
      const result = results[activity.result];
      const failed = activity.result === 'blocked' || activity.result === 'failed';
      setWorkspaceNetworkActivity({
        message: (failed ? result : connection) + ' · ' + activity.endpoint,
        title: [time.format(activity.time), connection, activity.endpoint, result].join(' · '),
      });
    },
  };
}
