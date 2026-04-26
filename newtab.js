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
let renderedEditingSlot = null;                        // last slot the form was populated for

// ── Shortcut persistence ────────────────────────────────────────────────────

async function loadShortcuts() {
  const result = await chrome.storage.local.get('shortcuts');
  const raw = Array.isArray(result.shortcuts) ? result.shortcuts : [];
  const filled = raw.filter(s => s !== null);
  shortcuts = [...filled, ...new Array(SHORTCUT_COUNT - filled.length).fill(null)];
}

async function saveShortcuts() {
  await chrome.storage.local.set({ shortcuts });
}

// Apply a shortcuts array from outside this tab (cross-tab sync listener).
// Storage writes from this tab also come back through here — safe because
// renderShortcuts is idempotent.
function applyShortcuts(newShortcuts) {
  const raw = Array.isArray(newShortcuts) ? newShortcuts : [];
  const filled = raw.filter(s => s !== null);
  shortcuts = [
    ...filled,
    ...new Array(SHORTCUT_COUNT - filled.length).fill(null),
  ];
  renderShortcuts();
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

// ── Shortcut drag & drop (pointer + FLIP) ───────────────────────────────────
//
// Pointer-driven drag with live sibling reorder: as the dragged slot follows
// the pointer, siblings animate from their old rect to their new rect via the
// FLIP technique. Reordering happens at the DOM layer during the drag; the new
// order is committed to chrome.storage.local only on pointerup, and the
// cross-tab sync listener skips mid-drag updates to avoid wiping the DOM.

const DRAG_THRESHOLD_PX = 5;

// While a drag is active:
//   { el, pointerId, startX, startY, grabOffsetX, grabOffsetY,
//     naturalLeft, naturalTop, hasMoved, lastHoverEl }
let dragState = null;

// True while a FLIP animation is playing. Prevents the animated mid-flight
// positions of siblings from triggering spurious reorders during the 200 ms
// transition.
let flipAnimating = false;

// Briefly true in the frame after a real drag ends, so the synthetic click
// that follows pointerup doesn't trigger the slot's open/edit action.
let suppressNextClick = false;

// Measure an element's flow position with any inline transform stripped, so
// the "natural" origin is stable regardless of the drag translate.
function captureNaturalPosition(el) {
  const prev = el.style.transform;
  el.style.transform = '';
  const rect = el.getBoundingClientRect();
  el.style.transform = prev;
  return { left: rect.left, top: rect.top };
}

function onShortcutPointerDown(e) {
  if (e.button !== 0) return;
  const el = e.target.closest('.shortcut-filled');
  if (!el) return;

  const rect = el.getBoundingClientRect();
  dragState = {
    el,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    grabOffsetX: e.clientX - rect.left,
    grabOffsetY: e.clientY - rect.top,
    naturalLeft: rect.left,
    naturalTop: rect.top,
    hasMoved: false,
    lastHoverEl: null,
  };
  el.setPointerCapture(e.pointerId);
}

function onShortcutPointerMove(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;

  if (!dragState.hasMoved) {
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    dragState.hasMoved = true;
    dragState.el.classList.add('shortcut-slot--dragging');
  }

  // Manual sibling hit-test (the dragged el is excluded so it doesn't mask
  // whatever sits beneath it visually).
  const grid = document.getElementById('shortcuts');
  let hoverTarget = null;
  for (const child of grid.children) {
    if (child === dragState.el) continue;
    const r = child.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top  && e.clientY <= r.bottom) {
      hoverTarget = child;
      break;
    }
  }

  // Reset the guard when the cursor isn't over any slot, so re-entering a
  // slot after leaving it can trigger a fresh swap.
  if (!hoverTarget) {
    dragState.lastHoverEl = null;
  } else if (!flipAnimating &&
             hoverTarget !== dragState.lastHoverEl &&
             hoverTarget.classList.contains('shortcut-filled')) {
    reorderWithFlip(dragState.el, hoverTarget);
    dragState.lastHoverEl = hoverTarget;
  }

  const tx = e.clientX - dragState.grabOffsetX - dragState.naturalLeft;
  const ty = e.clientY - dragState.grabOffsetY - dragState.naturalTop;
  dragState.el.style.transform = `translate(${tx}px, ${ty}px) scale(1.08)`;
}

