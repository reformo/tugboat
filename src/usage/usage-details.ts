import type { AgentUsageDetails, ConversationUsageDetails, PromptUsage, RequestRef, RequestUsage, TurnRef, TurnUsage, UsageSummary } from './usage-types';
import { cachedCount, cachePercentage, cacheWrites, count, emptyUsage, renderMoney, summaryText, usageCount } from './usage-format';

function identity(kind: string, ...parts: string[]): string { return 'usage-' + kind + '-' + parts.map(part => encodeURIComponent(part)).join(':'); }
function requestIdentity(ref: RequestRef): string { return identity('request', ref.sessionId, ref.turnId, ref.requestKey); }
function turnIdentity(ref: TurnRef): string { return identity('turn', ref.sessionId, ref.turnId); }
function agentName(agent: AgentUsageDetails): string {
  return agent.title + (agent.lineage.nickname && agent.lineage.nickname !== agent.title ? ' · ' + agent.lineage.nickname : '') + (agent.lineage.agentPath ? ' · ' + agent.lineage.agentPath : '');
}
function note(text: string, className = 'support-text'): HTMLParagraphElement {
  const paragraph = document.createElement('p'); paragraph.className = className; paragraph.textContent = text; return paragraph;
}
function appendDetail(cell: HTMLTableCellElement, text: string): void {
  const detail = document.createElement('small'); detail.textContent = text; cell.append(detail);
}
function oldCost(value: number | null): string { return value === null ? 'unpriced' : '$' + value.toFixed(6); }

function appendRequestRow(body: HTMLTableSectionElement, request: RequestUsage, sessionId: string, turnId: string): void {
  const row = body.insertRow();
  row.id = requestIdentity({ sessionId, turnId, requestKey: request.key }); row.tabIndex = -1; row.dataset.usageFocusKey = row.id;
  const model = document.createElement('th'); model.scope = 'row'; model.textContent = request.model ?? 'Unknown model'; row.append(model);
  const tokens = request.tokens;
  const cached = (tokens.cachedKnown ?? tokens.cacheKnown) === false ? 'Unknown' : count(tokens.cached) + ' (' + cachePercentage(tokens.cached, tokens.input) + ')';
  const writes = (tokens.cacheWriteKnown ?? tokens.cacheKnown) === false ? 'Unknown' : count(tokens.cacheWrite);
  for (const value of [count(tokens.input), cached, writes, count(tokens.output)]) row.insertCell().textContent = value;
  if (request.anthropic?.cacheCreation) {
    const split = request.anthropic.cacheCreation;
    appendDetail(row.cells[3], count(split.ephemeral5mInputTokens) + ' at 5 minutes · ' + count(split.ephemeral1hInputTokens) + ' at 1 hour');
  }
  const cost = row.insertCell();
  const anthropic = request.rates?.anthropic;
  cost.textContent = request.costUsd === null ? 'Unpriced' : '$' + request.costUsd.toFixed(6) + (anthropic?.assumptions.length ? ' (estimate)' : '') + (request.partial ? ' (partial)' : '');
  if (request.costUsd === null && request.unpricedReason) appendDetail(cost, request.unpricedReason);
  if (request.rates) {
    appendDetail(model, request.rates.tier + ' tier' + (request.rates.tierAssumed ? ' (assumed)' : ''));
    const rateDate = document.createElement('time'); rateDate.dateTime = request.rates.date; rateDate.textContent = 'Rates ' + request.rates.date; rateDate.title = request.rates.source; cost.append(rateDate);
    if (anthropic) {
      appendDetail(model, anthropic.speed + ' speed · ' + anthropic.inferenceGeo + ' inference');
      for (const assumption of anthropic.assumptions) appendDetail(cost, assumption);
      const verifiedSource = request.rates.source === 'https://platform.claude.com/docs/en/about-claude/pricing';
      if (verifiedSource) {
        const source = document.createElement('a'); source.href = request.rates.source; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 'Anthropic rates ' + request.rates.date; source.title = 'Anthropic pricing source'; rateDate.replaceChildren(source);
      }
      if (!verifiedSource) appendDetail(cost, 'Pricing source: ' + request.rates.source);
    }
    if (request.rates.longContext) appendDetail(cost, anthropic ? 'Recorded rates for prompts over 100,000 input tokens' : 'Recorded long-context rates');
  }
  if (request.serviceTier) appendDetail(model, 'Recorded service tier: ' + request.serviceTier + (request.tierSource ? ' · ' + request.tierSource : ''));
  if (request.rateCorrection) appendDetail(cost, 'Rate correction: ' + request.rateCorrection.reason + ' Previous ' + request.rateCorrection.previousRates.tier + ' rates ' + request.rateCorrection.previousRates.date + ': ' + oldCost(request.rateCorrection.previousCostUsd) + '. Original rate date retained.');
  if (request.amountCorrection) {
    const previous = request.amountCorrection;
    appendDetail(cost, 'Amount correction: ' + previous.reason + ' Previous ' + count(previous.previousTokens.input) + ' input, ' + count(previous.previousTokens.output) + ' output; ' + oldCost(previous.previousCostUsd) + (previous.previousPartial ? ' (partial)' : '') + (previous.previousUnpricedReason ? ' · ' + previous.previousUnpricedReason : '') + '.');
  }
  for (const correction of request.anthropicCorrections ?? []) appendDetail(cost, 'Billing metadata correction: ' + correction.reason + ' Previous model: ' + (correction.previousModel ?? 'unknown') + '; ' + oldCost(correction.previousCostUsd) + (correction.previousRates ? '; rates ' + correction.previousRates.date : '') + '.');
  if (request.source) {
    const source = request.source;
    model.title = [source.guestNamespace, source.modelProvider, source.originThreadId, source.originTurnId ?? 'Source turn unassigned', source.rootTurnId ?? 'Root prompt unassigned', source.responseId, request.key].join('\n');
  }
}

