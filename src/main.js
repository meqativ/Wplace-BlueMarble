/** @file The main file. Everything in the userscript is executed from here.
 * @since 0.0.0
 */

import Overlay from './Overlay.js';
import Observers from './observers.js';
import ApiManager from './apiManager.js';
import TemplateManager from './templateManager.js';
import { consoleLog, consoleWarn, consoleError } from './utils.js';

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
var stylesheetLink = document.createElement('link');
stylesheetLink.href = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap';
stylesheetLink.rel = 'preload';
stylesheetLink.as = 'style';
stylesheetLink.onload = function () {
  this.onload = null;
  this.rel = 'stylesheet';
};
document.head?.appendChild(stylesheetLink);

// CONSTRUCTORS
const observers = new Observers(); // Constructs a new Observers object
const overlayMain = new Overlay(name, version); // Constructs a new Overlay object for the main overlay
const overlayTabTemplate = new Overlay(name, version); // Constructs a Overlay object for the template tab
const templateManager = new TemplateManager(name, version, overlayMain); // Constructs a new TemplateManager object
const apiManager = new ApiManager(templateManager); // Constructs a new ApiManager object

overlayMain.setApiManager(apiManager); // Sets the API manager

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

overlayMain.handleDrag('#bm-overlay', '#bm-bar-drag'); // Creates dragging capability on the drag bar for dragging the overlay

apiManager.spontaneousResponseListener(overlayMain); // Reads spontaneous fetch responces