function reorderWithFlip(draggedEl, targetEl) {
  const grid = document.getElementById('shortcuts');
  const items = [...grid.children];

  // FIRST: snapshot each sibling's current on-screen rect (mid-animation is
  // fine — that's exactly the position the user can see).
  const firstRects = new Map();
  for (const el of items) {
    if (el === draggedEl) continue;
    firstRects.set(el, el.getBoundingClientRect());
  }

  // Cancel any in-flight FLIP on siblings so the next measurement reflects
  // the settled base layout rather than an animated in-between state.
  for (const el of items) {
    if (el === draggedEl) continue;
    for (const anim of el.getAnimations()) anim.cancel();
  }

  // LAST: reorder the DOM. Inserting after-or-before mirrors the old
  // insert-and-shift semantics so dragging slot 0 onto slot 5 yields
  // [1,2,3,4,5,0,...], matching Chrome's speed-dial feel.
  const dragIdx = items.indexOf(draggedEl);
  const targetIdx = items.indexOf(targetEl);
  if (dragIdx < targetIdx) targetEl.after(draggedEl);
  else                     targetEl.before(draggedEl);

  // INVERT + PLAY: drive each sibling from its old rect to its new rect.
  flipAnimating = true;
  const anims = [];
  for (const el of items) {
    if (el === draggedEl) continue;
    const first = firstRects.get(el);
    const last = el.getBoundingClientRect();
    const shiftX = first.left - last.left;
    const shiftY = first.top  - last.top;
    if (shiftX === 0 && shiftY === 0) continue;
    anims.push(el.animate(
      [
        { transform: `translate(${shiftX}px, ${shiftY}px)` },
        { transform: 'translate(0, 0)' }
      ],
      { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
    ));
  }
  Promise.all(anims.map(a => a.finished)).catch(() => {}).then(() => {
    flipAnimating = false;
  });

  // The dragged el just moved in the DOM; refresh its natural origin so the
  // follow-the-pointer translate keeps the grab point under the cursor.
  const nat = captureNaturalPosition(draggedEl);
  dragState.naturalLeft = nat.left;
  dragState.naturalTop  = nat.top;
}

async function onShortcutPointerUp(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const { el, hasMoved } = dragState;
  dragState = null;

  try { el.releasePointerCapture(e.pointerId); } catch {}
  el.classList.remove('shortcut-slot--dragging');
  el.style.transform = '';
  flipAnimating = false;

  if (!hasMoved) return;

  // A click event fires right after pointerup on the same element — swallow it
  // so a drag-and-drop doesn't also open the URL.
  suppressNextClick = true;
  requestAnimationFrame(() => { suppressNextClick = false; });

  // Rebuild the shortcuts array from the DOM, using each slot's
  // render-time index stamp to look up its payload.
  const grid = document.getElementById('shortcuts');
  const snapshot = shortcuts.slice();
  const children = [...grid.children];
  const reordered = children.map(node => {
    const idx = parseInt(node.dataset.idx, 10);
    return Number.isInteger(idx) ? snapshot[idx] : null;
  });
  const filled = reordered.filter(s => s !== null);
  shortcuts = [...filled, ...new Array(SHORTCUT_COUNT - filled.length).fill(null)];
  // Re-stamp the indices so a second drag in this same session reads from
  // the updated array instead of the pre-drag one.
  children.forEach((node, i) => { node.dataset.idx = String(i); });

  await saveShortcuts();
}

function onShortcutClickCapture(e) {
  if (suppressNextClick) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
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
    // The drag handler reads this stamp at pointerup to map the reordered
    // DOM back to shortcut objects in the in-memory array.
    el.dataset.idx = String(i);
    container.appendChild(el);
  });

  // Show or hide the inline form panel below the grid. Populate inputs only
  // when the panel opens or switches slot, so cross-tab sync re-renders can't
  // clobber what the user is currently typing.
  const panel = document.getElementById('shortcut-form-panel');
  if (editingSlot !== null) {
    if (renderedEditingSlot !== editingSlot) {
      const existing = shortcuts[editingSlot];
      document.getElementById('sf-name').value = existing?.name ?? '';
      document.getElementById('sf-url').value  = existing?.url  ?? '';
      document.getElementById('sf-name').focus();
    }
    panel.hidden = false;
  } else {
    panel.hidden = true;
  }
  renderedEditingSlot = editingSlot;
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
  editingSlot = null;
  await saveShortcuts();
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

// ── Tab close animation ──────────────────────────────────────────────────────

const CONFETTI_COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff', '#ff9f1c'];

function spawnConfetti(x, y) {
  const count = 10;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-particle';

    // Spread particles evenly around a full circle with a little randomness,
    // biased slightly upward so the burst reads as an explosion rather than a drop.
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
    const speed = 55 + Math.random() * 55;
    const dx    = Math.cos(angle) * speed;
    const dy    = Math.sin(angle) * speed - 25;
    const rot   = (Math.random() - 0.5) * 640;

    el.style.cssText =
      `left:${x}px;top:${y}px;` +
      `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]};` +
      `--dx:${dx}px;--dy:${dy}px;--rot:${rot}deg;` +
      `width:${5 + Math.random() * 5}px;height:${5 + Math.random() * 5}px;`;

    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

// ── Click firework (canvas particle system) ─────────────────────────────────
//
// One full-viewport canvas + one rAF loop drives all bursts. The loop only
// runs while particles exist; spawnFirework() restarts it on the next click.

const FX_COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff', '#ff9f1c', '#ff3df8', '#3df8e0'];
const FX_PARTICLES_PER_BURST = 24;
const FX_GRAVITY = 0.18;
const FX_FRICTION = 0.985;

let fxCtx = null;
let fxParticles = [];
let fxRafId = null;

function initClickFx() {
  const canvas = document.getElementById('click-fx');
  fxCtx = canvas.getContext('2d');
  resizeFxCanvas();
  window.addEventListener('resize', resizeFxCanvas);
}

function resizeFxCanvas() {
  const canvas = document.getElementById('click-fx');
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = window.innerWidth  * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width  = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  // setTransform replaces (not multiplies) so resize calls don't compound.
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function spawnFirework(x, y) {
  for (let i = 0; i < FX_PARTICLES_PER_BURST; i++) {
    const angle = (i / FX_PARTICLES_PER_BURST) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const speed = 2.5 + Math.random() * 4;
    fxParticles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2 + Math.random() * 3,
      color: FX_COLORS[Math.floor(Math.random() * FX_COLORS.length)],
      life: 1, // 1 → 0 over its lifespan
      decay: 0.012 + Math.random() * 0.012,
    });
  }
  if (fxRafId === null) fxRafId = requestAnimationFrame(tickFx);
}

function tickFx() {
  fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  for (let i = fxParticles.length - 1; i >= 0; i--) {
    const p = fxParticles[i];
    p.vx *= FX_FRICTION;
    p.vy = p.vy * FX_FRICTION + FX_GRAVITY;
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;

    if (p.life <= 0) {
      fxParticles.splice(i, 1);
      continue;
    }

    fxCtx.globalAlpha = p.life;
    fxCtx.fillStyle = p.color;
    fxCtx.beginPath();
    fxCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    fxCtx.fill();
  }
  fxCtx.globalAlpha = 1;

  if (fxParticles.length > 0) {
    fxRafId = requestAnimationFrame(tickFx);
  } else {
    fxRafId = null;
  }
}

// Skip clicks on interactive elements so typing/buttons aren't visually noisy.
function shouldSpawnFxOn(target) {
  return !target.closest('input, button, [contenteditable], a, select, textarea');
}

// ── Tab dashboard ────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 100;
let debounceTimer = null;

let currentWindowId = null;
let tabDrag = null;

function scheduleRefresh() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(render, DEBOUNCE_MS);
}

function getQuery() {
  return (document.getElementById('search')?.value ?? '').trim().toLowerCase();
}