function requestLink(ref: RequestRef | TurnRef, agents: AgentUsageDetails[]): HTMLAnchorElement {
  const isRequest = 'requestKey' in ref;
  const id = isRequest ? requestIdentity(ref) : turnIdentity(ref);
  const link = document.createElement('a'); link.href = '#' + encodeURIComponent(id); link.dataset.usageFocusKey = identity('source', id);
  const agent = agents.find(agent => agent.sessionId === ref.sessionId)!;
  const turnIndex = agent.turns.findIndex(turn => turn.id === ref.turnId);
  const requestIndex = isRequest ? agent.turns[turnIndex].requests.findIndex(request => request.key === ref.requestKey) : -1;
  link.textContent = (agent.lineage.kind === 'primary' ? 'Main agent' : agentName(agent)) + ' · agent turn ' + (turnIndex + 1) + (isRequest ? ' · request ' + (requestIndex + 1) : ' · unmeasured');
  link.title = ref.turnId + (isRequest ? '\n' + ref.requestKey : ' · unmeasured turn') + '\n' + agentName(agent);
  link.addEventListener('click', event => {
    const target = document.getElementById(id); if (!target) return;
    event.preventDefault();
    let disclosure = target.querySelector<HTMLDetailsElement>('details.usage-turn') ?? target.closest('details');
    while (disclosure) { disclosure.open = true; disclosure = disclosure.parentElement?.closest('details') ?? null; }
    target.focus({ preventScroll: true }); target.scrollIntoView?.({ block: 'nearest' });
  });
  return link;
}
function appendReferences(section: HTMLElement, refs: RequestRef[], turns: TurnRef[], agents: AgentUsageDetails[]): void {
  if (!refs.length && !turns.length) return;
  section.append(note('Source references', 'support-text usage-source-heading'));
  const list = document.createElement('ul'); list.className = 'usage-source-list';
  for (const ref of [...refs, ...turns]) { const item = document.createElement('li'); item.append(requestLink(ref, agents)); list.append(item); }
  section.append(list);
}
function appendPromptAttribution(section: HTMLElement, prompt: PromptUsage, details: ConversationUsageDetails): void {
  if (details.agents.length > 1) {
    section.append(note('Subagents: ' + summaryText(prompt.descendantsUsage), 'support-text prompt-attribution'));
    section.append(note('Combined: ' + summaryText(prompt.combinedUsage), 'support-text prompt-attribution'));
  }
  appendReferences(section, prompt.requestRefs, prompt.unmeasuredTurnRefs, details.agents);
}

