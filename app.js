const PRESETS = {
  kiku: { sentence: 'Sentence', furigana: 'SentenceFurigana', translation: 'SentenceTranslation', audio: 'SentenceAudio' },
  lapis: { sentence: 'Sentence', furigana: 'SentenceFurigana', translation: 'SentenceEnglish', audio: 'SentenceAudio' },
  senren: { sentence: 'Sentence', furigana: 'SentenceFurigana', translation: 'SentenceEnglish', audio: 'SentenceAudio' },
  custom: { sentence: '', furigana: '', translation: '', audio: '' }
};

const DEFAULT_SETTINGS = {
  settingsVersion: 3,
  preset: 'lapis',
  fields: { ...PRESETS.lapis },
  ankiEndpoint: 'http://127.0.0.1:8765',
  jitenEnabled: true,
  jitenEndpoint: 'https://api.jiten.moe/api/user/vocabulary/cards',
  jitenAuthKey: '',
  autoRepeat: true,
  repeatDelay: 1,
  playbackSpeed: 0.9
};
const SETTINGS_KEY = 'listening_practice_settings';
const BLACKLIST_KEY = 'anki_blacklist';
const SNOOZED_SENTENCES_KEY = 'listening_practice_snoozed_sentences';
const JITEN_WORDS_KEY = 'listening_practice_jiten_known_words';
const CARD_BATCH_SIZE = 25;
const CARD_BATCH_THRESHOLD = 5;
const SENTENCE_SNOOZE_DURATION = 10 * 24 * 60 * 60 * 1000;
const DEMO_CARDS = [
  { id: 'demo-1', sentence: '今日はいい天気ですね。', furigana: '<ruby>今日<rt>きょう</rt></ruby>はいい<ruby>天気<rt>てんき</rt></ruby>ですね。', translation: 'The weather is nice today, isn’t it?', audio: '' },
  { id: 'demo-2', sentence: '駅まで歩いて十分かかります。', furigana: '<ruby>駅<rt>えき</rt></ruby>まで<ruby>歩<rt>ある</rt></ruby>いて<ruby>十分<rt>じゅっぷん</rt></ruby>かかります。', translation: 'It takes ten minutes to walk to the station.', audio: '' },
  { id: 'demo-3', sentence: '週末は友達と映画を見ました。', furigana: '<ruby>週末<rt>しゅうまつ</rt></ruby>は<ruby>友達<rt>ともだち</rt></ruby>と<ruby>映画<rt>えいが</rt></ruby>を<ruby>見<rt>み</rt></ruby>ました。', translation: 'I watched a movie with a friend this weekend.', audio: '' }
];

const elements = {
  connectionStatus: document.querySelector('#connectionStatus'),
  connectionLabel: document.querySelector('#connectionLabel'),
  sessionNote: document.querySelector('#sessionNote'),
  cardIndex: document.querySelector('#cardIndex'),
  cardTag: document.querySelector('#cardTag'),
  sourceLabel: document.querySelector('#sourceLabel'),
  audioPlayer: document.querySelector('#audioPlayer'),
  waveform: document.querySelector('#waveform'),
  audioCaption: document.querySelector('#audioCaption'),
  sentenceContent: document.querySelector('#sentenceContent'),
  sentenceText: document.querySelector('#sentenceText'),
  furiganaText: document.querySelector('#furiganaText'),
  translationText: document.querySelector('#translationText'),
  revealHint: document.querySelector('#revealHint'),
  settingsDialog: document.querySelector('#settingsDialog'),
  settingsForm: document.querySelector('#settingsForm'),
  toast: document.querySelector('#toast')
};

