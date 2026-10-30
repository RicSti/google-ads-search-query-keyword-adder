// Minimal test runner with mocked Google Ads globals: `node test/run-tests.js`
// Writes the generated e-mail to test/output/mail.html for a visual check.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// --- Mocks -----------------------------------------------------------------

const state = { added: [], paused: [], mails: [], queries: [] };

function iterator(items) {
  let i = 0;
  return { hasNext: () => i < items.length, next: () => items[i++], totalNumEntities: () => items.length };
}

// Ad groups: id -> [name, campaign, type, impressions, clicks]
const adGroupData = {
  11: ['Shoes', 'Search Shoes', 'SEARCH_STANDARD', 10000, 500], // CTR 5 %
  22: ['Boots', 'Search Shoes', 'SEARCH_STANDARD', 2000, 100],  // CTR 5 %
  33: ['DSA', 'Search DSA', 'SEARCH_DYNAMIC_ADS', 5000, 250]
};

// [term, adGroupId, impressions, clicks, costEur, conversions, status]
const searchTermRows = [
  ['running shoes', 11, 1000, 80, 40, 3, 'NONE'],    // -> added to "Shoes"
  ['running shoes', 22, 100, 10, 5, 0, 'NONE'],      //    (fewer clicks in "Boots")
  ['free shoes', 11, 500, 50, 20, 0, 'NONE'],        // negative pattern
  ['weather', 11, 600, 60, 30, 0, 'NONE'],           // not positive
  ['trail shoes', 11, 200, 4, 2, 0, 'NONE'],         // min clicks
  ['leather boots shoe', 22, 300, 9, 4, 0, 'NONE'],  // CTR factor 0.6
  ['männer sneaker', 11, 400, 30, 12, 1, 'NONE'],    // transliteration -> added
  ['shoe store', 11, 300, 30, 10, 0, 'NONE'],        // keyword exists
  ['shoe shop', 11, 300, 30, 10, 0, 'NONE'],         // keyword removed before
  ['cheap shoes', 11, 300, 30, 10, 0, 'EXCLUDED'],   // excluded by negative
  ['shoes? best', 11, 300, 30, 10, 0, 'NONE'],       // invalid character
  ['dsa shoes', 33, 500, 50, 20, 0, 'NONE'],         // only in DSA ad group
  ['bad shoes', 11, 300, 30, 10, 0, 'NONE'],         // rejected by API mock
  ['shoe sale', 22, 200, 20, 8, 0, 'NONE']           // -> added to "Boots"
];

function makeAdGroup(id) {
  return {
    getId: () => id,
    getName: () => adGroupData[id][0],
    newKeywordBuilder: () => {
      let text = '';
      const builder = {
        withText: t => { text = t; return builder; },
        build: () => ({
          isSuccessful: () => !text.includes('bad'),
          getErrors: () => ['POLICY_VIOLATION'],
          getResult: () => ({ pause: () => state.paused.push(text) })
        })
      };
      const origBuild = builder.build;
      builder.build = () => {
        const op = origBuild();
        if (op.isSuccessful()) {
          state.added.push({ adGroup: adGroupData[id][0], keyword: text });
        }
        return op;
      };
      return builder;
    }
  };
}

global.AdsApp = {
  currentAccount: () => ({
    getName: () => 'Demo Account', getCustomerId: () => '123-456-7890',
    getCurrencyCode: () => 'EUR', getTimeZone: () => 'Europe/Berlin'
  }),
  search: query => {
    state.queries.push(query);

    if (query.includes('FROM ad_group_criterion')) {
      return iterator([
        { text: 'Shoe Store', matchType: 'EXACT', status: 'ENABLED' },
        { text: 'shoe shop', matchType: 'EXACT', status: 'REMOVED' },
        { text: 'running shoes', matchType: 'PHRASE', status: 'ENABLED' } // other match type -> no conflict
      ].map(k => ({ adGroupCriterion: { keyword: { text: k.text, matchType: k.matchType }, status: k.status } })));
    }

    assert.ok(query.includes('campaign.name LIKE "%Search%"'), 'campaign filter in query');
    assert.ok(query.includes("campaign.advertising_channel_type = 'SEARCH'"), 'search campaigns only');

    if (query.includes('FROM search_term_view')) {
      return iterator(searchTermRows.map(r => ({
        searchTermView: { searchTerm: r[0], status: r[6] },
        campaign: { name: adGroupData[r[1]][1] },
        adGroup: { id: String(r[1]), name: adGroupData[r[1]][0], type: adGroupData[r[1]][2] },
        metrics: { impressions: String(r[2]), clicks: String(r[3]), costMicros: String(r[4] * 1e6), conversions: r[5] }
      })));
    }

    if (query.includes('FROM ad_group ')) {
      return iterator(Object.keys(adGroupData).map(id => ({
        adGroup: { id: id }, metrics: { impressions: String(adGroupData[id][3]), clicks: String(adGroupData[id][4]) }
      })));
    }

    throw new Error(`Unexpected query: ${query}`);
  },
  adGroups: () => {
    let ids = [];
    const sel = { withIds: x => { ids = x; return sel; }, get: () => iterator(ids.filter(id => adGroupData[id]).map(makeAdGroup)) };
    return sel;
  }
};
global.Utilities = { formatDate: (d) => d.toISOString().slice(0, 16).replace('T', ' ') };
global.MailApp = { sendEmail: o => state.mails.push(o) };
global.SpreadsheetApp = {};