// ── Greeting ─────────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatGreetingDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).toUpperCase();
}

// ── Category classification ───────────────────────────────────────────────────

const CATEGORY_ORDER = ['Video', 'Social', 'AI', 'Dev', 'News', 'Shopping', 'Finance', 'Education', 'Productivity', 'Gaming', 'Other'];

const CATEGORY_PATTERNS = [
  { name: 'Video',       re: /youtube\.com|bilibili\.com|vimeo\.com|twitch\.tv|netflix\.com|youku\.com|hulu\.com|disneyplus\.com|primevideo\.com|iqiyi\.com|mgtv\.com|dailymotion\.com|crunchyroll\.com/ },
  { name: 'Social',      re: /x\.com|twitter\.com|instagram\.com|weibo\.com|facebook\.com|linkedin\.com|reddit\.com|tiktok\.com|discord\.com|telegram\.org|mastodon\.social|pinterest\.com|snapchat\.com|tumblr\.com|quora\.com|zhihu\.com/ },
  { name: 'AI',          re: /claude\.ai|gemini\.google\.com|chatgpt\.com|notebooklm\.google\.com|openai\.com|anthropic\.com|perplexity\.ai|copilot\.microsoft\.com|huggingface\.co|replicate\.com|mistral\.ai|cohere\.com|together\.ai/ },
  { name: 'Dev',         re: /github\.com|stackoverflow\.com|gitlab\.com|codepen\.io|bitbucket\.org|npmjs\.com|pypi\.org|crates\.io|pkg\.go\.dev|developer\.mozilla\.org|devdocs\.io|jsfiddle\.net|replit\.com|codesandbox\.io|vercel\.com|netlify\.com|railway\.app|fly\.io|heroku\.com|digitalocean\.com|aws\.amazon\.com|console\.cloud\.google\.com|portal\.azure\.com/ },
  { name: 'News',        re: /bbc\.com|bbc\.co\.uk|cnn\.com|theguardian\.com|nytimes\.com|reuters\.com|apnews\.com|bloomberg\.com|wsj\.com|ft\.com|economist\.com|techcrunch\.com|theverge\.com|wired\.com|arstechnica\.com|hackernews\.com|news\.ycombinator\.com|36kr\.com|ifanr\.com/ },
  { name: 'Shopping',    re: /amazon\.com|ebay\.com|etsy\.com|shopify\.com|aliexpress\.com|taobao\.com|jd\.com|tmall\.com|walmart\.com|target\.com|bestbuy\.com|newegg\.com|wayfair\.com/ },
  { name: 'Finance',     re: /paypal\.com|stripe\.com|wise\.com|revolut\.com|robinhood\.com|coinbase\.com|binance\.com|kraken\.com|tradingview\.com|investing\.com|finance\.yahoo\.com|mint\.com|chase\.com|bankofamerica\.com|wellsfargo\.com/ },
  { name: 'Education',   re: /coursera\.org|udemy\.com|edx\.org|khanacademy\.org|pluralsight\.com|skillshare\.com|lynda\.com|brilliant\.org|duolingo\.com|wikipedia\.org|medium\.com|substack\.com/ },
  { name: 'Productivity', re: /notion\.so|obsidian\.md|roamresearch\.com|airtable\.com|trello\.com|asana\.com|linear\.app|jira\.atlassian\.com|confluence\.atlassian\.com|figma\.com|miro\.com|canva\.com|docs\.google\.com|sheets\.google\.com|slides\.google\.com|drive\.google\.com|calendar\.google\.com|mail\.google\.com|outlook\.live\.com|slack\.com|zoom\.us|meet\.google\.com|teams\.microsoft\.com/ },
  { name: 'Gaming',      re: /steam\.com|steampowered\.com|epicgames\.com|gog\.com|itch\.io|twitch\.tv|xbox\.com|playstation\.com|nintendo\.com|battlenet\.com|ea\.com|ubisoft\.com/ },
];

async function getCategory(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    const pathname = parsed.pathname.toLowerCase();

    for (const { name, re } of CATEGORY_PATTERNS) {
      if (re.test(hostname)) return name;
    }

    if (hostname.startsWith('docs.') || hostname.startsWith('api.') || hostname.startsWith('developer.')) return 'Dev';
    if (hostname.startsWith('news.') || hostname.startsWith('blog.')) return 'News';
    if (hostname.startsWith('mail.') || hostname.startsWith('calendar.')) return 'Productivity';
    if (hostname.startsWith('shop.') || hostname.startsWith('store.')) return 'Shopping';

    if (hostname.endsWith('.edu')) return 'Education';
    if (hostname.endsWith('.gov')) return 'Other';

    if (/\/(docs?|api|reference|developer)\b/.test(pathname)) return 'Dev';
    if (/\/(blog|news|articles?|posts?)\b/.test(pathname)) return 'News';
    if (/\/(shop|store|cart|checkout|product)\b/.test(pathname)) return 'Shopping';
    if (/\/(learn|course|tutorial|lesson)\b/.test(pathname)) return 'Education';
  } catch {}
  return 'Other';
}

