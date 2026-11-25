import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setBusy, setLoading } from '../ui/loading';
import { FormState } from '../ui/form-state';
import { renderWorkspaceStatus, setWorkspaceStatus } from '../app/workspace-status';
import { createStore } from 'zustand/vanilla';
import { currentFieldValue, hostLines, initialProjectDefaults, initializeProjectDefaults, limitDefaultReasoning, projectDefaultFields, readProjectDefaults, showFieldValue, type ProjectDefaults } from './project-defaults';

interface AgentDefaults { profile: string; allowedHosts: string[] }

export interface Settings {
  schemaVersion: number;
  cliPath: string | null;
  codex: AgentDefaults;
  claudeCode: AgentDefaults;
  cpus: number;
  memoryMb: number;
  verification: 'require' | 'warn' | 'off';
  network: 'isolated' | 'offline';
  telemetry: boolean;
  // Rust leaves out an unchanged record, so an earlier Tugboat can still read settings.json.
  projectDefaults?: ProjectDefaults;
}

interface TelemetryStatus { recorded: string | null; effective: string; message: string | null }

function input(id: string): HTMLInputElement { return document.getElementById(id) as HTMLInputElement; }
function select(id: string): HTMLSelectElement { return document.getElementById(id) as HTMLSelectElement; }

export type SettingsSection = 'general' | 'providers' | 'brig' | 'system-checks' | 'resources' | 'network' | 'agents';

// The left menu shows one section. The save controls appear only for sections in the settings form.
export function selectSettingsTab(name: SettingsSection): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('#settings-tabs button')) {
    const selected = tab.id === 'settings-tab-' + name;
    tab.setAttribute('aria-current', String(selected));
    document.getElementById(tab.getAttribute('aria-controls')!)!.hidden = !selected;
  }
  document.getElementById('settings-form-footer')!.hidden = !document.getElementById('settings-panel-' + name)!.closest('form');
  renderWorkspaceStatus();
}

export function initializeSettingsTabs(): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('#settings-tabs button')) {
    tab.addEventListener('click', () => { selectSettingsTab(tab.id.replace('settings-tab-', '') as SettingsSection); });
  }
  initializeProjectDefaults();
}

function renderTelemetry(status: TelemetryStatus): void {
  const names: Record<string, string> = { on: 'On', off: 'Off', unanswered: 'Not set yet' };
  document.getElementById('telemetry-status')!.textContent = 'Saved Brig preference: ' + (names[status.recorded ?? ''] ?? 'Unavailable') + '. Effective for app commands: ' + names[status.effective] + '.' + (status.message ? ' ' + status.message : '');
}

function settingsFields(settings: Settings): Record<string, string | boolean> {
  return {
    'cli-path': settings.cliPath ?? '',
    'cpu-count': String(settings.cpus),
    'memory-mb': String(settings.memoryMb),
    'network-preference': settings.network,
    'allowed-hosts': settings.codex.allowedHosts.join('\n'),
    'claude-code-allowed-hosts': settings.claudeCode.allowedHosts.join('\n'),
    'telemetry-preference': settings.telemetry,
    ...projectDefaultFields(settings.projectDefaults ?? initialProjectDefaults),
  };
}

// A field that the user changed since the previous read keeps the local edit.
function renderSettings(settings: Settings, previous: Settings | null): void {
  const values = settingsFields(settings), original = previous ? settingsFields(previous) : null;
  for (const [id, value] of Object.entries(values)) {
    if (original && currentFieldValue(id) !== original[id]) continue;
    showFieldValue(id, value);
  }
  limitDefaultReasoning();
}

