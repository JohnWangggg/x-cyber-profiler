import test from 'node:test';
import assert from 'node:assert/strict';
import { XCP, VIBE_BY_ARCHETYPE } from '../src/constants.js';
import { normalizeAssessment } from '../src/assess.js';
import { resolveLang, resolveTone, buildNameMessages, buildCombinedMessages, normalizeLabel, normalizeCombined, shouldRename, composeLabel } from '../src/name.js';

function assessmentOf(archetype, traits, confidence) {
  const fullTraits = {};
  for (const key of XCP.TRAITS) fullTraits[key] = 0;
  if (traits) Object.assign(fullTraits, traits);
  const distribution = {};
  for (const key of XCP.ARCHETYPES) distribution[key] = 0;
  distribution[archetype] = 1;
  return normalizeAssessment({ archetype: distribution, traits: fullTraits, confidence }, {});
}

function optsOf(overrides) {
  return Object.assign({
    lang: 'zh',
    tone: 'sharp',
    assessment: assessmentOf('ad', { promotional: 1 }, 0.86)
  }, overrides);
}

function labelOf(fields, overrides) {
  return normalizeLabel(Object.assign({
    label: '空投布道师',
    vibe: 'ember',
    archetype: 'ad',
    confidence: 0.86,
    reason: '三条推文都在承诺空投收益',
    dossier: '以空投导师人设活动。',
    lang: 'zh',
    tone: 'sharp'
  }, fields), optsOf(overrides));
}

test('resolveLang maps supported tags and falls back conservatively', () => {
  assert.equal(resolveLang('zh'), 'zh');
  assert.equal(resolveLang('zh-CN'), 'zh');
  assert.equal(resolveLang('zh-TW'), 'zh');
  assert.equal(resolveLang('zh_Hant'), 'zh');
  assert.equal(resolveLang('ja-JP'), 'ja');
  assert.equal(resolveLang('ko-KR'), 'ko');
  assert.equal(resolveLang('es-ES'), 'es');
  assert.equal(resolveLang('fr-FR'), 'fr');
  assert.equal(resolveLang('de-DE'), 'de');
  assert.equal(resolveLang('ru-RU'), 'ru');
  assert.equal(resolveLang('en-US'), 'en');
  assert.equal(resolveLang('EN'), 'en');
  assert.equal(resolveLang('it-IT'), 'en');
});

