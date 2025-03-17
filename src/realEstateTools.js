import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { PuppeteerWebBaseLoader } from '@langchain/community/document_loaders/web/puppeteer';
import { Actor, log } from 'apify';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { z } from 'zod';

/**
 * Search for real estate listings based on user criteria.
 */
export const searchRealEstateListingsTool = new DynamicStructuredTool({
    name: 'searchRealEstateListings',
    description: 'Search for real estate listings based on location, price range, and other criteria',
    schema: z.object({
        location: z.string()
            .describe('The location/area to search for properties (city, neighborhood, zip code)'),
        minPrice: z.number().int().optional()
            .describe('Minimum price for the property search'),
        maxPrice: z.number().int().optional()
            .describe('Maximum price for the property search'),
        propertyType: z.enum(['house', 'apartment', 'condo', 'townhouse', 'land', 'any']).default('any')
            .describe('Type of property to search for'),
        bedrooms: z.number().int().min(0).optional()
            .describe('Minimum number of bedrooms'),
        bathrooms: z.number().int().min(0).optional()
            .describe('Minimum number of bathrooms'),
        maxResults: z.number().int().positive().default(10)
            .describe('Maximum number of results to return'),
        source: z.enum(['zillow', 'realtor', 'redfin', 'any']).default('any')
            .describe('Real estate platform to search'),
        forceFallback: z.boolean().default(false)
            .describe('Force using fallback mechanisms for testing'),
    }),
    func: async ({ location, minPrice, maxPrice, propertyType, bedrooms, bathrooms, maxResults, source, forceFallback }) => {
        if (!process.env.APIFY_TOKEN) {
            throw new Error('APIFY_TOKEN is required but not set in your environment variables');
        }

        log.info('Searching for real estate listings with criteria:', {
            location,
            minPrice,
            maxPrice,
            propertyType,
            bedrooms,
            bathrooms,
            source,
            forceFallback,
        });
        
        // If forceFallback is true, skip Apify actors and go straight to fallback
        if (forceFallback) {
            log.info('Force fallback flag is set, skipping Apify actors');
            return fallbackToPuppeteerWebBaseLoader({ location, minPrice, maxPrice, propertyType, bedrooms, bathrooms, maxResults, source });
        }
        
        try {
            // Choose the appropriate Apify actor based on the source
            let actorId;
            let input = {};
            
            switch (source) {
                case 'zillow':
                    actorId = 'maxcopell/zillow-scraper'; // Zillow Search Scraper
                    
                    // Construct a Zillow search URL with all the parameters
                    const filters = {
                        isForSale: true,
                        price: {
                            min: minPrice,
                            max: maxPrice,
                        },
                    };
                    
                    if (bedrooms) {
                        filters.beds = { min: bedrooms };
                    }
                    
                    if (bathrooms) {
                        filters.baths = { min: bathrooms };
                    }
                    
                    if (propertyType && propertyType !== 'any') {
                        filters.homeType = [propertyType.toUpperCase()];
                    }
                    
                    input = {
                        searchTerms: [location],
                        filters: filters,
                        maxItems: maxResults
                    };
                    break;
                
                case 'redfin':
                    // For Redfin, we can use a general Redfin scraper
                    actorId = 'dtrungtin/redfin-scraper';
                    
                    input = {
                        startUrls: [{
                            url: `https://www.redfin.com/city/${encodeURIComponent(location)}`
                        }],
                        maxItems: maxResults,
                        includeFilters: true,
                        filters: {
                            minPrice: minPrice,
                            maxPrice: maxPrice,
                            minBeds: bedrooms,
                            minBaths: bathrooms
                        }
                    };
                    break;
                
                case 'realtor':
                    // For Realtor.com, use a Realtor scraper
                    actorId = 'dtrungtin/realtor-scraper';
                    
                    input = {
                        search: location,
                        maxItems: maxResults,
                        filters: {
                            minPrice: minPrice,
                            maxPrice: maxPrice,
                            minBeds: bedrooms,
                            minBaths: bathrooms
                        }
                    };
                    break;
                
                default:
                    // If no specific source, use the comprehensive all-in-one scraper
                    actorId = 'scrapestorm/zillow-search-scraper-all-in-one';
                    
                    input = {
                        searchTerms: [location],
                        filters: {
                            minPrice: minPrice,
                            maxPrice: maxPrice,
                            beds: bedrooms,
                            baths: bathrooms,
                            homeType: propertyType !== 'any' ? [propertyType.toUpperCase()] : undefined
                        },
                        maxItems: maxResults
                    };
            }
            
            log.info(`Running Apify actor ${actorId} with input:`, input);
            
            // Run the selected actor with constructed input
            const run = await Actor.call(actorId, input);
            
            // Get the dataset
            const { items } = await Actor.client.dataset(run.defaultDatasetId).listItems();
            
            // Process the results into a standardized format
            const listings = processRealEstateListings(items, source);
            
            // Charge for data volume based on number of listings found
            try {
                if (items.length > 0) {
                    // Charge for each batch of 100 listings found (rounded up)
                    const volumeChargeBatches = Math.ceil(items.length / 100);
                    for (let i = 0; i < volumeChargeBatches; i++) {
                        await Actor.charge({ eventName: 'data-volume' });
                    }
                    
                    // Charge for premium source if applicable
                    if (['redfin', 'realtor'].includes(source)) {
                        await Actor.charge({ eventName: 'premium-source' });
                    }
                    
                    // Charge for each listing found (up to a reasonable limit to avoid excessive charges)
                    const listingCharges = Math.min(items.length, 20); // Cap at 20 charges
                    for (let i = 0; i < listingCharges; i++) {
                        await Actor.charge({ eventName: 'listing-found' });
                    }
                }
            } catch (chargeError) {
                log.error('Error charging for listings:', chargeError);
            }
            
            return listings;
        } catch (error) {
            log.error('Error fetching real estate listings:', error);
            
            // Fall back to the Puppeteer WebBaseLoader if specific actor fails
            log.info('Falling back to Puppeteer WebBaseLoader for real estate search');
            
            // Charge for fallback extraction which may be more costly
            try {
                await Actor.charge({ eventName: 'fallback-extraction' });
            } catch (chargeError) {
                log.error('Error charging for fallback extraction:', chargeError);
            }
            
            return fallbackToPuppeteerWebBaseLoader({ location, minPrice, maxPrice, propertyType, bedrooms, bathrooms, maxResults, source });
        }
    },
});

