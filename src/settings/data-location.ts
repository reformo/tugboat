import { invoke } from '@tauri-apps/api/core';
import { setBusy, setLoading } from '../ui/loading';
import { FormState } from '../ui/form-state';
import { closeDialog, showDialog } from '../ui/dialogs';
import { setWorkspaceStatus } from '../app/workspace-status';

interface StorageLocation {
  directory: string | null;
  defaultDirectory: string;
  pendingDirectory: string | null;
  available: boolean;
  canChange: boolean;
  message: string | null;
  projectReset?: 'cancel-move' | 'restart-required';
}

export async function initializeDataLocation(): Promise<void> {
  const path = document.getElementById('records-folder')!;
  const status = document.getElementById('records-folder-status')!;
  const hint = document.getElementById('records-folder-hint')!;
  const change = document.getElementById('change-records-folder') as HTMLButtonElement;
  const restore = document.getElementById('default-records-folder') as HTMLButtonElement;
  const cancel = document.getElementById('cancel-records-move') as HTMLButtonElement;
  const restart = document.getElementById('restart-for-records') as HTMLButtonElement;
  const existingDialog = document.querySelector<HTMLDialogElement>('#existing-records-dialog')!;
  const existingPath = document.getElementById('existing-records-path')!;
  const state = new FormState<StorageLocation>();

  function finishChoice(choice: string): void {
    existingDialog.returnValue = choice;
    closeDialog(existingDialog);
  }
  document.getElementById('use-existing-records')!.addEventListener('click', () => finishChoice('existing'));
  document.getElementById('move-current-records')!.addEventListener('click', () => finishChoice('move'));
  document.getElementById('cancel-existing-records')!.addEventListener('click', () => finishChoice(''));
  existingDialog.addEventListener('cancel', event => { event.preventDefault(); finishChoice(''); });

  function render(): void {
    const location = state.current();
    const busy = state.busy();
    path.textContent = location?.directory ?? 'Unavailable';
    setLoading(path, busy && location === null);
    setBusy(status, busy && location !== null);
    change.textContent = location?.available ? 'Change folder…' : 'Locate records folder…';
    change.disabled = busy || !location?.canChange || !!location?.projectReset;
    restore.hidden = !location?.available || location.directory === location.defaultDirectory;
    restore.disabled = busy || !!location?.projectReset;
    cancel.hidden = !location?.pendingDirectory;
    cancel.disabled = busy;
    restart.hidden = location?.projectReset === 'cancel-move' || (!location?.projectReset && !location?.pendingDirectory && location?.available !== false);
    restart.disabled = busy;
    hint.textContent = location?.available
      ? 'Move your records to an empty folder or open an existing Tugboat records folder. The change takes effect when Tugboat restarts.'
      : 'Connect the drive and restart Tugboat, or locate your existing records folder. Your saved records are kept.';
    if (!busy) status.textContent = [location?.message, location?.pendingDirectory && !location.projectReset ? 'Restart Tugboat to use ' + location.pendingDirectory + '. Save any setting changes before restarting.' : ''].filter(Boolean).join(' ');
  }

  async function update(action: () => Promise<StorageLocation | null>, progress: string): Promise<void> {
    if (state.busy()) return;
    const request = state.current() === null ? state.read() : state.submit()!.revision;
    render(); status.textContent = progress; status.hidden = true;
    setWorkspaceStatus('records-folder', progress, 'settings-panel-general');
    let error: string | null = null;
    try {
      const result = await action();
      if (result) state.receive(request, result);
    } catch (caught) { state.fail(request); error = String(caught); }
    finally { state.finish(request); render(); status.hidden = false; setWorkspaceStatus('records-folder', null, 'settings-panel-general'); if (error) status.textContent = error; }
  }

  async function changeFolder(folder: string | null, opener: HTMLButtonElement): Promise<StorageLocation | null> {
    const location = state.current()!;
    if (!location.available) return invoke<StorageLocation>('change_storage_location', { folder, locate: true });
    const existingDirectoryId = await invoke<string | null>('inspect_storage_folder', { folder });
    if (!existingDirectoryId) return invoke<StorageLocation>('change_storage_location', { folder, locate: false });
    existingPath.textContent = folder ?? location.defaultDirectory;
    existingDialog.returnValue = '';
    const choice = await new Promise<string>(resolve => {
      existingDialog.addEventListener('close', () => resolve(existingDialog.returnValue), { once: true });
      showDialog(existingDialog, opener.id);
    });
    if (choice === 'existing') return invoke<StorageLocation>('change_storage_location', { folder, locate: false, existingDirectoryId });
    if (choice !== 'move') return null;
    const emptyFolder = await invoke<string | null>('choose_storage_folder');
    if (!emptyFolder) return null;
    return invoke<StorageLocation>('change_storage_location', { folder: emptyFolder, locate: false });
  }

  change.addEventListener('click', () => { void update(async () => {
    const folder = await invoke<string | null>('choose_storage_folder');
    if (!folder) return null;
    return changeFolder(folder, change);
  }, 'Choosing a records folder…').then(() => restoreFocus(change)); });
  restore.addEventListener('click', () => { void update(() => changeFolder(null, restore), 'Preparing the default folder…').then(() => restoreFocus(restore)); });
  cancel.addEventListener('click', () => { void update(() => invoke<StorageLocation>('cancel_storage_move'), 'Cancelling the folder change…'); });
  restart.addEventListener('click', () => { void update(async () => {
    await invoke('restart_for_storage_change');
    return null;
  }, 'Restarting Tugboat…'); });
  await update(() => invoke<StorageLocation>('storage_location'), 'Loading the records folder…');
}

function restoreFocus(button: HTMLButtonElement): void {
  if (document.activeElement === document.body && !button.closest('[hidden], [inert]')) button.focus();
}