function resolveTabFavicon(tab) {
  if (!tab.url) return FALLBACK_FAVICON;
  return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=16`;
}

// ── Tab row builder ───────────────────────────────────────────────────────────

function buildTabRow(tab, dupCount) {
  const row = document.createElement('div');
  row.className = 'tab-row';

  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  favicon.src = resolveTabFavicon(tab);
  favicon.addEventListener('error', () => { favicon.src = FALLBACK_FAVICON; });

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || tab.url || '(untitled)';
  title.title = tab.title || tab.url || '';

  row.appendChild(favicon);
  row.appendChild(title);

  if (dupCount > 1) {
    const dupLabel = document.createElement('span');
    dupLabel.className = 'dup-label';
    dupLabel.textContent = `(${dupCount}×)`;
    row.appendChild(dupLabel);
  }

  const actions = document.createElement('div');
  actions.className = 'tab-row-actions';

  const bookmarkBtn = document.createElement('button');
  bookmarkBtn.className = 'tab-action-btn bookmark-btn';
  bookmarkBtn.title = 'Bookmark tab';
  bookmarkBtn.innerHTML = '<svg width="12" height="14" viewBox="0 0 12 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1h10v12L6 9 1 13V1z"/></svg>';
  bookmarkBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.bookmarks.create({ title: tab.title || tab.url, url: tab.url });
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-action-btn tab-close-btn';
  closeBtn.title = 'Close tab';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = row.getBoundingClientRect();
    spawnConfetti(r.left + r.width / 2, r.top + r.height / 2);
    row.classList.add('chip-closing');
    row.addEventListener('animationend', () => chrome.tabs.remove(tab.id), { once: true });
  });

  actions.appendChild(bookmarkBtn);
  actions.appendChild(closeBtn);
  row.appendChild(actions);

  row.addEventListener('click', () => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  });

  return row;
}

// ── Category card builder ─────────────────────────────────────────────────────

function buildCategoryCard(catName, tabs) {
  const urlCounts = {};
  for (const tab of tabs) {
    const url = tab.url || '';
    urlCounts[url] = (urlCounts[url] || 0) + 1;
  }
  const duplicateCount = Object.values(urlCounts)
    .filter(c => c > 1)
    .reduce((sum, c) => sum + (c - 1), 0);

  const card = document.createElement('div');
  card.className = 'tab-card';

  // Header
  const header = document.createElement('div');
  header.className = 'card-header';

  const name = document.createElement('span');
  name.className = 'card-name';
  name.textContent = catName;

  const badges = document.createElement('div');
  badges.className = 'card-badges';

  const countBadge = document.createElement('span');
  countBadge.className = 'tab-count-badge';
  countBadge.textContent = `${tabs.length} tab${tabs.length !== 1 ? 's' : ''} open`;
  badges.appendChild(countBadge);

  if (duplicateCount > 0) {
    const dupBadge = document.createElement('span');
    dupBadge.className = 'duplicate-badge';
    dupBadge.textContent = `${duplicateCount} duplicate${duplicateCount !== 1 ? 's' : ''}`;
    badges.appendChild(dupBadge);
  }

  header.appendChild(name);
  header.appendChild(badges);
  card.appendChild(header);

  // Tab list
  const tabList = document.createElement('div');
  tabList.className = 'tab-list';
  for (const tab of tabs) {
    tabList.appendChild(buildTabRow(tab, urlCounts[tab.url || '']));
  }
  card.appendChild(tabList);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'card-footer';

  const closeAllBtn = document.createElement('button');
  closeAllBtn.className = 'card-close-btn';
  closeAllBtn.textContent = `× Close all ${tabs.length} tab${tabs.length !== 1 ? 's' : ''}`;
  closeAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.tabs.remove(tabs.map(t => t.id));
  });
  footer.appendChild(closeAllBtn);

  if (duplicateCount > 0) {
    const closeDupBtn = document.createElement('button');
    closeDupBtn.className = 'card-close-dup-btn';
    closeDupBtn.textContent = `Close ${duplicateCount} duplicate${duplicateCount !== 1 ? 's' : ''}`;
    closeDupBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const seen = new Set();
      const toClose = [];
      for (const tab of tabs) {
        const url = tab.url || '';
        if (urlCounts[url] > 1) {
          if (seen.has(url)) {
            toClose.push(tab.id);
          } else {
            seen.add(url);
          }
        }
      }
      chrome.tabs.remove(toClose);
    });
    footer.appendChild(closeDupBtn);
  }

  card.appendChild(footer);
  return card;
}

// ── Render ────────────────────────────────────────────────────────────────────

async function buildWindowSection(win, index, query) {
  const visibleTabs = query
    ? win.tabs.filter(t =>
        (t.title ?? '').toLowerCase().includes(query) ||
        (t.url   ?? '').toLowerCase().includes(query))
    : win.tabs;

  if (visibleTabs.length === 0) return null;

  // Group this window's tabs by category.
  const groups = {};
  for (const tab of visibleTabs) {
    const cat = await getCategory(tab.url || '');
    (groups[cat] ??= []).push(tab);
  }

  const bookmarkCategories = Object.keys(groups)
    .filter(c => !CATEGORY_ORDER.includes(c))
    .sort();
  const standardCategories = CATEGORY_ORDER.filter(c => groups[c]?.length > 0 && c !== 'Other');
  const activeCategories = [
    ...bookmarkCategories,
    ...standardCategories,
    ...(groups['Other']?.length > 0 ? ['Other'] : []),
  ];

  const section = document.createElement('div');
  section.className = 'window-section';
  if (win.id === currentWindowId) section.classList.add('window-section--active');

  // Window header
  const header = document.createElement('div');
  header.className = 'window-section-header';

  const label = document.createElement('span');
  label.className = 'window-section-label';
  label.textContent = `Window ${index + 1}`;
  header.appendChild(label);

  const tabCount = document.createElement('span');
  tabCount.className = 'window-tab-count';
  tabCount.textContent = `${visibleTabs.length} tab${visibleTabs.length !== 1 ? 's' : ''}`;
  header.appendChild(tabCount);

  const closeWinBtn = document.createElement('button');
  closeWinBtn.className = 'window-close-btn';
  closeWinBtn.textContent = '× Close window';
  closeWinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.windows.remove(win.id);
  });
  header.appendChild(closeWinBtn);

  section.appendChild(header);

  // Card grid for this window's categories
  const cardGrid = document.createElement('div');
  cardGrid.className = 'window-card-grid';
  for (const cat of activeCategories) {
    cardGrid.appendChild(buildCategoryCard(cat, groups[cat]));
  }
  section.appendChild(cardGrid);

  return section;
}

async function render() {
  const windows = await chrome.windows.getAll({ populate: true });
  const query = getQuery();

  const allTabs = windows.flatMap(w => w.tabs);
  const visibleTabs = query
    ? allTabs.filter(t =>
        (t.title ?? '').toLowerCase().includes(query) ||
        (t.url   ?? '').toLowerCase().includes(query))
    : allTabs;

  // Summary stats
  const domains = new Set(
    visibleTabs.map(t => { try { return new URL(t.url).hostname.replace(/^www\./, ''); } catch { return null; } })
      .filter(Boolean)
  );
  document.getElementById('summary').textContent =
    `${domains.size} domain${domains.size !== 1 ? 's' : ''}`;

  const closeAllBtn = document.getElementById('close-all-btn');
  if (visibleTabs.length > 0) {
    closeAllBtn.hidden = false;
    closeAllBtn.textContent = `× Close all ${visibleTabs.length} tab${visibleTabs.length !== 1 ? 's' : ''}`;
    closeAllBtn.onclick = () => chrome.tabs.remove(visibleTabs.map(t => t.id));
  } else {
    closeAllBtn.hidden = true;
  }

  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  for (const [i, win] of windows.entries()) {
    const section = await buildWindowSection(win, i, query);
    if (section) grid.appendChild(section);
  }
}

// ── Bookmarks bar ────────────────────────────────────────────────────────────

// chrome.bookmarks.getTree returns the full bookmark tree.
// Index [0] is the invisible root; its children are the well-known folders:
//   [0] Bookmarks bar  [1] Other bookmarks  [2] Mobile bookmarks
async function loadBookmarksBar() {
  const tree = await chrome.bookmarks.getTree();
  const barFolder = tree[0]?.children?.[0]; // "Bookmarks bar"
  if (!barFolder?.children) return;
  renderBookmarksBar(barFolder.children);
}

function faviconForBookmark(url) {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`;
  } catch {
    return FALLBACK_FAVICON;
  }
}

