import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { root, flush, deferred, project, plan, interfaceHarness } from './frontend-harness.mjs';

test('Help opens the complete bundled user guide and supports view navigation', async () => {
  const harness = await interfaceHarness();
  await harness.ready;
  const document = harness.dom.window.document;
  const help = harness.element('help-view');
  const footer = document.querySelector('.sidebar-footer');
  assert.deepEqual([...footer.querySelectorAll('.navigation-item')].map(button => button.id), ['help-navigation', 'settings-navigation']);
  assert.equal(help.hidden, true);
  harness.element('help-navigation').click(); await flush();
  assert.equal(help.hidden, false);
  assert.equal(harness.element('project-view').hidden, true);
  assert.equal(harness.element('settings-view').hidden, true);
  assert.equal(harness.element('help-navigation').getAttribute('aria-current'), 'page');
  assert.equal(harness.element('project-navigation').hasAttribute('aria-current'), false);
  assert.equal(document.activeElement, harness.element('help-heading'));
  const guide = new harness.dom.window.DOMParser().parseFromString(fs.readFileSync(root + 'docs/user-guide.html', 'utf8'), 'text/html');
  const sourceSections = [...guide.querySelectorAll('main > section')];
  const articles = [...help.querySelectorAll('#help-articles > section')];
  assert.deepEqual(articles.map(article => [article.id, article.textContent]), sourceSections.map(section => [section.id, section.textContent]));
  const topics = [...help.querySelectorAll('#help-topics a')].map(link => link.hash);
  assert.deepEqual(topics.sort(), sourceSections.map(section => '#' + section.id).sort());
  assert.equal(harness.element('help-index').hidden, false);
  assert.equal(harness.element('help-articles').hidden, true);
  assert.equal(harness.element('help-all-topics').hidden, true);
  const links = [...help.querySelectorAll('a')];
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.ok(link.getAttribute('href').startsWith('#'));
    assert.ok(help.contains(document.getElementById(link.hash.slice(1))), 'Missing guide section: ' + link.hash);
  }
  const identifiers = [...document.querySelectorAll('[id]')].map(element => element.id);
  assert.equal(new Set(identifiers).size, identifiers.length);
  harness.element('settings-navigation').click(); await flush();
  assert.equal(help.hidden, false);
  assert.equal(harness.element('settings-view').hidden, false);
  assert.equal(harness.element('help-navigation').getAttribute('aria-current'), 'page');
  assert.equal(document.activeElement, harness.element('settings-heading'));
  assert.equal(help.hasAttribute('inert'), true);
  harness.element('project-navigation').click(); await flush();
  assert.equal(harness.element('settings-view').hidden, true);
  assert.equal(help.hidden, true);
  assert.equal(harness.element('project-view').hidden, false);
  assert.equal(harness.element('project-navigation').getAttribute('aria-current'), 'page');
  harness.dom.window.close();
});

test('Help searches guide text and returns from linked articles to the filtered index', async t => {
  const harness = await interfaceHarness();
  const { document, Event } = harness.dom.window;
  t.after(() => harness.dom.window.close());
  await harness.ready;
  harness.element('help-navigation').click();
  const search = harness.element('help-search');
  const topics = harness.element('help-topics');
  const articles = harness.element('help-articles');
  const back = harness.element('help-all-topics');
  const workspace = harness.element('help-view').closest('main');
  const visibleTopics = () => [...topics.querySelectorAll('li:not([hidden]) a')];
  const visibleArticles = () => [...articles.querySelectorAll(':scope > section:not([hidden])')].map(article => article.id);
  const searchFor = value => { search.value = value; search.dispatchEvent(new Event('input')); };

  searchFor('no-such-help-topic');
  assert.equal(visibleTopics().length, 0);
  assert.match(harness.element('help-search-status').textContent, /No topics match/);
  searchFor('  GATEKEEPER  ');
  const [troubleshooting] = visibleTopics();
  assert.deepEqual(visibleTopics().map(link => link.hash), ['#troubleshooting']);
  assert.equal(harness.element('help-search-status').textContent, '1 topic found.');

  workspace.scrollTop = 120;
  troubleshooting.click();
  assert.equal(harness.element('help-index').hidden, true);
  assert.equal(articles.hidden, false);
  assert.equal(back.hidden, false);
  assert.deepEqual(visibleArticles(), ['troubleshooting']);
  assert.equal(document.activeElement, harness.element('troubleshooting').querySelector('h2'));
  articles.querySelector('a[href="#fix-operations"]').click();
  assert.equal(document.activeElement, harness.element('fix-operations'));
  articles.querySelector('a[href="#settings"]').click();
  assert.deepEqual(visibleArticles(), ['settings']);
  assert.equal(document.activeElement, harness.element('settings').querySelector('h2'));

  workspace.scrollTop = 400;
  back.click();
  assert.equal(articles.hidden, true);
  assert.equal(harness.element('help-index').hidden, false);
  assert.equal(search.value, '  GATEKEEPER  ');
  assert.equal(workspace.scrollTop, 120);
  assert.equal(document.activeElement, troubleshooting);
  searchFor('');
  assert.equal(visibleTopics().length, articles.children.length);
});

test('a late project check keeps Help visible and retains the selected project', async () => {
  const checking = deferred();
  const harness = await interfaceHarness({ preview_project: () => checking.promise });
  await harness.ready; harness.element('choose-folder').click(); await flush();
  harness.element('help-navigation').click(); await flush();
  assert.equal(harness.element('workspace-status-bar').hidden, true);
  checking.resolve({ project, plan, fingerprint: 'plan-a' }); await flush();
  assert.equal(harness.element('help-view').hidden, false);
  assert.equal(harness.element('help-navigation').getAttribute('aria-current'), 'page');
  assert.equal(harness.dom.window.document.activeElement, harness.element('help-heading'));
  harness.element('sidebar-current-project').click(); await flush();
  assert.equal(harness.element('help-view').hidden, true);
  assert.equal(harness.element('project-view').hidden, false);
  assert.equal(harness.element('project-heading').textContent, project.name);
  assert.equal(harness.calls.filter(call => call.command === 'register_project').length, 1);
  harness.dom.window.close();
});

test('Help hides the native terminal surface and returns to the same running chat', async () => {
  const harness = await interfaceHarness();
  await harness.ready; harness.element('choose-folder').click(); await flush();
  harness.element('start-codex').click(); await flush();
  const identifier = harness.calls.find(call => call.command === 'terminal_focus').args.identifier;
  harness.element('help-navigation').click(); await flush();
  assert.equal(harness.element('help-view').hidden, false);
  assert.equal(harness.terminals.get(identifier).running, true);
  assert.equal(harness.calls.filter(call => call.command === 'terminal_layout').at(-1).args.layout.visible, false);
  assert.equal(harness.calls.filter(call => call.command === 'terminal_close').length, 0);
  harness.element('sidebar-session-list').querySelector('.sidebar-session').click(); await flush();
  assert.equal(harness.element('help-view').hidden, true);
  assert.equal(harness.element('terminal-panel').hidden, false);
  assert.equal(harness.calls.filter(call => call.command === 'terminal_layout').at(-1).args.layout.visible, true);
  assert.equal(harness.calls.filter(call => call.command === 'terminal_focus').at(-1).args.identifier, identifier);
  assert.equal(harness.calls.filter(call => call.command === 'start_agent_session').length, 1);
  harness.dom.window.close();
});
