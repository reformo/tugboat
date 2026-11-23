import { invoke } from '@tauri-apps/api/core';
import { sameProjectView, type ProjectContext } from './projects';

type PermissionMode = 'auto' | 'manual';
type Attribution = 'hidden' | 'shown';
type Boundary = 'brig' | 'workspace';
type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type CodexEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
// Keep equal to MODELS_WITHOUT_ULTRA in the Rust Codex adapter.
export const modelsWithoutUltra = ['gpt-6-luna', 'gpt-5.6-luna'];
interface ClaudeOptions { model: string | null; effort: ClaudeEffort | null; fallbackModel: string | null; appendSystemPrompt: string | null }
interface CodexOptions { model: string | null; reasoningEffort: CodexEffort | null }
export interface AgentSettings {
  claude: { permissionMode: PermissionMode; attribution: Attribution; options: ClaudeOptions };
  codex: { boundary: Boundary; options: CodexOptions };
}

type Value = boolean | string;
interface Control { id: string; read(settings: AgentSettings): Value; write(settings: AgentSettings, value: Value): AgentSettings }

const text = (value: Value): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const claudeOption = (settings: AgentSettings, change: Partial<ClaudeOptions>): AgentSettings => ({ ...settings, claude: { ...settings.claude, options: { ...settings.claude.options, ...change } } });
const codexOption = (settings: AgentSettings, change: Partial<CodexOptions>): AgentSettings => ({ ...settings, codex: { ...settings.codex, options: { ...settings.codex.options, ...change } } });

const controls: Control[] = [
  { id: 'claude-model', read: settings => settings.claude.options.model ?? '', write: (settings, value) => claudeOption(settings, { model: text(value) }) },
  { id: 'claude-effort', read: settings => settings.claude.options.effort ?? '', write: (settings, value) => claudeOption(settings, { effort: text(value) as ClaudeEffort | null }) },
  { id: 'claude-fallback-model', read: settings => settings.claude.options.fallbackModel ?? '', write: (settings, value) => claudeOption(settings, { fallbackModel: text(value) }) },
  // The prompt keeps its inner spacing. Only an empty prompt clears the option.
  { id: 'claude-append-system-prompt', read: settings => settings.claude.options.appendSystemPrompt ?? '', write: (settings, value) => claudeOption(settings, { appendSystemPrompt: text(value) === null ? null : String(value) }) },
  { id: 'claude-auto-mode-switch', read: settings => settings.claude.permissionMode === 'auto', write: (settings, value) => ({ ...settings, claude: { ...settings.claude, permissionMode: value ? 'auto' : 'manual' } }) },
  { id: 'claude-attribution-switch', read: settings => settings.claude.attribution === 'shown', write: (settings, value) => ({ ...settings, claude: { ...settings.claude, attribution: value ? 'shown' : 'hidden' } }) },
  { id: 'codex-model', read: settings => settings.codex.options.model ?? '', write: (settings, value) => codexOption(settings, { model: text(value) }) },
  { id: 'codex-reasoning-effort', read: settings => settings.codex.options.reasoningEffort ?? '', write: (settings, value) => codexOption(settings, { reasoningEffort: text(value) as CodexEffort | null }) },
  { id: 'codex-brig-boundary-switch', read: settings => settings.codex.boundary === 'brig', write: (settings, value) => ({ ...settings, codex: { ...settings.codex, boundary: value ? 'brig' : 'workspace' } }) },
];

const optional = (value: unknown, allowed?: string[]): boolean =>
  value === null || (typeof value === 'string' && (!allowed || allowed.includes(value)));

