import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setBusy } from '../ui/loading';
import { setWorkspaceStatus } from '../app/workspace-status';
import { appDataStore } from '../app/app-data';

type Provider = 'chatgpt' | 'claude';
export interface LoginStatus {
  provider: Provider;
  revision: number;
  phase: 'idle' | 'preparing' | 'waiting' | 'exchanging' | 'saving' | 'failed';
  authorizationUrl: string | null;
  userCode: string | null;
  message: string;
}
export interface ProviderSignIn {
  active(): boolean;
  message(): string | null;
  render(signedIn: boolean, accountBusy: boolean): void;
}

interface SignInControls {
  signIn: string;
  cancel: string;
  status: string;
  deviceCode?: { input: string; field: string };
}

export async function initializeProviderSignIn(
  provider: Provider,
  controls: SignInControls,
  changed: () => void,
  completed: () => Promise<void>,
): Promise<ProviderSignIn> {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const signIn = element<HTMLButtonElement>(controls.signIn);
  const cancel = element<HTMLButtonElement>(controls.cancel);
  const message = element(controls.status);
  const code = controls.deviceCode ? {
    field: element(controls.deviceCode.field),
    input: element<HTMLInputElement>(controls.deviceCode.input),
  } : null;
  const label = provider === 'chatgpt' ? 'ChatGPT' : 'Claude';
  let operation: 'idle' | 'starting' | 'opening' | 'cancelling' = 'idle';
  let account = { signedIn: false, busy: false };
  let error: string | null = null;
  const active = () => {
    const current = appDataStore.getState().providerLogins[provider];
    return current !== null && !['idle', 'failed'].includes(current.phase);
  };

  function render(): void {
    const current = appDataStore.getState().providerLogins[provider];
    const waiting = current?.phase === 'waiting';
    const busy = active() && !waiting || operation !== 'idle';
    const action = waiting ? 'Return to browser' : active() ? 'Connecting ' + label + '…'
      : account.signedIn ? 'Sign in with another account' : 'Sign in with ' + label;
    const status = error ?? current?.message ?? '';
    const progress = busy && !waiting && operation !== 'cancelling' && !error ? status || 'Connecting ' + label + '…' : null;
    signIn.textContent = action;
    signIn.disabled = account.busy || busy;
    cancel.hidden = !active() || current?.phase === 'saving';
    cancel.disabled = account.busy || operation === 'cancelling';
    message.textContent = status;
    message.hidden = progress !== null;
    setBusy(message, busy && operation !== 'cancelling');
    if (code) {
      code.input.value = current?.userCode ?? '';
      code.field.hidden = !waiting || code.input.value === '';
    }
    setWorkspaceStatus('provider-' + provider, progress, 'settings-panel-providers');
  }

  function accept(status: LoginStatus): void {
    const current = appDataStore.getState().providerLogins[provider];
    if (status.provider !== provider || current && status.revision < current.revision) return;
    const wasActive = active();
    appDataStore.setState(state => ({ providerLogins: { ...state.providerLogins, [provider]: status } }));
    error = null; render(); changed();
    if (wasActive && !active()) void completed();
  }

  async function run(action: 'start' | 'open' | 'cancel'): Promise<void> {
    if (operation !== 'idle' && action !== 'cancel') return;
    const restoreFocus = action === 'cancel' && document.activeElement === cancel;
    operation = action === 'start' ? 'starting' : action === 'open' ? 'opening' : 'cancelling';
    error = null; render();
    try {
      if (action === 'open') await invoke('open_provider_login', { provider });
      if (action === 'start') accept(await invoke<LoginStatus>('start_provider_login', { provider }));
      if (action === 'cancel') accept(await invoke<LoginStatus>('cancel_provider_login', { provider }));
    } catch (caught) { error = String(caught); }
    finally {
      operation = 'idle'; render(); changed();
      if (restoreFocus && !signIn.disabled && !signIn.closest('[hidden]') && (document.activeElement === cancel || document.activeElement === document.body)) signIn.focus();
    }
  }

  signIn.addEventListener('click', () => { void run(appDataStore.getState().providerLogins[provider]?.phase === 'waiting' ? 'open' : 'start'); });
  cancel.addEventListener('click', () => { void run('cancel'); });
  code?.input.addEventListener('focus', () => { code.input.select(); });
  await listen<LoginStatus>('provider-login-changed', event => { accept(event.payload); });
  try { accept(await invoke<LoginStatus>('provider_login_status', { provider })); }
  catch (caught) { error = String(caught); render(); }
  return { active, message: () => active() ? appDataStore.getState().providerLogins[provider]?.message ?? null : null,
    render: (signedIn, busy) => { account = { signedIn, busy }; render(); } };
}