function buildBookmarkItem(node) {
  const btn = document.createElement('button');
  btn.className = node.url ? 'bm-item' : 'bm-item bm-folder';

  if (node.url) {
    const img = document.createElement('img');
    img.className = 'bm-favicon';
    img.src = faviconForBookmark(node.url);
    img.addEventListener('error', () => { img.src = FALLBACK_FAVICON; });

    const label = document.createElement('span');
    label.className = 'bm-label';
    label.textContent = node.title || node.url;

    btn.appendChild(img);
    btn.appendChild(label);
    btn.addEventListener('click', () => chrome.tabs.create({ url: node.url }));
  } else {
    const label = document.createElement('span');
    label.className = 'bm-label';
    label.textContent = node.title;

    const arrow = document.createElement('span');
    arrow.className = 'bm-arrow';
    arrow.textContent = '▾';

    btn.appendChild(label);
    btn.appendChild(arrow);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBookmarkDropdown(btn, node);
    });

    // Auto-open this folder's dropdown after a short hover while a drag is active.
    btn.addEventListener('dragover', (e) => {
      if (!bmDrag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropdownAnchor === btn) return;
      if (bmDragHoverAnchor === btn) return;
      cancelBmDragHover();
      bmDragHoverAnchor = btn;
      btn.classList.add('drag-hover');
      bmDragHoverTimer = setTimeout(() => {
        toggleBookmarkDropdown(btn, node);
        if (bmDragHoverAnchor) bmDragHoverAnchor.classList.remove('drag-hover');
        bmDragHoverAnchor = null;
        bmDragHoverTimer = null;
      }, 400);
    });
    btn.addEventListener('dragleave', () => {
      if (bmDragHoverAnchor === btn) cancelBmDragHover();
    });
    btn.addEventListener('drop', (e) => { e.preventDefault(); });
  }

  btn.addEventListener('contextmenu', (e) => showBmCtxMenu(e, node));
  return btn;
}

function renderBookmarksBar(nodes) {
  const bar = document.getElementById('bookmarks-bar');
  bar.innerHTML = '';
  nodes.forEach(node => bar.appendChild(buildBookmarkItem(node)));
}

// ── Bookmark folder dropdown ──────────────────────────────────────────────────
//
// Uses a drill-down stack: each time the user clicks a sub-folder, that level
// is pushed onto dropdownNav and the dropdown re-renders. The back button pops.

let dropdownAnchor = null;
let dropdownNav    = []; // stack of { title, children }

function toggleBookmarkDropdown(anchor, node) {
  const dropdown = document.getElementById('bookmark-dropdown');

  if (dropdownAnchor === anchor && !dropdown.hidden) {
    hideBookmarkDropdown();
    return;
  }

  dropdownAnchor = anchor;
  dropdownNav    = [{ id: node.id, title: node.title, children: node.children ?? [] }];
  renderDropdown();
  positionDropdown(anchor);
}

function renderDropdown() {
  const dropdown = document.getElementById('bookmark-dropdown');
  const current  = dropdownNav[dropdownNav.length - 1];
  dropdown.innerHTML = '';
  dropdown.hidden = false;

  // Back button when inside a sub-folder.
  if (dropdownNav.length > 1) {
    const back = document.createElement('button');
    back.className = 'bm-drop-back';
    back.textContent = '‹ ' + dropdownNav[dropdownNav.length - 2].title;
    back.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownNav.pop();
      renderDropdown();
    });
    dropdown.appendChild(back);
  }

  if (!current.children.length) {
    const empty = document.createElement('span');
    empty.className = 'bm-empty';
    empty.textContent = '(empty)';
    dropdown.appendChild(empty);
    return;
  }

  current.children.forEach(node => {
    const item = document.createElement('button');
    item.className = 'bm-drop-item';

    if (node.url) {
      const img = document.createElement('img');
      img.className = 'bm-favicon';
      img.src = faviconForBookmark(node.url);
      img.addEventListener('error', () => { img.src = FALLBACK_FAVICON; });
      item.appendChild(img);
    } else {
      const icon = document.createElement('span');
      icon.className = 'bm-folder-icon';
      icon.textContent = '▶';
      item.appendChild(icon);
    }

    const label = document.createElement('span');
    label.className = 'bm-drop-label';
    label.textContent = node.title || node.url || '(untitled)';
    item.appendChild(label);

    if (node.url) {
      item.addEventListener('click', () => {
        chrome.tabs.create({ url: node.url });
        hideBookmarkDropdown();
      });
    } else {
      // Drill into sub-folder.
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownNav.push({ id: node.id, title: node.title, children: node.children ?? [] });
        renderDropdown();
      });

      // Auto-drill into this sub-folder after a short drag-hover.
      item.addEventListener('dragover', () => {
        if (!bmDrag) return;
        if (bmDrag.id === node.id) return;       // can't drop a folder into itself
        if (bmDragHoverAnchor === item) return;  // timer already running for this item
        cancelBmDragHover();
        bmDragHoverAnchor = item;
        item.classList.add('drag-hover');
        bmDragHoverTimer = setTimeout(() => {
          bmDragHoverAnchor = null;
          bmDragHoverTimer = null;
          dropdownNav.push({ id: node.id, title: node.title, children: node.children ?? [] });
          renderDropdown();
        }, 400);
      });
      item.addEventListener('dragleave', () => {
        if (bmDragHoverAnchor === item) cancelBmDragHover();
      });
    }

    item.addEventListener('contextmenu', (e) => {
      showBmCtxMenu(e, node);
    });

    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
      bmDrag = { id: node.id, parentId: node.parentId, index: node.index };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      clearBmDragIndicators();
      cancelBmDragHover();
      bmDrag = null;
    });

    dropdown.appendChild(item);
  });
}