observeBlack(); // Observes the black palette color

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
      .addImg({'alt': 'Blue Marble Icon - Click to minimize/maximize', 'src': 'https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/assets/Favicon.png', 'style': 'cursor: pointer;'}, 
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
            const coordInputs = document.querySelectorAll('#bm-contain-coords input');
            
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
              '#bm-overlay hr',                    // Visual separator lines
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
              
              // Hide all coordinate input fields individually (failsafe)
              coordInputs.forEach(input => {
                input.style.display = 'none';
              });
              
              // Apply fixed dimensions for consistent minimized appearance
              // These dimensions were chosen to accommodate the icon while remaining compact
              overlay.style.width = '60px';    // Fixed width for consistency
              overlay.style.height = '76px';   // Fixed height (60px + 16px for better proportions)
              overlay.style.maxWidth = '60px';  // Prevent expansion
              overlay.style.minWidth = '60px';  // Prevent shrinking
              overlay.style.padding = '8px';    // Comfortable padding around icon
              
              // Apply icon positioning for better visual centering in minimized state
              // The 3px offset compensates for visual weight distribution
              img.style.marginLeft = '3px';
              
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
      .addHeader(1, {'textContent': name}).buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({'id': 'bm-contain-userinfo'})
      .addP({'id': 'bm-user-name', 'textContent': 'Username:'}).buildElement()
      .addP({'id': 'bm-user-droplets', 'textContent': 'Droplets:'}).buildElement()
      .addP({'id': 'bm-user-nextlevel', 'textContent': 'Next level in...'}).buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({'id': 'bm-contain-automation'})
      // .addCheckbox({'id': 'bm-input-stealth', 'textContent': 'Stealth', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Waits for the website to make requests, instead of sending requests.'}).buildElement()
      // .addBr().buildElement()
      // .addCheckbox({'id': 'bm-input-possessed', 'textContent': 'Possessed', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Controls the website as if it were possessed.'}).buildElement()
      // .addBr().buildElement()
      .addDiv({'id': 'bm-contain-coords'})
        .addButton({'id': 'bm-button-coords', 'className': 'bm-help', 'style': 'margin-top: 0;', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 6"><circle cx="2" cy="2" r="2"></circle><path d="M2 6 L3.7 3 L0.3 3 Z"></path><circle cx="2" cy="2" r="0.7" fill="white"></circle></svg></svg>'},
          (instance, button) => {
            button.onclick = () => {
              const coords = instance.apiManager?.coordsTilePixel; // Retrieves the coords from the API manager
              if (!coords?.[0]) {
                instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?');
                return;
              }
              document.querySelector('#bm-input-tx').value = coords?.[0] || '';
              document.querySelector('#bm-input-ty').value = coords?.[1] || '';
              document.querySelector('#bm-input-px').value = coords?.[2] || '';
              document.querySelector('#bm-input-py').value = coords?.[3] || '';
            }
          }
        ).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-tx', 'placeholder': 'Tl X', 'min': 0, 'max': 2047, 'step': 1, 'required': true}).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-ty', 'placeholder': 'Tl Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true}).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-px', 'placeholder': 'Px X', 'min': 0, 'max': 2047, 'step': 1, 'required': true}).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-py', 'placeholder': 'Px Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true}).buildElement()
      .buildElement()
      .addInputFile({'id': 'bm-input-file-template', 'textContent': 'Upload Template', 'accept': 'image/png, image/jpeg, image/webp, image/bmp, image/gif'}).buildElement()
      .addDiv({'id': 'bm-contain-buttons-template'})
        .addButton({'id': 'bm-button-enable', 'textContent': 'Enable'}, (instance, button) => {
          button.onclick = () => {
            instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(true);
            instance.handleDisplayStatus(`Enabled templates!`);
          }
        }).buildElement()
        .addButton({'id': 'bm-button-create', 'textContent': 'Create'}, (instance, button) => {
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

            // console.log(`TCoords: ${apiManager.templateCoordsTilePixel}\nCoords: ${apiManager.coordsTilePixel}`);
            // apiManager.templateCoordsTilePixel = apiManager.coordsTilePixel; // Update template coords
            // console.log(`TCoords: ${apiManager.templateCoordsTilePixel}\nCoords: ${apiManager.coordsTilePixel}`);
            // templateManager.setTemplateImage(input.files[0]);

            instance.handleDisplayStatus(`Drew to canvas!`);
          }
        }).buildElement()
        .addButton({'id': 'bm-button-disable', 'textContent': 'Disable'}, (instance, button) => {
          button.onclick = () => {
            instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(false);
            instance.handleDisplayStatus(`Disabled templates!`);
          }
        }).buildElement()
        .addButton({'id': 'bm-button-color-filter', 'textContent': 'Color Filter'}, (instance, button) => {
          button.onclick = () => {
            buildColorFilterOverlay();
          }
        }).buildElement()
      .buildElement()
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
        .addSmall({'textContent': 'Made by SwingTheVine', 'style': 'margin-top: auto;'}).buildElement()
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

  // Import the color palette from utils
  import('./utils.js').then(utils => {
    const colorPalette = utils.colorpalette;
    
    // Create the color filter overlay
    const colorFilterOverlay = document.createElement('div');
    colorFilterOverlay.id = 'bm-color-filter-overlay';
    colorFilterOverlay.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(21, 48, 99, 0.95);
      color: white;
      padding: 20px;
      border-radius: 12px;
      z-index: 9001;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      font-family: 'Roboto Mono', 'Courier New', 'Monaco', 'DejaVu Sans Mono', monospace, 'Arial';
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.3);
      padding-bottom: 10px;
    `;

    const title = document.createElement('h2');
    title.textContent = 'Template Color Filter';
    title.style.cssText = 'margin: 0; font-size: 1.2em;';

    const closeButton = document.createElement('button');
    closeButton.textContent = '✕';
    closeButton.style.cssText = `
      background: #d32f2f;
      border: none;
      color: white;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    closeButton.onclick = () => colorFilterOverlay.remove();

    header.appendChild(title);
    header.appendChild(closeButton);

    // Instructions
    const instructions = document.createElement('p');
    instructions.textContent = 'Click on colors to toggle their visibility in the template. Disabled colors will be hidden.';
    instructions.style.cssText = 'margin: 0 0 15px 0; font-size: 0.9em; color: #ccc;';

    // Search box
    const searchContainer = document.createElement('div');
    searchContainer.style.cssText = `
      margin: 0 0 20px 0;
      position: relative;
    `;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'bm-color-search';
    searchInput.placeholder = 'Search colors by name or RGB (e.g., "red", "255,0,0")...';
    searchInput.style.cssText = `
      width: 100%;
      padding: 12px 45px 12px 15px;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.3);
      color: white;
      font-size: 1em;
      outline: none;
      transition: all 0.2s ease;
      box-sizing: border-box;
    `;

    const searchIcon = document.createElement('div');
    searchIcon.innerHTML = '🔍';
    searchIcon.style.cssText = `
      position: absolute;
      right: 15px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 1.2em;
      pointer-events: none;
    `;

    const searchClearButton = document.createElement('button');
    searchClearButton.innerHTML = '✕';
    searchClearButton.style.cssText = `
      position: absolute;
      right: 45px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.6);
      font-size: 1.2em;
      cursor: pointer;
      padding: 0;
      width: 20px;
      height: 20px;
      display: none;
      align-items: center;
      justify-content: center;
    `;

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
        searchInput.style.borderColor = '#f44336'; // Red if no results
      } else {
        searchInput.style.borderColor = 'rgba(255, 255, 255, 0.2)'; // Default
      }
    };

    // Search input event listeners
    searchInput.addEventListener('input', (e) => {
      performSearch(e.target.value);
    });

    searchInput.addEventListener('focus', () => {
      searchInput.style.borderColor = '#2196f3';
    });

    searchInput.addEventListener('blur', () => {
      if (!searchInput.value) {
        searchInput.style.borderColor = 'rgba(255, 255, 255, 0.2)';
      }
    });

    // Clear button functionality
    searchClearButton.addEventListener('click', () => {
      searchInput.value = '';
      performSearch('');
      searchInput.focus();
    });

    // Controls
    const controls = document.createElement('div');
    controls.style.cssText = 'margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center;';

    // Enhanced mode info text
    const enhancedInfo = document.createElement('div');
    enhancedInfo.textContent = 'Enhanced Mode: Select individual colors below';
    enhancedInfo.style.cssText = `
      background: #333;
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.9em;
      font-weight: bold;
      text-align: center;
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
    `;

    controls.appendChild(enhancedInfo);
    controls.appendChild(enableAllButton);
    controls.appendChild(disableAllButton);

    // Color grid
    const colorGrid = document.createElement('div');
    colorGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 8px;
      margin-bottom: 20px;
    `;

    // Get current template
    const currentTemplate = templateManager.templatesArray[0];

    // Create color items
    colorPalette.forEach((colorInfo, index) => {
      const colorItem = document.createElement('div');
      const rgb = colorInfo.rgb;
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
        padding: 6px;
        text-align: center;
        transition: all 0.2s ease;
        position: relative;
        min-height: 60px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
      `;

      // Color info and controls container
      const controlsContainer = document.createElement('div');
      controlsContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        width: 100%;
      `;

      // Color enable/disable click area (main area)
      const colorClickArea = document.createElement('div');
      colorClickArea.style.cssText = `
        width: 100%;
        height: 30px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
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
        gap: 4px;
        font-size: 10px;
        color: white;
        text-shadow: 1px 1px 1px rgba(0,0,0,0.8);
        font-weight: bold;
      `;

      const enhancedCheckbox = document.createElement('input');
      enhancedCheckbox.type = 'checkbox';
      enhancedCheckbox.checked = isEnhanced;
      enhancedCheckbox.disabled = isDisabled; // Disable checkbox if color is disabled
      enhancedCheckbox.style.cssText = `
        width: 14px;
        height: 14px;
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
        font-size: 0.8em;
        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
        color: white;
        font-weight: bold;
        z-index: 1;
        position: relative;
      `;

      colorItem.appendChild(colorName);

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

    // Apply button
    const applyButton = document.createElement('button');
    applyButton.textContent = 'Apply & Close';
    applyButton.style.cssText = `
      background: #2196f3;
      border: none;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1em;
      width: 100%;
      margin-top: 10px;
    `;
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

    // Assemble overlay
    colorFilterOverlay.appendChild(header);
    colorFilterOverlay.appendChild(instructions);
    colorFilterOverlay.appendChild(searchContainer);
    colorFilterOverlay.appendChild(controls);
    colorFilterOverlay.appendChild(colorGrid);
    colorFilterOverlay.appendChild(applyButton);

    document.body.appendChild(colorFilterOverlay);
  }).catch(err => {
    consoleError('Failed to load color palette:', err);
    overlayMain.handleDisplayError('Failed to load color palette!');
  });
}

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
}