# Changelog

## 1.0.0 – 2026-10-30

First public release as a single-account Google Ads script (based on an internal Microsoft Advertising MCC version).

- Rules in the script or in a Google Sheet (tabs `kw_rules` and `kw_log` are created automatically, shareable with the Search Query Excluder)
- Thresholds per rule: impressions, clicks, impression share in the ad group, CTR, CTR factor vs. ad group, conversions
- Positive and negative pattern, umlaut-tolerant matching
- Target ad group = standard search ad group with the most clicks for the term
- Ad group totals from the ad group report instead of the (incomplete) search terms report
- Dry run globally and per rule, HTML summary e-mail (en/de)
- Safety nets: existing keywords, removed keywords, excluded search terms, already processed terms, per-rule and per-run limits
- Search terms are read directly via GAQL – no report download or external API needed