let settings = loadSettings();
let currentCard = null;
let cards = [];
let currentIndex = 0;
let isRevealed = false;
let toastTimeout;
let playbackToken = 0;
let repeatTimeout = null;
let playbackMode = 'speech';
let ankiReachable = false;
let ankiCardQueue = [];
let knownWords = null;
let ankiCardsLoading = false;
const mediaCache = new Map();

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return structuredClone(DEFAULT_SETTINGS);
    const jitenEndpoint = saved.jitenEndpoint === 'https://jiten.moe/api'
      ? DEFAULT_SETTINGS.jitenEndpoint
      : saved.jitenEndpoint;
    const isLegacySettings = saved.settingsVersion !== DEFAULT_SETTINGS.settingsVersion;
    const fields = { ...DEFAULT_SETTINGS.fields, ...(saved.fields || {}) };
    if (isLegacySettings && saved.preset === 'kiku') {
      Object.assign(fields, PRESETS.kiku);
    }
    const migratedSettings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      settingsVersion: DEFAULT_SETTINGS.settingsVersion,
      jitenEnabled: isLegacySettings ? true : saved.jitenEnabled ?? DEFAULT_SETTINGS.jitenEnabled,
      jitenEndpoint,
      jitenAuthKey: '',
      fields,
      autoRepeat: saved.autoRepeat ?? DEFAULT_SETTINGS.autoRepeat,
      repeatDelay: boundedNumber(saved.repeatDelay, 0, 5, DEFAULT_SETTINGS.repeatDelay),
      playbackSpeed: boundedNumber(saved.playbackSpeed, 0.6, 1.4, DEFAULT_SETTINGS.playbackSpeed)
    };
    if (saved.jitenAuthKey || isLegacySettings) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(migratedSettings));
      } catch (error) {
        console.error('Could not update saved settings.', error);
      }
    }
    return migratedSettings;
  } catch (error) {
    console.error('Could not read saved settings.', error);
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function getBlacklist() {
  try {
    const items = JSON.parse(localStorage.getItem(BLACKLIST_KEY) || '[]');
    return new Set(Array.isArray(items) ? items.map(String) : []);
  } catch (error) {
    console.error('Could not read the card blacklist.', error);
    return new Set();
  }
}

async function ankiRequest(action, params = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(settings.ankiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AnkiConnect returned HTTP ${response.status}.`);
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    return result.result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`AnkiConnect action "${action}" timed out at ${settings.ankiEndpoint}.`);
    if (error instanceof TypeError) {
      throw new Error(`The browser could not reach ${settings.ankiEndpoint} from ${location.origin}. This usually means AnkiConnect is not listening at that address or the browser blocked the request because of CORS. Browser detail: ${error.message}`);
    }
    throw new Error(`AnkiConnect request failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function setConnection(connected, label = connected ? 'AnkiConnect Connected' : 'Offline Demo') {
  elements.connectionStatus.classList.toggle('connected', connected);
  elements.connectionStatus.classList.toggle('offline', !connected);
  elements.connectionLabel.textContent = label;
}

function getSnoozedSentences() {
  try {
    const entries = JSON.parse(localStorage.getItem(SNOOZED_SENTENCES_KEY) || '[]');
    if (!Array.isArray(entries)) throw new Error('Saved snoozed sentences are not a list.');
    return new Map(entries
      .filter((entry) => entry && typeof entry.sentence === 'string' && Number.isFinite(entry.until))
      .map((entry) => [entry.sentence, entry.until]));
  } catch (error) {
    console.error('Could not read snoozed sentences.', error);
    return new Map();
  }
}

function blacklistHas(card) {
  const blacklist = getBlacklist();
  return blacklist.has(String(card.id)) || blacklist.has(card.sentence.trim());
}

function normalizeCards(cardInfo) {
  const snoozedSentences = getSnoozedSentences();
  const now = Date.now();
  return cardInfo.map((info) => {
    const values = info.fields || {};
    const fieldValue = (fieldName) => fieldName && values[fieldName] ? values[fieldName].value || '' : '';
    const rawSentence = fieldValue(settings.fields.sentence);
    const rawFurigana = fieldValue(settings.fields.furigana);
    return {
      id: String(info.cardId),
      sentence: stripHtml(rawSentence).trim(),
      sentenceMarkup: rawSentence,
      furigana: rawFurigana,
      translation: stripHtml(fieldValue(settings.fields.translation)).trim(),
      audio: fieldValue(settings.fields.audio)
    };
  }).filter((card) => card.sentence
    && !blacklistHas(card)
    && (snoozedSentences.get(card.sentence) || 0) <= now);
}

function stripHtml(value) {
  const template = document.createElement('template');
  template.innerHTML = value;
  return template.content.textContent || '';
}

function normalizeKnownWords(payload) {
  const words = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? payload.words || payload.data || payload.knownWords
      : null;
  if (!Array.isArray(words)) {
    throw new Error('JSON must contain a vocabulary array, such as the words array in Surasura KnownWord.json.');
  }
  return [...new Set(words.map((entry) => {
    if (typeof entry === 'string') return entry.trim();
    if (!entry || typeof entry !== 'object') return null;
    if ('wordText' in entry && (!Number.isFinite(Number(entry.state)) || Number(entry.state) < 5)) return null;
    if ('knownStatus' in entry && entry.knownStatus !== 'KNOWN') return null;
    return String(entry.wordText || entry.dictForm || entry.word || entry.expression || '').trim() || null;
  }).filter(Boolean))];
}

async function fetchJitenWords() {
  if (!settings.jitenEnabled) return null;
  let words;
  try {
    words = JSON.parse(localStorage.getItem(JITEN_WORDS_KEY) || 'null');
  } catch (error) {
    throw jitenError(`Could not read imported Jiten vocabulary: ${error.message}`);
  }
  if (!Array.isArray(words) || words.length === 0) {
    showToast('Import a Jiten KnownWord.json file in Settings to filter by known words.');
    return null;
  }
  return new Set(words);
}

function jitenError(message) {
  const error = new Error(message);
  error.name = 'JitenError';
  return error;
}

function hasOnlyKnownWords(sentence, knownWords) {
  if (!knownWords) return true;
  const runs = sentence.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu) || [];
  if (!runs.length) return false;
  return runs.every((run) => {
    const chars = Array.from(run);
    let offset = 0;
    while (offset < chars.length) {
      let matchedLength = 0;
      for (let end = chars.length; end > offset; end -= 1) {
        if (knownWords.has(chars.slice(offset, end).join(''))) {
          matchedLength = end - offset;
          break;
        }
      }
      if (!matchedLength) return false;
      offset += matchedLength;
    }
    return true;
  });
}

async function loadAnkiCards() {
  if (!settings.fields.sentence) throw new Error('Choose a sentence field in Settings before loading Anki cards.');
  cards = [];
  currentCard = null;
  await ankiRequest('version');
  ankiReachable = true;
  setConnection(true);
  document.querySelector('#connectionHelp').hidden = true;
  elements.sessionNote.textContent = 'Connected. Searching mature Anki cards…';
  const cardIds = await ankiRequest('findCards', { query: 'prop:reps>1 -is:suspended' });
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    ankiCardQueue = [];
    return [];
  }
  const blacklist = getBlacklist();
  ankiCardQueue = shuffle(cardIds.filter((id) => !blacklist.has(String(id))));
  knownWords = await fetchJitenWords();
  await fetchAnkiBatch();
  return cards;
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[otherIndex]] = [shuffled[otherIndex], shuffled[index]];
  }
  return shuffled;
}

