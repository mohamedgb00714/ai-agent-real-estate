import { Actor, log } from 'apify';
import { searchRealEstateListingsTool } from './realEstateTools.js';

/**
 * Process all active monitors and check for new listings
 */
export async function processAllMonitors() {
    await Actor.init();
    
    try {
        log.info('Starting scheduled processing of real estate monitors');
        
        // Open the KV store with monitor configurations
        const store = await Actor.openKeyValueStore('real-estate-monitors');
        const monitorsList = await store.getValue('monitors-list') || [];
        
        if (!monitorsList.length) {
            log.info('No active monitors found');
            return { processed: 0, updated: 0 };
        }
        
        log.info(`Found ${monitorsList.length} active monitors to process`);
        
        const now = new Date();
        let processedCount = 0;
        let updatedCount = 0;
        
        // Process each monitor
        for (const monitorId of monitorsList) {
            try {
                const monitorConfig = await store.getValue(monitorId);
                
                if (!monitorConfig) {
                    log.warning(`Monitor ${monitorId} not found but was in the list`);
                    continue;
                }
                
                // Check if it's time to run this monitor based on frequency
                const shouldRun = shouldRunMonitor(monitorConfig, now);
                
                if (!shouldRun) {
                    log.info(`Skipping monitor ${monitorId} as it's not scheduled to run yet`);
                    continue;
                }
                
                log.info(`Processing monitor ${monitorId} for ${monitorConfig.criteria.location}`);
                
                // Search for current listings
                const searchResult = await searchRealEstateListingsTool.invoke({
                    location: monitorConfig.criteria.location,
                    minPrice: monitorConfig.criteria.minPrice,
                    maxPrice: monitorConfig.criteria.maxPrice,
                    propertyType: monitorConfig.criteria.propertyType,
                    bedrooms: monitorConfig.criteria.bedrooms,
                    bathrooms: monitorConfig.criteria.bathrooms,
                    maxResults: 20,
                    source: 'any'
                });
                
                // Parse the search results
                const parsedResult = JSON.parse(searchResult);
                
                // Compare with previous results to find new listings
                const newListings = findNewListings(
                    parsedResult.listings,
                    monitorConfig.lastResults ? JSON.parse(monitorConfig.lastResults).listings : []
                );
                
                processedCount++;
                
                // If there are new listings, notify the user
                if (newListings.length > 0) {
                    log.info(`Found ${newListings.length} new listings for monitor ${monitorId}`);
                    await notifyUser(monitorConfig, newListings);
                    updatedCount++;
                } else {
                    log.info(`No new listings found for monitor ${monitorId}`);
                }
                
                // Update the monitor with latest results and timestamp
                monitorConfig.lastChecked = now.toISOString();
                monitorConfig.lastResults = searchResult;
                monitorConfig.nextRun = getNextRunTime(monitorConfig.frequency);
                
                // Save the updated monitor
                await store.setValue(monitorId, monitorConfig);
                
            } catch (error) {
                log.error(`Error processing monitor ${monitorId}:`, error);
            }
        }
        
        log.info(`Completed processing monitors. Processed: ${processedCount}, Updated: ${updatedCount}`);
        return { processed: processedCount, updated: updatedCount };
        
    } catch (error) {
        log.error('Error during monitor processing:', error);
        throw error;
    } finally {
        await Actor.exit();
    }
}

/**
 * Determine if a monitor should run now based on its frequency and last run time
 */
function shouldRunMonitor(monitorConfig, currentTime) {
    // If it has never been run, run it now
    if (!monitorConfig.lastChecked) {
        return true;
    }
    
    const lastChecked = new Date(monitorConfig.lastChecked);
    const hoursSinceLastCheck = (currentTime - lastChecked) / (1000 * 60 * 60);
    
    // Determine how often to run based on frequency
    switch (monitorConfig.frequency) {
        case 'realtime':
            // Run every 15 minutes
            return hoursSinceLastCheck >= 0.25;
        case 'daily':
            // Run every 24 hours
            return hoursSinceLastCheck >= 24;
        case 'weekly':
            // Run every 7 days
            return hoursSinceLastCheck >= 168;
        default:
            // Default to daily
            return hoursSinceLastCheck >= 24;
    }
}

/**
 * Calculate the next run time based on frequency
 */
function getNextRunTime(frequency) {
    const now = new Date();
    switch (frequency) {
        case 'realtime':
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

/**
 * Find new listings by comparing current results with previous results
 */
function findNewListings(currentListings, previousListings) {
    if (!previousListings || !previousListings.length) {
        return currentListings;
    }
    
    // Create a set of existing listing URLs for faster lookup
    const existingUrls = new Set(previousListings.map(listing => listing.url));
    
    // Filter out listings that already existed
    return currentListings.filter(listing => !existingUrls.has(listing.url));
}

/**
 * Notify user about new listings
 */
async function notifyUser(monitorConfig, newListings) {
    // In a real implementation, you would:
    // 1. Send an email to the user
    // 2. Push notification to a webhook
    // 3. Send SMS or other notification
    
    // For this example, we'll just log the notification
    log.info(`Would notify ${monitorConfig.notificationEmail || 'user'} about ${newListings.length} new listings`);
    
    // Charge for sending a monitor alert
    try {
        await Actor.charge({ eventName: 'monitor-alert' });
        log.info('Charged for monitor alert');
    } catch (chargeError) {
        log.error('Error charging for monitor alert:', chargeError);
    }
    
    // If email is configured, would send an email here
    if (monitorConfig.notificationEmail) {
        log.info(`Email would be sent to: ${monitorConfig.notificationEmail}`);
        // This would integrate with an email service like SendGrid, Mailchimp, etc.
    }
    
    // For debugging, log the first new listing
    if (newListings.length > 0) {
        log.info('Example new listing:', newListings[0]);
    }
    
    return {
        sentTo: monitorConfig.notificationEmail || 'console',
        count: newListings.length,
        monitorId: monitorConfig.id,
    };
}

// When this file is run directly (e.g., by a scheduler)
if (import.meta.url === import.meta.main) {
    await processAllMonitors();
} 