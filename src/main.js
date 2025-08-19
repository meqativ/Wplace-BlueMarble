/** @file The main file. Everything in the userscript is executed from here.
 * @since 0.0.0
 */

import Overlay from './Overlay.js';
import Observers from './observers.js';
import ApiManager from './apiManager.js';
import TemplateManager from './templateManager.js';
import { consoleLog, consoleWarn, consoleError } from './utils.js';
import * as icons from './icons.js';
import { initializeTileRefreshPause, toggleTileRefreshPause, isTileRefreshPaused, getCachedTileCount } from './tileManager.js';
import * as Settings from './settingsManager.js';

const name = GM_info.script.name.toString(); // Name of userscript
const version = GM_info.script.version.toString(); // Version of userscript
const consoleStyle = 'color: cornflowerblue;'; // The styling for the console logs

/** Injects code into the client
 * This code will execute outside of TamperMonkey's sandbox
 * @param {*} callback - The code to execute
 * @since 0.11.15
 */
function inject(callback) {
    const script = document.createElement('script');
    script.setAttribute('bm-name', name); // Passes in the name value
    script.setAttribute('bm-cStyle', consoleStyle); // Passes in the console style value
    script.textContent = `(${callback})();`;
    document.documentElement?.appendChild(script);
    script.remove();
}

/** What code to execute instantly in the client (webpage) to spy on fetch calls.
 * This code will execute outside of TamperMonkey's sandbox.
 * @since 0.11.15
 */
inject(() => {

  const script = document.currentScript; // Gets the current script HTML Script Element
  const name = script?.getAttribute('bm-name') || 'Blue Marble'; // Gets the name value that was passed in. Defaults to "Blue Marble" if nothing was found
  const consoleStyle = script?.getAttribute('bm-cStyle') || ''; // Gets the console style value that was passed in. Defaults to no styling if nothing was found
  const fetchedBlobQueue = new Map(); // Blobs being processed

  window.addEventListener('message', (event) => {
    const { source, endpoint, blobID, blobData, blink } = event.data;

    const elapsed = Date.now() - blink;

    // Since this code does not run in the userscript, we can't use consoleLog().
    console.groupCollapsed(`%c${name}%c: ${fetchedBlobQueue.size} Recieved IMAGE message about blob "${blobID}"`, consoleStyle, '');
    // console.log(`Blob fetch took %c${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000) % 60).padStart(2,'0')}.${String(elapsed % 1000).padStart(3,'0')}%c MM:SS.mmm`, consoleStyle, '');
    // console.log(fetchedBlobQueue);
    console.groupEnd();

    // The modified blob won't have an endpoint, so we ignore any message without one.
    if ((source == 'blue-marble') && !!blobID && !!blobData && !endpoint) {

      const callback = fetchedBlobQueue.get(blobID); // Retrieves the blob based on the UUID

      // If the blobID is a valid function...
      if (typeof callback === 'function') {

        callback(blobData); // ...Retrieve the blob data from the blobID function
      } else {
        // ...else the blobID is unexpected. We don't know what it is, but we know for sure it is not a blob. This means we ignore it.

        consoleWarn(`%c${name}%c: Attempted to retrieve a blob (%s) from queue, but the blobID was not a function! Skipping...`, consoleStyle, '', blobID);
      }

      fetchedBlobQueue.delete(blobID); // Delete the blob from the queue, because we don't need to process it again
    }
  });

  // Spys on "spontaneous" fetch requests made by the client
  const originalFetch = window.fetch; // Saves a copy of the original fetch

  // Overrides fetch
  window.fetch = async function(...args) {

    const response = await originalFetch.apply(this, args); // Sends a fetch
    const cloned = response.clone(); // Makes a copy of the response

    // Retrieves the endpoint name. Unknown endpoint = "ignore"
    const endpointName = ((args[0] instanceof Request) ? args[0]?.url : args[0]) || 'ignore';

    // Check Content-Type to only process JSON
    const contentType = cloned.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {


      // Since this code does not run in the userscript, we can't use consoleLog().
      // console.log(`%c${name}%c: Sending JSON message about endpoint "${endpointName}"`, consoleStyle, '');

      // Sends a message about the endpoint it spied on
      cloned.json()
        .then(jsonData => {
          window.postMessage({
            source: 'blue-marble',
            endpoint: endpointName,
            jsonData: jsonData
          }, '*');
        })
        .catch(err => {
          console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
        });
    } else if (contentType.includes('image/') && (!endpointName.includes('openfreemap') && !endpointName.includes('maps'))) {
      // Fetch custom for all images but opensourcemap

      const blink = Date.now(); // Current time

      const blob = await cloned.blob(); // The original blob

      // Since this code does not run in the userscript, we can't use consoleLog().
      // console.log(`%c${name}%c: ${fetchedBlobQueue.size} Sending IMAGE message about endpoint "${endpointName}"`, consoleStyle, '');

      // Returns the manipulated blob
      return new Promise((resolve) => {
        const blobUUID = crypto.randomUUID(); // Generates a random UUID

        // Store the blob while we wait for processing
        fetchedBlobQueue.set(blobUUID, (blobProcessed) => {
          // The response that triggers when the blob is finished processing

          // Creates a new response
          resolve(new Response(blobProcessed, {
            headers: cloned.headers,
            status: cloned.status,
            statusText: cloned.statusText
          }));

          // Since this code does not run in the userscript, we can't use consoleLog().
          console.log(`%c${name}%c: ${fetchedBlobQueue.size} Processed blob "${blobUUID}"`, consoleStyle, '');
        });

        window.postMessage({
          source: 'blue-marble',
          endpoint: endpointName,
          blobID: blobUUID,
          blobData: blob,
          blink: blink
        });
      }).catch(exception => {
        const elapsed = Date.now();
        console.error(`%c${name}%c: Failed to Promise blob!`, consoleStyle, '');
        console.groupCollapsed(`%c${name}%c: Details of failed blob Promise:`, consoleStyle, '');
        console.log(`Endpoint: ${endpointName}\nThere are ${fetchedBlobQueue.size} blobs processing...\nBlink: ${blink.toLocaleString()}\nTime Since Blink: ${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000) % 60).padStart(2,'0')}.${String(elapsed % 1000).padStart(3,'0')} MM:SS.mmm`);
        console.error(`Exception stack:`, exception);
        console.groupEnd();
      });

      // cloned.blob().then(blob => {
      //   window.postMessage({
      //     source: 'blue-marble',
      //     endpoint: endpointName,
      //     blobData: blob
      //   }, '*');
      // });
    }

    return response; // Returns the original response
  };
});

// Imports the CSS file from dist folder on github
const cssOverlay = GM_getResourceText("CSS-BM-File");
GM_addStyle(cssOverlay);

// Imports the Roboto Mono font family
let robotoStylesheetLink = document.createElement('link');
robotoStylesheetLink.href = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap';
robotoStylesheetLink.rel = 'preload';
robotoStylesheetLink.as = 'style';
robotoStylesheetLink.onload = function () {
  this.onload = null;
  this.rel = 'stylesheet';
};
document.head?.appendChild(robotoStylesheetLink);

// Imports the Outfit font family
let outfitStylesheetLink = document.createElement('link');
outfitStylesheetLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap';
outfitStylesheetLink.rel = 'preload';
outfitStylesheetLink.as = 'style';
outfitStylesheetLink.onload = function () {
  this.onload = null;
  this.rel = 'stylesheet';
};
document.head?.appendChild(outfitStylesheetLink);

// CONSTRUCTORS
const observers = new Observers(); // Constructs a new Observers object
const overlayMain = new Overlay(name, version); // Constructs a new Overlay object for the main overlay
const overlayTabTemplate = new Overlay(name, version); // Constructs a Overlay object for the template tab
const templateManager = new TemplateManager(name, version, overlayMain); // Constructs a new TemplateManager object
const apiManager = new ApiManager(templateManager); // Constructs a new ApiManager object

overlayMain.setApiManager(apiManager); // Sets the API manager

// Load wrong color settings
templateManager.loadWrongColorSettings();

// Load templates with fallback system
async function loadTemplates() {
  let storageTemplates = {};
  let storageSource = 'none';
  
  // Try TamperMonkey storage first
  try {
    if (typeof GM !== 'undefined' && GM.getValue) {
      const data = await GM.getValue('bmTemplates', '{}');
      storageTemplates = JSON.parse(data);
      storageSource = 'TamperMonkey (async)';
    } else if (typeof GM_getValue !== 'undefined') {
      const data = GM_getValue('bmTemplates', '{}');
      storageTemplates = JSON.parse(data);
      storageSource = 'TamperMonkey (legacy)';
    }
  } catch (error) {
    console.warn('⚠️ TamperMonkey storage load failed:', error);
    
    // Fallback to localStorage
    try {
      const data = localStorage.getItem('bmTemplates') || '{}';
      storageTemplates = JSON.parse(data);
      storageSource = 'localStorage (fallback)';
    } catch (fallbackError) {
      console.error('❌ All storage methods failed:', fallbackError);
      storageTemplates = {};
      storageSource = 'empty (all failed)';
    }
  }
  
  console.log(`📂 Templates loaded from: ${storageSource}`);
  console.log('📦 Storage data:', storageTemplates);
  
  // Detailed debug logging
  console.log('🔍 Debug - Storage analysis:');
  console.log('  - Type:', typeof storageTemplates);
  console.log('  - Is object:', typeof storageTemplates === 'object' && storageTemplates !== null);
  console.log('  - Has whoami:', storageTemplates?.whoami);
  console.log('  - whoami value:', JSON.stringify(storageTemplates?.whoami));
  console.log('  - Has templates:', !!storageTemplates?.templates);
  console.log('  - Templates type:', typeof storageTemplates?.templates);
  console.log('  - Templates keys:', storageTemplates?.templates ? Object.keys(storageTemplates.templates) : 'N/A');
  
  // Validate loaded data
  const templateCount = Object.keys(storageTemplates?.templates || {}).length;
  
  if (templateCount === 0 && storageSource !== 'empty (all failed)') {
    console.warn('⚠️ No templates found but storage source was available');
    
    // Try to recover from backup or alternative storage
    try {
      // Check if there's a backup in the other storage system
      let backupData = {};
      
      if (storageSource.includes('TamperMonkey')) {
        // Try localStorage as backup
        const lsBackup = localStorage.getItem('bmTemplates');
        if (lsBackup) {
          backupData = JSON.parse(lsBackup);
          console.log('🔄 Found backup in localStorage');
        }
      } else {
        // Try TamperMonkey as backup
        let tmBackup = null;
        if (typeof GM_getValue !== 'undefined') {
          tmBackup = GM_getValue('bmTemplates', null);
        }
        if (tmBackup) {
          backupData = JSON.parse(tmBackup);
          console.log('🔄 Found backup in TamperMonkey storage');
        }
      }
      
      const backupCount = Object.keys(backupData?.templates || {}).length;
      if (backupCount > 0) {
        console.log(`✅ Recovering ${backupCount} templates from backup`);
        storageTemplates = backupData;
        // Save recovered data to both storages
        setTimeout(() => templateManager.updateTemplateWithColorFilter(), 1000);
      }
    } catch (recoveryError) {
      console.error('❌ Recovery failed:', recoveryError);
    }
  }
  
  templateManager.importJSON(storageTemplates); // Loads the templates
  
  if (templateCount > 0) {
    console.log(`✅ Successfully loaded ${templateCount} templates`);
  } else {
    console.log('ℹ️ No templates loaded - start by creating a new template');
  }
}

// Storage migration and validation
async function migrateAndValidateStorage() {
  try {
    // Check if we have data in both storages
    let tmData = null;
    let lsData = null;
    let tmTimestamp = 0;
    let lsTimestamp = 0;
    
    // Get TamperMonkey data
    try {
      if (typeof GM !== 'undefined' && GM.getValue) {
        tmData = await GM.getValue('bmTemplates', null);
        tmTimestamp = await GM.getValue('bmTemplates_timestamp', 0);
      } else if (typeof GM_getValue !== 'undefined') {
        tmData = GM_getValue('bmTemplates', null);
        tmTimestamp = GM_getValue('bmTemplates_timestamp', 0);
      }
    } catch (e) { console.warn('TM check failed:', e); }
    
    // Get localStorage data
    try {
      lsData = localStorage.getItem('bmTemplates');
      lsTimestamp = parseInt(localStorage.getItem('bmTemplates_timestamp') || '0');
    } catch (e) { console.warn('LS check failed:', e); }
    
    // If we have data in both, use the most recent
    if (tmData && lsData && tmTimestamp !== lsTimestamp) {
      console.log(`🔄 Data sync: TM(${new Date(tmTimestamp).toLocaleString()}) vs LS(${new Date(lsTimestamp).toLocaleString()})`);
      
      if (tmTimestamp > lsTimestamp) {
        // TamperMonkey is newer, update localStorage
        localStorage.setItem('bmTemplates', tmData);
        localStorage.setItem('bmTemplates_timestamp', tmTimestamp.toString());
        console.log('✅ Synced localStorage with newer TamperMonkey data');
      } else {
        // localStorage is newer, update TamperMonkey
        if (typeof GM !== 'undefined' && GM.setValue) {
          await GM.setValue('bmTemplates', lsData);
          await GM.setValue('bmTemplates_timestamp', lsTimestamp);
        } else if (typeof GM_setValue !== 'undefined') {
          GM_setValue('bmTemplates', lsData);
          GM_setValue('bmTemplates_timestamp', lsTimestamp);
        }
        console.log('✅ Synced TamperMonkey with newer localStorage data');
      }
    }
  } catch (error) {
    console.warn('⚠️ Storage migration failed:', error);
  }
}

// Load templates on startup
Promise.resolve(migrateAndValidateStorage()).then(() => loadTemplates());

buildOverlayMain(); // Builds the main overlay

// Pause tiles functionality is now integrated into the main UI through buildOverlayMain()

// Initialize tile refresh pause system
initializeTileRefreshPause(templateManager);

// Initialize mini tracker after a short delay to ensure DOM is ready
setTimeout(() => {
  updateMiniTracker();
}, 100);

overlayMain.handleDrag('#bm-overlay', '#bm-bar-drag'); // Creates dragging capability on the drag bar for dragging the overlay

apiManager.spontaneousResponseListener(overlayMain); // Reads spontaneous fetch responces

observeBlack(); // Observes the black palette color

// Initialize keyboard shortcuts
initializeKeyboardShortcuts();

consoleLog(`%c${name}%c (${version}) userscript has loaded!`, 'color: cornflowerblue;', '');

/** Observe the black color, and add the "Move" button.
 * @since 0.66.3
 */
function observeBlack() {
  const observer = new MutationObserver((mutations, observer) => {

    const black = document.querySelector('#color-1'); // Attempt to retrieve the black color element for anchoring

    if (!black) {return;} // Black color does not exist yet. Kills iteself

    let move = document.querySelector('#bm-button-move'); // Tries to find the move button

    // If the move button does not exist, we make a new one
    if (!move) {
      move = document.createElement('button');
      move.id = 'bm-button-move';
      move.textContent = 'Move ↑';
      move.className = 'btn btn-soft';
      move.onclick = function() {
        const roundedBox = this.parentNode.parentNode.parentNode.parentNode; // Obtains the rounded box
        const shouldMoveUp = (this.textContent == 'Move ↑');
        roundedBox.parentNode.className = roundedBox.parentNode.className.replace(shouldMoveUp ? 'bottom' : 'top', shouldMoveUp ? 'top' : 'bottom'); // Moves the rounded box to the top
        roundedBox.style.borderTopLeftRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderTopRightRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderBottomLeftRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        roundedBox.style.borderBottomRightRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        this.textContent = shouldMoveUp ? 'Move ↓' : 'Move ↑';
      }

      // Attempts to find the "Paint Pixel" element for anchoring
      const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector('h2');

      paintPixel.parentNode?.appendChild(move); // Adds the move button
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/** Deletes all templates from storage with confirmation dialog
 * @param {Object} instance - The overlay instance
 * @since 1.0.0
 */
function deleteAllTemplates(instance) {
  // Get current template count for confirmation message
  const templateCount = templateManager?.templatesArray?.length || 0;
  const templateText = templateCount === 1 ? 'template' : 'templates';
  
  // Show confirmation dialog
  const confirmMessage = templateCount > 0 
    ? `Are you sure you want to delete all ${templateCount} ${templateText}?\n\nThis action cannot be undone!`
    : 'No templates found to delete.';
  
  if (templateCount === 0) {
    showCustomConfirmDialog(
      'No Templates Found',
      'No templates found to delete.',
      null, // No confirm action needed
      () => {
        instance.handleDisplayStatus('No templates to delete');
      }
    );
    return;
  }
  
  // Use custom confirmation dialog instead of native confirm
  showCustomConfirmDialog(
    'Delete All Templates?',
    confirmMessage,
    () => {
      // This is the confirmation callback - execute the deletion logic
      performDeleteAllTemplates(instance, templateCount, templateText);
    },
    () => {
      // This is the cancel callback
      instance.handleDisplayStatus('Template deletion cancelled');
    }
  );
}

/** Performs the actual deletion of all templates (extracted from deleteAllTemplates)
 * @param {Object} instance - The overlay instance
 * @param {number} templateCount - Number of templates to delete
 * @param {string} templateText - Singular/plural text for templates
 * @since 1.0.0
 */
function performDeleteAllTemplates(instance, templateCount, templateText) {
  try {
    // Clear templates from memory
    if (templateManager) {
      templateManager.templatesArray = [];
      templateManager.templatesJSON = {
        whoami: templateManager.templatesJSON?.whoami || null,
        templates: {}
      };
    }
    
    // Clear from TamperMonkey storage
    try {
      if (typeof GM !== 'undefined' && GM.deleteValue) {
        GM.deleteValue('bmTemplates');
        GM.deleteValue('bmTemplates_timestamp');
      } else if (typeof GM_deleteValue !== 'undefined') {
        GM_deleteValue('bmTemplates');
        GM_deleteValue('bmTemplates_timestamp');
      }
    } catch (error) {
      console.warn('⚠️ Failed to clear TamperMonkey storage:', error);
    }
    
    // Clear from localStorage
    try {
      localStorage.removeItem('bmTemplates');
      localStorage.removeItem('bmTemplates_timestamp');
    } catch (error) {
      console.warn('⚠️ Failed to clear localStorage:', error);
    }
    
    // Force refresh template display to clear any visual templates
    if (typeof refreshTemplateDisplay === 'function') {
      refreshTemplateDisplay().catch(error => {
        console.warn('Warning: Failed to refresh template display:', error);
      });
    }
    
    // Update mini tracker to reflect empty state
    if (typeof updateMiniTracker === 'function') {
      updateMiniTracker();
    }
    
    // Close Color Filter overlay if open
    const existingColorFilterOverlay = document.getElementById('bm-color-filter-overlay');
    if (existingColorFilterOverlay) {
      existingColorFilterOverlay.remove();
    }
    
    instance.handleDisplayStatus(`Successfully deleted all ${templateCount} ${templateText}!`);
    consoleLog(`🗑️ Deleted all ${templateCount} templates from storage`);
    
  } catch (error) {
    consoleError('❌ Failed to delete templates:', error);
    instance.handleDisplayError('Failed to delete templates. Check console for details.');
  }
}

/** Shows a custom confirmation dialog with slate theme
 * @param {string} title - The title of the confirmation dialog
 * @param {string} message - The message to display
 * @param {Function} onConfirm - Callback function to execute when confirmed
 * @param {Function} onCancel - Optional callback function to execute when cancelled
 * @since 1.0.0
 */
function showCustomConfirmDialog(title, message, onConfirm, onCancel = null) {
  // Inject confirm dialog styles if not already present
  if (!document.getElementById('bm-confirm-dialog-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'bm-confirm-dialog-styles';
    styleSheet.textContent = `
      .bmcd-overlay-backdrop { 
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        backdrop-filter: blur(12px);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 15000;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: bmcd-fadeIn 0.2s ease-out;
      }
      
      @keyframes bmcd-fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      @keyframes bmcd-slideIn {
        from { 
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.9) translateY(20px);
        }
        to { 
          opacity: 1;
          transform: translate(-50%, -50%) scale(1) translateY(0);
        }
      }
      
      .bmcd-container { 
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--slate-900, #0f172a);
        color: var(--slate-100, #f1f5f9);
        border-radius: 16px;
        border: 1px solid var(--slate-700, #334155);
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(16px);
        max-width: 400px;
        width: 90%;
        overflow: hidden;
        animation: bmcd-slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      .bmcd-container::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 16px;
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(220, 38, 38, 0.05));
        pointer-events: none;
      }
      
      .bmcd-header { 
        padding: 20px 24px 16px 24px;
        border-bottom: 1px solid var(--slate-700, #334155);
        background: linear-gradient(135deg, var(--slate-800, #1e293b), var(--slate-750, #293548));
        position: relative;
        z-index: 1;
      }
      
      .bmcd-title {
        margin: 0;
        font-size: 1.25em;
        font-weight: 700;
        text-align: center;
        letter-spacing: -0.025em;
        background: linear-gradient(135deg, var(--red-400, #f87171), var(--red-500, #ef4444));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      
      .bmcd-content { 
        padding: 20px 24px;
        position: relative;
        z-index: 1;
        text-align: center;
      }
      
      .bmcd-message {
        color: var(--slate-300, #cbd5e1);
        line-height: 1.6;
        white-space: pre-line;
        font-size: 0.95em;
      }
      
      .bmcd-footer { 
        display: flex;
        gap: 12px;
        justify-content: center;
        align-items: center;
        padding: 16px 24px 20px 24px;
        border-top: 1px solid var(--slate-700, #334155);
        background: linear-gradient(135deg, var(--slate-800, #1e293b), var(--slate-750, #293548));
        position: relative;
        z-index: 1;
      }
      
      .bmcd-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 40px;
        padding: 0 20px;
        min-width: 100px;
        border-radius: 10px;
        border: 1px solid;
        font-size: 0.9em;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
        flex: 1;
      }
      
      .bmcd-btn::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 10px;
        background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      
      .bmcd-btn:hover::before {
        opacity: 1;
      }
      
      .bmcd-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0,0,0,0.4);
      }
      
      .bmcd-btn:active {
        transform: translateY(0);
      }
      
      .bmcd-btn-danger {
        background: linear-gradient(135deg, var(--red-500, #ef4444), var(--red-600, #dc2626));
        color: white;
        border-color: var(--red-600, #dc2626);
      }
      
      .bmcd-btn-danger:hover {
        background: linear-gradient(135deg, var(--red-600, #dc2626), var(--red-700, #b91c1c));
        box-shadow: 0 8px 25px rgba(239, 68, 68, 0.5);
      }
      
      .bmcd-btn-secondary {
        background: var(--slate-700, #334155);
        color: var(--slate-100, #f1f5f9);
        border-color: var(--slate-600, #475569);
      }
      
      .bmcd-btn-secondary:hover {
        background: var(--slate-600, #475569);
      }
      
      @media (max-width: 520px) {
        .bmcd-container {
          width: 95%;
        }
        
        .bmcd-btn {
          min-width: 80px;
          height: 36px;
          font-size: 0.85em;
        }
        
        .bmcd-header, .bmcd-content, .bmcd-footer {
          padding-left: 20px;
          padding-right: 20px;
        }
      }
    `;
    document.head.appendChild(styleSheet);
  }
  
  // Create overlay backdrop
  const overlay = document.createElement('div');
  overlay.className = 'bmcd-overlay-backdrop';
  
  // Create main container
  const container = document.createElement('div');
  container.className = 'bmcd-container';
  
  // Header
  const header = document.createElement('div');
  header.className = 'bmcd-header';
  
  const titleElement = document.createElement('h3');
  titleElement.className = 'bmcd-title';
  titleElement.textContent = title;
  
  header.appendChild(titleElement);
  
  // Content
  const content = document.createElement('div');
  content.className = 'bmcd-content';
  
  const messageElement = document.createElement('p');
  messageElement.className = 'bmcd-message';
  messageElement.textContent = message;
  
  content.appendChild(messageElement);
  
  // Footer with buttons
  const footer = document.createElement('div');
  footer.className = 'bmcd-footer';
  
  // Create buttons based on whether there's a confirm action
  if (onConfirm) {
    // Confirm button
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'bmcd-btn bmcd-btn-danger';
    confirmBtn.textContent = 'Delete';
    
    confirmBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      onConfirm();
    });
    
    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'bmcd-btn bmcd-btn-secondary';
    cancelBtn.textContent = 'Cancel';
    
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      if (onCancel) onCancel();
    });
    
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
  } else {
    // Only OK button for info dialogs
    const okBtn = document.createElement('button');
    okBtn.className = 'bmcd-btn bmcd-btn-secondary';
    okBtn.textContent = 'OK';
    okBtn.style.flex = 'none';
    okBtn.style.minWidth = '120px';
    
    okBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      if (onCancel) onCancel();
    });
    
    footer.appendChild(okBtn);
    
    // Focus the OK button for info dialogs
    setTimeout(() => okBtn.focus(), 100);
  }
  
  // Assemble the dialog
  container.appendChild(header);
  container.appendChild(content);
  container.appendChild(footer);
  overlay.appendChild(container);
  
  // Close dialog when clicking outside (but not when clicking the container)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
      if (onCancel) onCancel();
    }
  });
  
  // ESC key support
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      document.body.removeChild(overlay);
      document.removeEventListener('keydown', handleKeyDown);
      if (onCancel) onCancel();
    }
  };
  document.addEventListener('keydown', handleKeyDown);
  
  // Add to page
  document.body.appendChild(overlay);
  
  // Focus the cancel button by default for better UX (only if it exists)
  if (onConfirm) {
    setTimeout(() => {
      const cancelButton = footer.querySelector('.bmcd-btn-secondary');
      if (cancelButton) cancelButton.focus();
    }, 100);
  }
}

