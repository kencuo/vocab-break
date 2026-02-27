/*
 * Vocab Break (Word Drill) - SillyTavern Extension
 * - Show a floating word-drill panel while AI is generating
 * - Fetch wordlists from remote GitHub raw URLs
 */

import { getContext } from '/scripts/extensions.js';
import { getStringHash } from '/scripts/utils.js';

const MODULE_NAME = 'vocab-break';
const STORAGE_PREFIX = 'vocab-break';

const SOURCES = [
  {
    id: 'kaoyan',
    label: '考研词汇（Apache-2.0）',
    url: 'https://raw.githubusercontent.com/vxiaozhi/vocabulary-book-by-deepseek/main/data/kaoyan/kaoyan-words.json',
    license: 'Apache-2.0',
  },
  {
    id: 'netem',
    label: 'NETEM 词汇（CC BY-NC-SA）',
    url: 'https://raw.githubusercontent.com/exam-data/NETEMVocabulary/master/netem_full_list.json',
    license: 'CC BY-NC-SA',
  },
  {
    id: 'beidanci',
    label: '背单词（GPL-3.0 TXT）',
    url: 'https://raw.githubusercontent.com/sioomy/beidanci/master/guodu.txt',
    license: 'GPL-3.0',
  },
  {
    id: 'cet4-txt',
    label: 'CET-4 四级词汇（TXT · 许可未知）',
    url: 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/3%20%E5%9B%9B%E7%BA%A7-%E4%B9%B1%E5%BA%8F.txt',
    license: '未知',
  },
  {
    id: 'cet6-txt',
    label: 'CET-6 六级词汇（TXT · 许可未知）',
    url: 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/4%20%E5%85%AD%E7%BA%A7-%E4%B9%B1%E5%BA%8F.txt',
    license: '未知',
  },
  {
    id: 'cet4-json',
    label: 'CET-4 四级词汇（JSON · 许可未知）',
    url: 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/json/3-CET4-%E9%A1%BA%E5%BA%8F.json',
    license: '未知',
  },
  {
    id: 'cet6-json',
    label: 'CET-6 六级词汇（JSON · 许可未知）',
    url: 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/json/4-CET6-%E9%A1%BA%E5%BA%8F.json',
    license: '未知',
  },
  {
    id: 'custom',
    label: '自定义链接',
    url: '',
    license: '未知',
  },
];

const REMOTE_SOURCES = [
  {
    id: 'openstax-econ',
    label: '经济学（OpenStax · CC BY）',
    indexUrl: 'https://raw.githubusercontent.com/philschatz/economics-book/master/SUMMARY.md',
    chapterPrefix: 'https://raw.githubusercontent.com/philschatz/economics-book/master/contents/',
    type: 'summary-md',
  },
];

const DEFAULT_READER_SYSTEM_PROMPT = `你是{{char}}，正在与{{user}}一起阅读。根据阅读内容与对话给出回复，保持{{char}}的语气和性格。
输出要符合人设，说{{char}}想说并应该说的话。比如（仅打个比方）可包含：简评、要点/情节、人物/观点、继续阅读建议。
若信息不足，请先提出你需要的具体内容。`;

const DEFAULT_CONFIG = {
  enabled: true,
  enableDrill: true,
  enableReader: false,
  autoOpenOnGeneration: true,
  autoCloseOnEnd: false,
  sourceId: 'kaoyan',
  customUrl: '',
  rememberPanel: true,
  panelOpen: false,
  readerPanelOpen: false,
  showMeaning: false,
  mode: 'drill',
  theme: 'minimal',
  customCss: '',
  settingsOpen: false,
  panelPos: null,
  readerPanelPos: null,
  panelWidth: 320,
  panelHeight: 420,
  readerPanelWidth: 360,
  readerPanelHeight: 520,
  readerRemoteSourceId: 'openstax-econ',
  readerRemoteChapterUrl: '',
  readerRemoteCollapsed: false,
  readerLibraryCollapsed: false,
  readerToolsCollapsed: false,
  readerBookmarksOpen: false,
  readerCacheMaxBytes: 32 * 1024 * 1024,
  readerPageSize: 900,
  readerFontSize: 14,
  readerLineHeight: 1.6,
  readerEncoding: 'auto',
  readerKeepScroll: true,
  readerHistoryEnabled: true,
  readerHistoryStartPage: 0,
  readerMaxPage: 0,
  chatDockOpen: false,
  apiProvider: 'custom',
  apiEndpoint: '',
  apiKey: '',
  apiModel: '',
  apiStream: true,
  jailbreakPrompt: '',
};

let pluginConfig = { ...DEFAULT_CONFIG };

const state = {
  panelOpen: false,
  readerPanelOpen: false,
  pinned: false,
  items: [],
  index: 0,
  loading: false,
  error: '',
  sourceId: '',
  sourceUrl: '',
  sourceLabel: '',
  sourceLicense: '',
  known: new Set(),
  statusMap: new Map(),
  cycle: {
    size: 20,
    newList: [],
    reviewList: [],
    index: 0,
    phase: 'new',
    dirty: true,
  },
  familiarStreak: new Map(),
  reader: {
    text: '',
    pages: [],
    pageIndex: 0,
    title: '',
    updatedAt: 0,
    cacheDisabled: false,
    pendingScrollTop: null,
    bookKey: '',
    bookTitle: '',
    lastPage: 0,
    maxPage: 0,
    bookmarks: [],
    library: {
      items: [],
      selectedId: '',
      loading: false,
      error: '',
    },
  },
  chat: {
    messages: [],
    sending: false,
    error: '',
    models: [],
    modelsLoading: false,
    modelsError: '',
  },
  remote: {
    sourceId: '',
    chapters: [],
    selectedUrl: '',
    loadingIndex: false,
    loadingChapter: false,
    error: '',
    updatedAt: 0,
  },
  drag: {
    active: false,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
    moved: false,
    justDragged: false,
    target: '',
  },
};

const READER_CONTENT_KEY = `${STORAGE_PREFIX}:reader:content`;
const READER_META_KEY = `${STORAGE_PREFIX}:reader:meta`;
const READER_DB_NAME = `${STORAGE_PREFIX}:reader-db`;
const READER_DB_STORE = 'reader';
const READER_CONTENT_IDB_KEY = 'content';
const READER_META_IDB_KEY = 'meta';
const READER_LIBRARY_INDEX_KEY = 'library:index';
const READER_LIBRARY_ITEM_PREFIX = 'library:item:';
const READER_LIBRARY_MAX_ITEMS = 20;
const READER_BOOKMARKS_KEY = `${STORAGE_PREFIX}:reader:bookmarks`;
const LEGACY_READER_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const THEME_PREFIX = 'vb-theme-';
const CUSTOM_STYLE_ID = 'vocab-break-custom-style';
const STATUS_VALUES = ['unknown', 'fuzzy', 'familiar'];
const DRAG_MARGIN = 6;
const TEXT_ENCODINGS = [
  { id: 'auto', label: '自动识别' },
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'gbk', label: 'GBK' },
  { id: 'big5', label: 'Big5' },
  { id: 'utf-16le', label: 'UTF-16LE' },
  { id: 'utf-16be', label: 'UTF-16BE' },
];

const API_PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com/v1',
  },
  {
    id: 'claude',
    label: 'Claude',
    defaultEndpoint: 'https://api.anthropic.com/v1',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
  },
  {
    id: 'grok',
    label: 'Grok',
    defaultEndpoint: 'https://api.x.ai/v1',
  },
  {
    id: 'custom',
    label: '自定义',
    defaultEndpoint: '',
  },
];

function initConfig() {
  const ctx = getContext();
  ctx.extensionSettings = ctx.extensionSettings || {};
  const existing = ctx.extensionSettings[MODULE_NAME] || {};
  pluginConfig = { ...DEFAULT_CONFIG, ...existing };
  if (!SOURCES.some(s => s.id === pluginConfig.sourceId)) {
    pluginConfig.sourceId = DEFAULT_CONFIG.sourceId;
  }
  pluginConfig.readerPageSize = Number.isFinite(Number(pluginConfig.readerPageSize))
    ? Number(pluginConfig.readerPageSize)
    : DEFAULT_CONFIG.readerPageSize;
  pluginConfig.readerCacheMaxBytes = Number.isFinite(Number(pluginConfig.readerCacheMaxBytes))
    ? Number(pluginConfig.readerCacheMaxBytes)
    : DEFAULT_CONFIG.readerCacheMaxBytes;
  if (pluginConfig.readerCacheMaxBytes === LEGACY_READER_CACHE_MAX_BYTES) {
    pluginConfig.readerCacheMaxBytes = DEFAULT_CONFIG.readerCacheMaxBytes;
  }
  pluginConfig.readerFontSize = Number.isFinite(Number(pluginConfig.readerFontSize))
    ? Number(pluginConfig.readerFontSize)
    : DEFAULT_CONFIG.readerFontSize;
  pluginConfig.readerLineHeight = Number.isFinite(Number(pluginConfig.readerLineHeight))
    ? Number(pluginConfig.readerLineHeight)
    : DEFAULT_CONFIG.readerLineHeight;
  pluginConfig.readerKeepScroll =
    typeof pluginConfig.readerKeepScroll === 'boolean'
      ? pluginConfig.readerKeepScroll
      : DEFAULT_CONFIG.readerKeepScroll;
  if (!TEXT_ENCODINGS.some(encoding => encoding.id === String(pluginConfig.readerEncoding || ''))) {
    pluginConfig.readerEncoding = DEFAULT_CONFIG.readerEncoding;
  }
  pluginConfig.readerHistoryEnabled =
    typeof pluginConfig.readerHistoryEnabled === 'boolean'
      ? pluginConfig.readerHistoryEnabled
      : DEFAULT_CONFIG.readerHistoryEnabled;
  pluginConfig.readerHistoryStartPage = Number.isFinite(Number(pluginConfig.readerHistoryStartPage))
    ? Math.max(0, Number(pluginConfig.readerHistoryStartPage))
    : DEFAULT_CONFIG.readerHistoryStartPage;
  pluginConfig.readerMaxPage = Number.isFinite(Number(pluginConfig.readerMaxPage))
    ? Math.max(0, Number(pluginConfig.readerMaxPage))
    : DEFAULT_CONFIG.readerMaxPage;
  pluginConfig.readerBookmarksOpen =
    typeof pluginConfig.readerBookmarksOpen === 'boolean'
      ? pluginConfig.readerBookmarksOpen
      : DEFAULT_CONFIG.readerBookmarksOpen;
  pluginConfig.chatDockOpen =
    typeof pluginConfig.chatDockOpen === 'boolean' ? pluginConfig.chatDockOpen : DEFAULT_CONFIG.chatDockOpen;
  pluginConfig.apiProvider = API_PROVIDERS.some(p => p.id === pluginConfig.apiProvider)
    ? pluginConfig.apiProvider
    : DEFAULT_CONFIG.apiProvider;
  pluginConfig.apiEndpoint = typeof pluginConfig.apiEndpoint === 'string' ? pluginConfig.apiEndpoint : '';
  pluginConfig.apiKey = typeof pluginConfig.apiKey === 'string' ? pluginConfig.apiKey : '';
  pluginConfig.apiModel = typeof pluginConfig.apiModel === 'string' ? pluginConfig.apiModel : '';
  pluginConfig.apiStream =
    typeof pluginConfig.apiStream === 'boolean' ? pluginConfig.apiStream : DEFAULT_CONFIG.apiStream;
  pluginConfig.jailbreakPrompt = typeof pluginConfig.jailbreakPrompt === 'string' ? pluginConfig.jailbreakPrompt : '';
  if (!pluginConfig.apiEndpoint) {
    const provider = API_PROVIDERS.find(p => p.id === pluginConfig.apiProvider);
    if (provider?.defaultEndpoint) {
      pluginConfig.apiEndpoint = provider.defaultEndpoint;
    }
  }
  if (!['minimal', 'archive', 'ancient', 'custom'].includes(pluginConfig.theme)) {
    pluginConfig.theme = DEFAULT_CONFIG.theme;
  }
  if (!['drill', 'reader'].includes(pluginConfig.mode)) {
    pluginConfig.mode = DEFAULT_CONFIG.mode;
  }
  const hasEnableDrill = typeof pluginConfig.enableDrill === 'boolean';
  const hasEnableReader = typeof pluginConfig.enableReader === 'boolean';
  if (!hasEnableDrill && !hasEnableReader) {
    if (pluginConfig.enabled === false) {
      pluginConfig.enableDrill = false;
      pluginConfig.enableReader = false;
    } else if (pluginConfig.mode === 'reader') {
      pluginConfig.enableDrill = false;
      pluginConfig.enableReader = true;
    } else {
      pluginConfig.enableDrill = true;
      pluginConfig.enableReader = false;
    }
  } else {
    if (!hasEnableDrill) pluginConfig.enableDrill = false;
    if (!hasEnableReader) pluginConfig.enableReader = false;
  }
  if (pluginConfig.enableDrill && pluginConfig.enableReader) {
    if (pluginConfig.mode === 'reader') {
      pluginConfig.enableDrill = false;
    } else {
      pluginConfig.enableReader = false;
    }
  }
  pluginConfig.enabled = !!(pluginConfig.enableDrill || pluginConfig.enableReader);
  if (!REMOTE_SOURCES.some(s => s.id === pluginConfig.readerRemoteSourceId)) {
    pluginConfig.readerRemoteSourceId = DEFAULT_CONFIG.readerRemoteSourceId;
  }
  pluginConfig.readerRemoteCollapsed =
    typeof pluginConfig.readerRemoteCollapsed === 'boolean'
      ? pluginConfig.readerRemoteCollapsed
      : DEFAULT_CONFIG.readerRemoteCollapsed;
  pluginConfig.readerLibraryCollapsed =
    typeof pluginConfig.readerLibraryCollapsed === 'boolean'
      ? pluginConfig.readerLibraryCollapsed
      : DEFAULT_CONFIG.readerLibraryCollapsed;
  pluginConfig.readerToolsCollapsed =
    typeof pluginConfig.readerToolsCollapsed === 'boolean'
      ? pluginConfig.readerToolsCollapsed
      : DEFAULT_CONFIG.readerToolsCollapsed;
  pluginConfig.customCss = typeof pluginConfig.customCss === 'string' ? pluginConfig.customCss : '';
  pluginConfig.settingsOpen =
    typeof pluginConfig.settingsOpen === 'boolean' ? pluginConfig.settingsOpen : DEFAULT_CONFIG.settingsOpen;
  pluginConfig.panelWidth = Number.isFinite(Number(pluginConfig.panelWidth))
    ? Number(pluginConfig.panelWidth)
    : DEFAULT_CONFIG.panelWidth;
  pluginConfig.panelHeight = Number.isFinite(Number(pluginConfig.panelHeight))
    ? Number(pluginConfig.panelHeight)
    : DEFAULT_CONFIG.panelHeight;
  pluginConfig.readerPanelWidth = Number.isFinite(Number(pluginConfig.readerPanelWidth))
    ? Number(pluginConfig.readerPanelWidth)
    : DEFAULT_CONFIG.readerPanelWidth;
  pluginConfig.readerPanelHeight = Number.isFinite(Number(pluginConfig.readerPanelHeight))
    ? Number(pluginConfig.readerPanelHeight)
    : DEFAULT_CONFIG.readerPanelHeight;
  if (
    !pluginConfig.panelPos ||
    !Number.isFinite(pluginConfig.panelPos.x) ||
    !Number.isFinite(pluginConfig.panelPos.y)
  ) {
    pluginConfig.panelPos = DEFAULT_CONFIG.panelPos;
  }
  if (
    !pluginConfig.readerPanelPos ||
    !Number.isFinite(pluginConfig.readerPanelPos.x) ||
    !Number.isFinite(pluginConfig.readerPanelPos.y)
  ) {
    pluginConfig.readerPanelPos = DEFAULT_CONFIG.readerPanelPos;
  }
  ctx.extensionSettings[MODULE_NAME] = pluginConfig;
}

function saveSettings() {
  const ctx = getContext();
  ctx.extensionSettings[MODULE_NAME] = pluginConfig;
  ctx.saveSettingsDebounced();
}

function getActiveSource() {
  const id = pluginConfig.sourceId;
  const base = SOURCES.find(s => s.id === id) || SOURCES[0];
  if (base.id === 'custom') {
    return {
      ...base,
      url: (pluginConfig.customUrl || '').trim(),
    };
  }
  return base;
}

function getCacheKey(url) {
  return `${STORAGE_PREFIX}:cache:${getStringHash(url)}`;
}

