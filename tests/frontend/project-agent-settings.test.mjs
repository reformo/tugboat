import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, flush, interfaceHarness, project } from './frontend-harness.mjs';

const sibling = { ...project, id: 'agent-settings-sibling', environmentId: 'a'.repeat(32), label: 'agent-settings-sibling', path: '/fixture/sibling' };
const claudeOptions = { model: null, effort: null, fallbackModel: null, appendSystemPrompt: null };
const codexOptions = { model: null, reasoningEffort: null };
const defaults = { claude: { permissionMode: 'auto', attribution: 'hidden', options: claudeOptions }, codex: { boundary: 'brig', options: codexOptions } };
const fields = ['claude-model', 'claude-effort', 'claude-fallback-model', 'claude-append-system-prompt', 'claude-auto-mode-switch', 'claude-attribution-switch', 'codex-model', 'codex-reasoning-effort', 'codex-brig-boundary-switch'];
const plain = value => JSON.parse(JSON.stringify(value));

async function openSettings(harness, selected) {
  harness.element('sidebar-project-list').querySelector(`[data-project-id="${selected.id}"]`).click();
  await flush();
  harness.element('project-settings-button').click();
  await flush();
  assert.equal(harness.element('project-settings-dialog').hidden, false);
  harness.element('project-settings-dialog').querySelector('[data-settings-pane="project-agent-settings"]').click();
  await flush();
}

async function setup(t, commands) {
  const registered = { [project.id]: project, [sibling.id]: sibling };
  const harness = await interfaceHarness({
    recent_projects: () => [project, sibling],
    open_project: ({ identifier }) => registered[identifier],
    read_project_preferences: ({ identifier }) => ({ project: registered[identifier], options: { cpus: 4, memoryMb: 4096, verification: 'require', network: 'isolated' } }),
    ...commands,
  });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  return harness;
}

function toggle(harness, id) {
  const choice = harness.element(id);
  choice.checked = !choice.checked;
  choice.dispatchEvent(new harness.dom.window.Event('change'));
}

function enter(harness, id, value) {
  const field = harness.element(id);
  field.value = value;
  field.dispatchEvent(new harness.dom.window.Event('change'));
}

function saving(t) {
  const saved = { [project.id]: structuredClone(defaults) };
  return {
    saved,
    read_agent_settings: ({ identifier, environmentId }) => {
      assert.equal(environmentId, project.environmentId);
      return saved[identifier];
    },
    save_agent_settings: ({ identifier, environmentId, settings }) => {
      assert.equal(identifier, project.id);
      assert.equal(environmentId, project.environmentId);
      saved[identifier] = plain(settings);
      return settings;
    },
  };
}