async function fetchAnkiBatch(advanceWhenReady = false) {
  if (ankiCardsLoading || ankiCardQueue.length === 0) return;
  ankiCardsLoading = true;
  const targetSize = cards.length + CARD_BATCH_SIZE;
  try {
    while (cards.length < targetSize && ankiCardQueue.length > 0) {
      const count = Math.min(targetSize - cards.length, CARD_BATCH_SIZE, ankiCardQueue.length);
      const batchIds = ankiCardQueue.splice(0, count);
      const cardInfo = await ankiRequest('cardsInfo', { cards: batchIds });
      if (!Array.isArray(cardInfo)) throw new Error('AnkiConnect cardsInfo returned an invalid response.');
      const filteredCards = normalizeCards(cardInfo).filter((card) => hasOnlyKnownWords(card.sentence, knownWords));
      cards.push(...filteredCards);
    }
    const availableCount = cards.length + (currentCard ? 1 : 0);
    elements.sessionNote.textContent = `${availableCount} sentences ready${ankiCardQueue.length ? ` · ${ankiCardQueue.length} more available` : ''}`;
    elements.cardIndex.textContent = `${availableCount} READY`;
    if (advanceWhenReady && !currentCard && cards.length) await showNextCard();
    else if (advanceWhenReady && !currentCard && !cards.length && !ankiCardQueue.length) {
      renderEmptyState('No more eligible sentences are available.');
    }
  } finally {
    ankiCardsLoading = false;
  }
}

