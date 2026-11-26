export interface ProjectSettingsNavigation { select(paneId: string): void }

// Each pane is a <details> element, so the existing section controllers keep loading on 'toggle'.
export function initializeProjectSettingsNavigation(): ProjectSettingsNavigation {
  const dialog = document.getElementById('project-settings-dialog')!;
  const scroller = dialog.querySelector('.settings-dialog-panes')!;
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[data-settings-pane]')];
  const groups = [...dialog.querySelectorAll<HTMLButtonElement>('[data-settings-group]')];
  const panes = tabs.map(tab => document.getElementById(tab.dataset.settingsPane!) as HTMLDetailsElement);
  const overview = tabs[0];
  let current: HTMLDetailsElement | null = null;

  function select(paneId: string): void {
    const index = panes.findIndex(candidate => candidate.id === paneId);
    if (index < 0) throw new Error(`Unknown project settings section: ${paneId}`);
    const pane = panes[index];
    const tab = tabs[index];
    const submenu = tab.closest('.settings-subnav');
    const changed = current !== pane;
    current = pane;
    for (const other of panes) other.open = other === pane;
    for (const button of tabs) button.setAttribute('aria-current', String(button === tab));
    for (const button of groups) {
      const controlled = document.getElementById(button.getAttribute('aria-controls')!)!;
      controlled.hidden = controlled !== submenu;
      button.setAttribute('aria-current', String(!controlled.hidden));
    }
    if (changed) scroller.scrollTop = 0;
  }

  for (const group of groups) group.addEventListener('click', () => { select(group.dataset.settingsGroup!); });
  for (const tab of tabs) tab.addEventListener('click', () => { select(tab.dataset.settingsPane!); });
  for (const pane of panes) {
    pane.addEventListener('toggle', () => {
      if (pane.open && pane !== current) select(pane.id);
      if (pane.open || pane !== current || dialog.hidden) return;
      const wasFocused = document.activeElement === document.body || pane.contains(document.activeElement);
      select(overview.dataset.settingsPane!);
      if (wasFocused) overview.focus();
    });
  }
  select(overview.dataset.settingsPane!);
  return { select };
}
