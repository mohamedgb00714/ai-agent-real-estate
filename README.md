# Real Estate Monitoring Agent

A powerful agent for searching, monitoring, and tracking real estate listings across multiple sources with a flexible pay-per-event pricing model.

## Features

- **Property Search**: Find real estate listings across multiple sources (Zillow, Realtor.com, Redfin)
- **Price Monitoring**: Set up alerts for price changes in specific areas
- **Natural Language Processing**: Use conversational queries to search for properties
- **Robust Fallback System**: Multi-tiered fallback mechanisms ensure data retrieval even when primary sources fail
- **Pay-Per-Event Pricing**: Only pay for the specific services you use

## How it works

The Real Estate Monitoring Agent follows these steps:

1. Accepts input with search criteria or monitoring configurations
2. Connects to specialized real estate data sources using Apify actors
3. If specialized actors fail, automatically falls back to a Puppeteer-based WebBrowser tool
4. Processes and returns standardized property data
5. For monitoring tasks, periodically checks for new listings matching your criteria

## Pay-Per-Event Model

This agent uses a flexible pricing model where you only pay for the specific services you use:

| Event | Description | Price (USD) |
|-------|-------------|-------------|
| `actor-start` | Starting the agent | $0.10 |
| `task-completed` | Completing a basic task | $0.40 |
| `listing-found` | Finding an individual property listing | $0.05 |
| `monitor-created` | Setting up a monitoring configuration | $0.20 |
| `monitor-alert` | Sending an alert when monitored properties change | $0.10 |
| `fallback-extraction` | Using advanced fallback extraction when primary sources fail | $0.30 |
| `premium-source` | Accessing premium real estate data sources | $0.50 |
| `data-volume` | Processing larger volumes of property data (per 100 properties) | $0.25 |

This approach ensures you only pay for the exact value you receive, with no wasted resources or unnecessary charges.

## Getting Started

The agent requires an Apify token to function properly. Set this in your environment variables:

```bash
export APIFY_TOKEN=your_apify_token
```

For OpenAI-based extraction capabilities, also set:

```bash
export OPENAI_API_KEY=your_openai_api_key
```

## Usage Examples

Find examples in the `examples` directory. Here are some common use cases:

### Search for Properties

```json
{
    "action": "search",
    "location": "Seattle, WA",
    "minPrice": 700000,
    "maxPrice": 1200000,
    "propertyType": "house",
    "bedrooms": 3,
    "bathrooms": 2,
    "maxResults": 5,
    "source": "zillow"
}
```

### Set Up Price Monitoring

```json
{
    "action": "monitor",
    "location": "Austin, TX",
    "minPrice": 500000,
    "maxPrice": 700000,
    "propertyType": "house",
    "bedrooms": 2,
    "frequency": "daily",
    "notificationEmail": "your@email.com"
}
```

### Check Monitor Status

```json
{
    "action": "check-monitor",
    "monitorId": "your-monitor-id"
}
```

### Natural Language Query

```json
{
    "modelName": "gpt-4",
    "query": "Find me houses for sale in Seattle under $800,000 with at least 2 bedrooms"
}
```

### Test Fallback Mechanism

```json
{
    "action": "search",
    "location": "Denver, CO",
    "minPrice": 400000,
    "maxPrice": 700000,
    "propertyType": "house",
    "bedrooms": 2,
    "bathrooms": 2,
    "maxResults": 5,
    "source": "zillow",
    "forceFallback": true
}
```

## Advanced Features

### Monitoring System

The monitoring system allows you to:

1. Create monitoring configurations for specific locations and criteria
2. Choose monitoring frequency (realtime, daily, weekly)
3. Receive alerts when new listings appear or prices change
4. Check the status of your monitors at any time

The monitor runner periodically checks for new listings matching your criteria and sends alerts when changes are detected. Each alert generates a small charge using the `monitor-alert` event.

### Fallback Mechanism

The agent implements a multi-tier fallback system to ensure reliable real estate data extraction:

1. **Primary Method**: Specialized Apify actors for real estate sites
2. **Secondary Fallback**: Puppeteer-based web browser automation
   - Utilizes headless Chrome to render JavaScript-heavy pages
   - Implements scroll behavior for lazy-loaded content
   - Waits for specific property elements to appear
   - Extracts structured data using advanced pattern recognition
3. **Tertiary Fallback**: Simple HTML scraping as a last resort

This ensures that the agent can provide property information even when primary data sources are blocked by anti-bot measures.

## Deploy to Apify

### Push project to Apify

You can deploy this project to Apify using the Apify CLI:

1. Log in to Apify. You will need to provide your [Apify API Token](https://console.apify.com/account/integrations) to complete this action.

    ```bash
    apify login
    ```

2. Deploy the Actor:

    ```bash
    apify push
    ```

## Additional Resources

To learn more about Apify and Actors, take a look at the following resources:

- [Apify SDK for JavaScript documentation](https://docs.apify.com/sdk/js)
- [Apify Platform documentation](https://docs.apify.com/platform)
- [Pay-per-event Monetization](https://docs.apify.com/sdk/js/docs/guides/pay-per-event)
- [Join our developer community on Discord](https://discord.com/invite/jyEM2PRvMU)
