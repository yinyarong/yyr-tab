// ── Constants ───────────────────────────────────────────────────────────────

const SHORTCUT_COUNT = 12;

// Fallback favicon: a neutral grey rounded rectangle used when a tab or
// shortcut has no favicon, or when the favicon URL fails to load.
const FALLBACK_FAVICON =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
  '<rect width="16" height="16" rx="2" fill="%234a5068"/></svg>';

// ── Shortcut state ──────────────────────────────────────────────────────────
//
// All UI is derived from these two variables by renderShortcuts().
// Mutations always follow the pattern: update state → persist → re-render.

let shortcuts = new Array(SHORTCUT_COUNT).fill(null); // null | { name, url }
let editingSlot = null;                                // null | slot index

// ── Shortcut persistence ────────────────────────────────────────────────────

// chrome.storage.sync persists data in the user's Google account and syncs it
// across every Chrome instance where they are signed in — unlike localStorage,
// which is local to one machine and one browser profile.
async function loadShortcuts() {
  const result = await chrome.storage.sync.get('shortcuts');
  if (Array.isArray(result.shortcuts)) {
    shortcuts = result.shortcuts;
  }
}

async function saveShortcuts() {
  await chrome.storage.sync.set({ shortcuts });
}

// ── Shortcut helpers ────────────────────────────────────────────────────────

// Build the Google favicon service URL for a given site URL.
// sz=32 requests a 32×32px icon; we pass just the hostname, not the full URL.
function faviconFor(url) {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return FALLBACK_FAVICON;
  }
}

// ── Shortcut slot builders ──────────────────────────────────────────────────

function makeCircle(content) {
  const circle = document.createElement('div');
  circle.className = 'shortcut-circle';
  if (content) circle.appendChild(content);
  return circle;
}

function buildEmptySlot(index) {
  const btn = document.createElement('button');
  btn.className = 'shortcut-slot shortcut-empty';
  btn.setAttribute('aria-label', 'Add shortcut');

  const plus = document.createTextNode('+');
  btn.appendChild(makeCircle(plus));

  const label = document.createElement('span');
  label.className = 'shortcut-label';
  label.textContent = 'Add shortcut';
  btn.appendChild(label);

  btn.addEventListener('click', () => openEditForm(index));
  return btn;
}

function buildFilledSlot(index, { name, url }) {
  const btn = document.createElement('button');
  btn.className = 'shortcut-slot shortcut-filled';
  btn.setAttribute('aria-label', name);

  const img = document.createElement('img');
  img.className = 'shortcut-favicon';
  img.src = faviconFor(url);
  img.addEventListener('error', () => { img.src = FALLBACK_FAVICON; });
  btn.appendChild(makeCircle(img));

  const label = document.createElement('span');
  label.className = 'shortcut-label';
  label.textContent = name;
  btn.appendChild(label);

  // Left-click: open the site in a new tab.
  // chrome.tabs.create opens a new tab at the given URL.
  btn.addEventListener('click', () => {
    chrome.tabs.create({ url });
  });

  // Right-click: show the custom context menu (Edit / Remove).
  // preventDefault stops Chrome's native browser context menu from appearing.
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, index);
  });

  return btn;
}

function buildEditingSlot() {
  const div = document.createElement('div');
  div.className = 'shortcut-slot shortcut-editing';

  const pencil = document.createTextNode('✎');
  div.appendChild(makeCircle(pencil));

  const label = document.createElement('span');
  label.className = 'shortcut-label';
  label.textContent = 'Editing…';
  div.appendChild(label);

  return div;
}

// ── Shortcut render ─────────────────────────────────────────────────────────

