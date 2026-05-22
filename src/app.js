const SESSION_KEY = 'ridge-session';
const ICON_KEY = 'ridge-icons';
const FEEDS_WIDTH_KEY = 'ridge-feeds-width';
const API_BASE = '/v1';
const ITEMS_LIMIT = 25;
const MIN_FEEDS_WIDTH = 128;
const MAX_FEEDS_WIDTH_RATIO = 0.6;

const loadJSON = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};
const saveJSON = (key, val) => localStorage.setItem(key, JSON.stringify(val));

const formatDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  if (now - d < 60000) return 'now';
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.floor((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 30) return `${days} days`;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const articleDoc = (html) => {
  const serif = 'ui-serif,Georgia,"Times New Roman","Songti SC","STSong","Hiragino Mincho ProN","Yu Mincho","Source Han Serif SC","Noto Serif CJK SC",serif';
  const css =
    'html{scrollbar-width:none}'
    + 'html::-webkit-scrollbar{display:none}'
    + `body{font-family:${serif};background:#f4ecd8;color:#3a2f1f;padding:1.5rem 2rem;line-height:1.75;margin:0}`
    + 'img,video{max-width:100%;height:auto}'
    + 'a{color:#8b4513}'
    + 'pre{white-space:pre-wrap;word-wrap:break-word}';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>${css}</style></head><body>${html || ''}</body></html>`;
};

const fitIframe = (iframe) => {
  const doc = iframe.contentDocument;
  if (!doc) return;
  iframe.style.height = `${doc.documentElement.scrollHeight}px`;
};

const mountArticleIframe = (container, content) => {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.srcdoc = articleDoc(content);
  iframe.addEventListener('load', () => {
    fitIframe(iframe);
    const doc = iframe.contentDocument;
    if (doc && window.ResizeObserver) {
      new ResizeObserver(() => fitIframe(iframe)).observe(doc.body);
    }
  });
  container.appendChild(iframe);
};

const authHeader = () => {
  const s = loadJSON(SESSION_KEY);
  return s ? `Basic ${s.auth}` : null;
};

window.app = () => ({
  authed: !!loadJSON(SESSION_KEY),
  loginError: '',
  feeds: [],
  counts: {},
  iconsById: {},
  activeFeedId: null,
  entries: [],
  entriesTotal: 0,
  entriesLoading: false,
  expandedEntryId: null,
  deletedFeed: null,
  feedsWidth: localStorage.getItem(FEEDS_WIDTH_KEY) || '16rem',

  formatDate,

  async init() {
    this.iconsById = loadJSON(ICON_KEY) || {};
    if (this.authed) await this.loadFeeds();
  },

  get activeFeed() {
    return this.feeds.find((f) => f.id === this.activeFeedId);
  },

  iconFor(feed) {
    const id = feed.icon && feed.icon.icon_id;
    return id ? this.iconsById[id] : null;
  },

  async apiCall(path, init = {}) {
    const auth = authHeader();
    if (!auth) { this.resetAll(); throw new Error('No session'); }
    const headers = { Authorization: auth, ...(init.headers || {}) };
    const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
    if (res.status === 401) { this.resetAll(); throw new Error('Unauthorized'); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  },

  async apiGet(path) {
    const res = await this.apiCall(path);
    return res.json();
  },

  async apiPut(path, body) {
    await this.apiCall(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  async signIn(form) {
    this.loginError = '';
    try {
      const auth = btoa(`${form.user.value}:${form.password.value}`);
      const res = await fetch(`${API_BASE}/me`, { headers: { Authorization: `Basic ${auth}` } });
      if (res.status === 401) throw new Error('Authentication failed');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      saveJSON(SESSION_KEY, { auth });
      this.authed = true;
      form.reset();
      await this.loadFeeds();
    } catch (err) {
      this.loginError = err.message;
    }
  },

  resetAll() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ICON_KEY);
    this.authed = false;
    this.feeds = [];
    this.counts = {};
    this.iconsById = {};
    this.entries = [];
    this.activeFeedId = null;
  },

  signOut() { this.resetAll(); },

  async loadFeeds() {
    try {
      this.feeds = await this.apiGet('/feeds');
      this.loadCounters().catch(() => {});
      this.loadIcons().catch(() => {});
    } catch { /* handled in apiCall */ }
  },

  async loadCounters() {
    const r = await this.apiGet('/feeds/counters');
    this.counts = r.unreads || {};
  },

  async loadIcons() {
    const ids = [...new Set(
      this.feeds.map((f) => f.icon && f.icon.icon_id).filter(Boolean),
    )];
    const missing = ids.filter((id) => !(id in this.iconsById));
    if (!missing.length) return;
    const fetched = {};
    await Promise.all(missing.map(async (id) => {
      try {
        const icon = await this.apiGet(`/icons/${id}`);
        fetched[id] = icon.data;
      } catch { /* skip */ }
    }));
    this.iconsById = { ...this.iconsById, ...fetched };
    saveJSON(ICON_KEY, this.iconsById);
  },

  entriesUrl(id, offset) {
    return `/feeds/${id}/entries?order=published_at&direction=desc&limit=${ITEMS_LIMIT}&offset=${offset}`;
  },

  async selectFeed(id) {
    this.activeFeedId = id;
    this.entries = [];
    this.entriesTotal = 0;
    this.expandedEntryId = null;
    this.deletedFeed = null;
    try {
      const r = await this.apiGet(this.entriesUrl(id, 0));
      this.entries = (r.entries || []).map((e) => ({ ...e, fetching: false }));
      this.entriesTotal = r.total || 0;
    } catch { /* handled in apiCall */ }
  },

  async unsubscribe() {
    const feed = this.activeFeed;
    if (!feed) return;
    if (!confirm(`Unsubscribe from "${feed.title}"?`)) return;
    try {
      await this.apiCall(`/feeds/${feed.id}`, { method: 'DELETE' });
      this.deletedFeed = {
        feed_url: feed.feed_url,
        title: feed.title,
        category_id: feed.category && feed.category.id,
      };
      this.feeds = this.feeds.filter((f) => f.id !== feed.id);
      delete this.counts[feed.id];
      this.entries = [];
      this.entriesTotal = 0;
      this.expandedEntryId = null;
    } catch (err) {
      alert(`Unsubscribe failed: ${err.message}`);
    }
  },

  async resubscribe() {
    const dl = this.deletedFeed;
    if (!dl) return;
    try {
      const res = await this.apiCall('/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feed_url: dl.feed_url, category_id: dl.category_id }),
      });
      const { feed_id } = await res.json();
      this.deletedFeed = null;
      this.feeds = await this.apiGet('/feeds');
      this.loadCounters().catch(() => {});
      this.loadIcons().catch(() => {});
      if (feed_id) await this.selectFeed(feed_id);
    } catch (err) {
      alert(`Resubscribe failed: ${err.message}`);
    }
  },

  get hasMoreEntries() {
    return this.entries.length < this.entriesTotal;
  },

  async loadMoreEntries() {
    if (this.entriesLoading || !this.activeFeedId || !this.hasMoreEntries) return;
    this.entriesLoading = true;
    try {
      const r = await this.apiGet(this.entriesUrl(this.activeFeedId, this.entries.length));
      const more = (r.entries || []).map((e) => ({ ...e, fetching: false }));
      this.entries = [...this.entries, ...more];
      this.entriesTotal = r.total ?? this.entriesTotal;
    } catch { /* handled in apiCall */ }
    finally { this.entriesLoading = false; }
  },

  onEntryScroll(el) {
    if (!this.hasMoreEntries || this.entriesLoading) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) this.loadMoreEntries();
  },

  toggleExpanded(entry) {
    this.expandedEntryId = this.expandedEntryId === entry.id ? null : entry.id;
  },

  scrollEntryIntoView(id) {
    setTimeout(() => {
      const li = document.querySelector(`#entry-list .entry[data-entry-id="${id}"]`);
      if (li) li.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 0);
  },

  nextEntry() {
    if (!this.entries.length) return;
    const i = this.entries.findIndex((e) => e.id === this.expandedEntryId);
    const next = this.entries[i + 1];
    if (!next) return;
    this.expandedEntryId = next.id;
    this.scrollEntryIntoView(next.id);
  },

  prevEntry() {
    if (!this.entries.length) return;
    const i = this.entries.findIndex((e) => e.id === this.expandedEntryId);
    if (i <= 0) return;
    const prev = this.entries[i - 1];
    this.expandedEntryId = prev.id;
    this.scrollEntryIntoView(prev.id);
  },

  handleKey(e) {
    if (e.target.matches && e.target.matches('input, textarea, select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'a' && e.shiftKey) {
      e.preventDefault();
      this.markAll('read');
    } else if (k === 'j' && !e.shiftKey) {
      e.preventDefault();
      this.nextEntry();
    } else if (k === 'k' && !e.shiftKey) {
      e.preventDefault();
      this.prevEntry();
    } else if (k === 'g' && e.shiftKey) {
      const entry = this.entries.find((x) => x.id === this.expandedEntryId);
      if (!entry) return;
      e.preventDefault();
      this.fetchContent(entry);
    }
  },

  async setEntryStatus(entry, status) {
    const prev = entry.status;
    if (prev === status) return;
    const delta = (status === 'read' ? -1 : 0) + (prev === 'read' ? 1 : 0);
    entry.status = status;
    if (delta) this.counts[entry.feed_id] = Math.max(0, (this.counts[entry.feed_id] || 0) + delta);
    try {
      await this.apiPut('/entries', { entry_ids: [entry.id], status });
    } catch {
      entry.status = prev;
      if (delta) this.counts[entry.feed_id] = Math.max(0, (this.counts[entry.feed_id] || 0) - delta);
    }
  },

  toggleStatus(entry) {
    this.setEntryStatus(entry, entry.status === 'read' ? 'unread' : 'read');
  },

  async markAll(targetStatus) {
    if (!this.activeFeedId) return;
    const feedId = this.activeFeedId;

    if (targetStatus === 'read') {
      const prevStatuses = this.entries.map((e) => e.status);
      const prevCount = this.counts[feedId] || 0;
      for (const e of this.entries) e.status = 'read';
      this.counts[feedId] = 0;
      try {
        await this.apiCall(`/feeds/${feedId}/mark-all-as-read`, { method: 'PUT' });
      } catch {
        this.entries.forEach((e, i) => { e.status = prevStatuses[i]; });
        this.counts[feedId] = prevCount;
      }
      return;
    }

    const candidates = this.entries.filter((e) => e.status !== 'unread');
    if (!candidates.length) return;
    const ids = candidates.map((e) => e.id);
    const delta = candidates.length;
    for (const e of candidates) e.status = 'unread';
    this.counts[feedId] = (this.counts[feedId] || 0) + delta;
    try {
      await this.apiPut('/entries', { entry_ids: ids, status: 'unread' });
    } catch {
      for (const e of candidates) e.status = 'read';
      this.counts[feedId] = Math.max(0, (this.counts[feedId] || 0) - delta);
    }
  },

  async fetchContent(entry) {
    if (entry.fetching) return;
    entry.fetching = true;
    try {
      const r = await this.apiGet(`/entries/${entry.id}/fetch-content?update_content=true`);
      entry.content = r.content;
      const det = document.querySelector('#entry-list details[open]');
      const container = det && det.querySelector('.entry-body');
      const iframe = container && container.querySelector('iframe');
      if (iframe) iframe.srcdoc = articleDoc(r.content);
      else if (container) mountArticleIframe(container, r.content);
    } catch { /* leave existing content */ }
    finally { entry.fetching = false; }
  },

  onToggle(event, entry) {
    const det = event.target;
    if (!det.open) return;
    const body = det.querySelector('.entry-body');
    if (body && !body.querySelector('iframe')) mountArticleIframe(body, entry.content);
    if (entry.status === 'unread') this.setEntryStatus(entry, 'read');
  },
});

window.resizer = () => ({
  dragging: false,
  start() {
    this.dragging = true;
    document.body.classList.add('resizing');
  },
  onMove(e) {
    if (!this.dragging) return;
    const max = window.innerWidth * MAX_FEEDS_WIDTH_RATIO;
    const w = Math.max(MIN_FEEDS_WIDTH, Math.min(max, e.clientX));
    this.$root.feedsWidth = `${w}px`;
  },
  onEnd() {
    if (!this.dragging) return;
    this.dragging = false;
    document.body.classList.remove('resizing');
    localStorage.setItem(FEEDS_WIDTH_KEY, this.$root.feedsWidth);
  },
});