function startBackgroundBatch() {
  fetchAnkiBatch(true).catch((error) => {
    elements.sessionNote.textContent = `Could not load more Anki cards: ${error.message}`;
    showToast(`Could not load more Anki cards: ${error.message}`);
    if (!currentCard && !cards.length) renderEmptyState('AnkiConnect could not load more eligible cards.');
  });
}

async function initialize() {
  ankiReachable = false;
  populateSettingsForm();
  try {
    cards = await loadAnkiCards();
    setConnection(true);
    document.querySelector('#connectionHelp').hidden = true;
    elements.sourceLabel.textContent = 'AnkiConnect';
    elements.sessionNote.textContent = cards.length ? `${cards.length} mature card${cards.length === 1 ? '' : 's'} ready` : 'No eligible cards found. Check your Anki query and field mappings.';
    if (cards.length) await showNextCard();
    else renderEmptyState();
  } catch (error) {
    if (error.name === 'JitenError') {
      setConnection(true);
      document.querySelector('#connectionHelp').hidden = true;
      elements.sourceLabel.textContent = 'AnkiConnect';
      elements.sessionNote.textContent = 'Jiten filtering could not be completed.';
      showToast(error.message);
      renderEmptyState(error.message);
      return;
    }
    if (ankiReachable) {
      setConnection(true);
      document.querySelector('#connectionHelp').hidden = true;
      elements.sourceLabel.textContent = 'Demo fallback';
      elements.sessionNote.textContent = `AnkiConnect replied, but cards could not be loaded: ${error.message}`;
      showToast(`AnkiConnect is reachable, but card loading failed: ${error.message}`);
      ankiCardQueue = [];
      const snoozedSentences = getSnoozedSentences();
      cards = DEMO_CARDS.filter((card) => !blacklistHas(card)
        && (snoozedSentences.get(card.sentence) || 0) <= Date.now());
      if (cards.length) await showNextCard();
      else renderEmptyState('No demo sentences remain. Clear the blacklist in browser storage to restart.');
      return;
    }
    setConnection(false, 'AnkiConnect Offline');
    const connectionHelp = document.querySelector('#connectionHelp');
    connectionHelp.textContent = `Could not reach AnkiConnect from ${location.origin}. In AnkiConnect's add-on config, allow this exact origin in webCorsOriginList (or use ["*"] for testing), then restart Anki. "localhost" and "127.0.0.1" are different origins; check the endpoint host and port too. Details: ${error.message}`;
    connectionHelp.hidden = false;
    elements.sourceLabel.textContent = 'Offline demo';
    elements.sessionNote.textContent = 'AnkiConnect unavailable — using sample sentences';
    showToast(`${error.message} Check the endpoint and AnkiConnect CORS settings.`);
    ankiCardQueue = [];
    const snoozedSentences = getSnoozedSentences();
    cards = DEMO_CARDS.filter((card) => !blacklistHas(card)
      && (snoozedSentences.get(card.sentence) || 0) <= Date.now());
    if (cards.length) await showNextCard();
    else renderEmptyState('No demo sentences remain. Clear the blacklist in browser storage to restart.');
  }
}

