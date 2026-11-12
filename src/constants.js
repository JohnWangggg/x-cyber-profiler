export const XCP = Object.freeze({
  VERSION: '1.0.5',
  PROFILE_VERSION: 3,
  EXPORT_VERSION: 2,

  DWELL_MS: 500,
  DWELL_MIN: 300,
  DWELL_MAX: 2000,
  VIS_RATIO: 0.5,
  SCAN_DEBOUNCE_MS: 120,
  ROOT_CHECK_MS: 1000,
  SWEEP_MS: 2000,
  TEXT_HARD_CAP: 2000,

  SAMPLE_CAP: 10,
  SEEN_CAP: 80,
  TEXT_CAP: 240,
  LINK_CAP: 3,
  CARD_TEXT_CAP: 120,
  DISPLAY_NAME_CAP: 80,
  SHORT_MIN: 5,
  SHORT_KEY_CAP: 20,
  SPAM_REPEAT: 3,
  SPAM_CHAR_WEIGHT: 15,
  SPAM_SAMPLE_CAP: 4,

  STAGES: [1, 3, 6, 10, 16, 24, 36, 50],
  STAGE_COOLDOWN_MS: [0, 600000, 1800000, 3600000, 10800000, 21600000, 43200000, 86400000],
  STABLE_COOLDOWN_MS: 604800000,
  STABLE_CONFIDENCE: 0.9,
  STABLE_MIN_STAGE: 4,
  STABLE_NEW_SAMPLES: 10,
  MAX_STAGE_DISPLAY: 9,
  RENAME_L1_DELTA: 0.12,
  RENAME_CONF_DELTA: 0.1,

  ARCHETYPES: ['bot', 'ad', 'toxic', 'organic', 'unknown'],
  TRAITS: ['promotional', 'repetitive', 'hostile', 'informative', 'personal', 'ironic', 'expert', 'spammy'],
  VIBES: ['neon', 'ember', 'venom', 'aurora', 'frost', 'sakura'],
  LANGS: ['auto', 'zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'ru'],
  TONES: ['sharp', 'soft', 'abstract', 'chuuni', 'academic'],

  LABEL_MIN_GRAPHEMES: 2,
  LABEL_MAX_GRAPHEMES: 18,
  LABEL_MAX_WIDTH: 20,
  CJK_MIN: 3,
  CJK_MAX: 10,
  HANGUL_MIN: 2,
  HANGUL_MAX: 12,
  LATIN_MAX_WORDS: 3,
  LATIN_MAX_CHARS: 18,
  REASON_MAX: 40,
  DOSSIER_MAX: 160,
  HISTORY_CAP: 5,
  ASSESS_MAX_TOKENS: 300,
  NAME_MAX_TOKENS: 1500,
  TEMPERATURE: 0.7,

  MAX_CONCURRENT: 2,
  REFILL_MS: 600,
  QUEUE_CAP: 48,
  AUTO_QUEUE_MAX: 24,
  REQUEST_TIMEOUT_MS: 25000,
  RETRY_BACKOFF_MS: [2000, 8000],
  RETRY_AFTER_MAX_MS: 30000,
  RESPONSE_MAX_BYTES: 51200,
  DAILY_BUDGET: 400,
  MANUAL_BUDGET_EXTRA: 30,
  GLOBAL_FAIL_MAX: 5,
  GLOBAL_PAUSE_MS: 600000,

  PERSIST_DEBOUNCE_MS: 300,
  MEM_PROFILE_CAP: 300,
  PROFILE_SOFT_LIMIT: 600,
  PROFILE_HARD_LIMIT: 900,
  BYTES_SOFT_LIMIT: 5 * 1024 * 1024,
  BYTES_HARD_LIMIT: 7 * 1024 * 1024,

  DOUBLE_CLICK_GUARD_MS: 800,
  TOAST_MS: 2400,
  BADGE_COMPACT_PX: 400,
  CARD_WIDTH: 316,

  KEY_SETTINGS: 'xcp:settings',
  KEY_INDEX: 'xcp:index',
  KEY_USAGE: 'xcp:usage',
  KEY_EPOCH: 'xcp:epoch',
  KEY_STATS: 'xcp:stats',
  KEY_INSTALLED: 'xcp:installed',
  KEY_LEGACY: 'xcp:legacy',

  DEFAULT_API_URL: 'https://api.deepseek.com/v1/chat/completions',
  DEFAULT_MODEL: 'deepseek-chat',
  DEFAULT_JEV_URL: 'https://api.typesafe.ai/v1',
  DEFAULT_JEV_MODEL: 'jev-latest',
  DEFAULT_JEV_SCHEMA: 'xcp.profile.v1',
  MAGPIE_BASE_URL: 'http://127.0.0.1:3425/v1',
  MAGPIE_URL: 'http://127.0.0.1:3425/v1/chat/completions',
  MAGPIE_MODEL: 'auto/glm-5.3-flash',
  MAGPIE_JEV_MODEL: 'jev-latest',

  HANDLE_RE: /^[a-z0-9_]{1,15}$/,
  STATUS_RE: /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,20})(?:\/|$)/,
  URL_RE: /https?:\/\/\S+/gi,
  MENTION_RE: /@[A-Za-z0-9_]{1,15}/g,
  EMOJI_RE: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu,
  ZERO_WIDTH_RE: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g,
  CONTROL_RE: /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
});

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  evalProvider: 'jev',
  jevUrl: XCP.MAGPIE_BASE_URL,
  jevKey: '',
  jevModel: XCP.DEFAULT_JEV_MODEL,
  jevSchema: XCP.DEFAULT_JEV_SCHEMA,
  namerProvider: 'openai',
  namerUrl: XCP.MAGPIE_URL,
  namerKey: '',
  namerModel: XCP.MAGPIE_MODEL,
  labelLang: 'auto',
  tone: 'sharp',
  temperature: XCP.TEMPERATURE,
  autoLabelAll: true,
  dailyBudget: XCP.DAILY_BUDGET,
  dwellMs: XCP.DWELL_MS,
  jsonMode: true
});

export const THEME = Object.freeze({
  neon: 'xcp-vibe-neon',
  ember: 'xcp-vibe-ember',
  venom: 'xcp-vibe-venom',
  aurora: 'xcp-vibe-aurora',
  frost: 'xcp-vibe-frost',
  sakura: 'xcp-vibe-sakura'
});

export const VIBE_BY_ARCHETYPE = Object.freeze({
  bot: 'neon',
  ad: 'ember',
  toxic: 'venom',
  organic: 'aurora',
  unknown: 'frost'
});

export const EVIDENCE = Object.freeze([
  'external_link', 'tg_link', 'profit_promise', 'template_phrase',
  'generic_praise', 'insult', 'technical_detail', 'personal_story',
  'news_link', 'repeated_token', 'promoted'
]);

export function profileKey(handle) {
  return 'xcp:p:' + handle;
}