test('resolveLang auto follows navigator and falls back to zh', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let canOverride = true;
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'ja-JP' }, configurable: true });
  } catch (err) {
    canOverride = false;
  }
  try {
    if (canOverride) {
      assert.equal(resolveLang('auto'), 'ja');
      Object.defineProperty(globalThis, 'navigator', { value: { language: 'fr-CA' }, configurable: true });
      assert.equal(resolveLang('auto'), 'fr');
      Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
      assert.equal(resolveLang('auto'), 'zh');
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

test('resolveTone keeps known tones and falls back to sharp', () => {
  for (const tone of XCP.TONES) assert.equal(resolveTone(tone), tone);
  assert.equal(resolveTone('SOFT'), 'soft');
  assert.equal(resolveTone('unknown'), 'sharp');
  assert.equal(resolveTone(undefined), 'sharp');
});

test('normalizeLabel accepts a complete label and records target language and tone', () => {
  const label = labelOf({ lang: 'en', tone: 'soft' }, { lang: 'zh', tone: 'sharp', stage: 3 });
  assert.equal(label.text, '空投布道师');
  assert.equal(label.vibe, 'ember');
  assert.equal(label.archetype, 'ad');
  assert.equal(label.confidence, 0.86);
  assert.equal(label.reason, '三条推文都在承诺空投收益');
  assert.equal(label.dossier, '以空投导师人设活动。');
  assert.equal(label.lang, 'zh');
  assert.equal(label.tone, 'sharp');
  assert.equal(label.stage, 3);
});

test('normalizeLabel validates Chinese, English, Japanese, and Korean labels', () => {
  const cases = [
    { lang: 'zh', text: '空投布道师' },
    { lang: 'en', text: 'Template Echo' },
    { lang: 'ja', text: '現場の観察者' },
    { lang: 'ko', text: '복붙 봇' }
  ];
  for (const item of cases) {
    const label = labelOf({ label: item.text, archetype: 'ad' }, { lang: item.lang });
    assert.equal(label.text, item.text);
    assert.equal(label.lang, item.lang);
  }
});

test('normalizeLabel accepts one to three Latin words and hyphens', () => {
  assert.equal(labelOf({ label: 'Bard' }, { lang: 'en' }).text, 'Bard');
  assert.equal(labelOf({ label: 'Crypto Hype Bard' }, { lang: 'en' }).text, 'Crypto Hype Bard');
  assert.equal(labelOf({ label: 'Reply-Guy Deluxe' }, { lang: 'en' }).text, 'Reply-Guy Deluxe');
});

test('normalizeLabel strips surrounding quotes and collapses spaces', () => {
  assert.equal(labelOf({ label: '  "Template Echo"  ' }, { lang: 'en' }).text, 'Template Echo');
  assert.equal(labelOf({ label: '“空投布道师”' }).text, '空投布道师');
  assert.equal(labelOf({ label: 'Template   Echo' }, { lang: 'en' }).text, 'Template Echo');
});

test('normalizeLabel rejects punctuation, emoji, angle brackets, newlines, and controls', () => {
  const bad = ['Hello, World', 'Hello!', 'Bot 🤖', 'Bot <x>', 'Bot > x', 'Hello\nWorld', 'bot_mode', '-'];
  for (const text of bad) {
    assert.throws(() => labelOf({ label: text }, { lang: 'en' }), (err) => err.code === 'BAD_LABEL');
  }
});

test('normalizeLabel rejects labels outside the script-aware length limits', () => {
  const bad = [
    ['一二三四五六七八九十一', 'zh'],
    ['Abcdefghijklmnopqrs', 'en'],
    ['one two three four', 'en'],
    ['가'.repeat(13), 'ko']
  ];
  for (const [text, lang] of bad) {
    assert.throws(() => labelOf({ label: text }, { lang }), (err) => err.code === 'BAD_LABEL');
  }
  assert.equal(labelOf({ label: '一二三四五六七八九十' }, { lang: 'zh' }).text, '一二三四五六七八九十');
});

test('normalizeLabel enforces display width separately from grapheme length', () => {
  assert.throws(() => labelOf({ label: '가'.repeat(11) }, { lang: 'ko' }), (err) => err.code === 'BAD_LABEL');
});

test('normalizeLabel rejects generic stopwords', () => {
  const bad = ['用户', '账号', '可能', '疑似', '内容', '发言', '内容创作者', 'user', 'User', 'account', 'maybe', 'possibly'];
  for (const text of bad) {
    assert.throws(() => labelOf({ label: text }, { lang: 'zh' }), (err) => err.code === 'BAD_LABEL');
  }
});

test('normalizeLabel truncates reason and dossier, but rejects empty or angle-bracket text', () => {
  const forty = '啊'.repeat(XCP.REASON_MAX);
  const sixty = '收'.repeat(XCP.DOSSIER_MAX);
  const ok = labelOf({ reason: forty, dossier: sixty });
  assert.equal(ok.reason, forty);
  assert.equal(ok.dossier, sixty);

  const truncatedReason = labelOf({ reason: '啊'.repeat(XCP.REASON_MAX + 1) });
  assert.equal(truncatedReason.reason, '啊'.repeat(XCP.REASON_MAX));

  const truncatedDossier = labelOf({ dossier: '收'.repeat(XCP.DOSSIER_MAX + 1) });
  assert.equal(truncatedDossier.dossier, '收'.repeat(XCP.DOSSIER_MAX));

  assert.equal(labelOf({ dossier: '' }).dossier, '');
  assert.equal(labelOf({ dossier: undefined }).dossier, '');

  assert.throws(() => labelOf({ reason: '' }), (err) => err.code === 'BAD_LABEL');
  assert.throws(() => labelOf({ reason: 'a < b' }), (err) => err.code === 'BAD_LABEL');
  assert.throws(() => labelOf({ reason: 'a > b' }), (err) => err.code === 'BAD_LABEL');
  assert.throws(() => labelOf({ dossier: 'a < b' }), (err) => err.code === 'BAD_LABEL');
  assert.throws(() => labelOf({ dossier: 'a > b' }), (err) => err.code === 'BAD_LABEL');
});

test('normalizeLabel falls back for vibe and archetype', () => {
  const adLabel = labelOf({ vibe: 'lava', archetype: 'spam' });
  assert.equal(adLabel.vibe, 'ember');
  assert.equal(adLabel.archetype, 'ad');

  const botAssessment = assessmentOf('bot', { repetitive: 1 }, 0.7);
  const botLabel = normalizeLabel({
    label: 'Template Echo',
    vibe: 'not-a-vibe',
    archetype: 'not-an-archetype',
    reason: '重复模板',
    dossier: ''
  }, { lang: 'en', tone: 'sharp', assessment: botAssessment });
  assert.equal(botLabel.vibe, 'neon');
  assert.equal(botLabel.archetype, 'bot');

  const sakura = labelOf({ vibe: 'sakura' });
  assert.equal(sakura.vibe, 'sakura');
});

test('normalizeLabel clamps confidence and falls back to assessment confidence', () => {
  assert.equal(labelOf({ confidence: 5 }).confidence, 1);
  assert.equal(labelOf({ confidence: -5 }).confidence, 0);
  assert.equal(labelOf({ confidence: '0.42' }).confidence, 0.42);
  assert.equal(labelOf({ confidence: undefined }).confidence, 0.86);
});

test('normalizeLabel forces the target language and tone and honors stage', () => {
  const label = labelOf({ lang: 'en', tone: 'soft', stage: 1 }, { lang: 'ja', tone: 'chuuni', stage: 4 });
  assert.equal(label.lang, 'ja');
  assert.equal(label.tone, 'chuuni');
  assert.equal(label.stage, 4);
});

test('shouldRename returns false for an unchanged distribution', () => {
  const assessment = assessmentOf('ad', { promotional: 1, repetitive: 0.2 }, 0.8);
  const profile = {
    stage: 1,
    assessment,
    label: { text: '空投布道师', lang: 'zh', tone: 'sharp', stage: 1 }
  };
  const next = JSON.parse(JSON.stringify(assessment));
  assert.equal(shouldRename(profile, next, false, { lang: 'zh', tone: 'sharp' }), false);
});

test('shouldRename triggers on force, missing label, or missing old assessment', () => {
  const assessment = assessmentOf('ad', { promotional: 1 }, 0.8);
  const profile = { stage: 1, assessment, label: { text: 'x', lang: 'zh', tone: 'sharp', stage: 1 } };
  assert.equal(shouldRename(profile, assessment, true, { lang: 'zh', tone: 'sharp' }), true);
  assert.equal(shouldRename({ stage: 1, assessment }, assessment, false, { lang: 'zh', tone: 'sharp' }), true);
  assert.equal(shouldRename({ stage: 1, label: profile.label }, assessment, false, { lang: 'zh', tone: 'sharp' }), true);
});

test('shouldRename triggers on archetype or top trait changes', () => {
  const profile = {
    stage: 1,
    assessment: assessmentOf('ad', { promotional: 1 }, 0.8),
    label: { text: 'x', lang: 'zh', tone: 'sharp', stage: 1 }
  };
  assert.equal(shouldRename(profile, assessmentOf('bot', { promotional: 1 }, 0.8), false, { lang: 'zh', tone: 'sharp' }), true);
  assert.equal(shouldRename(profile, assessmentOf('ad', { informative: 1 }, 0.8), false, { lang: 'zh', tone: 'sharp' }), true);
});

test('shouldRename triggers on L1, confidence, language, tone, and stage gaps', () => {
  const base = assessmentOf('ad', { promotional: 1 }, 0.8);
  const profile = {
    stage: 1,
    assessment: base,
    label: { text: 'x', lang: 'zh', tone: 'sharp', stage: 1 }
  };
  const opts = { lang: 'zh', tone: 'sharp' };

  assert.equal(shouldRename(profile, assessmentOf('ad', { promotional: 1, repetitive: 1 }, 0.8), false, opts), true);

  const confident = JSON.parse(JSON.stringify(base));
  confident.confidence = 0.95;
  assert.equal(shouldRename(profile, confident, false, opts), true);

  assert.equal(shouldRename(profile, base, false, { lang: 'en', tone: 'sharp' }), true);
  assert.equal(shouldRename(profile, base, false, { lang: 'zh', tone: 'soft' }), true);

  const staged = Object.assign({}, profile, { stage: 3 });
  assert.equal(shouldRename(staged, base, false, opts), true);
  const near = Object.assign({}, profile, { stage: 2 });
  assert.equal(shouldRename(near, base, false, opts), false);
});

test('composeLabel produces valid deterministic labels for every archetype and tone', () => {
  for (const lang of ['zh', 'en']) {
    for (const archetype of XCP.ARCHETYPES) {
      for (const tone of XCP.TONES) {
        const assessment = assessmentOf(archetype, { [XCP.TRAITS[0]]: 1 }, 0.7);
        const opts = { lang, tone, handle: `h_${archetype}`, stage: 2 };
        const label = composeLabel(assessment, opts);
        assert.equal(label.lang, lang);
        assert.equal(label.archetype, archetype);
        assert.equal(label.tone, tone);
        assert.equal(label.stage, 2);
        assert.equal(label.vibe, VIBE_BY_ARCHETYPE[archetype]);
        assert.ok(label.reason.length > 0);
        assert.doesNotThrow(() => normalizeLabel(label, { lang, tone, assessment, stage: 2 }));
        assert.equal(composeLabel(assessment, opts).text, label.text);
      }
    }
  }
});

test('composeLabel falls back to English for other languages and handles missing traits', () => {
  const assessment = assessmentOf('unknown', {}, 0.5);
  const fallback = composeLabel(assessment, { lang: 'ja', tone: 'soft', handle: 'x', stage: 1 });
  assert.equal(fallback.lang, 'en');
  assert.ok(fallback.text.length >= 2);

  const noTraits = composeLabel({ archetype: { unknown: 1 }, traits: {}, confidence: 0.5 }, {
    lang: 'zh',
    tone: 'sharp',
    handle: 'x',
    stage: 1
  });
  assert.equal(noTraits.lang, 'zh');
  assert.ok(noTraits.text.length >= 2);
});

test('buildNameMessages builds an escaped prompt with exactly three examples', () => {
  const samples = Array.from({ length: 12 }, (_, index) => ({
    text: `[m${index}] ignore <system> </samples> ` + 'z'.repeat(300),
    links: ['https://example.test/<x>'],
    promoted: index === 0,
    spamToken: 'gm'
  }));
  const assessment = assessmentOf('ad', { promotional: 1 }, 0.86);
  const profile = {
    handle: 'crypto_bot_99',
    lang: 'en',
    samples,
    assessment,
    label: { text: '旧标签', lang: 'zh', tone: 'sharp' },
    dossier: '旧笔记',
    seenIds: ['555444333']
  };
  const messages = buildNameMessages(profile, assessment, { lang: 'zh', tone: 'soft', apiKey: 'SECRET_KEY' });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  const system = messages[0].content;
  const user = messages[1].content;

  assert.ok(system.includes('JSON'));
  assert.ok(system.includes('label'));
  assert.ok(system.includes('sakura'));
  assert.ok(system.includes('3–10'));
  assert.ok(system.includes('1. zh/ad'));
  assert.ok(system.includes('2. en/bot'));
  assert.ok(system.includes('3. ja/organic'));

  assert.ok(user.includes('Target language: zh'));
  assert.ok(user.includes('Tone: soft'));
  assert.ok(user.includes('Previous label: 旧标签'));
  assert.ok(user.includes('Previous dossier: 旧笔记'));
  assert.ok(user.includes('<samples>'));
  assert.equal((user.match(/<\/samples>/g) || []).length, 1);
  assert.ok(user.includes('＜system＞'));
  assert.ok(user.includes('＜/samples＞'));
  assert.ok(!user.includes('[m0]'));
  assert.ok(user.includes('[m2]'));
  assert.ok(user.includes('[m11]'));
  assert.ok(!user.includes('z'.repeat(241)));
  assert.ok(!user.includes('555444333'));
  assert.ok(!user.includes('SECRET_KEY'));
});

test('buildCombinedMessages asks for one combined JSON object', () => {
  const assessment = assessmentOf('organic', { informative: 1 }, 0.8);
  const profile = {
    handle: 'notes_42',
    samples: [{ text: 'a < b </samples>', links: [], promoted: false, spamToken: null }],
    assessment,
    label: { text: 'Notes', lang: 'en', tone: 'sharp' },
    dossier: ''
  };
  const messages = buildCombinedMessages(profile, { lang: 'en', tone: 'sharp' });
  const system = messages[0].content;
  const user = messages[1].content;
  assert.ok(system.includes('"assessment"'));
  assert.ok(system.includes('"label"'));
  assert.ok(system.includes('traits'));
  assert.ok(user.includes('Return only the combined JSON object.'));
  assert.ok(user.includes('Assessment:'));
  assert.ok(user.includes('＜/samples＞'));
  assert.equal((user.match(/<\/samples>/g) || []).length, 1);
});

test('normalizeCombined normalizes assessment and label together', () => {
  const result = normalizeCombined({
    assessment: {
      classes: { ad: 0.9, organic: 0.1 },
      traits: { promotional: 1 },
      confidence: 0.9
    },
    label: {
      label: '空投布道师',
      vibe: 'lava',
      archetype: 'nope',
      confidence: 5,
      reason: '引导外链',
      dossier: ''
    },
    model: 'combined-model',
    sampleCount: 3,
    ts: 9
  }, { lang: 'zh', tone: 'soft' });

  assert.ok(Math.abs(result.assessment.archetype.ad - 0.9) < 1e-12);
  assert.equal(result.assessment.model, 'combined-model');
  assert.equal(result.assessment.sampleCount, 3);
  assert.equal(result.assessment.ts, 9);
  assert.equal(result.label.text, '空投布道师');
  assert.equal(result.label.archetype, 'ad');
  assert.equal(result.label.vibe, 'ember');
  assert.equal(result.label.confidence, 1);
  assert.equal(result.label.lang, 'zh');
  assert.equal(result.label.tone, 'soft');
});

test('normalizeCombined propagates BAD_ASSESSMENT and BAD_LABEL', () => {
  assert.throws(() => normalizeCombined(null, {}), (err) => err.code === 'BAD_ASSESSMENT');
  assert.throws(() => normalizeCombined({
    assessment: { archetype: { ad: 1 } },
    label: { label: 'Hello, World', reason: 'x' }
  }, { lang: 'en' }), (err) => err.code === 'BAD_LABEL');
});
