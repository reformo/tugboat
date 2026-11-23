import assert from 'node:assert/strict';
import test from 'node:test';
import { flush, interfaceHarness, project } from './frontend-harness.mjs';

const defaultHosts = ['api.anthropic.com', 'chatgpt.com'];
const policy = (access, overrides = {}) => ({ document: { spec: {} }, fingerprint: 'policy-' + JSON.stringify(access), editable: true, attached: true, access, defaultHosts, publicInternetRestricted: false, ...overrides });
const closed = { publicInternet: false, hosts: { packageManagers: false, additional: [] } };

async function setup(t, commands) {
  const harness = await interfaceHarness(commands);
  t.after(() => harness.dom.window.close());
  await harness.ready;
  harness.element('choose-folder').click(); await flush();
  harness.element('project-settings-button').click(); await flush();
  return harness;
}

function pane(harness, id) {
  harness.element('project-settings-dialog').querySelector(`[data-settings-pane="${id}"]`).click();
}

function toggle(harness, id) {
  const choice = harness.element(id);
  choice.checked = !choice.checked;
  choice.dispatchEvent(new harness.dom.window.Event('change'));
}

test('the left menu shows one section at a time and opens on the overview', async t => {
  const harness = await setup(t, { read_project_policy: () => policy(closed), read_agent_settings: () => ({ claude: { permissionMode: 'auto', attribution: 'hidden' }, codex: { boundary: 'brig' } }) });
  const panes = [...harness.element('project-settings-dialog').querySelectorAll('.settings-pane')];
  const tabs = [...harness.element('project-settings-dialog').querySelectorAll('[data-settings-pane]')];
  assert.deepEqual(tabs.map(tab => tab.textContent), ['Overview', 'General', 'Agents', 'Network', 'GitHub', 'Web preview', 'Guest image', 'Environment']);
  assert.deepEqual(panes.filter(item => item.open).map(item => item.id), ['project-setup-overview']);
  assert.equal(tabs[0].getAttribute('aria-current'), 'true');
  pane(harness, 'project-network-settings'); await flush();
  assert.deepEqual(panes.filter(item => item.open).map(item => item.id), ['project-network-settings']);
  assert.equal(tabs[3].getAttribute('aria-current'), 'true');
  assert.equal(tabs[0].getAttribute('aria-current'), 'false');
  harness.element('project-github-access').open = true; await flush();
  assert.deepEqual(panes.filter(item => item.open).map(item => item.id), ['project-github-access']);
  assert.equal(tabs[4].getAttribute('aria-current'), 'true');
  harness.element('close-project-settings').click(); await flush();
  harness.element('project-settings-button').click(); await flush();
  assert.deepEqual(panes.filter(item => item.open).map(item => item.id), ['project-setup-overview']);
});

test('opening Network reads the policy and shows the three access options', async t => {
  const access = { publicInternet: false, hosts: { packageManagers: true, additional: ['api.example.com', 'cdn.example.com'] } };
  const harness = await setup(t, { read_project_policy: () => policy(access) });
  assert.equal(harness.calls.some(call => call.command === 'read_project_policy'), false);
  pane(harness, 'project-network-settings'); await flush();
  const request = harness.calls.find(call => call.command === 'read_project_policy');
  assert.equal(request.args.identifier, project.id);
  assert.equal(request.args.environmentId, project.environmentId);
  assert.equal(harness.element('network-public-internet').checked, false);
  assert.equal(harness.element('network-package-managers').checked, true);
  assert.equal(harness.element('network-domains-summary').textContent, 'api.example.com, cdn.example.com');
  assert.equal(harness.element('project-policy-hosts').value, 'api.example.com\ncdn.example.com');
  assert.match(harness.element('network-default-hosts').textContent, /api\.anthropic\.com, chatgpt\.com/);
  for (const id of ['network-public-internet', 'network-package-managers', 'edit-network-domains']) assert.equal(harness.element(id).disabled, false);
  assert.equal(harness.element('project-policy-fields').disabled, false);
});

