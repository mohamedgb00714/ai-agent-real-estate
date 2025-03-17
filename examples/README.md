# Real Estate Agent Examples

This directory contains example input files that can be used with the Real Estate Monitoring Agent.

## How to use these examples

1. Choose an example file from this directory
2. Copy it to the input file location: `cp examples/zillow-search.json storage/key_value_stores/default/INPUT.json`
3. Run the agent: `apify run`

## Available Examples

- **zillow-search.json** - Search for houses in Seattle using Zillow
- **monitor.json** - Set up monitoring for properties in Austin
- **check-monitor.json** - Check the status of an existing monitor
- **natural-language.json** - Use natural language to search for properties
- **fallback-test.json** - Test the Puppeteer-based fallback functionality

## Fallback Mechanism

The Real Estate Monitoring Agent now includes a robust multi-tier fallback mechanism that ensures reliability:

1. Fall back to Puppeteer-based web browsing to directly access real estate websites
   - Uses a full Chrome browser to render JavaScript-heavy pages
   - Implements scrolling to load lazy-loaded content
   - Waits for property card elements to appear

2. Extract property information using multiple approaches:
   - OpenAI GPT-4o extraction as primary method
   - Pattern-based extraction using regular expressions as a backup

3. If the Puppeteer approach fails, a simple HTTP request with Cheerio will be used as a last resort

This multi-layered fallback system ensures that the agent will return useful information even when specific data sources are unavailable.

## API Keys

To take advantage of all fallback options, set the following environment variables:

```bash
# Required for primary functionality
export APIFY_TOKEN=your_apify_token

# Required for OpenAI extraction
export OPENAI_API_KEY=your_openai_api_key
``` 