function renderShortcuts() {
  const container = document.getElementById('shortcuts');
  container.innerHTML = '';

  shortcuts.forEach((slot, i) => {
    let el;
    if (i === editingSlot) {
      el = buildEditingSlot();
    } else if (slot) {
      el = buildFilledSlot(i, slot);
    } else {
      el = buildEmptySlot(i);
    }
    container.appendChild(el);
  });

  // Show or hide the inline form panel below the grid.
  const panel = document.getElementById('shortcut-form-panel');
  if (editingSlot !== null) {
    const existing = shortcuts[editingSlot];
    document.getElementById('sf-name').value = existing?.name ?? '';
    document.getElementById('sf-url').value  = existing?.url  ?? '';
    panel.hidden = false;
    document.getElementById('sf-name').focus();
  } else {
    panel.hidden = true;
  }
}

// ── Shortcut form actions ───────────────────────────────────────────────────

function openEditForm(index) {
  editingSlot = index;
  renderShortcuts();
}

async function submitEditForm() {
  const name = document.getElementById('sf-name').value.trim();
  let url    = document.getElementById('sf-url').value.trim();

  if (!name || !url) return;

  // Auto-prepend https:// if the user typed a bare domain like "example.com"
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  shortcuts[editingSlot] = { name, url };
  await saveShortcuts();
  editingSlot = null;
  renderShortcuts();
}

function cancelEditForm() {
  editingSlot = null;
  renderShortcuts();
}

// Allow submitting the form by pressing Enter in either input field.
function handleFormKeydown(e) {
  if (e.key === 'Enter')  submitEditForm();
  if (e.key === 'Escape') cancelEditForm();
}

// ── Context menu ────────────────────────────────────────────────────────────

let ctxSlotIndex = null; // which filled slot was right-clicked

function showContextMenu(x, y, index) {
  ctxSlotIndex = index;
  const menu = document.getElementById('ctx-menu');
  menu.hidden = false;

  // Position near cursor, then nudge inward if it would overflow the viewport.
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;

  const rect = menu.getBoundingClientRect();
  if (rect.right  > window.innerWidth)  menu.style.left = `${x - rect.width}px`;
  if (rect.bottom > window.innerHeight) menu.style.top  = `${y - rect.height}px`;
}

function hideContextMenu() {
  document.getElementById('ctx-menu').hidden = true;
  ctxSlotIndex = null;
}

// ── Tab dashboard ────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 100;
let debounceTimer = null;

function scheduleRefresh() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(render, DEBOUNCE_MS);
}

function getQuery() {
  return (document.getElementById('search')?.value ?? '').trim().toLowerCase();
}

// ── Category classification ──────────────────────────────────────────────────

const CATEGORY_ORDER = ['Video', 'Social', 'AI', 'Dev', 'Other'];

const CATEGORY_PATTERNS = [
  { name: 'Video',  re: /youtube\.com|bilibili\.com|vimeo\.com|twitch\.tv|netflix\.com|youku\.com/ },
  { name: 'Social', re: /x\.com|twitter\.com|instagram\.com|weibo\.com|facebook\.com|linkedin\.com|reddit\.com|tiktok\.com/ },
  { name: 'AI',     re: /claude\.ai|gemini\.google\.com|chatgpt\.com|notebooklm\.google\.com|openai\.com|anthropic\.com|perplexity\.ai|copilot\.microsoft\.com/ },
  { name: 'Dev',    re: /github\.com|stackoverflow\.com|gitlab\.com|codepen\.io/ },
];

function getCategory(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    if (hostname.startsWith('docs.')) return 'Dev';
    for (const { name, re } of CATEGORY_PATTERNS) {
      if (re.test(hostname)) return name;
    }
  } catch {}
  return 'Other';
}

function buildTabChip(tab) {
  const chip = document.createElement('div');
  chip.className = 'tab-chip';

  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  favicon.src = tab.favIconUrl || FALLBACK_FAVICON;
  favicon.addEventListener('error', () => { favicon.src = FALLBACK_FAVICON; });

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || tab.url || '(untitled)';
  title.title = tab.title || tab.url || '';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close tab';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.tabs.remove(tab.id);
  });

  chip.addEventListener('click', () => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  });

  chip.appendChild(favicon);
  chip.appendChild(title);
  chip.appendChild(closeBtn);
  return chip;
}

