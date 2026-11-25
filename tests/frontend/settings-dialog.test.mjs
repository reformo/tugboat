import test from 'node:test';
import assert from 'node:assert/strict';
import { flush, settings, interfaceHarness } from './frontend-harness.mjs';

const saved = () => ({ recorded: 'off', effective: 'off', message: null });

test('Settings opens as a modal with a section menu and closes back to the opening control', async t => {
  const harness = await interfaceHarness();
  t.after(() => harness.dom.window.close());
  await harness.ready;
  const dialog = harness.element('settings-view'), document = harness.dom.window.document;
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.hidden, true);
  harness.element('settings-navigation').click(); await flush();
  assert.equal(dialog.hidden, false);
  assert.equal(harness.element('project-view').hidden, false);
  assert.equal(harness.element('project-view').hasAttribute('inert'), true);
  assert.equal(harness.element('sidebar').hasAttribute('inert'), true);
  assert.equal(dialog.hasAttribute('inert'), false);
  assert.equal(document.activeElement, harness.element('settings-heading'));
  const menu = [...harness.element('settings-tabs').querySelectorAll('button')].map(button => button.textContent);
  assert.deepEqual(menu, ['General', 'Providers', 'Brig', 'System Checks', 'Resources', 'Network', 'Agents']);
  assert.equal(harness.element('settings-tab-general').getAttribute('aria-current'), 'true');
  assert.equal(harness.element('settings-panel-general').hidden, false);
  assert.equal(harness.element('settings-form-footer').hidden, true);
  harness.element('settings-tab-agents').click();
  assert.equal(harness.element('settings-panel-general').hidden, true);
  assert.equal(harness.element('settings-panel-agents').hidden, false);
  assert.equal(harness.element('settings-tab-general').getAttribute('aria-current'), 'false');
  assert.equal(harness.element('settings-form-footer').hidden, false);
  dialog.dispatchEvent(new harness.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await flush();
  assert.equal(dialog.hidden, true);
  assert.equal(harness.element('project-view').hasAttribute('inert'), false);
  assert.equal(harness.element('sidebar').hasAttribute('inert'), false);
  assert.equal(document.activeElement, harness.element('settings-navigation'));
  harness.element('settings-navigation').click(); await flush();
  assert.equal(harness.element('settings-panel-general').hidden, false);
  harness.element('close-settings').click(); await flush();
  assert.equal(dialog.hidden, true);
});

test('application Settings replaces an open project settings dialog', async t => {
  const harness = await interfaceHarness();
  t.after(() => harness.dom.window.close());
  await harness.ready;
  harness.element('choose-folder').click(); await flush();
  harness.element('project-settings-button').click(); await flush();
  assert.equal(harness.element('project-settings-dialog').hidden, false);
  await harness.listeners.get('menu-action')({ payload: 'settings' }); await flush();
  assert.equal(harness.element('project-settings-dialog').hidden, true);
  assert.equal(harness.element('settings-view').hidden, false);
  assert.equal(harness.element('project-view').hasAttribute('inert'), true);
  assert.equal(harness.calls.filter(call => call.command === 'terminal_layout' && call.args.layout.visible).length, 0);
});

test('project defaults start with the agent defaults when settings leave them out', async t => {
  const harness = await interfaceHarness();
  t.after(() => harness.dom.window.close());
  await harness.ready;
  assert.equal('projectDefaults' in settings, false);
  for (const id of ['default-claude-auto-mode', 'default-codex-brig-boundary']) assert.equal(harness.element(id).checked, true);
  for (const id of ['default-claude-attribution', 'default-network-public-internet', 'default-network-package-managers']) assert.equal(harness.element(id).checked, false);
  for (const id of ['default-claude-model', 'default-claude-effort', 'default-codex-model', 'default-network-hosts']) assert.equal(harness.element(id).value, '');
  const copied = (from, to) => [...harness.element(to).options].map(option => option.value).join() === [...harness.element(from).options].map(option => option.value).join();
  for (const [from, to] of [['claude-model', 'default-claude-model'], ['claude-effort', 'default-claude-effort'], ['claude-fallback-model', 'default-claude-fallback-model'], ['codex-model', 'default-codex-model'], ['codex-reasoning-effort', 'default-codex-reasoning-effort']]) {
    assert.ok(copied(from, to), to);
  }
  harness.element('settings-navigation').click(); await flush();
  harness.element('settings-tab-agents').click();
  harness.element('save-settings').click(); await flush();
  const request = harness.calls.find(call => call.command === 'save_settings');
  assert.deepEqual(JSON.parse(JSON.stringify(request.args.settings.projectDefaults)), {
    agents: {
      claude: { permissionMode: 'auto', attribution: 'hidden', options: { model: null, effort: null, fallbackModel: null, appendSystemPrompt: null } },
      codex: { boundary: 'brig', options: { model: null, reasoningEffort: null } },
    },
    network: { publicInternet: false, hosts: { packageManagers: false, additional: [] } },
  });
});

