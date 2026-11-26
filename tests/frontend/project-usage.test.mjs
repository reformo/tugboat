import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, emptyUsage, flush, interfaceHarness, project } from './frontend-harness.mjs';

function measurement(agentKind, model, effort, input, costUsd) {
  const output = 10;
  return { agentKind, model, effort, usage: { ...emptyUsage, input, output, total: input + output, requests: 1, costUsd: costUsd ?? 0, unpricedRequests: Number(costUsd === null) } };
}

function chartRows(harness) {
  return [...harness.element('project-usage-chart').children].map(row => {
    const [label, track, value] = row.children;
    const width = Number.parseFloat(track.firstElementChild.style.width);
    return [label.textContent, value.textContent, track.hidden ? null : Number(width.toFixed(1))];
  });
}

test('project usage groups recorded measurements and sorts by dimension, tokens, and estimated cost', async t => {
  const harness = await interfaceHarness({ project_usage_breakdown: ({ identifier }) => {
    assert.equal(identifier, project.id);
    return [
      measurement('codex', 'gpt', 'high', 290, null),
      measurement('codex', 'gpt', 'low', 190, 0.01),
      measurement('claude-code', 'claude', null, 390, 0.03),
    ];
  } });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  harness.element('choose-folder').click(); await flush();
  const button = harness.element('open-project-usage');
  assert.equal(button.closest('section').getAttribute('aria-labelledby'), 'project-usage-summary-heading');
  assert.equal(button.hidden, false);
  button.click(); await flush();

  const dialog = harness.element('project-usage-dialog');
  const rows = () => [...dialog.querySelectorAll('tbody tr')].map(row => [...row.cells].map(cell => cell.textContent));
  const select = (id, value) => {
    const field = harness.element(id);
    field.value = value;
    field.dispatchEvent(new harness.dom.window.Event('change'));
  };
  assert.equal(dialog.open, true);
  assert.deepEqual(rows().map(row => [row[0], ...row.slice(-2)]), [['Codex', '500', '$0.01 + unpriced'], ['Claude Code', '400', '$0.03']]);
  assert.deepEqual(chartRows(harness), [['Codex', '55.6%', 55.6], ['Claude Code', '44.4%', 44.4]]);
  select('project-usage-sort', 'cost');
  assert.deepEqual(rows().map(row => row[0]), ['Claude Code', 'Codex']);
  assert.deepEqual(chartRows(harness), [['Claude Code', '44.4%', 44.4], ['Codex', '55.6%', 55.6]]);
  select('project-usage-group', 'model');
  assert.deepEqual(rows().map(row => row[0]), ['claude', 'gpt']);
  assert.deepEqual(chartRows(harness), [['claude', '44.4%', 44.4], ['gpt', '55.6%', 55.6]]);
  select('project-usage-group', 'effort');
  select('project-usage-sort', 'group');
  assert.deepEqual(rows().map(row => [row[0], row.at(-1)]), [['low', '$0.01'], ['high', 'Unavailable'], ['Unknown', '$0.03']]);
  assert.deepEqual(chartRows(harness), [['low', '22.2%', 22.2], ['high', '33.3%', 33.3], ['Unknown', '44.4%', 44.4]]);
  select('project-usage-group', 'all');
  select('project-usage-sort', 'model');
  assert.deepEqual(rows().map(row => row.slice(0, 3)), [['Claude Code', 'claude', 'Unknown'], ['Codex', 'gpt', 'low'], ['Codex', 'gpt', 'high']]);
  assert.deepEqual(chartRows(harness), [['Claude Code · claude · Unknown', '44.4%', 44.4], ['Codex · gpt · low', '22.2%', 22.2], ['Codex · gpt · high', '33.3%', 33.3]]);
  assert.equal(harness.calls.filter(call => call.command === 'project_usage_breakdown').length, 1);
  harness.element('close-project-usage').click();
  assert.equal(dialog.open, false);
  assert.equal(harness.dom.window.document.activeElement, button);
});

test('project usage chart distinguishes partial and unknown totals from measured zero', async t => {
  const harness = await interfaceHarness({ project_usage_breakdown: () => [
    measurement('codex', 'gpt', 'low', 90, 0),
    { agentKind: 'codex', model: null, effort: null, usage: { ...emptyUsage, unmeasuredTurns: 1 } },
    { agentKind: 'claude-code', model: 'claude', effort: 'high', usage: { ...emptyUsage, requests: 1 } },
  ] });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  harness.element('choose-folder').click(); await flush();
  harness.element('open-project-usage').click(); await flush();

  assert.deepEqual(chartRows(harness), [['Codex', '100%', 100], ['Claude Code', '0%', 0]]);
  const group = harness.element('project-usage-group');
  group.value = 'model';
  group.dispatchEvent(new harness.dom.window.Event('change'));
  assert.deepEqual(chartRows(harness), [['gpt', '100%', 100], ['claude', '0%', 0], ['Unknown', 'Unknown', null]]);
});

test('project usage discards a closed dialog response and supports retry after a failed read', async t => {
  const previous = deferred();
  let reads = 0;
  const harness = await interfaceHarness({ project_usage_breakdown: () => {
    reads++;
    if (reads === 1) return previous.promise;
    if (reads === 2) throw 'Records unavailable.';
    return [];
  } });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  harness.element('choose-folder').click(); await flush();
  const button = harness.element('open-project-usage');
  const results = harness.element('project-usage-results');
  assert.ok(results.contains(harness.element('project-usage-chart')));
  button.click();
  assert.equal(results.hidden, true);
  harness.element('close-project-usage').click();
  button.click(); await flush();
  const status = harness.element('project-usage-status');
  assert.match(status.textContent, /Records unavailable/);
  previous.resolve([measurement('codex', 'old-model', 'low', 100, 1)]); await flush();
  assert.equal(results.hidden, true);
  assert.match(status.textContent, /Records unavailable/);
  const retry = harness.element('retry-project-usage');
  assert.equal(retry.hidden, false);
  retry.click(); await flush();
  assert.equal(retry.hidden, true);
  assert.match(status.textContent, /No usage has been recorded/);
  assert.equal(results.hidden, true);
});