function turnSection(turn: TurnUsage, index: number, agent: AgentUsageDetails, promptLabel: boolean): HTMLElement {
  const template = document.querySelector<HTMLTemplateElement>('#prompt-usage-template')!;
  const fragment = document.importNode(template.content, true);
  const section = fragment.querySelector('section')!;
  section.id = turnIdentity({ sessionId: agent.sessionId, turnId: turn.id }); section.tabIndex = -1; section.dataset.agentTurn = agent.sessionId; section.dataset.usageFocusKey = section.id;
  const disclosure = section.querySelector('details')!;
  disclosure.dataset.usageDisclosureKey = section.id;
  const summary = disclosure.querySelector('summary')!; summary.dataset.usageFocusKey = section.id + '-summary';
  const heading = summary.querySelector<HTMLElement>('.usage-turn-heading')!;
  heading.id = identity('heading', agent.sessionId, turn.id);
  heading.textContent = (promptLabel ? 'Prompt ' : 'Agent turn ') + (index + 1) + ' · ' + turn.status;
  section.setAttribute('aria-labelledby', heading.id);
  const requestCount = summary.querySelector('.usage-turn-count')!;
  requestCount.textContent = turn.requests.length ? quantity(turn.requests.length, 'request') : 'No measured requests';
  if (!turn.requests.length) {
    section.querySelector('.table-scroll')!.remove();
    section.querySelector('.usage-disclosure-body')!.append(note('No request usage was recorded for this ' + (promptLabel ? 'prompt' : 'agent turn') + '. Token counts and the estimated API equivalent are unknown.'));
    return section;
  }
  const table = section.querySelector('table')!; table.setAttribute('aria-labelledby', heading.id);
  const scroll = section.querySelector<HTMLElement>('.table-scroll')!; scroll.setAttribute('aria-labelledby', heading.id); scroll.dataset.usageFocusKey = section.id + '-table';
  const usage = { ...emptyUsage, requests: turn.requests.length };
  for (const request of turn.requests) {
    appendRequestRow(table.tBodies[0], request, agent.sessionId, turn.id);
    if (request.costUsd === null) usage.unpricedRequests++;
    else usage.costUsd += request.costUsd;
  }
  const total = summary.querySelector<HTMLElement>('.usage-turn-total')!;
  total.title = 'Estimated API equivalent for recorded requests in this turn';
  renderMoney(total, usage);
  return section;
}

function usageDisclosure(label: string, key: string): HTMLDetailsElement {
  const disclosure = document.createElement('details');
  disclosure.className = 'usage-disclosure';
  disclosure.dataset.usageDisclosureKey = key;
  const summary = document.createElement('summary'); summary.textContent = label; summary.dataset.usageFocusKey = key + '-summary';
  disclosure.append(summary);
  return disclosure;
}

function sessionTotals(usage: UsageSummary): DocumentFragment {
  const totals = document.createElement('dl'); totals.className = 'session-usage-totals'; totals.setAttribute('aria-label', 'Total recorded session usage');
  const breakdownValues = document.createElement('dl'); breakdownValues.className = 'session-token-breakdown-values';
  const metrics: [HTMLDListElement, string, string | null][] = [
    [totals, 'Total tokens', usageCount(usage, 'total')],
    [totals, 'Estimated API equivalent', null],
    [breakdownValues, 'Input', usageCount(usage, 'input')],
    [breakdownValues, 'Cached input', cachedCount(usage)],
    [breakdownValues, 'Cache writes', cacheWrites(usage)],
    [breakdownValues, 'Output', usageCount(usage, 'output')],
  ];
  for (const [list, label, value] of metrics) {
    const term = document.createElement('dt'); term.textContent = label;
    const amount = document.createElement('dd'); amount.textContent = value;
    if (value === null) renderMoney(amount, usage);
    const field = document.createElement('div'); field.append(term, amount); list.append(field);
  }
  const breakdown = usageDisclosure('Token breakdown', 'session-token-breakdown');
  breakdown.classList.add('session-token-breakdown');
  breakdown.open = true;
  breakdown.append(breakdownValues);
  const summary = document.createDocumentFragment(); summary.append(totals, breakdown);
  return summary;
}

