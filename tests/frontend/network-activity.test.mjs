import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, flush, interfaceHarness, plan, project } from './frontend-harness.mjs';

const second = { ...project, id: 'project-b', environmentId: 'b'.repeat(32), name: 'Stopped project', stage: 'ready' };
const sample = {
  time: 1795592523000, direction: 'outgoing', origin: 'codex', process: 'curl', pid: 412,
  endpoint: '203.0.113.8:443', protocol: 'tcp', result: 'blocked', sent: 0, received: 0,
};

test('network history displays saved pages for a stopped project and returns focus', async t => {
  const before = [sample.time, 5];
  const harness = await interfaceHarness({
    recent_projects: () => [second],
    open_project: () => second,
    read_project_network_activity: args => {
      assert.equal(args.identifier, second.id);
      assert.equal(args.environmentId, second.environmentId);
      if (args.before) {
        assert.deepEqual([...args.before], before);
        return { rows: [sample], next: null, incomplete: true };
      }
      return { rows: [{ ...sample, time: sample.time + 1000, direction: 'incoming', origin: null,
        process: 'server', pid: null, endpoint: '127.0.0.1:41234', result: 'connected', sent: 1200, received: null }],
      next: before, incomplete: true };
    },
  });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  harness.element('recent-project-list').querySelector('[data-project-id="project-b"]').click();
  await flush();

  const button = harness.element('open-network-activity');
  assert.equal(harness.element('workspace-status-bar').lastElementChild, button);
  assert.equal(button.closest('[hidden]'), null);
  button.click();
  assert.match(harness.element('network-activity-status').textContent, /Loading/);
  await flush();

  const dialog = harness.element('network-activity-dialog');
  const rows = () => [...dialog.querySelectorAll('tbody tr')].map(row => [...row.cells].slice(1).map(cell => cell.textContent));
  assert.equal(dialog.hidden, false);
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'network-activity-heading');
  assert.ok(button.closest('[inert]'));
  assert.equal(harness.dom.window.document.activeElement, harness.element('close-network-activity'));
  assert.equal(harness.element('network-activity-project').textContent, second.name);
  assert.equal(harness.element('network-activity-incomplete').hidden, false);
  assert.deepEqual(rows(), [['Incoming', 'Unknown', 'server', '127.0.0.1:41234', 'TCP', 'Connected', '1.2 KB', '—']]);
  harness.element('older-network-activity').click();
  await flush();
  assert.equal(harness.element('older-network-activity').hidden, true);
  assert.deepEqual(rows()[1], ['Outgoing', 'Codex', 'curl (412)', '203.0.113.8:443', 'TCP', 'Blocked by policy', '0 B', '0 B']);
  assert.doesNotMatch(dialog.textContent, /SYNTHETIC_TUGBOAT_API_BODY_81F7A2B3/);
  const key = (value, options = {}) => harness.dom.window.document.activeElement.dispatchEvent(
    new harness.dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }),
  );
  harness.element('close-network-activity').focus();
  key('Tab', { shiftKey: true });
  assert.equal(harness.dom.window.document.activeElement, harness.element('refresh-network-activity'));
  key('Escape');
  assert.equal(dialog.hidden, true);
  assert.equal(button.closest('[inert]'), null);
  assert.equal(harness.dom.window.document.activeElement, button);
});

test('a project switch discards pending network activity and the next project can retry', async t => {
  const previous = deferred();
  let count = 0;
  const harness = await interfaceHarness({
    recent_projects: () => [project, second],
    open_project: ({ identifier }) => identifier === project.id ? project : second,
    read_project_network_activity: ({ identifier }) => {
      if (identifier === project.id) return previous.promise;
      if (++count === 1) throw new Error('Private storage detail');
      return { rows: [], next: null, incomplete: false };
    },
  });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  const open = async id => {
    harness.element('recent-project-list').querySelector('[data-project-id="' + id + '"]').click();
    await flush();
    harness.element('open-network-activity').click();
  };
  await open(project.id);
  harness.element('project-navigation').click();
  await flush();
  await open(second.id);
  await flush();
  const status = harness.element('network-activity-status');
  assert.match(status.textContent, /Could not read/);
  assert.doesNotMatch(status.textContent, /Private storage detail/);
  previous.resolve({ rows: [sample], next: null, incomplete: false });
  await flush();
  assert.equal(harness.element('network-activity-dialog').querySelectorAll('tbody tr').length, 0);
  assert.match(status.textContent, /Could not read/);
  harness.element('refresh-network-activity').click();
  await flush();
  assert.match(status.textContent, /No network activity has been recorded/);
});


test('the project status bar gives progress priority and restores the latest matching flow', async t => {
  const checking = deferred();
  const harness = await interfaceHarness({
    recent_projects: () => [project, second],
    open_project: ({ identifier }) => identifier === project.id ? project : second,
    preview_project: ({ identifier }) => identifier === project.id
      ? checking.promise
      : { project: second, plan, fingerprint: 'plan-b' },
  });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  const bar = harness.element('workspace-status-bar');
  const status = harness.element('workspace-status-text');
  const button = harness.element('open-network-activity');
  assert.equal(bar.hidden, true);
  const select = async id => {
    harness.element('recent-project-list').querySelector('[data-project-id="' + id + '"]').click();
    await flush();
  };
  await select(project.id);
  assert.equal(bar.hidden, false);
  assert.equal(button.hidden, false);
  assert.match(status.textContent, /execution plan/i);
  const arrival = harness.listeners.get('network-activity-recorded');
  const event = (value, owner = project) => arrival({ payload: {
    projectId: owner.id, environmentId: owner.environmentId, activity: value,
  } });
  await event(sample);
  assert.match(status.textContent, /execution plan/i);
  checking.resolve({ project, plan, fingerprint: 'plan-a' });
  await flush();
  assert.equal(status.textContent, 'Blocked by policy · 203.0.113.8:443');
  assert.match(status.title, /Outgoing TCP.*Blocked by policy/);
  await event({ ...sample, endpoint: '192.0.2.9:53', protocol: 'udp', result: 'forwarded' });
  await event({ ...sample, endpoint: '192.0.2.200:443' }, second);
  await event({ ...sample, endpoint: '192.0.2.150:443' }, { ...project, environmentId: second.environmentId });
  assert.equal(status.textContent, 'Outgoing UDP · 192.0.2.9:53');
  assert.match(status.title, /Outgoing UDP.*192.0.2.9:53.*Forwarded/);
  assert.equal(harness.element('network-activity-dialog').hidden, true);

  harness.element('project-navigation').click();
  await flush();
  assert.equal(bar.hidden, true);
  await select(second.id);
  await event(sample);
  assert.equal(status.textContent, '');
  assert.equal(status.title, '');
  assert.equal(bar.hidden, false);
});
