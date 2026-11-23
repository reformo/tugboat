export interface ProjectSettingsNavigation { select(paneId: string): void }

// Each pane is a <details> element, so the existing section controllers keep loading on 'toggle'.
export function initializeProjectSettingsNavigation(): ProjectSettingsNavigation {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-settings-pane]')];
  const panes = tabs.map(tab => document.getElementById(tab.dataset.settingsPane!) as HTMLDetailsElement);
  let current: HTMLDetailsElement | null = null;

  function select(paneId: string): void {
    const pane = panes.find(candidate => candidate.id === paneId);
    if (!pane) throw new Error(`Unknown project settings section: ${paneId}`);
    current = pane;
    for (const other of panes) other.open = other === pane;
    for (const tab of tabs) tab.setAttribute('aria-current', String(tab.dataset.settingsPane === paneId));
  }

  for (const tab of tabs) tab.addEventListener('click', () => { select(tab.dataset.settingsPane!); });
  for (const pane of panes) {
    pane.addEventListener('toggle', () => {
      if (!pane.open && pane === current) current = null;
      if (pane.open && pane !== current) select(pane.id);
    });
  }
  select(panes[0].id);
  return { select };
}
