const EXPECTED = {
  'constants.js': ['XCP', 'DEFAULT_SETTINGS', 'THEME', 'VIBE_BY_ARCHETYPE', 'EVIDENCE', 'profileKey'],
  'selectors.js': ['SEL'],
  'storage.js': ['createStorage'],
  'sample.js': ['classifyText', 'ingestSample', 'effectiveChars', 'targetStage', 'cooldownFor', 'shouldAssess', 'trimShortHits'],
  'assess.js': ['argmax', 'topTrait', 'l1', 'sameArchetype', 'sameTopTrait', 'normalizeAssessment', 'assessmentDelta', 'buildAssessMessages', 'buildJevPayload'],
  'name.js': ['resolveLang', 'resolveTone', 'buildNameMessages', 'buildCombinedMessages', 'normalizeLabel', 'normalizeCombined', 'shouldRename', 'composeLabel'],
  'queue.js': ['createQueue'],
  'providers.js': ['PROVIDERS', 'effectiveMode', 'normalizeEndpoint', 'buildRequest', 'parseResponse', 'isRetryableStatus'],
  'llm.js': ['createLLM', 'parseModelJson', 'LLMError'],
  'extract.js': ['extractTweet', 'extractText', 'isOuterTweet', 'findUserName', 'ownHandle', 'fastIdentity'],
  'observe.js': ['createWatcher'],
  'render.js': ['injectStyles', 'renderBadges', 'renderAllForHandle', 'removeBadges', 'removeAllBadges', 'bindRepair', 'initInteractions', 'showCard', 'hideCard', 'setLightMode'],
  'menu.js': ['registerMenu', 'showToast', 'openSettings'],
  'boot.js': ['start', 'stop']
};

let failed = 0;
for (const [file, names] of Object.entries(EXPECTED)) {
  try {
    const mod = await import(new URL('../src/' + file, import.meta.url));
    const missing = names.filter((n) => mod[n] == null);
    if (missing.length) {
      failed++;
      console.error(`[exports] ${file}: missing ${missing.join(', ')}`);
    } else {
      console.log(`[exports] ${file}: ok`);
    }
  } catch (err) {
    failed++;
    console.error(`[exports] ${file}: import failed: ${err.message}`);
  }
}
if (failed) process.exit(1);
console.log('[exports] all modules satisfy §2.4');
