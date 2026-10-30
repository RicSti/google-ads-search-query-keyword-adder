/**
 * Google Ads Script: Search Query Keyword Adder (single account)
 *
 * Turns well-performing search terms into new keywords ([exact] by default,
 * optionally "phrase"). Counterpart of the Search Query Excluder: the excluder
 * removes irrelevant search terms, this script adopts the good ones.
 *
 * A search term becomes a keyword in the ad group where it had the most
 * clicks, if it meets ALL thresholds of a rule in that ad group:
 *   - matches the positive pattern and not the negative pattern (regex)
 *   - minimum impressions and clicks
 *   - minimum share of the ad group's impressions
 *   - minimum CTR, absolute and relative to the ad group's CTR
 *   - minimum conversions
 *
 * Features
 *   - Multiple rules per account (e.g. one per campaign group), configured
 *     directly in this script or in a Google Sheet
 *   - Dry run / test mode per rule, HTML summary e-mail, log tab
 *   - Safety nets: never adds duplicates, does not re-add keywords you have
 *     removed, ignores excluded search terms, limits per rule and run
 *   - Works together with the Search Query Excluder (same Google Sheet)
 *
 * @name        Search Query Keyword Adder
 * @version     1.0.0
 * @author      Richard Stinauer (adtraffic) <rs@adtraffic.de>
 * @copyright   (c) 2026 adtraffic - https://www.adtraffic.de
 * @license     MIT - see LICENSE file or https://opensource.org/licenses/MIT
 *
 * Setup
 *   1. Google Ads > Tools > Bulk actions > Scripts > + > paste this file.
 *   2. Adjust the SETTINGS block below (at least RULES or SPREADSHEET_URL,
 *      and NOTIFY_EMAILS).
 *   3. Authorize, run "Preview" once, check the log / e-mail.
 *   4. Set DRY_RUN = false and schedule the script (e.g. weekly).
 *
 * Changelog
 *   1.0.0  2026-10-30  First public single-account release.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. Always
 * test with DRY_RUN = true before letting the script change your account.
 */

// ===========================================================================
// SETTINGS
// ===========================================================================

// true = nothing is changed in the account, the script only reports what it
// would do. Switch to false once the dry run looks plausible.
const DRY_RUN = true;

// Optional: URL of a Google Sheet holding the rules (tab "kw_rules"). If set,
// the RULES below are ignored. Leave empty ('') to use the RULES in this script.
// On the first run the script creates the tabs "kw_rules" and "kw_log" itself.
// Tip: use the same sheet as the Search Query Excluder - search terms it has
// excluded (tab "log") are then never added as keywords.
const SPREADSHEET_URL = '';

// Rules used when SPREADSHEET_URL is empty. One object per rule.
//   campaignFilter      Campaign name, '%' = wildcard ('%Brand%'), '' = all campaigns
//   positivePattern     Regex (case-insensitive). Only matching terms are considered.
//   negativePattern     Regex (optional). Matching terms are never added.
//   dateRange           e.g. 'LAST_30_DAYS', 'LAST_7_DAYS' or a number of days (90)
//   minImpressions      Minimum impressions of the term in the ad group
//   minClicks           Minimum clicks of the term in the ad group (at least 1)
//   minImpressionShare  Minimum share of the ad group's impressions in % (1 = 1 %)
//   minCtr              Minimum CTR of the term in % (0 = off)
//   minCtrFactor        Term CTR / ad group CTR (1 = at least ad group average, 0 = off)
//   minConversions      Minimum conversions of the term in the ad group
//   matchType           'exact' or 'phrase'
//   maxNewKeywords      Maximum number of new keywords of this rule per run
//   mode                'live' or 'test' (test = report only, like DRY_RUN)
//   active              false = rule is ignored
const RULES = [
  {
    campaignFilter: '%Search%',
    positivePattern: '(shoe|sneaker|boot)s?',
    negativePattern: 'free|used|repair',
    dateRange: 'LAST_30_DAYS',
    minImpressions: 50,
    minClicks: 5,
    minImpressionShare: 1,
    minCtr: 0,
    minCtrFactor: 1,
    minConversions: 0,
    matchType: 'exact',
    maxNewKeywords: 20,
    mode: 'live',
    active: true
  }
];

// Recipients of the summary e-mail. Empty list = no e-mail.
const NOTIFY_EMAILS = ['you@example.com'];

// false = only send an e-mail if keywords were added or something went wrong
const SEND_EMAIL_IF_NOTHING_CHANGED = false;

// Language of the e-mail: 'en' or 'de'
const EMAIL_LANGUAGE = 'en';

// Maximum number of keywords listed per rule in the e-mail
const EMAIL_MAX_KEYWORDS_PER_RULE = 50;

// true = new keywords are created paused, so you can review them first
const NEW_KEYWORDS_PAUSED = false;

// --- Safety nets -----------------------------------------------------------

// Maximum number of new keywords per run over all rules
const MAX_NEW_KEYWORDS_PER_RUN = 50;

// Do not add a keyword again (same text and match type) that has been removed
// in the account - a removed keyword counts as a deliberate decision.
const RESPECT_REMOVED_KEYWORDS = true;

// Do not add search terms that are excluded by a negative keyword
// (search term status "Excluded") or that the Search Query Excluder has
// excluded (tab EXCLUDER_LOG_SHEET in the same Google Sheet).
const RESPECT_EXCLUDED_TERMS = true;

// Log tab of the Search Query Excluder in the same sheet (ignored if missing)
const EXCLUDER_LOG_SHEET = 'log';

// Also test the patterns against an umlaut-free version of the term
// (ä->ae, ö->oe, ü->ue, ß->ss), so 'maenner' in the pattern matches 'männer'.
const MATCH_TRANSLITERATED = true;

// ===========================================================================
// No changes needed below this line.
// ===========================================================================

const SCRIPT_NAME = 'Search Query Keyword Adder';
const SCRIPT_VERSION = '1.0.0';
const SCRIPT_URL = 'https://www.adtraffic.de';

const RULES_SHEET = 'kw_rules';
const LOG_SHEET = 'kw_log';

const LIMITS = {
  maxKeywordChars: 80,
  maxKeywordWords: 10,
  adGroupIdChunk: 5000
};