function renderEmptyState(message = 'No sentences available. Update your settings or clear your blacklist.') {
  playbackToken += 1;
  clearTimeout(repeatTimeout);
  repeatTimeout = null;
  elements.audioPlayer.pause();
  window.speechSynthesis?.cancel();
  currentCard = null;
  elements.cardIndex.textContent = 'COMPLETE';
  elements.cardTag.textContent = 'SESSION COMPLETE';
  elements.sentenceText.textContent = 'Session complete';
  elements.furiganaText.textContent = '';
  elements.translationText.textContent = message;
  setRevealed(true);
  elements.audioCaption.textContent = 'Your session is complete';
  elements.sessionNote.textContent = message;
}

async function showNextCard() {
  currentCard = null;
  if (!cards.length) {
    if (ankiCardQueue.length || ankiCardsLoading) {
      elements.sessionNote.textContent = 'Loading more sentences…';
      if (!ankiCardsLoading) startBackgroundBatch();
      return;
    }
    return renderEmptyState();
  }
  currentIndex = Math.floor(Math.random() * cards.length);
  currentCard = cards.splice(currentIndex, 1)[0];
  isRevealed = false;
  elements.cardIndex.textContent = `${cards.length + 1} READY`;
  elements.cardTag.textContent = knownWords && settings.jitenEnabled && elements.sourceLabel.textContent === 'AnkiConnect' ? 'KNOWN WORDS' : 'AUDIO PRACTICE';
  const furiganaSource = currentCard.furigana || '';
  const sentenceMarkup = currentCard.sentenceMarkup || '';
  const displaySource = hasFuriganaMarkup(furiganaSource)
    ? furiganaSource
    : hasFuriganaMarkup(sentenceMarkup)
      ? sentenceMarkup
      : furiganaSource || sentenceMarkup || currentCard.sentence;
  elements.sentenceText.innerHTML = sanitizeFurigana(displaySource);
  elements.furiganaText.textContent = '';
  elements.translationText.textContent = currentCard.translation;
  elements.sessionNote.textContent = `${cards.length + 1} sentences ready${ankiCardQueue.length ? ` · ${ankiCardQueue.length} more available` : ''}`;
  setRevealed(false);
  if (elements.sourceLabel.textContent === 'AnkiConnect'
    && cards.length + 1 <= CARD_BATCH_THRESHOLD
    && ankiCardQueue.length) {
    startBackgroundBatch();
  }
  await playCurrentAudio();
}

function hasFuriganaMarkup(value) {
  return /<ruby\b|\p{Script=Han}[^[]*\[[^\]]+\]/iu.test(value);
}

function sanitizeFurigana(value) {
  const template = document.createElement('template');
  template.innerHTML = value;
  template.content.querySelectorAll('*').forEach((node) => {
    if (!['RUBY', 'RT', 'RP'].includes(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }
    [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));
  });
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement?.closest('ruby, rt, rp')) textNodes.push(walker.currentNode);
  }
  textNodes.forEach((textNode) => {
    const source = textNode.textContent || '';
    const pattern = /([\p{Script=Han}々〆ヵヶ]+)\[([^\[\]]+)\]/gu;
    const matches = [...source.matchAll(pattern)];
    if (!matches.length) return;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    matches.forEach((match) => {
      fragment.append(document.createTextNode(source.slice(offset, match.index)));
      const ruby = document.createElement('ruby');
      ruby.append(document.createTextNode(match[1]));
      const reading = document.createElement('rt');
      reading.textContent = match[2];
      ruby.append(reading);
      fragment.append(ruby);
      offset = match.index + match[0].length;
    });
    fragment.append(document.createTextNode(source.slice(offset)));
    textNode.replaceWith(fragment);
  });
  return template.innerHTML;
}

function setRevealed(revealed) {
  isRevealed = revealed;
  elements.sentenceContent.classList.toggle('is-hidden', !revealed);
  elements.sentenceContent.setAttribute('aria-hidden', String(!revealed));
  elements.revealHint.hidden = revealed;
  document.querySelector('#toggleTextButton').textContent = revealed ? '🙈 Hide text' : '👁️ Show text';
}