function getKnownKey(url) {
  return `${STORAGE_PREFIX}:known:${getStringHash(url)}`;
}

function getStatusKey(url) {
  return `${STORAGE_PREFIX}:status:${getStringHash(url)}`;
}

function getStreakKey(url) {
  return `${STORAGE_PREFIX}:streak:${getStringHash(url)}`;
}

function loadKnown(url) {
  state.known = new Set();
  if (!url) return;
  const key = getKnownKey(url);
  const raw = localStorage.getItem(key);
  if (!raw) return;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const v of arr) state.known.add(String(v));
    }
  } catch {
    // ignore bad cache
  }
}

function saveKnown(url) {
  if (!url) return;
  const key = getKnownKey(url);
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(state.known)));
  } catch {
    // ignore storage errors
  }
}

function loadStatus(url) {
  state.statusMap = new Map();
  if (!url) return;
  const key = getStatusKey(url);
  const raw = localStorage.getItem(key);
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      for (const [word, status] of Object.entries(obj)) {
        if (STATUS_VALUES.includes(status)) {
          state.statusMap.set(word, status);
        }
      }
    }
  } catch {
    // ignore bad cache
  }
}

function saveStatus(url) {
  if (!url) return;
  const key = getStatusKey(url);
  try {
    const obj = {};
    for (const [word, status] of state.statusMap.entries()) {
      obj[word] = status;
    }
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {
    // ignore storage errors
  }
}

function loadStreak(url) {
  state.familiarStreak = new Map();
  if (!url) return;
  const key = getStreakKey(url);
  const raw = localStorage.getItem(key);
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      for (const [word, count] of Object.entries(obj)) {
        const n = Number(count);
        if (Number.isFinite(n) && n > 0) {
          state.familiarStreak.set(word, n);
        }
      }
    }
  } catch {
    // ignore bad cache
  }
}

function saveStreak(url) {
  if (!url) return;
  const key = getStreakKey(url);
  try {
    const obj = {};
    for (const [word, count] of state.familiarStreak.entries()) {
      if (Number.isFinite(count) && count > 0) {
        obj[word] = count;
      }
    }
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {
    // ignore storage errors
  }
}

function loadCache(url) {
  if (!url) return null;
  const key = getCacheKey(url);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw);
    if (!cached || !Array.isArray(cached.items)) return null;
    return cached;
  } catch {
    return null;
  }
}

function saveCache(url, payload) {
  if (!url) return;
  const key = getCacheKey(url);
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function getRemoteSource() {
  const id = pluginConfig.readerRemoteSourceId;
  return REMOTE_SOURCES.find(s => s.id === id) || REMOTE_SOURCES[0];
}

function normalizeRemotePath(path, ext) {
  let clean = String(path || '').trim();
  if (!clean) return '';
  if (clean.startsWith('./')) clean = clean.slice(2);
  if (clean.startsWith('/')) clean = clean.slice(1);
  if (ext && !clean.endsWith(ext)) clean += ext;
  return clean;
}

function parseSummaryMarkdown(text, prefix) {
  const items = [];
  const seen = new Set();
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match = null;
  while ((match = re.exec(text))) {
    const title = match[1]?.trim();
    const rawPath = match[2]?.trim();
    if (!rawPath || !rawPath.includes('contents/')) continue;
    const cleanPath = rawPath.replace(/^.*contents\//, '');
    const url = `${prefix}${cleanPath}`;
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ title: title || cleanPath, url });
  }
  return items;
}