// Characters Google Ads does not accept in keywords. Terms containing them are
// skipped instead of altered - a modified keyword would not be the search term.
const INVALID_KEYWORD_CHARS = /[!@%,*(){}=~`<>?\\|^;\[\]"]/;

const DATE_LITERALS = [
  'TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS',
  'LAST_BUSINESS_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'THIS_WEEK_SUN_TODAY',
  'THIS_WEEK_MON_TODAY', 'LAST_WEEK_SUN_SAT', 'LAST_WEEK_MON_SUN'
];

const RULE_DEFAULTS = {
  campaignFilter: '',
  positivePattern: '',
  negativePattern: '',
  dateRange: 'LAST_30_DAYS',
  minImpressions: 50,
  minClicks: 5,
  minImpressionShare: 1,
  minCtr: 0,
  minCtrFactor: 1,
  minConversions: 0,
  matchType: 'exact',
  maxNewKeywords: 20,
  mode: 'live',
  active: true
};

const NUMBER_FIELDS = ['minImpressions', 'minClicks', 'minImpressionShare', 'minCtr', 'minCtrFactor', 'minConversions', 'maxNewKeywords'];

const RULE_HEADER = ['active', 'campaignFilter', 'positivePattern', 'negativePattern', 'dateRange', 'minImpressions', 'minClicks',
  'minImpressionShare', 'minCtr', 'minCtrFactor', 'minConversions', 'matchType', 'maxNewKeywords', 'mode', 'notes'];
const LOG_HEADER = ['timestamp', 'rule', 'campaign', 'adGroup', 'adGroupId', 'searchTerm', 'keyword', 'impressions', 'clicks',
  'ctr', 'impressionShare', 'ctrFactor', 'conversions', 'cost', 'action', 'note'];

// Header aliases (lowercase, letters only), so German / older sheets keep working
const HEADER_ALIASES = {
  active: ['active', 'enabled', 'aktiv'],
  campaignFilter: ['campaignfilter', 'campaign', 'kampagnenfilter'],
  positivePattern: ['positivepattern', 'positiveterms', 'pattern', 'regex', 'erlaubtebegriffe', 'erlaubtebegrifferegex'],
  negativePattern: ['negativepattern', 'negativeterms', 'ausschlussbegriffe', 'ausschlussbegrifferegex'],
  dateRange: ['daterange', 'timerange', 'zeitraum'],
  minImpressions: ['minimpressions', 'minimpressionen'],
  minClicks: ['minclicks', 'minklicks'],
  minImpressionShare: ['minimpressionshare', 'minimprshare', 'minimpranteil', 'minimpressionsanteil'],
  minCtr: ['minctr'],
  minCtrFactor: ['minctrfactor', 'minctrfaktor'],
  minConversions: ['minconversions', 'minconv'],
  matchType: ['matchtype', 'matchtyp'],
  maxNewKeywords: ['maxnewkeywords', 'maxneuekeywords'],
  mode: ['mode', 'modeliveortest', 'modus']
};

const ACTION = {
  added: 'ADDED',
  wouldAdd: 'WOULD_ADD',
  notPossible: 'NOT_POSSIBLE',
  error: 'ERROR'
};

// Log entries with these actions count as processed and are not tried again
// (delete the row in tab "kw_log" to allow a term again).
const DONE_ACTIONS = [ACTION.added, ACTION.notPossible, ACTION.error];

// Action of the Search Query Excluder for excluded terms
const EXCLUDER_ACTION_EXCLUDED = 'EXCLUDED';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (typeof AdsManagerApp !== 'undefined' && isManagerAccount()) {
    throw new Error('This is the single-account version. Please run it inside a client account, not in a manager account (MCC).');
  }

  const account = AdsApp.currentAccount();
  const context = {
    accountName: account.getName(),
    accountId: account.getCustomerId(),
    currency: account.getCurrencyCode(),
    timeZone: account.getTimeZone(),
    startedAt: new Date(),
    spreadsheet: SPREADSHEET_URL ? openSpreadsheet(SPREADSHEET_URL) : null
  };

  console.log(`${SCRIPT_NAME} v${SCRIPT_VERSION} - ${context.accountName} (${context.accountId})${DRY_RUN ? ' - DRY RUN' : ''}`);

  const loaded = context.spreadsheet ? loadRulesFromSheet(context.spreadsheet) : { rules: RULES.map((r, i) => Object.assign({ id: `#${i + 1}` }, r)), problems: [] };
  const parsed = validateRules(loaded.rules);
  const problems = loaded.problems.concat(parsed.problems);

  problems.forEach(p => console.warn(p));
  console.log(`${parsed.rules.length} active rule(s).`);

  const results = [];

  if (parsed.rules.length > 0) {
    const guards = loadGuards(context);
    const run = { seen: {}, budget: MAX_NEW_KEYWORDS_PER_RUN };

    for (const rule of parsed.rules) {
      try {
        results.push(processRule(rule, context, guards, run));
      } catch (e) {
        console.error(`Rule ${rule.id}: ${e.message}`);
        results.push(emptyResult(rule, `${e.message}`));
      }
    }
  }

  if (context.spreadsheet) {
    writeLog(context.spreadsheet, results, context);
  }

  logSummary(results);
  sendSummaryMail(results, problems, context);
}

// ---------------------------------------------------------------------------
// Rule processing
// ---------------------------------------------------------------------------