function extractSound(value) {
  const match = value.match(/\[sound:([^\]]+)\]/i);
  return match ? match[1].trim() : '';
}

async function playCurrentAudio() {
  if (!currentCard) return;
  const card = currentCard;
  const token = ++playbackToken;
  clearTimeout(repeatTimeout);
  repeatTimeout = null;
  elements.audioPlayer.pause();
  if (elements.audioPlayer.src) elements.audioPlayer.currentTime = 0;
  window.speechSynthesis?.cancel();
  elements.waveform.classList.remove('is-playing');
  const sound = extractSound(card.audio || '');
  if (sound) {
    try {
      let audioData = mediaCache.get(sound);
      if (!audioData) {
        const encoded = await ankiRequest('retrieveMediaFile', { filename: sound });
        if (typeof encoded !== 'string' || !encoded) throw new Error(`AnkiConnect returned no audio data for ${sound}.`);
        audioData = `data:${audioMimeType(sound)};base64,${encoded}`;
        mediaCache.set(sound, audioData);
      }
      if (token !== playbackToken) return;
      elements.audioPlayer.src = audioData;
      elements.audioPlayer.playbackRate = settings.playbackSpeed;
      playbackMode = 'media';
      await elements.audioPlayer.play();
      elements.audioCaption.textContent = 'Playing card audio';
      return;
    } catch (error) {
      if (token !== playbackToken) return;
      console.warn('Card audio unavailable; using speech synthesis.', error);
      showToast('Card audio unavailable. Using Japanese speech synthesis.');
    }
  } else if (/^(https?:\/\/|data:audio\/)/i.test(card.audio || '')) {
    try {
      elements.audioPlayer.src = card.audio.trim();
      elements.audioPlayer.playbackRate = settings.playbackSpeed;
      playbackMode = 'media';
      await elements.audioPlayer.play();
      elements.audioCaption.textContent = 'Playing card audio';
      return;
    } catch (error) {
      if (token !== playbackToken) return;
      console.warn('Direct card audio could not be played; using speech synthesis.', error);
    }
  }
  speakSentence(token);
}