function positionDropdown(anchor) {
  const dropdown = document.getElementById('bookmark-dropdown');
  const rect = anchor.getBoundingClientRect();
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.top  = `${rect.bottom + 4}px`;
  dropdown.style.maxWidth = `${window.innerWidth - rect.left - 8}px`;
}

function hideBookmarkDropdown() {
  document.getElementById('bookmark-dropdown').hidden = true;
  dropdownAnchor = null;
  dropdownNav    = [];
}

// ── Bookmark drag & drop ─────────────────────────────────────────────────────

let bmDrag            = null; // { id, parentId, index } while an item is being dragged
let bmDragHoverTimer  = null; // pending auto-open timer for a hovered folder button
let bmDragHoverAnchor = null;

function clearBmDragIndicators() {
  document.querySelectorAll('.drag-insert-above, .drag-insert-below')
    .forEach(el => el.classList.remove('drag-insert-above', 'drag-insert-below'));
}

function cancelBmDragHover() {
  clearTimeout(bmDragHoverTimer);
  bmDragHoverTimer = null;
  if (bmDragHoverAnchor) bmDragHoverAnchor.classList.remove('drag-hover');
  bmDragHoverAnchor = null;
}

function onBmDropdownDragOver(e) {
  if (!bmDrag) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const dropdown = document.getElementById('bookmark-dropdown');
  const items = [...dropdown.querySelectorAll('.bm-drop-item')];
  clearBmDragIndicators();
  if (!items.length) return;
  for (const el of items) {
    const r = el.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) {
      el.classList.add('drag-insert-above');
      return;
    }
  }
  items[items.length - 1].classList.add('drag-insert-below');
}

function onBmDropdownDragLeave(e) {
  const dropdown = document.getElementById('bookmark-dropdown');
  if (!dropdown.contains(e.relatedTarget)) clearBmDragIndicators();
}

async function onBmDropdownDrop(e) {
  if (!bmDrag) return;
  e.preventDefault();
  const current = dropdownNav[dropdownNav.length - 1];
  const targetParentId = current.id;
  const dropdown = document.getElementById('bookmark-dropdown');
  const items = [...dropdown.querySelectorAll('.bm-drop-item')];

  let targetIndex = items.length;
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { targetIndex = i; break; }
  }

  clearBmDragIndicators();

  // Don't let a folder be dropped into itself.
  if (bmDrag.id === targetParentId) { bmDrag = null; return; }

  // chrome.bookmarks.move: within the same parent, indices shift once the
  // source is removed, so a forward move needs the target minus one.
  let finalIndex = targetIndex;
  if (bmDrag.parentId === targetParentId && targetIndex > bmDrag.index) {
    finalIndex = targetIndex - 1;
  }
  const sourceId = bmDrag.id;
  const noop = bmDrag.parentId === targetParentId && finalIndex === bmDrag.index;
  bmDrag = null;
  if (noop) return;

  try {
    await chrome.bookmarks.move(sourceId, { parentId: targetParentId, index: finalIndex });
  } catch (err) {
    console.error('Bookmark move failed:', err);
  }
  // chrome.bookmarks.onMoved listener refreshes the bar and closes the dropdown.
}

// ── Bookmark context menu & edit ─────────────────────────────────────────────

let bmCtxTarget    = null; // bookmark node being acted on
let bmEditOrigin   = { x: 0, y: 0 }; // where to place the edit panel
let bmCtxOpenedAt  = 0;   // timestamp of last ctx menu open

function showBmCtxMenu(e, node) {
  e.preventDefault();
  e.stopPropagation();
  bmCtxTarget = node;

  const menu = document.getElementById('bm-ctx-menu');
  menu.hidden = false;
  menu.style.left = `${e.clientX}px`;
  menu.style.top  = `${e.clientY}px`;

  const r = menu.getBoundingClientRect();
  if (r.right  > window.innerWidth)  menu.style.left = `${e.clientX - r.width}px`;
  if (r.bottom > window.innerHeight) menu.style.top  = `${e.clientY - r.height}px`;

  bmEditOrigin  = { x: e.clientX, y: e.clientY };
  bmCtxOpenedAt = Date.now();
}

function hideBmCtxMenu() {
  document.getElementById('bm-ctx-menu').hidden = true;
}

function openBmEditPanel() {
  hideBmCtxMenu();
  hideBookmarkDropdown();
  const node  = bmCtxTarget;
  const panel = document.getElementById('bm-edit-panel');
  const urlEl = document.getElementById('bm-edit-url');

  document.getElementById('bm-edit-title').value = node.title || '';
  urlEl.value  = node.url || '';
  urlEl.hidden = !node.url; // folders have no URL field

  panel.hidden = false;
  panel.style.left = `${bmEditOrigin.x}px`;
  panel.style.top  = `${bmEditOrigin.y}px`;

  const r = panel.getBoundingClientRect();
  if (r.right  > window.innerWidth)  panel.style.left = `${bmEditOrigin.x - r.width}px`;
  if (r.bottom > window.innerHeight) panel.style.top  = `${bmEditOrigin.y - r.height}px`;

  document.getElementById('bm-edit-title').focus();
}

