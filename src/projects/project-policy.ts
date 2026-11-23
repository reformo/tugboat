import { invoke } from '@tauri-apps/api/core';
import { sameProject, sameProjectView, type Project, type ProjectContext } from './projects';
import { renderSkeleton, setBusy, setLoading } from '../ui/loading';
import { FormState } from '../ui/form-state';
import { EnvironmentStopGate } from './environment-stop';
import type { StopImpact } from './operations';

export interface NetworkAccess { publicInternet: boolean; hosts: { packageManagers: boolean; additional: string[] } }
interface Policy { document: unknown; fingerprint: string; editable: boolean; attached: boolean; access: NetworkAccess | null; defaultHosts: string[]; publicInternetRestricted: boolean }
type Action = 'save' | 'attach' | 'detach' | 'accept';

export function domainList(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map(host => host.trim()).filter(Boolean))];
}

export function initializeProjectPolicy(current: () => (ProjectContext & { project: Project }) | null, changed: (project: Project, detached: boolean) => Promise<void>, impact: () => StopImpact): () => void {
  const section = document.getElementById('project-network-settings') as HTMLDetailsElement;
  const status = document.getElementById('project-policy-status')!;
  const fields = document.getElementById('project-policy-fields') as HTMLFieldSetElement;
  const publicInternet = document.getElementById('network-public-internet') as HTMLInputElement;
  const packageManagers = document.getElementById('network-package-managers') as HTMLInputElement;
  const editDomains = document.getElementById('edit-network-domains') as HTMLButtonElement;
  const domainsSummary = document.getElementById('network-domains-summary')!;
  const domainsEditor = document.getElementById('network-domains-editor')!;
  const hosts = document.getElementById('project-policy-hosts') as HTMLTextAreaElement;
  const saveDomains = document.getElementById('save-project-policy') as HTMLButtonElement;
  const cancelDomains = document.getElementById('cancel-network-domains') as HTMLButtonElement;
  const defaultHosts = document.getElementById('network-default-hosts')!;
  const attach = document.getElementById('attach-project-policy') as HTMLButtonElement;
  const detach = document.getElementById('detach-project-policy') as HTMLButtonElement;
  const accept = document.getElementById('accept-project-policy') as HTMLButtonElement;
  const read = document.getElementById('read-project-policy') as HTMLButtonElement;
  const documentView = document.getElementById('project-policy-document')!;
  const state = new FormState<{ context: ProjectContext; policy: Policy }>();
  const stopGate = new EnvironmentStopGate(document.getElementById('network-stop-warning')!);

  function showEditor(visible: boolean): void {
    domainsEditor.hidden = !visible;
    editDomains.setAttribute('aria-expanded', String(visible));
  }

  function renderAccess(policy: Policy | null): void {
    const access = policy?.access ?? null;
    const editable = policy?.editable === true && access !== null;
    publicInternet.checked = access?.publicInternet === true;
    packageManagers.checked = access?.hosts.packageManagers === true;
    for (const control of [publicInternet, packageManagers, editDomains, saveDomains, cancelDomains]) control.disabled = !editable;
    const additional = access?.hosts.additional ?? [];
    domainsSummary.textContent = additional.length === 0 ? 'No additional domains' : additional.join(', ');
    hosts.value = additional.join('\n');
    hosts.readOnly = !editable;
    showEditor(false);
    defaultHosts.textContent = policy && policy.defaultHosts.length > 0 ? `Agent domains from Settings are always allowed: ${policy.defaultHosts.join(', ')}.` : '';
  }

  function policyMessage(policy: Policy): string {
    if (!policy.editable) return 'This policy is externally managed, shared with other sessions or contains advanced rules. Editing is disabled.';
    if (policy.publicInternetRestricted) return 'Another bound policy denies other destinations, so all public internet access is not in effect.';
    return '';
  }

  async function readPolicy(): Promise<void> {
    const context = current(); if (!context || state.busy()) return;
    const pending = state.read();
    read.disabled = true; fields.disabled = true;
    setBusy(read, true); setLoading(documentView, true);
    status.textContent = 'Reading this project’s network policy…';
    renderSkeleton(documentView);
    renderAccess(null);
    try {
      const policy = await invoke<Policy>('read_project_policy', { identifier: context.id, environmentId: context.environmentId });
      if (!sameProjectView(current(), context) || !state.accepts(pending)) return;
      state.receive(pending, { context, policy });
      const saved = state.current()!.policy;
      documentView.textContent = JSON.stringify(saved.document, null, 2);
      renderAccess(saved);
      attach.disabled = saved.attached;
      detach.disabled = !saved.attached || !context.project.ownsBinding;
      accept.disabled = false;
      fields.disabled = false;
      status.textContent = policyMessage(saved);
    } catch (error) { if (sameProjectView(current(), context) && state.accepts(pending)) { state.fail(pending); status.textContent = String(error); } }
    finally { if (sameProjectView(current(), context) && state.accepts(pending)) { state.finish(pending); read.disabled = false; setBusy(read, false); setLoading(documentView, false); if (!state.current()) documentView.replaceChildren(); } }
  }

  async function change(action: Action, button: HTMLElement, access: NetworkAccess | null): Promise<void> {
    const snapshot = state.current();
    if (!snapshot || !sameProjectView(current(), snapshot.context)) return;
    const submission = state.submit();
    if (!submission) return;
    const captured = submission.value;
    const pending = submission.revision;
    read.disabled = true; fields.disabled = true;
    setBusy(button, true);
    const target = { identifier: captured.context.id, environmentId: captured.context.environmentId };
    const visible = () => sameProjectView(current(), captured.context) && state.accepts(pending);
    let reread = false;
    try {
      const stop = await stopGate.prepare(target, impact(), message => { if (visible()) status.textContent = message; });
      if (!visible()) return;
      if (stop.kind === 'cancelled') { status.textContent = 'The change was not applied.'; fields.disabled = false; renderAccess(captured.policy); return; }
      status.textContent = action === 'save' ? 'Saving network access…' : 'Updating this project’s policy…';
      const project = await invoke<Project>('change_project_policy', { ...target, fingerprint: captured.policy.fingerprint, action, access });
      if (!sameProject(current(), captured.context)) return;
      if (sameProjectView(current(), captured.context) && state.accepts(pending)) state.discard(pending);
      const detached = project.policyDetached === true || project.stage === 'policy-detached';
      await changed(project, detached);
      if (!sameProjectView(current(), captured.context) || !state.accepts(pending)) return;
      const result = detached ? 'Policy detached. Attach it again before starting the environment.' : 'Policy updated. Review the plan and prepare the environment again.';
      status.textContent = stop.kind === 'stopped' ? `${stop.note} ${result}` : result;
      reread = action === 'save' && section.open;
    } catch (error) {
      if (sameProjectView(current(), captured.context) && state.accepts(pending)) { state.fail(pending); status.textContent = String(error); fields.disabled = false; renderAccess(captured.policy); }
    } finally { if (sameProjectView(current(), captured.context) && state.accepts(pending)) { state.finish(pending); read.disabled = false; setBusy(button, false); } }
    if (!reread) return;
    const message = status.textContent;
    await readPolicy();
    if (status.textContent === '') status.textContent = message;
  }

  function requested(update: (access: NetworkAccess) => NetworkAccess): NetworkAccess | null {
    const access = state.current()?.policy.access;
    return access ? update({ publicInternet: access.publicInternet, hosts: { ...access.hosts } }) : null;
  }

  function saveAccess(button: HTMLElement, update: (access: NetworkAccess) => NetworkAccess): void {
    const access = requested(update);
    if (access) void change('save', button, access);
  }

  read.addEventListener('click', () => { void readPolicy(); });
  section.addEventListener('toggle', () => { if (section.open && !state.current()) void readPolicy(); });
  publicInternet.addEventListener('change', () => { saveAccess(publicInternet, access => ({ ...access, publicInternet: publicInternet.checked })); });
  packageManagers.addEventListener('change', () => { saveAccess(packageManagers, access => ({ ...access, hosts: { ...access.hosts, packageManagers: packageManagers.checked } })); });
  editDomains.addEventListener('click', () => { showEditor(Boolean(domainsEditor.hidden)); if (!domainsEditor.hidden) hosts.focus(); });
  cancelDomains.addEventListener('click', () => { renderAccess(state.current()?.policy ?? null); editDomains.focus(); });
  saveDomains.addEventListener('click', () => { saveAccess(saveDomains, access => ({ ...access, hosts: { ...access.hosts, additional: domainList(hosts.value) } })); });
  for (const [button, action] of [[attach, 'attach'], [detach, 'detach'], [accept, 'accept']] as const) {
    button.addEventListener('click', () => { void change(action, button, null); });
  }
  return () => {
    state.reset(); stopGate.cancel(); read.disabled = false;
    setBusy(read, false); setLoading(documentView, false);
    fields.disabled = true; status.textContent = '';
    renderAccess(null);
    for (const button of fields.querySelectorAll<HTMLButtonElement>('button')) { button.disabled = true; setBusy(button, false); }
    documentView.replaceChildren();
  };
}
