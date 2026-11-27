import { invoke } from '@tauri-apps/api/core';
import type { StopImpact } from './operations';

type Target = { identifier: string; environmentId: string };
type StopResult = { kind: 'cancelled' } | { kind: 'stopped'; note: string } | { kind: 'not-running' };

function stopNote(idleChats: number): string {
  if (idleChats === 0) return 'Tugboat stopped the environment.';
  const chats = idleChats === 1 ? '1 idle Codex chat' : `${idleChats} idle Codex chats`;
  return `Tugboat stopped the environment and closed ${chats}. You can resume saved chats.`;
}

// A settings change that needs a stopped environment calls prepare() first.
// Working processes need confirmation. Idle Codex chats and an empty environment stop without a question.
export class EnvironmentStopGate {
  private readonly box: HTMLElement;
  private answer: ((confirmed: boolean) => void) | null = null;

  constructor(box: HTMLElement) {
    this.box = box;
    this.button('[data-stop-confirm]').addEventListener('click', () => { this.settle(true); });
    this.button('[data-stop-cancel]').addEventListener('click', () => { this.settle(false); });
  }

  async prepare(target: Target, impact: StopImpact, report: (message: string) => void): Promise<StopResult> {
    if (impact.working.length > 0 && !(await this.confirm(impact.working))) return { kind: 'cancelled' };
    const processes = impact.working.length + impact.idle.length;
    if (processes === 0 && !(await invoke<boolean>('project_environment_running', target))) return { kind: 'not-running' };
    report('Stopping the project environment…');
    await invoke('stop_project', target);
    return { kind: 'stopped', note: stopNote(impact.idle.length) };
  }

  cancel(): void { this.settle(false); }

  private button(selector: string): HTMLButtonElement {
    return this.box.querySelector<HTMLButtonElement>(selector)!;
  }

  private confirm(labels: string[]): Promise<boolean> {
    this.settle(false);
    this.box.querySelector('[data-stop-list]')!.replaceChildren(...labels.map(label => {
      const item = document.createElement('li');
      item.textContent = label;
      return item;
    }));
    this.box.hidden = false;
    this.button('[data-stop-confirm]').focus();
    return new Promise(resolve => { this.answer = resolve; });
  }

  private settle(confirmed: boolean): void {
    const answer = this.answer;
    this.answer = null;
    this.box.hidden = true;
    answer?.(confirmed);
  }
}