function buildWindowRow(win, index, query) {
  const visibleTabs = query
    ? win.tabs.filter(t =>
        (t.title ?? '').toLowerCase().includes(query) ||
        (t.url   ?? '').toLowerCase().includes(query)
      )
    : win.tabs;

  if (visibleTabs.length === 0) return null;

  // Group tabs by category, preserving CATEGORY_ORDER.
  const groups = {};
  for (const tab of visibleTabs) {
    const cat = getCategory(tab.url || '');
    (groups[cat] ??= []).push(tab);
  }
  const activeCategories = CATEGORY_ORDER.filter(c => groups[c]?.length > 0);
  const showLabels = activeCategories.length > 1;

  const row = document.createElement('div');
  row.className = 'window-row';

  const label = document.createElement('div');
  label.className = 'window-row-label';
  label.textContent = `Window ${index + 1}`;
  row.appendChild(label);

  const content = document.createElement('div');
  content.className = 'window-row-content';

  activeCategories.forEach((cat, i) => {
    if (i > 0) {
      const divider = document.createElement('div');
      divider.className = 'group-divider';
      content.appendChild(divider);
    }

    const group = document.createElement('div');
    group.className = 'tab-group';

    if (showLabels) {
      const catLabel = document.createElement('span');
      catLabel.className = 'group-label';
      catLabel.textContent = cat;
      group.appendChild(catLabel);
    }

    groups[cat].forEach(tab => group.appendChild(buildTabChip(tab)));
    content.appendChild(group);
  });

  row.appendChild(content);
  return row;
}

async function render() {
  // chrome.windows.getAll with populate:true returns every window and its tabs
  // in one call — the "tabs" permission is required to access title/url/favIconUrl.
  const windows = await chrome.windows.getAll({ populate: true });

  const totalTabs = windows.reduce((sum, w) => sum + w.tabs.length, 0);
  const query = getQuery();

  document.getElementById('summary').textContent =
    `${totalTabs} tab${totalTabs !== 1 ? 's' : ''} across ` +
    `${windows.length} window${windows.length !== 1 ? 's' : ''}`;

  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  windows.forEach((win, i) => {
    const row = buildWindowRow(win, i, query);
    if (row) grid.appendChild(row);
  });
}

// ── Tab/window event listeners ───────────────────────────────────────────────

chrome.tabs.onCreated.addListener(scheduleRefresh);
chrome.tabs.onRemoved.addListener(scheduleRefresh);
chrome.tabs.onUpdated.addListener(scheduleRefresh);
chrome.tabs.onMoved.addListener(scheduleRefresh);
chrome.tabs.onAttached.addListener(scheduleRefresh);
chrome.tabs.onDetached.addListener(scheduleRefresh);
chrome.windows.onCreated.addListener(scheduleRefresh);
chrome.windows.onRemoved.addListener(scheduleRefresh);

// ── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Wire up the inline form buttons and keyboard shortcuts.
  document.getElementById('sf-save').addEventListener('click', submitEditForm);
  document.getElementById('sf-cancel').addEventListener('click', cancelEditForm);
  document.getElementById('sf-name').addEventListener('keydown', handleFormKeydown);
  document.getElementById('sf-url').addEventListener('keydown', handleFormKeydown);

  // Wire up the context menu actions.
  document.getElementById('ctx-edit').addEventListener('click', () => {
    const i = ctxSlotIndex;
    hideContextMenu();
    openEditForm(i);
  });
  document.getElementById('ctx-remove').addEventListener('click', async () => {
    shortcuts[ctxSlotIndex] = null;
    await saveShortcuts();
    hideContextMenu();
    renderShortcuts();
  });

  // Any click outside the context menu dismisses it.
  document.addEventListener('click', (e) => {
    if (!document.getElementById('ctx-menu').contains(e.target)) {
      hideContextMenu();
    }
  });

  document.getElementById('search').addEventListener('input', render);

  // Load persisted shortcuts before first paint, then render both sections.
  await loadShortcuts();
  renderShortcuts();
  render();
});