function processRule(rule, context, guards, run) {
  const testMode = DRY_RUN || rule.mode === 'test';
  const result = emptyResult(rule);

  console.log(`Rule ${rule.id}: campaigns "${rule.campaignFilter || '(all)'}", ${rule.matchType}${testMode ? ' (test)' : ''}`);

  // 1. Search terms per ad group + ad group totals
  const entries = fetchSearchTerms(rule, context);
  const totals = fetchAdGroupTotals(rule, context);

  // 2. Evaluate
  const plan = buildPlan(rule, entries, totals, guards);
  Object.assign(result.stats, plan.stats);
  result.skippedTerms = plan.skipped;

  // 3. One keyword only once per run (several rules may match) + run limit
  let candidates = plan.candidates.filter(c => !run.seen[c.keyword.toLowerCase()]);
  result.stats.duplicates = plan.candidates.length - candidates.length;

  if (candidates.length > run.budget) {
    const postponed = candidates.length - Math.max(run.budget, 0);
    result.stats.deferred += postponed;
    result.warnings.push(`${postponed} keyword(s) postponed: limit of ${MAX_NEW_KEYWORDS_PER_RUN} new keywords per run reached - next run.`);
    candidates = candidates.slice(0, Math.max(run.budget, 0));
  }

  candidates.forEach(c => { run.seen[c.keyword.toLowerCase()] = true; });
  run.budget -= candidates.length;

  console.log(`  ${plan.stats.checked} terms checked, ${plan.stats.qualified} meet the thresholds, ${candidates.length} new keyword(s)` +
    `${result.stats.deferred ? `, ${result.stats.deferred} postponed` : ''}.`);

  // 4. Create keywords
  if (candidates.length === 0) {
    return result;
  }

  if (testMode) {
    result.terms = candidates;
    console.log(`  Would add ${candidates.length} keyword(s).`);
    return result;
  }

  result.terms = addKeywords(candidates, result);
  result.terms.forEach(c => { guards.existing[guardKey(c.term, rule.matchType)] = true; });
  console.log(`  Added ${result.terms.length} keyword(s)${NEW_KEYWORDS_PAUSED ? ' (paused)' : ''}.`);
  return result;
}

function emptyResult(rule, error) {
  return {
    rule: rule,
    testMode: DRY_RUN || rule.mode === 'test',
    stats: { checked: 0, relevant: 0, qualified: 0, existing: 0, removed: 0, excluded: 0, done: 0, duplicates: 0, deferred: 0 },
    terms: [],
    skippedTerms: [],
    failedTerms: [],
    errors: error ? [error] : [],
    warnings: []
  };
}

// Pure function: decides which search terms become keywords (testable without Google Ads).
//   entries: [{ term, adGroupId, adGroup, campaign, standard, excluded, impressions, clicks, cost, conversions }]
//   totals:  { adGroupId: { impressions, clicks } }
//   guards:  { existing, removed, logged, excluded } (maps)
function buildPlan(rule, entries, totals, guards) {
  const positive = new RegExp(rule.positivePattern, 'i');
  const negative = rule.negativePattern ? new RegExp(rule.negativePattern, 'i') : null;
  const matches = (re, term) => re.test(term) || (MATCH_TRANSLITERATED && re.test(transliterate(term)));
  const stats = { checked: 0, relevant: 0, qualified: 0, existing: 0, removed: 0, excluded: 0, done: 0, deferred: 0 };
  const excludedTerms = {};
  const sums = {};
  const best = {};

  for (const e of entries) {
    if (e.excluded) {
      excludedTerms[e.term] = true;
    }

    const s = sums[e.adGroupId] || (sums[e.adGroupId] = { impressions: 0, clicks: 0 });
    s.impressions += e.impressions;
    s.clicks += e.clicks;

    // Keywords can only be added to standard search ad groups (not DSA)
    if (!e.standard) {
      continue;
    }

    // Target ad group: most clicks, then most impressions
    const current = best[e.term];

    if (!current || e.clicks > current.clicks || (e.clicks === current.clicks && e.impressions > current.impressions)) {
      best[e.term] = e;
    }
  }

  const qualified = [];

  Object.keys(best).forEach(term => {
    const t = Object.assign({}, best[term]);
    stats.checked++;

    if (!matches(positive, term) || (negative && matches(negative, term))) {
      return;
    }

    stats.relevant++;

    // Ad group totals from the ad group report (search term report hides low-volume terms)
    const ag = totals[t.adGroupId] && totals[t.adGroupId].impressions >= sums[t.adGroupId].impressions ? totals[t.adGroupId] : sums[t.adGroupId];

    t.ctr = t.impressions > 0 ? 100 * t.clicks / t.impressions : 0;
    t.agCtr = ag.impressions > 0 ? 100 * ag.clicks / ag.impressions : 0;
    t.share = ag.impressions > 0 ? 100 * t.impressions / ag.impressions : 0;
    t.ctrFactor = t.agCtr > 0 ? t.ctr / t.agCtr : 0;

    if (t.impressions < rule.minImpressions || t.clicks < rule.minClicks || t.share < rule.minImpressionShare ||
      t.ctr < rule.minCtr || t.ctrFactor < rule.minCtrFactor || t.conversions < rule.minConversions) {
      return;
    }

    stats.qualified++;
    t.keyword = keywordText(term, rule.matchType);

    const key = guardKey(term, rule.matchType);

    if (guards.existing[key]) {
      stats.existing++;
      return;
    }

    if (RESPECT_REMOVED_KEYWORDS && guards.removed[key]) {
      stats.removed++;
      return;
    }

    if (RESPECT_EXCLUDED_TERMS && (excludedTerms[term] || guards.excluded[term])) {
      stats.excluded++;
      return;
    }

    if (guards.logged[t.keyword.toLowerCase()]) {
      stats.done++;
      return;
    }

    qualified.push(t);
  });

  // Strongest terms first: conversions, clicks, impressions
  qualified.sort((a, b) => b.conversions - a.conversions || b.clicks - a.clicks || b.impressions - a.impressions);

  const plan = { stats: stats, candidates: [], skipped: [] };

  for (const t of qualified) {
    const reason = invalidKeywordReason(t.term);

    if (reason) {
      plan.skipped.push(Object.assign({}, t, { reason: reason }));
    } else if (plan.candidates.length >= rule.maxNewKeywords) {
      stats.deferred++;
    } else {
      plan.candidates.push(t);
    }
  }

  return plan;
}

// Checks whether a search term can be used as keyword. Returns a reason or ''.
function invalidKeywordReason(term) {
  if (INVALID_KEYWORD_CHARS.test(term)) {
    return 'contains characters not allowed in keywords';
  }

  if (term.length + 2 > LIMITS.maxKeywordChars) {
    return `longer than ${LIMITS.maxKeywordChars} characters`;
  }

  if (term.split(' ').length > LIMITS.maxKeywordWords) {
    return `more than ${LIMITS.maxKeywordWords} words`;
  }

  return '';
}

function keywordText(term, matchType) {
  return matchType === 'phrase' ? `"${term}"` : `[${term}]`;
}

