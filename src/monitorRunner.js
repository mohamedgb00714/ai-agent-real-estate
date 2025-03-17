import { Actor, log } from 'apify';
import { processAllMonitors } from './scheduler.js';

// This file is meant to be run as a separate actor that periodically
// checks and processes all the real estate monitors

await Actor.init();

try {
    log.info('Starting real estate monitor runner');
    
    // Process all active monitors
    const result = await processAllMonitors();
    
    log.info('Monitor processing completed', result);
    
    // Store the result
    await Actor.pushData({
        runTime: new Date().toISOString(),
        processedCount: result.processed,
        updatedCount: result.updated,
        status: 'success'
    });
    
} catch (error) {
    log.error('Error during monitor runner execution:', error);
    
    // Store the error information
    await Actor.pushData({
        runTime: new Date().toISOString(),
        status: 'error',
        errorMessage: error.message
    });
    
    // Exit with error
    await Actor.exit(1);
} finally {
    await Actor.exit();
} 