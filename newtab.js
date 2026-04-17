// Fallback favicon as a tiny inline SVG (a neutral grey page icon).
// Used when a tab has no favicon or when the favicon URL fails to load.
const FALLBACK_FAVICON =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
  '<rect width="16" height="16" rx="2" fill="%234a5068"/></svg>';

const DEBOUNCE_MS = 100;
let debounceTimer = null;

// Delay rapid back-to-back events (e.g. a tab move fires onDetached + onAttached)
// so we only re-render once they settle.
function scheduleRefresh() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(render, DEBOUNCE_MS);
}

// Returns the current search query, normalised to lowercase.
function getQuery() {
  return (document.getElementById('search')?.value ?? '').trim().toLowerCase();
}

// Build a single tab row element.
function buildTabRow(tab) {
  const row = document.createElement('div');
  row.className = 'tab-row';

  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  favicon.src = tab.favIconUrl || FALLBACK_FAVICON;
  // If the favicon URL is stale or unavailable, fall back gracefully.
  favicon.addEventListener('error', () => { favicon.src = FALLBACK_FAVICON; });

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || tab.url || '(untitled)';
  title.title = tab.title || tab.url || '';  // full text on native tooltip

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close tab';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();  // prevent the row click from firing
    // chrome.tabs.remove closes the tab identified by its unique tabId.
    chrome.tabs.remove(tab.id);
  });

  // Clicking the row switches to that tab and brings its window to the front.
  // chrome.tabs.update sets the active tab within a window.
  // chrome.windows.update with { focused: true } raises the window itself.
  row.addEventListener('click', () => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  });

  row.appendChild(favicon);
  row.appendChild(title);
  row.appendChild(closeBtn);
  return row;
}

// Build a window column element. Returns null if no tabs match the query.
function buildWindowCol(win, index, query) {
  const visibleTabs = query
    ? win.tabs.filter(t =>
        (t.title ?? '').toLowerCase().includes(query) ||
        (t.url  ?? '').toLowerCase().includes(query)
      )
    : win.tabs;

  if (visibleTabs.length === 0) return null;

  const col = document.createElement('div');
  col.className = 'window-col';

  const header = document.createElement('div');
  header.className = 'window-header';
  const n = visibleTabs.length;
  header.textContent = `Window ${index + 1} · ${n} tab${n !== 1 ? 's' : ''}`;
  col.appendChild(header);

  visibleTabs.forEach(tab => col.appendChild(buildTabRow(tab)));
  return col;
}

// Main render function. Fetches current state and rebuilds the grid.
// Only the #grid element is replaced — the search input is outside it,
// so it keeps its value and focus across re-renders automatically.
async function render() {
  // chrome.windows.getAll with populate:true returns every window
  // together with its tabs array in a single IPC call — no need to
  // call chrome.tabs.query separately.
  const windows = await chrome.windows.getAll({ populate: true });

  const totalTabs = windows.reduce((sum, w) => sum + w.tabs.length, 0);
  const query = getQuery();

  document.getElementById('summary').textContent =
    `${totalTabs} tab${totalTabs !== 1 ? 's' : ''} across ` +
    `${windows.length} window${windows.length !== 1 ? 's' : ''}`;

  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  windows.forEach((win, i) => {
    const col = buildWindowCol(win, i, query);
    if (col) grid.appendChild(col);
  });
}

// ── Live event listeners ────────────────────────────────────────────────────
//
// All eight events below cover every way a tab or window can change.
// They all call scheduleRefresh(), which debounces into a single render().
// No background service worker is needed — these listeners live directly on
// the new tab page, which is already open when the user is looking at it.

chrome.tabs.onCreated.addListener(scheduleRefresh);
chrome.tabs.onRemoved.addListener(scheduleRefresh);

// onUpdated fires for title changes, URL navigations, loading state changes, etc.
// The second argument is a changeInfo object; we don't filter — any change re-renders.
chrome.tabs.onUpdated.addListener(scheduleRefresh);

chrome.tabs.onMoved.addListener(scheduleRefresh);    // tab reordered within a window
chrome.tabs.onAttached.addListener(scheduleRefresh); // tab moved to a different window
chrome.tabs.onDetached.addListener(scheduleRefresh); // tab picked up from a window

chrome.windows.onCreated.addListener(scheduleRefresh);
chrome.windows.onRemoved.addListener(scheduleRefresh);

// ── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('search').addEventListener('input', render);
  render();
});