function guardKey(term, matchType) {
  return `${normalizeTerm(term)}|${matchType}`;
}

function normalizeTerm(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function transliterate(text) {
  return text.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

// ---------------------------------------------------------------------------
// Rules: validation and Google Sheet
// ---------------------------------------------------------------------------

function validateRules(rawRules) {
  const rules = [];
  const problems = [];

  rawRules.forEach(raw => {
    const r = Object.assign({}, RULE_DEFAULTS);
    Object.keys(raw).forEach(k => {
      if (raw[k] !== '' && raw[k] !== null && raw[k] !== undefined) {
        r[k] = raw[k];
      }
    });
    r.id = raw.id;

    if (!toBool(r.active)) {
      return;
    }

    r.campaignFilter = String(r.campaignFilter).trim();
    r.positivePattern = String(r.positivePattern).trim();
    r.negativePattern = String(r.negativePattern).trim();
    r.mode = String(r.mode).trim().toLowerCase() === 'test' ? 'test' : 'live';
    r.dateRange = String(r.dateRange).trim().toUpperCase();
    r.matchType = parseMatchType(r.matchType);

    if (!r.positivePattern) {
      problems.push(`Rule ${r.id}: positivePattern is missing.`);
      return;
    }

    let regexError = '';

    [r.positivePattern, r.negativePattern].filter(Boolean).forEach(p => {
      try {
        new RegExp(p, 'i');
      } catch (e) {
        regexError = regexError || `invalid pattern "${p}" - ${e.message}`;
      }
    });

    if (regexError) {
      problems.push(`Rule ${r.id}: ${regexError}`);
      return;
    }

    const badNumber = NUMBER_FIELDS.find(key => {
      r[key] = toDecimal(r[key]);
      return isNaN(r[key]) || r[key] < 0;
    });

    if (badNumber) {
      problems.push(`Rule ${r.id}: invalid ${badNumber}.`);
      return;
    }

    if (r.minClicks < 1) {
      problems.push(`Rule ${r.id}: minClicks must be at least 1 (without clicks the CTR says nothing).`);
      return;
    }

    r.maxNewKeywords = Math.floor(r.maxNewKeywords);

    if (r.maxNewKeywords < 1) {
      problems.push(`Rule ${r.id}: maxNewKeywords must be at least 1.`);
      return;
    }

    if (!r.matchType) {
      problems.push(`Rule ${r.id}: invalid matchType (use exact or phrase).`);
      return;
    }

    if (!DATE_LITERALS.includes(r.dateRange) && !(/^\d+$/.test(r.dateRange) && +r.dateRange > 0)) {
      problems.push(`Rule ${r.id}: invalid dateRange "${r.dateRange}" (use e.g. LAST_30_DAYS or a number of days).`);
      return;
    }

    rules.push(r);
  });

  return { rules: rules, problems: problems };
}

function parseMatchType(value) {
  const v = String(value || '').trim().toLowerCase();

  if (['exact', 'exakt', 'genau'].includes(v)) {
    return 'exact';
  }

  if (['phrase', 'wortgruppe'].includes(v)) {
    return 'phrase';
  }

  return null;
}

function toBool(value) {
  if (value === true || value === false) {
    return value;
  }
  return !['false', 'falsch', 'no', 'nein', '0', 'off', 'inactive'].includes(String(value).trim().toLowerCase());
}

// Number from a number or text ("2,5" / "2.5" / "2,5 %" / "1.234,5"). Invalid -> NaN
function toDecimal(value) {
  if (typeof value === 'number') {
    return value;
  }

  let s = String(value === undefined || value === null ? '' : value).replace(/[%\s]/g, '');

  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(',', '.');
  }

  return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
}

function openSpreadsheet(url) {
  try {
    return SpreadsheetApp.openByUrl(url);
  } catch (e) {
    throw new Error(`Cannot open spreadsheet (${e.message}). Check SPREADSHEET_URL and access rights.`);
  }
}

function loadRulesFromSheet(ss) {
  let sheet = ss.getSheetByName(RULES_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(RULES_SHEET);
    sheet.getRange(1, 1, 1, RULE_HEADER.length).setValues([RULE_HEADER]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return { rules: [], problems: [`Tab "${RULES_SHEET}" was created. Please add your rules there and run the script again.`] };
  }

  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return { rules: [], problems: [`Tab "${RULES_SHEET}" contains no rules.`] };
  }

  return parseRuleRows(values);
}

// Pure function: sheet values (incl. header row) -> rule objects
function parseRuleRows(values) {
  const header = values[0].map(normalizeHeader);
  const columns = {};
  const problems = [];

  Object.keys(HEADER_ALIASES).forEach(key => {
    const index = header.findIndex(h => HEADER_ALIASES[key].includes(h));
    if (index >= 0) {
      columns[key] = index;
    }
  });

  if (columns.positivePattern === undefined) {
    return { rules: [], problems: [`Tab "${RULES_SHEET}": column "positivePattern" not found.`] };
  }

  const rules = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    if (row.every(cell => String(cell).trim() === '')) {
      continue;
    }

    const rule = { id: `row ${i + 1}` };
    Object.keys(columns).forEach(key => { rule[key] = row[columns[key]]; });
    rules.push(rule);
  }

  return { rules: rules, problems: problems };
}

function normalizeHeader(text) {
  return String(text || '').toLowerCase().replace(/[^a-z]/g, '');
}

// Pure function: values of tab "kw_log" -> processed keywords { "[keyword]": true }
function parseLog(values) {
  const done = {};

  if (values.length < 2) {
    return done;
  }

  const header = values[0].map(normalizeHeader);
  const kwCol = header.indexOf('keyword');
  const actionCol = header.indexOf('action');

  if (kwCol < 0 || actionCol < 0) {
    return done;
  }

  for (let i = 1; i < values.length; i++) {
    if (DONE_ACTIONS.includes(String(values[i][actionCol]))) {
      done[String(values[i][kwCol]).toLowerCase()] = true;
    }
  }

  return done;
}

