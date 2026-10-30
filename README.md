# Search Query Keyword Adder – Google Ads Script

Turns your best search terms into keywords automatically: every search term that matches your *positive pattern* and meets all performance thresholds is added as an `[exact match]` (or `"phrase match"`) keyword – in the ad group where it had the most clicks.

Counterpart of the [Search Query Excluder](https://github.com/RicSti/google-ads-search-query-excluder): the excluder removes irrelevant search terms, this script adopts the good ones. Runs inside a single Google Ads account. No API keys, no external services.

## Features

- **Data-driven keyword expansion** for broad match, AI Max and DSA-supported search campaigns
- **Thresholds per rule**: impressions, clicks, share of the ad group's impressions, CTR (absolute and relative to the ad group), conversions
- **Positive and negative pattern** (regular expressions) to keep new keywords on topic
- **Multiple rules per account**, e.g. one per campaign group, each with its own patterns, thresholds, date range and match type
- **Configuration in the script or in a Google Sheet** (handy for many rules or for non-technical colleagues)
- **Dry run** globally or per rule (`mode = test`)
- **HTML summary e-mail** (English or German) with the new keywords, their target ad group and metrics
- **Log tab** in the Google Sheet with every added, skipped and rejected keyword
- **Safety nets**
  - never adds a keyword that already exists in the account (same text and match type)
  - never re-adds a keyword you have removed – a removed keyword counts as a deliberate decision
  - ignores search terms that are excluded by a negative keyword or by the Search Query Excluder
  - max. number of new keywords per rule and per run, strongest terms first
  - optionally creates new keywords paused for review
  - invalid terms (special characters, over 80 characters / 10 words) are skipped instead of altered
  - a rejected keyword does not block the others
- Umlaut-tolerant matching (`maenner` in the pattern also matches `männer`)

## How a search term qualifies

A search term is evaluated in its **target ad group** – the standard search ad group in which it had the most clicks (then impressions). It becomes a keyword if it meets **all** of these conditions there:

| Check | Meaning |
|---|---|
| `positivePattern` | The term matches the regular expression |
| `negativePattern` | The term does not match it (optional) |
| `minImpressions` / `minClicks` | Statistical minimum |
| `minImpressionShare` | Term impressions / ad group impressions in % |
| `minCtr` | CTR of the term in % |
| `minCtrFactor` | CTR of the term / CTR of the ad group (`1` = at least average) |
| `minConversions` | Conversions of the term |

Ad group totals come from the ad group report, so terms hidden in Google's search terms report still count towards the ad group's impressions and clicks.

## Quick start

1. In Google Ads open **Tools → Bulk actions → Scripts** and create a new script.
2. Paste the content of [`search-query-keyword-adder.js`](search-query-keyword-adder.js).
3. Edit the `SETTINGS` block at the top:
   - `RULES` (or `SPREADSHEET_URL`, see below)
   - `NOTIFY_EMAILS`
4. Click **Authorize**, then **Preview**. `DRY_RUN = true` is the default, so nothing is changed.
5. Check the log and the e-mail. If the result is plausible, set `DRY_RUN = false` and schedule the script (weekly is a good start).

## Rules

| Field | Meaning | Default |
|---|---|---|
| `campaignFilter` | Campaign name, `%` = wildcard, empty = all search campaigns. GAQL `LIKE` semantics (`_` matches any single character). | `''` |
| `positivePattern` | Regular expression, case-insensitive. Only matching terms are considered. **Required.** | – |
| `negativePattern` | Regular expression. Matching terms are never added. | `''` |
| `dateRange` | `LAST_7_DAYS`, `LAST_14_DAYS`, `LAST_30_DAYS`, `LAST_MONTH`, … or a number of days | `LAST_30_DAYS` |
| `minImpressions` | Minimum impressions in the target ad group | `50` |
| `minClicks` | Minimum clicks in the target ad group (at least `1`) | `5` |
| `minImpressionShare` | Minimum share of the ad group's impressions in % (`1` = 1 %) | `1` |
| `minCtr` | Minimum CTR in % (`0` = off) | `0` |
| `minCtrFactor` | Minimum CTR relative to the ad group (`0` = off) | `1` |
| `minConversions` | Minimum conversions | `0` |
| `matchType` | `exact` or `phrase` | `exact` |
| `maxNewKeywords` | Maximum new keywords of this rule per run | `20` |
| `mode` | `live` or `test` | `live` |
| `active` | `false` = ignore rule | `true` |

Pattern tips:

- Use the same positive pattern as in the Search Query Excluder – then both scripts work on the same definition of "relevant".
- Use `negativePattern` for terms that are relevant but should not become keywords of their own (`cheap|used|diy`).
- Test patterns on [regex101.com](https://regex101.com) (flavor: ECMAScript).

### Option A: rules in the script

```js
const SPREADSHEET_URL = '';
const RULES = [
  { campaignFilter: '%Generic%', positivePattern: 'shoe|sneaker', negativePattern: 'free|used', minClicks: 5, minCtrFactor: 1, matchType: 'exact' },
  { campaignFilter: 'Brand%',    positivePattern: 'mybrand|my brand', minConversions: 1, matchType: 'phrase', mode: 'test' }
];
```

Empty fields fall back to the defaults.

### Option B: rules in a Google Sheet

1. Create an empty Google Sheet (or use the sheet of the Search Query Excluder) and put its URL into `SPREADSHEET_URL`.
2. Run the script once – it creates the tab `kw_rules` with the header row.
3. Add one row per rule. Columns: `active | campaignFilter | positivePattern | negativePattern | dateRange | minImpressions | minClicks | minImpressionShare | minCtr | minCtrFactor | minConversions | matchType | maxNewKeywords | mode | notes`
4. From now on every run appends to the tab `kw_log`.

Column order does not matter, the script finds the columns by their header names. All tabs carry the prefix `kw_`, so the script can share the Google Sheet with the Search Query Excluder. Use one sheet per Google Ads account.

**Log tab and re-runs:** entries in `kw_log` with the action `ADDED`, `NOT_POSSIBLE` or `ERROR` count as processed and are not tried again. Delete a row to allow the term again. `WOULD_ADD` (dry run) does not block anything.

## Settings reference

| Setting | Default | Description |
|---|---|---|
| `DRY_RUN` | `true` | Report only, change nothing |
| `SPREADSHEET_URL` | `''` | Use rules from a Google Sheet |
| `NOTIFY_EMAILS` | – | Recipients of the summary e-mail |
| `SEND_EMAIL_IF_NOTHING_CHANGED` | `false` | Also send a mail when nothing happened |
| `EMAIL_LANGUAGE` | `'en'` | `'en'` or `'de'` |
| `EMAIL_MAX_KEYWORDS_PER_RULE` | `50` | Keywords listed per rule in the mail |
| `NEW_KEYWORDS_PAUSED` | `false` | Create new keywords paused |
| `MAX_NEW_KEYWORDS_PER_RUN` | `50` | Limit over all rules, the rest follows next run |
| `RESPECT_REMOVED_KEYWORDS` | `true` | Never re-add a removed keyword |
| `RESPECT_EXCLUDED_TERMS` | `true` | Skip terms excluded by negatives or by the Search Query Excluder |
| `EXCLUDER_LOG_SHEET` | `'log'` | Log tab of the Search Query Excluder in the same sheet |
| `MATCH_TRANSLITERATED` | `true` | ä/ö/ü/ß-tolerant pattern matching |

## Good to know

- Only search campaigns are considered. Keywords are only added to standard search ad groups; terms that appear only in dynamic search ad groups are ignored.
- Only search terms that Google reports in the *Search terms* report are considered (low-volume terms may be hidden by Google).
- A keyword is considered "existing" if the same text with the same match type exists anywhere in the account (enabled or paused). An `[exact]` keyword does not block a `"phrase"` keyword and vice versa.
- New keywords use the ad group's default bid and final URL.
- The script runs in a single account. For manager accounts (MCC) run it in each client account.

## Development

The script has no dependencies. Tests run with Node.js and mocked Google Ads objects:

```bash
node test/run-tests.js
```

The test writes previews of the e-mail to `test/output/`.

## License

[MIT](LICENSE) © 2026 [adtraffic](https://www.adtraffic.de)

Use at your own risk. Always start with `DRY_RUN = true`.