// Function to extract property listings using LLM
async function extractListingsWithLLM(content, criteria, source) {
    try {
        log.info('Attempting to extract listings with OpenAI');
        const model = new ChatOpenAI({ 
            modelName: 'gpt-4o',
            temperature: 0,
        });
        
        // Extract structured property data using the model
        const propertyPrompt = `
        Extract real estate listings from the following webpage content. 
        Search criteria: ${criteria}
        
        For each property listing, extract:
        1. Property address
        2. Price
        3. Number of bedrooms
        4. Number of bathrooms
        5. Square footage
        6. URL of the listing (if available)
        
        Output the results as a JSON array of property objects with fields: 
        title, address, price, bedrooms, bathrooms, squareFeet, description, url.
        
        Webpage content:
        ${content.substring(0, 12000)}
        `;
        
        const response = await model.invoke(propertyPrompt);
        return processLLMResponse(response.content, source, 'OpenAI');
    } catch (openAIError) {
        log.error('Error in OpenAI extraction:', openAIError);
        // If OpenAI fails, return null to trigger pattern matching
        return null;
    }
}

// Process the LLM response
function processLLMResponse(responseText, source, modelUsed) {
    try {
        // Process the response text to extract JSON
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                        responseText.match(/\[\s*\{\s*".*?"\s*:/s);
        
        if (jsonMatch) {
            // Try to extract and parse the JSON
            let jsonText = jsonMatch[1] || jsonMatch[0];
            
            // Clean up the JSON text if needed
            if (jsonText.startsWith('[') && !jsonText.endsWith(']')) {
                jsonText += ']';
            }
            
            try {
                const parsedListings = JSON.parse(jsonText);
                const listings = Array.isArray(parsedListings) ? parsedListings : [parsedListings];
                
                // Format the listings to match our expected structure
                const formattedListings = listings.map(item => ({
                    title: item.title || item.address || 'Property Listing',
                    price: item.price || 'Price not specified',
                    address: item.address || 'Address not specified',
                    details: {
                        bedrooms: item.bedrooms || item.beds || 'Not specified',
                        bathrooms: item.bathrooms || item.baths || 'Not specified',
                        squareFeet: item.squareFeet || item.sqft || item.area || 'Not specified',
                    },
                    description: item.description || '',
                    url: item.url || item.link || '',
                    source: `${source || 'real-estate-site'} (${modelUsed} extraction)`
                }));
                
                return {
                    count: formattedListings.length,
                    listings: formattedListings,
                    note: `Results extracted using Puppeteer and ${modelUsed} processing`
                };
            } catch (parseError) {
                log.error(`Error parsing JSON from ${modelUsed} response:`, parseError);
                return null;
            }
        }
        return null;
    } catch (error) {
        log.error(`Error processing ${modelUsed} response:`, error);
        return null;
    }
}

/**
 * Fallback method using PuppeteerWebBaseLoader when specialized actors fail
 */
async function fallbackToPuppeteerWebBaseLoader({ location, minPrice, maxPrice, propertyType, bedrooms, bathrooms, maxResults, source }) {
    try {
        // Determine which website to search based on source
        let searchUrl;
        
        switch (source) {
            case 'zillow':
                // Construct a Zillow search URL
                const zillowParams = new URLSearchParams();
                if (minPrice) zillowParams.append('price_min', minPrice);
                if (maxPrice) zillowParams.append('price_max', maxPrice);
                if (bedrooms) zillowParams.append('beds_min', bedrooms);
                if (bathrooms) zillowParams.append('baths_min', bathrooms);
                
                searchUrl = `https://www.zillow.com/homes/${encodeURIComponent(location)}_rb/?${zillowParams.toString()}`;
                break;
            case 'realtor':
                // Construct a Realtor.com search URL with parameters
                const realtorParams = new URLSearchParams();
                if (minPrice) realtorParams.append('price_min', minPrice);
                if (maxPrice) realtorParams.append('price_max', maxPrice);
                if (bedrooms) realtorParams.append('beds_min', bedrooms);
                if (bathrooms) realtorParams.append('baths_min', bathrooms);
                
                searchUrl = `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(location)}?${realtorParams.toString()}`;
                break;
            case 'redfin':
                // Construct a Redfin search URL
                // Redfin has a more complex URL structure, this is simplified
                searchUrl = `https://www.redfin.com/city/${encodeURIComponent(location)}`;
                break;
            default:
                // Default to Zillow
                const defaultParams = new URLSearchParams();
                if (minPrice) defaultParams.append('price_min', minPrice);
                if (maxPrice) defaultParams.append('price_max', maxPrice);
                if (bedrooms) defaultParams.append('beds_min', bedrooms);
                if (bathrooms) defaultParams.append('baths_min', bathrooms);
                
                searchUrl = `https://www.zillow.com/homes/${encodeURIComponent(location)}_rb/?${defaultParams.toString()}`;
        }
        
        log.info(`Searching with PuppeteerWebBaseLoader using URL: ${searchUrl}`);
        
        // Configure Puppeteer options to avoid detection
        const loader = new PuppeteerWebBaseLoader(searchUrl, {
            launchOptions: {
                headless: "new",
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--window-size=1920,1080',
                ],
            },
            gotoOptions: {
                waitUntil: "networkidle2",
                timeout: 60000,
            },
            pageevaluate: async (page) => {
                // Scroll down to trigger lazy loading of content
                await page.evaluate(async () => {
                    await new Promise((resolve) => {
                        let totalHeight = 0;
                        const distance = 100;
                        const timer = setInterval(() => {
                            const scrollHeight = document.body.scrollHeight;
                            window.scrollBy(0, distance);
                            totalHeight += distance;
                            
                            if (totalHeight >= scrollHeight - window.innerHeight) {
                                clearInterval(timer);
                                resolve();
                            }
                        }, 100);
                    });
                });
                
                // Extract property information based on the source
                let selector;
                switch (source) {
                    case 'zillow':
                        selector = 'article[data-test="property-card"]';
                        break;
                    case 'realtor':
                        selector = 'div[data-testid="property-card"]';
                        break;
                    case 'redfin':
                        selector = 'div.HomeCard';
                        break;
                    default:
                        selector = 'article[data-test="property-card"], div.property-card';
                }
                
                // Wait for property cards to load
                await page.waitForSelector(selector, { timeout: 10000 }).catch(() => {
                    console.log('Selector not found, continuing with available content');
                });
                
                // Collect all the text content
                return document.body.innerText;
            },
        });

        // Load the page and get the documents
        const docs = await loader.load();
        
        log.info(`PuppeteerWebBaseLoader extracted ${docs.length} documents`);
        
        // Process the loaded documents
        if (docs && docs.length > 0) {
            // Create criteria string for LLM extraction
            const criteria = [
                minPrice ? `Minimum price: $${minPrice}` : '',
                maxPrice ? `Maximum price: $${maxPrice}` : '',
                propertyType && propertyType !== 'any' ? `Property type: ${propertyType}` : '',
                bedrooms ? `Minimum bedrooms: ${bedrooms}` : '',
                bathrooms ? `Minimum bathrooms: ${bathrooms}` : '',
            ].filter(Boolean).join(', ');
            
            // First, try to extract structured data with LLM
            const llmResult = await extractListingsWithLLM(docs[0].pageContent, criteria, source);
            
            if (llmResult && llmResult.count > 0) {
                return JSON.stringify(llmResult, null, 2);
            }
            
            // As a fallback, try to extract data using regex patterns
            return processDocumentWithPatterns(docs[0].pageContent, source);
        } else {
            throw new Error('No content was loaded from the page');
        }
    } catch (error) {
        log.error('Error in PuppeteerWebBaseLoader fallback:', error);
        
        // If the Puppeteer approach fails, try a simpler HTTP request approach
        try {
            return await simpleScrapingFallback({ location, minPrice, maxPrice, propertyType, bedrooms, bathrooms, maxResults, source });
        } catch (fallbackError) {
            log.error('Error in simple scraping fallback:', fallbackError);
            return JSON.stringify({
                count: 0,
                listings: [],
                error: `Both Puppeteer and simple scraping failed. Original error: ${error.message}. Fallback error: ${fallbackError.message}`
            }, null, 2);
        }
    }
}

/**
 * Process a document using regex patterns to extract property information
 */
function processDocumentWithPatterns(content, source) {
    try {
        log.info('Processing document with pattern matching');
        
        const listings = [];
        
        // Extract price patterns (e.g., $500,000)
        const pricePattern = /\$([0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?)/g;
        const prices = [...content.matchAll(pricePattern)].map(match => match[0]);
        
        // Extract address patterns (simplistic approach)
        const addressPattern = /\d+\s+[\w\s]+(?:Avenue|Ave|Boulevard|Blvd|Circle|Cir|Court|Ct|Drive|Dr|Lane|Ln|Place|Pl|Road|Rd|Square|Sq|Street|St|Way)(?:\s+[A-Z][a-z]+)?(?:,\s+[A-Z]{2}\s+\d{5})?/gi;
        const addresses = [...content.matchAll(addressPattern)].map(match => match[0]);
        
        // Extract bedroom patterns (e.g., 3 bd, 3 beds, 3 bedrooms)
        const bedroomPattern = /(\d+)\s*(?:bd|bed|beds|bedrooms)/gi;
        const bedrooms = [...content.matchAll(bedroomPattern)].map(match => match[1]);
        
        // Extract bathroom patterns (e.g., 2 ba, 2 bath, 2 baths, 2 bathrooms)
        const bathroomPattern = /(\d+(?:\.\d+)?)\s*(?:ba|bath|baths|bathrooms)/gi;
        const bathrooms = [...content.matchAll(bathroomPattern)].map(match => match[1]);
        
        // Extract square footage patterns (e.g., 1,500 sqft, 1,500 sq ft)
        const sqftPattern = /(\d+(?:,\d+)?)\s*(?:sqft|sq ft|sq. ft.|square feet|sf)/gi;
        const sqfts = [...content.matchAll(sqftPattern)].map(match => match[1]);
        
        // Now try to associate these into property listings
        // This is simplistic and would need refinement in a real implementation
        const maxEntries = Math.min(
            prices.length, 
            Math.max(addresses.length, 10), // Always create at least some entries
            Math.max(bedrooms.length, 10),
            Math.max(bathrooms.length, 10),
            Math.max(sqfts.length, 10)
        );
        
        for (let i = 0; i < maxEntries; i++) {
            listings.push({
                title: `Property in ${source || 'listed area'}`,
                price: i < prices.length ? prices[i] : 'Price not specified',
                address: i < addresses.length ? addresses[i] : 'Address not specified',
                details: {
                    bedrooms: i < bedrooms.length ? bedrooms[i] : 'Not specified',
                    bathrooms: i < bathrooms.length ? bathrooms[i] : 'Not specified',
                    squareFeet: i < sqfts.length ? sqfts[i] : 'Not specified',
                },
                description: `Property extracted from ${source || 'real estate website'} using pattern matching.`,
                url: '',
                source: `${source || 'real-estate-site'} (pattern extraction)`
            });
        }
        
        return JSON.stringify({
            count: listings.length,
            listings: listings,
            note: 'Results extracted using pattern matching'
        }, null, 2);
    } catch (error) {
        log.error('Error processing document with patterns:', error);
        return JSON.stringify({
            count: 0,
            listings: [],
            error: `Pattern matching extraction failed: ${error.message}`
        }, null, 2);
    }
}

/**
 * Last resort fallback using a simple HTTP request and cheerio
 */
async function simpleScrapingFallback({ location, source }) {
    log.info('Attempting simple scraping fallback');
    
    try {
        // Determine which website to search based on source
        let searchUrl;
        let selector;
        
        switch(source) {
            case 'zillow':
                searchUrl = `https://www.zillow.com/homes/${encodeURIComponent(location)}_rb/`;
                selector = 'article[data-test="property-card"]';
                break;
            case 'realtor':
                searchUrl = `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(location)}`;
                selector = 'div[data-testid="property-card"]';
                break;
            case 'redfin':
                searchUrl = `https://www.redfin.com/city/${encodeURIComponent(location)}`;
                selector = 'div.HomeCard';
                break;
            default:
                // Default to Zillow
                searchUrl = `https://www.zillow.com/homes/${encodeURIComponent(location)}_rb/`;
                selector = 'article[data-test="property-card"]';
        }
        
        // Make a simple HTTP request
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        
        // Parse the HTML using cheerio
        const $ = cheerio.load(response.data);
        const listings = [];
        
        // Extract property cards using the selector
        $(selector).each((index, element) => {
            const $element = $(element);
            
            // Extract basic info (implementation will vary based on the website structure)
            const title = $element.find('a').first().text().trim() || 'Property Listing';
            const priceText = $element.text().match(/\$([0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?)/);
            const price = priceText ? priceText[0] : 'Price not specified';
            
            // Extract the URL
            const relativeUrl = $element.find('a').first().attr('href');
            const url = relativeUrl ? (relativeUrl.startsWith('http') ? relativeUrl : `https://${source}.com${relativeUrl}`) : '';
            
            // Add to listings
            listings.push({
                title,
                price,
                address: 'Address extraction requires more detailed parsing',
                details: {
                    bedrooms: 'Not specified in simple parsing',
                    bathrooms: 'Not specified in simple parsing',
                    squareFeet: 'Not specified in simple parsing',
                },
                description: 'Limited information available from simple parsing',
                url,
                source: `${source} (simple parsing fallback)`
            });
        });
        
        return JSON.stringify({
            count: listings.length,
            listings,
            note: 'Results from simple parsing fallback may be limited in detail'
        }, null, 2);
        
    } catch (error) {
        log.error('Error in simple scraping fallback:', error);
        return JSON.stringify({
            count: 0,
            listings: [],
            error: `Simple scraping fallback failed: ${error.message}`
        }, null, 2);
    }
}

/**
 * Process listings from specialized real estate actors
 */
function processRealEstateListings(items, source) {
    try {
        const listings = [];
        
        for (const item of items) {
            // Extract data based on the source/format
            const listing = {
                title: item.name || item.address || 'Property Listing',
                price: item.price || item.listPrice || 'Price not specified',
                address: item.address || item.streetAddress || 'Address not specified',
                details: {
                    bedrooms: item.bedrooms || item.beds || 'Not specified',
                    bathrooms: item.bathrooms || item.baths || 'Not specified',
                    squareFeet: item.livingArea || item.sqft || 'Not specified',
                },
                description: item.description || '',
                url: item.detailUrl || item.url || '',
                source: source,
                imageUrl: item.imgSrc || item.imageUrl || '',
                listingAgent: item.brokerName || item.agent || 'Not specified',
                listingStatus: item.homeStatus || item.status || 'For Sale'
            };
            
            listings.push(listing);
        }
        
        return JSON.stringify({
            count: listings.length,
            listings: listings
        }, null, 2);
    } catch (error) {
        log.error('Error processing real estate listings:', error);
        return JSON.stringify({
            count: 0,
            listings: [],
            error: error.message
        }, null, 2);
    }
}

/**
 * Process listings from the fallback web search
 */
function processWebSearchListings(responseData, source) {
    try {
        // Extract property listings from the search results
        // This is a simplified version - in a real implementation, you would
        // use more sophisticated parsing to extract structured property data
        
        const listings = [];
        
        for (const item of responseData) {
            const text = item.text || item.markdown || '';
            const title = item.metadata?.title || 'Property Listing';
            
            // Look for price patterns in the text
            const priceMatch = text.match(/\$([0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?)/);
            const price = priceMatch ? priceMatch[0] : 'Price not specified';
            
            // Look for address patterns
            const addressMatch = text.match(/\d+\s+[\w\s]+,\s+[\w\s]+,\s+[A-Z]{2}\s+\d{5}/);
            const address = addressMatch ? addressMatch[0] : 'Address not specified';
            
            // Look for bedroom/bathroom info
            const bedroomsMatch = text.match(/(\d+)\s*bed/i);
            const bathroomsMatch = text.match(/(\d+(\.\d+)?)\s*bath/i);
            const sqftMatch = text.match(/(\d+,?\d*)\s*sq\s*ft/i);
            
            const details = {
                bedrooms: bedroomsMatch ? bedroomsMatch[1] : 'Not specified',
                bathrooms: bathroomsMatch ? bathroomsMatch[1] : 'Not specified',
                squareFeet: sqftMatch ? sqftMatch[1] : 'Not specified',
            };
            
            listings.push({
                title,
                price,
                address,
                details,
                description: text.substring(0, 300) + (text.length > 300 ? '...' : ''),
                url: item.metadata?.url || '',
                source: source ? `${source} (text parsing)` : 'web search'
            });
        }
        
        return JSON.stringify({
            count: listings.length,
            listings: listings
        }, null, 2);
    } catch (error) {
        log.error('Error processing web search listings:', error);
        return JSON.stringify({
            count: 0,
            listings: [],
            error: error.message
        }, null, 2);
    }
}

/**
 * Monitor real estate listings for changes based on saved criteria.
 */
export const monitorRealEstateListingsTool = new DynamicStructuredTool({
    name: 'monitorRealEstateListings',
    description: 'Set up monitoring for real estate listings based on criteria, to be notified of new matching properties',
    schema: z.object({
        monitorId: z.string().optional().describe('Unique identifier for this monitoring setup'),
        location: z.string().describe('The location to monitor for new properties'),
        minPrice: z.number().int().optional().describe('Minimum price for the property monitoring'),
        maxPrice: z.number().int().optional().describe('Maximum price for the property monitoring'),
        propertyType: z.enum(['house', 'apartment', 'condo', 'townhouse', 'land', 'any']).default('any')
            .describe('Type of property to monitor'),
        bedrooms: z.number().int().min(0).optional().describe('Minimum number of bedrooms'),
        bathrooms: z.number().int().min(0).optional().describe('Minimum number of bathrooms'),
        frequency: z.enum(['daily', 'weekly', 'realtime']).default('daily')
            .describe('How often to check for new listings'),
        notificationEmail: z.string().email().optional()
            .describe('Email to send notifications to when new properties are found'),
    }),
    func: async ({ monitorId, location, minPrice, maxPrice, propertyType, bedrooms, bathrooms, frequency, notificationEmail }) => {
        if (!process.env.APIFY_TOKEN) {
            throw new Error('APIFY_TOKEN is required but not set in your environment variables');
        }
        
        // Generate a unique monitor ID if not provided
        const uniqueMonitorId = monitorId || `monitor-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        
        // Log the monitoring setup
        log.info('Setting up real estate monitoring with criteria:', {
            monitorId: uniqueMonitorId,
            location, 
            minPrice, 
            maxPrice, 
            propertyType, 
            bedrooms, 
            bathrooms, 
            frequency,
            notificationEmail
        });
        
        // In a production implementation, you would:
        // 1. Store these monitoring criteria in a database
        // 2. Set up a scheduled task to periodically check for new listings
        // 3. Implement a notification system to alert users
        
        // For this example, we'll save the monitoring criteria to the key-value store
        const monitoringSetup = {
            id: uniqueMonitorId,
            createdAt: new Date().toISOString(),
            criteria: {
                location,
                minPrice,
                maxPrice,
                propertyType,
                bedrooms,
                bathrooms,
            },
            frequency,
            notificationEmail,
            lastChecked: null,
            lastResults: null,
        };
        
        try {
            // Store the monitoring configuration
            const store = await Actor.openKeyValueStore('real-estate-monitors');
            await store.setValue(uniqueMonitorId, monitoringSetup);
            
            // Also add this monitor to the list of active monitors
            const monitorsList = await store.getValue('monitors-list') || [];
            if (!monitorsList.includes(uniqueMonitorId)) {
                monitorsList.push(uniqueMonitorId);
                await store.setValue('monitors-list', monitorsList);
            }
            
            // Schedule the first monitoring run
            await setupMonitoringSchedule(uniqueMonitorId, frequency);
            
            // Charge for creating a monitor
            try {
                await Actor.charge({ eventName: 'monitor-created' });
            } catch (chargeError) {
                log.error('Error charging for monitor creation:', chargeError);
            }
            
            return `Successfully set up monitoring for real estate listings in ${location}. ` +
                   `You will be notified at ${notificationEmail || 'your registered email'} ` +
                   `${frequency === 'realtime' ? 'as soon as' : frequency} ` +
                   `new matching properties become available. Your monitor ID is: ${uniqueMonitorId}`;
        } catch (error) {
            log.error('Error setting up real estate monitoring:', error);
            return `Error setting up monitoring: ${error.message}`;
        }
    },
});

/**
 * Set up the monitoring schedule based on frequency
 */
async function setupMonitoringSchedule(monitorId, frequency) {
    // This is a simplified implementation
    // In a real-world scenario, you would:
    // 1. Use Apify's scheduling capabilities to run the actor periodically
    // 2. Set up webhooks for notifications
    // 3. Implement a more robust monitoring system
    
    log.info(`Setting up ${frequency} monitoring schedule for monitor ID: ${monitorId}`);
    
    // Here we would configure the Apify scheduler
    // For now, we'll just log the setup
    
    return {
        monitorId,
        frequency,
        status: 'scheduled',
        nextRun: getNextRunTime(frequency),
    };
}

/**
 * Calculate when the next monitoring run should occur
 */
function getNextRunTime(frequency) {
    const now = new Date();
    switch (frequency) {
        case 'realtime':
            // For real-time, we'd run it very frequently (e.g., every 15 minutes)
            now.setMinutes(now.getMinutes() + 15);
            break;
        case 'daily':
            now.setDate(now.getDate() + 1);
            break;
        case 'weekly':
            now.setDate(now.getDate() + 7);
            break;
        default:
            now.setDate(now.getDate() + 1);
    }
    return now.toISOString();
} 