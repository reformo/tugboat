interface WorkspaceStatus { message: string; scope: string }

const entries = new Map<string, WorkspaceStatus>();
let notice: WorkspaceStatus | null = null;
let networkActivity: { message: string; title: string } | null = null;

function visible(scope: string): boolean {
  const element = document.getElementById(scope);
  return element !== null && !element.closest('[hidden]');
}

export function setWorkspaceStatus(key: string, message: string | null, scope: string): void {
  const previous = entries.get(key);
  if (message && (previous?.message !== message || previous.scope !== scope)) {
    if (visible(scope)) notice = null;
    entries.set(key, { message, scope });
  }
  if (!message) entries.delete(key);
  renderWorkspaceStatus();
}

export function showWorkspaceError(message: string, scope: string): void {
  const current = { message, scope };
  notice = current;
  renderWorkspaceStatus();
  document.defaultView!.setTimeout(() => {
    if (notice !== current) return;
    notice = null;
    renderWorkspaceStatus();
  }, 10000);
}

export function setWorkspaceNetworkActivity(activity: typeof networkActivity): void {
  networkActivity = activity;
  renderWorkspaceStatus();
}

export function renderWorkspaceStatus(): void {
  const error = notice && visible(notice.scope) ? notice : null;
  const status = error ?? [...entries.values()].reverse().find(entry => visible(entry.scope));
  const bar = document.getElementById('workspace-status-bar')!;
  const text = document.getElementById('workspace-status-text')!;
  const projectView = document.getElementById('project-view');
  const projectOpen = Boolean(projectView?.classList.contains('has-project') && visible('project-view'));
  const button = document.getElementById('open-network-activity')!;
  const activity = projectOpen ? networkActivity : null;
  const message = status?.message ?? activity?.message ?? '';
  if (text.textContent !== message) text.textContent = message;
  text.title = status?.message ?? activity?.title ?? '';
  bar.classList.toggle('is-error', error !== null);
  button.hidden = !projectOpen;
  bar.hidden = !projectOpen && message === '';
}
