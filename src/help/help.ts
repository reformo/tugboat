import userGuide from '../../docs/user-guide.html?raw';

const topicGroups = [
  { label: 'Get started', identifiers: ['first-chat', 'accounts', 'projects', 'shortcuts'] },
  { label: 'Solve a problem', identifiers: ['troubleshooting', 'records', 'lifecycle', 'app-update', 'existing-project-reset'] },
  { label: 'Work in a project', identifiers: ['sessions', 'review', 'usage', 'preview', 'network-activity'] },
  { label: 'Configure a project', identifiers: ['settings', 'github-access', 'claude-attribution', 'image-update'] },
];

export function initializeHelp(): void {
  const template = document.createElement('template');
  template.innerHTML = userGuide;
  const guide = template.content.querySelector('main')!;
  const help = document.getElementById('help-view')!;
  const workspace = help.closest('main')!;
  const topicIndex = document.getElementById('help-index')!;
  const articles = document.getElementById('help-articles')!;
  const navigation = document.getElementById('help-topics')!;
  const search = document.querySelector<HTMLInputElement>('#help-search')!;
  const searchStatus = document.getElementById('help-search-status')!;
  const allTopicsButton = document.getElementById('help-all-topics')!;
  const labels = new Map([...guide.querySelectorAll<HTMLAnchorElement>(':scope > nav.contents a')]
    .map(link => [link.hash.slice(1), link.textContent]));
  const topics = [...guide.querySelectorAll<HTMLElement>(':scope > section')].map(article => {
    // The packaged app supports links within the bundled guide.
    for (const link of article.querySelectorAll('a:not([href^="#"])')) link.replaceWith(...link.childNodes);
    const link = document.createElement('a');
    link.href = '#' + article.id;
    link.textContent = labels.get(article.id) ?? article.querySelector('h2')!.textContent;
    const row = document.createElement('li');
    row.append(link);
    article.hidden = true;
    articles.append(article);
    return { identifier: article.id, row, text: `${link.textContent} ${article.textContent}`.toLowerCase() };
  });
  const ungrouped = new Map(topics.map(topic => [topic.identifier, topic.row]));

  function addGroup(label: string, identifiers: Iterable<string>): void {
    const list = document.createElement('ul');
    for (const identifier of identifiers) {
      const row = ungrouped.get(identifier);
      if (!row) continue;
      list.append(row);
      ungrouped.delete(identifier);
    }
    if (!list.childElementCount) return;
    const heading = document.createElement('h2');
    heading.textContent = label;
    const group = document.createElement('div');
    group.append(heading, list);
    navigation.append(group);
  }

  for (const { label, identifiers } of topicGroups) addGroup(label, identifiers);
  addGroup('More topics', [...ungrouped.keys()]);

  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    const words = query.split(/\s+/);
    let matches = 0;
    for (const { row, text } of topics) {
      row.hidden = !words.every(word => text.includes(word));
      if (!row.hidden) matches++;
    }
    for (const group of navigation.children) (group as HTMLElement).hidden = !group.querySelector('li:not([hidden])');
    searchStatus.classList.toggle('visually-hidden', matches > 0);
    if (!query) { searchStatus.textContent = ''; return; }
    if (!matches) { searchStatus.textContent = 'No topics match. Try a different search.'; return; }
    searchStatus.textContent = matches === 1 ? '1 topic found.' : `${matches} topics found.`;
  });

  let selectedArticle: HTMLElement | null = null;
  let indexPosition: { link: HTMLAnchorElement; scrollTop: number } | null = null;
  help.addEventListener('click', event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    const target = document.getElementById(link.hash.slice(1));
    const article = target?.closest<HTMLElement>('.help-articles > section');
    if (!target || !article) return;
    event.preventDefault();
    if (navigation.contains(link)) indexPosition = { link, scrollTop: workspace.scrollTop };
    if (selectedArticle) selectedArticle.hidden = true;
    selectedArticle = article;
    topicIndex.hidden = true;
    allTopicsButton.hidden = articles.hidden = article.hidden = false;
    const heading = target === article ? article.querySelector('h2')! : target;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView?.({ block: 'start' });
  });

  allTopicsButton.addEventListener('click', () => {
    if (selectedArticle) selectedArticle.hidden = true;
    selectedArticle = null;
    allTopicsButton.hidden = articles.hidden = true;
    topicIndex.hidden = false;
    workspace.scrollTop = indexPosition?.scrollTop ?? 0;
    const returnTarget = indexPosition?.link ?? search;
    returnTarget.focus({ preventScroll: true });
    returnTarget.scrollIntoView?.({ block: 'nearest' });
  });
}
