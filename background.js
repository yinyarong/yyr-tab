// ── focus-or-open-newtab command ─────────────────────────────────────────────
//
// Cmd+T / Ctrl+T is a reserved Chrome browser shortcut that extensions cannot
// override — Chrome silently ignores any attempt to bind it. The command is
// therefore registered on Cmd+B / Ctrl+B instead.
// To remap it to a different key, visit: chrome://extensions/shortcuts

const NEWTAB_URL = chrome.runtime.getURL('newtab.html');

console.log('[YYR Tab] background.js loaded. NEWTAB_URL =', NEWTAB_URL);

chrome.commands.onCommand.addListener(async (command) => {
  console.log('[YYR Tab] command fired:', command);
  if (command !== 'focus-or-open-newtab') return;

  const currentWindow = await chrome.windows.getCurrent({ populate: true });
  console.log('[YYR Tab] tabs in current window:',
    currentWindow.tabs.map(t => ({ id: t.id, url: t.url, pendingUrl: t.pendingUrl })));

  const matches = currentWindow.tabs.filter(tab =>
    tab.url === NEWTAB_URL ||
    tab.pendingUrl === NEWTAB_URL ||
    tab.url === 'chrome://newtab/' ||
    tab.pendingUrl === 'chrome://newtab/'
  );

  if (matches.length === 0) {
    console.log('[YYR Tab] creating new tab with url', NEWTAB_URL);
    await chrome.tabs.create({ url: NEWTAB_URL });
    return;
  }

  const keep = matches.find(t => t.active) ?? matches[0];
  const duplicates = matches.filter(t => t.id !== keep.id).map(t => t.id);
  console.log('[YYR Tab] keeping', keep.id, 'removing duplicates', duplicates);
  await chrome.tabs.update(keep.id, { active: true });
  if (duplicates.length) await chrome.tabs.remove(duplicates);
});
