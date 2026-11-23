import { modelsWithoutUltra, showValue, type AgentSettings } from '../projects/project-agent-settings';

interface NetworkAccess { publicInternet: boolean; hosts: { packageManagers: boolean; additional: string[] } }
export interface ProjectDefaults { agents: AgentSettings; network: NetworkAccess }
type ClaudeOptions = AgentSettings['claude']['options'];
type CodexOptions = AgentSettings['codex']['options'];
type FieldValue = string | boolean;

// Keep equal to ProjectDefaults::default in Rust. Settings leave out a record with these values.
export const initialProjectDefaults: ProjectDefaults = {
  agents: {
    claude: { permissionMode: 'auto', attribution: 'hidden', options: { model: null, effort: null, fallbackModel: null, appendSystemPrompt: null } },
    codex: { boundary: 'brig', options: { model: null, reasoningEffort: null } },
  },
  network: { publicInternet: false, hosts: { packageManagers: false, additional: [] } },
};

function field(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function optional(id: string): string | null {
  return field(id).value.trim() || null;
}

export function hostLines(id: string): string[] {
  return [...new Set(field(id).value.split('\n').map(value => value.trim()).filter(Boolean))];
}

export function projectDefaultFields(defaults: ProjectDefaults): Record<string, FieldValue> {
  const { claude, codex } = defaults.agents;
  return {
    'default-claude-model': claude.options.model ?? '',
    'default-claude-effort': claude.options.effort ?? '',
    'default-claude-fallback-model': claude.options.fallbackModel ?? '',
    'default-claude-append-system-prompt': claude.options.appendSystemPrompt ?? '',
    'default-claude-auto-mode': claude.permissionMode === 'auto',
    'default-claude-attribution': claude.attribution === 'shown',
    'default-codex-model': codex.options.model ?? '',
    'default-codex-reasoning-effort': codex.options.reasoningEffort ?? '',
    'default-codex-brig-boundary': codex.boundary === 'brig',
    'default-network-public-internet': defaults.network.publicInternet,
    'default-network-package-managers': defaults.network.hosts.packageManagers,
    'default-network-hosts': defaults.network.hosts.additional.join('\n'),
  };
}

// The prompt keeps its inner spacing. Only an empty prompt clears the option.
export function readProjectDefaults(): ProjectDefaults {
  const prompt = field('default-claude-append-system-prompt').value;
  return {
    agents: {
      claude: {
        permissionMode: field('default-claude-auto-mode').checked ? 'auto' : 'manual',
        attribution: field('default-claude-attribution').checked ? 'shown' : 'hidden',
        options: { model: optional('default-claude-model'), effort: optional('default-claude-effort') as ClaudeOptions['effort'], fallbackModel: optional('default-claude-fallback-model'), appendSystemPrompt: prompt.trim() ? prompt : null },
      },
      codex: {
        boundary: field('default-codex-brig-boundary').checked ? 'brig' : 'workspace',
        options: { model: optional('default-codex-model'), reasoningEffort: optional('default-codex-reasoning-effort') as CodexOptions['reasoningEffort'] },
      },
    },
    network: {
      publicInternet: field('default-network-public-internet').checked,
      hosts: { packageManagers: field('default-network-package-managers').checked, additional: hostLines('default-network-hosts') },
    },
  };
}

export function showFieldValue(id: string, value: FieldValue): void {
  if (typeof value === 'boolean') { field(id).checked = value; return; }
  showValue(field(id), value);
}

export function currentFieldValue(id: string): FieldValue {
  const input = field(id);
  return input.type === 'checkbox' ? input.checked : input.value;
}

export function limitDefaultReasoning(): void {
  const ultra = document.querySelector<HTMLOptionElement>('#default-codex-reasoning-effort option[value="ultra"]')!;
  ultra.disabled = modelsWithoutUltra.includes(field('default-codex-model').value);
}

// The project Agents section owns the model lists. The defaults copy them so both stay equal.
export function initializeProjectDefaults(): void {
  for (const select of document.querySelectorAll<HTMLSelectElement>('select[data-options-from]')) {
    const source = document.getElementById(select.dataset.optionsFrom!) as HTMLSelectElement;
    select.replaceChildren(...[...source.children].map(option => option.cloneNode(true)));
  }
  field('default-codex-model').addEventListener('change', limitDefaultReasoning);
  limitDefaultReasoning();
}