function closeBmEditPanel() {
  document.getElementById('bm-edit-panel').hidden = true;
  bmCtxTarget = null;
}

async function saveBmEdit() {
  if (!bmCtxTarget) return;
  const title = document.getElementById('bm-edit-title').value.trim();
  if (!title) return;

  const changes = { title };
  if (bmCtxTarget.url) {
    let url = document.getElementById('bm-edit-url').value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (url) changes.url = url;
  }

  // chrome.bookmarks.update fires chrome.bookmarks.onChanged, which the sync
  // listener uses to refresh the bar in every open YYR Tab.
  await chrome.bookmarks.update(bmCtxTarget.id, changes);
  closeBmEditPanel();
}

async function deleteBm() {
  if (!bmCtxTarget) return;
  // removeTree is required for folders; remove works only on leaf bookmarks.
  if (bmCtxTarget.url) {
    await chrome.bookmarks.remove(bmCtxTarget.id);
  } else {
    await chrome.bookmarks.removeTree(bmCtxTarget.id);
  }
  hideBmCtxMenu();
  bmCtxTarget = null;
  // chrome.bookmarks.onRemoved listener closes the dropdown and refreshes the bar.
}

// ── Theme switcher ───────────────────────────────────────────────────────────
//
// Three modes: 'day' (light), 'night' (dark), 'system' (follow OS). Day and
// night each carry their own accent color, persisted independently so toggling
// modes keeps each one's last-chosen accent.

const ACCENT_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#a855f7', // purple
  '#ec4899', // pink
  '#6366f1', // indigo
  '#84cc16', // lime
];

const DEFAULT_THEME = {
  mode: 'system',
  dayAccent: '#06b6d4',
  nightAccent: '#6366f1',
};

let theme = { ...DEFAULT_THEME };
let systemDarkMq = null;
let colorPickerOpen = false;

async function loadTheme() {
  const result = await chrome.storage.local.get('theme');
  if (result.theme && typeof result.theme === 'object') {
    theme = { ...DEFAULT_THEME, ...result.theme };
  }
}

async function saveTheme() {
  await chrome.storage.local.set({ theme });
}

// Resolve 'system' to either 'day' or 'night' based on OS preference.
function resolvedScheme() {
  if (theme.mode === 'day') return 'day';
  if (theme.mode === 'night') return 'night';
  return systemDarkMq && systemDarkMq.matches ? 'night' : 'day';
}

// Apply a theme value from outside this tab (cross-tab sync listener) — or
// re-apply in-memory state when called without args (OS scheme change, boot).
function applyTheme(newTheme) {
  if (newTheme && typeof newTheme === 'object') {
    theme = { ...DEFAULT_THEME, ...newTheme };
  }
  const scheme = resolvedScheme();
  document.documentElement.dataset.theme = scheme === 'day' ? 'light' : 'dark';
  const accent = scheme === 'day' ? theme.dayAccent : theme.nightAccent;
  document.documentElement.style.setProperty('--accent', accent);
  renderThemeSwitcher();
}

function renderThemeSwitcher() {
  document.querySelectorAll('.theme-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === theme.mode);
  });

  const colorsRow = document.getElementById('theme-colors');
  if (!colorPickerOpen || theme.mode === 'system') {
    colorsRow.hidden = true;
    return;
  }

  const currentAccent = theme.mode === 'day' ? theme.dayAccent : theme.nightAccent;
  colorsRow.innerHTML = '';
  for (const color of ACCENT_COLORS) {
    const dot = document.createElement('button');
    dot.className = 'theme-color-dot';
    dot.type = 'button';
    if (color.toLowerCase() === currentAccent.toLowerCase()) {
      dot.classList.add('selected');
    }
    dot.style.background = color;
    dot.title = color;
    dot.addEventListener('click', async () => {
      if (theme.mode === 'day') theme.dayAccent = color;
      else theme.nightAccent = color;
      await saveTheme();
    });
    colorsRow.appendChild(dot);
  }
  colorsRow.hidden = false;
}

function initThemeSwitcher() {
  // matchMedia returns a MediaQueryList; .matches is the current state and
  // 'change' fires whenever the OS preference flips (e.g., macOS Auto theme).
  systemDarkMq = window.matchMedia('(prefers-color-scheme: dark)');
  systemDarkMq.addEventListener('change', () => {
    if (theme.mode === 'system') applyTheme();
  });

  document.querySelectorAll('.theme-mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const nextMode = btn.dataset.mode;
      if (nextMode === 'system') {
        colorPickerOpen = false;
      } else if (theme.mode === nextMode) {
        // Re-clicking the active Day/Night button toggles the picker.
        colorPickerOpen = !colorPickerOpen;
      } else {
        // Switching to a different Day/Night mode opens the picker.
        colorPickerOpen = true;
      }
      if (theme.mode !== nextMode) {
        theme.mode = nextMode;
        await saveTheme();
        // chrome.storage.onChanged listener drives applyTheme for this tab
        // and every other open YYR Tab.
      } else {
        // Picker toggled but mode unchanged — no storage event will fire, so
        // refresh the switcher directly.
        renderThemeSwitcher();
      }
    });
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

// Track the focused window to deduplicate onFocusChanged events.
// WINDOW_ID_NONE (-1) fires when focus leaves Chrome entirely — ignore it.
chrome.windows.onFocusChanged.addListener((winId) => {
  if (winId === chrome.windows.WINDOW_ID_NONE) return;
  if (winId === currentWindowId) return;
  currentWindowId = winId;
  scheduleRefresh();
});

// ── Cross-tab sync ───────────────────────────────────────────────────────────
//
// chrome.storage.onChanged fires in every open new-tab page whenever any tab
// writes to storage, so it's the single channel that drives theme and shortcut
// updates across tabs. Chrome's bookmark events behave the same way — a change
// made in one tab fires onCreated/onChanged/onMoved/onRemoved in every tab, so
// they act as the sync channel for the bookmarks bar.

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.theme) applyTheme(changes.theme.newValue);
  // Skip shortcut re-renders while a drag is in flight so the DOM the user is
  // interacting with isn't wiped mid-gesture. Our own pointerup save will
  // arrive moments later and refresh every tab cleanly.
  if (changes.shortcuts && !dragState) applyShortcuts(changes.shortcuts.newValue);
});