function parseTocYaml(text, prefix, ext) {
  const items = [];
  let lastItem = null;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const fileMatch = line.match(/file:\s*([^\s#]+)/);
    if (fileMatch) {
      const cleanPath = normalizeRemotePath(fileMatch[1], ext);
      if (!cleanPath) continue;
      const url = `${prefix}${cleanPath}`;
      const title = cleanPath
        .replace(/\.(md|ipynb)$/i, '')
        .split('/')
        .pop();
      lastItem = { title: title || cleanPath, url };
      items.push(lastItem);
      continue;
    }
    const titleMatch = line.match(/title:\s*["']?(.+?)["']?\s*$/);
    if (titleMatch && lastItem) {
      lastItem.title = titleMatch[1].trim() || lastItem.title;
    }
  }
  return items;
}

function extractNotebookText(text) {
  try {
    const json = JSON.parse(text);
    if (!json || !Array.isArray(json.cells)) return text;
    const parts = [];
    for (const cell of json.cells) {
      if (!cell || !Array.isArray(cell.source)) continue;
      const body = cell.source.join('');
      if (!body.trim()) continue;
      if (cell.cell_type === 'code') {
        parts.push(`\n[代码]\n${body}`);
      } else {
        parts.push(body);
      }
    }
    return parts.join('\n\n').trim() || text;
  } catch {
    return text;
  }
}

function getElementSize(el, fallback) {
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height };
  }
  const prevDisplay = el.style.display;
  const prevVisibility = el.style.visibility;
  el.style.visibility = 'hidden';
  el.style.display = 'flex';
  const tmpRect = el.getBoundingClientRect();
  el.style.display = prevDisplay;
  el.style.visibility = prevVisibility;
  if (tmpRect.width > 0 && tmpRect.height > 0) {
    return { width: tmpRect.width, height: tmpRect.height };
  }
  return fallback;
}

function getPanelSize(kind) {
  if (kind === 'reader') {
    return {
      width: Math.max(240, Number(pluginConfig.readerPanelWidth) || 360),
      height: Math.max(320, Number(pluginConfig.readerPanelHeight) || 520),
    };
  }
  return {
    width: Math.max(240, Number(pluginConfig.panelWidth) || 320),
    height: Math.max(320, Number(pluginConfig.panelHeight) || 420),
  };
}

function applyPanelSizing() {
  const drillPanel = document.getElementById('vocab-break-panel');
  const readerPanel = document.getElementById('vocab-break-reader-panel');
  if (drillPanel) {
    const size = getPanelSize('drill');
    drillPanel.style.width = `${size.width}px`;
    drillPanel.style.height = `${size.height}px`;
  }
  if (readerPanel) {
    const size = getPanelSize('reader');
    readerPanel.style.width = `${size.width}px`;
    readerPanel.style.height = `${size.height}px`;
  }
}

function clampPosition(x, y, size) {
  const maxX = Math.max(DRAG_MARGIN, window.innerWidth - size.width - DRAG_MARGIN);
  const maxY = Math.max(DRAG_MARGIN, window.innerHeight - size.height - DRAG_MARGIN);
  return {
    x: Math.min(Math.max(DRAG_MARGIN, x), maxX),
    y: Math.min(Math.max(DRAG_MARGIN, y), maxY),
  };
}

function isCompactViewport() {
  return window.innerWidth <= 520 || window.innerHeight <= 520;
}

function getPanelPos(kind) {
  return kind === 'reader' ? pluginConfig.readerPanelPos : pluginConfig.panelPos;
}

function setPanelPos(kind, pos, { save = true } = {}) {
  if (kind === 'reader') {
    pluginConfig.readerPanelPos = pos;
  } else {
    pluginConfig.panelPos = pos;
  }
  if (save) saveSettings();
}

function ensureDefaultPosition(panel, kind) {
  if (getPanelPos(kind)) return;
  const size = getElementSize(panel, getPanelSize(kind));
  const x = Math.round((window.innerWidth - size.width) / 2);
  const y = Math.round((window.innerHeight - size.height) / 2);
  const offset = kind === 'reader' ? 48 : 0;
  const pos = clampPosition(x + offset, y + offset, size);
  setPanelPos(kind, pos);
}

function applyFloatingPosition(el, pos, fallback) {
  if (!el || !pos) return;
  const size = getElementSize(el, fallback);
  const clamped = clampPosition(pos.x, pos.y, size);
  el.style.left = `${clamped.x}px`;
  el.style.top = `${clamped.y}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
}

function applyFloatingPositions() {
  const drillPanel = document.getElementById('vocab-break-panel');
  const drillBar = document.getElementById('vocab-break-bar');
  const readerPanel = document.getElementById('vocab-break-reader-panel');
  const readerBar = document.getElementById('vocab-break-reader-bar');
  const chatDock = document.getElementById('vocab-break-reader-chat-dock');
  const barFallback = { width: 260, height: 40 };

  if (drillPanel) {
    ensureDefaultPosition(drillPanel, 'drill');
    const pos = getPanelPos('drill');
    if (pos) {
      applyFloatingPosition(drillPanel, pos, getPanelSize('drill'));
      if (drillBar) applyFloatingPosition(drillBar, pos, barFallback);
    }
  }

  if (readerPanel) {
    ensureDefaultPosition(readerPanel, 'reader');
    const pos = getPanelPos('reader');
    if (pos) {
      applyFloatingPosition(readerPanel, pos, getPanelSize('reader'));
      if (readerBar) applyFloatingPosition(readerBar, pos, barFallback);
    }
  }

  if (chatDock) {
    if (chatDock.classList.contains('is-modal')) return;
    if (isCompactViewport()) {
      chatDock.classList.add('is-compact');
      chatDock.style.left = 'auto';
      chatDock.style.top = 'auto';
      chatDock.style.right = '12px';
      chatDock.style.bottom = '72px';
      return;
    }

    chatDock.classList.remove('is-compact');
    const pos = getPanelPos('reader');
    if (pos) {
      const readerSize = readerPanel ? getElementSize(readerPanel, getPanelSize('reader')) : getPanelSize('reader');
      const dockSize = getElementSize(chatDock, { width: 220, height: 40 });
      let x = pos.x + readerSize.width + 8;
      let y = pos.y + 12;
      if (x + dockSize.width > window.innerWidth - DRAG_MARGIN) {
        x = pos.x - dockSize.width - 8;
      }
      const clamped = clampPosition(x, y, dockSize);
      chatDock.style.left = `${clamped.x}px`;
      chatDock.style.top = `${clamped.y}px`;
      chatDock.style.right = 'auto';
      chatDock.style.bottom = 'auto';
    }
  }
}

function ensurePanelInView(panel, kind) {
  if (!panel || !panel.classList.contains('is-open')) return;
  const size = getElementSize(panel, getPanelSize(kind));
  const rect = panel.getBoundingClientRect();
  const isOffscreen =
    rect.bottom < DRAG_MARGIN ||
    rect.top > window.innerHeight - DRAG_MARGIN ||
    rect.right < DRAG_MARGIN ||
    rect.left > window.innerWidth - DRAG_MARGIN;

  if (isOffscreen) {
    const x = Math.round((window.innerWidth - size.width) / 2);
    const y = Math.round((window.innerHeight - size.height) / 2);
    setPanelPos(kind, clampPosition(x, y, size));
    applyFloatingPositions();
    return;
  }

  const clamped = clampPosition(rect.left, rect.top, size);
  if (Math.round(clamped.x) !== Math.round(rect.left) || Math.round(clamped.y) !== Math.round(rect.top)) {
    setPanelPos(kind, clamped);
    applyFloatingPositions();
  }
}

function beginDrag(e, targetEl) {
  if (!targetEl) return;
  if (e.button !== 0 && e.pointerType !== 'touch') return;
  if (e.target instanceof HTMLElement) {
    if (e.target.closest('button, select, input, textarea, a')) return;
  }
  const rect = targetEl.getBoundingClientRect();
  state.drag.active = true;
  state.drag.offsetX = e.clientX - rect.left;
  state.drag.offsetY = e.clientY - rect.top;
  state.drag.startX = e.clientX;
  state.drag.startY = e.clientY;
  state.drag.moved = false;
  state.drag.justDragged = false;
  state.drag.target = targetEl.id;
  targetEl.setPointerCapture?.(e.pointerId);
}

function onDrag(e) {
  if (!state.drag.active) return;
  if (
    !state.drag.moved &&
    (Math.abs(e.clientX - state.drag.startX) > 3 || Math.abs(e.clientY - state.drag.startY) > 3)
  ) {
    state.drag.moved = true;
  }
  const drillPanel = document.getElementById('vocab-break-panel');
  const drillBar = document.getElementById('vocab-break-bar');
  const readerPanel = document.getElementById('vocab-break-reader-panel');
  const readerBar = document.getElementById('vocab-break-reader-bar');
  const isReader = state.drag.target === 'vocab-break-reader-panel' || state.drag.target === 'vocab-break-reader-bar';
  const targetEl = isReader
    ? state.drag.target === 'vocab-break-reader-bar'
      ? readerBar
      : readerPanel
    : state.drag.target === 'vocab-break-bar'
      ? drillBar
      : drillPanel;
  if (!targetEl) return;
  const isBar = targetEl === drillBar || targetEl === readerBar;
  const fallback = isBar ? { width: 260, height: 40 } : isReader ? getPanelSize('reader') : getPanelSize('drill');
  const size = getElementSize(targetEl, fallback);
  const x = e.clientX - state.drag.offsetX;
  const y = e.clientY - state.drag.offsetY;
  const clamped = clampPosition(x, y, size);
  setPanelPos(isReader ? 'reader' : 'drill', clamped, { save: false });
  applyFloatingPositions();
}

function endDrag() {
  if (!state.drag.active) return;
  state.drag.active = false;
  state.drag.justDragged = state.drag.moved;
  state.drag.target = '';
  saveSettings();
  if (state.drag.justDragged) {
    setTimeout(() => {
      state.drag.justDragged = false;
    }, 200);
  }
}

async function loadRemoteIndex({ force } = {}) {
  const src = getRemoteSource();
  if (!src?.indexUrl) return;
  if (!force && state.remote.sourceId === src.id && state.remote.chapters.length) {
    return;
  }

  state.remote.loadingIndex = true;
  state.remote.error = '';
  updatePanel();

  try {
    const res = await fetch(src.indexUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let chapters = [];
    if (src.type === 'summary-md') {
      chapters = parseSummaryMarkdown(text, src.chapterPrefix);
    } else if (src.type === 'toc-yml') {
      chapters = parseTocYaml(text, src.chapterPrefix, src.chapterExt);
    }

    if (!chapters.length) throw new Error('未解析到章节目录');

    state.remote.sourceId = src.id;
    state.remote.chapters = chapters;
    state.remote.updatedAt = Date.now();
    pluginConfig.readerRemoteSourceId = src.id;

    if (!pluginConfig.readerRemoteChapterUrl || !chapters.some(c => c.url === pluginConfig.readerRemoteChapterUrl)) {
      pluginConfig.readerRemoteChapterUrl = chapters[0]?.url || '';
    }
    saveSettings();

    if (state.readerPanelOpen && !state.reader.text && pluginConfig.readerRemoteChapterUrl) {
      loadRemoteChapter(pluginConfig.readerRemoteChapterUrl);
    }
  } catch (err) {
    state.remote.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.remote.loadingIndex = false;
    updatePanel();
  }
}

async function loadRemoteChapter(url) {
  if (!url) return;
  state.remote.loadingChapter = true;
  state.remote.error = '';
  updatePanel();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const isNotebook = url.toLowerCase().endsWith('.ipynb');
    const content = isNotebook ? extractNotebookText(text) : text;
    const title = state.remote.chapters.find(c => c.url === url)?.title || '远程章节';
    setReaderText(content, title, { bookKey: `remote:${url}` });
    pluginConfig.readerRemoteChapterUrl = url;
    saveSettings();
  } catch (err) {
    state.remote.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.remote.loadingChapter = false;
    updatePanel();
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'familiar':
      return '熟悉';
    case 'fuzzy':
      return '模糊';
    case 'unknown':
      return '不认识';
    default:
      return '未标记';
  }
}

function getWordStatus(word) {
  return state.statusMap.get(word) || (state.known.has(word) ? 'familiar' : null);
}

function getStatusWeight(status) {
  switch (status) {
    case 'unknown':
      return 5;
    case 'fuzzy':
      return 3;
    case 'familiar':
      return 1;
    default:
      return 2;
  }
}

function pickWeightedItem(items, lastWord) {
  if (!items.length) return null;
  let total = 0;
  const weights = items.map(it => {
    const w = getStatusWeight(getWordStatus(it.word));
    total += w;
    return w;
  });

  if (total <= 0) {
    const idx = Math.floor(Math.random() * items.length);
    return items[idx];
  }

  let r = Math.random() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i];
    if (r <= 0) {
      if (lastWord && items[i].word === lastWord) {
        const alt = Math.floor(Math.random() * items.length);
        return items[alt];
      }
      return items[i];
    }
  }
  return items[items.length - 1];
}

function resetCycleState() {
  state.cycle.newList = [];
  state.cycle.reviewList = [];
  state.cycle.index = 0;
  state.cycle.phase = 'new';
  state.cycle.dirty = true;
}

function getActiveCycleList() {
  return state.cycle.phase === 'review' ? state.cycle.reviewList : state.cycle.newList;
}

function getReviewIndex(word) {
  return state.cycle.reviewList.findIndex(it => it.word === word);
}

function addToReview(item) {
  if (!item) return;
  if (getReviewIndex(item.word) !== -1) return;
  state.cycle.reviewList.push(item);
}

function removeFromReview(word) {
  const idx = getReviewIndex(word);
  if (idx === -1) return;
  state.cycle.reviewList.splice(idx, 1);
  if (state.cycle.phase === 'review' && state.cycle.index >= idx) {
    state.cycle.index = Math.max(0, state.cycle.index - 1);
  }
}

function buildCycle() {
  state.cycle.newList = [];
  state.cycle.reviewList = [];
  state.cycle.index = 0;
  state.cycle.phase = 'new';
  state.cycle.dirty = false;
  const items = state.items;
  if (!items.length) return;

  const size = Math.max(1, Number(state.cycle.size) || 20);
  while (state.cycle.newList.length < size && items.length) {
    if (state.index >= items.length) {
      shuffle(items);
      state.index = 0;
    }
    const item = items[state.index];
    state.index += 1;
    state.cycle.newList.push(item);
  }

  if (state.sourceUrl) {
    saveCache(state.sourceUrl, {
      items,
      index: state.index,
      updatedAt: Date.now(),
      sourceId: state.sourceId,
    });
  }
}

function ensureCycle() {
  if (state.cycle.dirty || (!state.cycle.newList.length && !state.cycle.reviewList.length)) {
    buildCycle();
    return;
  }
  if (state.cycle.phase === 'review' && !state.cycle.reviewList.length) {
    buildCycle();
  }
}

function openReaderDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(READER_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(READER_DB_STORE)) {
        db.createObjectStore(READER_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await openReaderDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(READER_DB_STORE, 'readonly');
    const store = tx.objectStore(READER_DB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function idbSet(key, value) {
  const db = await openReaderDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(READER_DB_STORE, 'readwrite');
    const store = tx.objectStore(READER_DB_STORE);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function idbDelete(key) {
  const db = await openReaderDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(READER_DB_STORE, 'readwrite');
    const store = tx.objectStore(READER_DB_STORE);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function getEncodingLabel(id) {
  return TEXT_ENCODINGS.find(encoding => encoding.id === id)?.label || id;
}

function getApiProviderConfig(id) {
  return API_PROVIDERS.find(p => p.id === id) || API_PROVIDERS[0];
}

function normalizeApiEndpoint(endpoint) {
  return String(endpoint || '')
    .trim()
    .replace(/\/+$/, '');
}

function getApiConfig() {
  const provider = getApiProviderConfig(pluginConfig.apiProvider);
  const endpoint = normalizeApiEndpoint(pluginConfig.apiEndpoint || provider.defaultEndpoint);
  return {
    provider,
    endpoint,
    key: String(pluginConfig.apiKey || '').trim(),
    model: String(pluginConfig.apiModel || '').trim(),
  };
}

function getApiSource(providerId) {
  if (providerId === 'grok' || providerId === 'custom') {
    return 'openai';
  }
  return providerId || 'openai';
}

function detectBomEncoding(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return 'utf-16le';
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return 'utf-16be';
  }
  return '';
}

function guessUtf16Encoding(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let evenZeros = 0;
  let oddZeros = 0;
  let pairs = 0;
  for (let i = 0; i + 1 < sample.length; i += 2) {
    pairs += 1;
    if (sample[i] === 0) evenZeros += 1;
    if (sample[i + 1] === 0) oddZeros += 1;
  }
  if (!pairs) return '';
  if (evenZeros / pairs > 0.6) return 'utf-16be';
  if (oddZeros / pairs > 0.6) return 'utf-16le';
  return '';
}

function decodeBufferWithEncoding(buffer, encoding, options = {}) {
  try {
    const decoder = new TextDecoder(encoding, options);
    return { ok: true, text: decoder.decode(buffer) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function scoreDecodedText(text) {
  const sample = String(text || '').slice(0, 20000);
  if (!sample) return -Infinity;
  const len = sample.length || 1;
  const replacementCount = (sample.match(/\uFFFD/g) || []).length;
  const nullCount = (sample.match(/\u0000/g) || []).length;
  const controlCount = (sample.match(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  const penalty = replacementCount * 3 + nullCount * 2 + controlCount * 0.5;
  return 1 - penalty / len;
}

function decodeTextAuto(buffer) {
  const bytes = new Uint8Array(buffer);
  const bom = detectBomEncoding(bytes);
  if (bom) {
    const bomResult = decodeBufferWithEncoding(buffer, bom);
    if (bomResult.ok) {
      return { text: bomResult.text, encoding: bom, detected: true };
    }
  }

  const utf16Guess = guessUtf16Encoding(bytes);
  if (utf16Guess) {
    const guessResult = decodeBufferWithEncoding(buffer, utf16Guess);
    if (guessResult.ok) {
      return { text: guessResult.text, encoding: utf16Guess, detected: true };
    }
  }

  const utf8Strict = decodeBufferWithEncoding(buffer, 'utf-8', { fatal: true });
  if (utf8Strict.ok) {
    return { text: utf8Strict.text, encoding: 'utf-8', detected: true };
  }

  const candidates = ['utf-8', 'gbk', 'big5', 'utf-16le', 'utf-16be'];
  let best = null;
  for (const encoding of candidates) {
    const res = decodeBufferWithEncoding(buffer, encoding);
    if (!res.ok) continue;
    const score = scoreDecodedText(res.text);
    if (!best || score > best.score) {
      best = { encoding, text: res.text, score };
    }
  }
  if (best) {
    return { text: best.text, encoding: best.encoding, detected: true };
  }

  return { text: '', encoding: 'utf-8', detected: false };
}

async function readTextFromFile(file, encoding) {
  if (!file) return { text: '', encoding: 'utf-8', detected: false };
  if (typeof TextDecoder === 'undefined' || !file.arrayBuffer) {
    const text = await file.text();
    return { text, encoding: 'utf-8', detected: false };
  }
  const buffer = await file.arrayBuffer();
  if (encoding && encoding !== 'auto') {
    const res = decodeBufferWithEncoding(buffer, encoding);
    if (res.ok) {
      return { text: res.text, encoding, detected: false };
    }
  }
  return decodeTextAuto(buffer);
}

function normalizeLibraryItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const id = String(item.id || '');
      if (!id) return null;
      return {
        id,
        title: String(item.title || '本地TXT'),
        updatedAt: Number(item.updatedAt) || 0,
        bytes: Number(item.bytes) || 0,
        source: String(item.source || 'local'),
      };
    })
    .filter(Boolean);
}

async function loadReaderLibrary() {
  state.reader.library.loading = true;
  state.reader.library.error = '';
  updatePanel();
  try {
    const raw = await idbGet(READER_LIBRARY_INDEX_KEY);
    const items = normalizeLibraryItems(raw);
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    state.reader.library.items = items;
    if (!state.reader.library.selectedId && items.length) {
      state.reader.library.selectedId = items[0].id;
    }
  } catch (err) {
    state.reader.library.error = err instanceof Error ? err.message : String(err);
    state.reader.library.items = [];
  } finally {
    state.reader.library.loading = false;
    updatePanel();
  }
}

async function saveReaderLibraryIndex(items) {
  await idbSet(READER_LIBRARY_INDEX_KEY, items);
}

async function addReaderLibraryEntry({ title, content }) {
  if (!content || !content.trim()) return null;
  const bytes = new Blob([content]).size;
  if (bytes > Number(pluginConfig.readerCacheMaxBytes)) {
    toastr?.warning?.('文件超过缓存上限，书架不会保存。', '背词小窗');
    return null;
  }
  const safeTitle = title || '本地TXT';
  const id = `local-${Date.now()}-${getStringHash(`${safeTitle}:${content.slice(0, 200)}`)}`;
  const entry = {
    id,
    title: safeTitle,
    updatedAt: Date.now(),
    bytes,
    source: 'local',
  };
  const next = state.reader.library.items.filter(it => it.title !== safeTitle);
  next.unshift(entry);
  const removed = next.splice(READER_LIBRARY_MAX_ITEMS);
  try {
    await idbSet(`${READER_LIBRARY_ITEM_PREFIX}${id}`, {
      ...entry,
      content,
    });
    for (const item of removed) {
      await idbDelete(`${READER_LIBRARY_ITEM_PREFIX}${item.id}`);
    }
    await saveReaderLibraryIndex(next);
    state.reader.library.items = next;
    state.reader.library.selectedId = id;
    updatePanel();
    return id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toastr?.warning?.(`书架保存失败：${msg}`, '背词小窗');
    return null;
  }
}

async function loadReaderLibraryEntry(id) {
  if (!id) return;
  state.reader.library.loading = true;
  state.reader.library.error = '';
  updatePanel();
  try {
    const raw = await idbGet(`${READER_LIBRARY_ITEM_PREFIX}${id}`);
    if (!raw || typeof raw !== 'object' || !raw.content) {
      throw new Error('未找到内容');
    }
    setReaderText(raw.content, raw.title || '本地TXT', { bookKey: `book:${id}` });
    state.reader.library.selectedId = id;
    setReaderPanelOpen(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toastr?.error?.(`读取失败：${msg}`, '背词小窗');
  } finally {
    state.reader.library.loading = false;
    updatePanel();
  }
}

async function removeReaderLibraryEntry(id) {
  if (!id) return;
  state.reader.library.loading = true;
  state.reader.library.error = '';
  updatePanel();
  try {
    await idbDelete(`${READER_LIBRARY_ITEM_PREFIX}${id}`);
    const next = state.reader.library.items.filter(it => it.id !== id);
    await saveReaderLibraryIndex(next);
    state.reader.library.items = next;
    if (state.reader.library.selectedId === id) {
      state.reader.library.selectedId = next[0]?.id || '';
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toastr?.error?.(`删除失败：${msg}`, '背词小窗');
  } finally {
    state.reader.library.loading = false;
    updatePanel();
  }
}

async function loadReaderFromStorage() {
  let text = '';
  let meta = null;
  let loadedFromIdb = false;

  try {
    const idbText = await idbGet(READER_CONTENT_IDB_KEY);
    const idbMeta = await idbGet(READER_META_IDB_KEY);
    if (typeof idbText === 'string') {
      text = idbText;
      meta = idbMeta || null;
      loadedFromIdb = true;
    }
  } catch {
    loadedFromIdb = false;
  }

  if (!text) {
    try {
      text = localStorage.getItem(READER_CONTENT_KEY) || '';
    } catch {
      text = '';
    }

    try {
      const raw = localStorage.getItem(READER_META_KEY);
      meta = raw ? JSON.parse(raw) : null;
    } catch {
      meta = null;
    }
  }

  if (text) {
    state.reader.text = text;
    state.reader.title = meta?.title || '本地TXT';
    state.reader.updatedAt = Number.isFinite(meta?.updatedAt) ? meta.updatedAt : 0;
    state.reader.cacheDisabled = false;
    const bookKey = meta?.bookKey || `local:${getStringHash(`${state.reader.title}:${text.slice(0, 200)}`)}`;
    setReaderBookKey(bookKey, meta?.bookTitle || state.reader.title);
    paginateReader({ keepPosition: true });
    const fallbackPage = Number.isFinite(meta?.pageIndex) ? meta.pageIndex + 1 : 0;
    const targetPage = state.reader.lastPage || fallbackPage;
    if (targetPage) {
      state.reader.pageIndex = Math.min(Math.max(targetPage - 1, 0), state.reader.pages.length - 1);
    }
    syncReaderProgress();
    if (!loadedFromIdb) {
      void saveReaderToStorage();
    }
    updatePanel();
  }
}

async function saveReaderToStorage() {
  if (state.reader.cacheDisabled) return;
  const meta = {
    title: state.reader.title || '本地TXT',
    pageIndex: state.reader.pageIndex || 0,
    updatedAt: state.reader.updatedAt || Date.now(),
    pageSize: pluginConfig.readerPageSize,
    bookKey: state.reader.bookKey || '',
    bookTitle: state.reader.bookTitle || state.reader.title || '本地TXT',
  };
  try {
    await idbSet(READER_CONTENT_IDB_KEY, state.reader.text || '');
    await idbSet(READER_META_IDB_KEY, meta);
  } catch {
    try {
      localStorage.setItem(READER_CONTENT_KEY, state.reader.text || '');
      localStorage.setItem(READER_META_KEY, JSON.stringify(meta));
    } catch {
      toastr?.warning?.('阅读内容过大，无法保存到本地缓存。', '背词小窗');
    }
  }
}

function loadReaderBookmarksStore() {
  try {
    const raw = localStorage.getItem(READER_BOOKMARKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveReaderBookmarksStore(store) {
  try {
    localStorage.setItem(READER_BOOKMARKS_KEY, JSON.stringify(store || {}));
  } catch {
    // ignore
  }
}

function getReaderBookKey() {
  return state.reader.bookKey || '';
}

function setReaderBookKey(bookKey, title) {
  state.reader.bookKey = bookKey || '';
  state.reader.bookTitle = title || state.reader.title || '';
  refreshReaderBookmarks();
}

function refreshReaderBookmarks() {
  const key = getReaderBookKey();
  if (!key) {
    state.reader.bookmarks = [];
    state.reader.lastPage = 0;
    state.reader.maxPage = 0;
    if (pluginConfig.readerMaxPage !== 0) {
      pluginConfig.readerMaxPage = 0;
      saveSettings();
    }
    return;
  }
  const store = loadReaderBookmarksStore();
  const entry = store[key] || {
    title: state.reader.bookTitle || state.reader.title || '本地TXT',
    lastPage: 0,
    maxPage: 0,
    bookmarks: [],
  };
  state.reader.bookmarks = Array.isArray(entry.bookmarks) ? entry.bookmarks : [];
  state.reader.lastPage = Number(entry.lastPage) || 0;
  state.reader.maxPage = Number(entry.maxPage) || 0;
  if (pluginConfig.readerMaxPage !== state.reader.maxPage) {
    pluginConfig.readerMaxPage = state.reader.maxPage;
    saveSettings();
  }
}

function persistReaderBookmarks(updateFn) {
  const key = getReaderBookKey();
  if (!key) return;
  const store = loadReaderBookmarksStore();
  const entry = store[key] || {
    title: state.reader.bookTitle || state.reader.title || '本地TXT',
    lastPage: 0,
    maxPage: 0,
    bookmarks: [],
  };
  if (typeof updateFn === 'function') {
    updateFn(entry);
  }
  entry.title = state.reader.bookTitle || state.reader.title || entry.title;
  store[key] = entry;
  saveReaderBookmarksStore(store);
  refreshReaderBookmarks();
}

function syncReaderProgress() {
  if (!state.reader.pages.length) {
    if (pluginConfig.readerMaxPage !== 0) {
      pluginConfig.readerMaxPage = 0;
      saveSettings();
    }
    return;
  }
  const currentPage = state.reader.pageIndex + 1;
  persistReaderBookmarks(entry => {
    entry.lastPage = currentPage;
    entry.maxPage = Math.max(Number(entry.maxPage) || 0, currentPage);
  });
}

function addReaderBookmark() {
  if (!state.reader.pages.length) return;
  const page = state.reader.pageIndex + 1;
  persistReaderBookmarks(entry => {
    const label = `第${page}页`;
    entry.bookmarks = Array.isArray(entry.bookmarks) ? entry.bookmarks : [];
    entry.bookmarks.push({ page, label, ts: Date.now() });
  });
  updatePanel();
}

function removeReaderBookmark(index) {
  persistReaderBookmarks(entry => {
    entry.bookmarks = Array.isArray(entry.bookmarks) ? entry.bookmarks : [];
    entry.bookmarks.splice(index, 1);
  });
  updatePanel();
}

function jumpToReaderBookmark(page) {
  if (!state.reader.pages.length) return;
  const target = Math.min(Math.max(1, Number(page) || 1), state.reader.pages.length);
  state.reader.pageIndex = target - 1;
  syncReaderProgress();
  void saveReaderToStorage();
  updatePanel();
}

function migrateReaderBookmarks(fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return;
  const store = loadReaderBookmarksStore();
  if (!store[fromKey]) return;
  if (!store[toKey]) {
    store[toKey] = store[fromKey];
  }
  delete store[fromKey];
  saveReaderBookmarksStore(store);
}

function applyTheme() {
  const panel = document.getElementById('vocab-break-panel');
  const bar = document.getElementById('vocab-break-bar');
  const readerPanel = document.getElementById('vocab-break-reader-panel');
  const readerBar = document.getElementById('vocab-break-reader-bar');
  const chatDock = document.getElementById('vocab-break-reader-chat-dock');
  const els = [panel, bar, readerPanel, readerBar, chatDock].filter(Boolean);
  if (!els.length) return;

  for (const el of els) {
    el.classList.forEach(cls => {
      if (cls.startsWith(THEME_PREFIX)) el.classList.remove(cls);
    });
    el.classList.add(`${THEME_PREFIX}${pluginConfig.theme}`);
  }

  applyCustomCss();
}

function applyCustomCss() {
  const existing = document.getElementById(CUSTOM_STYLE_ID);
  if (pluginConfig.theme !== 'custom') {
    if (existing) existing.remove();
    return;
  }

  const css = pluginConfig.customCss || '';
  const style = existing || Object.assign(document.createElement('style'), { id: CUSTOM_STYLE_ID });
  style.textContent = css;
  if (!existing) document.head.appendChild(style);
}

function normalizeItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(mapItem).filter(Boolean);
  }
  if (typeof raw === 'object') {
    if (Array.isArray(raw.data)) return raw.data.map(mapItem).filter(Boolean);
    if (Array.isArray(raw.list)) return raw.list.map(mapItem).filter(Boolean);
    if (Array.isArray(raw.items)) return raw.items.map(mapItem).filter(Boolean);
  }
  return [];
}

function mapItem(item) {
  if (!item) return null;
  if (typeof item === 'string') {
    const word = item.trim();
    if (!word) return null;
    return { word, meaning: '' };
  }

  if (typeof item === 'object') {
    const word = item.word || item.en || item.english || item.term || item.key || item.headword || item.spelling || '';

    let meaning =
      item.translation || item.meaning || item.cn || item.zh || item.trans || item.definition || item.explain || '';

    if (!meaning && Array.isArray(item.translations)) {
      meaning = item.translations
        .map(t => t.translation || t.meaning || t.cn || t.zh)
        .filter(Boolean)
        .join('; ');
    }

    if (!meaning && Array.isArray(item.explanations)) {
      meaning = item.explanations
        .map(t => (typeof t === 'string' ? t : t?.translation || ''))
        .filter(Boolean)
        .join('; ');
    }

    const finalWord = String(word || '').trim();
    const finalMeaning = String(meaning || '').trim();
    if (!finalWord) return null;
    return { word: finalWord, meaning: finalMeaning };
  }

  return null;
}

function parseTextToItems(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const items = [];
  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    let word = raw;
    let meaning = '';

    if (raw.includes('\t')) {
      const parts = raw.split(/\t+/);
      word = parts.shift()?.trim() || '';
      meaning = parts.join(' ').trim();
    } else if (raw.includes(' - ')) {
      const parts = raw.split(' - ');
      word = parts.shift()?.trim() || '';
      meaning = parts.join(' - ').trim();
    } else if (raw.includes('|')) {
      const parts = raw.split('|');
      word = parts.shift()?.trim() || '';
      meaning = parts.join('|').trim();
    }

    if (!word) continue;
    items.push({ word, meaning });
  }
  return items;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function paginateByChars(text, size) {
  const safeSize = Math.max(200, Number(size) || 900);
  const pages = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + safeSize, text.length);
    const slice = text.slice(i, end);
    const breakIdx = slice.lastIndexOf('\n');
    if (breakIdx > safeSize * 0.6) {
      end = i + breakIdx;
    }
    const page = text.slice(i, end).trim();
    if (page) pages.push(page);
    i = end;
    while (text[i] === '\n') i += 1;
  }
  return pages;
}

function paginateReader({ keepPosition } = {}) {
  const text = state.reader.text || '';
  if (!text) {
    state.reader.pages = [];
    state.reader.pageIndex = 0;
    return;
  }

  const currentOffset = keepPosition
    ? state.reader.pages.slice(0, state.reader.pageIndex).reduce((sum, p) => sum + p.length, 0)
    : 0;

  state.reader.pages = paginateByChars(text, pluginConfig.readerPageSize);
  if (!state.reader.pages.length) {
    state.reader.pageIndex = 0;
    return;
  }

  if (keepPosition) {
    const newIndex = Math.floor(currentOffset / Math.max(200, Number(pluginConfig.readerPageSize) || 900));
    state.reader.pageIndex = Math.min(Math.max(newIndex, 0), state.reader.pages.length - 1);
  } else if (state.reader.pageIndex >= state.reader.pages.length) {
    state.reader.pageIndex = state.reader.pages.length - 1;
  }
}

function getReaderHistoryRange() {
  const total = state.reader.pages.length;
  if (!total) return null;
  const maxPage = Math.min(Math.max(1, Number(state.reader.maxPage) || state.reader.pageIndex + 1), total);
  const rawStart = Number(pluginConfig.readerHistoryStartPage) || 0;
  const startPage = rawStart > 0 ? Math.min(rawStart, maxPage) : 1;
  const pages = state.reader.pages.slice(startPage - 1, maxPage);
  return { startPage, endPage: maxPage, pages };
}

function buildReaderHistoryPrompt() {
  if (!pluginConfig.readerHistoryEnabled) return '';
  const range = getReaderHistoryRange();
  if (!range || !range.pages.length) return '';
  const body = range.pages.map((text, idx) => `[第${range.startPage + idx}页]\n${text}`).join('\n\n');
  return `【阅读历史：第${range.startPage}-${range.endPage}页】\n${body}`;
}

function buildReaderSystemPrompt() {
  const ctx = getContext();
  const nameUser = String(ctx?.name1 || 'User');
  const nameChar = String(ctx?.name2 || 'Assistant');
  return DEFAULT_READER_SYSTEM_PROMPT.replace(/{{\s*user\s*}}/gi, nameUser).replace(/{{\s*char\s*}}/gi, nameChar);
}

function buildPersonaContextPrompt() {
  const ctx = getContext();
  const fields = typeof ctx?.getCharacterCardFields === 'function' ? ctx.getCharacterCardFields() : null;
  const nameUser = String(ctx?.name1 || 'User');
  const nameChar = String(ctx?.name2 || 'Assistant');
  const userPersona = String(fields?.persona || '').trim();
  const charDesc = String(fields?.description || '').trim();
  const charPersonality = String(fields?.personality || '').trim();
  const parts = [];
  if (userPersona) {
    parts.push(`【${nameUser} 人设】\n${userPersona}`);
  }
  if (charDesc || charPersonality) {
    const charLines = [];
    if (charDesc) charLines.push(`描述：${charDesc}`);
    if (charPersonality) charLines.push(`性格：${charPersonality}`);
    parts.push(`【${nameChar} 人设】\n${charLines.join('\n')}`);
  }
  return parts.join('\n\n');
}

async function buildLorebookContextPrompt({ readingContext, historyMessages } = {}) {
  const ctx = getContext();
  if (!ctx || typeof ctx.getWorldInfoPrompt !== 'function') return '';
  try {
    const fields = typeof ctx.getCharacterCardFields === 'function' ? ctx.getCharacterCardFields() : null;
    const globalScanData = {
      trigger: 'normal',
      personaDescription: String(fields?.persona || '').trim(),
      characterDescription: String(fields?.description || '').trim(),
      characterPersonality: String(fields?.personality || '').trim(),
      characterDepthPrompt: String(fields?.charDepthPrompt || '').trim(),
      scenario: String(fields?.scenario || '').trim(),
      creatorNotes: String(fields?.creatorNotes || '').trim(),
    };
    const scanMessages = [];
    if (readingContext) scanMessages.push(readingContext);
    if (Array.isArray(historyMessages) && historyMessages.length) {
      const tail = historyMessages.slice(-24);
      for (let i = tail.length - 1; i >= 0; i -= 1) {
        const msg = tail[i];
        if (!msg || typeof msg.content !== 'string') continue;
        const content = msg.content.replace(/\s+/g, ' ').trim();
        if (!content) continue;
        scanMessages.push(content);
      }
    }
    if (!scanMessages.length) return '';
    const maxContext = Math.max(1, Number(ctx.maxContext) || 0);
    const result = await ctx.getWorldInfoPrompt(scanMessages, maxContext, true, globalScanData);
    const combined = `${result?.worldInfoBefore || ''}\n${result?.worldInfoAfter || ''}`.trim();
    return combined ? `【世界书】\n${combined}` : '';
  } catch {
    return '';
  }
}

function buildChatOrderedPrompts(userInput, historyMessages = []) {
  const prompts = [];
  const jailbreak = String(pluginConfig.jailbreakPrompt || '').trim();
  if (jailbreak) {
    prompts.push({ role: 'system', content: jailbreak });
  }
  prompts.push(
    'world_info_before',
    'persona_description',
    'char_description',
    'char_personality',
    'scenario',
    'world_info_after',
  );
  const readingContext = buildReaderHistoryPrompt();
  if (readingContext) {
    prompts.push({ role: 'system', content: readingContext });
  }
  prompts.push('dialogue_examples');
  for (const msg of historyMessages) {
    if (!msg || !msg.role || typeof msg.content !== 'string') continue;
    prompts.push({ role: msg.role, content: msg.content });
  }
  if (userInput) {
    prompts.push({ role: 'user', content: userInput });
  }
  return prompts;
}

function bindStreamHandlers(onIncremental, onFull) {
  const events = globalThis.iframe_events;
  const eventOn = globalThis.eventOn;
  const eventOff = globalThis.eventOff;
  if (!events || typeof eventOn !== 'function') return null;
  const inc = text => {
    if (typeof onIncremental === 'function' && typeof text === 'string') {
      onIncremental(text);
    }
  };
  const full = text => {
    if (typeof onFull === 'function' && typeof text === 'string') {
      onFull(text);
    }
  };
  eventOn(events.STREAM_TOKEN_RECEIVED_INCREMENTALLY, inc);
  eventOn(events.STREAM_TOKEN_RECEIVED_FULLY, full);
  return () => {
    if (typeof eventOff === 'function') {
      eventOff(events.STREAM_TOKEN_RECEIVED_INCREMENTALLY, inc);
      eventOff(events.STREAM_TOKEN_RECEIVED_FULLY, full);
    }
  };
}

function appendChatMessage(role, content) {
  const safeRole = role === 'assistant' || role === 'system' ? role : 'user';
  state.chat.messages.push({ role: safeRole, content: String(content || '') });
}

function clearChatMessages() {
  state.chat.messages = [];
  state.chat.error = '';
  updatePanel();
}

async function withBiasDisabled(run) {
  const oai = globalThis.oai_settings;
  if (!oai || typeof run !== 'function') {
    return run?.();
  }
  const prevPreset = oai.bias_preset_selected;
  oai.bias_preset_selected = null;
  try {
    return await run();
  } finally {
    oai.bias_preset_selected = prevPreset;
  }
}

async function fetchModelList() {
  const { provider, endpoint, key } = getApiConfig();
  if (!endpoint || !key) {
    state.chat.modelsError = '请先填写 API 地址和密钥';
    updatePanel();
    return;
  }
  state.chat.modelsLoading = true;
  state.chat.modelsError = '';
  updatePanel();
  try {
    let url = endpoint;
    const headers = {};
    if (provider.id === 'gemini') {
      url = `${endpoint}/models?key=${encodeURIComponent(key)}`;
    } else if (provider.id === 'claude') {
      url = `${endpoint}/models`;
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      url = `${endpoint}/models`;
      headers.Authorization = `Bearer ${key}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    let models = [];
    if (provider.id === 'gemini') {
      models = (data.models || [])
        .map(m => m.name)
        .filter(Boolean)
        .map(name => String(name).replace(/^models\//, ''));
    } else if (Array.isArray(data.data)) {
      models = data.data.map(m => m.id).filter(Boolean);
    } else if (Array.isArray(data.models)) {
      models = data.models.map(m => m.id || m.name).filter(Boolean);
    }
    models = Array.from(new Set(models));
    state.chat.models = models;
    if (!pluginConfig.apiModel && models.length) {
      pluginConfig.apiModel = models[0];
      saveSettings();
    }
  } catch (err) {
    state.chat.modelsError = err instanceof Error ? err.message : '模型拉取失败';
  } finally {
    state.chat.modelsLoading = false;
    updatePanel();
  }
}

function queueChatMessage() {
  const dock = document.getElementById('vocab-break-reader-chat-dock');
  if (!dock) return;
  const input = dock.querySelector('.vb-chat-input');
  if (!(input instanceof HTMLTextAreaElement)) return;
  const text = input.value.trim();
  if (!text) return;
  appendChatMessage('user', text);
  input.value = '';
  state.chat.error = '';
  updatePanel();
}

async function generateChatReply() {
  const ctx = getContext();
  const generateRaw = ctx && typeof ctx.generateRaw === 'function' ? ctx.generateRaw : null;
  if (typeof generateRaw !== 'function') {
    state.chat.error = '当前环境无法调用 generateRaw，请升级或切换桌面端';
    updatePanel();
    return;
  }

  if (state.chat.sending) return;
  const history = state.chat.messages.slice();
  if (!history.length || history[history.length - 1].role !== 'user') {
    state.chat.error = '请先输入消息';
    updatePanel();
    return;
  }

  state.chat.error = '';
  const assistantIndex = state.chat.messages.length;
  appendChatMessage('assistant', '');
  state.chat.sending = true;
  updatePanel();

  let detach = null;
  if (pluginConfig.apiStream) {
    detach = bindStreamHandlers(
      partial => {
        state.chat.messages[assistantIndex].content = partial;
        updatePanel();
      },
      full => {
        state.chat.messages[assistantIndex].content = full;
        updatePanel();
      },
    );
  }

  try {
    const readingContext = buildReaderHistoryPrompt();
    const personaContext = buildPersonaContextPrompt();
    const lorebookContext = await buildLorebookContextPrompt({ readingContext, historyMessages: history });
    const tail = history.slice(-24);
    const lines = [];
    for (const msg of tail) {
      if (!msg || typeof msg.content !== 'string') continue;
      const role = msg.role === 'assistant' ? '助手' : '用户';
      const content = msg.content.replace(/\s+/g, ' ').trim();
      if (!content) continue;
      lines.push(`${role}: ${content}`);
    }

    const promptParts = [];
    if (lorebookContext) promptParts.push(lorebookContext);
    if (personaContext) promptParts.push(personaContext);
    if (readingContext) promptParts.push(readingContext);
    promptParts.push('对话记录（最新在后）：');
    promptParts.push(lines.length ? lines.join('\n') : '(无对话)');
    promptParts.push('');
    promptParts.push('请给出助手的下一段回复。');

    const systemPrompt = buildReaderSystemPrompt();

    const result = await withBiasDisabled(() =>
      generateRaw({
        prompt: promptParts.join('\n'),
        systemPrompt,
      }),
    );
    if (typeof result === 'string' && (!pluginConfig.apiStream || !state.chat.messages[assistantIndex].content)) {
      state.chat.messages[assistantIndex].content = result;
    }
  } catch (err) {
    state.chat.error = err instanceof Error ? err.message : '生成失败';
  } finally {
    state.chat.sending = false;
    if (typeof detach === 'function') detach();
    updatePanel();
  }
}

function captureReaderScrollTop() {
  if (!pluginConfig.readerKeepScroll) return;
  const panel = document.getElementById('vocab-break-reader-panel');
  const pageEl = panel?.querySelector('.vb-reader-page');
  if (!pageEl) return;
  state.reader.pendingScrollTop = pageEl.scrollTop;
}

function restoreReaderScrollTop(pageEl) {
  const pending = state.reader.pendingScrollTop;
  if (!Number.isFinite(pending)) return;
  state.reader.pendingScrollTop = null;
  if (!pluginConfig.readerKeepScroll) return;
  requestAnimationFrame(() => {
    if (!pageEl) return;
    pageEl.scrollTop = Math.min(pending, pageEl.scrollHeight);
  });
}

function setReaderText(text, title, options = {}) {
  const nextText = text || '';
  const byteSize = new Blob([nextText]).size;
  state.reader.cacheDisabled = byteSize > Number(pluginConfig.readerCacheMaxBytes);
  state.reader.text = nextText;
  state.reader.title = title || '本地TXT';
  state.reader.pageIndex = 0;
  state.reader.updatedAt = Date.now();
  if (options.bookKey) {
    setReaderBookKey(options.bookKey, title);
  } else if (!state.reader.bookKey) {
    const fallbackKey = `local:${getStringHash(`${title}:${nextText.slice(0, 200)}`)}`;
    setReaderBookKey(fallbackKey, title);
  }
  paginateReader({ keepPosition: false });
  if (state.reader.lastPage > 0) {
    state.reader.pageIndex = Math.min(Math.max(state.reader.lastPage - 1, 0), state.reader.pages.length - 1);
  }
  syncReaderProgress();
  if (state.reader.cacheDisabled) {
    toastr?.warning?.('文件较大，已加载但不会缓存到本地。', '背词小窗');
    return;
  }
  void saveReaderToStorage();
}

function clearReaderText() {
  state.reader.text = '';
  state.reader.pages = [];
  state.reader.pageIndex = 0;
  state.reader.title = '';
  state.reader.updatedAt = 0;
  state.reader.cacheDisabled = false;
  state.reader.bookKey = '';
  state.reader.bookTitle = '';
  state.reader.lastPage = 0;
  state.reader.maxPage = 0;
  state.reader.bookmarks = [];
  pluginConfig.readerMaxPage = 0;
  saveSettings();
  try {
    localStorage.removeItem(READER_CONTENT_KEY);
    localStorage.removeItem(READER_META_KEY);
  } catch {
    // ignore
  }
  void idbDelete(READER_CONTENT_IDB_KEY).catch(() => {});
  void idbDelete(READER_META_IDB_KEY).catch(() => {});
}

function readerPrev() {
  if (!state.reader.pages.length) return;
  captureReaderScrollTop();
  state.reader.pageIndex = Math.max(0, state.reader.pageIndex - 1);
  syncReaderProgress();
  void saveReaderToStorage();
  updatePanel();
}

function readerNext() {
  if (!state.reader.pages.length) return;
  captureReaderScrollTop();
  state.reader.pageIndex = Math.min(state.reader.pages.length - 1, state.reader.pageIndex + 1);
  syncReaderProgress();
  void saveReaderToStorage();
  updatePanel();
}

function jumpReaderPage(rawPage) {
  if (!state.reader.pages.length) return;
  const pageNum = Number(rawPage);
  if (!Number.isFinite(pageNum)) return;
  captureReaderScrollTop();
  const clamped = Math.min(Math.max(1, Math.floor(pageNum)), state.reader.pages.length);
  state.reader.pageIndex = clamped - 1;
  syncReaderProgress();
  void saveReaderToStorage();
  updatePanel();
}

async function loadSource({ force } = {}) {
  const src = getActiveSource();
  state.sourceId = src.id;
  state.sourceUrl = src.url;
  state.sourceLabel = src.label;
  state.sourceLicense = src.license;

  if (!src.url) {
    state.items = [];
    state.error = '未设置词库链接';
    updatePanel();
    return;
  }

  if (!force) {
    const cached = loadCache(src.url);
    if (cached?.items?.length) {
      state.items = cached.items;
      state.index = cached.index || 0;
      loadKnown(src.url);
      loadStatus(src.url);
      loadStreak(src.url);
      resetCycleState();
      updatePanel();
      return;
    }
  }

  state.loading = true;
  state.error = '';
  updatePanel();

  try {
    const res = await fetch(src.url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    let items = [];
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (parsed) {
      items = normalizeItems(parsed);
    } else {
      items = parseTextToItems(text);
    }

    if (!items.length) throw new Error('未解析到词条');

    shuffle(items);
    state.items = items;
    state.index = 0;
    loadKnown(src.url);
    loadStatus(src.url);
    loadStreak(src.url);
    resetCycleState();
    saveCache(src.url, {
      items,
      index: state.index,
      updatedAt: Date.now(),
      sourceId: src.id,
    });
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
    updatePanel();
  }
}

function getCurrentItem() {
  ensureCycle();
  let list = getActiveCycleList();
  if (!list.length) return null;

  if (state.cycle.index >= list.length) {
    if (state.cycle.phase === 'new') {
      if (state.cycle.reviewList.length) {
        state.cycle.phase = 'review';
        state.cycle.index = 0;
      } else {
        buildCycle();
      }
    } else if (!state.cycle.reviewList.length) {
      buildCycle();
    } else {
      state.cycle.index = 0;
    }
    list = getActiveCycleList();
  }

  return list[state.cycle.index] || null;
}

function nextItem() {
  ensureCycle();
  const list = getActiveCycleList();
  if (!list.length) return null;
  state.cycle.index += 1;

  if (state.cycle.phase === 'new') {
    if (state.cycle.index >= list.length) {
      if (state.cycle.reviewList.length) {
        state.cycle.phase = 'review';
        state.cycle.index = 0;
      } else {
        buildCycle();
      }
    }
  } else if (!state.cycle.reviewList.length) {
    buildCycle();
  } else if (state.cycle.index >= state.cycle.reviewList.length) {
    state.cycle.index = 0;
  }
  updatePanel();
  return getCurrentItem();
}

function markKnown() {
  const it = getCurrentItem();
  if (!it) return;
  state.known.add(it.word);
  saveKnown(state.sourceUrl);
  nextItem();
}

function setWordStatus(status) {
  const it = getCurrentItem();
  if (!it) return;
  if (!STATUS_VALUES.includes(status)) return;
  const word = it.word;
  state.statusMap.set(word, status);

  if (status === 'familiar') {
    const nextStreak = (state.familiarStreak.get(word) || 0) + 1;
    state.familiarStreak.set(word, nextStreak);
    state.known.add(word);
    if (nextStreak >= 2) {
      removeFromReview(word);
    } else if (state.cycle.phase === 'review') {
      addToReview(it);
    } else {
      removeFromReview(word);
    }
  } else {
    state.familiarStreak.set(word, 0);
    state.known.delete(word);
    addToReview(it);
  }

  saveKnown(state.sourceUrl);
  saveStatus(state.sourceUrl);
  saveStreak(state.sourceUrl);
  nextItem();
}

function clearWordStatus() {
  const it = getCurrentItem();
  if (!it) return;
  const word = it.word;
  state.statusMap.delete(word);
  state.known.delete(word);
  state.familiarStreak.set(word, 0);
  addToReview(it);
  saveKnown(state.sourceUrl);
  saveStatus(state.sourceUrl);
  saveStreak(state.sourceUrl);
  nextItem();
}

function setMode(mode) {
  if (mode !== 'drill' && mode !== 'reader') return;
  if (pluginConfig.mode === mode) return;
  pluginConfig.mode = mode;
  saveSettings();
  updatePanel();
}

function setPanelOpen(open) {
  if (!pluginConfig.enableDrill && open) return;
  state.panelOpen = open;
  const panel = document.getElementById('vocab-break-panel');
  if (!panel) return;
  panel.classList.toggle('is-open', open);

  if (pluginConfig.rememberPanel) {
    pluginConfig.panelOpen = open;
    saveSettings();
  }

  if (open && !state.items.length && !state.loading) {
    loadSource({ force: false });
  }

  updatePanel();
  if (open) ensurePanelInView(panel, 'drill');
}

function setReaderPanelOpen(open) {
  if (!pluginConfig.enableReader && open) return;
  state.readerPanelOpen = open;
  const panel = document.getElementById('vocab-break-reader-panel');
  if (!panel) return;
  panel.classList.toggle('is-open', open);

  if (pluginConfig.rememberPanel) {
    pluginConfig.readerPanelOpen = open;
    saveSettings();
  }

  updatePanel();
  if (open) ensurePanelInView(panel, 'reader');
}

function updateDrillPanel() {
  const panel = document.getElementById('vocab-break-panel');
  if (!panel) return;
  if (!pluginConfig.enableDrill) {
    panel.classList.remove('is-open');
  }

  const status = panel.querySelector('.vb-status');
  const wordEl = panel.querySelector('.vb-word');
  const meaningEl = panel.querySelector('.vb-meaning');
  const statusEl = panel.querySelector('.vb-word-status');
  const metaEl = panel.querySelector('.vb-meta');
  const toggleBtn = panel.querySelector('.vb-toggle');
  const pinBtn = panel.querySelector('.vb-pin');
  const statusBtns = panel.querySelectorAll('[data-status]');

  if (status) {
    if (state.loading) status.textContent = '加载中';
    else if (state.error) status.textContent = '出错';
    else {
      const list = getActiveCycleList();
      const total = list.length || state.cycle.size;
      const idx = Math.min(state.cycle.index + 1, total);
      const phaseLabel = state.cycle.phase === 'review' ? '复习' : '新词';
      const reviewLeft =
        state.cycle.reviewList.length && state.cycle.phase === 'new'
          ? ` · 待复习 ${state.cycle.reviewList.length}`
          : '';
      status.textContent = `${state.items.length} 个单词 · ${phaseLabel} ${idx}/${total}${reviewLeft}`;
    }
  }

  if (wordEl && meaningEl) {
    if (state.error) {
      wordEl.textContent = '加载失败';
      meaningEl.textContent = state.error;
      meaningEl.classList.add('vb-error');
    } else {
      const current = getCurrentItem();
      if (!current) {
        wordEl.textContent = '暂无词条';
        meaningEl.textContent =
          state.items.length && state.known.size >= state.items.length ? '已标记全部认识' : '请先选择词库并刷新';
        meaningEl.classList.remove('vb-error');
      } else {
        wordEl.textContent = current.word;
        meaningEl.textContent = current.meaning || '（暂无释义）';
        meaningEl.classList.remove('vb-error');
      }
    }

    meaningEl.classList.toggle('is-hidden', !pluginConfig.showMeaning);
  }

  if (statusEl) {
    const current = getCurrentItem();
    const status = current ? getWordStatus(current.word) : null;
    statusEl.textContent = `状态：${getStatusLabel(status)}`;
  }

  if (metaEl) {
    metaEl.textContent = `${state.sourceLabel || '词库'} | ${state.sourceLicense || '许可'}`;
  }

  if (toggleBtn) {
    toggleBtn.textContent = pluginConfig.showMeaning ? '隐藏释义' : '显示释义';
  }

  if (pinBtn) {
    pinBtn.classList.toggle('is-on', state.pinned);
  }

  if (statusBtns && statusBtns.length) {
    const current = getCurrentItem();
    const status = current ? getWordStatus(current.word) : null;
    statusBtns.forEach(btn => {
      const el = /** @type {HTMLElement} */ (btn);
      el.classList.toggle('is-active', el.dataset.status === status);
    });
  }
}

function updateReaderPanel() {
  const panel = document.getElementById('vocab-break-reader-panel');
  if (!panel) return;
  if (!pluginConfig.enableReader) {
    panel.classList.remove('is-open');
  }

  panel.classList.toggle('is-compact', isCompactViewport());

  const readerTitleEl = panel.querySelector('.vb-reader-title');
  const readerPageEl = panel.querySelector('.vb-reader-page');
  const readerMetaEl = panel.querySelector('.vb-reader-meta');
  const readerJumpInput = panel.querySelector('.vb-reader-jump-input');
  const readerJumpBtn = panel.querySelector('.vb-reader-jump-btn');
  const readerEncodingSelect = panel.querySelector('.vb-reader-encoding-select');
  const remoteBox = panel.querySelector('.vb-reader-remote');
  const remoteToggleBtn = panel.querySelector('.vb-reader-remote-toggle');
  const remoteSourceSelect = panel.querySelector('.vb-remote-source');
  const remoteChapterSelect = panel.querySelector('.vb-remote-chapter');
  const remoteStatusEl = panel.querySelector('.vb-reader-remote-status');
  const librarySelect = panel.querySelector('.vb-library-select');
  const libraryStatusEl = panel.querySelector('.vb-reader-library-status');
  const libraryLoadBtn = panel.querySelector('.vb-library-load');
  const libraryRemoveBtn = panel.querySelector('.vb-library-remove');
  const libraryBox = panel.querySelector('.vb-reader-library');
  const libraryToggle = panel.querySelector('.vb-reader-library-toggle');
  const libraryBody = panel.querySelector('.vb-reader-library-body');
  const toolsBox = panel.querySelector('.vb-reader-tools');
  const toolsToggle = panel.querySelector('.vb-reader-tools-toggle');
  const toolsBody = panel.querySelector('.vb-reader-tools-body');
  const readerChatToggle = panel.querySelector('.vb-reader-chat-toggle');
  const bookmarkWrap = panel.querySelector('.vb-reader-bookmarks');
  const bookmarkToggle = panel.querySelector('.vb-reader-bookmarks-toggle');
  const bookmarkCount = panel.querySelector('.vb-reader-bookmarks-count');
  const bookmarkPanel = panel.querySelector('.vb-reader-bookmarks-panel');

  if (readerTitleEl) {
    readerTitleEl.textContent = state.reader.title || '未导入 TXT / 未加载远程章节';
  }

  if (readerPageEl) {
    if (!state.reader.pages.length) {
      readerPageEl.textContent = '暂无内容';
    } else {
      readerPageEl.textContent = state.reader.pages[state.reader.pageIndex] || '';
    }
    readerPageEl.style.fontSize = `${Number(pluginConfig.readerFontSize || 14)}px`;
    readerPageEl.style.lineHeight = String(Number(pluginConfig.readerLineHeight || 1.6));
    if (pluginConfig.readerKeepScroll) {
      restoreReaderScrollTop(readerPageEl);
    } else {
      readerPageEl.scrollTop = 0;
      state.reader.pendingScrollTop = null;
    }
  }

  if (readerMetaEl) {
    if (!state.reader.pages.length) {
      readerMetaEl.textContent = '';
    } else {
      readerMetaEl.textContent = `第 ${state.reader.pageIndex + 1} / ${state.reader.pages.length} 页`;
    }
  }

  if (readerChatToggle instanceof HTMLButtonElement) {
    readerChatToggle.classList.toggle('is-on', !!pluginConfig.chatDockOpen);
  }

  if (libraryBox instanceof HTMLElement) {
    libraryBox.classList.toggle('is-collapsed', !!pluginConfig.readerLibraryCollapsed);
  }
  if (libraryBody instanceof HTMLElement) {
    libraryBody.style.display = pluginConfig.readerLibraryCollapsed ? 'none' : 'flex';
  }
  if (libraryToggle instanceof HTMLButtonElement) {
    libraryToggle.textContent = pluginConfig.readerLibraryCollapsed ? '展开' : '收起';
  }

  if (toolsBox instanceof HTMLElement) {
    toolsBox.classList.toggle('is-collapsed', !!pluginConfig.readerToolsCollapsed);
  }
  if (toolsBody instanceof HTMLElement) {
    toolsBody.style.display = pluginConfig.readerToolsCollapsed ? 'none' : 'flex';
  }
  if (toolsToggle instanceof HTMLButtonElement) {
    toolsToggle.textContent = pluginConfig.readerToolsCollapsed ? '展开' : '收起';
  }

  if (readerJumpInput instanceof HTMLInputElement) {
    const totalPages = state.reader.pages.length;
    readerJumpInput.max = totalPages ? String(totalPages) : '';
    readerJumpInput.placeholder = totalPages ? `1-${totalPages}` : '页码';
    readerJumpInput.disabled = !totalPages;
  }
  if (readerJumpBtn instanceof HTMLButtonElement) {
    readerJumpBtn.disabled = !state.reader.pages.length;
  }

  if (bookmarkWrap instanceof HTMLElement) {
    bookmarkWrap.classList.toggle('is-open', !!pluginConfig.readerBookmarksOpen);
  }
  if (bookmarkPanel instanceof HTMLElement) {
    bookmarkPanel.style.display = pluginConfig.readerBookmarksOpen ? 'flex' : 'none';
  }
  if (bookmarkToggle instanceof HTMLButtonElement) {
    bookmarkToggle.textContent = pluginConfig.readerBookmarksOpen ? '收起' : '展开';
  }
  if (bookmarkCount instanceof HTMLElement) {
    bookmarkCount.textContent = String(state.reader.bookmarks.length || 0);
  }

  const bookmarkAdd = panel.querySelector('.vb-reader-bookmark-add');
  if (bookmarkAdd instanceof HTMLButtonElement) {
    bookmarkAdd.disabled = !state.reader.pages.length;
  }

  const bookmarkList = panel.querySelector('.vb-reader-bookmarks-list');
  if (bookmarkList instanceof HTMLElement) {
    bookmarkList.innerHTML = '';
    if (!state.reader.bookmarks.length) {
      const empty = document.createElement('div');
      empty.className = 'vb-reader-bookmark-empty';
      empty.textContent = '暂无书签';
      bookmarkList.appendChild(empty);
    } else {
      state.reader.bookmarks.forEach((bm, idx) => {
        const row = document.createElement('div');
        row.className = 'vb-reader-bookmark-row';
        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'vb-reader-bookmark-jump';
        label.dataset.bookmarkJump = '1';
        label.dataset.page = String(bm.page || 0);
        label.textContent = bm.label || `第${bm.page}页`;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'vb-reader-bookmark-delete';
        del.dataset.bookmarkDelete = '1';
        del.dataset.index = String(idx);
        del.textContent = '删除';
        row.appendChild(label);
        row.appendChild(del);
        bookmarkList.appendChild(row);
      });
    }
  }

  if (remoteBox instanceof HTMLElement) {
    remoteBox.classList.toggle('is-collapsed', !!pluginConfig.readerRemoteCollapsed);
  }
  if (remoteToggleBtn instanceof HTMLButtonElement) {
    remoteToggleBtn.textContent = pluginConfig.readerRemoteCollapsed ? '展开' : '收起';
  }

  if (
    state.readerPanelOpen &&
    !pluginConfig.readerRemoteCollapsed &&
    !state.remote.loadingIndex &&
    (state.remote.sourceId !== pluginConfig.readerRemoteSourceId || !state.remote.chapters.length)
  ) {
    loadRemoteIndex();
  }

  if (remoteSourceSelect) {
    remoteSourceSelect.innerHTML = REMOTE_SOURCES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
    remoteSourceSelect.value = pluginConfig.readerRemoteSourceId;
  }

  if (remoteChapterSelect) {
    const chapters = state.remote.chapters || [];
    if (!chapters.length) {
      remoteChapterSelect.innerHTML = '<option value="">（请先加载目录）</option>';
    } else {
      remoteChapterSelect.innerHTML = chapters
        .map((c, i) => `<option value="${c.url}">${i + 1}. ${c.title}</option>`)
        .join('');

      const savedUrl = pluginConfig.readerRemoteChapterUrl;
      if (savedUrl && chapters.some(c => c.url === savedUrl)) {
        remoteChapterSelect.value = savedUrl;
      } else {
        remoteChapterSelect.value = chapters[0].url;
        pluginConfig.readerRemoteChapterUrl = chapters[0].url;
        saveSettings();
      }
    }
  }

  if (remoteStatusEl) {
    if (state.remote.loadingIndex) {
      remoteStatusEl.textContent = '目录加载中…';
    } else if (state.remote.loadingChapter) {
      remoteStatusEl.textContent = '章节加载中…';
    } else if (state.remote.error) {
      remoteStatusEl.textContent = `错误：${state.remote.error}`;
    } else if (state.remote.chapters.length) {
      remoteStatusEl.textContent = `目录 ${state.remote.chapters.length} 章`;
    } else {
      remoteStatusEl.textContent = '未加载目录';
    }
  }

  if (librarySelect) {
    const items = state.reader.library.items || [];
    if (!items.length) {
      librarySelect.innerHTML = '<option value="">（暂无已保存TXT）</option>';
    } else {
      librarySelect.innerHTML = items
        .map(it => {
          const size = it.bytes ? ` · ${formatBytes(it.bytes)}` : '';
          return `<option value="${it.id}">${it.title}${size}</option>`;
        })
        .join('');
      const selected = state.reader.library.selectedId || items[0]?.id || '';
      state.reader.library.selectedId = selected;
      librarySelect.value = selected;
    }
  }

  if (libraryStatusEl) {
    if (state.reader.library.loading) {
      libraryStatusEl.textContent = '书架处理中…';
    } else if (state.reader.library.error) {
      libraryStatusEl.textContent = `书架错误：${state.reader.library.error}`;
    } else if (state.reader.library.items.length) {
      libraryStatusEl.textContent = `已保存 ${state.reader.library.items.length} 本`;
    } else {
      libraryStatusEl.textContent = '书架为空';
    }
  }

  if (readerEncodingSelect instanceof HTMLSelectElement) {
    readerEncodingSelect.innerHTML = TEXT_ENCODINGS.map(
      encoding => `<option value="${encoding.id}">${encoding.label}</option>`,
    ).join('');
    readerEncodingSelect.value = pluginConfig.readerEncoding;
  }

  // Chat UI moved to external dock.
  const hasLibraryItems = !!state.reader.library.items.length;
  if (libraryLoadBtn instanceof HTMLButtonElement) {
    libraryLoadBtn.disabled = !hasLibraryItems || state.reader.library.loading;
  }
  if (libraryRemoveBtn instanceof HTMLButtonElement) {
    libraryRemoveBtn.disabled = !hasLibraryItems || state.reader.library.loading;
  }
}

function updateChatDock() {
  const dock = document.getElementById('vocab-break-reader-chat-dock');
  if (!dock) return;

  const shouldShow = pluginConfig.enableReader && state.readerPanelOpen && !!pluginConfig.chatDockOpen;
  dock.style.display = shouldShow ? 'flex' : 'none';
  dock.classList.toggle('is-open', !!pluginConfig.chatDockOpen);
  const compact = isCompactViewport();
  dock.classList.toggle('is-compact', compact);

  const readerPanel = document.getElementById('vocab-break-reader-panel');
  if (readerPanel) {
    readerPanel.classList.toggle('is-chat-open', compact && !!pluginConfig.chatDockOpen);
  }

  const panel = dock.querySelector('.vb-chat-panel');
  if (panel instanceof HTMLElement) {
    panel.style.display = pluginConfig.chatDockOpen ? 'flex' : 'none';
  }

  const chatLog = dock.querySelector('.vb-chat-log');
  if (chatLog instanceof HTMLElement) {
    chatLog.innerHTML = '';
    if (!state.chat.messages.length) {
      const empty = document.createElement('div');
      empty.className = 'vb-chat-empty';
      empty.textContent = '还没有对话';
      chatLog.appendChild(empty);
    } else {
      for (const msg of state.chat.messages) {
        const row = document.createElement('div');
        row.className = `vb-chat-msg vb-chat-${msg.role}`;
        const bubble = document.createElement('div');
        bubble.className = 'vb-chat-bubble';
        bubble.textContent = msg.content || '';
        row.appendChild(bubble);
        chatLog.appendChild(row);
      }
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  const chatStatus = dock.querySelector('.vb-chat-status');
  if (chatStatus) {
    if (state.chat.sending) {
      chatStatus.textContent = '生成中…';
    } else if (state.chat.error) {
      chatStatus.textContent = `错误：${state.chat.error}`;
    } else if (state.chat.messages.length && state.chat.messages[state.chat.messages.length - 1].role === 'user') {
      chatStatus.textContent = '已输入，点击“生成回复”';
    } else {
      chatStatus.textContent = '';
    }
  }

  const chatSendBtn = dock.querySelector('.vb-chat-send');
  if (chatSendBtn instanceof HTMLButtonElement) {
    chatSendBtn.disabled = state.chat.sending;
  }

  const chatGenerateBtn = dock.querySelector('.vb-chat-generate');
  if (chatGenerateBtn instanceof HTMLButtonElement) {
    const hasPending =
      state.chat.messages.length && state.chat.messages[state.chat.messages.length - 1].role === 'user';
    chatGenerateBtn.disabled = state.chat.sending || !hasPending;
  }

  if (!shouldShow) {
    dock.classList.remove('is-modal');
    dock.style.width = '';
    dock.style.height = '';
    dock.style.left = '';
    dock.style.top = '';
    dock.style.right = '';
    dock.style.bottom = '';
    return;
  }

  if (compact && readerPanel) {
    const rect = readerPanel.getBoundingClientRect();
    dock.classList.add('is-modal');
    dock.style.left = `${Math.round(rect.left)}px`;
    dock.style.top = `${Math.round(rect.top)}px`;
    dock.style.right = 'auto';
    dock.style.bottom = 'auto';
    dock.style.width = `${Math.round(rect.width)}px`;
    dock.style.height = `${Math.round(rect.height)}px`;
    return;
  }

  dock.classList.remove('is-modal');
  dock.style.width = '';
  dock.style.height = '';
  dock.style.left = '';
  dock.style.top = '';
  dock.style.right = '';
  dock.style.bottom = '';
}

function updateSettingsPanel() {
  const root = document.getElementById('vocab-break-settings');
  if (!root) return;

  const providerSelect = root.querySelector(`#${MODULE_NAME}_api_provider`);
  if (providerSelect) {
    providerSelect.value = pluginConfig.apiProvider;
  }

  const endpointInput = root.querySelector(`#${MODULE_NAME}_api_endpoint`);
  if (endpointInput instanceof HTMLInputElement) {
    endpointInput.value = pluginConfig.apiEndpoint || '';
  }

  const keyInput = root.querySelector(`#${MODULE_NAME}_api_key`);
  if (keyInput instanceof HTMLInputElement) {
    keyInput.value = pluginConfig.apiKey || '';
  }

  const modelInput = root.querySelector(`#${MODULE_NAME}_api_model`);
  if (modelInput instanceof HTMLInputElement) {
    modelInput.value = pluginConfig.apiModel || '';
  }

  const modelSelect = root.querySelector(`#${MODULE_NAME}_api_model_select`);
  if (modelSelect instanceof HTMLSelectElement) {
    const models = state.chat.models || [];
    const options = [
      '<option value="">（手动输入）</option>',
      ...models.map(m => `<option value="${m}">${m}</option>`),
    ];
    modelSelect.innerHTML = options.join('');
    modelSelect.value = pluginConfig.apiModel || '';
  }

  const modelStatus = root.querySelector(`#${MODULE_NAME}_api_model_status`);
  if (modelStatus) {
    if (state.chat.modelsLoading) {
      modelStatus.textContent = '模型拉取中…';
    } else if (state.chat.modelsError) {
      modelStatus.textContent = `错误：${state.chat.modelsError}`;
    } else if (state.chat.models.length) {
      modelStatus.textContent = `已拉取 ${state.chat.models.length} 个模型`;
    } else {
      modelStatus.textContent = '';
    }
  }

  const streamToggle = root.querySelector(`#${MODULE_NAME}_api_stream`);
  if (streamToggle instanceof HTMLInputElement) {
    streamToggle.checked = !!pluginConfig.apiStream;
  }

  const jailbreakInput = root.querySelector(`#${MODULE_NAME}_jailbreak`);
  if (jailbreakInput instanceof HTMLTextAreaElement) {
    jailbreakInput.value = pluginConfig.jailbreakPrompt || '';
  }

  const historyStart = root.querySelector(`#${MODULE_NAME}_reader_history_start`);
  if (historyStart instanceof HTMLInputElement) {
    historyStart.value = pluginConfig.readerHistoryStartPage ? String(pluginConfig.readerHistoryStartPage) : '';
  }

  const historyToggle = root.querySelector(`#${MODULE_NAME}_reader_history_enabled`);
  if (historyToggle instanceof HTMLInputElement) {
    historyToggle.checked = !!pluginConfig.readerHistoryEnabled;
  }

  const progressEl = root.querySelector(`#${MODULE_NAME}_reader_history_progress`);
  if (progressEl) {
    progressEl.textContent = String(pluginConfig.readerMaxPage || 0);
  }
}

function updatePanel() {
  updateDrillPanel();
  updateReaderPanel();
  updateChatDock();
  updateSettingsPanel();
  applyPanelSizing();

  const drillBar = document.getElementById('vocab-break-bar');
  if (drillBar) {
    const shouldShow = pluginConfig.enableDrill && !state.panelOpen;
    drillBar.classList.toggle('is-open', shouldShow);
    const title = drillBar.querySelector('.vb-bar-title');
    if (title) title.textContent = '背词小窗';
  }

  const readerBar = document.getElementById('vocab-break-reader-bar');
  if (readerBar) {
    const shouldShow = pluginConfig.enableReader && !state.readerPanelOpen;
    readerBar.classList.toggle('is-open', shouldShow);
    const title = readerBar.querySelector('.vb-bar-title');
    if (title) title.textContent = '阅读小窗';
  }

  applyFloatingPositions();
  const drillPanel = document.getElementById('vocab-break-panel');
  if (drillPanel) ensurePanelInView(drillPanel, 'drill');
  const readerPanel = document.getElementById('vocab-break-reader-panel');
  if (readerPanel) ensurePanelInView(readerPanel, 'reader');
  applyTheme();
}

function ensureReaderFileInput() {
  if (document.getElementById('vocab-break-reader-file')) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,text/plain';
  input.id = 'vocab-break-reader-file';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const result = await readTextFromFile(file, pluginConfig.readerEncoding);
      const text = result.text;
      if (!text || !text.trim()) {
        toastr?.warning?.('TXT 为空或无法读取。', '背词小窗');
        return;
      }
      const tempKey = `local:${getStringHash(`${file.name}:${text.slice(0, 200)}`)}`;
      setReaderText(text, file.name, { bookKey: tempKey });
      const byteSize = new Blob([text]).size;
      if (byteSize <= Number(pluginConfig.readerCacheMaxBytes)) {
        const entryId = await addReaderLibraryEntry({
          title: file.name,
          content: text,
        });
        if (entryId) {
          const newKey = `book:${entryId}`;
          migrateReaderBookmarks(tempKey, newKey);
          setReaderBookKey(newKey, file.name);
        }
      }
      setReaderPanelOpen(true);
      if (pluginConfig.readerEncoding === 'auto' && result.detected) {
        const encodingId = result.encoding;
        if (encodingId && encodingId !== 'utf-8') {
          const label = getEncodingLabel(encodingId);
          toastr?.info?.(`自动识别编码：${label}`, '背词小窗');
        }
      } else if (pluginConfig.readerEncoding !== 'auto' && result.detected) {
        const label = getEncodingLabel(result.encoding);
        toastr?.warning?.(`所选编码不可用，已回退为 ${label || '自动识别'}`, '背词小窗');
      }
      toastr?.success?.('已导入 TXT 阅读内容。', '背词小窗');
      updatePanel();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toastr?.error?.(msg, '背词小窗');
    } finally {
      input.value = '';
    }
  });
  document.body.appendChild(input);
}

function openReaderFilePicker() {
  ensureReaderFileInput();
  const input = document.getElementById('vocab-break-reader-file');
  if (input instanceof HTMLInputElement) input.click();
}

function ensureBar() {
  if (document.getElementById('vocab-break-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'vocab-break-bar';
  bar.innerHTML = `
    <div class="vb-bar-title">背词小窗</div>
    <div class="vb-bar-caret">▾</div>
  `;
  bar.addEventListener('pointerdown', e => {
    beginDrag(e, bar);
  });
  bar.addEventListener('click', () => {
    if (state.drag.justDragged) {
      state.drag.justDragged = false;
      return;
    }
    if (!pluginConfig.enableDrill) return;
    setPanelOpen(true);
    updatePanel();
  });
  document.body.appendChild(bar);
  applyTheme();
}

function ensureReaderBar() {
  if (document.getElementById('vocab-break-reader-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'vocab-break-reader-bar';
  bar.innerHTML = `
    <div class="vb-bar-title">阅读小窗</div>
    <div class="vb-bar-caret">▾</div>
  `;
  bar.addEventListener('pointerdown', e => {
    beginDrag(e, bar);
  });
  bar.addEventListener('click', () => {
    if (state.drag.justDragged) {
      state.drag.justDragged = false;
      return;
    }
    if (!pluginConfig.enableReader) return;
    setReaderPanelOpen(true);
    updatePanel();
  });
  document.body.appendChild(bar);
  applyTheme();
}

function ensurePanel() {
  if (document.getElementById('vocab-break-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'vocab-break-panel';
  panel.innerHTML = `
    <div class="vb-header">
      <div class="vb-title">背词小窗</div>
      <div class="vb-status">0 个单词</div>
      <button class="vb-pin" type="button" title="钉住">钉住</button>
      <button class="vb-close" type="button" title="关闭">×</button>
    </div>
    <div class="vb-body vb-body-drill">
      <div class="vb-word">准备好了</div>
      <div class="vb-word-status">状态：未标记</div>
      <div class="vb-meaning is-hidden">先选择词库并刷新。</div>
    </div>
    <div class="vb-actions vb-actions-drill">
      <button class="vb-toggle" type="button">显示释义</button>
      <button class="vb-next" type="button">跳过</button>
    </div>
    <div class="vb-actions vb-actions-drill-status">
      <button class="vb-status-btn" data-status="unknown" type="button">不认识</button>
      <button class="vb-status-btn" data-status="fuzzy" type="button">模糊</button>
      <button class="vb-status-btn" data-status="familiar" type="button">熟悉</button>
      <button class="vb-status-btn" data-status="none" type="button">清除</button>
    </div>
    <div class="vb-footer">
      <span class="vb-meta">-</span>
    </div>
  `;

  panel.addEventListener('click', e => e.stopPropagation());
  document.body.appendChild(panel);

  panel.querySelector('.vb-close')?.addEventListener('click', () => {
    setPanelOpen(false);
  });

  panel.querySelector('.vb-header')?.addEventListener('pointerdown', e => {
    beginDrag(e, panel);
  });

  panel.querySelector('.vb-pin')?.addEventListener('click', () => {
    state.pinned = !state.pinned;
    updatePanel();
  });

  panel.querySelector('.vb-toggle')?.addEventListener('click', () => {
    pluginConfig.showMeaning = !pluginConfig.showMeaning;
    saveSettings();
    updatePanel();
  });

  panel.querySelector('.vb-next')?.addEventListener('click', () => {
    nextItem();
  });

  panel.querySelectorAll('.vb-status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = /** @type {HTMLElement} */ (btn);
      const status = el.dataset.status;
      if (status === 'none') {
        clearWordStatus();
      } else if (status) {
        setWordStatus(status);
      }
    });
  });

  updatePanel();
}

function ensureReaderPanel() {
  if (document.getElementById('vocab-break-reader-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'vocab-break-reader-panel';
  panel.classList.add('is-reader');
  panel.innerHTML = `
    <div class="vb-header">
      <div class="vb-title">阅读小窗</div>
      <div class="vb-header-actions">
        <button class="vb-reader-chat-toggle" type="button" title="阅读对话">对话</button>
        <button class="vb-close" type="button" title="关闭">×</button>
      </div>
    </div>
    <div class="vb-body vb-body-reader">
      <div class="vb-reader-remote">
        <div class="vb-reader-remote-head">
          <div class="vb-reader-remote-title">远程教材</div>
          <button class="vb-reader-remote-toggle" type="button">收起</button>
        </div>
        <div class="vb-reader-remote-body">
          <div class="vb-reader-remote-row">
            <select class="vb-remote-source"></select>
            <button class="vb-remote-refresh" type="button">加载目录</button>
          </div>
          <div class="vb-reader-remote-row">
            <select class="vb-remote-chapter"></select>
            <button class="vb-remote-load" type="button">加载章节</button>
          </div>
          <div class="vb-reader-remote-status"></div>
        </div>
      </div>
      <div class="vb-reader-library">
        <div class="vb-reader-library-head">
          <div class="vb-reader-library-title">本地书架</div>
          <button class="vb-reader-library-toggle" type="button">收起</button>
        </div>
        <div class="vb-reader-library-body">
          <div class="vb-reader-library-row">
            <select class="vb-library-select"></select>
            <button class="vb-library-load" type="button">打开</button>
            <button class="vb-library-remove" type="button">删除</button>
          </div>
          <div class="vb-reader-library-status"></div>
        </div>
      </div>
      <div class="vb-reader-title">未导入 TXT</div>
      <div class="vb-reader-page">暂无内容</div>
    </div>
    <div class="vb-actions vb-actions-reader">
      <button class="vb-reader-prev" type="button">上一页</button>
      <button class="vb-reader-next" type="button">下一页</button>
      <button class="vb-reader-import" type="button">导入TXT</button>
    </div>
    <div class="vb-reader-tools">
      <div class="vb-reader-tools-head">
        <span>阅读设置</span>
        <button class="vb-reader-tools-toggle" type="button">收起</button>
      </div>
      <div class="vb-reader-tools-body">
        <div class="vb-reader-encoding">
          <span class="vb-reader-encoding-label">编码</span>
          <select class="vb-reader-encoding-select"></select>
        </div>
        <div class="vb-reader-jump">
          <input class="vb-reader-jump-input" type="number" min="1" placeholder="页码" />
          <button class="vb-reader-jump-btn" type="button">跳转</button>
        </div>
      </div>
    </div>
    <div class="vb-reader-bookmarks">
      <div class="vb-reader-bookmarks-head">
        <span class="vb-reader-bookmarks-title">书签
          <span class="vb-reader-bookmarks-count">0</span>
        </span>
        <button class="vb-reader-bookmarks-toggle" type="button">展开</button>
      </div>
      <div class="vb-reader-bookmarks-panel">
        <div class="vb-reader-bookmarks-actions">
          <button class="vb-reader-bookmark-add" type="button">添加书签</button>
        </div>
        <div class="vb-reader-bookmarks-list"></div>
      </div>
    </div>
    <div class="vb-footer">
      <span class="vb-reader-meta"></span>
    </div>
  `;

  panel.addEventListener('click', e => e.stopPropagation());
  document.body.appendChild(panel);

  panel.querySelector('.vb-close')?.addEventListener('click', () => {
    setReaderPanelOpen(false);
  });

  panel.querySelector('.vb-reader-chat-toggle')?.addEventListener('click', () => {
    pluginConfig.chatDockOpen = !pluginConfig.chatDockOpen;
    saveSettings();
    updatePanel();
  });

  panel.querySelector('.vb-header')?.addEventListener('pointerdown', e => {
    beginDrag(e, panel);
  });

  panel.querySelector('.vb-reader-prev')?.addEventListener('click', () => {
    readerPrev();
  });

  panel.querySelector('.vb-reader-next')?.addEventListener('click', () => {
    readerNext();
  });

  panel.querySelector('.vb-reader-import')?.addEventListener('click', () => {
    openReaderFilePicker();
  });

  panel.querySelector('.vb-reader-remote-toggle')?.addEventListener('click', () => {
    pluginConfig.readerRemoteCollapsed = !pluginConfig.readerRemoteCollapsed;
    saveSettings();
    updatePanel();
  });

  panel.querySelector('.vb-reader-library-toggle')?.addEventListener('click', () => {
    pluginConfig.readerLibraryCollapsed = !pluginConfig.readerLibraryCollapsed;
    saveSettings();
    updatePanel();
  });

  panel.querySelector('.vb-reader-tools-toggle')?.addEventListener('click', () => {
    pluginConfig.readerToolsCollapsed = !pluginConfig.readerToolsCollapsed;
    saveSettings();
    updatePanel();
  });

  const jumpInput = panel.querySelector('.vb-reader-jump-input');
  const jumpBtn = panel.querySelector('.vb-reader-jump-btn');
  if (jumpBtn instanceof HTMLButtonElement) {
    jumpBtn.addEventListener('click', () => {
      if (jumpInput instanceof HTMLInputElement) {
        jumpReaderPage(jumpInput.value);
      }
    });
  }
  if (jumpInput instanceof HTMLInputElement) {
    jumpInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        jumpReaderPage(jumpInput.value);
      }
    });
  }

  panel.querySelector('.vb-reader-bookmarks-toggle')?.addEventListener('click', () => {
    pluginConfig.readerBookmarksOpen = !pluginConfig.readerBookmarksOpen;
    saveSettings();
    updatePanel();
  });

  panel.querySelector('.vb-reader-bookmark-add')?.addEventListener('click', () => {
    addReaderBookmark();
  });

  panel.addEventListener('click', e => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;
    const jumpBtn = target.closest('[data-bookmark-jump]');
    if (jumpBtn instanceof HTMLElement) {
      const page = Number(jumpBtn.dataset.page || 0);
      if (page) jumpToReaderBookmark(page);
      return;
    }
    const deleteBtn = target.closest('[data-bookmark-delete]');
    if (deleteBtn instanceof HTMLElement) {
      const idx = Number(deleteBtn.dataset.index || -1);
      if (Number.isFinite(idx) && idx >= 0) removeReaderBookmark(idx);
    }
  });

  const encodingSelect = panel.querySelector('.vb-reader-encoding-select');
  if (encodingSelect instanceof HTMLSelectElement) {
    encodingSelect.addEventListener('change', () => {
      pluginConfig.readerEncoding = encodingSelect.value;
      saveSettings();
      updatePanel();
    });
  }

  const remoteSourceEl = panel.querySelector('.vb-remote-source');
  if (remoteSourceEl instanceof HTMLSelectElement) {
    remoteSourceEl.addEventListener('change', () => {
      pluginConfig.readerRemoteSourceId = remoteSourceEl.value;
      pluginConfig.readerRemoteChapterUrl = '';
      saveSettings();
      state.remote.sourceId = '';
      state.remote.chapters = [];
      state.remote.error = '';
      loadRemoteIndex({ force: true });
    });
  }

  const remoteChapterEl = panel.querySelector('.vb-remote-chapter');
  if (remoteChapterEl instanceof HTMLSelectElement) {
    remoteChapterEl.addEventListener('change', () => {
      pluginConfig.readerRemoteChapterUrl = remoteChapterEl.value;
      saveSettings();
    });
  }

  panel.querySelector('.vb-remote-refresh')?.addEventListener('click', () => {
    loadRemoteIndex({ force: true });
  });

  panel.querySelector('.vb-remote-load')?.addEventListener('click', () => {
    const target = pluginConfig.readerRemoteChapterUrl;
    if (target) loadRemoteChapter(target);
  });

  const librarySelectEl = panel.querySelector('.vb-library-select');
  if (librarySelectEl instanceof HTMLSelectElement) {
    librarySelectEl.addEventListener('change', () => {
      state.reader.library.selectedId = librarySelectEl.value;
    });
  }

  panel.querySelector('.vb-library-load')?.addEventListener('click', () => {
    const target = state.reader.library.selectedId;
    if (target) loadReaderLibraryEntry(target);
  });

  panel.querySelector('.vb-library-remove')?.addEventListener('click', () => {
    const target = state.reader.library.selectedId;
    if (target) removeReaderLibraryEntry(target);
  });

  updatePanel();
}

function ensureReaderChatDock() {
  if (document.getElementById('vocab-break-reader-chat-dock')) return;
  const dock = document.createElement('div');
  dock.id = 'vocab-break-reader-chat-dock';
  dock.classList.add('is-reader');
  dock.innerHTML = `
    <button class="vb-chat-toggle" type="button">对话</button>
    <div class="vb-chat-panel">
      <div class="vb-chat-header">
        <div class="vb-chat-title">阅读对话</div>
        <button class="vb-chat-close" type="button">返回</button>
      </div>
      <div class="vb-chat-log"></div>
      <textarea class="vb-chat-input" rows="3" placeholder="输入消息，可连续多条，最后点生成回复"></textarea>
      <div class="vb-chat-actions">
        <button class="vb-chat-send" type="button">发送</button>
        <button class="vb-chat-generate" type="button">生成回复</button>
        <button class="vb-chat-clear" type="button">清空</button>
      </div>
      <div class="vb-chat-status"></div>
    </div>
  `;

  dock.addEventListener('click', e => e.stopPropagation());
  document.body.appendChild(dock);

  dock.querySelector('.vb-chat-toggle')?.addEventListener('click', () => {
    pluginConfig.chatDockOpen = !pluginConfig.chatDockOpen;
    saveSettings();
    updatePanel();
  });

  dock.querySelector('.vb-chat-close')?.addEventListener('click', () => {
    pluginConfig.chatDockOpen = false;
    saveSettings();
    updatePanel();
  });

  dock.querySelector('.vb-chat-send')?.addEventListener('click', () => {
    queueChatMessage();
  });

  dock.querySelector('.vb-chat-generate')?.addEventListener('click', () => {
    generateChatReply();
  });

  dock.querySelector('.vb-chat-clear')?.addEventListener('click', () => {
    clearChatMessages();
  });

  const chatInput = dock.querySelector('.vb-chat-input');
  if (chatInput instanceof HTMLTextAreaElement) {
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        queueChatMessage();
      }
    });
  }
}

function createSettingsInterface() {
  if (document.getElementById('vocab-break-settings')) return;
  const container = document.getElementById('extensions_settings');
  if (!container) return;

  const root = document.createElement('div');
  root.id = 'vocab-break-settings';
  root.className = 'inline-drawer';
  root.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>背词小窗</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="extension-content flex flexFlowColumn gap10px">
      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">启用背词小窗</div>
          <div class="settings-title-description">与阅读小窗二选一，不会同时显示</div>
        </div>
        <label class="toggle">
          <input id="${MODULE_NAME}_enable_drill" type="checkbox" class="toggle-input" ${
            pluginConfig.enableDrill ? 'checked' : ''
          } />
          <span class="toggle-label"></span>
        </label>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">启用阅读小窗</div>
          <div class="settings-title-description">与背词小窗二选一，不会同时显示</div>
        </div>
        <label class="toggle">
          <input id="${MODULE_NAME}_enable_reader" type="checkbox" class="toggle-input" ${
            pluginConfig.enableReader ? 'checked' : ''
          } />
          <span class="toggle-label"></span>
        </label>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">生成时自动弹出</div>
          <div class="settings-title-description">AI 开始生成时自动打开面板</div>
        </div>
        <label class="toggle">
          <input id="${MODULE_NAME}_auto_open" type="checkbox" class="toggle-input" ${
            pluginConfig.autoOpenOnGeneration ? 'checked' : ''
          } />
          <span class="toggle-label"></span>
        </label>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">生成结束自动关闭</div>
          <div class="settings-title-description">生成结束或中断时自动关闭面板（钉住时不关闭）</div>
        </div>
        <label class="toggle">
          <input id="${MODULE_NAME}_auto_close" type="checkbox" class="toggle-input" ${
            pluginConfig.autoCloseOnEnd ? 'checked' : ''
          } />
          <span class="toggle-label"></span>
        </label>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">词库来源</div>
          <div class="settings-title-description">远程 GitHub Raw（用于背词模式）</div>
        </div>
        <div class="vb-inline">
          <select id="${MODULE_NAME}_source">
            ${SOURCES.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
          </select>
          <button class="menu_button" id="${MODULE_NAME}_reload">刷新词库</button>
        </div>
        <div class="vb-inline" style="margin-top: 6px;">
          <input id="${MODULE_NAME}_custom" type="text" placeholder="https://example.com/wordlist.json" value="${
            pluginConfig.customUrl || ''
          }" />
        </div>
        <div class="vb-note" style="margin-top: 6px;">
          自定义 URL 仅在 “自定义链接” 时生效。
        </div>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">背词面板</div>
          <div class="settings-title-description">手动打开/关闭背词浮窗</div>
        </div>
        <div class="vb-inline">
          <button class="menu_button" id="${MODULE_NAME}_open">打开面板</button>
          <button class="menu_button" id="${MODULE_NAME}_close">关闭面板</button>
        </div>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">面板主题</div>
          <div class="settings-title-description">切换简约/档案/古风 UI</div>
        </div>
        <div class="vb-inline">
          <select id="${MODULE_NAME}_theme">
            <option value="minimal">简约</option>
            <option value="archive">档案风</option>
            <option value="ancient">古风</option>
            <option value="custom">自定义CSS</option>
          </select>
        </div>
        <div class="vb-note" style="margin-top: 6px;">
          自定义CSS 会应用到背词小窗和收缩栏。
        </div>
        <div class="vb-inline" style="margin-top: 6px;">
          <textarea id="${MODULE_NAME}_custom_css" rows="6" placeholder="写 CSS：#vocab-break-panel { ... }"></textarea>
        </div>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">背词面板尺寸</div>
          <div class="settings-title-description">调整背词小窗宽高</div>
        </div>
        <div class="vb-inline">
          <span>宽</span>
          <input id="${MODULE_NAME}_panel_width" type="range" min="240" max="600" step="20" value="${
            Number(pluginConfig.panelWidth) || 320
          }" />
          <span id="${MODULE_NAME}_panel_width_val">${Number(pluginConfig.panelWidth) || 320}</span>
        </div>
        <div class="vb-inline" style="margin-top: 6px;">
          <span>高</span>
          <input id="${MODULE_NAME}_panel_height" type="range" min="320" max="800" step="20" value="${
            Number(pluginConfig.panelHeight) || 420
          }" />
          <span id="${MODULE_NAME}_panel_height_val">${Number(pluginConfig.panelHeight) || 420}</span>
        </div>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">阅读面板尺寸</div>
          <div class="settings-title-description">调整阅读小窗宽高</div>
        </div>
        <div class="vb-inline">
          <span>宽</span>
          <input id="${MODULE_NAME}_reader_width" type="range" min="260" max="760" step="20" value="${
            Number(pluginConfig.readerPanelWidth) || 360
          }" />
          <span id="${MODULE_NAME}_reader_width_val">${Number(pluginConfig.readerPanelWidth) || 360}</span>
        </div>
        <div class="vb-inline" style="margin-top: 6px;">
          <span>高</span>
          <input id="${MODULE_NAME}_reader_height" type="range" min="360" max="1000" step="20" value="${
            Number(pluginConfig.readerPanelHeight) || 520
          }" />
          <span id="${MODULE_NAME}_reader_height_val">${Number(pluginConfig.readerPanelHeight) || 520}</span>
        </div>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">阅读模式（TXT 小说）</div>
          <div class="settings-title-description">导入长文本并分页阅读</div>
        </div>
        <div class="vb-inline">
          <button class="menu_button" id="${MODULE_NAME}_reader_import">导入 TXT</button>
          <button class="menu_button" id="${MODULE_NAME}_reader_clear">清空阅读内容</button>
        </div>
        <div class="vb-inline" style="margin-top: 6px;">
          <span>编码</span>
          <select id="${MODULE_NAME}_reader_encoding">
            ${TEXT_ENCODINGS.map(encoding => `<option value="${encoding.id}">${encoding.label}</option>`).join('')}
          </select>
        </div>
        <div class="vb-note" style="margin-top: 6px;">
          导入 TXT 时使用的编码，自动识别适用于常见 UTF-8/GBK/Big5/UTF-16。
        </div>
        <div class="vb-inline" style="margin-top: 6px;">
          <button class="menu_button" id="${MODULE_NAME}_reader_open">打开阅读面板</button>
          <button class="menu_button" id="${MODULE_NAME}_reader_close">关闭阅读面板</button>
        </div>
        <div class="vb-note" style="margin-top: 6px;">
          TXT 会缓存到本地浏览器（过大可能无法保存）。
        </div>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">翻页保持位置</div>
          <div class="settings-title-description">翻页后不自动回到页首</div>
        </div>
        <label class="toggle">
          <input id="${MODULE_NAME}_reader_keep_scroll" type="checkbox" class="toggle-input" ${
            pluginConfig.readerKeepScroll ? 'checked' : ''
          } />
          <span class="toggle-label"></span>
        </label>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">远程教材区域</div>
          <div class="settings-title-description">阅读面板中可折叠显示</div>
        </div>
        <label class="toggle">
          <input id="${MODULE_NAME}_reader_remote_collapse" type="checkbox" class="toggle-input" ${
            pluginConfig.readerRemoteCollapsed ? 'checked' : ''
          } />
          <span class="toggle-label"></span>
        </label>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">阅读分页大小</div>
          <div class="settings-title-description">每页字符数（建议 600-1200）</div>
        </div>
        <div class="vb-inline">
          <input id="${MODULE_NAME}_reader_page" type="range" min="300" max="2000" step="50" value="${
            Number(pluginConfig.readerPageSize) || 900
          }" />
          <span id="${MODULE_NAME}_reader_page_val">${Number(pluginConfig.readerPageSize) || 900}</span>
        </div>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">阅读字体大小</div>
          <div class="settings-title-description">调整阅读区域字体</div>
        </div>
        <div class="vb-inline">
          <input id="${MODULE_NAME}_reader_font" type="range" min="12" max="22" step="1" value="${
            Number(pluginConfig.readerFontSize) || 14
          }" />
          <span id="${MODULE_NAME}_reader_font_val">${Number(pluginConfig.readerFontSize) || 14}</span>
        </div>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">阅读行距</div>
          <div class="settings-title-description">调整阅读舒适度</div>
        </div>
        <div class="vb-inline">
          <input id="${MODULE_NAME}_reader_line" type="range" min="1.2" max="2.0" step="0.1" value="${
            Number(pluginConfig.readerLineHeight) || 1.6
          }" />
          <span id="${MODULE_NAME}_reader_line_val">${Number(pluginConfig.readerLineHeight) || 1.6}</span>
        </div>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">阅读历史注入</div>
          <div class="settings-title-description">生成时将阅读内容发给 AI</div>
        </div>
        <label class="toggle">
          <input id="${MODULE_NAME}_reader_history_enabled" type="checkbox" class="toggle-input" ${
            pluginConfig.readerHistoryEnabled ? 'checked' : ''
          } />
          <span class="toggle-label"></span>
        </label>
        <div class="vb-inline" style="margin-top: 6px;">
          <span>起始页</span>
          <input id="${MODULE_NAME}_reader_history_start" type="number" min="1" placeholder="默认从1" value="${
            pluginConfig.readerHistoryStartPage || ''
          }" />
          <span>当前已读</span>
          <span id="${MODULE_NAME}_reader_history_progress">${Number(pluginConfig.readerMaxPage) || 0}</span>
        </div>
        <div class="vb-note" style="margin-top: 6px;">
          起始页为空/0 时默认从第1页开始，范围到当前已读最大页。
        </div>
      </div>

      <div class="extension-content-item box-container">
        <div class="settings-title">
          <div class="settings-title-text">破限词（系统提示）</div>
          <div class="settings-title-description">放在提示词最前面</div>
        </div>
        <div class="vb-inline">
          <textarea id="${MODULE_NAME}_jailbreak" rows="5" placeholder="在此填写破限词"></textarea>
        </div>
      </div>
    </div>
  `;

  container.appendChild(root);

  const drawerContent = root.querySelector('.inline-drawer-content');
  const drawerIcon = root.querySelector('.inline-drawer-icon');
  if (drawerContent && drawerIcon && pluginConfig.settingsOpen) {
    drawerIcon.classList.remove('down', 'fa-circle-chevron-down');
    drawerIcon.classList.add('up', 'fa-circle-chevron-up');
    drawerContent.style.display = 'block';
  }

  const sourceSelect = root.querySelector(`#${MODULE_NAME}_source`);
  if (sourceSelect) sourceSelect.value = pluginConfig.sourceId;
  const themeSelect = root.querySelector(`#${MODULE_NAME}_theme`);
  if (themeSelect) themeSelect.value = pluginConfig.theme;
  const encodingSelect = root.querySelector(`#${MODULE_NAME}_reader_encoding`);
  if (encodingSelect) encodingSelect.value = pluginConfig.readerEncoding;
  const cssInput = root.querySelector(`#${MODULE_NAME}_custom_css`);
  if (cssInput instanceof HTMLTextAreaElement) cssInput.value = pluginConfig.customCss || '';

  root.addEventListener('input', e => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.id === `${MODULE_NAME}_enable_drill`) {
      pluginConfig.enableDrill = t.checked;
      if (pluginConfig.enableDrill) {
        pluginConfig.enableReader = false;
        setReaderPanelOpen(false);
      } else {
        setPanelOpen(false);
      }
      pluginConfig.enabled = !!(pluginConfig.enableDrill || pluginConfig.enableReader);
      const readerToggle = root.querySelector(`#${MODULE_NAME}_enable_reader`);
      if (readerToggle instanceof HTMLInputElement) {
        readerToggle.checked = pluginConfig.enableReader;
      }
      saveSettings();
      updatePanel();
      return;
    }

    if (t.id === `${MODULE_NAME}_enable_reader`) {
      pluginConfig.enableReader = t.checked;
      if (pluginConfig.enableReader) {
        pluginConfig.enableDrill = false;
        setPanelOpen(false);
      } else {
        setReaderPanelOpen(false);
      }
      pluginConfig.enabled = !!(pluginConfig.enableDrill || pluginConfig.enableReader);
      const drillToggle = root.querySelector(`#${MODULE_NAME}_enable_drill`);
      if (drillToggle instanceof HTMLInputElement) {
        drillToggle.checked = pluginConfig.enableDrill;
      }
      saveSettings();
      updatePanel();
      return;
    }

    if (t.id === `${MODULE_NAME}_auto_open`) {
      pluginConfig.autoOpenOnGeneration = t.checked;
      saveSettings();
      return;
    }

    if (t.id === `${MODULE_NAME}_auto_close`) {
      pluginConfig.autoCloseOnEnd = t.checked;
      saveSettings();
      return;
    }

    if (t.id === `${MODULE_NAME}_source`) {
      pluginConfig.sourceId = t.value;
      saveSettings();
      loadSource({ force: false });
      return;
    }

    if (t.id === `${MODULE_NAME}_custom`) {
      pluginConfig.customUrl = t.value;
      saveSettings();
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_page`) {
      const v = parseInt(t.value, 10);
      pluginConfig.readerPageSize = Number.isFinite(v) ? v : 900;
      const out = document.getElementById(`${MODULE_NAME}_reader_page_val`);
      if (out) out.textContent = String(pluginConfig.readerPageSize);
      paginateReader({ keepPosition: true });
      void saveReaderToStorage();
      saveSettings();
      updatePanel();
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_encoding`) {
      pluginConfig.readerEncoding = t.value;
      saveSettings();
      updatePanel();
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_keep_scroll`) {
      pluginConfig.readerKeepScroll = t.checked;
      saveSettings();
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_font`) {
      const v = parseInt(t.value, 10);
      pluginConfig.readerFontSize = Number.isFinite(v) ? v : 14;
      const out = document.getElementById(`${MODULE_NAME}_reader_font_val`);
      if (out) out.textContent = String(pluginConfig.readerFontSize);
      saveSettings();
      updatePanel();
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_line`) {
      const v = parseFloat(t.value);
      pluginConfig.readerLineHeight = Number.isFinite(v) ? v : 1.6;
      const out = document.getElementById(`${MODULE_NAME}_reader_line_val`);
      if (out) out.textContent = String(pluginConfig.readerLineHeight);
      saveSettings();
      updatePanel();
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_history_enabled`) {
      pluginConfig.readerHistoryEnabled = t.checked;
      saveSettings();
      updatePanel();
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_history_start`) {
      const v = parseInt(t.value, 10);
      pluginConfig.readerHistoryStartPage = Number.isFinite(v) ? Math.max(0, v) : 0;
      saveSettings();
      updatePanel();
      return;
    }

    if (t.id === `${MODULE_NAME}_api_provider`) {
      pluginConfig.apiProvider = t.value;
      if (!pluginConfig.apiEndpoint) {
        const provider = getApiProviderConfig(t.value);
        pluginConfig.apiEndpoint = provider.defaultEndpoint || '';
      }
      state.chat.models = [];
      state.chat.modelsError = '';
      saveSettings();
      updatePanel();
      return;
    }

    if (t.id === `${MODULE_NAME}_api_endpoint`) {
      pluginConfig.apiEndpoint = t.value;
      saveSettings();
      return;
    }

    if (t.id === `${MODULE_NAME}_api_key`) {
      pluginConfig.apiKey = t.value;
      saveSettings();
      return;
    }

    if (t.id === `${MODULE_NAME}_api_model`) {
      pluginConfig.apiModel = t.value;
      saveSettings();
      return;
    }

    if (t.id === `${MODULE_NAME}_api_model_select`) {
      pluginConfig.apiModel = t.value;
      saveSettings();
      updatePanel();
      return;
    }

    if (t.id === `${MODULE_NAME}_api_stream`) {
      pluginConfig.apiStream = t.checked;
      saveSettings();
      return;
    }

    if (t.id === `${MODULE_NAME}_jailbreak`) {
      pluginConfig.jailbreakPrompt = t.value;
      saveSettings();
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_remote_collapse`) {
      pluginConfig.readerRemoteCollapsed = t.checked;
      saveSettings();
      updatePanel();
      return;
    }

    if (t.id === `${MODULE_NAME}_theme`) {
      pluginConfig.theme = t.value;
      saveSettings();
      updatePanel();
      return;
    }

    if (t.id === `${MODULE_NAME}_custom_css`) {
      pluginConfig.customCss = t.value;
      saveSettings();
      applyCustomCss();
      return;
    }

    if (t.id === `${MODULE_NAME}_panel_width`) {
      const v = parseInt(t.value, 10);
      pluginConfig.panelWidth = Number.isFinite(v) ? v : DEFAULT_CONFIG.panelWidth;
      const out = document.getElementById(`${MODULE_NAME}_panel_width_val`);
      if (out) out.textContent = String(pluginConfig.panelWidth);
      saveSettings();
      applyPanelSizing();
      applyFloatingPositions();
      return;
    }

    if (t.id === `${MODULE_NAME}_panel_height`) {
      const v = parseInt(t.value, 10);
      pluginConfig.panelHeight = Number.isFinite(v) ? v : DEFAULT_CONFIG.panelHeight;
      const out = document.getElementById(`${MODULE_NAME}_panel_height_val`);
      if (out) out.textContent = String(pluginConfig.panelHeight);
      saveSettings();
      applyPanelSizing();
      applyFloatingPositions();
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_width`) {
      const v = parseInt(t.value, 10);
      pluginConfig.readerPanelWidth = Number.isFinite(v) ? v : DEFAULT_CONFIG.readerPanelWidth;
      const out = document.getElementById(`${MODULE_NAME}_reader_width_val`);
      if (out) out.textContent = String(pluginConfig.readerPanelWidth);
      saveSettings();
      applyPanelSizing();
      applyFloatingPositions();
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_height`) {
      const v = parseInt(t.value, 10);
      pluginConfig.readerPanelHeight = Number.isFinite(v) ? v : DEFAULT_CONFIG.readerPanelHeight;
      const out = document.getElementById(`${MODULE_NAME}_reader_height_val`);
      if (out) out.textContent = String(pluginConfig.readerPanelHeight);
      saveSettings();
      applyPanelSizing();
      applyFloatingPositions();
      return;
    }
  });

  root.addEventListener('click', e => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.id === `${MODULE_NAME}_reload`) {
      e.preventDefault();
      loadSource({ force: true });
      return;
    }

    if (t.id === `${MODULE_NAME}_open`) {
      e.preventDefault();
      setPanelOpen(true);
      return;
    }

    if (t.id === `${MODULE_NAME}_close`) {
      e.preventDefault();
      setPanelOpen(false);
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_import`) {
      e.preventDefault();
      openReaderFilePicker();
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_clear`) {
      e.preventDefault();
      clearReaderText();
      updatePanel();
      toastr?.success?.('已清空阅读内容。', '背词小窗');
      return;
    }

    if (t.id === `${MODULE_NAME}_api_fetch_models`) {
      e.preventDefault();
      fetchModelList();
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_open`) {
      e.preventDefault();
      setReaderPanelOpen(true);
      return;
    }

    if (t.id === `${MODULE_NAME}_reader_close`) {
      e.preventDefault();
      setReaderPanelOpen(false);
    }
  });

  root.addEventListener('inline-drawer-toggle', () => {
    const content = root.querySelector('.inline-drawer-content');
    if (!content) return;
    setTimeout(() => {
      const isOpen = getComputedStyle(content).display !== 'none';
      pluginConfig.settingsOpen = isOpen;
      saveSettings();
    }, 0);
  });
}

function bindGenerationEvents() {
  const ctx = getContext();
  const ev = ctx.eventTypes;

  ctx.eventSource.on(ev.GENERATION_STARTED, () => {
    if (!pluginConfig.enableDrill) return;
    if (!pluginConfig.autoOpenOnGeneration) return;
    setPanelOpen(true);
  });

  const onEnd = () => {
    if (!pluginConfig.enableDrill) return;
    if (!pluginConfig.autoCloseOnEnd) return;
    if (state.pinned) return;
    setPanelOpen(false);
  };

  ctx.eventSource.on(ev.GENERATION_ENDED, onEnd);
  ctx.eventSource.on(ev.GENERATION_STOPPED, onEnd);
}

function bindDragEvents() {
  document.addEventListener('pointermove', onDrag);
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', () => applyFloatingPositions());
}

function init() {
  initConfig();
  if (pluginConfig.panelOpen) {
    pluginConfig.panelOpen = false;
    saveSettings();
  }
  if (pluginConfig.readerPanelOpen) {
    pluginConfig.readerPanelOpen = false;
    saveSettings();
  }
  void loadReaderFromStorage();
  void loadReaderLibrary();
  ensureReaderFileInput();
  ensureBar();
  ensureReaderBar();
  ensurePanel();
  ensureReaderPanel();
  ensureReaderChatDock();
  bindDragEvents();
  createSettingsInterface();
  bindGenerationEvents();
  const ctx = getContext();
  ctx.eventSource.on(ctx.eventTypes.EXTENSION_SETTINGS_LOADED, () => createSettingsInterface());
  ctx.eventSource.on(ctx.eventTypes.EXTENSIONS_FIRST_LOAD, () => createSettingsInterface());

  const src = getActiveSource();
  state.sourceId = src.id;
  state.sourceUrl = src.url;
  state.sourceLabel = src.label;
  state.sourceLicense = src.license;

  state.remote.sourceId = pluginConfig.readerRemoteSourceId;
  state.remote.selectedUrl = pluginConfig.readerRemoteChapterUrl;
  updatePanel();
}

$(document).ready(() => init());