// Load the script with test settings (live mode, mail enabled)
function loadScript(replacements) {
  let src = fs.readFileSync(path.join(__dirname, '..', 'search-query-keyword-adder.js'), 'utf8');
  replacements.forEach(([from, to]) => {
    assert.ok(src.includes(from), `replacement target not found: ${from}`);
    src = src.replace(from, to);
  });
  const mod = { exports: {} };
  new Function('module', 'console', src)(mod, { log() {}, warn() {}, error: console.error });
  return mod.exports;
}

const kwa = loadScript([
  ['const DRY_RUN = true;', 'const DRY_RUN = false;'],
  ["const NOTIFY_EMAILS = ['you@example.com'];", "const NOTIFY_EMAILS = ['test@test.de'];"],
  ["positivePattern: '(shoe|sneaker|boot)s?'", "positivePattern: 'shoe|schuh|maenner'"]
]);

// --- Unit tests ------------------------------------------------------------

assert.strictEqual(kwa.keywordText('foo bar', 'exact'), '[foo bar]');
assert.strictEqual(kwa.keywordText('foo bar', 'phrase'), '"foo bar"');
assert.strictEqual(kwa.invalidKeywordReason('price? cheap'), 'contains characters not allowed in keywords');
assert.strictEqual(kwa.invalidKeywordReason('a b c d e f g h i j k'), 'more than 10 words');
assert.strictEqual(kwa.invalidKeywordReason('x'.repeat(79)), 'longer than 80 characters');
assert.strictEqual(kwa.invalidKeywordReason('t-shirt & co.'), '');

// German sheet header of the Microsoft Advertising version is understood
const parsed = kwa.parseRuleRows([
  ['Aktiv', 'Kampagnenfilter', 'Erlaubte Begriffe (Regex)', 'Ausschlussbegriffe (Regex)', 'Min. Impressionen', 'Min. Klicks',
    'Min. Impr.-Anteil %', 'Min. CTR %', 'Min. CTR-Faktor', 'Min. Conversions', 'Match-Typ', 'Max. neue Keywords'],
  [true, '%A%', 'reifen|felgen', 'gebraucht', 100, 10, '2,5', '', '', '', 'Phrase', 5],
  ['', '', '', '', '', '', '', '', '', '', '', '']
]);
assert.strictEqual(parsed.problems.length, 0);
assert.strictEqual(parsed.rules.length, 1);

const validated = kwa.validateRules(parsed.rules.concat([
  { id: 'x', positivePattern: '(' },
  { id: 'y', positivePattern: 'a', minClicks: 0 },
  { id: 'z', positivePattern: 'a', matchType: 'broad' },
  { id: 'off', positivePattern: 'a', active: 'FALSE' }
]));
assert.strictEqual(validated.rules.length, 1);
assert.strictEqual(validated.problems.length, 3);
const r0 = validated.rules[0];
assert.strictEqual(r0.matchType, 'phrase');
assert.strictEqual(r0.minImpressionShare, 2.5);
assert.strictEqual(r0.minCtrFactor, 1); // default
assert.strictEqual(r0.negativePattern, 'gebraucht');