function refreshBookmarksFromChange() {
  hideBookmarkDropdown();
  loadBookmarksBar();
  scheduleRefresh();
}
chrome.bookmarks.onCreated.addListener(refreshBookmarksFromChange);
chrome.bookmarks.onChanged.addListener(refreshBookmarksFromChange);
chrome.bookmarks.onMoved.addListener(refreshBookmarksFromChange);
chrome.bookmarks.onRemoved.addListener(refreshBookmarksFromChange);
chrome.bookmarks.onChildrenReordered.addListener(refreshBookmarksFromChange);

// ── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Wire up the inline form buttons and keyboard shortcuts.
  document.getElementById('sf-save').addEventListener('click', submitEditForm);
  document.getElementById('sf-cancel').addEventListener('click', cancelEditForm);
  document.getElementById('sf-name').addEventListener('keydown', handleFormKeydown);
  document.getElementById('sf-url').addEventListener('keydown', handleFormKeydown);

  // Wire up the shortcut drag-and-drop pointer handlers once (event-delegated
  // on the grid so dynamically-rendered slots don't need per-element binding).
  const shortcutsEl = document.getElementById('shortcuts');
  shortcutsEl.addEventListener('pointerdown',   onShortcutPointerDown);
  shortcutsEl.addEventListener('pointermove',   onShortcutPointerMove);
  shortcutsEl.addEventListener('pointerup',     onShortcutPointerUp);
  shortcutsEl.addEventListener('pointercancel', onShortcutPointerUp);
  // Capture-phase so we can swallow the post-drag synthetic click before the
  // slot's own "open URL" listener sees it.
  shortcutsEl.addEventListener('click', onShortcutClickCapture, true);

  // Wire up the context menu actions.
  document.getElementById('ctx-edit').addEventListener('click', () => {
    const i = ctxSlotIndex;
    hideContextMenu();
    openEditForm(i);
  });
  document.getElementById('ctx-remove').addEventListener('click', async () => {
    shortcuts.splice(ctxSlotIndex, 1);
    shortcuts.push(null);
    hideContextMenu();
    await saveShortcuts();
  });

  // Prevent clicks inside either bookmark floating element from bubbling to the
  // document dismissal handler — without this, clicking "Edit" would open the
  // panel and then immediately close it because the click target is not inside
  // #bm-edit-panel, triggering closeBmEditPanel() on the same event.
  document.getElementById('bm-ctx-menu').addEventListener('click', (e) => e.stopPropagation());
  document.getElementById('bm-edit-panel').addEventListener('click', (e) => e.stopPropagation());

  // Bookmark context menu actions.
  document.getElementById('bm-ctx-edit').addEventListener('click', openBmEditPanel);
  document.getElementById('bm-ctx-delete').addEventListener('click', deleteBm);

  // Bookmark edit panel actions.
  document.getElementById('bm-edit-save').addEventListener('click', saveBmEdit);
  document.getElementById('bm-edit-cancel').addEventListener('click', closeBmEditPanel);
  document.getElementById('bm-edit-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  saveBmEdit();
    if (e.key === 'Escape') closeBmEditPanel();
  });
  document.getElementById('bm-edit-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  saveBmEdit();
    if (e.key === 'Escape') closeBmEditPanel();
  });

  // Dropdown-wide drag listeners: insertion indicator + drop handler.
  const bmDropdown = document.getElementById('bookmark-dropdown');
  bmDropdown.addEventListener('dragover',  onBmDropdownDragOver);
  bmDropdown.addEventListener('dragleave', onBmDropdownDragLeave);
  bmDropdown.addEventListener('drop',      onBmDropdownDrop);

  // Any click outside floating panels dismisses them.
  // button !== 0 means right-click or middle-click — ignore those so a
  // right-click on a bookmark doesn't instantly hide the context menu.
  document.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    if (!document.getElementById('ctx-menu').contains(e.target)) {
      hideContextMenu();
    }
    if (!document.getElementById('bookmark-dropdown').contains(e.target)) {
      hideBookmarkDropdown();
    }
    if (!document.getElementById('bm-ctx-menu').contains(e.target) && Date.now() - bmCtxOpenedAt > 300) {
      hideBmCtxMenu();
    }
    if (!document.getElementById('bm-edit-panel').contains(e.target)) {
      closeBmEditPanel();
    }
    if (colorPickerOpen && !document.getElementById('theme-switcher').contains(e.target)) {
      colorPickerOpen = false;
      renderThemeSwitcher();
    }
  });

  document.querySelectorAll('.util-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.tabs.create({ url: btn.dataset.url });
    });
  });

  const searchEl = document.getElementById('search');
  const clearBtn = document.getElementById('search-clear');

  searchEl.addEventListener('input', () => {
    clearBtn.hidden = searchEl.value.length === 0;
    render();
  });

  clearBtn.addEventListener('click', () => {
    searchEl.value = '';
    clearBtn.hidden = true;
    searchEl.focus();
    render();
  });

  // Initialise the click firework canvas, then wire the global click listener.
  // Listener is on document so it fires regardless of which element was clicked.
  initClickFx();
  document.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    if (!shouldSpawnFxOn(e.target)) return;
    spawnFirework(e.clientX, e.clientY);
  });

  // Theme: load + apply before first paint to avoid a flash of the wrong scheme.
  await loadTheme();
  initThemeSwitcher();
  applyTheme();

  // Resolve the current window id before the first render so the active-window
  // highlight is correct on the very first paint.
  try {
    const win = await chrome.windows.getCurrent();
    currentWindowId = win.id;
  } catch (err) {
    console.error('getCurrent window failed:', err);
  }

  // Load persisted shortcuts before first paint, then render all sections.
  await loadShortcuts();
  renderShortcuts();
  loadBookmarksBar();
  render();
});