// Pure function: values of the excluder's log tab -> excluded terms { term: true }
function parseExcluderLog(values) {
  const excluded = {};

  if (values.length < 2) {
    return excluded;
  }

  const header = values[0].map(normalizeHeader);
  const termCol = header.indexOf('searchterm');
  const actionCol = header.indexOf('action');

  if (termCol < 0 || actionCol < 0) {
    return excluded;
  }

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][actionCol]) === EXCLUDER_ACTION_EXCLUDED) {
      excluded[normalizeTerm(values[i][termCol])] = true;
    }
  }

  return excluded;
}

function readSheetValues(ss, name) {
  try {
    const sheet = ss.getSheetByName(name);
    return sheet ? sheet.getDataRange().getValues() : [];
  } catch (e) {
    console.warn(`Could not read tab "${name}": ${e.message}`);
    return [];
  }
}

function writeLog(ss, results, context) {
  const rows = [];
  const timestamp = Utilities.formatDate(context.startedAt, context.timeZone, 'yyyy-MM-dd HH:mm:ss');

  for (const r of results) {
    const row = (t, action, note) => [timestamp, r.rule.id, t.campaign, t.adGroup, t.adGroupId, t.term, t.keyword, t.impressions, t.clicks,
      round(t.ctr, 2), round(t.share, 2), round(t.ctrFactor, 2), round(t.conversions, 2), round(t.cost, 2), action, note || ''];

    r.terms.forEach(t => rows.push(row(t, r.testMode ? ACTION.wouldAdd : ACTION.added, NEW_KEYWORDS_PAUSED ? 'paused' : '')));
    r.skippedTerms.forEach(t => rows.push(row(t, ACTION.notPossible, t.reason)));
    r.failedTerms.forEach(t => rows.push(row(t, ACTION.error, t.reason)));
  }

  if (rows.length === 0) {
    return;
  }

  try {
    let sheet = ss.getSheetByName(LOG_SHEET);

    if (!sheet) {
      sheet = ss.insertSheet(LOG_SHEET);
      sheet.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LOG_HEADER.length).setValues(rows);
  } catch (e) {
    console.warn(`Could not write tab "${LOG_SHEET}": ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Google Ads access
// ---------------------------------------------------------------------------

function isManagerAccount() {
  try {
    AdsManagerApp.accounts().get();
    return true;
  } catch (e) {
    return false;
  }
}

function gaqlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function campaignCondition(rule) {
  return rule.campaignFilter ? ` AND campaign.name LIKE ${gaqlString(rule.campaignFilter)}` : '';
}

function dateCondition(rule, context) {
  if (DATE_LITERALS.includes(rule.dateRange)) {
    return `segments.date DURING ${rule.dateRange}`;
  }

  const days = parseInt(rule.dateRange, 10);
  const end = new Date(context.startedAt.getTime() - 24 * 3600 * 1000);
  const start = new Date(end.getTime() - (days - 1) * 24 * 3600 * 1000);
  const fmt = d => Utilities.formatDate(d, context.timeZone, 'yyyy-MM-dd');
  return `segments.date BETWEEN '${fmt(start)}' AND '${fmt(end)}'`;
}

function searchCampaignCondition(rule, context) {
  return `${dateCondition(rule, context)} AND campaign.advertising_channel_type = 'SEARCH' ` +
    `AND campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED'${campaignCondition(rule)}`;
}

// Search terms with clicks, per ad group (only search campaigns can get keywords)
function fetchSearchTerms(rule, context) {
  const query =
    'SELECT search_term_view.search_term, search_term_view.status, campaign.name, ad_group.id, ad_group.name, ad_group.type, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    `FROM search_term_view WHERE ${searchCampaignCondition(rule, context)} AND metrics.clicks > 0`;

  const byKey = {};
  const rows = AdsApp.search(query);

  while (rows.hasNext()) {
    const row = rows.next();
    const term = normalizeTerm(row.searchTermView.searchTerm);

    if (!term) {
      continue;
    }

    const adGroupId = String(row.adGroup.id);
    const key = `${term}|${adGroupId}`;
    const status = String(row.searchTermView.status || '');
    const entry = byKey[key] || (byKey[key] = {
      term: term, adGroupId: adGroupId, adGroup: row.adGroup.name, campaign: row.campaign.name,
      standard: String(row.adGroup.type) === 'SEARCH_STANDARD',
      excluded: false, impressions: 0, clicks: 0, cost: 0, conversions: 0
    });

    entry.excluded = entry.excluded || status === 'EXCLUDED' || status === 'ADDED_EXCLUDED';
    entry.impressions += Number(row.metrics.impressions) || 0;
    entry.clicks += Number(row.metrics.clicks) || 0;
    entry.cost += (Number(row.metrics.costMicros) || 0) / 1e6;
    entry.conversions += Number(row.metrics.conversions) || 0;
  }

  return Object.keys(byKey).map(k => byKey[k]);
}

// Impressions and clicks per ad group, the basis for impression share and CTR factor
function fetchAdGroupTotals(rule, context) {
  const totals = {};
  const rows = AdsApp.search(
    'SELECT ad_group.id, metrics.impressions, metrics.clicks ' +
    `FROM ad_group WHERE ${searchCampaignCondition(rule, context)} AND metrics.impressions > 0`
  );

  while (rows.hasNext()) {
    const row = rows.next();
    const id = String(row.adGroup.id);
    const t = totals[id] || (totals[id] = { impressions: 0, clicks: 0 });
    t.impressions += Number(row.metrics.impressions) || 0;
    t.clicks += Number(row.metrics.clicks) || 0;
  }

  return totals;
}

// Keywords of the whole account: existing (enabled/paused) and removed ones
function fetchAccountKeywords() {
  const existing = {};
  const removed = {};
  const rows = AdsApp.search(
    'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status ' +
    "FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE " +
    "AND campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED'"
  );

  while (rows.hasNext()) {
    const criterion = rows.next().adGroupCriterion;
    const key = guardKey(criterion.keyword.text, String(criterion.keyword.matchType).toLowerCase());

    if (String(criterion.status) === 'REMOVED') {
      removed[key] = true;
    } else {
      existing[key] = true;
    }
  }

  return { existing: existing, removed: removed };
}

function loadGuards(context) {
  const keywords = fetchAccountKeywords();
  const guards = { existing: keywords.existing, removed: keywords.removed, logged: {}, excluded: {} };

  if (context.spreadsheet) {
    guards.logged = parseLog(readSheetValues(context.spreadsheet, LOG_SHEET));

    if (RESPECT_EXCLUDED_TERMS) {
      guards.excluded = parseExcluderLog(readSheetValues(context.spreadsheet, EXCLUDER_LOG_SHEET));
    }
  }

  console.log(`${Object.keys(guards.existing).length} keywords in the account, ${Object.keys(guards.removed).length} removed, ` +
    `${Object.keys(guards.excluded).length} terms excluded by the Search Query Excluder.`);
  return guards;
}

function loadAdGroups(ids) {
  const adGroups = {};

  for (let i = 0; i < ids.length; i += LIMITS.adGroupIdChunk) {
    const it = AdsApp.adGroups().withIds(ids.slice(i, i + LIMITS.adGroupIdChunk).map(Number)).get();

    while (it.hasNext()) {
      const adGroup = it.next();
      adGroups[String(adGroup.getId())] = adGroup;
    }
  }

  return adGroups;
}

// Builds all keyword operations first (Google Ads executes them as a batch),
// then checks the results. A failing keyword does not stop the others.
function addKeywords(candidates, result) {
  const adGroups = loadAdGroups(Object.keys(candidates.reduce((ids, c) => { ids[c.adGroupId] = true; return ids; }, {})));
  const pending = [];
  const added = [];

  for (const c of candidates) {
    const adGroup = adGroups[c.adGroupId];

    if (!adGroup) {
      result.skippedTerms.push(Object.assign({}, c, { reason: 'ad group not found' }));
      continue;
    }

    try {
      pending.push({ candidate: c, operation: adGroup.newKeywordBuilder().withText(c.keyword).build() });
    } catch (e) {
      result.failedTerms.push(Object.assign({}, c, { reason: e.message }));
    }
  }

  for (const p of pending) {
    try {
      if (!p.operation.isSuccessful()) {
        result.failedTerms.push(Object.assign({}, p.candidate, { reason: `rejected by Google Ads: ${p.operation.getErrors().join('; ')}` }));
        continue;
      }

      if (NEW_KEYWORDS_PAUSED) {
        p.operation.getResult().pause();
      }

      added.push(p.candidate);
    } catch (e) {
      result.failedTerms.push(Object.assign({}, p.candidate, { reason: e.message }));
    }
  }

  return added;
}

// ---------------------------------------------------------------------------
// Output: log + e-mail
// ---------------------------------------------------------------------------

function logSummary(results) {
  const total = results.reduce((n, r) => n + r.terms.length, 0);
  const errors = results.reduce((n, r) => n + r.errors.length + r.failedTerms.length, 0);
  console.log(`Done: ${total} keyword(s) ${DRY_RUN ? 'planned (dry run)' : 'added or planned'}, ${errors} error(s).`);
}

const I18N = {
  en: {
    subjectChanged: n => `${n} keyword(s) added`,
    subjectPlanned: n => `${n} keyword(s) would be added`,
    subjectNone: 'no changes',
    subjectErrors: n => `${n} error(s)`,
    testPrefix: '[Test] ',
    subtitleLive: 'Summary of the new keywords',
    subtitleTest: 'Test run: preview of planned keywords',
    banner: '<b>Test run:</b> nothing was changed in the account. The numbers show what the script would do in live mode.',
    tileKeywords: 'Keywords added',
    tileKeywordsTest: 'Keywords (planned)',
    tileImpr: 'Impressions of these terms',
    tileClicks: 'Clicks of these terms',
    tileCtr: 'Avg. CTR',
    tileConv: 'Conversions',
    tileErrors: 'Errors',
    metricsNote: 'Metrics refer to the search term in its target ad group and the date range of each rule. The CTR factor compares the CTR of the search term with the CTR of the ad group (1.0 = equal).',
    ruleTitle: (id, filter) => `Rule ${id} · ${filter}`,
    ruleSub: (chk, q) => `${chk} search terms checked, ${q} meet the thresholds`,
    colKeyword: 'Keyword', colTarget: 'Campaign / ad group', colImpr: 'Impr.', colClicks: 'Clicks', colCtr: 'CTR %', colFactor: 'CTR factor', colConv: 'Conv.',
    more: (n, hasSheet) => `... and ${n} more${hasSheet ? ` (see tab "${LOG_SHEET}")` : ''}.`,
    testRule: 'Rule in test mode - nothing was changed.',
    paused: 'New keywords were created paused.',
    notAdded: 'Not added:',
    reasons: {
      existing: n => `${n} already exist`,
      removed: n => `${n} removed earlier`,
      excluded: n => `${n} excluded`,
      done: n => `${n} processed in an earlier run`,
      duplicates: n => `${n} already planned by another rule`,
      deferred: n => `${n} postponed (limit)`
    },
    skipped: n => `${n} term(s) cannot be added as keyword:`,
    failed: n => `${n} keyword(s) rejected:`,
    error: 'Error', warning: 'Note', general: 'General',
    openSheet: 'Open the Google Sheet',
    footer: 'Automated message from the Google Ads script',
    noRules: 'No active rules found.'
  },
  de: {
    subjectChanged: n => `${n} Keyword(s) angelegt`,
    subjectPlanned: n => `${n} Keyword(s) würden angelegt`,
    subjectNone: 'keine Änderungen',
    subjectErrors: n => `${n} Fehler`,
    testPrefix: '[Testlauf] ',
    subtitleLive: 'Zusammenfassung der neu angelegten Keywords',
    subtitleTest: 'Testlauf: Vorschau der geplanten Keywords',
    banner: '<b>Testlauf:</b> Es wurde nichts im Konto verändert. Die Zahlen zeigen, was das Script im Livebetrieb tun würde.',
    tileKeywords: 'Keywords angelegt',
    tileKeywordsTest: 'Keywords (geplant)',
    tileImpr: 'Impressionen der Suchbegriffe',
    tileClicks: 'Klicks der Suchbegriffe',
    tileCtr: 'Ø CTR',
    tileConv: 'Conversions',
    tileErrors: 'Fehler',
    metricsNote: 'Die Kennzahlen gelten für den Suchbegriff in seiner Ziel-Anzeigengruppe im Zeitraum der jeweiligen Regel. Der CTR-Faktor vergleicht die CTR des Suchbegriffs mit der CTR der Anzeigengruppe (1,0 = gleich).',
    ruleTitle: (id, filter) => `Regel ${id} · ${filter}`,
    ruleSub: (chk, q) => `${chk} Suchbegriffe geprüft, ${q} erfüllen die Schwellen`,
    colKeyword: 'Keyword', colTarget: 'Kampagne / Anzeigengruppe', colImpr: 'Impr.', colClicks: 'Klicks', colCtr: 'CTR %', colFactor: 'CTR-Faktor', colConv: 'Conv.',
    more: (n, hasSheet) => `... und ${n} weitere${hasSheet ? ` (vollständig im Tab "${LOG_SHEET}")` : ''}.`,
    testRule: 'Regel im Testmodus - es wurde nichts verändert.',
    paused: 'Neue Keywords wurden pausiert angelegt.',
    notAdded: 'Nicht angelegt:',
    reasons: {
      existing: n => `${n} bereits vorhanden`,
      removed: n => `${n} früher entfernt`,
      excluded: n => `${n} ausgeschlossen`,
      done: n => `${n} in einem früheren Lauf verarbeitet`,
      duplicates: n => `${n} bereits durch andere Regel geplant`,
      deferred: n => `${n} wegen Limit verschoben`
    },
    skipped: n => `${n} Begriff(e) als Keyword nicht möglich:`,
    failed: n => `${n} Keyword(s) abgelehnt:`,
    error: 'Fehler', warning: 'Hinweis', general: 'Allgemein',
    openSheet: 'Google Sheet öffnen',
    footer: 'Automatische Nachricht vom Google-Ads-Script',
    noRules: 'Keine aktiven Regeln gefunden.'
  }
};

function sendSummaryMail(results, problems, context) {
  const recipients = NOTIFY_EMAILS.map(e => String(e).trim()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !/@example\.com$/i.test(e));

  if (recipients.length === 0) {
    console.log('E-mail: no recipients configured.');
    return;
  }

  const html = buildMailHtml(results, problems, context);

  if (!html) {
    console.log('E-mail: nothing changed - not sent.');
    return;
  }

  try {
    MailApp.sendEmail({ to: recipients.join(','), subject: html.subject, htmlBody: html.body, name: SCRIPT_NAME });
    console.log(`E-mail sent to ${recipients.join(', ')}.`);
  } catch (e) {
    console.warn(`E-mail could not be sent: ${e.message}`);
  }
}

// Pure function (apart from formatting): returns { subject, body } or null if nothing to report
function buildMailHtml(results, problems, context) {
  const t = I18N[EMAIL_LANGUAGE] || I18N.en;
  const lang = EMAIL_LANGUAGE === 'de' ? 'de' : 'en';
  const fmt = (v, d) => formatNumber(v, d, lang);
  const allTerms = results.reduce((list, r) => list.concat(r.terms), []);
  const sum = key => allTerms.reduce((n, x) => n + (x[key] || 0), 0);
  const errorCount = results.reduce((n, r) => n + r.errors.length + r.failedTerms.length, 0) + problems.length;
  const allTest = results.length > 0 && results.every(r => r.testMode);

  if (allTerms.length + errorCount === 0 && !SEND_EMAIL_IF_NOTHING_CHANGED) {
    return null;
  }

  // Subject
  const parts = [];
  if (allTerms.length > 0) {
    parts.push(allTest ? t.subjectPlanned(allTerms.length) : t.subjectChanged(allTerms.length));
  }
  if (errorCount > 0) {
    parts.push(t.subjectErrors(errorCount));
  }
  const subject = `${allTest ? t.testPrefix : ''}${SCRIPT_NAME} | ${context.accountName}: ${parts.length ? parts.join(', ') : t.subjectNone}`;

  // Body
  const impressions = sum('impressions');
  let body = mailTiles([
    { value: fmt(allTerms.length), label: allTest ? t.tileKeywordsTest : t.tileKeywords },
    { value: fmt(impressions), label: t.tileImpr },
    { value: fmt(sum('clicks')), label: t.tileClicks },
    { value: impressions > 0 ? `${fmt(100 * sum('clicks') / impressions, 2)} %` : '-', label: t.tileCtr },
    { value: fmt(sum('conversions'), 1), label: t.tileConv },
    { value: fmt(errorCount), label: t.tileErrors, color: errorCount > 0 ? '#c0392b' : null }
  ]) + mailNote(t.metricsNote);

  if (problems.length > 0) {
    body += mailHeading(t.general);
    problems.forEach(p => { body += mailNote(`${t.warning}: ${p}`, '#7a5a00'); });
  }

  if (results.length === 0) {
    body += mailNote(t.noRules, '#7a5a00');
  }

  for (const r of results) {
    const s = r.stats;
    body += mailHeading(t.ruleTitle(r.rule.id, r.rule.campaignFilter || '*'), t.ruleSub(fmt(s.checked), fmt(s.qualified)));

    if (r.testMode && !allTest) {
      body += mailNote(t.testRule, '#7a5a00');
    }

    if (r.terms.length > 0) {
      body += mailTable(
        [{ title: t.colKeyword }, { title: t.colTarget }, { title: t.colImpr, align: 'right' }, { title: t.colClicks, align: 'right' },
          { title: t.colCtr, align: 'right' }, { title: t.colFactor, align: 'right' }, { title: t.colConv, align: 'right' }],
        r.terms.slice(0, EMAIL_MAX_KEYWORDS_PER_RULE).map(x => [
          x.keyword,
          { html: `${escapeHtml(x.campaign)}<br/><span style="color:#5a6472;font-size:12px;">${escapeHtml(x.adGroup)}</span>` },
          fmt(x.impressions), fmt(x.clicks), fmt(x.ctr, 2), fmt(x.ctrFactor, 2), fmt(x.conversions, 1)
        ]));

      if (r.terms.length > EMAIL_MAX_KEYWORDS_PER_RULE) {
        body += mailNote(t.more(r.terms.length - EMAIL_MAX_KEYWORDS_PER_RULE, !!context.spreadsheet));
      }

      if (NEW_KEYWORDS_PAUSED && !r.testMode) {
        body += mailNote(t.paused, '#1d2530');
      }
    }

    const reasons = Object.keys(t.reasons).filter(k => s[k] > 0).map(k => t.reasons[k](fmt(s[k])));

    if (reasons.length > 0) {
      body += mailNote(`${t.notAdded} ${reasons.join(', ')}.`);
    }

    if (r.skippedTerms.length > 0) {
      body += mailNote(`${t.skipped(r.skippedTerms.length)} ${r.skippedTerms.slice(0, 5).map(x => `${x.term} (${x.reason})`).join(', ')}${r.skippedTerms.length > 5 ? ', ...' : ''}`, '#7a5a00');
    }

    if (r.failedTerms.length > 0) {
      body += mailNote(`${t.failed(r.failedTerms.length)} ${r.failedTerms.slice(0, 5).map(x => `${x.keyword} (${x.reason})`).join(', ')}${r.failedTerms.length > 5 ? ', ...' : ''}`, '#c0392b');
    }

    r.errors.forEach(e => { body += mailNote(`${t.error}: ${e}`, '#c0392b'); });
    r.warnings.forEach(w => { body += mailNote(`${t.warning}: ${w}`, '#7a5a00'); });
  }

  return {
    subject: subject,
    body: mailLayout({
      title: `${SCRIPT_NAME} · ${context.accountName} (${context.accountId})`,
      subtitle: allTest ? t.subtitleTest : t.subtitleLive,
      banner: allTest ? t.banner : '',
      bodyHtml: body,
      sheetLink: context.spreadsheet ? `<a href="${escapeHtml(context.spreadsheet.getUrl())}" style="color:#1f3a5f;">${escapeHtml(t.openSheet)}</a> &middot; ` : '',
      footer: `${t.footer} ${SCRIPT_NAME} v${SCRIPT_VERSION} &middot; ${escapeHtml(Utilities.formatDate(context.startedAt, context.timeZone, 'yyyy-MM-dd HH:mm'))} &middot; <a href="${SCRIPT_URL}" style="color:#5a6472;">adtraffic.de</a>`
    })
  };
}

// --- HTML helpers (inline CSS + tables, so it renders in Gmail and Outlook) --

function escapeHtml(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function round(value, digits) {
  const f = Math.pow(10, digits);
  return Math.round((value || 0) * f) / f;
}

function formatNumber(value, digits, lang) {
  if (value === undefined || value === null || value === '' || isNaN(value)) {
    return '-';
  }

  const parts = Number(value).toFixed(digits || 0).split('.');
  const thousands = lang === 'de' ? '.' : ',';
  const decimal = lang === 'de' ? ',' : '.';
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return parts.join(decimal);
}

function mailTiles(tiles) {
  const width = Math.floor(100 / tiles.length);
  const cells = tiles.map(x =>
    `<td width="${width}%" align="center" valign="top" style="padding:12px 4px;background:#f2f5f9;border-radius:6px;">` +
    `<div style="font-size:20px;font-weight:bold;color:${x.color || '#1f3a5f'};">${escapeHtml(x.value)}</div>` +
    `<div style="font-size:12px;color:#5a6472;margin-top:3px;">${escapeHtml(x.label)}</div></td>`).join('');
  return `<table width="100%" cellspacing="6" cellpadding="0" style="border-collapse:separate;"><tr>${cells}</tr></table>`;
}

// Cells are escaped; pass { html: '...' } for pre-built HTML
function mailTable(columns, rows) {
  const cell = 'padding:4px 10px;border:1px solid #d0d0d0;';
  const content = v => (v && typeof v === 'object' && 'html' in v ? v.html : escapeHtml(v));
  const head = columns.map(c => `<th align="${c.align || 'left'}" style="${cell}background:#f0f0f0;white-space:nowrap;">${escapeHtml(c.title)}</th>`).join('');
  const body = rows.map(row => '<tr>' + columns.map((c, i) => `<td align="${c.align || 'left'}" style="${cell}">${content(row[i])}</td>`).join('') + '</tr>').join('');
  return `<table width="100%" style="border-collapse:collapse;font-size:13px;"><tr>${head}</tr>${body}</table>`;
}

function mailHeading(text, sub) {
  return '<div style="margin:24px 0 8px;font-size:15px;font-weight:bold;color:#1f3a5f;border-bottom:2px solid #1f3a5f;padding-bottom:4px;">' +
    `${escapeHtml(text)}${sub ? ` <span style="font-weight:normal;font-size:12px;color:#5a6472;">${escapeHtml(sub)}</span>` : ''}</div>`;
}

function mailNote(text, color) {
  return `<div style="margin:6px 0 0;font-size:12px;color:${color || '#5a6472'};">${escapeHtml(text)}</div>`;
}

function mailLayout(o) {
  const banner = o.banner ? `<tr><td style="background:#fff4d6;color:#7a5a00;padding:10px 24px;font-size:13px;">${o.banner}</td></tr>` : '';

  return '<html><body style="margin:0;padding:0;background:#e9edf2;font-family:Arial,Helvetica,sans-serif;color:#1d2530;">' +
    '<table width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 10px;">' +
    '<table width="720" cellspacing="0" cellpadding="0" style="max-width:720px;width:100%;background:#ffffff;border-radius:8px;">' +
    '<tr><td style="background:#1f3a5f;color:#ffffff;padding:18px 24px;border-radius:8px 8px 0 0;">' +
    `<div style="font-size:19px;font-weight:bold;">${escapeHtml(o.title)}</div>` +
    `<div style="font-size:13px;color:#c9d6e8;margin-top:4px;">${escapeHtml(o.subtitle)}</div></td></tr>` +
    banner +
    `<tr><td style="padding:16px 24px 24px;font-size:14px;line-height:1.45;">${o.bodyHtml}</td></tr>` +
    '<tr><td style="padding:12px 24px;background:#f2f5f9;border-radius:0 0 8px 8px;font-size:12px;color:#5a6472;">' +
    `${o.sheetLink}${o.footer}</td></tr>` +
    '</table></td></tr></table></body></html>';
}

// Allows running the unit tests with Node.js (ignored by Google Ads)
if (typeof module !== 'undefined') {
  module.exports = { buildPlan, invalidKeywordReason, keywordText, parseRuleRows, validateRules, parseLog, parseExcluderLog, buildMailHtml, main };
}