// Log tabs: processed keywords and excluder exclusions
const logged = kwa.parseLog([
  ['timestamp', 'rule', 'campaign', 'adGroup', 'adGroupId', 'searchTerm', 'keyword', 'impressions', 'clicks', 'ctr', 'impressionShare', 'ctrFactor', 'conversions', 'cost', 'action', 'note'],
  ['', '', '', '', '', 'a', '[a]', '', '', '', '', '', '', '', 'ADDED', ''],
  ['', '', '', '', '', 'b', '[b]', '', '', '', '', '', '', '', 'WOULD_ADD', '']
]);
assert.deepStrictEqual(logged, { '[a]': true });
const excluded = kwa.parseExcluderLog([
  ['timestamp', 'rule', 'campaignFilter', 'listName', 'searchTerm', 'negative', 'impressions', 'clicks', 'cost', 'conversions', 'action', 'note'],
  ['', '', '', '', 'Foo  Bar', '[foo bar]', '', '', '', '', 'EXCLUDED', ''],
  ['', '', '', '', 'baz', '[baz]', '', '', '', '', 'WOULD_EXCLUDE', '']
]);
assert.deepStrictEqual(excluded, { 'foo bar': true });

// buildPlan: per-rule limit, guards from logs
const plan = kwa.buildPlan(
  Object.assign({}, r0, { positivePattern: 'shoe', negativePattern: '', minImpressions: 1, minClicks: 1, minImpressionShare: 0, minCtrFactor: 0, matchType: 'exact', maxNewKeywords: 1 }),
  [
    { term: 'shoe a', adGroupId: '1', standard: true, impressions: 10, clicks: 5, conversions: 0, cost: 0 },
    { term: 'shoe b', adGroupId: '1', standard: true, impressions: 10, clicks: 2, conversions: 0, cost: 0 },
    { term: 'shoe c', adGroupId: '1', standard: true, impressions: 10, clicks: 9, conversions: 0, cost: 0 },
    { term: 'foo bar shoe', adGroupId: '1', standard: true, impressions: 10, clicks: 9, conversions: 0, cost: 0 }
  ],
  {},
  { existing: {}, removed: {}, logged: { '[shoe c]': true }, excluded: { 'foo bar shoe': true } }
);
assert.deepStrictEqual(plan.candidates.map(c => c.keyword), ['[shoe a]']);
assert.strictEqual(plan.stats.deferred, 1);
assert.strictEqual(plan.stats.done, 1);
assert.strictEqual(plan.stats.excluded, 1);

// --- Integration: full run --------------------------------------------------

kwa.main();

assert.deepStrictEqual(state.added, [
  { adGroup: 'Shoes', keyword: '[running shoes]' },
  { adGroup: 'Shoes', keyword: '[männer sneaker]' },
  { adGroup: 'Boots', keyword: '[shoe sale]' }
]);
assert.strictEqual(state.mails.length, 1);
const mail = state.mails[0];
assert.ok(mail.subject.includes('3 keyword(s) added'), mail.subject);
assert.ok(mail.subject.includes('1 error(s)'), mail.subject);
assert.ok(mail.htmlBody.includes('[running shoes]'));
assert.ok(mail.htmlBody.includes('1 already exist'));
assert.ok(mail.htmlBody.includes('1 removed earlier'));
assert.ok(mail.htmlBody.includes('1 excluded'));
assert.ok(mail.htmlBody.includes('shoes? best'));
assert.ok(mail.htmlBody.includes('POLICY_VIOLATION'));
assert.ok(!mail.htmlBody.includes('dsa shoes'));

// --- Integration: dry run does not change anything ---------------------------

state.added = [];
state.mails = [];
loadScript([
  ["const NOTIFY_EMAILS = ['you@example.com'];", "const NOTIFY_EMAILS = ['test@test.de'];"],
  ["const EMAIL_LANGUAGE = 'en';", "const EMAIL_LANGUAGE = 'de';"],
  ["positivePattern: '(shoe|sneaker|boot)s?'", "positivePattern: 'shoe|schuh|maenner'"]
]).main();
assert.strictEqual(state.added.length, 0);
assert.ok(state.mails[0].subject.startsWith('[Testlauf] '), state.mails[0].subject);
assert.ok(state.mails[0].subject.includes('4 Keyword(s) würden angelegt'), state.mails[0].subject);

const out = path.join(__dirname, 'output');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'mail.html'), mail.htmlBody);
fs.writeFileSync(path.join(out, 'mail-dry-run-de.html'), state.mails[0].htmlBody);
console.log('All tests passed. Mail previews: test/output/');