export async function initializeSettings(): Promise<void> {
  try {
    const version = await invoke<string>('application_version');
    document.getElementById('application-version')!.textContent = version;
    document.getElementById('sidebar-version')!.textContent = 'v.' + version;
  }
  catch { document.getElementById('application-version')!.textContent = 'Unavailable'; }
  finally { setLoading(document.getElementById('application-version')!, false); }
  const form = document.getElementById('brig-settings') as HTMLFormElement;
  const status = document.getElementById('settings-status')!;
  const save = document.getElementById('save-settings') as HTMLButtonElement;
  const fields = document.getElementById('settings-fields') as HTMLFieldSetElement;
  function setStatus(message: string, busy = false): void {
    status.textContent = message;
    status.hidden = busy;
    setWorkspaceStatus('settings-save', busy ? message : null, 'settings-view');
  }
  const state = new FormState<Settings>();
  const telemetryData = createStore<{ value: TelemetryStatus | null }>(() => ({ value: null }));
  function acceptTelemetry(value: TelemetryStatus): void {
    telemetryData.setState({ value });
    renderTelemetry(telemetryData.getState().value!);
  }
  let settingsReadRevision = 0;
  let pendingSettingsRead = false;
  async function refreshSettings(): Promise<void> {
    if (state.busy()) { pendingSettingsRead = true; return; }
    const revision = ++settingsReadRevision;
    try {
      const settings = await invoke<Settings>('load_settings');
      if (revision !== settingsReadRevision) return;
      if (state.busy()) { pendingSettingsRead = true; return; }
      const previous = state.current();
      if (!state.replace(settings)) return;
      renderSettings(state.current()!, previous);
      updateNetworkHint();
      fields.disabled = false;
      const telemetry = await invoke<TelemetryStatus>('telemetry_status');
      if (revision === settingsReadRevision) acceptTelemetry(telemetry);
    } catch (error) { if (revision === settingsReadRevision) setStatus(String(error)); }
  }
  await listen<string[]>('records-changed', event => {
    if (event.payload.includes('settings')) return refreshSettings();
  });
  const initialRead = state.read();
  try {
    const settings = await invoke<Settings>('load_settings');
    state.receive(initialRead, settings);
    renderSettings(state.current()!, null);
    acceptTelemetry(await invoke<TelemetryStatus>('telemetry_status'));
  } catch (error) { state.fail(initialRead); setStatus(String(error)); }
  finally { state.finish(initialRead); setLoading(fields, false); if (pendingSettingsRead) { pendingSettingsRead = false; void refreshSettings(); } }
  const network = select('network-preference');
  const networkHint = document.getElementById('network-hint')!;
  function updateNetworkHint(): void {
    const guest = network.value === 'offline' ? 'Offline blocks guest command traffic and online chats. Provider sign-in uses the Mac connection.' : 'Brig/hvi allows guest command traffic only to destinations permitted by the policy.';
    networkHint.textContent = guest + ' Hosted Codex tools, including web search, have a separate scope. Tugboat does not read or set the web search mode.';
  }
  network.addEventListener('change', updateNetworkHint);
  updateNetworkHint();
  document.getElementById('settings-view')!.addEventListener('invalid', event => {
    const control = event.target as HTMLInputElement;
    if (control.form !== form) return;
    const firstInvalid = [...form.elements].find(element => (element as HTMLInputElement).willValidate && !(element as HTMLInputElement).validity.valid);
    if (control !== firstInvalid) return;
    setStatus('');
    const panel = control.closest<HTMLElement>('.settings-panel')!;
    selectSettingsTab(panel.id.replace('settings-panel-', '') as SettingsSection);
    control.focus();
  }, true);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submission = state.submit();
    if (!submission) return;
    ++settingsReadRevision;
    save.disabled = true;
    setBusy(save, true);
    setStatus('Saving settings…', true);
    const settings: Settings = {
      ...submission.value,
      schemaVersion: 2,
      cliPath: input('cli-path').value.trim() || null,
      codex: { profile: submission.value.codex.profile, allowedHosts: hostLines('allowed-hosts') },
      claudeCode: { profile: submission.value.claudeCode.profile, allowedHosts: hostLines('claude-code-allowed-hosts') },
      cpus: input('cpu-count').valueAsNumber,
      memoryMb: input('memory-mb').valueAsNumber,
      network: network.value as Settings['network'],
      telemetry: input('telemetry-preference').checked,
      projectDefaults: readProjectDefaults(),
    };
    try {
      const telemetry = await invoke<TelemetryStatus>('save_settings', { settings });
      state.saved(submission.revision, settings);
      acceptTelemetry(telemetry);
      setStatus(telemetry.message ? 'Settings saved. The Brig telemetry preference is waiting to be applied.' : 'Settings saved.');
    } catch (error) { state.fail(submission.revision); setStatus(String(error)); }
    finally {
      state.finish(submission.revision);
      setBusy(save, false);
      save.disabled = false;
      if (!save.closest('[hidden]')) save.focus();
      if (pendingSettingsRead) { pendingSettingsRead = false; void refreshSettings(); }
    }
  });
  fields.disabled = state.current() === null;
}