function supported(value: unknown): value is AgentSettings {
  const settings = value as AgentSettings | null;
  const claude = settings?.claude?.options;
  const codex = settings?.codex?.options;
  return ['auto', 'manual'].includes(settings?.claude?.permissionMode as string)
    && ['hidden', 'shown'].includes(settings?.claude?.attribution as string)
    && ['brig', 'workspace'].includes(settings?.codex?.boundary as string)
    && claude !== undefined && codex !== undefined
    && optional(claude.model) && optional(claude.fallbackModel) && optional(claude.appendSystemPrompt)
    && optional(claude.effort, ['low', 'medium', 'high', 'xhigh', 'max'])
    && optional(codex.model) && optional(codex.reasoningEffort, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
}

const arrowSteps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
function isSwitch(input: Field): input is HTMLInputElement {
  return input.getAttribute('role') === 'switch';
}

// A model saved before the list changed stays visible and selected.
export function showValue(input: Field, value: string): void {
  if (input.tagName !== 'SELECT') { input.value = value; return; }
  const select = input as HTMLSelectElement;
  for (const option of select.querySelectorAll('option[data-saved-value]')) option.remove();
  if (value !== '' && ![...select.options].some(option => option.value === value)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${value} (saved)`;
    option.dataset.savedValue = 'true';
    select.append(option);
  }
  select.value = value;
}

function limitReasoning(): void {
  const model = (document.getElementById('codex-model') as HTMLSelectElement).value;
  const ultra = document.querySelector<HTMLOptionElement>('#codex-reasoning-effort option[value="ultra"]')!;
  ultra.disabled = modelsWithoutUltra.includes(model);
}

function initializeAgentTabs(): () => void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.agent-tab')];
  function select(selected: HTMLButtonElement, focus: boolean): void {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')!)!.hidden = !active;
    }
    if (focus) selected.focus();
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => { select(tab, false); });
    tab.addEventListener('keydown', event => {
      const step = arrowSteps[event.key];
      if (!step) return;
      event.preventDefault();
      select(tabs[(index + step + tabs.length) % tabs.length], true);
    });
  }
  return () => { select(tabs[0], false); };
}

export function initializeAgentSettings(current: () => ProjectContext | null): () => void {
  const section = document.querySelector<HTMLDetailsElement>('#project-agent-settings')!;
  const status = document.querySelector<HTMLParagraphElement>('#agent-settings-status')!;
  const fields = controls.map(control => ({ ...control, input: document.getElementById(control.id) as Field }));
  const resetTabs = initializeAgentTabs();
  let saved: AgentSettings | null = null;
  let revision = 0;

  function render(busy: boolean): void {
    for (const field of fields) {
      field.input.disabled = busy || saved === null;
      if (busy) continue;
      const value = saved === null ? '' : field.read(saved);
      if (isSwitch(field.input)) { field.input.checked = value === true; continue; }
      showValue(field.input, String(value === false ? '' : value));
    }
    limitReasoning();
  }

  async function request(next: AgentSettings | null): Promise<void> {
    const context = current();
    if (!context || !section.open) return;
    const target = { identifier: context.id, environmentId: context.environmentId };
    const operation = ++revision;
    const active = () => operation === revision && section.open && sameProjectView(current(), context);
    render(true);
    status.textContent = next ? 'Saving agent settings…' : 'Reading agent settings…';
    try {
      const result = next
        ? await invoke<unknown>('save_agent_settings', { ...target, settings: next })
        : await invoke<unknown>('read_agent_settings', target);
      if (!active()) return;
      if (!supported(result)) throw new Error('Tugboat returned unsupported agent settings.');
      saved = result;
      status.textContent = next ? 'Saved. New and resumed chats use these settings.' : '';
    } catch (error) {
      if (active()) status.textContent = typeof error === 'string' ? error : 'Could not confirm the agent settings. Open this section again.';
    } finally {
      if (operation === revision) render(false);
    }
  }

  section.addEventListener('toggle', () => {
    if (section.open) { void request(null); return; }
    revision++;
    render(false);
  });
  for (const field of fields) {
    field.input.addEventListener('change', () => {
      limitReasoning();
      if (!saved) return;
      const value = isSwitch(field.input) ? field.input.checked : field.input.value;
      const next = field.write(saved, value);
      if (JSON.stringify(next) !== JSON.stringify(saved)) void request(next);
    });
  }
  return () => {
    revision++;
    saved = null;
    section.open = false;
    status.textContent = '';
    resetTabs();
    render(false);
  };
}