function audioMimeType(filename) {
  const extension = filename.split('.').pop().toLowerCase();
  return ({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4', opus: 'audio/ogg' })[extension] || 'audio/mpeg';
}

function speakSentence(token) {
  if (!('speechSynthesis' in window)) {
    elements.audioCaption.textContent = 'Audio unavailable in this browser';
    showToast('No card audio found and speech synthesis is not supported by this browser.');
    return;
  }
  playbackMode = 'speech';
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(currentCard.sentence);
  utterance.lang = 'ja-JP';
  utterance.rate = settings.playbackSpeed;
  utterance.onstart = () => {
    if (token !== playbackToken) return;
    elements.audioCaption.textContent = 'Speaking Japanese';
    elements.waveform.classList.add('is-playing');
  };
  utterance.onend = () => {
    if (token !== playbackToken) return;
    elements.audioCaption.textContent = 'Listen carefully';
    elements.waveform.classList.remove('is-playing');
    scheduleRepeat(token);
  };
  utterance.onerror = () => {
    if (token !== playbackToken) return;
    elements.audioCaption.textContent = 'Speech playback failed';
    elements.waveform.classList.remove('is-playing');
  };
  window.speechSynthesis.speak(utterance);
}

function scheduleRepeat(token) {
  clearTimeout(repeatTimeout);
  repeatTimeout = null;
  if (!settings.autoRepeat || token !== playbackToken) return;
  repeatTimeout = setTimeout(() => {
    repeatTimeout = null;
    if (token !== playbackToken || !currentCard) return;
    if (playbackMode === 'media' && elements.audioPlayer.src) {
      elements.audioPlayer.currentTime = 0;
      elements.audioPlayer.playbackRate = settings.playbackSpeed;
      elements.audioPlayer.play().catch((error) => {
        if (token !== playbackToken) return;
        console.warn('Audio replay failed; using speech synthesis.', error);
        speakSentence(token);
      });
    } else {
      speakSentence(token);
    }
  }, settings.repeatDelay * 1000);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => elements.toast.classList.remove('is-visible'), 4200);
}

function populateSettingsForm() {
  document.querySelector('#presetSelect').value = settings.preset;
  document.querySelector('#sentenceField').value = settings.fields.sentence;
  document.querySelector('#furiganaField').value = settings.fields.furigana;
  document.querySelector('#translationField').value = settings.fields.translation;
  document.querySelector('#audioField').value = settings.fields.audio;
  document.querySelector('#ankiEndpoint').value = settings.ankiEndpoint;
  document.querySelector('#jitenEnabled').checked = settings.jitenEnabled;
  document.querySelector('#jitenFile').value = '';
  updateJitenImportStatus();
  document.querySelector('#autoRepeat').checked = settings.autoRepeat;
  document.querySelector('#repeatDelay').value = settings.repeatDelay;
  document.querySelector('#playbackSpeed').value = settings.playbackSpeed;
  updatePlaybackLabels();
}

function updateJitenImportStatus() {
  const status = document.querySelector('#jitenImportStatus');
  const clearButton = document.querySelector('#clearJitenButton');
  let importedWords = [];
  try {
    const stored = JSON.parse(localStorage.getItem(JITEN_WORDS_KEY) || '[]');
    if (Array.isArray(stored)) importedWords = stored;
  } catch (error) {
    console.error('Could not read imported Jiten vocabulary status.', error);
  }
  status.textContent = importedWords.length
    ? `${importedWords.length.toLocaleString()} known words imported.`
    : 'No Jiten vocabulary imported.';
  clearButton.hidden = importedWords.length === 0;
}

async function importJitenFile(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const words = normalizeKnownWords(payload);
    if (!words.length) throw new Error('No known words found. Surasura exports should include entries marked KNOWN.');
    localStorage.setItem(JITEN_WORDS_KEY, JSON.stringify(words));
    updateJitenImportStatus();
    settings.jitenEnabled = true;
    document.querySelector('#jitenEnabled').checked = true;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    showToast(`Imported ${words.length.toLocaleString()} known Jiten words. Reloading cards.`);
    elements.settingsDialog.close();
    await initialize();
  } catch (error) {
    showToast(`Could not import Jiten vocabulary: ${error.message}`);
  } finally {
    document.querySelector('#jitenFile').value = '';
  }
}

function updatePlaybackLabels() {
  document.querySelector('#repeatDelayValue').textContent = `${Number(settings.repeatDelay)} s`;
  document.querySelector('#playbackSpeedValue').textContent = `${Number(settings.playbackSpeed).toFixed(2).replace(/0$/, '')}×`;
}

function savePlaybackSettings() {
  settings.autoRepeat = document.querySelector('#autoRepeat').checked;
  settings.repeatDelay = boundedNumber(document.querySelector('#repeatDelay').value, 0, 5, DEFAULT_SETTINGS.repeatDelay);
  settings.playbackSpeed = boundedNumber(document.querySelector('#playbackSpeed').value, 0.6, 1.4, DEFAULT_SETTINGS.playbackSpeed);
  updatePlaybackLabels();
  if (elements.audioPlayer.src) elements.audioPlayer.playbackRate = settings.playbackSpeed;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    showToast(`Could not save playback settings: ${error.message}`);
  }
  if (!settings.autoRepeat) {
    clearTimeout(repeatTimeout);
    repeatTimeout = null;
  } else if (repeatTimeout !== null) {
    scheduleRepeat(playbackToken);
  }
}

function saveSettings(event) {
  event.preventDefault();
  const form = new FormData(elements.settingsForm);
  settings = {
    ...settings,
    preset: String(form.get('preset')),
    fields: {
      sentence: String(form.get('sentenceField') || '').trim(),
      furigana: String(form.get('furiganaField') || '').trim(),
      translation: String(form.get('translationField') || '').trim(),
      audio: String(form.get('audioField') || '').trim()
    },
    ankiEndpoint: String(form.get('ankiEndpoint') || '').trim().replace(/\/$/, ''),
    jitenEnabled: form.has('jitenEnabled'),
    jitenEndpoint: settings.jitenEndpoint,
    jitenAuthKey: ''
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    showToast(`Could not save settings: ${error.message}`);
    return;
  }
  elements.settingsDialog.close();
  initialize();
}