test('each switch and the domain editor save the complete requested access', async t => {
  let current = closed;
  const requests = [];
  const harness = await setup(t, {
    read_project_policy: () => policy(current),
    change_project_policy: ({ action, access, fingerprint }) => {
      assert.equal(action, 'save');
      assert.equal(fingerprint, 'policy-' + JSON.stringify(current));
      requests.push(access);
      current = access;
      return project;
    },
  });
  pane(harness, 'project-network-settings'); await flush();
  toggle(harness, 'network-public-internet'); await flush();
  toggle(harness, 'network-package-managers'); await flush();
  harness.element('edit-network-domains').click();
  assert.equal(harness.element('network-domains-editor').hidden, false);
  assert.equal(harness.element('edit-network-domains').getAttribute('aria-expanded'), 'true');
  harness.element('project-policy-hosts').value = ' api.example.com\ncdn.example.com, api.example.com \n\n';
  harness.element('save-project-policy').click(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    { publicInternet: true, hosts: { packageManagers: false, additional: [] } },
    { publicInternet: true, hosts: { packageManagers: true, additional: [] } },
    { publicInternet: true, hosts: { packageManagers: true, additional: ['api.example.com', 'cdn.example.com'] } },
  ]);
  assert.equal(harness.element('network-public-internet').checked, true);
  assert.equal(harness.element('network-package-managers').checked, true);
  assert.equal(harness.element('network-domains-summary').textContent, 'api.example.com, cdn.example.com');
  assert.equal(harness.element('network-domains-editor').hidden, true);
  assert.match(harness.element('project-policy-status').textContent, /Review the plan and prepare the environment again/);
});

test('a refused save restores the saved switch and shows the reason', async t => {
  const harness = await setup(t, {
    read_project_policy: () => policy(closed),
    change_project_policy: () => { throw 'Stop the Brig environment before changing its policy.'; },
  });
  pane(harness, 'project-network-settings'); await flush();
  toggle(harness, 'network-public-internet'); await flush();
  assert.equal(harness.element('network-public-internet').checked, false);
  assert.equal(harness.element('network-public-internet').disabled, false);
  assert.match(harness.element('project-policy-status').textContent, /Stop the Brig environment/);
  harness.element('edit-network-domains').click();
  harness.element('project-policy-hosts').value = 'Bad Host';
  harness.element('cancel-network-domains').click();
  assert.equal(harness.element('network-domains-editor').hidden, true);
  assert.equal(harness.element('project-policy-hosts').value, '');
});

test('read-only and restricted policies explain why the options do not apply', async t => {
  let response = policy(null, { editable: false });
  const harness = await setup(t, { read_project_policy: () => response });
  pane(harness, 'project-network-settings'); await flush();
  for (const id of ['network-public-internet', 'network-package-managers', 'edit-network-domains', 'save-project-policy']) assert.equal(harness.element(id).disabled, true);
  assert.match(harness.element('project-policy-status').textContent, /Editing is disabled/);
  response = policy({ ...closed, publicInternet: true }, { publicInternetRestricted: true });
  harness.element('read-project-policy').click(); await flush();
  assert.equal(harness.element('network-public-internet').checked, true);
  assert.match(harness.element('project-policy-status').textContent, /not in effect/);
});

async function setupWith(t, commands, before = async () => {}) {
  const harness = await interfaceHarness({ read_project_policy: () => policy(closed), stop_project: () => project, change_project_policy: () => project, ...commands });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  harness.element('choose-folder').click(); await flush();
  await before(harness);
  harness.element('project-settings-button').click(); await flush();
  pane(harness, 'project-network-settings'); await flush();
  return harness;
}

const commandsAfterRead = harness => harness.calls.map(call => call.command).filter(command => ['project_environment_running', 'stop_project', 'change_project_policy'].includes(command));

test('a change stops a running environment without a question when no process is working', async t => {
  const harness = await setupWith(t, { project_environment_running: () => true });
  toggle(harness, 'network-public-internet'); await flush();
  assert.deepEqual(commandsAfterRead(harness), ['project_environment_running', 'stop_project', 'change_project_policy']);
  assert.equal(harness.element('network-stop-warning').hidden, true);
  assert.match(harness.element('project-policy-status').textContent, /Tugboat stopped the environment\. Policy updated/);
});

test('a change in a stopped environment does not stop it again', async t => {
  const harness = await setupWith(t, {});
  toggle(harness, 'network-package-managers'); await flush();
  assert.deepEqual(commandsAfterRead(harness), ['project_environment_running', 'change_project_policy']);
  assert.doesNotMatch(harness.element('project-policy-status').textContent, /stopped/);
});