test('saved project defaults load into their sections and a save sends the edited values', async t => {
  const projectDefaults = {
    agents: {
      claude: { permissionMode: 'manual', attribution: 'shown', options: { model: 'claude-retired-1', effort: 'high', fallbackModel: null, appendSystemPrompt: 'Use Turkish.' } },
      codex: { boundary: 'workspace', options: { model: 'gpt-6.2-sol', reasoningEffort: 'xhigh' } },
    },
    network: { publicInternet: true, hosts: { packageManagers: true, additional: ['api.example.com'] } },
  };
  let request;
  const harness = await interfaceHarness({ load_settings: () => ({ ...settings, projectDefaults }), save_settings: ({ settings: value }) => { request = value; return saved(); } });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  const model = harness.element('default-claude-model');
  assert.equal(model.value, 'claude-retired-1');
  assert.equal(model.selectedOptions[0].textContent, 'claude-retired-1 (saved)');
  assert.equal(harness.element('claude-model').querySelector('[data-saved-value]'), null);
  assert.equal(harness.element('default-claude-auto-mode').checked, false);
  assert.equal(harness.element('default-claude-attribution').checked, true);
  assert.equal(harness.element('default-codex-brig-boundary').checked, false);
  assert.equal(harness.element('default-network-public-internet').checked, true);
  assert.equal(harness.element('default-network-hosts').value, 'api.example.com');
  harness.element('settings-navigation').click(); await flush();
  harness.element('settings-tab-agents').click();
  const codexModel = harness.element('default-codex-model');
  codexModel.value = 'gpt-6-luna'; codexModel.dispatchEvent(new harness.dom.window.Event('change'));
  assert.equal(harness.element('default-codex-reasoning-effort').querySelector('[value="ultra"]').disabled, true);
  harness.element('default-claude-auto-mode').checked = true;
  harness.element('settings-tab-network').click();
  harness.element('default-network-public-internet').checked = false;
  harness.element('default-network-hosts').value = ' b.example.com\n\nb.example.com\napi.example.com ';
  harness.element('save-settings').click(); await flush();
  const sent = JSON.parse(JSON.stringify(request.projectDefaults));
  assert.equal(sent.agents.claude.permissionMode, 'auto');
  assert.equal(sent.agents.claude.attribution, 'shown');
  assert.equal(sent.agents.claude.options.model, 'claude-retired-1');
  assert.equal(sent.agents.claude.options.appendSystemPrompt, 'Use Turkish.');
  assert.deepEqual(sent.agents.codex, { boundary: 'workspace', options: { model: 'gpt-6-luna', reasoningEffort: 'xhigh' } });
  assert.deepEqual(sent.network, { publicInternet: false, hosts: { packageManagers: true, additional: ['b.example.com', 'api.example.com'] } });
  assert.match(harness.element('settings-status').textContent, /Settings saved/);
});

test('an external settings change keeps edited project defaults and updates the others', async t => {
  const harness = await interfaceHarness({ save_settings: saved });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  harness.element('default-network-package-managers').checked = true;
  const changed = { ...settings, projectDefaults: { agents: { claude: { permissionMode: 'manual', attribution: 'hidden', options: { model: null, effort: null, fallbackModel: null, appendSystemPrompt: null } }, codex: { boundary: 'brig', options: { model: null, reasoningEffort: null } } }, network: { publicInternet: true, hosts: { packageManagers: false, additional: [] } } } };
  harness.handlers.load_settings = () => changed;
  await harness.listeners.get('records-changed')({ payload: ['settings'] }); await flush();
  assert.equal(harness.element('default-network-package-managers').checked, true);
  assert.equal(harness.element('default-network-public-internet').checked, true);
  assert.equal(harness.element('default-claude-auto-mode').checked, false);
});

test('an invalid resource value clears the previous save result and opens Resources', async t => {
  const harness = await interfaceHarness({ save_settings: saved });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  harness.element('settings-navigation').click(); await flush();
  harness.element('settings-tab-agents').click();
  const save = harness.element('save-settings');
  const cpuCount = harness.element('cpu-count');
  const status = harness.element('settings-status');
  save.click(); await flush();
  assert.equal(status.textContent, 'Settings saved.');
  cpuCount.value = '0';
  save.click();
  assert.equal(harness.element('settings-panel-resources').hidden, false);
  assert.equal(harness.element('settings-tab-resources').getAttribute('aria-current'), 'true');
  assert.equal(harness.dom.window.document.activeElement, cpuCount);
  assert.equal(status.textContent, '');
  assert.equal(harness.calls.filter(call => call.command === 'save_settings').length, 1);
  cpuCount.value = '2';
  save.click(); await flush();
  const saves = harness.calls.filter(call => call.command === 'save_settings');
  assert.equal(saves.length, 2);
  assert.equal(saves[1].args.settings.cpus, 2);
  assert.equal(status.textContent, 'Settings saved.');
});
