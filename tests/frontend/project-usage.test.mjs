import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, emptyUsage, flush, interfaceHarness, project } from './frontend-harness.mjs';

function measurement(agentKind, model, effort, input, costUsd) {
  const output = 10;
  return { agentKind, model, effort, usage: { ...emptyUsage, input, output, total: input + output, requests: 1, costUsd: costUsd ?? 0, unpricedRequests: Number(costUsd === null) } };
}

function shareRows(harness) {
  return [...harness.element('project-usage-table').tBodies[0].rows].map(row => {
    const label = [...row.querySelectorAll('th')].map(cell => cell.textContent).join(' · ');
    const [track, value] = row.querySelector('.project-usage-share-content').children;
    const width = Number.parseFloat(track.firstElementChild.style.width);
    return [label, value.textContent, track.hidden ? null : Number(width.toFixed(1))];
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
  const headings = () => [...dialog.querySelectorAll('thead th')].map(cell => cell.textContent);
  const groupBy = value => {
    const field = harness.element('project-usage-group');
    field.value = value;
    field.dispatchEvent(new harness.dom.window.Event('change'));
  };
  const sortBy = (value, direction) => {
    dialog.querySelector(`[data-sort-by="${value}"]`).click();
    const sortedColumn = dialog.querySelector('thead [aria-sort]');
    assert.equal(sortedColumn.getAttribute('aria-sort'), direction);
    assert.equal(sortedColumn.firstElementChild.dataset.sortBy, value);
    assert.equal(harness.dom.window.document.activeElement, sortedColumn.firstElementChild);
  };
  assert.equal(dialog.open, true);
  assert.deepEqual(headings(), ['Agent', 'Token share', 'Total tokens', 'Estimated API equivalent']);
  assert.equal(dialog.querySelector('[data-sort-by="tokens"]').parentElement.getAttribute('aria-sort'), 'descending');
  assert.deepEqual(rows().map(row => [row[0], ...row.slice(-2)]), [['Codex', '500', '$0.01 + unpriced'], ['Claude Code', '400', '$0.03']]);
  assert.deepEqual(shareRows(harness), [['Codex', '55.6%', 55.6], ['Claude Code', '44.4%', 44.4]]);
  sortBy('cost', 'descending');
  assert.deepEqual(rows().map(row => row[0]), ['Claude Code', 'Codex']);
  assert.deepEqual(shareRows(harness), [['Claude Code', '44.4%', 44.4], ['Codex', '55.6%', 55.6]]);
  groupBy('model');
  assert.deepEqual(rows().map(row => row[0]), ['claude', 'gpt']);
  assert.deepEqual(shareRows(harness), [['claude', '44.4%', 44.4], ['gpt', '55.6%', 55.6]]);
  groupBy('effort');
  sortBy('effort', 'ascending');
  assert.deepEqual(rows().map(row => [row[0], row.at(-1)]), [['low', '$0.01'], ['high', 'Unavailable'], ['Unknown', '$0.03']]);
  assert.deepEqual(shareRows(harness), [['low', '22.2%', 22.2], ['high', '33.3%', 33.3], ['Unknown', '44.4%', 44.4]]);
  groupBy('all');
  sortBy('model', 'ascending');
  assert.deepEqual(rows().map(row => row.slice(0, 3)), [['Claude Code', 'claude', 'Unknown'], ['Codex', 'gpt', 'low'], ['Codex', 'gpt', 'high']]);
  assert.deepEqual(shareRows(harness), [['Claude Code · claude · Unknown', '44.4%', 44.4], ['Codex · gpt · low', '22.2%', 22.2], ['Codex · gpt · high', '33.3%', 33.3]]);
  const details = harness.element('project-usage-token-details');
  assert.equal(details.checked, false);
  details.click();
  assert.deepEqual(headings().slice(-4), ['Input', 'Cached input', 'Cache writes', 'Output']);
  assert.deepEqual(rows()[0].slice(-4), ['390', '0 (0%)', '0', '10']);
  details.click();
  assert.deepEqual(headings().slice(-3), ['Token share', 'Total tokens', 'Estimated API equivalent']);
  assert.equal(harness.calls.filter(call => call.command === 'project_usage_breakdown').length, 1);
  harness.element('close-project-usage').click();
  assert.equal(dialog.open, false);
  assert.equal(harness.dom.window.document.activeElement, button);
});

test('project usage shares distinguish partial and unknown totals from measured zero', async t => {
  const harness = await interfaceHarness({ project_usage_breakdown: () => [
    measurement('codex', 'gpt', 'low', 90, 0),
    { agentKind: 'codex', model: null, effort: null, usage: { ...emptyUsage, unmeasuredTurns: 1 } },
    { agentKind: 'claude-code', model: 'claude', effort: 'high', usage: { ...emptyUsage, requests: 1 } },
  ] });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  harness.element('choose-folder').click(); await flush();
  harness.element('open-project-usage').click(); await flush();

  assert.deepEqual(shareRows(harness), [['Codex', '100%', 100], ['Claude Code', '0%', 0]]);
  const group = harness.element('project-usage-group');
  group.value = 'model';
  group.dispatchEvent(new harness.dom.window.Event('change'));
  assert.deepEqual(shareRows(harness), [['gpt', '100%', 100], ['claude', '0%', 0], ['Unknown', 'Unknown', null]]);
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
  assert.ok(results.contains(harness.element('project-usage-table')));
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

test('project usage filters local calendar days and resets to all time when reopened', async t => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  t.after(() => {
    if (previousZone === undefined) {
      delete process.env.TZ;
      return;
    }
    process.env.TZ = previousZone;
  });
  const previous = deferred();
  const customStart = Date.parse('2026-03-08T08:00:00Z');
  const harness = await interfaceHarness({ project_usage_breakdown: ({ dateRange }) => {
    if (dateRange?.startMilliseconds === customStart) return [];
    if (dateRange) return previous.promise;
    return [measurement('codex', 'gpt', 'low', 90, 0)];
  } });
  t.after(() => harness.dom.window.close());
  await harness.ready;
  harness.element('choose-folder').click(); await flush();
  const button = harness.element('open-project-usage');
  const range = harness.element('project-usage-date-range');
  const form = harness.element('project-usage-custom-dates');
  const start = harness.element('project-usage-start-date');
  const end = harness.element('project-usage-end-date');
  const status = harness.element('project-usage-status');
  const summary = harness.element('project-usage-date-summary');
  const calls = () => harness.calls.filter(call => call.command === 'project_usage_breakdown');
  const select = value => {
    range.value = value;
    range.dispatchEvent(new harness.dom.window.Event('change'));
  };

  button.click(); await flush();
  assert.equal(range.value, 'all-time');
  assert.equal(form.hidden, true);
  assert.equal(calls().at(-1).args.dateRange, null);

  const today = new Date();
  const localDay = day => new Date(today.getFullYear(), today.getMonth(), day).getTime();
  const day = today.getDate();
  for (const [preset, firstDay] of [['today', day], ['last-7-days', day - 6], ['last-30-days', day - 29], ['this-month', 1]]) {
    select(preset);
    assert.deepEqual({ ...calls().at(-1).args.dateRange }, {
      startMilliseconds: localDay(firstDay), endExclusiveMilliseconds: localDay(day + 1),
    });
  }

  select('custom');
  assert.equal(form.hidden, false);
  start.value = '2026-03-08';
  start.dispatchEvent(new harness.dom.window.Event('input'));
  end.value = '2026-03-07';
  form.requestSubmit();
  assert.equal(end.validity.rangeUnderflow, true);
  assert.equal(calls().length, 5);

  end.value = '2026-03-08';
  form.requestSubmit(); await flush();
  assert.deepEqual({ ...calls().at(-1).args.dateRange }, {
    startMilliseconds: customStart, endExclusiveMilliseconds: Date.parse('2026-03-09T07:00:00Z'),
  });
  assert.match(summary.textContent, /Mar 8, 2026 · America\/Los_Angeles/);
  assert.match(status.textContent, /No usage has been recorded in this date range/);
  previous.resolve([measurement('codex', 'earlier-filter', 'low', 190, 0)]); await flush();
  assert.match(status.textContent, /No usage has been recorded in this date range/);
  assert.equal(harness.element('project-usage-results').hidden, true);

  select('all-time'); await flush();
  assert.equal(calls().at(-1).args.dateRange, null);
  assert.equal(harness.element('project-usage-results').hidden, false);
  select('today'); await flush();
  harness.element('close-project-usage').click();
  button.click(); await flush();
  assert.equal(range.value, 'all-time');
  assert.equal(calls().at(-1).args.dateRange, null);
  select('custom');
  assert.equal(start.value, '');
  assert.equal(end.value, '');
  assert.equal(form.checkValidity(), false);
});
