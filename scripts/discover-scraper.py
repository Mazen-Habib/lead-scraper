#!/usr/bin/env python3
"""
Dev-time utility only — never called by the production pipeline (src/index.js
never imports or spawns this). Speeds up writing a NEW scraper for a directory
we haven't covered yet: give it a URL and one or more sample values you can
see on the page, and AutoScraper learns the CSS/XPath rules that extract them.
Take the printed rules and port them into a proper src/scrapers/*.js file the
same way every existing scraper works (fetch/cloak_browser -> cheerio -> leads[]).

Requires (not part of the project's runtime deps — install only if you use this):
  pip install autoscraper

Usage:
  python scripts/discover-scraper.py <url> <sample_value_1> [sample_value_2 ...]

Example:
  python scripts/discover-scraper.py \\
    "https://somedirectory.com/companies/uae" \\
    "Acme Software Solutions"
"""
import sys


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    try:
        from autoscraper import AutoScraper
    except ImportError:
        print('autoscraper not installed — run: pip install autoscraper')
        sys.exit(1)

    url = sys.argv[1]
    wanted = sys.argv[2:]

    scraper = AutoScraper()
    result = scraper.build(url, wanted_list=wanted)

    print(f'\nLearned {len(scraper.stack_list)} rule(s) from {len(wanted)} sample(s).\n')
    print('Similar results found on this page:')
    for r in result:
        print(f'  - {r}')

    rules_file = 'discovered-scraper-rules.json'
    scraper.save(rules_file)
    print(f'\nRules saved to {rules_file}.')
    print('Inspect scraper.stack_list to see the actual CSS paths/attributes learned,')
    print('then port the matching selectors into a new src/scrapers/<name>.js file')
    print('using cheerio, following the pattern of an existing scraper.')


if __name__ == '__main__':
    main()