test('an idle Codex chat is closed without a question', async t => {
  const harness = await setupWith(t, {}, async current => { current.element('start-codex').click(); await flush(); });
  toggle(harness, 'network-public-internet'); await flush();
  assert.equal(harness.element('network-stop-warning').hidden, true);
  assert.deepEqual(commandsAfterRead(harness), ['stop_project', 'change_project_policy']);
  assert.match(harness.element('project-policy-status').textContent, /closed 1 idle Codex chat/);
});

test('a working process needs confirmation before the environment stops', async t => {
  const harness = await setupWith(t, {}, async current => { current.element('guest-shell').click(); await flush(); });
  const warning = harness.element('network-stop-warning');
  toggle(harness, 'network-public-internet'); await flush();
  assert.equal(warning.hidden, false);
  assert.match(warning.querySelector('[data-stop-list]').textContent, /Guest terminal/);
  assert.deepEqual(commandsAfterRead(harness), []);
  warning.querySelector('[data-stop-cancel]').click(); await flush();
  assert.equal(warning.hidden, true);
  assert.equal(harness.element('network-public-internet').checked, false);
  assert.equal(harness.element('network-public-internet').disabled, false);
  assert.match(harness.element('project-policy-status').textContent, /not applied/);
  assert.deepEqual(commandsAfterRead(harness), []);
  toggle(harness, 'network-public-internet'); await flush();
  warning.querySelector('[data-stop-confirm]').click(); await flush();
  assert.equal(warning.hidden, true);
  assert.deepEqual(commandsAfterRead(harness), ['stop_project', 'change_project_policy']);
});

test('closing the dialog during a confirmation applies nothing', async t => {
  const harness = await setupWith(t, {}, async current => { current.element('guest-shell').click(); await flush(); });
  toggle(harness, 'network-public-internet'); await flush();
  assert.equal(harness.element('network-stop-warning').hidden, false);
  harness.element('close-project-settings').click(); await flush();
  assert.equal(harness.element('network-stop-warning').hidden, true);
  assert.deepEqual(commandsAfterRead(harness), []);
});

test('saving General settings uses the same confirmation for a working process', async t => {
  const harness = await setupWith(t, { save_project_preferences: ({ name }) => ({ ...project, name, stage: 'ready' }) }, async current => { current.element('guest-shell').click(); await flush(); });
  pane(harness, 'project-resources'); await flush();
  harness.element('project-cpus').value = '2';
  harness.element('project-preferences').dispatchEvent(new harness.dom.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
  const warning = harness.element('preferences-stop-warning');
  assert.equal(warning.hidden, false);
  assert.equal(harness.calls.some(call => call.command === 'save_project_preferences'), false);
  warning.querySelector('[data-stop-confirm]').click(); await flush();
  const commands = harness.calls.map(call => call.command);
  assert.ok(commands.includes('stop_project'));
  assert.ok(commands.lastIndexOf('stop_project') < commands.lastIndexOf('save_project_preferences'));
  assert.match(harness.element('project-preferences-status').textContent, /Tugboat stopped the environment\. Project settings saved\./);
});

test('a rename keeps the running environment and its processes', async t => {
  const harness = await setupWith(t, {
    project_environment_running: () => true,
    save_project_preferences: ({ name, options }) => { assert.equal(options.cpus, 4); return { ...project, name }; },
  }, async current => { current.element('guest-shell').click(); await flush(); });
  pane(harness, 'project-resources'); await flush();
  const before = harness.calls.length;
  harness.element('project-name').value = 'Renamed project';
  harness.element('project-preferences').dispatchEvent(new harness.dom.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
  const commands = harness.calls.slice(before).map(call => call.command);
  assert.equal(harness.element('preferences-stop-warning').hidden, true);
  assert.ok(commands.includes('save_project_preferences'));
  for (const command of ['project_environment_running', 'stop_project', 'prepare_project', 'prepare_environment']) assert.equal(commands.includes(command), false, command);
  assert.equal(harness.element('project-heading').textContent, 'Renamed project');
  assert.equal(harness.element('project-preferences-status').textContent, 'Project settings saved.');
});