/** Deletes a selected template with a dropdown selection interface
 * @param {Object} instance - The overlay instance
 * @since 1.0.0
 */
function deleteSelectedTemplate(instance) {
  // Get available templates
  const templates = templateManager?.templatesJSON?.templates || {};
  const templateKeys = Object.keys(templates);
  
  if (templateKeys.length === 0) {
    instance.handleDisplayStatus('No templates found to delete');
    return;
  }
  
  // Inject slate theme styles if not already present
  if (!document.getElementById('bm-delete-template-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'bm-delete-template-styles';
    styleSheet.textContent = `
      :root { 
        --slate-50: #f8fafc; --slate-100: #f1f5f9; --slate-200: #e2e8f0; --slate-300: #cbd5e1; 
        --slate-400: #94a3b8; --slate-500: #64748b; --slate-600: #475569; --slate-700: #334155; 
        --slate-750: #293548; --slate-800: #1e293b; --slate-900: #0f172a; --slate-950: #020617;
        --blue-400: #60a5fa; --blue-500: #3b82f6; --blue-600: #2563eb; --blue-700: #1d4ed8;
        --emerald-400: #34d399; --emerald-500: #10b981; --emerald-600: #059669; --emerald-700: #047857;
        --red-400: #f87171; --red-500: #ef4444; --red-600: #dc2626; --red-700: #b91c1c;
        --bmdt-bg: var(--slate-900); --bmdt-card: var(--slate-800); --bmdt-border: var(--slate-700); 
        --bmdt-muted: var(--slate-400); --bmdt-text: var(--slate-100); --bmdt-text-muted: var(--slate-300);
      }
      
      .bmdt-overlay-backdrop { 
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(8px);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      
      .bmdt-container { 
        background: var(--bmdt-bg);
        color: var(--bmdt-text);
        border-radius: 20px;
        border: 1px solid var(--bmdt-border);
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(16px);
        max-width: 500px;
        width: 90%;
        max-height: 85vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        position: relative;
      }
      
      .bmdt-container::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 20px;
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(16, 185, 129, 0.05));
        pointer-events: none;
      }
      
      .bmdt-header { 
        display: flex;
        flex-direction: column;
        padding: 20px 24px 16px 24px;
        border-bottom: 1px solid var(--bmdt-border);
        background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
        position: relative;
        z-index: 1;
      }
      
      .bmdt-title {
        margin: 0;
        font-size: 1.5em;
        font-weight: 700;
        text-align: center;
        letter-spacing: -0.025em;
        background: linear-gradient(135deg, var(--slate-100), var(--slate-300));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      
      .bmdt-content { 
        padding: 20px 24px;
        overflow-y: auto;
        position: relative;
        z-index: 1;
        flex: 1;
      }
      
      .bmdt-template-list {
        margin: 0;
        max-height: 350px;
        overflow-y: auto;
        border: 1px solid var(--bmdt-border);
        border-radius: 12px;
        background: var(--bmdt-card);
      }
      
      .bmdt-template-item {
        padding: 16px;
        border-bottom: 1px solid var(--bmdt-border);
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: relative;
        min-height: 60px;
        box-sizing: border-box;
      }
      
      .bmdt-template-item:last-child {
        border-bottom: none;
      }
      
      .bmdt-template-item:hover {
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(16, 185, 129, 0.05));
      }
      
      .bmdt-template-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
        min-width: 0;
        margin-right: 12px;
      }
      
      .bmdt-template-name {
        font-weight: 600;
        font-size: 1em;
        color: var(--bmdt-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      
      .bmdt-template-key {
        font-size: 0.8em;
        color: var(--bmdt-text-muted);
        font-family: 'Courier New', monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      
      .bmdt-delete-btn {
        background: linear-gradient(135deg, var(--red-500), var(--red-600));
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.85em;
        font-weight: 600;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }
      
      .bmdt-delete-btn::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      
      .bmdt-delete-btn:hover {
        background: linear-gradient(135deg, var(--red-600), var(--red-700));
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(239, 68, 68, 0.4);
      }
      
      .bmdt-delete-btn:hover::before {
        opacity: 1;
      }
      
      .bmdt-footer { 
        display: flex;
        gap: 12px;
        justify-content: center;
        align-items: center;
        padding: 20px 24px;
        border-top: 1px solid var(--bmdt-border);
        background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
        position: relative;
        z-index: 1;
      }
      
      .bmdt-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 44px;
        padding: 0 20px;
        min-width: 140px;
        border-radius: 12px;
        border: 1px solid var(--bmdt-border);
        font-size: 0.9em;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
        flex: 1;
      }
      
      .bmdt-btn::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 12px;
        background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      
      .bmdt-btn:hover::before {
        opacity: 1;
      }
      
      .bmdt-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0,0,0,0.3);
      }
      
      .bmdt-btn-danger {
        background: linear-gradient(135deg, var(--red-500), var(--red-600));
        color: white;
        border-color: var(--red-600);
      }
      
      .bmdt-btn-danger:hover {
        background: linear-gradient(135deg, var(--red-600), var(--red-700));
        box-shadow: 0 8px 25px rgba(239, 68, 68, 0.4);
      }
      
      .bmdt-btn-secondary {
        background: var(--slate-700);
        color: var(--bmdt-text);
        border-color: var(--bmdt-border);
      }
      
      .bmdt-btn-secondary:hover {
        background: var(--slate-600);
      }
      
      /* Custom scrollbar for template list */
      .bmdt-template-list::-webkit-scrollbar {
        width: 8px;
      }
      
      .bmdt-template-list::-webkit-scrollbar-track {
        background: var(--slate-800);
        border-radius: 4px;
      }
      
      .bmdt-template-list::-webkit-scrollbar-thumb {
        background: var(--slate-600);
        border-radius: 4px;
      }
      
      .bmdt-template-list::-webkit-scrollbar-thumb:hover {
        background: var(--slate-500);
      }
      
      @media (max-width: 520px) {
        .bmdt-container {
          width: 95%;
          max-height: 90vh;
        }
        
        .bmdt-btn {
          min-width: 120px;
          height: 40px;
          font-size: 0.85em;
        }
        
        .bmdt-template-item {
          padding: 12px;
        }
      }
    `;
    document.head.appendChild(styleSheet);
  }
  
  // Create overlay backdrop
  const overlay = document.createElement('div');
  overlay.id = 'bm-delete-template-overlay';
  overlay.className = 'bmdt-overlay-backdrop';
  
  // Create main container
  const container = document.createElement('div');
  container.className = 'bmdt-container';
  
  // Header
  const header = document.createElement('div');
  header.className = 'bmdt-header';
  
  const title = document.createElement('h3');
  title.className = 'bmdt-title';
  title.textContent = 'Select Template to Delete';
  
  header.appendChild(title);
  
  // Content
  const content = document.createElement('div');
  content.className = 'bmdt-content';
  
  // Template list
  const templateList = document.createElement('div');
  templateList.className = 'bmdt-template-list';
  
  templateKeys.forEach(templateKey => {
    const template = templates[templateKey];
    const templateName = template.name || `Template ${templateKey}`;
    
    const templateItem = document.createElement('div');
    templateItem.className = 'bmdt-template-item';
    
    const templateInfo = document.createElement('div');
    templateInfo.className = 'bmdt-template-info';
    
    const nameSpan = document.createElement('div');
    nameSpan.className = 'bmdt-template-name';
    nameSpan.textContent = templateName;
    
    const keySpan = document.createElement('div');
    keySpan.className = 'bmdt-template-key';
    keySpan.textContent = templateKey;
    
    templateInfo.appendChild(nameSpan);
    templateInfo.appendChild(keySpan);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'bmdt-delete-btn';
    deleteBtn.textContent = 'Delete';
    
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      showCustomConfirmDialog(
        `Delete "${templateName}"?`,
        `Are you sure you want to delete this template?\n\nThis action cannot be undone!`,
        () => {
          try {
            // Delete from templateManager
            templateManager.deleteTemplate(templateKey);
            
            // Remove overlay
            document.body.removeChild(overlay);
            
            instance.handleDisplayStatus(`Successfully deleted template "${templateName}"!`);
            consoleLog(`🗑️ Deleted template: ${templateName} (${templateKey})`);
            
          } catch (error) {
            consoleError('❌ Failed to delete template:', error);
            instance.handleDisplayError('Failed to delete template. Check console for details.');
          }
        }
      );
    });
    
    templateItem.appendChild(templateInfo);
    templateItem.appendChild(deleteBtn);
    templateList.appendChild(templateItem);
  });
  
  content.appendChild(templateList);
  
  // Footer with buttons
  const footer = document.createElement('div');
  footer.className = 'bmdt-footer';
  
  // Delete All button
  const deleteAllBtn = document.createElement('button');
  deleteAllBtn.className = 'bmdt-btn bmdt-btn-danger';
  deleteAllBtn.textContent = 'Delete All Templates';
  
  deleteAllBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
    
    showCustomConfirmDialog(
      'Delete All Templates?',
      `Are you sure you want to delete all ${templateKeys.length} templates?\n\nThis action cannot be undone!`,
      () => {
        // Call the actual deletion logic directly, not the wrapper function
        const templateCount = templateKeys.length;
        const templateText = templateCount === 1 ? 'template' : 'templates';
        performDeleteAllTemplates(instance, templateCount, templateText);
      }
    );
  });
  
  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'bmdt-btn bmdt-btn-secondary';
  cancelBtn.textContent = 'Cancel';
  
  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
    instance.handleDisplayStatus('Template deletion cancelled');
  });
  
  footer.appendChild(deleteAllBtn);
  footer.appendChild(cancelBtn);
  
  // Assemble the interface
  container.appendChild(header);
  container.appendChild(content);
  container.appendChild(footer);
  overlay.appendChild(container);
  
  // Close overlay when clicking outside
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
      instance.handleDisplayStatus('Template deletion cancelled');
    }
  });
  
  // Add to page
  document.body.appendChild(overlay);
}

/** Deploys the overlay to the page with minimize/maximize functionality.
 * Creates a responsive overlay UI that can toggle between full-featured and minimized states.
 * 
 * Parent/child relationships in the DOM structure below are indicated by indentation.
 * @since 0.58.3
 */