function scopeTable(details: ConversationUsageDetails, selected: AgentUsageDetails): HTMLElement {
  const group = document.createElement('div'); group.className = 'table-scroll'; group.tabIndex = 0; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Recorded usage by agent scope'); group.dataset.usageFocusKey = 'scope-table';
  const table = document.createElement('table'); table.className = 'data-table usage-scope-table';
  const caption = table.createCaption(); caption.className = 'visually-hidden'; caption.textContent = 'Recorded usage by agent scope';
  const head = table.createTHead().insertRow();
  for (const label of ['Scope', 'Input', 'Cached input', 'Cache writes', 'Output', 'Total tokens', 'Estimated API equivalent']) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; head.append(cell); }
  const body = table.createTBody();
  const scopes: [string, UsageSummary][] = [[selected.lineage.kind === 'subagent' ? 'Selected agent' : 'Main agent', details.ownUsage], ['Subagents', details.descendantsUsage], ['Combined', details.combinedUsage]];
  for (const [label, usage] of scopes) {
    const row = body.insertRow(); const heading = document.createElement('th'); heading.scope = 'row'; heading.textContent = label; row.append(heading);
    for (const value of [usageCount(usage, 'input'), cachedCount(usage), cacheWrites(usage), usageCount(usage, 'output'), usageCount(usage, 'total')]) row.insertCell().textContent = value;
    renderMoney(row.insertCell(), usage);
  }
  group.append(table); return group;
}

export function usageDetailsStatus(details: ConversationUsageDetails): string {
  const selected = details.agents.find(agent => agent.sessionId === details.sessionId)!;
  const messages = [...details.warnings];
  if (!details.agentTurnCount) messages.unshift('No ' + (usesPromptLabels(selected) ? 'prompts' : 'agent turns') + ' have been recorded for this session yet.');
  if (details.agentTurnCount && !details.combinedUsage.requests) {
    messages.unshift((usesPromptLabels(selected) ? 'Prompts' : 'Agent turns') + ' are recorded, but no request usage is available. Token counts and the estimated API equivalent are unknown.');
  }
  return messages.join(' ');
}

function usesPromptLabels(agent: AgentUsageDetails): boolean { return agent.lineage.kind !== 'subagent' && agent.agentKind !== 'claude-code'; }

function quantity(value: number, unit: string): string { return count(value) + ' ' + unit + (value === 1 ? '' : 's'); }

function recordingNotes(details: ConversationUsageDetails, selected: AgentUsageDetails): HTMLDetailsElement {
  const messages = [details.userPromptCount === null ? 'User prompt count unknown.' : quantity(details.userPromptCount, 'user prompt') + '.', quantity(details.agentTurnCount, 'agent turn') + '.'];
  messages.push(details.coverage === 'partial' ? 'Saved records may omit requests or turns.' : 'Recorded source coverage is ' + details.coverage + '.');
  if (selected.lineage.kind === 'subagent') messages.push('Selected agent subtree only' + (details.rootSessionId ? '; ancestor main session is excluded.' : '; main session could not be established.'));
  const unmeasured = details.combinedUsage.unmeasuredTurns;
  if (unmeasured) messages.push(quantity(unmeasured, 'agent turn') + (unmeasured === 1 ? ' has' : ' have') + ' unknown token counts and an unknown API equivalent.');
  const claude = details.agents.some(agent => agent.agentKind === 'claude-code');
  messages.push(claude ? 'Estimated API equivalent in USD. Estimates use saved rates and labelled assumptions. Subscription charges, account discounts, and server-tool charges are separate.' : 'Estimated API equivalent in USD. ChatGPT subscription billing is separate.');
  const disclosure = usageDisclosure('Recording and billing notes', 'recording-notes');
  const paragraph = note(messages.join(' '), 'support-text usage-disclosure-body'); paragraph.id = 'session-usage-notes';
  disclosure.append(paragraph);
  return disclosure;
}

function preserveUsageView(content: HTMLElement): () => void {
  const disclosures = new Map([...content.querySelectorAll<HTMLDetailsElement>('[data-usage-disclosure-key]')].map(disclosure => [disclosure.dataset.usageDisclosureKey!, disclosure.open]));
  const focus = document.hasFocus() && content.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const focusedKey = focus?.dataset.usageFocusKey;
  const panel = content.closest<HTMLElement>('.dialog-content');
  const scrollTop = panel?.scrollTop ?? 0;
  const scrolls = new Map([...content.querySelectorAll<HTMLElement>('.table-scroll[data-usage-focus-key]')].map(group => [group.dataset.usageFocusKey!, [group.scrollLeft, group.scrollTop]]));
  return () => {
    for (const disclosure of content.querySelectorAll<HTMLDetailsElement>('[data-usage-disclosure-key]')) disclosure.open = disclosures.get(disclosure.dataset.usageDisclosureKey!) ?? disclosure.open;
    if (focusedKey && document.hasFocus() && document.activeElement === document.body) {
      const target = [...content.querySelectorAll<HTMLElement>('[data-usage-focus-key]')].find(element => element.dataset.usageFocusKey === focusedKey) ?? document.getElementById('close-session-usage');
      target?.focus({ preventScroll: true });
    }
    for (const group of content.querySelectorAll<HTMLElement>('.table-scroll[data-usage-focus-key]')) {
      const position = scrolls.get(group.dataset.usageFocusKey!); if (position) { group.scrollLeft = position[0]; group.scrollTop = position[1]; }
    }
    if (panel) panel.scrollTop = scrollTop;
  };
}