document.querySelector('#presetSelect').addEventListener('change', (event) => {
  const fields = PRESETS[event.target.value];
  Object.entries(fields).forEach(([key, value]) => {
    const inputId = { sentence: 'sentenceField', furigana: 'furiganaField', translation: 'translationField', audio: 'audioField' }[key];
    document.querySelector(`#${inputId}`).value = value;
  });
});
document.querySelector('#settingsButton').addEventListener('click', () => elements.settingsDialog.showModal());
document.querySelector('#closeSettingsButton').addEventListener('click', () => elements.settingsDialog.close());
document.querySelector('#cancelSettingsButton').addEventListener('click', () => elements.settingsDialog.close());
elements.settingsForm.addEventListener('submit', saveSettings);
document.querySelector('#jitenFile').addEventListener('change', (event) => importJitenFile(event.target.files[0]));
document.querySelector('#clearJitenButton').addEventListener('click', async () => {
  try {
    localStorage.removeItem(JITEN_WORDS_KEY);
    updateJitenImportStatus();
    knownWords = null;
    showToast('Imported Jiten vocabulary removed.');
    elements.settingsDialog.close();
    await initialize();
  } catch (error) {
    showToast(`Could not remove imported Jiten vocabulary: ${error.message}`);
  }
});
document.querySelector('#toggleTextButton').addEventListener('click', () => setRevealed(!isRevealed));
document.querySelector('#replayButton').addEventListener('click', () => playCurrentAudio());
document.querySelector('#skipButton').addEventListener('click', () => showNextCard());
document.querySelector('#understoodButton').addEventListener('click', () => {
  if (!currentCard) return;
  const snoozedSentences = getSnoozedSentences();
  const sentence = currentCard.sentence.trim();
  snoozedSentences.set(sentence, Date.now() + SENTENCE_SNOOZE_DURATION);
  const now = Date.now();
  try {
    localStorage.setItem(SNOOZED_SENTENCES_KEY, JSON.stringify(
      [...snoozedSentences]
        .filter(([, until]) => until > now)
        .map(([savedSentence, until]) => ({ sentence: savedSentence, until }))
    ));
  } catch (error) {
    showToast(`Could not snooze this sentence: ${error.message}`);
    return;
  }
  cards = cards.filter((card) => card.sentence.trim() !== sentence);
  showToast('Sentence snoozed for 10 days.');
  showNextCard();
});
document.querySelector('#blacklistButton').addEventListener('click', () => {
  if (!currentCard) return;
  const blacklist = getBlacklist();
  blacklist.add(String(currentCard.id));
  blacklist.add(currentCard.sentence.trim());
  try {
    localStorage.setItem(BLACKLIST_KEY, JSON.stringify([...blacklist]));
  } catch (error) {
    showToast(`Could not save the blacklist: ${error.message}`);
    return;
  }
  cards = cards.filter((card) => card.id !== currentCard.id && card.sentence !== currentCard.sentence);
  showNextCard();
});
elements.audioPlayer.addEventListener('play', () => elements.waveform.classList.add('is-playing'));
elements.audioPlayer.addEventListener('ended', () => elements.waveform.classList.remove('is-playing'));
elements.audioPlayer.addEventListener('ended', () => scheduleRepeat(playbackToken));
elements.audioPlayer.addEventListener('pause', () => elements.waveform.classList.remove('is-playing'));
document.querySelector('#autoRepeat').addEventListener('change', savePlaybackSettings);
document.querySelector('#repeatDelay').addEventListener('input', savePlaybackSettings);
document.querySelector('#playbackSpeed').addEventListener('input', savePlaybackSettings);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Offline app shell could not be registered.', error));
}

initialize();