function buildOverlayMain() {
  let isMinimized = false; // Overlay state tracker (false = maximized, true = minimized)
  
  overlayMain.addDiv({'id': 'bm-overlay', 'style': 'top: 10px; right: 75px;'})
    .addDiv({'id': 'bm-contain-header'})
      .addDiv({'id': 'bm-bar-drag'}).buildElement()
      .addDiv({'id': 'bm-title-container'})
        .addImg({'alt': 'Blue Marble Icon - Click to minimize/maximize', 'src': 'https://raw.githubusercontent.com/Seris0/Wplace-BlueMarble/main/dist/assets/Favicon.png', 'style': 'cursor: pointer;'}, 
          (instance, img) => {
          /** Click event handler for overlay minimize/maximize functionality.
           * 
           * Toggles between two distinct UI states:
           * 1. MINIMIZED STATE (60×76px):
           *    - Shows only the Blue Marble icon and drag bar
           *    - Hides all input fields, buttons, and status information
           *    - Applies fixed dimensions for consistent appearance
           *    - Repositions icon with 3px right offset for visual centering
           * 
           * 2. MAXIMIZED STATE (responsive):
           *    - Restores full functionality with all UI elements
           *    - Removes fixed dimensions to allow responsive behavior
           *    - Resets icon positioning to default alignment
           *    - Shows success message when returning to maximized state
           * 
           * @param {Event} event - The click event object (implicit)
           */
          img.addEventListener('click', () => {
            isMinimized = !isMinimized; // Toggle the current state

            const overlay = document.querySelector('#bm-overlay');
            const header = document.querySelector('#bm-contain-header');
            const dragBar = document.querySelector('#bm-bar-drag');
            const coordsContainer = document.querySelector('#bm-contain-coords');
            const coordsButton = document.querySelector('#bm-button-coords');
            const createButton = document.querySelector('#bm-button-create');
            const enableButton = document.querySelector('#bm-button-enable');
            const disableButton = document.querySelector('#bm-button-disable');
            const deleteTemplatesButton = document.querySelector('#bm-button-delete-templates');
            const coordInputs = document.querySelectorAll('#bm-contain-coords input');
            const colorFilterButton = document.getElementById('bm-button-color-filter');
            
            // Pre-restore original dimensions when switching to maximized state
            // This ensures smooth transition and prevents layout issues
            if (!isMinimized) {
              overlay.style.width = "auto";
              overlay.style.maxWidth = "300px";
              overlay.style.minWidth = "200px";
              overlay.style.padding = "10px";
            }
            
            // Define elements that should be hidden/shown during state transitions
            // Each element is documented with its purpose for maintainability
                          const elementsToToggle = [
                '#bm-overlay h1',                    // Main title "Blue Marble"
                '#bm-contain-userinfo',              // User information section (username, droplets, level)
                '#bm-overlay #bm-separator',         // Visual separator lines
                '#bm-contain-automation > *:not(#bm-contain-coords)', // Automation section excluding coordinates
                '#bm-input-file-template',           // Template file upload interface
                '#bm-contain-buttons-action',        // Action buttons container
                `#${instance.outputStatusId}`        // Status log textarea for user feedback
              ];
            
            // Apply visibility changes to all toggleable elements
            elementsToToggle.forEach(selector => {
              const elements = document.querySelectorAll(selector);
              elements.forEach(element => {
                element.style.display = isMinimized ? 'none' : '';
              });
            });
            // Handle coordinate container and button visibility based on state
            if (isMinimized) {
              // ==================== MINIMIZED STATE CONFIGURATION ====================
              // In minimized state, we hide ALL interactive elements except the icon and drag bar
              // This creates a clean, unobtrusive interface that maintains only essential functionality
              
              // Hide coordinate input container completely
              if (coordsContainer) {
                coordsContainer.style.display = 'none';
              }
              
              // Hide coordinate button (pin icon)
              if (coordsButton) {
                coordsButton.style.display = 'none';
              }
              
              // Hide create template button
              if (createButton) {
                createButton.style.display = 'none';
              }

              // Hide enable templates button
              if (enableButton) {
                enableButton.style.display = 'none';
              }

              // Hide disable templates button
              if (disableButton) {
                disableButton.style.display = 'none';
              }

              // Hide delete templates button
              if (deleteTemplatesButton) {
                deleteTemplatesButton.style.display = 'none';
              }

              // Keep Color Filter button visible but compact in minimized state
              if (colorFilterButton) {
                // Ensure the container chain is visible
                let parent = colorFilterButton.parentElement;
                for (let i = 0; i < 3 && parent; i++) {
                  parent.style.display = '';
                  parent = parent.parentElement;
                }

                // Normalize the immediate container to center the compact button
                const btnContainer = colorFilterButton.parentElement;
                if (btnContainer) {
                  btnContainer.style.display = 'flex';
                  btnContainer.style.justifyContent = 'center';
                  btnContainer.style.alignItems = 'center';
                  btnContainer.style.gap = '0';
                  // clear grid constraints if any
                  btnContainer.style.gridTemplateColumns = 'unset';
                }

                // Save original innerHTML once
                if (!colorFilterButton.dataset.originalHtml) {
                  colorFilterButton.dataset.originalHtml = colorFilterButton.innerHTML;
                }
                // Reduce to icon-only
                const svg = colorFilterButton.querySelector('svg');
                if (svg) {
                  colorFilterButton.innerHTML = svg.outerHTML;
                }

                // Compact styling to fit the 60px overlay (inner content width = 60 - 2*8 padding = 44px)
                colorFilterButton.style.width = '56px';
                colorFilterButton.style.height = '38px';
                colorFilterButton.style.padding = '0';
                colorFilterButton.style.gap = '0';
                colorFilterButton.style.fontSize = '0';
                colorFilterButton.style.overflow = 'hidden';
                colorFilterButton.style.borderRadius = '8px';
                colorFilterButton.style.animation = 'none';
                colorFilterButton.style.gridColumn = 'auto';
                colorFilterButton.style.margin = '6px 0 0';
                colorFilterButton.style.display = 'flex';
                colorFilterButton.style.alignItems = 'center';
                colorFilterButton.style.justifyContent = 'center';
                colorFilterButton.style.alignSelf = 'center';
                colorFilterButton.style.position = 'relative';
                colorFilterButton.style.left = '50%';
                colorFilterButton.style.transform = 'translateX(-50%)';
                // Tweak SVG size
                const icon = colorFilterButton.querySelector('svg');
                if (icon) {
                  icon.style.width = '18px';
                  icon.style.height = '18px';
                  icon.style.display = 'block';
                  icon.style.margin = '0 auto';
                }
              }
              
              // Hide all coordinate input fields individually (failsafe)
              coordInputs.forEach(input => {
                input.style.display = 'none';
              });
              
              // Apply fixed dimensions for consistent minimized appearance
              // These dimensions were chosen to accommodate the icon while remaining compact
              // Increase width to accommodate compact Color Filter button (56px) + padding
              overlay.style.width = '72px';    // 56px button + 8px*2 padding
              overlay.style.height = '76px';   // Keep height consistent
              overlay.style.maxWidth = '72px';  // Prevent expansion
              overlay.style.minWidth = '72px';  // Prevent shrinking
              overlay.style.padding = '8px';    // Comfortable padding around icon
              
                             // Apply icon positioning for better visual centering in minimized state
               img.style.margin = '.5rem 1rem 0';
              
              // Configure header layout for minimized state
              header.style.textAlign = 'center';
              header.style.margin = '0';
              header.style.marginBottom = '0';
              
              // Ensure drag bar remains visible and properly spaced
              if (dragBar) {
                dragBar.style.display = '';
                dragBar.style.marginBottom = '0.25em';
              }
            } else {
              // ==================== MAXIMIZED STATE RESTORATION ====================
              // In maximized state, we restore all elements to their default functionality
              // This involves clearing all style overrides applied during minimization
              
              // Restore coordinate container to default state
              if (coordsContainer) {
                coordsContainer.style.display = '';           // Show container
                coordsContainer.style.flexDirection = '';     // Reset flex layout
                coordsContainer.style.justifyContent = '';    // Reset alignment
                coordsContainer.style.alignItems = '';        // Reset alignment
                coordsContainer.style.gap = '';               // Reset spacing
                coordsContainer.style.textAlign = '';         // Reset text alignment
                coordsContainer.style.margin = '';            // Reset margins
              }
              
              // Restore coordinate button visibility
              if (coordsButton) {
                coordsButton.style.display = '';
              }
              
              // Restore create button visibility and reset positioning
              if (createButton) {
                createButton.style.display = '';
                createButton.style.marginTop = '';
              }

              // Restore enable button visibility and reset positioning
              if (enableButton) {
                enableButton.style.display = '';
                enableButton.style.marginTop = '';
              }

              // Restore disable button visibility and reset positioning
              if (disableButton) {
                disableButton.style.display = '';
                disableButton.style.marginTop = '';
              }

              // Restore delete templates button visibility
              if (deleteTemplatesButton) {
                deleteTemplatesButton.style.display = '';
              }

              // Restore Color Filter button to normal size/state
              if (colorFilterButton) {
                // Restore content
                if (colorFilterButton.dataset.originalHtml) {
                  colorFilterButton.innerHTML = colorFilterButton.dataset.originalHtml;
                }
                // Clear compact styles
                colorFilterButton.style.width = '';
                colorFilterButton.style.height = '';
                colorFilterButton.style.padding = '';
                colorFilterButton.style.gap = '';
                colorFilterButton.style.fontSize = '';
                colorFilterButton.style.overflow = '';
                colorFilterButton.style.borderRadius = '';
                colorFilterButton.style.animation = '';
                colorFilterButton.style.transform = '';
                colorFilterButton.style.gridColumn = '';
                colorFilterButton.style.margin = '';
                colorFilterButton.style.display = '';
                colorFilterButton.style.alignItems = '';
                colorFilterButton.style.justifyContent = '';
                colorFilterButton.style.position = '';
                colorFilterButton.style.left = '';

                // Reset parent container layout
                const btnContainer = colorFilterButton.parentElement;
                if (btnContainer) {
                  btnContainer.style.display = '';
                  btnContainer.style.justifyContent = '';
                  btnContainer.style.alignItems = '';
                  btnContainer.style.gap = '';
                  btnContainer.style.gridTemplateColumns = '';
                }
              }
              
              // Restore all coordinate input fields
              coordInputs.forEach(input => {
                input.style.display = '';
              });
              
              // Reset icon positioning to default (remove minimized state offset)
              img.style.marginLeft = '';
              
              // Restore overlay to responsive dimensions
              overlay.style.padding = '10px';
              
              // Reset header styling to defaults
              header.style.textAlign = '';
              header.style.margin = '';
              header.style.marginBottom = '';
              
              // Reset drag bar spacing
              if (dragBar) {
                dragBar.style.marginBottom = '0.5em';
              }
              
              // Remove all fixed dimensions to allow responsive behavior
              // This ensures the overlay can adapt to content changes
              overlay.style.width = '';
              overlay.style.height = '';
            }
            
            // Update mini tracker visibility based on collapse setting
            updateMiniTracker();
            
            // ==================== ACCESSIBILITY AND USER FEEDBACK ====================
            // Update accessibility information for screen readers and tooltips
            
            // Update alt text to reflect current state for screen readers and tooltips
            img.alt = isMinimized ? 
              'Blue Marble Icon - Minimized (Click to maximize)' : 
              'Blue Marble Icon - Maximized (Click to minimize)';
            
            // No status message needed - state change is visually obvious to users
          });
        }
      ).buildElement()
      .addHeader(1, {'textContent': 'Skirk Marble'}).buildElement()
    .buildElement()

    .addDiv({ id: 'bm-separator' })
      .addHr().buildElement()
      .addDiv({ id: 'bm-separator-text'})
        .addDiv({ innerHTML: icons.informationIcon }).buildElement()
        .addP({ textContent: 'Information' }).buildElement()
        .buildElement()
      .addHr().buildElement()
    .buildElement()

    .addDiv({'id': 'bm-contain-userinfo'})
      .addDiv({'id': 'bm-user-name'})
        .addDiv({'id': 'bm-user-icon', innerHTML: icons.userIcon}).buildElement()
        .addP({'id': 'bm-user-name-content', innerHTML: '<b>Username:</b> loading...'}).buildElement()
      .buildElement()
      .addDiv({'id': 'bm-user-droplets'})
        .addDiv({'id': 'bm-user-droplets-icon', innerHTML: icons.dropletIcon}).buildElement()
        .addP({'id': 'bm-user-droplets-content', innerHTML: '<b>Droplets:</b> loading...'}).buildElement()
      .buildElement()
      .addDiv({'id': 'bm-user-nextlevel'})
        .addDiv({'id': 'bm-user-nextlevel-icon', innerHTML: icons.nextLevelIcon}).buildElement()
        .addP({'id': 'bm-user-nextlevel-content', 'textContent': 'Next level in...'}).buildElement()
      .buildElement()
    .buildElement()

    .addDiv({ id: 'bm-separator' })
      .addHr().buildElement()
      .addDiv({ id: 'bm-separator-text'})
        .addDiv({ innerHTML: icons.templateIcon }).buildElement()
        .addP({ textContent: 'Template' }).buildElement()
        .buildElement()
      .addHr().buildElement()
    .buildElement()

    .addDiv({'id': 'bm-contain-automation'})
      // .addCheckbox({'id': 'bm-input-stealth', 'textContent': 'Stealth', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Waits for the website to make requests, instead of sending requests.'}).buildElement()
      // .addBr().buildElement()
      // .addCheckbox({'id': 'bm-input-possessed', 'textContent': 'Possessed', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Controls the website as if it were possessed.'}).buildElement()
      // .addBr().buildElement()
      .addDiv({'id': 'bm-contain-coords'})
        .addDiv({ id: 'bm-coords-title' })
          .addDiv({ innerHTML: icons.pinIcon }).buildElement()
          .addP({ innerHTML: 'Coordinates:' }).buildElement()
          .addButton({'id': 'bm-button-coords', 'innerHTML': icons.pointerIcon + 'Detect', title: 'Set the location to the pixel you\'ve selected'},
            (instance, button) => {
              button.onclick = () => {
                const coords = instance.apiManager?.coordsTilePixel; // Retrieves the coords from the API manager
                if (!coords?.[0]) {
                  instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?');
                  return;
                }
                instance.updateInnerHTML('bm-input-tx', coords?.[0] || '');
                instance.updateInnerHTML('bm-input-ty', coords?.[1] || '');
                instance.updateInnerHTML('bm-input-px', coords?.[2] || '');
                instance.updateInnerHTML('bm-input-py', coords?.[3] || '');
              }
            }
          ).buildElement()
        .buildElement()
        .addDiv({ id: 'bm-contain-inputs'})
          .addP({ textContent: 'Tile: '}).buildElement()
          .addInput({'type': 'number', 'id': 'bm-input-tx', 'placeholder': 'T1 X', 'min': 0, 'max': 2047, 'step': 1, 'required': true}).buildElement()
          .addInput({'type': 'number', 'id': 'bm-input-ty', 'placeholder': 'T1 Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true}).buildElement()
          .addInput({'type': 'number', 'id': 'bm-input-px', 'placeholder': 'Px X', 'min': 0, 'max': 2047, 'step': 1, 'required': true}).buildElement()
          .addInput({'type': 'number', 'id': 'bm-input-py', 'placeholder': 'Px Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true}).buildElement()
        .buildElement()
      .buildElement()
      .addDiv({'id': 'bm-contain-buttons-template'})
        .addInputFile({'id': 'bm-input-file-template', 'textContent': 'Upload Template', 'accept': 'image/png, image/jpeg, image/webp, image/bmp, image/gif'})
        // Compact delete button placed next to Upload Template
        .addButton({'id': 'bm-button-delete-templates', innerHTML: icons.deleteIcon, 'title': 'Delete Template'}, (instance, button) => {
          button.onclick = () => {
            deleteSelectedTemplate(instance);
          }
        }).buildElement()
        .addButton({'id': 'bm-button-create', innerHTML: icons.createIcon + 'Create'}, (instance, button) => {
          button.onclick = () => {
            const input = document.querySelector('#bm-input-file-template');

            const coordTlX = document.querySelector('#bm-input-tx');
            if (!coordTlX.checkValidity()) {coordTlX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            const coordTlY = document.querySelector('#bm-input-ty');
            if (!coordTlY.checkValidity()) {coordTlY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            const coordPxX = document.querySelector('#bm-input-px');
            if (!coordPxX.checkValidity()) {coordPxX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            const coordPxY = document.querySelector('#bm-input-py');
            if (!coordPxY.checkValidity()) {coordPxY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}

            // Kills itself if there is no file
            if (!input?.files[0]) {instance.handleDisplayError(`No file selected!`); return;}

            templateManager.createTemplate(input.files[0], input.files[0]?.name.replace(/\.[^/.]+$/, ''), [Number(coordTlX.value), Number(coordTlY.value), Number(coordPxX.value), Number(coordPxY.value)]);

            // Update mini tracker after template creation
            setTimeout(() => updateMiniTracker(), 500);

            // console.log(`TCoords: ${apiManager.templateCoordsTilePixel}\nCoords: ${apiManager.coordsTilePixel}`);
            // apiManager.templateCoordsTilePixel = apiManager.coordsTilePixel; // Update template coords
            // console.log(`TCoords: ${apiManager.templateCoordsTilePixel}\nCoords: ${apiManager.coordsTilePixel}`);
            // templateManager.setTemplateImage(input.files[0]);

                      instance.handleDisplayStatus(`Drew to canvas!`);
        }
      }).buildElement()
      .addButton({'id': 'bm-button-enable', innerHTML: icons.enableIcon + 'Enable'}, (instance, button) => {
        button.onclick = () => {
          instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(true);
          instance.handleDisplayStatus(`Enabled templates!`);
        }
      }).buildElement()
      .addButton({'id': 'bm-button-disable', innerHTML: icons.disableIcon + 'Disable'}, (instance, button) => {
        button.onclick = () => {
          instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(false);
          instance.handleDisplayStatus(`Disabled templates!`);
        }
      }).buildElement()
      .addButton({'id': 'bm-button-pause-tiles', innerHTML: icons.disableIcon + (isTileRefreshPaused() ? 'Resume Tiles' : 'Pause Tiles')}, (instance, button) => {
        button.onclick = () => {
          const isPaused = toggleTileRefreshPause(templateManager);
          const cachedCount = getCachedTileCount();
          
          button.innerHTML = `${icons.disableIcon} ${isPaused ? 'Resume Tiles' : 'Pause Tiles'}${isPaused && cachedCount > 0 ? ` (${cachedCount})` : ''}`;
          button.style.background = isPaused ? 
            'linear-gradient(135deg, #4CAF50, #45a049)' : 
            'linear-gradient(135deg, #ff9800, #f57c00)';
          
          instance.handleDisplayStatus(isPaused ? 
            `🧊 Tile refresh paused! Showing frozen template view with ${cachedCount} cached tiles for better performance.` : 
            '▶️ Tile refresh resumed - templates now update in real-time'
          );
        }
      }).buildElement()
      .buildElement()
      .buildElement()
      .addButton({'id': 'bm-button-color-filter', innerHTML: icons.colorFilterIcon + 'Color Filter'}, (instance, button) => {
        button.onclick = () => {
          buildColorFilterOverlay();
        }
      }).buildElement()
      .addTextarea({'id': overlayMain.outputStatusId, 'placeholder': `Status: Sleeping...\nVersion: ${version}`, 'readOnly': true}).buildElement()
      .addDiv({'id': 'bm-contain-buttons-action'})
        .addDiv()
          // .addButton({'id': 'bm-button-teleport', 'className': 'bm-help', 'textContent': '✈'}).buildElement()
          // .addButton({'id': 'bm-button-favorite', 'className': 'bm-help', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><polygon points="10,2 12,7.5 18,7.5 13.5,11.5 15.5,18 10,14 4.5,18 6.5,11.5 2,7.5 8,7.5" fill="white"></polygon></svg>'}).buildElement()
          // .addButton({'id': 'bm-button-templates', 'className': 'bm-help', 'innerHTML': '🖌'}).buildElement()
          .addButton({'id': 'bm-button-convert', 'className': 'bm-help', 'innerHTML': '🎨', 'title': 'Template Color Converter'}, 
            (instance, button) => {
            button.addEventListener('click', () => {
              window.open('https://pepoafonso.github.io/color_converter_wplace/', '_blank', 'noopener noreferrer');
            });
          }).buildElement()
        .buildElement()
        .addSmall({'textContent': 'Made by SwingTheVine | Fork Seris0', 'style': 'margin-top: auto;'}).buildElement()
      .buildElement()
    .buildElement()
  .buildOverlay(document.body);
}

function buildOverlayTabTemplate() {
  overlayTabTemplate.addDiv({'id': 'bm-tab-template', 'style': 'top: 20%; left: 10%;'})
      .addDiv()
        .addDiv({'className': 'bm-dragbar'}).buildElement()
        .addButton({'className': 'bm-button-minimize', 'textContent': '↑'},
          (instance, button) => {
            button.onclick = () => {
              let isMinimized = false;
              if (button.textContent == '↑') {
                button.textContent = '↓';
              } else {
                button.textContent = '↑';
                isMinimized = true;
              }

              
            }
          }
        ).buildElement()
      .buildElement()
    .buildElement()
  .buildOverlay();
}

/** Builds and displays the color filter overlay
 * @since 1.0.0
 */
function buildColorFilterOverlay() {
  // Check if templates are available
  if (!templateManager.templatesArray || templateManager.templatesArray.length === 0) {
    overlayMain.handleDisplayError('No templates available for color filtering!');
    return;
  }

  // Remove existing color filter overlay if it exists
  const existingOverlay = document.getElementById('bm-color-filter-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  consoleLog('🎯 [Color Filter] Starting color filter overlay build...');

  // Check if mobile mode is enabled
  const isMobileMode = getMobileMode();
  consoleLog(`📱 [Color Filter] Mobile mode: ${isMobileMode ? 'enabled' : 'disabled'}`);

  // Import the color palette from utils
  import('./utils.js').then(utils => {
    const colorPalette = utils.colorpalette;
    
    // Get enhanced pixel analysis data
    consoleLog('🎯 [Color Filter] Calculating pixel statistics...');
    const pixelStats = templateManager.calculateRemainingPixelsByColor();
    consoleLog('🎯 [Color Filter] Pixel statistics received:', pixelStats);
    
    // Calculate overall progress
    let totalRequired = 0;
    let totalPainted = 0;
    let totalNeedCrosshair = 0;
    let totalWrong = 0;
    
    // Get wrong pixels from tile progress data (only once)
    if (templateManager.tileProgress && templateManager.tileProgress.size > 0) {
      for (const tileStats of templateManager.tileProgress.values()) {
        if (tileStats.colorBreakdown) {
          for (const colorStats of Object.values(tileStats.colorBreakdown)) {
            totalWrong += colorStats.wrong || 0;
          }
        }
      }
    }
    
    for (const stats of Object.values(pixelStats)) {
      totalRequired += stats.totalRequired || 0;
      totalPainted += stats.painted || 0;
      totalNeedCrosshair += stats.needsCrosshair || 0;
    }
    
    // Apply wrong color logic based on settings
    let overallProgress, displayPainted, displayRequired;
    
    if (templateManager.getIncludeWrongColorsInProgress()) {
      // Include wrong colors in progress calculation (wrong pixels count as "painted")
      displayPainted = totalPainted + totalWrong;
      displayRequired = totalRequired; // Keep original required, wrong pixels are already part of it
      overallProgress = displayRequired > 0 ? Math.round((displayPainted / displayRequired) * 100) : 0;
      consoleLog(`🎯 [Color Filter] Overall progress (including wrong): ${displayPainted}/${displayRequired} (${overallProgress}%) - ${totalNeedCrosshair} need crosshair, ${totalWrong} wrong included`);
    } else {
      // Standard calculation (exclude wrong colors)
      displayPainted = totalPainted;
      displayRequired = totalRequired;
      overallProgress = displayRequired > 0 ? Math.round((displayPainted / displayRequired) * 100) : 0;
      consoleLog(`🎯 [Color Filter] Overall progress: ${displayPainted}/${displayRequired} (${overallProgress}%) - ${totalNeedCrosshair} need crosshair, ${totalWrong} wrong excluded`);
    }
    
    // Inject compact modern styles for Color Filter UI (once)
    if (!document.getElementById('bmcf-styles')) {
      const s = document.createElement('style');
      s.id = 'bmcf-styles';
      s.textContent = `
        :root { 
          --slate-50: #f8fafc; --slate-100: #f1f5f9; --slate-200: #e2e8f0; --slate-300: #cbd5e1; 
          --slate-400: #94a3b8; --slate-500: #64748b; --slate-600: #475569; --slate-700: #334155; 
          --slate-750: #293548; --slate-800: #1e293b; --slate-900: #0f172a; --slate-950: #020617;
          --blue-400: #60a5fa; --blue-500: #3b82f6; --blue-600: #2563eb; --blue-700: #1d4ed8;
          --emerald-400: #34d399; --emerald-500: #10b981; --emerald-600: #059669; --emerald-700: #047857;
          --bmcf-bg: var(--slate-900); --bmcf-card: var(--slate-800); --bmcf-border: var(--slate-700); 
          --bmcf-muted: var(--slate-400); --bmcf-text: var(--slate-100); --bmcf-text-muted: var(--slate-300);
        }
        .bmcf-overlay { 
          width: min(94vw, 670px); max-height: 88vh; background: var(--bmcf-bg); color: var(--bmcf-text); 
          border-radius: 20px; border: 1px solid var(--bmcf-border); 
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05); 
          display: flex; flex-direction: column; overflow: hidden; 
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
          backdrop-filter: blur(16px); position: relative;
        }
        .bmcf-overlay::before {
          content: ''; position: absolute; inset: 0; border-radius: 20px; 
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(16, 185, 129, 0.05)); 
          pointer-events: none;
        }
        .bmcf-header { 
          display: flex; flex-direction: column; padding: 16px 20px 12px 20px; 
          border-bottom: 1px solid var(--bmcf-border); 
          background: linear-gradient(135deg, var(--slate-800), var(--slate-750)); 
          position: relative; z-index: 1;
        }
        .bmcf-content { padding: 20px; overflow: auto; position: relative; z-index: 1; }
        .bmcf-footer { 
          display: flex; gap: 12px; justify-content: center; align-items: center; padding: 16px 20px; 
          border-top: 1px solid var(--bmcf-border); 
          background: linear-gradient(135deg, var(--slate-800), var(--slate-750)); 
          position: relative; z-index: 1;
        }
        .bmcf-btn { 
          display: inline-flex; align-items: center; justify-content: center; height: 40px; 
          padding: 0 18px; min-width: 120px; border-radius: 12px; border: 1px solid var(--bmcf-border); 
          font-size: 0.9em; font-weight: 600; white-space: nowrap; cursor: pointer; 
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); position: relative; overflow: hidden;
          background: var(--slate-700); color: var(--bmcf-text);
        }
        .bmcf-btn::before {
          content: ''; position: absolute; inset: 0; border-radius: 12px; 
          background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05)); 
          opacity: 0; transition: opacity 0.2s ease;
        }
        .bmcf-btn:hover::before { opacity: 1; }
        .bmcf-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.3); }
        .bmcf-btn.success { 
          background: linear-gradient(135deg, var(--emerald-500), var(--emerald-600)); 
          color: white; border-color: var(--emerald-600);
        }
        .bmcf-btn.success:hover { 
          background: linear-gradient(135deg, var(--emerald-600), var(--emerald-700)); 
          box-shadow: 0 8px 25px rgba(16, 185, 129, 0.4);
        }
        .bmcf-btn.primary { 
          background: linear-gradient(135deg, var(--blue-500), var(--blue-600)); 
          color: white; border-color: var(--blue-600);
        }
        .bmcf-btn.primary:hover { 
          background: linear-gradient(135deg, var(--blue-600), var(--blue-700)); 
          box-shadow: 0 8px 25px rgba(59, 130, 246, 0.4);
        }
        .bmcf-input { 
          width: 100%; height: 44px; padding: 12px 16px; border-radius: 12px; 
          border: 1px solid var(--bmcf-border); background: var(--slate-800); color: var(--bmcf-text); 
          outline: none; font-size: 0.95em; transition: all 0.2s ease;
        }
        .bmcf-input:focus { 
          border-color: var(--blue-500); 
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2), 0 4px 12px rgba(59, 130, 246, 0.15); 
        }
        @media (max-width: 520px) { .bmcf-btn { min-width: 100px; height: 36px; font-size: 0.85em; } }
        
        /* Mobile Mode will be applied dynamically via applyMobileModeToColorFilter() */
      `;
      document.head.appendChild(s);
    }

    // Create the color filter overlay
    const colorFilterOverlay = document.createElement('div');
    colorFilterOverlay.id = 'bm-color-filter-overlay';
    colorFilterOverlay.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9001;
      ${isMobileMode ? 'max-width: 95vw; max-height: 90vh;' : ''}
    `;
    colorFilterOverlay.className = 'bmcf-overlay';

    // Header
    const header = document.createElement('div');
    header.className = 'bmcf-header';
    header.style.cssText = `cursor: move; user-select:none; flex-shrink:0; flex-direction: column;`;

    // Drag bar (similar to main overlay)
    const dragBar = document.createElement('div');
    dragBar.className = 'bmcf-drag-bar';
    dragBar.style.cssText = `
      background: linear-gradient(90deg, #475569 0%, #64748b 50%, #475569 100%);
      border-radius: 4px;
      cursor: grab;
      width: 100%;
      height: 6px;
      margin-bottom: 8px;
      opacity: 0.8;
      transition: opacity 0.2s ease;
    `;

    // Drag bar hover effect
    dragBar.addEventListener('mouseenter', () => {
      dragBar.style.opacity = '1';
    });
    dragBar.addEventListener('mouseleave', () => {
      dragBar.style.opacity = '0.8';
    });

    // Container for title and close button
    const titleContainer = document.createElement('div');
    titleContainer.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
    `;

    const title = document.createElement('h2');
    title.textContent = 'Template Color Filter';
    title.style.cssText = `
      margin: 0; 
      font-size: 1.5em; 
      font-weight: 700;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      text-align: center;
      flex: 1;
      pointer-events: none;
      letter-spacing: -0.025em;
      background: linear-gradient(135deg, var(--slate-100), var(--slate-300));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    `;

    const closeButton = document.createElement('button');
    closeButton.textContent = '✕';
    closeButton.style.cssText = `
      background: linear-gradient(135deg, #ef4444, #dc2626);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: white;
      width: 36px;
      height: 36px;
      border-radius: 12px;
      cursor: pointer;
      font-size: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    `;
    closeButton.onmouseover = () => {
      closeButton.style.transform = 'translateY(-1px) scale(1.05)';
      closeButton.style.boxShadow = '0 6px 20px rgba(239, 68, 68, 0.4)';
    };
    closeButton.onmouseout = () => {
      closeButton.style.transform = '';
      closeButton.style.boxShadow = '';
    };
    closeButton.onclick = () => colorFilterOverlay.remove();

    // Settings button 
    const settingsButton = document.createElement('button');
    settingsButton.innerHTML = icons.settingsIcon;
    settingsButton.style.cssText = `
      background: linear-gradient(135deg, var(--slate-600), var(--slate-700));
      border: 1px solid var(--slate-500);
      color: var(--slate-200);
      width: 36px;
      height: 36px;
      border-radius: 12px;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 12px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    `;
    settingsButton.onmouseover = () => {
      settingsButton.style.transform = 'translateY(-1px) scale(1.05)';
      settingsButton.style.background = 'linear-gradient(135deg, var(--slate-500), var(--slate-600))';
      settingsButton.style.boxShadow = '0 6px 20px rgba(71, 85, 105, 0.3)';
    };
    settingsButton.onmouseout = () => {
      settingsButton.style.transform = '';
      settingsButton.style.background = 'linear-gradient(135deg, var(--slate-600), var(--slate-700))';
      settingsButton.style.boxShadow = '';
    };
    settingsButton.onclick = () => buildCrosshairSettingsOverlay();

    // Add elements to titleContainer
    titleContainer.appendChild(title);
    titleContainer.appendChild(settingsButton);
    titleContainer.appendChild(closeButton);

    // Add drag bar and titleContainer to header
    header.appendChild(dragBar);
    header.appendChild(titleContainer);

    // Progress Summary
    const progressSummary = document.createElement('div');
    progressSummary.style.cssText = `
      background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
      border: 1px solid var(--bmcf-border);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 24px;
      color: var(--bmcf-text);
      text-align: center;
      position: relative;
      overflow: hidden;
    `;
    
    // Add subtle background pattern
    progressSummary.innerHTML = `
      <div style="
        position: absolute; inset: 0; 
        background: radial-gradient(circle at 20% 20%, rgba(59, 130, 246, 0.1), transparent 50%),
                    radial-gradient(circle at 80% 80%, rgba(16, 185, 129, 0.08), transparent 50%);
        pointer-events: none;
      "></div>
      <div style="position: relative; z-index: 1;">
        <div style="
          font-size: 1.2em; font-weight: 700; margin-bottom: 12px; 
          color: var(--bmcf-text);
        ">
          <span style="margin-right: 8px;">📊</span>
          <span style="
            background: linear-gradient(135deg, var(--blue-400), var(--emerald-400));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          ">Template Progress: ${overallProgress}%</span>
        </div>
        <div style="font-size: 0.95em; color: var(--bmcf-text-muted); margin-bottom: 16px; line-height: 1.5;">
          ${displayPainted.toLocaleString()} / ${displayRequired.toLocaleString()} pixels painted
          ${templateManager.getIncludeWrongColorsInProgress() ? ` (includes ${totalWrong.toLocaleString()} wrong)` : ''}
        </div>
        <div style="
          width: 100%; height: 12px; background: var(--slate-700); 
          border-radius: 8px; overflow: hidden; position: relative;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
        ">
          <div style="
            width: ${overallProgress}%; height: 100%; 
            background: linear-gradient(90deg, var(--blue-500), var(--emerald-500)); 
            transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
          ">
            <div style="
              position: absolute; inset: 0; 
              background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
              animation: shimmer 2s infinite;
            "></div>
          </div>
        </div>
        <div style="
          font-size: 0.85em; color: #fbbf24; margin-top: 12px; font-weight: 600;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        ">
          ${totalNeedCrosshair.toLocaleString()} Pixels Remaining
        </div>
      </div>
      <style>
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      </style>
    `;

    // Include Wrong Color Pixels in Progress - moved below progress bar
    const includeWrongProgressContainer = document.createElement('div');
    includeWrongProgressContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
      border-radius: 12px;
      border: 1px solid var(--bmcf-border);
      margin-bottom: 24px;
      transition: all 0.2s ease;
      cursor: pointer;
    `;
    includeWrongProgressContainer.onmouseover = () => {
      includeWrongProgressContainer.style.background = 'linear-gradient(135deg, var(--slate-750), var(--slate-700))';
      includeWrongProgressContainer.style.transform = 'translateY(-1px)';
    };
    includeWrongProgressContainer.onmouseout = () => {
      includeWrongProgressContainer.style.background = 'linear-gradient(135deg, var(--slate-800), var(--slate-750))';
      includeWrongProgressContainer.style.transform = '';
    };

    const includeWrongProgressCheckbox = document.createElement('input');
    includeWrongProgressCheckbox.type = 'checkbox';
    includeWrongProgressCheckbox.id = 'bm-include-wrong-progress';
    includeWrongProgressCheckbox.checked = templateManager.getIncludeWrongColorsInProgress();
    includeWrongProgressCheckbox.style.cssText = `
      width: 18px;
      height: 18px;
      cursor: pointer;
      accent-color: var(--blue-500);
      border-radius: 4px;
    `;

    const includeWrongProgressLabel = document.createElement('label');
    includeWrongProgressLabel.htmlFor = 'bm-include-wrong-progress';
    includeWrongProgressLabel.textContent = 'Include Wrong Color Pixels in Progress';
    includeWrongProgressLabel.style.cssText = `
      color: var(--bmcf-text);
      font-size: 0.95em;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
      flex: 1;
      letter-spacing: -0.01em;
    `;

    // Event listener for include wrong colors in progress
    includeWrongProgressCheckbox.addEventListener('change', async () => {
      const enabled = includeWrongProgressCheckbox.checked;
      await templateManager.setIncludeWrongColorsInProgress(enabled);
      overlayMain.handleDisplayStatus(`Include wrong colors in progress ${enabled ? 'enabled' : 'disabled'}!`);
      
      // Force refresh color filter overlay to update progress calculations immediately
      buildColorFilterOverlay();
    });

    includeWrongProgressContainer.appendChild(includeWrongProgressCheckbox);
    includeWrongProgressContainer.appendChild(includeWrongProgressLabel);

    // Instructions
    const instructions = document.createElement('p');
    instructions.textContent = 'Click on colors to toggle their visibility in the template.';
    instructions.style.cssText = `
      margin: 0 0 24px 0; 
      font-size: 0.95em; 
      color: var(--bmcf-text-muted); 
      text-align: center; 
      font-weight: 500;
      letter-spacing: -0.01em;
      line-height: 1.4;
    `;

    // Search box
    const searchContainer = document.createElement('div');
    searchContainer.style.cssText = `
      margin: 0 0 24px 0;
      position: relative;
    `;

    const searchInput = document.createElement('input');
    searchInput.className = 'bmcf-input';
    searchInput.type = 'text';
    searchInput.id = 'bm-color-search';
    searchInput.placeholder = 'Search colors by name or RGB (e.g., "red", "255,0,0")...';
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;
    searchInput.style.cssText = `
      width: 100%;
      padding: 14px 50px 14px 48px;
      border: 1px solid var(--bmcf-border);
      border-radius: 12px;
      background: var(--slate-800);
      color: var(--bmcf-text);
      font-size: 0.95em;
      font-weight: 400;
      outline: none;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-sizing: border-box;
      font-family: inherit;
      -webkit-user-select: text;
      -moz-user-select: text;
      -ms-user-select: text;
      user-select: text;
      pointer-events: auto;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    `;

    const searchIcon = document.createElement('div');
    searchIcon.innerHTML = '🔍';
    searchIcon.style.cssText = `
      position: absolute;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 1.2em;
      pointer-events: none;
      opacity: 0.6;
    `;

    const searchClearButton = document.createElement('button');
    searchClearButton.innerHTML = '✕';
    searchClearButton.style.cssText = `
      position: absolute;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      background: var(--slate-600);
      border: 1px solid var(--slate-500);
      border-radius: 8px;
      color: var(--slate-300);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      display: none;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    `;
    searchClearButton.onmouseover = () => {
      searchClearButton.style.background = 'var(--slate-500)';
      searchClearButton.style.color = 'var(--slate-100)';
    };
    searchClearButton.onmouseout = () => {
      searchClearButton.style.background = 'var(--slate-600)';
      searchClearButton.style.color = 'var(--slate-300)';
    };

    searchContainer.appendChild(searchInput);
    searchContainer.appendChild(searchIcon);
    searchContainer.appendChild(searchClearButton);

    // Search functionality
    const performSearch = (searchTerm) => {
      const term = searchTerm.toLowerCase().trim();
      const colorItems = colorGrid.querySelectorAll('[data-color-item]');
      let visibleCount = 0;

      colorItems.forEach(item => {
        const colorName = item.getAttribute('data-color-name').toLowerCase();
        const colorRgb = item.getAttribute('data-color-rgb');
        
        // Search by name or RGB values
        const matchesName = colorName.includes(term);
        const matchesRgb = colorRgb.includes(term);
        const matchesRgbFormatted = colorRgb.replace(/,/g, ' ').includes(term);
        
        if (term === '' || matchesName || matchesRgb || matchesRgbFormatted) {
          item.style.display = 'flex';
          visibleCount++;
        } else {
          item.style.display = 'none';
        }
      });

      // Show/hide clear button
      if (term) {
        searchClearButton.style.display = 'flex';
      } else {
        searchClearButton.style.display = 'none';
      }

      // Update search input border color based on results
      if (term && visibleCount === 0) {
        searchInput.style.borderColor = '#ef4444'; // Red if no results
        searchInput.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.2)';
      } else {
        searchInput.style.borderColor = 'var(--bmcf-border)'; // Default
        searchInput.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
      }
    };

    // Search input event listeners
    searchInput.addEventListener('input', (e) => {
      performSearch(e.target.value);
    });

    searchInput.addEventListener('focus', () => {
      searchInput.style.borderColor = 'var(--blue-500)';
      searchInput.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.2), 0 4px 12px rgba(59, 130, 246, 0.15)';
    });

    searchInput.addEventListener('blur', () => {
      if (!searchInput.value) {
        searchInput.style.borderColor = 'var(--bmcf-border)';
        searchInput.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
      }
    });

    // Prevent any interference with spacebar and other keys
    searchInput.addEventListener('keydown', (e) => {
      // Allow all normal typing including spacebar
      e.stopPropagation();
    });

    searchInput.addEventListener('keyup', (e) => {
      // Allow all normal typing including spacebar
      e.stopPropagation();
    });

    searchInput.addEventListener('keypress', (e) => {
      // Allow all normal typing including spacebar
      e.stopPropagation();
    });

    // Clear button functionality
    searchClearButton.addEventListener('click', () => {
      searchInput.value = '';
      performSearch('');
      searchInput.focus();
    });

    // Color Filter/Sort Section
    const filterContainer = document.createElement('div');
    filterContainer.style.cssText = `
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    `;

    const filterLabel = document.createElement('label');
    filterLabel.textContent = 'Sort by:';
    filterLabel.style.cssText = `
      color: white;
      font-size: 0.9em;
      font-weight: bold;
      min-width: 60px;
    `;

    const filterSelect = document.createElement('select');
    filterSelect.style.cssText = `
      flex: 1;
      padding: 6px 14px;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.3);
      color: white;
      font-size: 0.9em;
      outline: none;
      cursor: pointer;
    `;

    // Filter options
    const filterOptions = [
      { value: 'default', text: 'Default Order' },
      { value: 'enhanced', text: 'Enhanced Colors Only' },
      { value: 'wrong-desc', text: 'Most Wrong Colors' },
      { value: 'wrong-asc', text: 'Least Wrong Colors' },
      { value: 'missing-desc', text: 'Most Pixels Missing' },
      { value: 'missing-asc', text: 'Least Pixels Missing' },
      { value: 'total-desc', text: 'Most Total Pixels' },
      { value: 'total-asc', text: 'Least Total Pixels' },
      { value: 'percentage-desc', text: 'Highest Completion %' },
      { value: 'percentage-asc', text: 'Lowest Completion %' },
      { value: 'name-asc', text: 'Name A-Z' },
      { value: 'name-desc', text: 'Name Z-A' }
    ];

    filterOptions.forEach(option => {
      const optionElement = document.createElement('option');
      optionElement.value = option.value;
      optionElement.textContent = option.text;
      optionElement.style.cssText = `
        background: #2a2a2a;
        color: white;
      `;
      filterSelect.appendChild(optionElement);
    });

    // Store original order when color items are created
    let originalOrder = [];

    filterContainer.appendChild(filterLabel);
    filterContainer.appendChild(filterSelect);

    // Enhanced mode info section
    const enhancedSection = document.createElement('div');
    enhancedSection.style.cssText = `
      margin-bottom: 20px;
    `;

    const enhancedInfo = document.createElement('div');
    enhancedInfo.textContent = 'Enhanced: Highlight the Pixels.';
    enhancedInfo.style.cssText = `
      background: #333;
      color: white;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 0.9em;
      font-weight: bold;
      text-align: center;
      margin-bottom: 10px;
    `;

    // Main buttons container (Enable All / Disable All)
    const mainButtonsContainer = document.createElement('div');
    mainButtonsContainer.style.cssText = `
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
    `;

    const enableAllButton = document.createElement('button');
    enableAllButton.textContent = 'Enable All';
    enableAllButton.style.cssText = `
      background: #4caf50;
      border: none;
      color: white;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9em;
      white-space: nowrap;
      flex: 1;
    `;

    const disableAllButton = document.createElement('button');
    disableAllButton.textContent = 'Disable All';
    disableAllButton.style.cssText = `
      background: #f44336;
      border: none;
      color: white;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9em;
      white-space: nowrap;
      flex: 1;
    `;

    // Disable Enhanced button (full width below)
    const disableAllEnhancedButton = document.createElement('button');
    disableAllEnhancedButton.textContent = 'Disable all Enhanced';
    disableAllEnhancedButton.style.cssText = `
      background: #6c757d;
      color: white;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      width: 100%;
      font-size: 0.9em;
    `;

    mainButtonsContainer.appendChild(enableAllButton);
    mainButtonsContainer.appendChild(disableAllButton);
    
    enhancedSection.appendChild(enhancedInfo);
    enhancedSection.appendChild(mainButtonsContainer);
    enhancedSection.appendChild(disableAllEnhancedButton);

    // Enhance Wrong Colors - moved below Disable All Enhanced
    const enhanceWrongContainer = document.createElement('div');
    enhanceWrongContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      margin-top: 10px;
    `;

    const enhanceWrongCheckbox = document.createElement('input');
    enhanceWrongCheckbox.type = 'checkbox';
    enhanceWrongCheckbox.id = 'bm-enhance-wrong-enhanced';
    enhanceWrongCheckbox.checked = templateManager.getEnhanceWrongColors();
    enhanceWrongCheckbox.style.cssText = `
      width: 16px;
      height: 16px;
      cursor: pointer;
    `;

    const enhanceWrongLabel = document.createElement('label');
    enhanceWrongLabel.htmlFor = 'bm-enhance-wrong-enhanced';
    enhanceWrongLabel.textContent = 'Enhance Wrong Colors (Crosshair)';
    enhanceWrongLabel.style.cssText = `
      color: white;
      font-size: 0.9em;
      cursor: pointer;
      user-select: none;
      flex: 1;
    `;

    // Event listener for enhance wrong colors
    enhanceWrongCheckbox.addEventListener('change', async () => {
      const enabled = enhanceWrongCheckbox.checked;
      await templateManager.setEnhanceWrongColors(enabled);
      overlayMain.handleDisplayStatus(`Wrong colors crosshair ${enabled ? 'enabled' : 'disabled'}!`);
      
      // Force template redraw to apply enhanced mode changes
      if (window.forceTemplateRedraw) {
        window.forceTemplateRedraw();
      }
    });

    enhanceWrongContainer.appendChild(enhanceWrongCheckbox);
    enhanceWrongContainer.appendChild(enhanceWrongLabel);
    enhancedSection.appendChild(enhanceWrongContainer);







    // Color grid
    const colorGrid = document.createElement('div');
    colorGrid.className = 'bmcf-grid';
    colorGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 20px;
      justify-content: center;
    `;

    // Get current template
    const currentTemplate = templateManager.templatesArray[0];

    // Create color items
    colorPalette.forEach((colorInfo, index) => {
      const colorItem = document.createElement('div');
      colorItem.className = 'bmcf-card';
      const rgb = colorInfo.rgb;
      const isFreeColor = colorInfo.free;
      const isDisabled = currentTemplate.isColorDisabled(rgb);
      const isEnhanced = currentTemplate.isColorEnhanced ? currentTemplate.isColorEnhanced(rgb) : false;
      
      // Add data attributes for search functionality
      colorItem.setAttribute('data-color-item', 'true');
      colorItem.setAttribute('data-color-name', colorInfo.name);
      colorItem.setAttribute('data-color-rgb', rgb.join(','));
      
      colorItem.style.cssText = `
        background: rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]});
        border: 3px solid ${isDisabled ? '#f44336' : '#4caf50'};
        border-radius: 8px;
        padding: 6px 6px 14px 6px;
        text-align: center;
        transition: all 0.2s ease;
        position: relative;
        width: 100%;
        height: 120px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        box-sizing: border-box;
        overflow: hidden;
      `;

      // Color info and controls container
      const controlsContainer = document.createElement('div');
      controlsContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        width: 100%;
        flex-shrink: 0;
      `;

      // Color enable/disable click area (main area)
      const colorClickArea = document.createElement('div');
      colorClickArea.style.cssText = `
        width: 100%;
        height: 20px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        flex-shrink: 0;
      `;

      // Add overlay for disabled state
      if (isDisabled) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(244, 67, 54, 0.3);
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 16px;
        `;
        overlay.textContent = '✕';
        colorClickArea.appendChild(overlay);
      }

      // Enhanced mode checkbox
      const enhancedContainer = document.createElement('div');
      enhancedContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: 2px;
        font-size: 9px;
        color: white;
        text-shadow: 1px 1px 1px rgba(0,0,0,0.8);
        font-weight: bold;
        flex-shrink: 0;
      `;

      const enhancedCheckbox = document.createElement('input');
      enhancedCheckbox.type = 'checkbox';
      enhancedCheckbox.checked = isEnhanced;
      enhancedCheckbox.disabled = isDisabled; // Disable checkbox if color is disabled
      enhancedCheckbox.style.cssText = `
        width: 12px;
        height: 12px;
        cursor: pointer;
      `;

      const enhancedLabel = document.createElement('label');
      enhancedLabel.textContent = 'Enhanced';
      enhancedLabel.style.cssText = `
        cursor: pointer;
        user-select: none;
      `;

      enhancedContainer.appendChild(enhancedCheckbox);
      enhancedContainer.appendChild(enhancedLabel);

      controlsContainer.appendChild(colorClickArea);
      controlsContainer.appendChild(enhancedContainer);
      colorItem.appendChild(controlsContainer);

      const colorName = document.createElement('div');
      colorName.textContent = colorInfo.name;
      colorName.style.cssText = `
        font-size: 0.75em;
        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
        color: white;
        font-weight: bold;
        z-index: 1;
        position: relative;
        text-align: center;
        margin-bottom: 1px;
        flex-shrink: 0;
        line-height: 1.1;
      `;

      const dropletIcon = document.createElement('div');
      dropletIcon.textContent = "💧";
      dropletIcon.style.cssText = `
        font-size: 0.7em;
        position: absolute;
        bottom: 2px;
        right: 4px;
        z-index: 2;
      `;

      // Add pixel statistics display
      const colorKey = `${rgb[0]},${rgb[1]},${rgb[2]}`;
      const stats = pixelStats[colorKey];
      const pixelStatsDisplay = document.createElement('div');
      
      if (stats && stats.totalRequired > 0) {
        // Get wrong pixels for this specific color from tile progress data
        let wrongPixelsForColor = 0;
        if (templateManager.tileProgress && templateManager.tileProgress.size > 0) {
          for (const tileStats of templateManager.tileProgress.values()) {
            if (tileStats.colorBreakdown && tileStats.colorBreakdown[colorKey]) {
              wrongPixelsForColor += tileStats.colorBreakdown[colorKey].wrong || 0;
            }
          }
        }

        // Apply wrong color logic to individual color progress
        let displayPainted, displayRequired, displayPercentage, displayRemaining;
        
        if (templateManager.getIncludeWrongColorsInProgress()) {
          // Include wrong colors in progress calculation for this specific color
          displayPainted = stats.painted + wrongPixelsForColor;
          displayRequired = stats.totalRequired; // Keep original required, wrong pixels are already part of it
          displayPercentage = displayRequired > 0 ? Math.round((displayPainted / displayRequired) * 100) : 0;
          displayRemaining = stats.needsCrosshair;
        } else {
          // Standard calculation (exclude wrong colors)
          displayPainted = stats.painted;
          displayRequired = stats.totalRequired;
          displayPercentage = stats.percentage || 0;
          displayRemaining = stats.totalRequired - stats.painted;
        }
        
        // Add data attributes for filtering/sorting
        colorItem.setAttribute('data-wrong-count', wrongPixelsForColor.toString());
        colorItem.setAttribute('data-missing-count', displayRemaining.toString());
        colorItem.setAttribute('data-total-count', displayRequired.toString());
        colorItem.setAttribute('data-painted-count', displayPainted.toString());
        
        // Create display text based on wrong color setting
        let displayText = `${displayPainted.toLocaleString()}/${displayRequired.toLocaleString()} (${displayPercentage}%)`;
        if (templateManager.getIncludeWrongColorsInProgress() && wrongPixelsForColor > 0) {
          displayText += `\n+${wrongPixelsForColor.toLocaleString()} wrong`;
        }
        
        pixelStatsDisplay.innerHTML = `
          <div style="font-size: 0.6em; color: rgba(255,255,255,0.9); text-shadow: 1px 1px 2px rgba(0,0,0,0.8); line-height: 1.1;">
            <div style="margin-bottom: 1px;">
              ${displayText}
            </div>
            <div style="color: rgba(255,255,255,0.7); font-size: 0.9em;">
              ${displayRemaining.toLocaleString()} Left
            </div>
          </div>
        `;

        // Fixed progress bar pinned to bottom of the card
        const progressTrack = document.createElement('div');
        progressTrack.style.cssText = `
          position: absolute;
          left: 20px;
          right: 20px;
          bottom: 6px;
          height: 4px;
          background: rgba(255,255,255,0.25);
          border-radius: 2px;
          overflow: hidden;
          pointer-events: none;
          z-index: 1;
        `;
        const progressFill = document.createElement('div');
        progressFill.style.cssText = `
          width: ${Math.min(displayPercentage, 100)}%;
          height: 100%;
          background: linear-gradient(90deg, #4CAF50, #8BC34A, #CDDC39);
          transition: width 0.3s ease;
        `;
        progressTrack.appendChild(progressFill);
        colorItem.appendChild(progressTrack);
        
        consoleLog(`🎯 [Color Filter] Displaying stats for ${colorInfo.name} (${colorKey}): ${displayPainted}/${displayRequired} (${displayPercentage}%) - ${displayRemaining} need crosshair${wrongPixelsForColor > 0 ? ` - includes ${wrongPixelsForColor} wrong` : ''}`);
      } else {
        pixelStatsDisplay.innerHTML = `
          <div style="font-size: 0.65em; color: rgba(255,255,255,0.6); text-shadow: 1px 1px 2px rgba(0,0,0,0.8);">
            Not Used
          </div>
        `;
        
        consoleLog(`🎯 [Color Filter] Color ${colorInfo.name} (${colorKey}) not used in template`);
      }
      
      pixelStatsDisplay.style.cssText = `
        z-index: 1;
        position: relative;
        padding: 2px 4px;
        text-align: center;
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-height: 0;
      `;

      colorItem.appendChild(colorName);
      colorItem.appendChild(pixelStatsDisplay);
      if (!isFreeColor){
        colorItem.appendChild(dropletIcon);
      }

      // Color enable/disable click handler (only on click area, not checkbox)
      colorClickArea.onclick = (e) => {
        e.stopPropagation(); // Prevent bubbling
        const wasDisabled = currentTemplate.isColorDisabled(rgb);
        if (wasDisabled) {
          currentTemplate.enableColor(rgb);
          colorItem.style.border = '3px solid #4caf50';
          const overlay = colorClickArea.querySelector('div[style*="position: absolute"]');
          if (overlay) overlay.remove();
          enhancedCheckbox.disabled = false;
        } else {
          currentTemplate.disableColor(rgb);
          colorItem.style.border = '3px solid #f44336';
          const overlay = document.createElement('div');
          overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(244, 67, 54, 0.3);
            border-radius: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 16px;
          `;
          overlay.textContent = '✕';
          colorClickArea.appendChild(overlay);
          enhancedCheckbox.disabled = true;
          enhancedCheckbox.checked = false;
        }
        
        // Refresh template display in real-time
        refreshTemplateDisplay().catch(error => {
          consoleError('Error refreshing template:', error);
        });
      };

      // Enhanced checkbox handler
      enhancedCheckbox.onchange = (e) => {
        e.stopPropagation(); // Prevent bubbling
        if (enhancedCheckbox.checked) {
          currentTemplate.enableColorEnhanced(rgb);
        } else {
          currentTemplate.disableColorEnhanced(rgb);
        }
        
        // Refresh template display in real-time
        refreshTemplateDisplay().catch(error => {
          consoleError('Error refreshing enhanced mode:', error);
        });
      };

      // Label click handler
      enhancedLabel.onclick = (e) => {
        e.stopPropagation();
        if (!enhancedCheckbox.disabled) {
          enhancedCheckbox.checked = !enhancedCheckbox.checked;
          enhancedCheckbox.onchange(e);
        }
      };

      colorGrid.appendChild(colorItem);
    });

    // Filter functionality - defined after color items are created
    const applyFilter = (filterType) => {
      const colorItems = Array.from(colorGrid.querySelectorAll('[data-color-item]'));
      
      // Save original order on first filter (if not already saved)
      if (originalOrder.length === 0) {
        originalOrder = [...colorItems];
      }
      
      if (filterType === 'default') {
        // Restore original order and show all items
        originalOrder.forEach(item => {
          item.style.display = 'flex';
          colorGrid.appendChild(item);
        });
        return;
      }
      
      if (filterType === 'enhanced') {
        // Filter to show only enhanced colors
        colorItems.forEach(item => {
          const enhancedCheckbox = item.querySelector('input[type="checkbox"]');
          if (enhancedCheckbox && enhancedCheckbox.checked) {
            item.style.display = 'flex';
          } else {
            item.style.display = 'none';
          }
        });
        return;
      }
      
      // Show all items for sorting
      colorItems.forEach(item => {
        item.style.display = 'flex';
      });
      
      colorItems.sort((a, b) => {
        const aWrong = parseInt(a.getAttribute('data-wrong-count') || '0');
        const bWrong = parseInt(b.getAttribute('data-wrong-count') || '0');
        const aMissing = parseInt(a.getAttribute('data-missing-count') || '0');
        const bMissing = parseInt(b.getAttribute('data-missing-count') || '0');
        const aTotal = parseInt(a.getAttribute('data-total-count') || '0');
        const bTotal = parseInt(b.getAttribute('data-total-count') || '0');
        const aName = a.getAttribute('data-color-name') || '';
        const bName = b.getAttribute('data-color-name') || '';
        const aPercentage = aTotal > 0 ? ((aTotal - aMissing) / aTotal) * 100 : 0;
        const bPercentage = bTotal > 0 ? ((bTotal - bMissing) / bTotal) * 100 : 0;

        switch (filterType) {
          case 'wrong-desc': return bWrong - aWrong;
          case 'wrong-asc': return aWrong - bWrong;
          case 'missing-desc': return bMissing - aMissing;
          case 'missing-asc': return aMissing - bMissing;
          case 'total-desc': return bTotal - aTotal;
          case 'total-asc': return aTotal - bTotal;
          case 'percentage-desc': return bPercentage - aPercentage;
          case 'percentage-asc': return aPercentage - bPercentage;
          case 'name-asc': return aName.localeCompare(bName);
          case 'name-desc': return bName.localeCompare(aName);
          default: return 0;
        }
      });

      // Reorder the DOM elements
      colorItems.forEach(item => {
        colorGrid.appendChild(item);
      });
    };

    // Add event listener for filter select
    filterSelect.addEventListener('change', () => {
      applyFilter(filterSelect.value);
    });

    // Enable/Disable all functionality
    enableAllButton.onclick = async () => {
      colorPalette.forEach((colorInfo) => {
        currentTemplate.enableColor(colorInfo.rgb);
      });
      colorFilterOverlay.remove();
      overlayMain.handleDisplayStatus('Enabling all colors...');
      
      try {
        await refreshTemplateDisplay();
        buildColorFilterOverlay(); // Rebuild to reflect changes
      } catch (error) {
        consoleError('Error enabling all colors:', error);
        overlayMain.handleDisplayError('Failed to enable all colors');
      }
    };

    disableAllButton.onclick = async () => {
      colorPalette.forEach((colorInfo) => {
        currentTemplate.disableColor(colorInfo.rgb);
      });
      colorFilterOverlay.remove();
      overlayMain.handleDisplayStatus('Disabling all colors...');
      
      try {
        await refreshTemplateDisplay();
        buildColorFilterOverlay(); // Rebuild to reflect changes
      } catch (error) {
        consoleError('Error disabling all colors:', error);
        overlayMain.handleDisplayError('Failed to disable all colors');
      }
    };

    // Disable all Enhanced: clears enhancedColors set and rebuilds
    disableAllEnhancedButton.onclick = async () => {
      // Visual feedback - button click animation
      const originalBg = disableAllEnhancedButton.style.background;
      const originalText = disableAllEnhancedButton.textContent;
      
      // Immediate click feedback
      disableAllEnhancedButton.style.background = '#dc3545'; // Red
      disableAllEnhancedButton.textContent = 'Disabling...';
      disableAllEnhancedButton.style.transform = 'scale(0.95)';
      disableAllEnhancedButton.style.transition = 'all 0.1s ease';
      
      try {
        const tmpl = templateManager.templatesArray?.[0];
        if (tmpl && tmpl.enhancedColors && tmpl.enhancedColors.size > 0) {
          tmpl.enhancedColors.clear();
          
          // Success feedback
          disableAllEnhancedButton.style.background = '#28a745'; // Green
          disableAllEnhancedButton.textContent = 'Disabled! ✓';
          
          // Trigger template refresh
          await refreshTemplateDisplay();
          buildColorFilterOverlay();
          
          // Reset button after 100ms
          setTimeout(() => {
            disableAllEnhancedButton.style.background = originalBg;
            disableAllEnhancedButton.textContent = originalText;
            disableAllEnhancedButton.style.transform = 'scale(1)';
          }, 100);
        } else {
          // No enhanced colors to disable
          disableAllEnhancedButton.style.background = '#ffc107'; // Yellow
          disableAllEnhancedButton.textContent = 'No Enhanced Colors';
          
          setTimeout(() => {
            disableAllEnhancedButton.style.background = originalBg;
            disableAllEnhancedButton.textContent = originalText;
            disableAllEnhancedButton.style.transform = 'scale(1)';
          }, 100);
        }
      } catch (error) {
        // Error feedback
        disableAllEnhancedButton.style.background = '#dc3545'; // Red
        disableAllEnhancedButton.textContent = 'Error! ✗';
        
        setTimeout(() => {
          disableAllEnhancedButton.style.background = originalBg;
          disableAllEnhancedButton.textContent = originalText;
          disableAllEnhancedButton.style.transform = 'scale(1)';
        }, 100);
        
        consoleError('Error disabling all enhanced colors:', error);
        overlayMain.handleDisplayError('Failed to disable all enhanced colors');
      }
    };

    // Create fixed footer with action buttons
    const footerContainer = document.createElement('div');
    footerContainer.className = 'bmcf-footer';

    // Refresh Statistics button
    const refreshStatsButton = document.createElement('button');
    refreshStatsButton.innerHTML = '🔄 Update Stats';
    refreshStatsButton.className = 'bmcf-btn success';

    refreshStatsButton.onmouseover = () => {
      refreshStatsButton.style.transform = 'translateY(-2px)';
      refreshStatsButton.style.boxShadow = '0 4px 15px rgba(76, 175, 80, 0.5)';
    };

    refreshStatsButton.onmouseout = () => {
      refreshStatsButton.style.transform = 'translateY(0)';
      refreshStatsButton.style.boxShadow = '0 2px 8px rgba(76, 175, 80, 0.3)';
    };

    // Apply button  
    const applyButton = document.createElement('button');
    applyButton.innerHTML = '🎯 Apply Colors';
    applyButton.className = 'bmcf-btn primary';

    applyButton.onmouseover = () => {
      applyButton.style.transform = 'translateY(-2px)';
      applyButton.style.boxShadow = '0 4px 15px rgba(33, 150, 243, 0.5)';
    };

    applyButton.onmouseout = () => {
      applyButton.style.transform = 'translateY(0)';
      applyButton.style.boxShadow = '0 2px 8px rgba(33, 150, 243, 0.3)';
    };
    
    refreshStatsButton.onclick = () => {
      consoleLog('🔄 [Color Filter] Refreshing statistics...');
      buildColorFilterOverlay(); // Rebuild overlay with fresh data
    };
    applyButton.onclick = async () => {
      colorFilterOverlay.remove();
      overlayMain.handleDisplayStatus('Applying color filter...');
      
      try {
        await refreshTemplateDisplay();
        overlayMain.handleDisplayStatus('Color filter applied successfully!');
      } catch (error) {
        consoleError('Error applying color filter:', error);
        overlayMain.handleDisplayError('Failed to apply color filter');
      }
    };

    // Create scrollable content container for fixed header solution
    const contentContainer = document.createElement('div');
    contentContainer.style.cssText = `
      overflow-y: auto;
      flex: 1;
      min-height: 0;
      padding: 20px;
    `;

    // Add buttons to footer
    footerContainer.appendChild(refreshStatsButton);
    footerContainer.appendChild(applyButton);

    // Assemble overlay with fixed header and footer
    colorFilterOverlay.appendChild(header);
    contentContainer.appendChild(progressSummary);
    contentContainer.appendChild(includeWrongProgressContainer);
    contentContainer.appendChild(instructions);
    contentContainer.appendChild(enhancedSection);
    contentContainer.appendChild(searchContainer);
    contentContainer.appendChild(filterContainer);
    contentContainer.appendChild(colorGrid);
    
    colorFilterOverlay.appendChild(contentContainer);
    colorFilterOverlay.appendChild(footerContainer);

    document.body.appendChild(colorFilterOverlay);

    // Apply mobile mode immediately if enabled
    if (isMobileMode) {
      applyMobileModeToColorFilter(true);
      consoleLog('📱 [Initial Build] Mobile mode applied immediately');
    }

    // Add drag functionality
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      
      // Get current position
      const rect = colorFilterOverlay.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      
      // Change to absolute positioning for dragging
      colorFilterOverlay.style.position = 'fixed';
      colorFilterOverlay.style.transform = 'none';
      colorFilterOverlay.style.left = initialLeft + 'px';
      colorFilterOverlay.style.top = initialTop + 'px';
      
      // Change cursor and drag bar style
      header.style.cursor = 'grabbing';
      dragBar.style.cursor = 'grabbing';
      dragBar.style.opacity = '1';
      colorFilterOverlay.style.userSelect = 'none';
      
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      
      const newLeft = initialLeft + deltaX;
      const newTop = initialTop + deltaY;
      
      // Keep within viewport bounds
      const maxLeft = window.innerWidth - colorFilterOverlay.offsetWidth;
      const maxTop = window.innerHeight - colorFilterOverlay.offsetHeight;
      
      const clampedLeft = Math.max(0, Math.min(newLeft, maxLeft));
      const clampedTop = Math.max(0, Math.min(newTop, maxTop));
      
      colorFilterOverlay.style.left = clampedLeft + 'px';
      colorFilterOverlay.style.top = clampedTop + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        // Restore cursor and drag bar style
        header.style.cursor = 'move';
        dragBar.style.cursor = 'grab';
        dragBar.style.opacity = '0.8';
        colorFilterOverlay.style.userSelect = '';
      }
    });
  }).catch(err => {
    consoleError('Failed to load color palette:', err);
    overlayMain.handleDisplayError('Failed to load color palette!');
  });
}

/** Refreshes the color filter overlay to update progress calculations
 * @since 1.0.0
 */
function refreshColorFilterOverlay() {
  // Close and reopen the color filter overlay to refresh stats
  const existingOverlay = document.getElementById('bm-color-filter-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
    setTimeout(() => {
      buildColorFilterOverlay();
    }, 100);
  }
}

/** Forces template redraw to apply enhanced mode changes
 * @since 1.0.0
 */
function forceTemplateRedraw() {
  // Force a complete redraw of templates
  if (templateManager.templatesArray && templateManager.templatesArray.length > 0) {
    templateManager.setTemplatesShouldBeDrawn(false);
    setTimeout(() => {
      templateManager.setTemplatesShouldBeDrawn(true);
      // Update mini tracker after template redraw
      updateMiniTracker();
    }, 100); // Slightly longer delay to ensure redraw is complete
  }
}

// ====== KEYBOARD SHORTCUT: E + CLICK FOR ENHANCED COLORS ======

/** Map of color IDs to RGB values from r/place palette */
const COLOR_PALETTE_MAP = {
  'color-0': [255, 255, 255, 0], // Transparent
  'color-1': [0, 0, 0], // Black
  'color-2': [60, 60, 60], // Dark Gray
  'color-3': [120, 120, 120], // Gray
  'color-4': [210, 210, 210], // Light Gray
  'color-5': [255, 255, 255], // White
  'color-6': [96, 0, 24], // Deep Red
  'color-7': [237, 28, 36], // Red
  'color-8': [255, 127, 39], // Orange
  'color-9': [246, 170, 9], // Gold
  'color-10': [249, 221, 59], // Yellow
  'color-11': [255, 250, 188], // Light Yellow
  'color-12': [14, 185, 104], // Dark Green
  'color-13': [19, 230, 123], // Green
  'color-14': [135, 255, 94], // Light Green
  'color-15': [12, 129, 110], // Dark Teal
  'color-16': [16, 174, 166], // Teal
  'color-17': [19, 225, 190], // Light Teal
  'color-18': [40, 80, 158], // Dark Blue
  'color-19': [64, 147, 228], // Blue
  'color-20': [96, 247, 242], // Cyan
  'color-21': [107, 80, 246], // Indigo
  'color-22': [153, 177, 251], // Light Indigo
  'color-23': [120, 12, 153], // Dark Purple
  'color-24': [170, 56, 185], // Purple
  'color-25': [224, 159, 249], // Light Purple
  'color-26': [203, 0, 122], // Dark Pink
  'color-27': [236, 31, 128], // Pink
  'color-28': [243, 141, 169], // Light Pink
  'color-29': [104, 70, 52], // Dark Brown
  'color-30': [149, 104, 42], // Brown
  'color-31': [248, 178, 119], // Beige
  'color-32': [170, 170, 170], // Medium Gray
  'color-33': [165, 14, 30], // Dark Red
  'color-34': [250, 128, 114], // Light Red
  'color-35': [228, 92, 26], // Dark Orange
  'color-36': [214, 181, 148], // Light Tan
  'color-37': [156, 132, 49], // Dark Goldenrod
  'color-38': [197, 173, 49], // Goldenrod
  'color-39': [232, 212, 95], // Light Goldenrod
  'color-40': [74, 107, 58], // Dark Olive
  'color-41': [90, 148, 74], // Olive
  'color-42': [132, 197, 115], // Light Olive
  'color-43': [15, 121, 159], // Dark Cyan
  'color-44': [187, 250, 242], // Light Cyan
  'color-45': [125, 199, 255], // Light Blue
  'color-46': [77, 49, 184], // Dark Indigo
  'color-47': [74, 66, 132], // Dark Slate Blue
  'color-48': [122, 113, 196], // Slate Blue
  'color-49': [181, 174, 241], // Light Slate Blue
  'color-50': [219, 164, 99], // Light Brown
  'color-51': [209, 128, 81], // Dark Beige
  'color-52': [255, 197, 165], // Light Beige
  'color-53': [155, 82, 73], // Dark Peach
  'color-54': [209, 128, 120], // Peach
  'color-55': [250, 182, 164], // Light Peach
  'color-56': [123, 99, 82], // Dark Tan
  'color-57': [156, 132, 107], // Tan
  'color-58': [51, 57, 65], // Dark Slate
  'color-59': [109, 117, 141], // Slate
  'color-60': [179, 185, 209], // Light Slate
  'color-61': [109, 100, 63], // Dark Stone
  'color-62': [148, 140, 107], // Stone
  'color-63': [205, 197, 158] // Light Stone
};

/** State for E key shortcut */
let isEKeyPressed = false;
let eKeyModeActive = false;

/** Initialize keyboard shortcut functionality 
 * 
 * HOW TO USE THE E+CLICK SHORTCUT:
 * 1. Press and hold the 'E' key
 * 2. While holding 'E', click on any color in the r/place palette
 * 3. This will:
 *    - Clear all currently enhanced colors
 *    - Enable enhanced mode ONLY for the clicked color
 *    - Refresh the template to show the changes
 * 4. Release the 'E' key to exit enhanced selection mode
 * 
 * VISUAL FEEDBACK:
 * - Cursor changes to crosshair when E-Mode is active
 * - Status messages appear to confirm actions
 * - Color filter overlay automatically refreshes if open
 * 
 * @since 1.0.0
 */
function initializeKeyboardShortcuts() {
  consoleLog('🎹 [Keyboard Shortcuts] Initializing E+Click shortcut for enhanced colors...');
  
  // Track E key press/release
  document.addEventListener('keydown', (event) => {
    if (event.code === 'KeyE' && !event.repeat) {
      isEKeyPressed = true;
      eKeyModeActive = true;
      
      // Visual feedback - add cursor style to show E mode is active
      document.body.style.cursor = 'crosshair';
      
      // Show notification
      if (typeof overlayMain !== 'undefined' && overlayMain.handleDisplayStatus) {
        overlayMain.handleDisplayStatus('🎹 E-Mode: Click a color to enable enhanced mode for that color only');
      }
      
      consoleLog('🎹 [E-Mode] Enhanced selection mode ACTIVATED');
    }
  });
  
  document.addEventListener('keyup', (event) => {
    if (event.code === 'KeyE') {
      isEKeyPressed = false;
      eKeyModeActive = false;
      
      // Reset cursor
      document.body.style.cursor = '';
      
      consoleLog('🎹 [E-Mode] Enhanced selection mode DEACTIVATED');
    }
  });
  
  // Handle clicks on color palette buttons when E is pressed
  document.addEventListener('click', handleEKeyColorClick, true);
  
  consoleLog('✅ [Keyboard Shortcuts] E+Click shortcut initialized successfully');
}

/** Handle E+Click on color palette */
function handleEKeyColorClick(event) {
  if (!eKeyModeActive) return;
  
  // Check if clicked element is a color button
  const colorButton = event.target.closest('button[id^="color-"]');
  if (!colorButton) return;
  
  // Prevent normal color selection
  event.preventDefault();
  event.stopPropagation();
  
  const colorId = colorButton.id;
  const rgbColor = COLOR_PALETTE_MAP[colorId];
  
  if (!rgbColor) {
    consoleWarn(`🎹 [E-Mode] Unknown color ID: ${colorId}`);
    return;
  }
  
  // Skip transparent color
  if (colorId === 'color-0') {
    if (typeof overlayMain !== 'undefined' && overlayMain.handleDisplayStatus) {
      overlayMain.handleDisplayStatus('🎹 E-Mode: Cannot enhance transparent color');
    }
    return;
  }
  
  consoleLog(`🎹 [E-Mode] Processing color: ${colorId} -> RGB(${rgbColor.join(', ')})`);
  
  // Get current template
  const currentTemplate = templateManager.templatesArray?.[0];
  if (!currentTemplate) {
    if (typeof overlayMain !== 'undefined' && overlayMain.handleDisplayError) {
      overlayMain.handleDisplayError('🎹 E-Mode: No template loaded');
    }
    return;
  }
  
  try {
    // Clear all enhanced colors first
    currentTemplate.enhancedColors.clear();
    consoleLog('🎹 [E-Mode] Cleared all enhanced colors');
    
    // Enable enhanced mode for the selected color
    currentTemplate.enableColorEnhanced(rgbColor);
    consoleLog(`🎹 [E-Mode] Enhanced mode enabled for RGB(${rgbColor.join(', ')})`);
    
    // Visual feedback
    const colorName = colorButton.getAttribute('aria-label') || colorId;
    if (typeof overlayMain !== 'undefined' && overlayMain.handleDisplayStatus) {
      overlayMain.handleDisplayStatus(`✅ Enhanced mode enabled for: ${colorName}`);
    }
    
    // Refresh template to apply changes
    refreshTemplateDisplay().then(() => {
      consoleLog('🎹 [E-Mode] Template refreshed with new enhanced color');
    }).catch(error => {
      consoleError('🎹 [E-Mode] Error refreshing template:', error);
    });
    
    // Update color filter overlay if it's open
    const colorFilterOverlay = document.getElementById('bm-color-filter-overlay');
    if (colorFilterOverlay) {
      // Close and reopen to refresh
      colorFilterOverlay.remove();
      setTimeout(() => {
        buildColorFilterOverlay();
      }, 100);
    }
    
  } catch (error) {
    consoleError('🎹 [E-Mode] Error processing enhanced color:', error);
    if (typeof overlayMain !== 'undefined' && overlayMain.handleDisplayError) {
      overlayMain.handleDisplayError('🎹 E-Mode: Failed to set enhanced color');
    }
  }
}

// Make functions globally available
window.refreshColorFilterOverlay = refreshColorFilterOverlay;
window.forceTemplateRedraw = forceTemplateRedraw;

/** Refreshes the template display to show color filter changes
 * @since 1.0.0
 */
async function refreshTemplateDisplay() {
  // This will trigger a re-render of the template
  if (templateManager.templatesArray && templateManager.templatesArray.length > 0) {
    // Force a complete recreation of the template with current color filter
    try {
      consoleLog('Starting template refresh with color filter...');
      
      // Get the current template
      const currentTemplate = templateManager.templatesArray[0];
      consoleLog('Current disabled colors:', currentTemplate.getDisabledColors());
      
      // Invalidate enhanced cache when colors change
      currentTemplate.invalidateEnhancedCache();
      
      // Disable templates first to clear the display
      templateManager.setTemplatesShouldBeDrawn(false);
      
      // Wait a moment for the change to take effect
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Force recreation of template tiles with current color filter
      consoleLog('Recreating template tiles with color filter...');
      await templateManager.updateTemplateWithColorFilter(0);
      
      // Re-enable templates to show the updated version
      templateManager.setTemplatesShouldBeDrawn(true);
      
      consoleLog('Template refresh completed successfully');
      
    } catch (error) {
      consoleError('Error refreshing template display:', error);
      overlayMain.handleDisplayError('Failed to apply color filter');
      throw error; // Re-throw to handle in calling function
    }
  } else {
    consoleWarn('No templates available to refresh');
  }
  
  // Update mini tracker after template refresh
  updateMiniTracker();
}

/** Gets the saved crosshair color from storage
 * @returns {Object} The crosshair color configuration
 * @since 1.0.0 
 */
function getCrosshairColor() {
  try {
    let savedColor = null;
    
    // Try TamperMonkey storage first
    if (typeof GM_getValue !== 'undefined') {
      const saved = GM_getValue('bmCrosshairColor', null);
      if (saved) savedColor = JSON.parse(saved);
    }
    
    // Fallback to localStorage
    if (!savedColor) {
      const saved = localStorage.getItem('bmCrosshairColor');
      if (saved) savedColor = JSON.parse(saved);
    }
    
    // Auto-migrate old alpha values (180 -> 255)
    if (savedColor && savedColor.alpha === 180) {
      savedColor.alpha = 255;
      saveCrosshairColor(savedColor); // Save the migrated value
      consoleLog('Auto-migrated crosshair transparency from 71% to 100%');
    }
    
    if (savedColor) return savedColor;
  } catch (error) {
    consoleWarn('Failed to load crosshair color:', error);
  }
  
  // Default red color
  return {
    name: 'Red',
    rgb: [255, 0, 0],
    alpha: 255
  };
}

/** Saves the crosshair color to storage
 * @param {Object} colorConfig - The color configuration to save
 * @since 1.0.0
 */
function saveCrosshairColor(colorConfig) {
  try {
    const colorString = JSON.stringify(colorConfig);
    
    // Save to TamperMonkey storage
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue('bmCrosshairColor', colorString);
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bmCrosshairColor', colorString);
    
    consoleLog('Crosshair color saved:', colorConfig);
  } catch (error) {
    consoleError('Failed to save crosshair color:', error);
  }
}

/** Gets the border enabled setting from storage
 * @returns {boolean} Whether borders are enabled
 * @since 1.0.0 
 */
function getBorderEnabled() {
  try {
    let borderEnabled = null;
    
    // Try TamperMonkey storage first
    if (typeof GM_getValue !== 'undefined') {
      const saved = GM_getValue('bmCrosshairBorder', null);
      if (saved !== null) borderEnabled = JSON.parse(saved);
    }
    
    // Fallback to localStorage
    if (borderEnabled === null) {
      const saved = localStorage.getItem('bmCrosshairBorder');
      if (saved !== null) borderEnabled = JSON.parse(saved);
    }
    
    if (borderEnabled !== null) {
      consoleLog('🔲 Border setting loaded:', borderEnabled);
      return borderEnabled;
    }
  } catch (error) {
    consoleWarn('Failed to load border setting:', error);
  }
  
  // Default to disabled
  consoleLog('🔲 Using default border setting: false');
  return false;
}

/** Saves the border enabled setting to storage
 * @param {boolean} enabled - Whether borders should be enabled
 * @since 1.0.0
 */
function saveBorderEnabled(enabled) {
  try {
    const enabledString = JSON.stringify(enabled);
    
    consoleLog('🔲 Saving border setting:', enabled, 'as string:', enabledString);
    
    // Save to TamperMonkey storage
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue('bmCrosshairBorder', enabledString);
      consoleLog('🔲 Saved to TamperMonkey storage');
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bmCrosshairBorder', enabledString);
    consoleLog('🔲 Saved to localStorage');
    
    consoleLog('✅ Border setting saved successfully:', enabled);
  } catch (error) {
    consoleError('❌ Failed to save border setting:', error);
  }
}

/** Gets the enhanced size enabled setting from storage
 * @returns {boolean} Whether enhanced size is enabled
 * @since 1.0.0 
 */
function getEnhancedSizeEnabled() {
  try {
    let enhancedSizeEnabled = null;
    
    // Try TamperMonkey storage first
    if (typeof GM_getValue !== 'undefined') {
      const saved = GM_getValue('bmCrosshairEnhancedSize', null);
      if (saved !== null) {
        enhancedSizeEnabled = JSON.parse(saved);
      }
    }
    
    // Fallback to localStorage
    if (enhancedSizeEnabled === null) {
      const saved = localStorage.getItem('bmCrosshairEnhancedSize');
      if (saved !== null) {
        enhancedSizeEnabled = JSON.parse(saved);
      }
    }
    
    if (enhancedSizeEnabled !== null) {
      return enhancedSizeEnabled;
    }
  } catch (error) {
    consoleError('Failed to load enhanced size setting:', error);
  }
  
  // Default to disabled
  return false;
}

/** Saves the enhanced size enabled setting to storage
 * @param {boolean} enabled - Whether enhanced size should be enabled
 * @since 1.0.0 
 */
function saveEnhancedSizeEnabled(enabled) {
  try {
    const enabledString = JSON.stringify(enabled);
    
    // Save to TamperMonkey storage
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue('bmCrosshairEnhancedSize', enabledString);
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bmCrosshairEnhancedSize', enabledString);
    
    consoleLog('✅ Enhanced size setting saved successfully:', enabled);
  } catch (error) {
    consoleError('❌ Failed to save enhanced size setting:', error);
  }
}

/** Gets the mini tracker enabled setting from storage
 * @returns {boolean} Whether mini tracker is enabled
 * @since 1.0.0 
 */
function getMiniTrackerEnabled() {
  try {
    let trackerEnabled = null;
    
    // Try TamperMonkey storage first
    if (typeof GM_getValue !== 'undefined') {
      const saved = GM_getValue('bmMiniTracker', null);
      if (saved !== null) trackerEnabled = JSON.parse(saved);
    }
    
    // Fallback to localStorage
    if (trackerEnabled === null) {
      const saved = localStorage.getItem('bmMiniTracker');
      if (saved !== null) trackerEnabled = JSON.parse(saved);
    }
    
    if (trackerEnabled !== null) {
      consoleLog('📊 Mini tracker setting loaded:', trackerEnabled);
      return trackerEnabled;
    }
  } catch (error) {
    consoleWarn('Failed to load mini tracker setting:', error);
  }
  
  // Default to disabled
  return false;
}

/** Saves the mini tracker enabled setting to storage
 * @param {boolean} enabled - Whether mini tracker should be enabled
 * @since 1.0.0
 */
function saveMiniTrackerEnabled(enabled) {
  try {
    const enabledString = JSON.stringify(enabled);
    
    consoleLog('📊 Saving mini tracker setting:', enabled, 'as string:', enabledString);
    
    // Save to TamperMonkey storage
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue('bmMiniTracker', enabledString);
      consoleLog('📊 Saved to TamperMonkey storage');
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bmMiniTracker', enabledString);
    consoleLog('📊 Saved to localStorage');
    
    consoleLog('✅ Mini tracker setting saved successfully:', enabled);
  } catch (error) {
    consoleError('❌ Failed to save mini tracker setting:', error);
  }
}

/** Gets the collapse mini template setting from storage
 * @returns {boolean} Whether collapse mini template should be enabled
 * @since 1.0.0
 */
function getCollapseMinEnabled() {
  try {
    let collapseEnabled = null;
    
    // Try TamperMonkey storage first
    if (typeof GM_getValue !== 'undefined') {
      const saved = GM_getValue('bmCollapseMin', null);
      if (saved !== null) collapseEnabled = JSON.parse(saved);
    }
    
    // Fallback to localStorage
    if (collapseEnabled === null) {
      const saved = localStorage.getItem('bmCollapseMin');
      if (saved !== null) collapseEnabled = JSON.parse(saved);
    }
    
    if (collapseEnabled !== null) {
      consoleLog('📊 Collapse mini template setting loaded:', collapseEnabled);
      return collapseEnabled;
    }
  } catch (error) {
    consoleWarn('Failed to load collapse mini template setting:', error);
  }
  
  // Default to enabled
  return true;
}

/** Saves the collapse mini template setting to storage
 * @param {boolean} enabled - Whether collapse mini template should be enabled
 * @since 1.0.0
 */
function saveCollapseMinEnabled(enabled) {
  try {
    const enabledString = JSON.stringify(enabled);
    
    consoleLog('📊 Saving collapse mini template setting:', enabled, 'as string:', enabledString);
    
    // Save to TamperMonkey storage
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue('bmCollapseMin', enabledString);
      consoleLog('📊 Saved to TamperMonkey storage');
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bmCollapseMin', enabledString);
    consoleLog('📊 Saved to localStorage');
    
    consoleLog('✅ Collapse mini template setting saved successfully:', enabled);
  } catch (error) {
    consoleError('❌ Failed to save collapse mini template setting:', error);
  }
}

/** Gets the mobile mode setting
 * @returns {boolean} Mobile mode enabled state
 * @since 1.0.0
 */
function getMobileMode() {
  try {
    consoleLog('📱 Loading mobile mode setting...');
    const storedValue = localStorage.getItem('bmMobileMode') || 'false';
    const mobileMode = JSON.parse(storedValue);
    consoleLog('✅ Mobile mode setting loaded:', mobileMode);
    return mobileMode;
  } catch (error) {
    consoleError('❌ Failed to load mobile mode setting:', error);
    return false;
  }
}

/** Saves the mobile mode setting
 * @param {boolean} enabled - Whether mobile mode is enabled
 * @since 1.0.0
 */
function saveMobileMode(enabled) {
  try {
    const enabledString = JSON.stringify(enabled);
    consoleLog('📱 Saving mobile mode setting:', enabled);
    localStorage.setItem('bmMobileMode', enabledString);
    consoleLog('✅ Mobile mode setting saved successfully:', enabled);
  } catch (error) {
    consoleError('❌ Failed to save mobile mode setting:', error);
  }
}

/**
 * Apply mobile mode styles to existing Color Filter overlay dynamically
 * @param {boolean} enableMobile - Whether to enable mobile mode
 * @since 1.0.0
 */
function applyMobileModeToColorFilter(enableMobile) {
  const existingOverlay = document.getElementById('bm-color-filter-overlay');
  if (!existingOverlay) {
    consoleLog('📱 [Dynamic Mobile] No Color Filter overlay found');
    return;
  }

  // ALWAYS remove existing mobile styles first to prevent accumulation
  let mobileStyleElement = document.getElementById('bmcf-mobile-styles');
  if (mobileStyleElement) {
    mobileStyleElement.remove();
    consoleLog('📱 [Dynamic Mobile] Removed existing mobile styles');
  }
  
  if (enableMobile) {
    // Create fresh mobile style element
    mobileStyleElement = document.createElement('style');
    mobileStyleElement.id = 'bmcf-mobile-styles';
    document.head.appendChild(mobileStyleElement);
    
    mobileStyleElement.textContent = `
      /* Dynamic Mobile Mode Styles - Applied Fresh */
      .bmcf-overlay { 
        width: min(95vw, 400px) !important; 
        max-height: 75vh !important; 
        border-radius: 12px !important; 
        padding: 6px !important;
      }
      .bmcf-header { 
        padding: 10px 14px 8px 14px !important; 
      }
      .bmcf-drag-bar { 
        height: 4px !important; 
        margin-bottom: 6px !important; 
      }
      .bmcf-title { 
        font-size: 1.1em !important; 
      }
      .bmcf-close { 
        width: 22px !important; 
        height: 22px !important; 
      }
      .bmcf-search { 
        height: 28px !important; 
        padding: 6px 10px !important; 
        font-size: 0.75em !important; 
      }
      .bmcf-select { 
        height: 28px !important; 
        padding: 4px 8px !important; 
        font-size: 0.75em !important; 
      }
      .bmcf-grid { 
        grid-template-columns: repeat(auto-fit, minmax(100px, 100px)) !important; 
        gap: 6px !important; 
        justify-content: center !important;
      }
      .bmcf-card { 
        padding: 6px 8px !important; 
        border-radius: 6px !important; 
        width: 100px !important;
        height: 100px !important;
        box-sizing: border-box !important;
      }
      .bmcf-color-box { 
        width: 18px !important; 
        height: 18px !important; 
        border-radius: 3px !important; 
      }
      .bmcf-color-name { 
        font-size: 0.75em !important; 
      }
      .bmcf-stats { 
        font-size: 0.65em !important; 
        gap: 3px !important; 
      }
      .bmcf-btn { 
        height: 28px !important; 
        padding: 0 10px !important; 
        min-width: 70px !important; 
        font-size: 0.75em !important; 
      }
      .bmcf-footer { 
        padding: 6px 10px !important; 
        gap: 6px !important; 
      }
      .bmcf-progress-container { 
        padding: 6px 10px !important; 
      }
      .bmcf-instructions { 
        font-size: 0.7em !important; 
        padding: 6px 10px !important; 
      }
    `;
    consoleLog('📱 [Dynamic Mobile] Mobile mode styles applied FRESH to Color Filter');
  } else {
    consoleLog('📱 [Dynamic Mobile] Mobile mode disabled - styles removed');
  }
}

/** Updates the mini progress tracker visibility and content
 * @since 1.0.0
 */
function updateMiniTracker() {
  const trackerEnabled = getMiniTrackerEnabled();
  const collapseEnabled = getCollapseMinEnabled();
  const existingTracker = document.getElementById('bm-mini-tracker');
  
  // Check if main overlay is minimized
  const mainOverlay = document.getElementById('bm-overlay');
  const isMainMinimized = mainOverlay && (mainOverlay.style.width === '60px' || mainOverlay.style.height === '76px');
  
  // Hide tracker if disabled OR if collapse is enabled and main is minimized
  if (!trackerEnabled || (collapseEnabled && isMainMinimized)) {
    if (existingTracker) {
      existingTracker.remove();
      consoleLog(`📊 Mini tracker hidden - ${!trackerEnabled ? 'disabled' : 'collapsed with main overlay'}`);
    }
    return;
  }
  
  // Calculate progress data using the SAME method as the main progress bar
  let totalRequired = 0;
  let totalPainted = 0;
  let totalNeedCrosshair = 0;
  
  if (templateManager.templatesArray && templateManager.templatesArray.length > 0) {
    // Use templateManager.calculateRemainingPixelsByColor() like the main progress bar does
    const pixelStats = templateManager.calculateRemainingPixelsByColor();
    for (const stats of Object.values(pixelStats)) {
      totalRequired += stats.totalRequired || 0;
      totalPainted += stats.painted || 0;
      totalNeedCrosshair += stats.needsCrosshair || 0;
    }
  }
  
  const progressPercentage = totalRequired > 0 ? Math.round((totalPainted / totalRequired) * 100) : 0;
  const remaining = totalRequired - totalPainted;
  
  // Create or update tracker
  let tracker = existingTracker;
  if (!tracker) {
    tracker = document.createElement('div');
    tracker.id = 'bm-mini-tracker';
    
    // Find the Color Filter button to position tracker below it
    const colorFilterButton = document.getElementById('bm-button-color-filter');
    if (colorFilterButton && colorFilterButton.parentNode) {
      colorFilterButton.parentNode.insertBefore(tracker, colorFilterButton.nextSibling);
    }
  }
  
  // Style the tracker - COMPACT SLATE THEME
  tracker.style.cssText = `
    background: linear-gradient(135deg, #1e293b, #334155);
    border: 1px solid #475569;
    border-radius: 12px;
    padding: 12px 16px;
    margin-top: 8px;
    color: #f1f5f9;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    width: 100%;
    font-size: 0.85rem;
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto auto;
    grid-gap: 6px;
    letter-spacing: -0.01em;
  `;
  
  // LAYOUT CSS GRID - HTML LIMPO
  if (totalRequired === 0) {
    tracker.innerHTML = `
      <div class="tracker-title">📊 Template Progress: 0%</div>
      <div class="tracker-pixels">0 / 0 pixels painted</div>
      <div class="tracker-progress">
        <div class="tracker-bar" style="width: 0%;"></div>
      </div>
      <div class="tracker-left">0 Pixels Left</div>
    `;
  } else {
    tracker.innerHTML = `
      <div class="tracker-title">📊 Template Progress: ${progressPercentage}%</div>
      <div class="tracker-pixels">${totalPainted.toLocaleString()} / ${totalRequired.toLocaleString()} pixels painted</div>
      <div class="tracker-progress">
        <div class="tracker-bar" style="width: ${progressPercentage}%;"></div>
      </div>
      <div class="tracker-left">${totalNeedCrosshair.toLocaleString()} Pixels Left</div>
    `;
  }
  
  // Aplicar estilos CSS às classes - SLATE THEME COMPACT
  const style = document.createElement('style');
  style.textContent = `
    .tracker-title {
      font-size: 1rem;
      font-weight: 700;
      grid-row: 1;
      width: 100%;
      text-align: left;
      color: #f1f5f9;
      letter-spacing: -0.02em;
    }
    .tracker-pixels {
      font-size: 0.8rem;
      color: #cbd5e1;
      grid-row: 2;
      width: 100%;
      text-align: left;
      font-weight: 500;
    }
    .tracker-progress {
      height: 8px;
      background: #475569;
      border-radius: 6px;
      overflow: hidden;
      grid-row: 3;
      width: 100%;
      border: 1px solid #64748b;
    }
    .tracker-bar {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #10b981);
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    .tracker-left {
      font-size: 0.8rem;
      color: #fbbf24;
      grid-row: 4;
      width: 100%;
      text-align: left;
      font-weight: 600;
    }
  `;
  if (!document.getElementById('tracker-styles')) {
    style.id = 'tracker-styles';
    document.head.appendChild(style);
  }
  
  consoleLog(`📊 Mini tracker updated: ${totalPainted}/${totalRequired} (${progressPercentage}%) - ${totalNeedCrosshair} need crosshair`);
}

// Auto-update mini tracker every 5 seconds if enabled
let miniTrackerAutoUpdateInterval = null;

function startMiniTrackerAutoUpdate() {
  // Clear existing interval if any
  if (miniTrackerAutoUpdateInterval) {
    clearInterval(miniTrackerAutoUpdateInterval);
  }
  
  // Only start auto-update if mini tracker is enabled
  if (getMiniTrackerEnabled()) {
    miniTrackerAutoUpdateInterval = setInterval(() => {
      const isStillEnabled = getMiniTrackerEnabled();
      if (isStillEnabled) {
        updateMiniTracker();
        consoleLog('📊 Mini tracker auto-updated');
      } else {
        // Stop auto-update if disabled
        clearInterval(miniTrackerAutoUpdateInterval);
        miniTrackerAutoUpdateInterval = null;
        consoleLog('📊 Mini tracker auto-update stopped (disabled)');
      }
    }, 5000); // Update every 5 seconds
    
    consoleLog('📊 Mini tracker auto-update started (every 5 seconds)');
  }
}

// Start auto-update when page loads
setTimeout(() => {
  startMiniTrackerAutoUpdate();
}, 2000); // Start after 2 seconds to let everything initialize

/** Builds and displays the crosshair settings overlay
 * @since 1.0.0
 */
function buildCrosshairSettingsOverlay() {
  try {
    // Ensure Slate theme CSS variables are available globally
    if (!document.getElementById('bmcf-styles')) {
      const crosshairStyles = document.createElement('style');
      crosshairStyles.id = 'bmcf-styles';
      crosshairStyles.textContent = `
        :root { 
          --slate-50: #f8fafc; --slate-100: #f1f5f9; --slate-200: #e2e8f0; --slate-300: #cbd5e1; 
          --slate-400: #94a3b8; --slate-500: #64748b; --slate-600: #475569; --slate-700: #334155; 
          --slate-750: #293548; --slate-800: #1e293b; --slate-900: #0f172a; --slate-950: #020617;
          --blue-400: #60a5fa; --blue-500: #3b82f6; --blue-600: #2563eb; --blue-700: #1d4ed8;
          --emerald-400: #34d399; --emerald-500: #10b981; --emerald-600: #059669; --emerald-700: #047857;
          --bmcf-bg: var(--slate-900); --bmcf-card: var(--slate-800); --bmcf-border: var(--slate-700); 
          --bmcf-muted: var(--slate-400); --bmcf-text: var(--slate-100); --bmcf-text-muted: var(--slate-300);
        }
        
        @keyframes gradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        
        /* Custom RGB input placeholder styling */
        .bm-custom-rgb-input::placeholder {
          text-align: center !important;
          color: var(--slate-400) !important;
          font-weight: 600 !important;
          opacity: 1 !important;
        }
        
        .bm-custom-rgb-input::-webkit-input-placeholder {
          text-align: center !important;
          color: var(--slate-400) !important;
          font-weight: 600 !important;
        }
        
        .bm-custom-rgb-input::-moz-placeholder {
          text-align: center !important;
          color: var(--slate-400) !important;
          font-weight: 600 !important;
          opacity: 1 !important;
        }
        
        .bm-custom-rgb-input:-ms-input-placeholder {
          text-align: center !important;
          color: var(--slate-400) !important;
          font-weight: 600 !important;
        }
      `;
      document.head.appendChild(crosshairStyles);
    }

    // Remove existing settings overlay if it exists
    const existingOverlay = document.getElementById('bm-crosshair-settings-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    // Predefined color options - declare first
    const colorOptions = [
      { name: 'Red', rgb: [255, 0, 0], alpha: 255 },
      { name: 'Blue', rgb: [64, 147, 228], alpha: 255 },
      { name: 'Green', rgb: [0, 255, 0], alpha: 255 },
      { name: 'Purple', rgb: [170, 56, 185], alpha: 255 },
      { name: 'Yellow', rgb: [249, 221, 59], alpha: 255 },
      { name: 'Orange', rgb: [255, 127, 39], alpha: 255 },
      { name: 'Cyan', rgb: [96, 247, 242], alpha: 255 },
      { name: 'Pink', rgb: [236, 31, 128], alpha: 255 },
      { name: 'Custom', rgb: [255, 255, 255], alpha: 255, isCustom: true }
    ];

    // Get current crosshair color
    const currentColor = getCrosshairColor();
    
    // Track temporary settings (before confirm)
    let tempColor = { ...currentColor };
    
    // If current color is custom, ensure it has the isCustom flag
    if (!tempColor.isCustom && !colorOptions.filter(c => !c.isCustom).some(predefined => 
        JSON.stringify(predefined.rgb) === JSON.stringify(tempColor.rgb)
      )) {
      tempColor.isCustom = true;
      tempColor.name = 'Custom';
    }
    let tempBorderEnabled = getBorderEnabled();
    let tempMiniTrackerEnabled = getMiniTrackerEnabled();
    let tempMobileMode = getMobileMode();

    // Create the settings overlay
    const settingsOverlay = document.createElement('div');
    settingsOverlay.id = 'bm-crosshair-settings-overlay';
    settingsOverlay.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #0f172a;
      color: #f1f5f9;
      padding: 0;
      border-radius: 20px;
      z-index: 9002;
      max-width: 520px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05);
      border: 1px solid #334155;
      backdrop-filter: blur(16px);
      overflow: hidden;
    `;
  
  // Add subtle background pattern
  settingsOverlay.innerHTML = `
    <div style="
      position: absolute; inset: 0; border-radius: 20px;
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(16, 185, 129, 0.05));
      pointer-events: none; z-index: 0;
    "></div>
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--slate-700);
    background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
    cursor: move;
    user-select: none;
    flex-shrink: 0;
    position: relative;
    z-index: 1;
  `;

  const title = document.createElement('h2');
  title.textContent = 'Settings';
  title.style.cssText = `
    margin: 0; 
    font-size: 1.5em; 
    font-weight: 700;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    text-align: center;
    flex: 1;
    pointer-events: none;
    letter-spacing: -0.025em;
    background: linear-gradient(135deg, var(--slate-100), var(--slate-300));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  `;

  const closeButton = document.createElement('button');
  closeButton.textContent = '✕';
  closeButton.style.cssText = `
    background: linear-gradient(135deg, #ef4444, #dc2626);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: white;
    width: 36px;
    height: 36px;
    border-radius: 12px;
    cursor: pointer;
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
  `;
  closeButton.onmouseover = () => {
    closeButton.style.transform = 'translateY(-1px) scale(1.05)';
    closeButton.style.boxShadow = '0 6px 20px rgba(239, 68, 68, 0.4)';
  };
  closeButton.onmouseout = () => {
    closeButton.style.transform = '';
    closeButton.style.boxShadow = '';
  };
  closeButton.onclick = () => settingsOverlay.remove();

  header.appendChild(title);
  header.appendChild(closeButton);

  // Instructions
  const instructions = document.createElement('p');
  instructions.textContent = 'Select the crosshair color that appears on highlighted template pixels:';
  instructions.style.cssText = `
    margin: 0 0 24px 0; 
    font-size: 0.95em; 
    color: var(--slate-300); 
    text-align: center;
    font-weight: 500;
    letter-spacing: -0.01em;
    line-height: 1.4;
  `;

  // Current color preview
  const currentColorPreview = document.createElement('div');
  currentColorPreview.style.cssText = `
    background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
    border: 1px solid var(--slate-700);
    border-radius: 16px;
    padding: 20px;
    margin-bottom: 24px;
    text-align: center;
    position: relative;
    overflow: hidden;
  `;

  const previewLabel = document.createElement('div');
  previewLabel.textContent = 'Current Color:';
  previewLabel.style.cssText = `
    font-size: 1em; 
    margin-bottom: 12px; 
    color: var(--slate-200);
    font-weight: 600;
    letter-spacing: -0.01em;
  `;

  const previewColor = document.createElement('div');
  previewColor.id = 'bm-current-color-preview';
  previewColor.style.cssText = `
    width: 60px;
    height: 60px;
    margin: 0 auto 12px;
    position: relative;
    background: var(--slate-700);
    border: 2px solid var(--slate-500);
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    transition: all 0.2s ease;
  `;
  previewColor.onmouseover = () => {
    previewColor.style.transform = 'scale(1.05)';
    previewColor.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.6)';
  };
  previewColor.onmouseout = () => {
    previewColor.style.transform = '';
    previewColor.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
  };
  
  // Create crosshair preview pattern (simple cross: center + 4 sides)
  function updateCrosshairPreview(color, borderEnabled, enhancedSize = false) {
    const { rgb, alpha } = color;
    const colorRgba = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha / 255})`;
    const borderRgba = borderEnabled ? 'rgba(0, 100, 255, 0.8)' : 'transparent'; // Blue borders
    
    if (enhancedSize) {
      // Enhanced 5x size crosshair preview (extends beyond center)
      previewColor.innerHTML = `
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          grid-template-rows: repeat(5, 1fr);
          gap: 1px;
          background: rgba(0,0,0,0.1);
        ">
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${colorRgba};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${colorRgba};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          
          <div style="background: ${colorRgba};"></div>
          <div style="background: ${colorRgba};"></div>
          <div style="background: black; border: 2px solid rgba(255,255,255,0.4); box-sizing: border-box;"></div>
          <div style="background: ${colorRgba};"></div>
          <div style="background: ${colorRgba};"></div>
          
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${colorRgba};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${colorRgba};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
        </div>
      `;
    } else {
      // Standard 3x3 crosshair preview
      previewColor.innerHTML = `
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          grid-template-rows: 1fr 1fr 1fr;
          gap: 1px;
          background: rgba(0,0,0,0.1);
        ">
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${colorRgba};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          
          <div style="background: ${colorRgba};"></div>
          <div style="background: black; border: 2px solid rgba(255,255,255,0.4); box-sizing: border-box;"></div>
          <div style="background: ${colorRgba};"></div>
          
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
          <div style="background: ${colorRgba};"></div>
          <div style="background: ${borderEnabled ? borderRgba : 'transparent'};"></div>
        </div>
      `;
    }
  }
  
  // Initialize crosshair preview
  updateCrosshairPreview(currentColor, tempBorderEnabled);

  const previewName = document.createElement('div');
  previewName.id = 'bm-current-color-name';
  previewName.textContent = currentColor.name;
  previewName.style.cssText = `
    font-weight: 700; 
    font-size: 1.1em;
    color: var(--slate-100);
    letter-spacing: -0.025em;
  `;

  currentColorPreview.appendChild(previewLabel);
  currentColorPreview.appendChild(previewColor);
  currentColorPreview.appendChild(previewName);

  // Color grid
  const colorGrid = document.createElement('div');
  colorGrid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-bottom: 24px;
    position: relative;
    z-index: 1;
  `;

  // Create color option buttons
  colorOptions.forEach((color) => {
    const colorOption = document.createElement('button');
    
    // Enhanced selection logic for custom colors
    let isSelected = false;
    if (color.isCustom) {
      // For custom color, check if saved color has isCustom flag OR is not a predefined color
      isSelected = currentColor.isCustom || 
        !colorOptions.filter(c => !c.isCustom).some(predefined => 
          JSON.stringify(predefined.rgb) === JSON.stringify(currentColor.rgb)
        );
    } else {
      // For predefined colors, check exact RGB match AND that current color is not custom
      isSelected = JSON.stringify(color.rgb) === JSON.stringify(currentColor.rgb) && !currentColor.isCustom;
    }
    
    // Special handling for custom color button
    if (color.isCustom) {
      // Use current color if custom is selected, otherwise use sophisticated gradient
      const backgroundStyle = isSelected 
        ? `rgba(${currentColor.rgb[0]}, ${currentColor.rgb[1]}, ${currentColor.rgb[2]}, 1)`
        : `linear-gradient(135deg, 
            #8B5CF6 0%, #A855F7 25%, #3B82F6 50%, #06B6D4 75%, #8B5CF6 100%)`;
            
      colorOption.style.cssText = `
        background: ${backgroundStyle};
        border: 2px solid ${isSelected ? 'var(--slate-100)' : 'var(--slate-600)'};
        border-radius: 12px;
        padding: 12px;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        height: 110px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        box-sizing: border-box;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        ${!isSelected ? 'background-size: 200% 200%; animation: gradientShift 3s ease infinite;' : ''}
      `;
    } else {
      colorOption.style.cssText = `
        background: rgba(${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]}, ${color.alpha / 255});
        border: 2px solid ${isSelected ? 'var(--slate-100)' : 'var(--slate-600)'};
        border-radius: 12px;
        padding: 12px;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        height: 110px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        box-sizing: border-box;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      `;
    }

    // Color name
    const colorName = document.createElement('div');
    colorName.textContent = color.name;
    colorName.style.cssText = `
      font-size: 0.9em;
      font-weight: bold;
      color: white;
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      text-align: center;
    `;

    // RGB values or custom inputs
    if (color.isCustom) {
      // Create RGB input container
      const rgbInputs = document.createElement('div');
      rgbInputs.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 3px;
        width: 80%;
        max-width: 80px;
      `;
      
      // Create individual RGB inputs
      const rInput = document.createElement('input');
      rInput.type = 'number';
      rInput.min = '0';
      rInput.max = '255';
      rInput.value = isSelected ? currentColor.rgb[0] : '';
      rInput.placeholder = 'R';
      rInput.className = 'bm-custom-rgb-input';
      rInput.style.cssText = `
        width: 100%;
        padding: 3px 4px;
        border: 1px solid var(--slate-500);
        border-radius: 4px;
        background: var(--slate-700);
        color: var(--slate-100);
        font-size: 0.7em;
        text-align: center;
        outline: none;
        font-weight: 600;
        transition: all 0.2s ease;
        box-sizing: border-box;
        height: 22px;
      `;
      rInput.onfocus = () => {
        rInput.style.borderColor = 'var(--blue-500)';
        rInput.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.2)';
      };
      rInput.onblur = () => {
        rInput.style.borderColor = 'var(--slate-500)';
        rInput.style.boxShadow = '';
      };
      
      const gInput = document.createElement('input');
      gInput.type = 'number';
      gInput.min = '0';
      gInput.max = '255';
      gInput.value = isSelected ? currentColor.rgb[1] : '';
      gInput.placeholder = 'G';
      gInput.className = 'bm-custom-rgb-input';
      gInput.style.cssText = rInput.style.cssText;
      
      const bInput = document.createElement('input');
      bInput.type = 'number';
      bInput.min = '0';
      bInput.max = '255';
      bInput.value = isSelected ? currentColor.rgb[2] : '';
      bInput.placeholder = 'B';
      bInput.className = 'bm-custom-rgb-input';
      bInput.style.cssText = rInput.style.cssText;
      
      // Update function for RGB inputs
      const updateCustomColor = () => {
        const r = Math.max(0, Math.min(255, parseInt(rInput.value) || 0));
        const g = Math.max(0, Math.min(255, parseInt(gInput.value) || 0));
        const b = Math.max(0, Math.min(255, parseInt(bInput.value) || 0));
        
        tempColor = { name: 'Custom', rgb: [r, g, b], alpha: tempColor.alpha, isCustom: true };
        
        // Update the button background to show the custom color
        colorOption.style.background = `rgba(${r}, ${g}, ${b}, 1)`;
        
        // Update preview
        updateCrosshairPreview(tempColor, tempBorderEnabled);
        document.getElementById('bm-current-color-name').textContent = `Custom RGB(${r}, ${g}, ${b})`;
      };
      
      // Add event listeners
      [rInput, gInput, bInput].forEach(input => {
        input.addEventListener('input', updateCustomColor);
        input.addEventListener('change', updateCustomColor);
        
        // Prevent clicks on inputs from bubbling to button
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('mousedown', (e) => e.stopPropagation());
      });
      
      rgbInputs.appendChild(rInput);
      rgbInputs.appendChild(gInput);
      rgbInputs.appendChild(bInput);
      
      colorOption.appendChild(colorName);
      colorOption.appendChild(rgbInputs);
    } else {
      // RGB values for predefined colors
      const rgbText = document.createElement('div');
      rgbText.textContent = `RGB(${color.rgb.join(', ')})`;
      rgbText.style.cssText = `
        font-size: 0.7em;
        color: rgba(255, 255, 255, 0.8);
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      `;
      
      colorOption.appendChild(colorName);
      colorOption.appendChild(rgbText);
    }

    // Selection indicator
    if (isSelected) {
      const checkmark = document.createElement('div');
      checkmark.textContent = '✓';
      checkmark.style.cssText = `
        position: absolute;
        top: 5px;
        right: 5px;
        color: white;
        font-weight: bold;
        font-size: 1.2em;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      `;
      colorOption.appendChild(checkmark);
    }

    // Click handler
    colorOption.onclick = () => {
      // For custom color, the inputs handle the color updates
      if (!color.isCustom) {
        // Update temporary color (don't save yet)
        tempColor = { ...color };
        
        // Update crosshair preview with new color and current border setting
        updateCrosshairPreview(tempColor, tempBorderEnabled);
        document.getElementById('bm-current-color-name').textContent = color.name;
      }
      
      // Update visual selection
      colorGrid.querySelectorAll('button').forEach(btn => {
        btn.style.border = '3px solid rgba(255, 255, 255, 0.3)';
        const checkmark = btn.querySelector('div[style*="position: absolute"]');
        if (checkmark) checkmark.remove();
      });
      
      colorOption.style.border = '3px solid #fff';
      const checkmark = document.createElement('div');
      checkmark.textContent = '✓';
      checkmark.style.cssText = `
        position: absolute;
        top: 5px;
        right: 5px;
        color: white;
        font-weight: bold;
        font-size: 1.2em;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      `;
      colorOption.appendChild(checkmark);
    };

    // Hover effects (only for non-custom buttons to avoid interfering with inputs)
    if (!color.isCustom) {
      colorOption.addEventListener('mouseenter', () => {
        if (!isSelected) {
          colorOption.style.border = '3px solid rgba(255, 255, 255, 0.7)';
          colorOption.style.transform = 'scale(1.05)';
        }
      });

      colorOption.addEventListener('mouseleave', () => {
        if (!isSelected) {
          colorOption.style.border = '3px solid rgba(255, 255, 255, 0.3)';
          colorOption.style.transform = 'scale(1)';
        }
      });
    }

    colorGrid.appendChild(colorOption);
  });

  // Alpha slider section
  const alphaSection = document.createElement('div');
  alphaSection.style.cssText = `
    background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
    border: 1px solid var(--slate-700);
    border-radius: 12px;
    padding: 18px;
    margin-bottom: 20px;
    position: relative;
    z-index: 1;
  `;

  const alphaLabel = document.createElement('div');
  alphaLabel.textContent = 'Crosshair Transparency:';
  alphaLabel.style.cssText = `
    font-size: 1em; 
    margin-bottom: 12px; 
    color: var(--slate-200);
    font-weight: 600;
    letter-spacing: -0.01em;
  `;

  const alphaSlider = document.createElement('input');
  alphaSlider.type = 'range';
  alphaSlider.min = '50';
  alphaSlider.max = '255';
  alphaSlider.value = currentColor.alpha.toString();
  alphaSlider.style.cssText = `
    width: 100%;
    margin: 10px 0;
  `;

  const alphaValue = document.createElement('div');
  alphaValue.textContent = `${Math.round((currentColor.alpha / 255) * 100)}%`;
  alphaValue.style.cssText = `
    text-align: center; 
    font-weight: 700; 
    font-size: 1.1em;
    color: var(--slate-100);
    margin-top: 8px;
    letter-spacing: -0.025em;
  `;

  alphaSlider.oninput = () => {
    const alpha = parseInt(alphaSlider.value);
    alphaValue.textContent = `${Math.round((alpha / 255) * 100)}%`;
    
    // Update temporary color with new alpha
    tempColor.alpha = alpha;
    
    // Update crosshair preview with new alpha
    updateCrosshairPreview(tempColor, tempBorderEnabled);
  };

  alphaSection.appendChild(alphaLabel);
  alphaSection.appendChild(alphaSlider);
  alphaSection.appendChild(alphaValue);

  // Border options section
  const borderSection = document.createElement('div');
  borderSection.style.cssText = `
    background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
    border: 1px solid var(--slate-700);
    border-radius: 12px;
    padding: 18px;
    margin-bottom: 20px;
    position: relative;
    z-index: 1;
  `;

  const borderLabel = document.createElement('div');
  borderLabel.textContent = 'Corner Borders:';
  borderLabel.style.cssText = `
    font-size: 1em; 
    margin-bottom: 12px; 
    color: var(--slate-200);
    font-weight: 600;
    letter-spacing: -0.01em;
  `;

  const borderDescription = document.createElement('div');
  borderDescription.textContent = 'Add subtle borders around corner pixels of the crosshair';
  borderDescription.style.cssText = `
    font-size: 0.9em; 
    margin-bottom: 16px; 
    color: var(--slate-300);
    line-height: 1.4;
    letter-spacing: -0.005em;
  `;

  const borderToggle = document.createElement('label');
  borderToggle.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  `;

  const borderCheckbox = document.createElement('input');
  borderCheckbox.type = 'checkbox';
  borderCheckbox.checked = tempBorderEnabled;
  borderCheckbox.style.cssText = `
    width: 20px;
    height: 20px;
    cursor: pointer;
    accent-color: var(--blue-500);
    border-radius: 4px;
  `;

  const borderToggleText = document.createElement('span');
  borderToggleText.textContent = 'Enable corner borders';
  borderToggleText.style.cssText = `
    color: var(--slate-100); 
    font-weight: 600;
    letter-spacing: -0.01em;
  `;

  borderCheckbox.onchange = () => {
    tempBorderEnabled = borderCheckbox.checked;
    
    // Update crosshair preview to show/hide borders
    updateCrosshairPreview(tempColor, tempBorderEnabled);
  };

  borderToggle.appendChild(borderCheckbox);
  borderToggle.appendChild(borderToggleText);
  borderSection.appendChild(borderLabel);
  borderSection.appendChild(borderDescription);
  borderSection.appendChild(borderToggle);

  // Crosshair Size section
  const sizeSection = document.createElement('div');
  sizeSection.style.cssText = `
    background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
    border: 1px solid var(--slate-700);
    border-radius: 12px;
    padding: 18px;
    margin-bottom: 20px;
    position: relative;
    z-index: 1;
  `;

  const sizeLabel = document.createElement('div');
  sizeLabel.textContent = 'Crosshair Size:';
  sizeLabel.style.cssText = `
    font-size: 1em; 
    margin-bottom: 12px; 
    color: var(--slate-200);
    font-weight: 600;
    letter-spacing: -0.01em;
  `;

  const sizeDescription = document.createElement('div');
  sizeDescription.textContent = 'Make crosshair 5x larger, extending beyond pixel boundaries';
  sizeDescription.style.cssText = `
    font-size: 0.9em; 
    margin-bottom: 16px; 
    color: var(--slate-300);
    line-height: 1.4;
    letter-spacing: -0.005em;
  `;

  const sizeToggle = document.createElement('label');
  sizeToggle.style.cssText = `
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    padding: 8px 0;
    user-select: none;
  `;

  // Get current enhanced size setting
  let tempEnhancedSize = false;
  try {
    if (typeof GM_getValue !== 'undefined') {
      const saved = GM_getValue('bmCrosshairEnhancedSize', null);
      if (saved !== null) tempEnhancedSize = JSON.parse(saved);
    } else {
      const saved = localStorage.getItem('bmCrosshairEnhancedSize');
      if (saved !== null) tempEnhancedSize = JSON.parse(saved);
    }
  } catch (error) {
    console.warn('Failed to load enhanced size setting:', error);
  }

  const sizeCheckbox = document.createElement('input');
  sizeCheckbox.type = 'checkbox';
  sizeCheckbox.checked = tempEnhancedSize;
  sizeCheckbox.style.cssText = `
    width: 20px;
    height: 20px;
    cursor: pointer;
    accent-color: var(--blue-500);
    border-radius: 4px;
  `;

  const sizeToggleText = document.createElement('span');
  sizeToggleText.textContent = 'Enable Enhanced Size (5x)';
  sizeToggleText.style.cssText = `
    font-size: 0.95em;
    color: var(--slate-100);
    font-weight: 500;
    letter-spacing: -0.01em;
  `;

  sizeCheckbox.onchange = () => {
    tempEnhancedSize = sizeCheckbox.checked;
    updateCrosshairPreview(tempColor, tempBorderEnabled, tempEnhancedSize);
  };

  sizeToggle.onclick = (e) => {
    if (e.target !== sizeCheckbox) {
      sizeCheckbox.checked = !sizeCheckbox.checked;
      sizeCheckbox.onchange();
    }
  };

  sizeToggle.appendChild(sizeCheckbox);
  sizeToggle.appendChild(sizeToggleText);
  sizeSection.appendChild(sizeLabel);
  sizeSection.appendChild(sizeDescription);
  sizeSection.appendChild(sizeToggle);

  // Mini tracker section
  const trackerSection = document.createElement('div');
  trackerSection.style.cssText = `
    background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
    border: 1px solid var(--slate-700);
    border-radius: 12px;
    padding: 18px;
    margin-bottom: 20px;
    position: relative;
    z-index: 1;
  `;

  const trackerLabel = document.createElement('div');
  trackerLabel.textContent = 'Mini Progress Tracker:';
  trackerLabel.style.cssText = `
    font-size: 1em; 
    margin-bottom: 12px; 
    color: var(--slate-200);
    font-weight: 600;
    letter-spacing: -0.01em;
  `;

  const trackerDescription = document.createElement('div');
  trackerDescription.textContent = 'Show a compact progress tracker below the Color Filter button.';
  trackerDescription.style.cssText = `
    font-size: 0.9em; 
    color: var(--slate-300); 
    margin-bottom: 16px; 
    line-height: 1.4;
    letter-spacing: -0.005em;
  `;

  const trackerToggle = document.createElement('div');
  trackerToggle.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  const trackerCheckbox = document.createElement('input');
  trackerCheckbox.type = 'checkbox';
  trackerCheckbox.checked = tempMiniTrackerEnabled;
  trackerCheckbox.style.cssText = `
    width: 16px;
    height: 16px;
    cursor: pointer;
  `;

  const trackerToggleText = document.createElement('span');
  trackerToggleText.textContent = tempMiniTrackerEnabled ? 'Enabled' : 'Disabled';
  trackerToggleText.style.cssText = `
    color: ${tempMiniTrackerEnabled ? '#4caf50' : '#f44336'};
    font-weight: bold;
    cursor: pointer;
  `;

  // Function to update tracker state (visual only, no saving)
  const updateTrackerState = () => {
    tempMiniTrackerEnabled = trackerCheckbox.checked;
    trackerToggleText.textContent = tempMiniTrackerEnabled ? 'Enabled' : 'Disabled';
    trackerToggleText.style.color = tempMiniTrackerEnabled ? '#4caf50' : '#f44336';
    
    // Only update visual state, actual saving happens on Apply
    consoleLog(`📊 Mini tracker ${tempMiniTrackerEnabled ? 'enabled' : 'disabled'} (preview only)`);
  };

  trackerCheckbox.addEventListener('change', updateTrackerState);

  // Only make the TEXT clickable, not the whole container
  trackerToggleText.onclick = (e) => {
    e.stopPropagation(); // Prevent event bubbling
    trackerCheckbox.checked = !trackerCheckbox.checked;
    updateTrackerState();
  };

  // Remove cursor pointer from the container since only text should be clickable
  trackerToggle.style.cursor = 'default';

  trackerToggle.appendChild(trackerCheckbox);
  trackerToggle.appendChild(trackerToggleText);
  trackerSection.appendChild(trackerLabel);
  trackerSection.appendChild(trackerDescription);
  trackerSection.appendChild(trackerToggle);

  // Mobile Mode Section
  const mobileSection = document.createElement('div');
  mobileSection.style.cssText = `
    background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
    border: 1px solid var(--slate-700);
    border-radius: 12px;
    padding: 18px;
    margin-bottom: 20px;
    position: relative;
    z-index: 1;
  `;

  const mobileLabel = document.createElement('div');
  mobileLabel.textContent = '📱 Mobile Mode:';
  mobileLabel.style.cssText = `
    font-size: 1em; 
    margin-bottom: 12px; 
    color: var(--slate-200);
    font-weight: 600;
    letter-spacing: -0.01em;
  `;

  const mobileDescription = document.createElement('div');
  mobileDescription.textContent = 'Enable ultra-compact UI for mobile devices. Makes Color Filter extremely compact for better mobile experience.';
  mobileDescription.style.cssText = `
    font-size: 0.9em; 
    color: var(--slate-300); 
    margin-bottom: 16px; 
    line-height: 1.4;
    letter-spacing: -0.005em;
  `;

  const mobileToggle = document.createElement('div');
  mobileToggle.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  // Use global mobile mode setting

  const mobileCheckbox = document.createElement('input');
  mobileCheckbox.type = 'checkbox';
  const currentMobileMode = getMobileMode(); // Get fresh value from storage
  mobileCheckbox.checked = currentMobileMode;
  tempMobileMode = currentMobileMode; // Synchronize temp variable
  mobileCheckbox.style.cssText = `
    width: 16px;
    height: 16px;
    cursor: pointer;
  `;

  const mobileToggleText = document.createElement('span');
  mobileToggleText.textContent = currentMobileMode ? 'Enabled' : 'Disabled';
  mobileToggleText.style.cssText = `
    color: ${currentMobileMode ? '#4caf50' : '#f44336'};
    font-weight: bold;
    cursor: pointer;
  `;

  // Function to update mobile mode state (visual only, no saving)
  const updateMobileState = () => {
    tempMobileMode = mobileCheckbox.checked;
    mobileToggleText.textContent = tempMobileMode ? 'Enabled' : 'Disabled';
    mobileToggleText.style.color = tempMobileMode ? '#4caf50' : '#f44336';
    
    // Only update visual state, actual saving happens on Apply
    consoleLog(`📱 Mobile mode ${tempMobileMode ? 'enabled' : 'disabled'} (preview only)`);
  };

  mobileCheckbox.addEventListener('change', updateMobileState);

  // Only make the TEXT clickable, not the whole container
  mobileToggleText.onclick = (e) => {
    e.stopPropagation(); // Prevent event bubbling
    mobileCheckbox.checked = !mobileCheckbox.checked;
    updateMobileState();
  };

  // Remove cursor pointer from the container since only text should be clickable
  mobileToggle.style.cursor = 'default';

  mobileToggle.appendChild(mobileCheckbox);
  mobileToggle.appendChild(mobileToggleText);
  mobileSection.appendChild(mobileLabel);
  mobileSection.appendChild(mobileDescription);
  mobileSection.appendChild(mobileToggle);

  // Collapse Mini Template Section
  const collapseSection = document.createElement('div');
  collapseSection.style.cssText = `
    background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
    border: 1px solid var(--slate-700);
    border-radius: 12px;
    padding: 18px;
    margin-bottom: 20px;
    position: relative;
    z-index: 1;
  `;

  const collapseLabel = document.createElement('div');
  collapseLabel.textContent = 'Collapse Mini Template:';
  collapseLabel.style.cssText = `
    font-size: 1em; 
    margin-bottom: 12px; 
    color: var(--slate-200);
    font-weight: 600;
    letter-spacing: -0.01em;
  `;

  const collapseDescription = document.createElement('div');
  collapseDescription.textContent = 'Hide mini tracker when template section is collapsed.';
  collapseDescription.style.cssText = `
    font-size: 0.9em; 
    color: var(--slate-300); 
    margin-bottom: 16px; 
    line-height: 1.4;
    letter-spacing: -0.005em;
  `;

  let tempCollapseMinEnabled = getCollapseMinEnabled();

  const collapseToggle = document.createElement('div');
  collapseToggle.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  const collapseCheckbox = document.createElement('input');
  collapseCheckbox.type = 'checkbox';
  collapseCheckbox.checked = tempCollapseMinEnabled;
  collapseCheckbox.style.cssText = `
    width: 16px;
    height: 16px;
    cursor: pointer;
  `;

  const collapseToggleText = document.createElement('span');
  collapseToggleText.textContent = tempCollapseMinEnabled ? 'Enabled' : 'Disabled';
  collapseToggleText.style.cssText = `
    color: ${tempCollapseMinEnabled ? '#4caf50' : '#f44336'};
    font-weight: bold;
    cursor: pointer;
  `;

  // Function to update collapse state
  const updateCollapseState = () => {
    tempCollapseMinEnabled = collapseCheckbox.checked;
    collapseToggleText.textContent = tempCollapseMinEnabled ? 'Enabled' : 'Disabled';
    collapseToggleText.style.color = tempCollapseMinEnabled ? '#4caf50' : '#f44336';
    
    consoleLog(`📊 Collapse mini template ${tempCollapseMinEnabled ? 'enabled' : 'disabled'}`);
  };

  collapseCheckbox.addEventListener('change', updateCollapseState);

  // Only make the TEXT clickable, not the whole container
  collapseToggleText.onclick = (e) => {
    e.stopPropagation(); // Prevent event bubbling
    collapseCheckbox.checked = !collapseCheckbox.checked;
    updateCollapseState();
  };

  // Remove cursor pointer from the container since only text should be clickable
  collapseToggle.style.cursor = 'default';

  collapseToggle.appendChild(collapseCheckbox);
  collapseToggle.appendChild(collapseToggleText);
  collapseSection.appendChild(collapseLabel);
  collapseSection.appendChild(collapseDescription);
  collapseSection.appendChild(collapseToggle);

  // Create fixed footer with action buttons
  const footerContainer = document.createElement('div');
  footerContainer.style.cssText = `
    display: flex;
    gap: 12px;
    justify-content: center;
    align-items: center;
    padding: 16px 20px;
    border-top: 1px solid var(--slate-700);
    background: linear-gradient(135deg, var(--slate-800), var(--slate-750));
    position: relative;
    z-index: 1;
    flex-shrink: 0;
  `;

  // Action buttons
  const actionsContainer = document.createElement('div');
  actionsContainer.style.cssText = `
    display: flex;
    gap: 12px;
    width: 100%;
    max-width: 400px;
  `;

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel';
  cancelButton.style.cssText = `
    background: linear-gradient(135deg, var(--slate-600), var(--slate-700));
    border: 1px solid var(--slate-500);
    color: var(--slate-100);
    padding: 14px 20px;
    border-radius: 12px;
    cursor: pointer;
    font-size: 0.95em;
    font-weight: 600;
    flex: 1;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
  `;
  cancelButton.onmouseover = () => {
    cancelButton.style.transform = 'translateY(-1px)';
    cancelButton.style.background = 'linear-gradient(135deg, var(--slate-500), var(--slate-600))';
    cancelButton.style.boxShadow = '0 6px 20px rgba(71, 85, 105, 0.3)';
  };
  cancelButton.onmouseout = () => {
    cancelButton.style.transform = '';
    cancelButton.style.background = 'linear-gradient(135deg, var(--slate-600), var(--slate-700))';
    cancelButton.style.boxShadow = '';
  };
  cancelButton.onclick = () => {
    // Check if any settings have changed
    const currentColorSaved = getCrosshairColor();
    const currentBorderSaved = getBorderEnabled();
    const currentTrackerSaved = getMiniTrackerEnabled();
    const currentCollapseSaved = getCollapseMinEnabled();
    const currentMobileSaved = getMobileMode();
    
    const hasChanges = 
      JSON.stringify(tempColor) !== JSON.stringify(currentColorSaved) ||
      tempBorderEnabled !== currentBorderSaved ||
      tempEnhancedSize !== getEnhancedSizeEnabled() ||
      tempMiniTrackerEnabled !== currentTrackerSaved ||
      tempCollapseMinEnabled !== currentCollapseSaved ||
      tempMobileMode !== currentMobileSaved;
    
    if (hasChanges) {
      if (confirm('Discard changes? Any unsaved settings will be lost.')) {
        settingsOverlay.remove();
        overlayMain.handleDisplayStatus('Crosshair settings cancelled - changes discarded');
      }
    } else {
      settingsOverlay.remove();
    }
  };

  const applyButton = document.createElement('button');
  applyButton.textContent = 'Apply Settings';
  applyButton.style.cssText = `
    background: linear-gradient(135deg, var(--blue-500), var(--blue-600));
    border: 1px solid var(--blue-600);
    color: white;
    padding: 14px 20px;
    border-radius: 12px;
    cursor: pointer;
    font-size: 0.95em;
    font-weight: 700;
    flex: 2;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
  `;
  applyButton.onmouseover = () => {
    applyButton.style.transform = 'translateY(-1px)';
    applyButton.style.background = 'linear-gradient(135deg, var(--blue-600), var(--blue-700))';
    applyButton.style.boxShadow = '0 6px 20px rgba(59, 130, 246, 0.4)';
  };
  applyButton.onmouseout = () => {
    applyButton.style.transform = '';
    applyButton.style.background = 'linear-gradient(135deg, var(--blue-500), var(--blue-600))';
    applyButton.style.boxShadow = '';
  };

  applyButton.onclick = async () => {
    // Visual feedback - button click animation
    const originalBg = applyButton.style.background;
    const originalText = applyButton.textContent;
    
    // Immediate click feedback
    applyButton.style.background = 'linear-gradient(135deg, var(--emerald-500), var(--emerald-600))';
    applyButton.textContent = 'Applying...';
    applyButton.style.transform = 'scale(0.95)';
    applyButton.disabled = true;
    
    try {
      // Save all settings
      consoleLog('🎨 Applying crosshair settings:', { color: tempColor, borders: tempBorderEnabled, miniTracker: tempMiniTrackerEnabled, collapse: tempCollapseMinEnabled, mobile: tempMobileMode });
      
      saveCrosshairColor(tempColor);
      saveBorderEnabled(tempBorderEnabled);
      saveEnhancedSizeEnabled(tempEnhancedSize);
      saveMiniTrackerEnabled(tempMiniTrackerEnabled);
      saveCollapseMinEnabled(tempCollapseMinEnabled);
      saveMobileMode(tempMobileMode);
      
      // Apply mobile mode to existing Color Filter overlay dynamically
      applyMobileModeToColorFilter(tempMobileMode);
      
      // Success feedback
      applyButton.style.background = 'linear-gradient(135deg, var(--emerald-600), var(--emerald-700))';
      applyButton.textContent = 'Applied! ✓';
      
      // Update mini tracker visibility and restart auto-update
      updateMiniTracker();
      startMiniTrackerAutoUpdate();
      
      // Force invalidate template caches to ensure borders are applied
      if (templateManager.templatesArray && templateManager.templatesArray.length > 0) {
        templateManager.templatesArray.forEach(template => {
          if (template.invalidateEnhancedCache) {
            template.invalidateEnhancedCache();
          }
        });
      }
      
      // Refresh template display to apply new settings
      await refreshTemplateDisplay();
      
      // Close overlay after short delay
      setTimeout(() => {
        settingsOverlay.remove();
        overlayMain.handleDisplayStatus(`Crosshair settings applied: ${tempColor.name}, ${tempBorderEnabled ? 'with' : 'without'} borders, tracker ${tempMiniTrackerEnabled ? 'enabled' : 'disabled'}, collapse ${tempCollapseMinEnabled ? 'enabled' : 'disabled'}, mobile ${tempMobileMode ? 'enabled' : 'disabled'}!`);
      }, 800);
      
      consoleLog('✅ Crosshair settings successfully applied and templates refreshed');
    } catch (error) {
      // Error feedback
      applyButton.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
      applyButton.textContent = 'Error! ✗';
      
      setTimeout(() => {
        applyButton.style.background = originalBg;
        applyButton.textContent = originalText;
        applyButton.style.transform = 'scale(1)';
        applyButton.disabled = false;
      }, 2000);
      
      consoleError('❌ Error applying crosshair settings:', error);
      overlayMain.handleDisplayError('Failed to apply crosshair settings');
    }
  };

  actionsContainer.appendChild(cancelButton);
  actionsContainer.appendChild(applyButton);
  footerContainer.appendChild(actionsContainer);

  // Create scrollable content container for fixed header solution
  const contentContainer = document.createElement('div');
  contentContainer.style.cssText = `
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    padding: 20px;
    position: relative;
    z-index: 1;
  `;

  // Assemble overlay with fixed header and footer
  settingsOverlay.appendChild(header);
  contentContainer.appendChild(instructions);
  contentContainer.appendChild(currentColorPreview);
  contentContainer.appendChild(colorGrid);
  contentContainer.appendChild(alphaSection);
  contentContainer.appendChild(borderSection);
  contentContainer.appendChild(sizeSection);
  contentContainer.appendChild(trackerSection);
  contentContainer.appendChild(mobileSection);
  contentContainer.appendChild(collapseSection);
  settingsOverlay.appendChild(contentContainer);
  settingsOverlay.appendChild(footerContainer);
  document.body.appendChild(settingsOverlay);

    // Add drag functionality
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      
      const rect = settingsOverlay.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      
      settingsOverlay.style.position = 'fixed';
      settingsOverlay.style.transform = 'none';
      settingsOverlay.style.left = initialLeft + 'px';
      settingsOverlay.style.top = initialTop + 'px';
      
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      
      const newLeft = initialLeft + deltaX;
      const newTop = initialTop + deltaY;
      
      const maxLeft = window.innerWidth - settingsOverlay.offsetWidth;
      const maxTop = window.innerHeight - settingsOverlay.offsetHeight;
      
      const clampedLeft = Math.max(0, Math.min(newLeft, maxLeft));
      const clampedTop = Math.max(0, Math.min(newTop, maxTop));
      
      settingsOverlay.style.left = clampedLeft + 'px';
      settingsOverlay.style.top = clampedTop + 'px';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
  } catch (error) {
    consoleError('Failed to build Crosshair Settings overlay:', error);
    overlayMain.handleDisplayError('Failed to open Crosshair Settings');
  }
}