export function renderUsageDetails(details: ConversationUsageDetails): void {
  const content = document.getElementById('session-usage-details')!;
  const restore = content.dataset.usageSessionId === details.sessionId ? preserveUsageView(content) : () => {};
  const selected = details.agents.find(agent => agent.sessionId === details.sessionId)!;
  const report = document.createDocumentFragment();
  if (details.combinedUsage.requests || details.combinedUsage.unmeasuredTurns) report.append(sessionTotals(details.combinedUsage));
  if (details.agents.length > 1) {
    const comparison = usageDisclosure('Usage by agent', 'agent-usage-comparison');
    const table = scopeTable(details, selected); table.classList.add('usage-comparison-table');
    comparison.append(table); report.append(comparison);
  }
  const promptLabel = usesPromptLabels(selected);
  if (selected.turns.length) {
    const history = document.createElement('section'); history.className = 'usage-history';
    const heading = document.createElement('h3'); heading.textContent = promptLabel ? 'Prompts' : 'Agent turns'; history.append(heading);
    for (const [index, turn] of selected.turns.entries()) {
      const section = turnSection(turn, index, selected, promptLabel);
      const prompt = details.prompts.find(prompt => prompt.turnId === turn.id);
      if (promptLabel && prompt) appendPromptAttribution(section.querySelector('.usage-disclosure-body')!, prompt, details);
      history.append(section);
    }
    report.append(history);
  }
  if (!promptLabel && details.prompts.length) {
    const section = document.createElement('section'); section.className = 'turn-usage';
    const heading = document.createElement('h3'); heading.textContent = 'User prompt attribution'; section.append(heading);
    for (const prompt of details.prompts) {
      const group = document.createElement('section'); group.className = 'turn-usage';
      const title = document.createElement('h4'); title.textContent = 'User prompt · ' + prompt.turnId + ' · ' + prompt.status; group.append(title);
      group.append(note('Selected subtree: ' + summaryText(prompt.combinedUsage)));
      appendReferences(group, prompt.requestRefs, prompt.unmeasuredTurnRefs, details.agents); section.append(group);
    }
    report.append(section);
  }
  if (details.agents.length > 1) {
    const section = document.createElement('section'); section.className = 'turn-usage';
    const heading = document.createElement('h3'); heading.textContent = 'Subagents'; section.append(heading);
    for (const agent of details.agents.filter(agent => agent.sessionId !== details.sessionId)) {
      const disclosure = usageDisclosure(agentName(agent), identity('agent', agent.sessionId)); disclosure.classList.add('usage-agent'); disclosure.id = disclosure.dataset.usageDisclosureKey!;
      const body = document.createElement('div'); body.className = 'usage-disclosure-body';
      body.append(note(summaryText(agent.ownUsage)));
      body.append(note('Parent: ' + (agent.lineage.parentSessionId ?? 'unknown') + ' · Relationship: ' + agent.relationStatus + ' · Recorded source coverage: ' + agent.coverage + (agent.available ? '' : ' · Session file unavailable')));
      for (const [index, turn] of agent.turns.entries()) body.append(turnSection(turn, index, agent, false));
      if (!agent.turns.length) body.append(note('No agent turns have been recorded.'));
      disclosure.append(body);
      section.append(disclosure);
    }
    report.append(section);
  }
  if (details.unassigned.requestRefs.length || details.unassigned.unmeasuredTurnRefs.length) {
    const section = document.createElement('section'); section.className = 'turn-usage usage-unassigned';
    const heading = document.createElement('h3'); heading.textContent = 'Unassigned to a user prompt'; section.append(heading);
    section.append(note('These recorded requests or unmeasured agent turns have no proven user prompt attribution. They remain included in the selected scope.'));
    section.append(note(summaryText(details.unassigned.usage)));
    appendReferences(section, details.unassigned.requestRefs, details.unassigned.unmeasuredTurnRefs, details.agents); report.append(section);
  }
  if (report.childNodes.length) report.append(recordingNotes(details, selected));
  content.replaceChildren(report); content.dataset.usageSessionId = details.sessionId; restore();
}
