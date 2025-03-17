import { HumanMessage } from '@langchain/core/messages';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { Actor, log } from 'apify';

import { searchRealEstateListingsTool, monitorRealEstateListingsTool } from './realEstateTools.js';

await Actor.init();

try {
    log.info(`Charging Actor start event.`);
    await Actor.charge({ eventName: 'actor-start' });
} catch (error) {
    log.error('Failed to charge for actor start event', { error });
    await Actor.exit(1);
}

// Follow these steps to run this template:
// 1. If running locally, authenticate to the Apify platform by executing `apify login` in your terminal.
//    This is necessary to run the Website Content Crawler Actor for data gathering.
// 2. Set the `OPENAI_API_KEY` environment variable with your OpenAI API key, which can be obtained from
//    https://platform.openai.com/account/api-keys. Refer to
//    https://docs.apify.com/cli/docs/vars#set-up-environment-variables-in-apify-console for guidance
//    on setting environment variables.
const { OPENAI_API_KEY, APIFY_TOKEN } = process.env;

// You can configure the input for the Actor in the Apify UI when running on the Apify platform or editing
// storage/key_value_stores/default/INPUT.json when running locally.
const { 
    query, 
    modelName, 
    action, 
    monitorId, 
    location, 
    minPrice, 
    maxPrice, 
    propertyType, 
    bedrooms, 
    bathrooms, 
    frequency, 
    notificationEmail 
} = await Actor.getInput() || {};

if (!OPENAI_API_KEY) throw new Error('Please configure the OPENAI_API_KEY as environment variable or enter it into the input!');
if (!APIFY_TOKEN) throw new Error('Please configure the APIFY_TOKEN environment variable! Call `apify login` in your terminal to authenticate.');

// Create a function to process specific real estate actions directly
async function processRealEstateAction(action, params) {
    log.info(`Processing real estate action: ${action}`);
    
    switch(action) {
        case 'search':
            // Search for real estate listings directly
            return await searchRealEstateListingsTool.invoke({
                location: params.location,
                minPrice: params.minPrice,
                maxPrice: params.maxPrice,
                propertyType: params.propertyType,
                bedrooms: params.bedrooms,
                bathrooms: params.bathrooms,
                maxResults: params.maxResults || 10,
                source: params.source || 'any',
                forceFallback: params.forceFallback || false // Force Puppeteer-based fallback for testing
            });
            
        case 'monitor':
            // Set up monitoring for real estate listings
            return await monitorRealEstateListingsTool.invoke({
                monitorId: params.monitorId,
                location: params.location,
                minPrice: params.minPrice,
                maxPrice: params.maxPrice,
                propertyType: params.propertyType,
                bedrooms: params.bedrooms,
                bathrooms: params.bathrooms,
                frequency: params.frequency || 'daily',
                notificationEmail: params.notificationEmail
            });
            
        case 'check-monitor':
            // Check if there are any new listings for a monitor
            if (!params.monitorId) {
                throw new Error('Monitor ID is required to check monitor status');
            }
            return await checkMonitorStatus(params.monitorId);
            
        default:
            throw new Error(`Unknown real estate action: ${action}`);
    }
}

// Helper function to check monitor status
async function checkMonitorStatus(monitorId) {
    try {
        // Retrieve the monitor configuration
        const store = await Actor.openKeyValueStore('real-estate-monitors');
        const monitorConfig = await store.getValue(monitorId);
        
        if (!monitorConfig) {
            return `Monitor with ID ${monitorId} not found.`;
        }
        
        // For a real implementation, we would:
        // 1. Check for new listings since last check
        // 2. Update the last checked time
        // 3. Return the new listings
        
        // Charge a small fee for checking monitor status
        try {
            await Actor.charge({ eventName: 'task-completed' });
        } catch (chargeError) {
            log.error('Error charging for monitor status check:', chargeError);
        }
        
        return `Monitor status for ${monitorId}:
            - Location: ${monitorConfig.criteria.location}
            - Property type: ${monitorConfig.criteria.propertyType}
            - Price range: $${monitorConfig.criteria.minPrice || 'any'} - $${monitorConfig.criteria.maxPrice || 'any'}
            - Frequency: ${monitorConfig.frequency}
            - Last checked: ${monitorConfig.lastChecked || 'Never'}
            - Email notifications: ${monitorConfig.notificationEmail || 'Not set up'}`;
    } catch (error) {
        log.error('Error checking monitor status:', error);
        return `Error checking monitor status: ${error.message}`;
    }
}

// If a specific real estate action is provided in the input, process it directly
if (action && ['search', 'monitor', 'check-monitor'].includes(action)) {
    try {
        log.info('Direct real estate action requested:', { action });
        
        const result = await processRealEstateAction(action, { 
            monitorId, 
            location, 
            minPrice, 
            maxPrice, 
            propertyType, 
            bedrooms, 
            bathrooms, 
            frequency, 
            notificationEmail 
        });
        
        log.info(`Action completed: ${action}`);
        await Actor.pushData({ action, result });
        
        // Charge for task completion
        try {
            await Actor.charge({ eventName: 'task-completed' });
        } catch (error) {
            log.error('Failed to charge for task completion', { error });
        }
        
        await Actor.exit();
    } catch (error) {
        log.error('Error processing real estate action:', error);
        await Actor.exit(1);
    }
}

// If no specific action, use the agent with real estate tools
const agent = createReactAgent({
    llm: new ChatOpenAI({ temperature: 0, model: modelName }),
    tools: [searchRealEstateListingsTool, monitorRealEstateListingsTool],
});

let agentFinalState;
try {
    log.info('Starting agent ...');
    agentFinalState = await agent.invoke(
        { messages: [new HumanMessage(query)] },
        { configurable: { thread_id: '1' } },
    );
} catch (error) {
    log.error('Failed to run the agent', { error });
    await Actor.exit(1);
}

if (!agentFinalState || !agentFinalState.messages?.length) {
    log.error('Agent did not return a valid response.');
    await Actor.exit(1);
}

const answer = agentFinalState.messages[agentFinalState.messages.length - 1].content;

log.info(`Question: ${query}`);
log.info(`Agent response: ${answer}`);

log.info(`Number of messages: ${agentFinalState.messages.length}`);
log.info('Charging for task completion');

try {
    await Actor.charge({ eventName: 'task-completed' });
} catch (error) {
    log.error('Failed to charge for task completion', { error });
    await Actor.exit(1);
}

log.info('Pushing data to the key-value store');
await Actor.pushData({ question: query, answer });

await Actor.exit();