test('provider tabs show one agent at a time and support arrow keys', async t => {
  const store = saving(t);
  const harness = await setup(t, { read_agent_settings: store.read_agent_settings });
  await openSettings(harness, project);
  const claude = harness.element('agent-tab-claude');
  const codex = harness.element('agent-tab-codex');
  assert.equal(harness.element('agent-tab-claude').closest('[role="tablist"]').getAttribute('aria-label'), 'Agent providers');
  assert.equal(claude.getAttribute('aria-selected'), 'true');
  assert.equal(harness.element('agent-panel-claude').hidden, false);
  assert.equal(harness.element('agent-panel-codex').hidden, true);
  codex.click();
  assert.equal(codex.getAttribute('aria-selected'), 'true');
  assert.equal(claude.tabIndex, -1);
  assert.equal(harness.element('agent-panel-claude').hidden, true);
  assert.equal(harness.element('agent-panel-codex').hidden, false);
  codex.dispatchEvent(new harness.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(claude.getAttribute('aria-selected'), 'true');
  assert.equal(harness.dom.window.document.activeElement, claude);
  harness.element('close-project-settings').click();
  await openSettings(harness, project);
  assert.equal(harness.element('agent-panel-claude').hidden, false);
  assert.match(harness.element('agent-status-line-note').textContent, /model, effort, input and output tokens/);
});

test('shows the defaults and saves each field for the selected environment', async t => {
  const store = saving(t);
  const harness = await setup(t, { ...store, stop_project: () => { throw new Error('An agent setting must not stop the environment.'); } });
  await openSettings(harness, project);
  for (const id of fields) assert.equal(harness.element(id).disabled, false, id);
  for (const id of ['claude-model', 'claude-effort', 'claude-fallback-model', 'claude-append-system-prompt', 'codex-model', 'codex-reasoning-effort']) assert.equal(harness.element(id).value, '', id);
  assert.equal(harness.element('claude-auto-mode-switch').checked, true);
  assert.equal(harness.element('claude-attribution-switch').checked, false);
  assert.equal(harness.element('codex-brig-boundary-switch').checked, true);

  enter(harness, 'claude-model', 'claude-opus-5-5'); await flush();
  enter(harness, 'claude-effort', 'xhigh'); await flush();
  enter(harness, 'claude-fallback-model', 'claude-sonnet-5-5'); await flush();
  enter(harness, 'claude-append-system-prompt', 'Answer in Turkish.\nKeep it short.'); await flush();
  toggle(harness, 'claude-auto-mode-switch'); await flush();
  toggle(harness, 'claude-attribution-switch'); await flush();
  enter(harness, 'codex-model', 'gpt-6.2-sol'); await flush();
  enter(harness, 'codex-reasoning-effort', 'high'); await flush();
  toggle(harness, 'codex-brig-boundary-switch'); await flush();
  assert.deepEqual(store.saved[project.id], {
    claude: { permissionMode: 'manual', attribution: 'shown', options: { model: 'claude-opus-5-5', effort: 'xhigh', fallbackModel: 'claude-sonnet-5-5', appendSystemPrompt: 'Answer in Turkish.\nKeep it short.' } },
    codex: { boundary: 'workspace', options: { model: 'gpt-6.2-sol', reasoningEffort: 'high' } },
  });
  assert.equal(harness.element('claude-model').value, 'claude-opus-5-5');
  assert.match(harness.element('agent-settings-status').textContent, /New and resumed chats use these settings/);

  enter(harness, 'claude-model', ''); await flush();
  enter(harness, 'codex-reasoning-effort', ''); await flush();
  assert.equal(store.saved[project.id].claude.options.model, null);
  assert.equal(store.saved[project.id].codex.options.reasoningEffort, null);
  const saves = harness.calls.filter(call => call.command === 'save_agent_settings').length;
  enter(harness, 'codex-model', 'gpt-6.2-sol'); await flush();
  assert.equal(harness.calls.filter(call => call.command === 'save_agent_settings').length, saves, 'An unchanged value is not saved again.');
  assert.equal(harness.calls.some(call => call.command === 'stop_project'), false);
});

test('restores the saved value when saving fails or returns an unsupported value', async t => {
  let reply = () => { throw 'Use a model name with 1 to 100 letters, digits, dots, dashes, underscores, colons, slashes or brackets.'; };
  const harness = await setup(t, {
    read_agent_settings: () => defaults,
    save_agent_settings: () => reply(),
  });
  await openSettings(harness, project);
  enter(harness, 'claude-model', 'claude-opus-5-5'); await flush();
  assert.equal(harness.element('claude-model').value, '');
  assert.equal(harness.element('claude-model').disabled, false);
  assert.match(harness.element('agent-settings-status').textContent, /Use a model name/);
  for (const unsupported of [true, { ...defaults, claude: { ...defaults.claude, permissionMode: 'bypassPermissions' } }, { ...defaults, claude: { ...defaults.claude, options: { ...claudeOptions, effort: 'turbo' } } }, { claude: defaults.claude }]) {
    reply = () => unsupported;
    toggle(harness, 'claude-auto-mode-switch');
    await flush();
    assert.equal(harness.element('claude-auto-mode-switch').checked, true);
    assert.match(harness.element('agent-settings-status').textContent, /Could not confirm the agent settings/);
  }
});

test('keeps every field disabled when the saved settings cannot be read', async t => {
  const harness = await setup(t, {
    read_agent_settings: () => ({ claude: { permissionMode: 'auto', attribution: 'hidden' }, codex: { boundary: 'brig' } }),
    save_agent_settings: () => { throw new Error('An unread setting must not be saved.'); },
  });
  await openSettings(harness, project);
  for (const id of fields) assert.equal(harness.element(id).disabled, true, id);
  assert.match(harness.element('agent-settings-status').textContent, /Could not confirm the agent settings/);
  assert.equal(harness.calls.some(call => call.command === 'save_agent_settings'), false);
});

test('ignores a late save result after the selected project changes', async t => {
  const save = deferred();
  const harness = await setup(t, {
    read_agent_settings: () => defaults,
    save_agent_settings: () => save.promise,
  });
  await openSettings(harness, project);
  enter(harness, 'claude-model', 'claude-opus-5-5');
  await flush();
  assert.equal(harness.element('claude-model').disabled, true);
  harness.element('close-project-settings').click();
  await openSettings(harness, sibling);
  save.resolve({ ...defaults, claude: { ...defaults.claude, options: { ...claudeOptions, model: 'claude-opus-5-5' } } });
  await flush();
  assert.equal(harness.element('claude-model').value, '');
  assert.equal(harness.element('claude-model').disabled, false);
  assert.equal(harness.element('agent-settings-status').textContent, '');
  assert.deepEqual(
    harness.calls.filter(call => call.command === 'read_agent_settings').map(call => call.args.identifier),
    [project.id, sibling.id],
  );
});

test('model lists offer the current models and keep a saved model that is not listed', async t => {
  const harness = await setup(t, {
    read_agent_settings: () => ({ ...defaults, claude: { ...defaults.claude, options: { ...claudeOptions, model: 'claude-opus-4-1' } } }),
  });
  await openSettings(harness, project);
  const values = id => [...harness.element(id).querySelectorAll('option')].map(option => option.value);
  assert.deepEqual(values('claude-model').slice(0, 6), ['', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2', 'opusplan']);
  assert.deepEqual(values('codex-model').slice(0, 4), ['', 'gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra']);
  for (const retired of ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex-spark', 'gpt-reserve', 'codex-auto-review']) assert.equal(values('codex-model').includes(retired), false, retired);
  assert.deepEqual(values('codex-reasoning-effort'), ['', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.equal(harness.element('claude-model').value, 'claude-opus-4-1');
  assert.match(harness.element('claude-model').selectedOptions[0].textContent, /claude-opus-4-1 \(saved\)/);
  harness.element('close-project-settings').click();
  await openSettings(harness, project);
  assert.equal(harness.element('claude-model').querySelectorAll('[data-saved-value]').length, 1);
});

test('Ultra reasoning is unavailable for the Luna models', async t => {
  const store = saving(t);
  const harness = await setup(t, { ...store });
  await openSettings(harness, project);
  const ultra = harness.element('codex-reasoning-effort').querySelector('option[value="ultra"]');
  assert.equal(ultra.disabled, false);
  enter(harness, 'codex-model', 'gpt-6-luna'); await flush();
  assert.equal(ultra.disabled, true);
  enter(harness, 'codex-model', 'gpt-5.6-luna'); await flush();
  assert.equal(ultra.disabled, true);
  enter(harness, 'codex-model', 'gpt-6.2-astra'); await flush();
  assert.equal(ultra.disabled, false);
  enter(harness, 'codex-reasoning-effort', 'ultra'); await flush();
  assert.equal(store.saved[project.id].codex.options.reasoningEffort, 'ultra');
});

test('a rejected model and effort pair restores the saved values', async t => {
  const harness = await setup(t, {
    read_agent_settings: () => ({ ...defaults, codex: { ...defaults.codex, options: { model: 'gpt-6.2-sol', reasoningEffort: 'ultra' } } }),
    save_agent_settings: () => { throw 'gpt-6-luna does not support ultra reasoning. Select a different reasoning effort.'; },
  });
  await openSettings(harness, project);
  enter(harness, 'codex-model', 'gpt-6-luna'); await flush();
  assert.equal(harness.element('codex-model').value, 'gpt-6.2-sol');
  assert.equal(harness.element('codex-reasoning-effort').value, 'ultra');
  assert.equal(harness.element('codex-reasoning-effort').querySelector('option[value="ultra"]').disabled, false);
  assert.match(harness.element('agent-settings-status').textContent, /does not support ultra/);
});
