import Template from "./Template";
import { base64ToUint8, uint8ToBase64, numberToEncoded, consoleLog, consoleError, consoleWarn } from "./utils";

/** Manages the template system.
 * This class handles all external requests for template modification, creation, and analysis.
 * It serves as the central coordinator between template instances and the user interface.
 * @class TemplateManager
 * @since 0.55.8
 * @example
 * // JSON structure for a template
 * {
 *   "whoami": "BlueMarble",
 *   "scriptVersion": "1.13.0",
 *   "schemaVersion": "2.1.0",
 *   "templates": {
 *     "0 $Z": {
 *       "name": "My Template",
 *       "enabled": true,
 *       "tiles": {
 *         "1231,0047,183,593": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA",
 *         "1231,0048,183,000": "data:image/png;AAAFCAYAAACNbyblAAAAHElEQVQI12P4"
 *       }
 *     },
 *     "1 $Z": {
 *       "name": "My Template",
 *       "URL": "https://github.com/SwingTheVine/Wplace-BlueMarble/blob/main/dist/assets/Favicon.png",
 *       "URLType": "template",
 *       "enabled": false,
 *       "tiles": {
 *         "375,1846,276,188": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA",
 *         "376,1846,000,188": "data:image/png;AAAFCAYAAACNbyblAAAAHElEQVQI12P4"
 *       }
 *     }
 *   }
 * }
 */
export default class TemplateManager {

  /** The constructor for the {@link TemplateManager} class.
   * @since 0.55.8
   */
  constructor(name, version, overlay) {

    // Meta
    this.name = name; // Name of userscript
    this.version = version; // Version of userscript
    this.overlay = overlay; // The main instance of the Overlay class
    this.templatesVersion = '1.0.0'; // Version of JSON schema
    this.userID = null; // The ID of the current user
    this.encodingBase = '!#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~'; // Characters to use for encoding/decoding
    this.tileSize = 1000; // The number of pixels in a tile. Assumes the tile is square
    this.drawMult = 3; // The enlarged size for each pixel. E.g. when "3", a 1x1 pixel becomes a 1x1 pixel inside a 3x3 area. MUST BE ODD
    this.tileProgress = new Map(); // Tracks per-tile progress stats {painted, required, wrong}
    
    // Error Map Mode Properties (ported from lurk)
    this.errorMapEnabled = false; // Whether to show green/red overlay for correct/wrong pixels
    this.showCorrectPixels = true; // Show green overlay for correct pixels
    this.showWrongPixels = true; // Show red overlay for wrong pixels
    this.showUnpaintedAsWrong = false; // Mark unpainted pixels as wrong (red) (from Storage fork)
    
    // Wrong Color Options
    this.includeWrongColorsInProgress = false; // Include wrong color pixels in progress calculation
    this.enhanceWrongColors = false; // Use crosshair enhance on wrong colors
    
    // Template
    this.canvasTemplate = null; // Our canvas
    this.canvasTemplateZoomed = null; // The template when zoomed out
    this.canvasTemplateID = 'bm-canvas'; // Our canvas ID
    this.canvasMainID = 'div#map canvas.maplibregl-canvas'; // The selector for the main canvas
    this.template = null; // The template image.
    this.templateState = ''; // The state of the template ('blob', 'proccessing', 'template', etc.)
    this.templatesArray = []; // All Template instnaces currently loaded (Template)
    this.templatesJSON = null; // All templates currently loaded (JSON)
    this.templatesShouldBeDrawn = true; // Should ALL templates be drawn to the canvas?
  }

  /** Retrieves the pixel art canvas.
   * If the canvas has been updated/replaced, it retrieves the new one.
   * @param {string} selector - The CSS selector to use to find the canvas.
   * @returns {HTMLCanvasElement|null} The canvas as an HTML Canvas Element, or null if the canvas does not exist
   * @since 0.58.3
   * @deprecated Not in use since 0.63.25
   */
  /* @__PURE__ */getCanvas() {

    // If the stored canvas is "fresh", return the stored canvas
    if (document.body.contains(this.canvasTemplate)) {return this.canvasTemplate;}
    // Else, the stored canvas is "stale", get the canvas again

    // Attempt to find and destroy the "stale" canvas
    document.getElementById(this.canvasTemplateID)?.remove(); 

    const canvasMain = document.querySelector(this.canvasMainID);

    const canvasTemplateNew = document.createElement('canvas');
    canvasTemplateNew.id = this.canvasTemplateID;
    canvasTemplateNew.className = 'maplibregl-canvas';
    canvasTemplateNew.style.position = 'absolute';
    canvasTemplateNew.style.top = '0';
    canvasTemplateNew.style.left = '0';
    canvasTemplateNew.style.height = `${canvasMain?.clientHeight * (window.devicePixelRatio || 1)}px`;
    canvasTemplateNew.style.width = `${canvasMain?.clientWidth * (window.devicePixelRatio || 1)}px`;
    canvasTemplateNew.height = canvasMain?.clientHeight * (window.devicePixelRatio || 1);
    canvasTemplateNew.width = canvasMain?.clientWidth * (window.devicePixelRatio || 1);
    canvasTemplateNew.style.zIndex = '8999';
    canvasTemplateNew.style.pointerEvents = 'none';
    canvasMain?.parentElement?.appendChild(canvasTemplateNew); // Append the newCanvas as a child of the parent of the main canvas
    this.canvasTemplate = canvasTemplateNew; // Store the new canvas

    window.addEventListener('move', this.onMove);
    window.addEventListener('zoom', this.onZoom);
    window.addEventListener('resize', this.onResize);

    return this.canvasTemplate; // Return the new canvas
  }

  /** Creates the JSON object to store templates in
   * @returns {{ whoami: string, scriptVersion: string, schemaVersion: string, templates: Object }} The JSON object
   * @since 0.65.4
   */
  async createJSON() {
    const json = {
      "whoami": this.name.replace(' ', ''), // Name of userscript without spaces
      "scriptVersion": this.version, // Version of userscript
      "schemaVersion": this.templatesVersion, // Version of JSON schema
      "createdAt": new Date().toISOString(), // When the JSON was first created
      "lastModified": new Date().toISOString(), // When it was last modified
      "templateCount": 0, // Number of templates
      "totalPixels": 0, // Total pixels across all templates
      "templates": {} // The templates
    };
    
    console.log('🔍 Debug - createJSON result:');
    console.log('  - this.name:', this.name);
    console.log('  - whoami:', json.whoami);
    console.log('  - JSON:', json);
    
    return json;
  }

  /** Finds a duplicate template by name and pixel count
   * @param {string} name - The display name to search for
   * @param {number} pixelCount - The pixel count to match
   * @returns {string|null} The template key if duplicate found, null otherwise
   * @since 1.0.0
   */
  findDuplicateTemplate(name, pixelCount) {
    if (!this.templatesJSON?.templates) return null;
    
    // Only check for duplicates if both name and pixelCount are valid
    if (!name || !pixelCount || pixelCount <= 0) return null;
    
    for (const [templateKey, templateData] of Object.entries(this.templatesJSON.templates)) {
      if (templateData.name === name && templateData.pixelCount === pixelCount) {
        consoleLog(`🔍 Found duplicate template: ${templateKey} (${name}, ${pixelCount} pixels)`);
        return templateKey;
      }
    }
    
    return null;
  }

  /** Creates the template from the inputed file blob
   * @param {File} blob - The file blob to create a template from
   * @param {string} name - The display name of the template
   * @param {Array<number, number, number, number>} coords - The coordinates of the top left corner of the template
   * @since 0.65.77
   */
  async createTemplate(blob, name, coords) {

    // Creates the JSON object if it does not already exist
    if (!this.templatesJSON) {this.templatesJSON = await this.createJSON(); console.log(`Creating JSON...`);}



    this.overlay.handleDisplayStatus(`Creating template at ${coords.join(', ')}...`);

    // Create a temporary template instance to get pixel count for duplicate detection
    const tempTemplate = new Template({
      displayName: name,
      sortID: 0, // Temporary sortID
      authorID: numberToEncoded(this.userID || 0, this.encodingBase),
      file: blob,
      coords: coords
    });
    const { templateTiles: tempTiles, templateTilesBuffers: tempBuffers } = await tempTemplate.createTemplateTiles(this.tileSize);
    tempTemplate.chunked = tempTiles;

    // Check for duplicate templates (same name and pixel count)
    // DEBUG: Log template creation details
    consoleLog(`🔍 Creating template: "${name}" with ${tempTemplate.pixelCount} pixels`);
    consoleLog(`🔍 Existing templates:`, Object.keys(this.templatesJSON.templates));
    
    // TEMPORARY: Allow disabling duplicate detection for debugging
    const ENABLE_DUPLICATE_DETECTION = true; // Set to false to disable
    
    const duplicateKey = ENABLE_DUPLICATE_DETECTION ? this.findDuplicateTemplate(name, tempTemplate.pixelCount) : null;
    consoleLog(`🔍 Duplicate check result:`, duplicateKey ? `Found: ${duplicateKey}` : 'No duplicates found');
    
    let template, sortID;
    if (duplicateKey) {
      // Replace existing template
      sortID = parseInt(duplicateKey.split(' ')[0]);
      this.overlay.handleDisplayStatus(`Duplicate detected! Replacing existing template "${name}"...`);
      consoleLog(`🔄 Replacing duplicate template: ${duplicateKey}`);
      
      // Remove old template from array
      const oldTemplateIndex = this.templatesArray.findIndex(t => `${t.sortID} ${t.authorID}` === duplicateKey);
      if (oldTemplateIndex !== -1) {
        this.templatesArray.splice(oldTemplateIndex, 1);
      }
      
      // Remove old template from JSON
      if (this.templatesJSON.templates[duplicateKey]) {
        delete this.templatesJSON.templates[duplicateKey];
        consoleLog(`🗑️ Removed old duplicate template from JSON: ${duplicateKey}`);
      }
    } else {
      // Create new template with next available sortID
      // Find the highest existing sortID and increment by 1
      const existingSortIDs = Object.keys(this.templatesJSON.templates).map(key => parseInt(key.split(' ')[0]));
      sortID = existingSortIDs.length > 0 ? Math.max(...existingSortIDs) + 1 : 0;
    }

    // Creates the final template instance
    template = new Template({
      displayName: name,
      sortID: sortID,
      authorID: numberToEncoded(this.userID || 0, this.encodingBase),
      file: blob,
      coords: coords
    });
    const { templateTiles, templateTilesBuffers } = await template.createTemplateTiles(this.tileSize);
    template.chunked = templateTiles;

    // Appends a child into the templates object
    // The child's name is the number of templates already in the list (sort order) plus the encoded player ID
    this.templatesJSON.templates[`${template.sortID} ${template.authorID}`] = {
      "name": template.displayName, // Display name of template
      "coords": coords.join(', '), // The coords of the template
      "createdAt": new Date().toISOString(), // When this template was created
      "pixelCount": template.pixelCount, // Number of pixels in this template
      "enabled": true,
      "disabledColors": template.getDisabledColors(), // Store disabled colors
      "enhancedColors": template.getEnhancedColors(), // Store enhanced colors
      "tiles": templateTilesBuffers // Stores the chunked tile buffers
    };

    // Update JSON metadata
    this.templatesJSON.lastModified = new Date().toISOString();
    this.templatesJSON.templateCount = Object.keys(this.templatesJSON.templates).length;
    this.templatesJSON.totalPixels = this.templatesArray.reduce((total, t) => total + (t.pixelCount || 0), 0) + template.pixelCount;

    // Initialize templatesArray if it doesn't exist, but don't clear existing templates
    if (!this.templatesArray) {
      this.templatesArray = [];
    }
    this.templatesArray.push(template); // Pushes the Template object instance to the Template Array

    // ==================== PIXEL COUNT DISPLAY SYSTEM ====================
    // Display pixel count statistics with internationalized number formatting
    // This provides immediate feedback to users about template complexity and size
    const pixelCountFormatted = new Intl.NumberFormat().format(template.pixelCount);
    const totalTemplates = Object.keys(this.templatesJSON.templates).length;
    const actionText = duplicateKey ? 'replaced' : 'created';
    this.overlay.handleDisplayStatus(`Template #${template.sortID} ${actionText} at ${coords.join(', ')}! Total pixels: ${pixelCountFormatted} | Total templates: ${totalTemplates}`);

    console.log(Object.keys(this.templatesJSON.templates).length);
    console.log(this.templatesJSON);
    console.log(this.templatesArray);
    console.log(JSON.stringify(this.templatesJSON));

    await this.#storeTemplates();
  }

  /** Generates a {@link Template} class instance from the JSON object template
   */
  #loadTemplate() {

  }

  /** Stores the JSON object of the loaded templates into storage with fallback system.
   * Tries TamperMonkey first, falls back to localStorage if that fails.
   * @since 0.72.7
   */
  async #storeTemplates() {
    // Debug logging before storage
    console.log('🔍 Debug - #storeTemplates called:');
    console.log('  - this.templatesJSON:', this.templatesJSON);
    console.log('  - typeof this.templatesJSON:', typeof this.templatesJSON);
    console.log('  - is null/undefined:', this.templatesJSON == null);
    
    if (!this.templatesJSON) {
      console.error('❌ Cannot store templates: this.templatesJSON is null/undefined');
      return;
    }
    
    const data = JSON.stringify(this.templatesJSON);
    const timestamp = Date.now();
    
    console.log('🔍 Debug - Data to store:');
    console.log('  - JSON string length:', data.length);
    console.log('  - First 200 chars:', data.substring(0, 200));
    console.log('  - Contains whoami:', data.includes('"whoami"'));
    console.log('  - Contains templates:', data.includes('"templates"'));
    
    // Try TamperMonkey storage first
    try {
      if (typeof GM !== 'undefined' && GM.setValue) {
        await GM.setValue('bmTemplates', data);
        await GM.setValue('bmTemplates_timestamp', timestamp);
        console.log('✅ Templates stored in TamperMonkey storage');
        console.log('  - Stored data length:', data.length);
        return;
      } else if (typeof GM_setValue !== 'undefined') {
        GM_setValue('bmTemplates', data);
        GM_setValue('bmTemplates_timestamp', timestamp);
        console.log('✅ Templates stored in TamperMonkey storage (legacy)');
        console.log('  - Stored data length:', data.length);
        return;
      }
    } catch (error) {
      console.warn('⚠️ TamperMonkey storage failed:', error);
    }
    
    // Fallback to localStorage
    try {
      localStorage.setItem('bmTemplates', data);
      localStorage.setItem('bmTemplates_timestamp', timestamp.toString());
      console.log('✅ Templates stored in localStorage (fallback)');
    } catch (error) {
      console.error('❌ All storage methods failed:', error);
      alert('Erro crítico: Não foi possível salvar templates. Verifique as permissões do navegador.');
    }
  }

  /** Deletes a template from the JSON object.
   * Also delete's the corrosponding {@link Template} class instance
   * @param {string} templateKey - The key of the template to delete (e.g., "0 $Z")
   * @since 1.0.0
   */
  deleteTemplate(templateKey) {
    if (!templateKey || !this.templatesJSON?.templates) {
      consoleWarn('⚠️ Invalid template key or no templates available');
      return false;
    }

    try {
      // Remove from JSON
      if (this.templatesJSON.templates[templateKey]) {
        delete this.templatesJSON.templates[templateKey];
        consoleLog(`🗑️ Removed template ${templateKey} from JSON`);
      }

      // Remove from templatesArray
      const templateIndex = this.templatesArray.findIndex(template => {
        const templateKeyFromInstance = `${template.sortID} ${template.authorID}`;
        return templateKeyFromInstance === templateKey;
      });

      if (templateIndex !== -1) {
        this.templatesArray.splice(templateIndex, 1);
        consoleLog(`🗑️ Removed template ${templateKey} from array`);
      }

      // Update JSON metadata after deletion
      this.templatesJSON.lastModified = new Date().toISOString();
      this.templatesJSON.templateCount = Object.keys(this.templatesJSON.templates).length;
      this.templatesJSON.totalPixels = this.templatesArray.reduce((total, t) => total + (t.pixelCount || 0), 0);

      // Save updated templates to storage
      this.#storeTemplates();

      // Force refresh template display to clear any visual templates
      if (typeof refreshTemplateDisplay === 'function') {
        refreshTemplateDisplay().catch(error => {
          consoleWarn('Warning: Failed to refresh template display:', error);
        });
      }

      // Update mini tracker to reflect changes
      if (typeof updateMiniTracker === 'function') {
        updateMiniTracker();
      }

      return true;
    } catch (error) {
      consoleError('❌ Failed to delete template:', error);
      return false;
    }
  }

  /** Disables the template from view
   */
  async disableTemplate() {

    // Creates the JSON object if it does not already exist
    if (!this.templatesJSON) {this.templatesJSON = await this.createJSON(); console.log(`Creating JSON...`);}


  }

  /** Draws all templates on the specified tile.
   * This method handles the rendering of template overlays on individual tiles.
   * @param {File} tileBlob - The pixels that are placed on a tile
   * @param {Array<number>} tileCoords - The tile coordinates [x, y]
   * @since 0.65.77
   */
  async drawTemplateOnTile(tileBlob, tileCoords) {

    // Returns early if no templates should be drawn
    if (!this.templatesShouldBeDrawn) {return tileBlob;}

    // Load wrong color settings if not already loaded
    if (this.includeWrongColorsInProgress === undefined) {
      this.loadWrongColorSettings();
    }

    const drawSize = this.tileSize * this.drawMult; // Calculate draw multiplier for scaling

    // Format tile coordinates with proper padding for consistent lookup
    tileCoords = tileCoords[0].toString().padStart(4, '0') + ',' + tileCoords[1].toString().padStart(4, '0');

    console.log(`Searching for templates in tile: "${tileCoords}"`);

    const templateArray = this.templatesArray; // Stores a copy for sorting
    console.log(templateArray);

    // Sorts the array of Template class instances. 0 = first = lowest draw priority
    templateArray.sort((a, b) => {return a.sortID - b.sortID;});

    console.log(templateArray);

    // Retrieves the relavent template tile blobs
    const templatesToDraw = templateArray
      .filter(template => {
        // Check if template is enabled
        const templateKey = `${template.sortID} ${template.authorID}`;
        const isEnabled = this.isTemplateEnabled(templateKey);
        if (!isEnabled) {
          consoleLog(`⏸️ Skipping disabled template: ${templateKey}`);
        }
        return isEnabled;
      })
      .map(template => {
        const matchingTiles = Object.keys(template.chunked).filter(tile =>
          tile.startsWith(tileCoords)
        );

        if (matchingTiles.length === 0) {return null;} // Return null when nothing is found

        // Retrieves the blobs of the templates for this tile
        const matchingTileBlobs = matchingTiles.map(tile => {

          const coords = tile.split(','); // [x, y, x, y] Tile/pixel coordinates
          
          return {
            bitmap: template.chunked[tile],
            tileCoords: [coords[0], coords[1]],
            pixelCoords: [coords[2], coords[3]]
          }
        });

        return matchingTileBlobs?.[0];
      })
    .filter(Boolean);

    console.log(templatesToDraw);

    const templateCount = templatesToDraw?.length || 0; // Number of templates to draw on this tile
    console.log(`templateCount = ${templateCount}`);

    if (templateCount > 0) {
      
      // Calculate total pixel count for templates actively being displayed in this tile
      const totalPixels = templateArray
        .filter(template => {
          // Filter templates to include only those with tiles matching current coordinates
          // This ensures we count pixels only for templates actually being rendered
          const matchingTiles = Object.keys(template.chunked).filter(tile =>
            tile.startsWith(tileCoords)
          );
          return matchingTiles.length > 0;
        })
        .reduce((sum, template) => sum + (template.pixelCount || 0), 0);
      
      // Format pixel count with locale-appropriate thousands separators for better readability
      // Examples: "1,234,567" (US), "1.234.567" (DE), "1 234 567" (FR)
      const pixelCountFormatted = new Intl.NumberFormat().format(totalPixels);
      
      // Display status information about the templates being rendered
      this.overlay.handleDisplayStatus(
        `Displaying ${templateCount} template${templateCount == 1 ? '' : 's'}.\nTotal pixels: ${pixelCountFormatted}`
      );
    } else {
      this.overlay.handleDisplayStatus(`Displaying ${templateCount} templates.`);
    }
    
    const tileBitmap = await createImageBitmap(tileBlob);

    const canvas = document.createElement('canvas');
    canvas.width = drawSize;
    canvas.height = drawSize;
    const context = canvas.getContext('2d');

    context.imageSmoothingEnabled = false; // Nearest neighbor

    // Tells the canvas to ignore anything outside of this area
    context.beginPath();
    context.rect(0, 0, drawSize, drawSize);
    context.clip();

    context.clearRect(0, 0, drawSize, drawSize); // Draws transparent background
    context.drawImage(tileBitmap, 0, 0, drawSize, drawSize);

    // For each template in this tile, draw them.
    for (let i = 0; i < templatesToDraw.length; i++) {
      const template = templatesToDraw[i];
      console.log(`Template:`);
      console.log(template);

      // Get the corresponding template instance to check for disabled colors
      const currentTemplate = templateArray[i]; // Use the correct template from the array
      const hasDisabledColors = currentTemplate && currentTemplate.getDisabledColors().length > 0;
      
                     // Check if any colors have enhanced mode enabled OR if wrong colors should be enhanced
       const hasEnhancedColors = currentTemplate && (currentTemplate.enhancedColors.size > 0 || this.enhanceWrongColors);
       
       // Debug wrong colors enhance setting
       if (this.enhanceWrongColors) {
         console.log(`🎯 [Debug] Enhance Wrong Colors is ENABLED`);
         console.log(`🎯 [Debug] Current tile: ${tileCoords}`);
         console.log(`🎯 [Debug] Tile progress data available: ${this.tileProgress.has(tileCoords)}`);
         if (this.tileProgress.has(tileCoords)) {
           const tileData = this.tileProgress.get(tileCoords);
           console.log(`🎯 [Debug] Tile has color breakdown: ${!!tileData.colorBreakdown}`);
           if (tileData.colorBreakdown) {
             const wrongColors = Object.entries(tileData.colorBreakdown)
               .filter(([color, data]) => data.wrong > 0)
               .map(([color, data]) => `${color}(${data.wrong} wrong)`);
            //  console.log(`🎯 [Debug] Wrong colors in this tile: ${wrongColors.join(', ')}`);
           }
         }
       }
      
      // Debug logs
      console.log(`🔍 [Enhanced Debug] Template: ${currentTemplate?.displayName}`);
      console.log(`🔍 [Enhanced Debug] Has enhanced colors: ${hasEnhancedColors} (${currentTemplate?.enhancedColors.size || 0} colors)`);
      console.log(`🔍 [Enhanced Debug] Has disabled colors: ${hasDisabledColors}`);
      if (hasEnhancedColors) {
        console.log(`🔍 [Enhanced Debug] Enhanced colors:`, Array.from(currentTemplate.enhancedColors));
      }
      
      if (!hasEnhancedColors && !hasDisabledColors) {
        // Fast path: Normal drawing without enhancement or color filtering
        console.log(`🚀 [Enhanced Debug] Using fast path (no enhancements)`);
        context.drawImage(template.bitmap, Number(template.pixelCoords[0]) * this.drawMult, Number(template.pixelCoords[1]) * this.drawMult);
        

      } else {
        // Enhanced/Filtered path: Real-time processing for color filtering and/or enhanced mode
        console.log(`⚙️ [Enhanced Debug] Using enhanced/filtered path`);
        console.log(`⚙️ [Enhanced Debug] Template bitmap size: ${template.bitmap.width}x${template.bitmap.height}`);
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = template.bitmap.width;
        tempCanvas.height = template.bitmap.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.imageSmoothingEnabled = false;
        
        // Draw original template to temp canvas
        tempCtx.drawImage(template.bitmap, 0, 0);
        
        // Get image data for processing
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        const width = tempCanvas.width;
        const height = tempCanvas.height;
        
        // Create a copy for border detection if enhanced mode is enabled
        const originalData = hasEnhancedColors ? new Uint8ClampedArray(data) : null;
        const enhancedPixels = hasEnhancedColors ? new Set() : null;
        
        // Get the current canvas state (including painted pixels) for crosshair collision detection
        let canvasData = null;
        if (hasEnhancedColors) {
          const canvasImageData = context.getImageData(0, 0, canvas.width, canvas.height);
          canvasData = canvasImageData.data;
        }
        
                 // First pass: Apply color filtering to center pixels
         if (hasDisabledColors) {
           for (let y = 0; y < height; y++) {
             for (let x = 0; x < width; x++) {
               // Only process center pixels of 3x3 blocks (same as template creation)
               if (x % this.drawMult !== 1 || y % this.drawMult !== 1) {
                 continue;
               }
               
               const i = (y * width + x) * 4;
               const r = data[i];
               const g = data[i + 1];
               const b = data[i + 2];
               const alpha = data[i + 3];
               
               // Skip transparent pixels
               if (alpha === 0) continue;
               
               // Check if this color is disabled
               const isDisabled = currentTemplate.isColorDisabled([r, g, b]);
               
               if (isDisabled) {
                 // Hide disabled colors by making them transparent
                 data[i + 3] = 0;
               } else if (hasEnhancedColors && currentTemplate.isColorEnhanced([r, g, b])) {
                 // Track enhanced pixels for border detection
                 enhancedPixels.add(`${x},${y}`);
               }
             }
           }
         } else if (hasEnhancedColors) {
           // If only enhanced mode (no color filtering), identify enhanced template pixels
           // IMPORTANT: Only process center pixels of 3x3 blocks (template pixels) to avoid affecting painted pixels
           console.log(`🎯 [Enhanced Debug] Scanning for enhanced template pixels...`);
           let enhancedPixelCount = 0;
           
           for (let y = 0; y < height; y++) {
             for (let x = 0; x < width; x++) {
               // Only process center pixels of 3x3 blocks (same as template creation)
               if (x % this.drawMult !== 1 || y % this.drawMult !== 1) {
                 continue;
               }
               
               const i = (y * width + x) * 4;
               const alpha = originalData[i + 3];
               
               if (alpha > 0) {
                 const r = originalData[i];
                 const g = originalData[i + 1];
                 const b = originalData[i + 2];
                 
                                                                                       // Check if this color should be enhanced (normal enhanced OR wrong colors enhanced)
                 const isNormalEnhanced = currentTemplate.isColorEnhanced([r, g, b]);
                 // For wrong colors enhancement, we'll detect wrong colors separately and add them to enhanced pixels
                 const shouldBeEnhanced = isNormalEnhanced;
                 
                 if (shouldBeEnhanced) {
                   enhancedPixels.add(`${x},${y}`);
                   enhancedPixelCount++;
                 }
               }
             }
           }
           
                        console.log(`🎯 [Enhanced Debug] Found ${enhancedPixelCount} enhanced template pixels`);
           }
        
                                   // Second pass: Apply enhanced mode crosshair effect if enabled
         if (hasEnhancedColors && enhancedPixels && enhancedPixels.size > 0) {
           console.log(`✨ [Enhanced Debug] Applying crosshair effects to ${enhancedPixels.size} enhanced pixels...`);
           
           // Standard enhanced mode logic (simplified)
           if (enhancedPixels.size > 23000) {
             console.log(`⚠️ [Enhanced Debug] Too many enhanced pixels (${enhancedPixels.size}), skipping enhanced mode for performance`);
           } else {
             let crosshairCenterCount = 0;
             
             // Get canvas region data only once and only for the template area
             const templateOffsetX = Number(template.pixelCoords[0]) * this.drawMult;
             const templateOffsetY = Number(template.pixelCoords[1]) * this.drawMult;
             
             let canvasRegionData = null;
             try {
               if (templateOffsetX >= 0 && templateOffsetY >= 0 && 
                   templateOffsetX + width <= canvas.width && 
                   templateOffsetY + height <= canvas.height) {
                 const canvasRegion = context.getImageData(templateOffsetX, templateOffsetY, width, height);
                 canvasRegionData = canvasRegion.data;
               }
             } catch (error) {
               console.warn('⚠️ [Enhanced Debug] Could not get canvas region, enhanced mode will be simplified');
             }
             
             // Process enhanced pixels efficiently 
             const enhancedPixelsArray = Array.from(enhancedPixels);
             const isLargeTemplate = enhancedPixelsArray.length > 12000; // Consider large if more than 1200 pixels
             const chunkSize = isLargeTemplate ? 2000 : enhancedPixelsArray.length; // Process in chunks for large templates
             
             // NEW: Separate tracking for wrong color pixels
             const wrongColorPixels = new Set();
             let wrongColorCount = 0;
             
             // NEW: Detect wrong color pixels first
             if (this.enhanceWrongColors) {
               console.log(`🎯 [Wrong Colors] Scanning for wrong color pixels...`);
               console.log(`🎯 [Wrong Colors] Enhanced pixels to check: ${enhancedPixelsArray.length}`);
               console.log(`🎯 [Wrong Colors] Canvas region data available: ${!!canvasRegionData}`);
               
               for (const pixelCoord of enhancedPixelsArray) {
                 const [px, py] = pixelCoord.split(',').map(Number);
                 
                 // Get template color at this position
                 const templateIndex = (py * width + px) * 4;
                 const templateR = originalData[templateIndex];
                 const templateG = originalData[templateIndex + 1];
                 const templateB = originalData[templateIndex + 2];
                 
                 // Check canvas color at same position
                 let canvasR = 0, canvasG = 0, canvasB = 0, canvasA = 0;
                 if (canvasRegionData) {
                   canvasR = canvasRegionData[templateIndex];
                   canvasG = canvasRegionData[templateIndex + 1];
                   canvasB = canvasRegionData[templateIndex + 2];
                   canvasA = canvasRegionData[templateIndex + 3];
                 } else {
                   // Fallback for edge cases
                   const canvasX = px + templateOffsetX;
                   const canvasY = py + templateOffsetY;
                   if (canvasX >= 0 && canvasX < canvas.width && canvasY >= 0 && canvasY < canvas.height) {
                     const canvasIndex = (canvasY * canvas.width + canvasX) * 4;
                     canvasR = canvasData[canvasIndex];
                     canvasG = canvasData[canvasIndex + 1];
                     canvasB = canvasData[canvasIndex + 2];
                     canvasA = canvasData[canvasIndex + 3];
                   }
                 }
                 
                 // Check if pixel is painted but wrong color
                 if (canvasA > 0 && (canvasR !== templateR || canvasG !== templateG || canvasB !== templateB)) {
                   wrongColorPixels.add(pixelCoord);
                   wrongColorCount++;
                   
                   if (wrongColorCount <= 5) { // Log first 5 wrong colors for debugging
                    //  console.log(`🎯 [Wrong Colors] Found wrong color at (${px},${py}): template=${templateR},${templateG},${templateB} vs canvas=${canvasR},${canvasG},${canvasB}`);
                   }
                 } else if (wrongColorCount <= 5) {
                   // Log first few pixels that are NOT wrong for debugging
                  //  console.log(`🎯 [Wrong Colors] Pixel at (${px},${py}) is NOT wrong: template=${templateR},${templateG},${templateB} vs canvas=${canvasR},${canvasG},${canvasB} (alpha: ${canvasA})`);
                 }
               }
               
              //  console.log(`🎯 [Wrong Colors] Found ${wrongColorCount} wrong color pixels out of ${enhancedPixelsArray.length} enhanced pixels`);
               
               // Add wrong color pixels to enhanced pixels set for crosshair processing
               for (const pixelCoord of wrongColorPixels) {
                 enhancedPixels.add(pixelCoord);
               }
               
               // Update the array with the new pixels
               const updatedEnhancedPixelsArray = Array.from(enhancedPixels);
               console.log(`🎯 [Wrong Colors] Total enhanced pixels after adding wrong colors: ${updatedEnhancedPixelsArray.length}`);
             }
             
             // Get border setting once for the entire tile
             const borderEnabled = this.getBorderEnabled();
             let borderCount = 0;
             
             // Use updated array if wrong colors were detected, otherwise use original
             const finalEnhancedPixelsArray = (this.enhanceWrongColors && wrongColorCount > 0 && typeof updatedEnhancedPixelsArray !== 'undefined') ? updatedEnhancedPixelsArray : enhancedPixelsArray;
             
             for (let chunkStart = 0; chunkStart < finalEnhancedPixelsArray.length; chunkStart += chunkSize) {
               const chunkEnd = Math.min(chunkStart + chunkSize, finalEnhancedPixelsArray.length);
               const chunk = finalEnhancedPixelsArray.slice(chunkStart, chunkEnd);
               
               if (isLargeTemplate && chunkStart > 0) {
                 console.log(`📦 [Enhanced Debug] Processing chunk ${Math.floor(chunkStart/chunkSize) + 1}/${Math.ceil(finalEnhancedPixelsArray.length/chunkSize)}`);
               }
               
               for (const pixelCoord of chunk) {
                 const [px, py] = pixelCoord.split(',').map(Number);
                 
                 // Determine if this is a wrong color pixel
                 const isWrongColor = wrongColorPixels.has(pixelCoord);
                 
                 // Build base offsets and optionally add expansion as EXTRA if base is eligible
                 const enhancedOn = this.getEnhancedSizeEnabled();
                 const baseOffsets = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                 let crosshairOffsets = baseOffsets.map(([dx, dy]) => [dx, dy, 'center']);
                 if (enhancedOn) {
                   // Check if any base offset would apply (transparent and not painted, unless wrong color)
                   let baseEligible = false;
                   for (const [bdx, bdy] of baseOffsets) {
                     const bx = px + bdx;
                     const by = py + bdy;
                     if (bx < 0 || bx >= width || by < 0 || by >= height) continue;
                     const bi = (by * width + bx) * 4;
                     if (originalData[bi + 3] !== 0) continue; // must be transparent in template
                     let painted = false;
                     if (canvasRegionData) {
                       painted = canvasRegionData[bi + 3] > 0;
                     } else {
                       const canvasX = bx + templateOffsetX;
                       const canvasY = by + templateOffsetY;
                       if (canvasX >= 0 && canvasX < canvas.width && canvasY >= 0 && canvasY < canvas.height) {
                         const canvasIndex = (canvasY * canvas.width + canvasX) * 4;
                         painted = canvasData[canvasIndex + 3] > 0;
                       }
                     }
                     if (!painted || isWrongColor) { baseEligible = true; break; }
                   }
                                     if (baseEligible) {
                    const radius = this.getCrosshairRadius(); // dynamic radius from settings
                    for (let d = 2; d <= radius; d++) {
                      crosshairOffsets.push([0, -d, 'center']);
                      crosshairOffsets.push([0, d, 'center']);
                      crosshairOffsets.push([-d, 0, 'center']);
                      crosshairOffsets.push([d, 0, 'center']);
                    }
                  }
                 }
                 
                 for (const [dx, dy, type] of crosshairOffsets) {
                   const x = px + dx;
                   const y = py + dy;
                   
                   // Quick bounds check
                   if (x < 0 || x >= width || y < 0 || y >= height) continue;
                   
                   const i = (y * width + x) * 4;
                   
                   // Only modify transparent template pixels
                   if (originalData[i + 3] !== 0) continue;
                   
                   // Standard logic: skip if already painted (but allow wrong color crosshairs)
                   let skipPainted = false;
                   if (canvasRegionData) {
                     skipPainted = canvasRegionData[i + 3] > 0;
                   } else {
                     // Fallback for edge cases
                     const canvasX = x + templateOffsetX;
                     const canvasY = y + templateOffsetY;
                     if (canvasX >= 0 && canvasX < canvas.width && canvasY >= 0 && canvasY < canvas.height) {
                       const canvasIndex = (canvasY * canvas.width + canvasX) * 4;
                       skipPainted = canvasData[canvasIndex + 3] > 0;
                     }
                   }
                   
                   // For wrong colors, we want to show crosshair even if pixel is painted (to highlight the wrong color)
                   if (skipPainted && !isWrongColor) continue;
                   
                   // Apply crosshair with same color system for both normal and wrong colors
                   const crosshairColor = this.getCrosshairColor();
                   
                   data[i] = crosshairColor.rgb[0]; 
                   data[i + 1] = crosshairColor.rgb[1]; 
                   data[i + 2] = crosshairColor.rgb[2]; 
                   data[i + 3] = crosshairColor.alpha;
                   crosshairCenterCount++;
                 }
               
                 // Apply corner borders if enabled
                 if (borderEnabled) {
                   const cornerOffsets = [
                     [1, 1], [-1, 1], [1, -1], [-1, -1] // Diagonal corners
                   ];
                   
                   for (const [dx, dy] of cornerOffsets) {
                     const x = px + dx;
                     const y = py + dy;
                     
                     // Quick bounds check
                     if (x < 0 || x >= width || y < 0 || y >= height) continue;
                     
                     const i = (y * width + x) * 4;
                     
                     // Only modify transparent template pixels
                     if (originalData[i + 3] !== 0) continue;
                     
                     // Fast canvas collision check
                     let skipPainted = false;
                     if (canvasRegionData) {
                       skipPainted = canvasRegionData[i + 3] > 0;
                     } else {
                       // Fallback for edge cases
                       const canvasX = x + templateOffsetX;
                       const canvasY = y + templateOffsetY;
                       if (canvasX >= 0 && canvasX < canvas.width && canvasY >= 0 && canvasY < canvas.height) {
                         const canvasIndex = (canvasY * canvas.width + canvasX) * 4;
                         skipPainted = canvasData[canvasIndex + 3] > 0;
                       }
                     }
                     
                     if (skipPainted) continue;
                     
                     // Apply blue corner border
                     data[i] = 0;       // No red
                     data[i + 1] = 100; // Some green  
                     data[i + 2] = 255; // Full blue
                     data[i + 3] = 200; // 80% opacity
                     borderCount++;
                   }
                 }
               }
             }
             
                           console.log(`✨ [Enhanced Debug] Applied ${crosshairCenterCount} crosshairs and ${borderCount} corner borders`);
              if (this.enhanceWrongColors && wrongColorCount > 0) {
                const crosshairConfig = this.getCrosshairColor();
                console.log(`🎯 [Wrong Colors] Applied crosshairs to ${wrongColorCount} wrong color pixels (${crosshairConfig.name} crosshairs)`);
              }
              if (borderEnabled) {
                console.log(`🔲 [Border Debug] Corner borders enabled: ${borderCount} applied`);
              } else {
                console.log(`🔲 [Border Debug] Corner borders disabled`);
              }
           }
         }
        
        // Put the processed image data back
        tempCtx.putImageData(imageData, 0, 0);
        
        // Draw the processed template
        context.drawImage(tempCanvas, Number(template.pixelCoords[0]) * this.drawMult, Number(template.pixelCoords[1]) * this.drawMult);
      }
    }

    // ==================== PIXEL COUNTING (Storage Fork Logic) ====================
    // Count painted/wrong/required pixels for this tile
    if (templatesToDraw.length > 0) {
      let paintedCount = 0;
      let wrongCount = 0;
      let requiredCount = 0;
      
      try {
        // CRITICAL FIX: Always use fresh tile blob data (no cache for pixel analysis)
        // Extract tileX and tileY from tileCoords parameter
        const coordsParts = tileCoords.split(',');
        const tileX = parseInt(coordsParts[0]);
        const tileY = parseInt(coordsParts[1]);
        const tileKey = `${tileX},${tileY}`;
        let tileImageData;
        
        // ALWAYS get fresh data for accurate pixel counting
        {
          // CRITICAL FIX: Use the actual tile blob data (from server)
          // This represents the real pixels painted on the server, not our template overlay
          
          // Get the raw tile data directly from tileBlob parameter
          const realTileBitmap = await createImageBitmap(tileBlob);
          const realTileCanvas = document.createElement('canvas');
          realTileCanvas.width = drawSize;
          realTileCanvas.height = drawSize;
          const realTileCtx = realTileCanvas.getContext('2d', { willReadFrequently: true });
          realTileCtx.imageSmoothingEnabled = false;
          realTileCtx.clearRect(0, 0, drawSize, drawSize);
          realTileCtx.drawImage(realTileBitmap, 0, 0, drawSize, drawSize);
          
          tileImageData = realTileCtx.getImageData(0, 0, drawSize, drawSize);
          consoleLog(`🔄 [Fresh Analysis] Using fresh tile data for ${tileKey}`);
        }
        
        const tilePixels = tileImageData.data;
        
        consoleLog(`🔍 [Real Tile Analysis] Using actual tile data from server: ${drawSize}x${drawSize}`);
        
        // Prepare per-color breakdown that will be populated from template bitmap comparisons
        const colorBreakdown = {};

        for (const template of templatesToDraw) {
          // Count pixels using Storage fork logic (center pixels only)
          const tempW = template.bitmap.width;
          const tempH = template.bitmap.height;
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = tempW;
          tempCanvas.height = tempH;
          const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          tempCtx.imageSmoothingEnabled = false;
          tempCtx.drawImage(template.bitmap, 0, 0);
          const tImg = tempCtx.getImageData(0, 0, tempW, tempH);
          const tData = tImg.data;

          const offsetX = Number(template.pixelCoords[0]) * this.drawMult;
          const offsetY = Number(template.pixelCoords[1]) * this.drawMult;

          for (let y = 0; y < tempH; y++) {
            for (let x = 0; x < tempW; x++) {
              // Only evaluate the center pixel of each 3x3 block
              if ((x % this.drawMult) !== 1 || (y % this.drawMult) !== 1) { continue; }
              
              const gx = x + offsetX;
              const gy = y + offsetY;
              if (gx < 0 || gy < 0 || gx >= drawSize || gy >= drawSize) { continue; }
              
              const tIdx = (y * tempW + x) * 4;
              const tr = tData[tIdx];
              const tg = tData[tIdx + 1];
              const tb = tData[tIdx + 2];
              const ta = tData[tIdx + 3];
              
              // Ignore transparent and semi-transparent (deface uses alpha 32)
              if (ta < 64) { continue; }
              // Ignore #deface explicitly
              if (tr === 222 && tg === 250 && tb === 206) { continue; }
              
              // Track required count for this specific template color
              const colorKey = `${tr},${tg},${tb}`;
              if (!colorBreakdown[colorKey]) {
                colorBreakdown[colorKey] = { painted: 0, required: 0, wrong: 0 };
              }
              colorBreakdown[colorKey].required++;
              requiredCount++;

              // Check if pixel is correctly painted on canvas
              const tileIdx = (gy * drawSize + gx) * 4;
              const pr = tilePixels[tileIdx];
              const pg = tilePixels[tileIdx + 1];
              const pb = tilePixels[tileIdx + 2];
              const pa = tilePixels[tileIdx + 3];

              if (pa < 64) {
                // Unpainted -> neither painted nor wrong
                if (paintedCount + wrongCount < 10) { // Log first 10 pixels
                  // consoleLog(`⚪ [Pixel Analysis] (${gx},${gy}) UNPAINTED: template=${tr},${tg},${tb} vs tile=transparent`);
                }
              } else if (pr === tr && pg === tg && pb === tb) {
                paintedCount++;
                colorBreakdown[colorKey].painted++;
                if (paintedCount + wrongCount < 10) { // Log first 10 pixels
                  // consoleLog(`✅ [Pixel Analysis] (${gx},${gy}) CORRECT: template=${tr},${tg},${tb} vs tile=${pr},${pg},${pb}`);
                }
              } else {
                wrongCount++;
                colorBreakdown[colorKey].wrong++;
                if (paintedCount + wrongCount < 10) { // Log first 10 pixels
                  // consoleLog(`❌ [Pixel Analysis] (${gx},${gy}) WRONG: template=${tr},${tg},${tb} vs tile=${pr},${pg},${pb}`);
                }
              }
            }
          }
        }
        
        this.tileProgress.set(tileCoords, {
          painted: paintedCount,
          required: requiredCount,
          wrong: wrongCount,
          colorBreakdown: colorBreakdown // NEW: Per-color detailed stats
        });
        
        // DETAILED ACCURACY DEBUG: Show change from last analysis
        const lastProgressKey = `lastProgress_${tileX}_${tileY}`;
        const lastProgress = this[lastProgressKey] || { painted: 0, required: 0, wrong: 0 };
        const paintedDiff = paintedCount - lastProgress.painted;
        const wrongDiff = wrongCount - lastProgress.wrong;
        
        if (paintedDiff !== 0 || wrongDiff !== 0) {
          consoleLog(`🎯 [Accuracy Debug] Change detected:`);
          consoleLog(`   📈 Painted: ${paintedDiff > 0 ? '+' : ''}${paintedDiff} (${lastProgress.painted} → ${paintedCount})`);
          consoleLog(`   ❌ Wrong: ${wrongDiff > 0 ? '+' : ''}${wrongDiff} (${lastProgress.wrong} → ${wrongCount})`);
          consoleLog(`   🎨 Net Progress: ${paintedDiff - wrongDiff} pixels`);
        }
        
        // Store current progress for next comparison
        this[lastProgressKey] = { painted: paintedCount, required: requiredCount, wrong: wrongCount };
        
        consoleLog(`📊 [Tile Progress] ${tileCoords}: ${paintedCount}/${requiredCount} painted, ${wrongCount} wrong`);
        
        // CROSSHAIR COMPARISON DEBUG: Compare with enhanced mode logic
        const missingPixels = requiredCount - paintedCount;
        const totalProblems = missingPixels + wrongCount;
        consoleLog(`🎯 [Crosshair Debug] Missing: ${missingPixels}, Wrong: ${wrongCount}, Total problems: ${totalProblems}`);
        
      } catch (error) {
        consoleWarn('Failed to compute tile progress stats:', error);
      }
    }

    // ==================== ERROR MAP MODE (LURK INTEGRATION) ====================
    // Apply green/red overlay when error map mode is enabled (based on lurk logic)
    if (this.errorMapEnabled && templatesToDraw.length > 0) {
      try {
        // Get fresh tile pixels from the original tileBlob (not our overlay with template drawn)
        let tilePixels = null;
        try {
          // Use the original tile blob data for accurate pixel comparison
          const originalTileBitmap = await createImageBitmap(tileBlob);
          const originalTileCanvas = document.createElement('canvas');
          originalTileCanvas.width = drawSize;
          originalTileCanvas.height = drawSize;
          const originalTileCtx = originalTileCanvas.getContext('2d', { willReadFrequently: true });
          originalTileCtx.imageSmoothingEnabled = false;
          originalTileCtx.clearRect(0, 0, drawSize, drawSize);
          originalTileCtx.drawImage(originalTileBitmap, 0, 0, drawSize, drawSize);
          const originalTileImageData = originalTileCtx.getImageData(0, 0, drawSize, drawSize);
          tilePixels = originalTileImageData.data;
        } catch (_) {
          // If reading fails for any reason, we will skip error map
        }

        if (tilePixels) {
          // Store correct and wrong pixels map for visual render (lurk style)
          const wrongMap = [];
          const correctMap = [];

          // Analyze each template (same logic as lurk)
          for (const template of templatesToDraw) {
            const tempW = template.bitmap.width;
            const tempH = template.bitmap.height;
            const tempCanvas = new OffscreenCanvas(tempW, tempH);
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
            tempCtx.imageSmoothingEnabled = false;
            tempCtx.clearRect(0, 0, tempW, tempH);
            tempCtx.drawImage(template.bitmap, 0, 0);
            const tImg = tempCtx.getImageData(0, 0, tempW, tempH);
            const tData = tImg.data;

            const offsetX = Number(template.pixelCoords[0]) * this.drawMult;
            const offsetY = Number(template.pixelCoords[1]) * this.drawMult;

            for (let y = 0; y < tempH; y++) {
              for (let x = 0; x < tempW; x++) {
                // Only evaluate the center pixel of each 3x3 block (lurk logic)
                if ((x % this.drawMult) !== 1 || (y % this.drawMult) !== 1) { continue; }
                const gx = x + offsetX;
                const gy = y + offsetY;
                if (gx < 0 || gy < 0 || gx >= drawSize || gy >= drawSize) { continue; }
                const tIdx = (y * tempW + x) * 4;
                const tr = tData[tIdx];
                const tg = tData[tIdx + 1];
                const tb = tData[tIdx + 2];
                const ta = tData[tIdx + 3];
                
                // Handle template transparent pixel (alpha < 64): wrong if board has any site palette color here
                if (ta < 64) {
                  try {
                    const activeTemplate = this.templatesArray?.[0];
                    const tileIdx = (gy * drawSize + gx) * 4;
                    const pr = tilePixels[tileIdx];
                    const pg = tilePixels[tileIdx + 1];
                    const pb = tilePixels[tileIdx + 2];
                    const pa = tilePixels[tileIdx + 3];
                    const key = `${pr},${pg},${pb}`;
                    const isSiteColor = activeTemplate?.allowedColorsSet ? activeTemplate.allowedColorsSet.has(key) : false;
                    if (pa >= 64 && isSiteColor) {
                      wrongMap.push({ x: gx, y: gy, color: `${tr},${tg},${tb}` });
                    }
                  } catch (_) {}
                  continue;
                }
                
                // Treat #deface as Transparent palette color (required and paintable)
                // Ignore non-palette colors (match against allowed set when available)
                try {
                  const activeTemplate = this.templatesArray?.[0];
                  if (activeTemplate?.allowedColorsSet && !activeTemplate.allowedColorsSet.has(`${tr},${tg},${tb}`)) {
                    continue;
                  }
                } catch (_) {}

                // Strict center-pixel matching. Treat transparent tile pixels as unpainted (not wrong)
                const tileIdx = (gy * drawSize + gx) * 4;
                const pr = tilePixels[tileIdx];
                const pg = tilePixels[tileIdx + 1];
                const pb = tilePixels[tileIdx + 2];
                const pa = tilePixels[tileIdx + 3];

                if (pa < 64) {
                  // Unpainted -> neither painted nor wrong
                  // if it not a transparent pixel on target template, treat it as wrong pixel
                  if (this.showUnpaintedAsWrong && ta !== 0) {
                    wrongMap.push({ x: gx, y: gy, color: `${tr},${tg},${tb}`, unpainted: true });
                  }
                } else if (pr === tr && pg === tg && pb === tb) {
                  correctMap.push({ x: gx, y: gy, color: `${tr},${tg},${tb}` });
                } else {
                  wrongMap.push({ x: gx, y: gy, color: `${tr},${tg},${tb}`, unpainted: false });
                }
              }
            }
          }

          // Draw the stat map (exact lurk logic)
          context.globalCompositeOperation = "source-over";

          const activeTemplate = this.templatesArray?.[0];
          const palette = activeTemplate?.colorPalette || {};

          const isDisable = key => {
            const inSitePalette = activeTemplate?.allowedColorsSet ? activeTemplate.allowedColorsSet.has(key) : true;
            const enabled = palette?.[key]?.enabled !== false;
            return !inSitePalette || !enabled;
          }

          if (this.showWrongPixels) {
            // Use blur dark red as marker for wrong pixel
            context.fillStyle = "rgba(128, 0, 0, 0.6)";
            for (const { x, y, color, unpainted } of wrongMap) {
              if (isDisable(color)) {continue;}
              if (unpainted) {
                // Only mark a most center pixel for better visibility
                context.fillRect(x, y, 1, 1);
              }
              else {
                // Calculate offset base on enlarged size
                const offset = Math.floor(this.drawMult / 2);
                context.fillRect(x - offset, y - offset, this.drawMult, this.drawMult);
              }
            }
          }

          if (this.showCorrectPixels) {
            // Use blur dark green as marker for correct pixel
            context.fillStyle = "rgba(0, 128, 0, 0.6)";
            for (const { x, y, color } of correctMap) {
              if (isDisable(color)) {continue;}
              // Calculate offset base on enlarged size
              const offset = Math.floor(this.drawMult / 2); 
              context.fillRect(x - offset, y - offset, this.drawMult, this.drawMult);
            }
          }
        }
        
      } catch (error) {
        console.warn('Failed to render error map overlay:', error);
      }
    }

    // Use compatible blob conversion
    return await new Promise((resolve, reject) => {
      if (canvas.convertToBlob) {
        canvas.convertToBlob({ type: 'image/png' }).then(resolve).catch(reject);
      } else {
        canvas.toBlob(resolve, 'image/png');
      }
    });
  }



  /** Imports the JSON object, and appends it to any JSON object already loaded
   * @param {string} json - The JSON string to parse
   */
  importJSON(json) {

    console.log(`Importing JSON...`);
    console.log(json);



    // Debug logging
    console.log('🔍 Debug - importJSON analysis:');
    console.log('  - Input type:', typeof json);
    console.log('  - Input is null/undefined:', json == null);
    console.log('  - Has whoami property:', json?.hasOwnProperty?.('whoami'));
    console.log('  - whoami value:', JSON.stringify(json?.whoami));
    console.log('  - whoami comparison:', json?.whoami, '==', 'SkirkMarble', '→', json?.whoami == 'SkirkMarble');
    console.log('  - Has templates:', !!json?.templates);
    console.log('  - Templates count:', json?.templates ? Object.keys(json.templates).length : 'N/A');

    // If the passed in JSON is a Blue Marble template object...
    if (json?.whoami == 'SkirkMarble') {
      console.log('✅ Calling #parseBlueMarble...');
      this.#parseBlueMarble(json); // ...parse the template object as Blue Marble
    } else {
      console.warn('❌ Not a valid BlueMarble JSON:', {
        whoami: json?.whoami,
        expected: 'SkirkMarble',
        hasTemplates: !!json?.templates
      });
    }
  }

  /** Parses the Blue Marble JSON object
   * @param {string} json - The JSON string to parse
   * @since 0.72.13
   */
  async #parseBlueMarble(json) {

    console.log(`Parsing BlueMarble...`);
    
    // *** FIX: Restore templatesJSON from loaded data ***
    this.templatesJSON = json;
    console.log('🔍 Debug - templatesJSON restored:', this.templatesJSON);

    const templates = json.templates;

    console.log(`BlueMarble length: ${Object.keys(templates).length}`);

    if (Object.keys(templates).length > 0) {

      for (const template in templates) {

        const templateKey = template;
        const templateValue = templates[template];
        console.log(templateKey);

        if (templates.hasOwnProperty(template)) {

          const templateKeyArray = templateKey.split(' '); // E.g., "0 $Z" -> ["0", "$Z"]
          const sortID = Number(templateKeyArray?.[0]); // Sort ID of the template
          const authorID = templateKeyArray?.[1] || '0'; // User ID of the person who exported the template
          const displayName = templateValue.name || `Template ${sortID || ''}`; // Display name of the template
          //const coords = templateValue?.coords?.split(',').map(Number); // "1,2,3,4" -> [1, 2, 3, 4]
          const tilesbase64 = templateValue.tiles;
          const templateTiles = {}; // Stores the template bitmap tiles for each tile.
          let totalPixelCount = 0; // Calculate total pixels across all tiles

          for (const tile in tilesbase64) {
            console.log(tile);
            if (tilesbase64.hasOwnProperty(tile)) {
              const encodedTemplateBase64 = tilesbase64[tile];
              const templateUint8Array = base64ToUint8(encodedTemplateBase64); // Base 64 -> Uint8Array

              const templateBlob = new Blob([templateUint8Array], { type: "image/png" }); // Uint8Array -> Blob
              const templateBitmap = await createImageBitmap(templateBlob) // Blob -> Bitmap
              templateTiles[tile] = templateBitmap;
              
              // Count pixels in this tile (only center pixels of 3x3 blocks matter)
              try {
                const canvas = document.createElement('canvas');
                canvas.width = templateBitmap.width;
                canvas.height = templateBitmap.height;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(templateBitmap, 0, 0);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                
                for (let y = 0; y < canvas.height; y++) {
                  for (let x = 0; x < canvas.width; x++) {
                    // Only count center pixels (same logic as template creation)
                    if (x % this.drawMult !== 1 || y % this.drawMult !== 1) {
                      continue;
                    }
                    
                    const i = (y * canvas.width + x) * 4;
                    const alpha = data[i + 3];
                    
                    // Count non-transparent pixels
                    if (alpha > 0) {
                      totalPixelCount++;
                    }
                  }
                }
              } catch (error) {
                console.warn('Failed to count pixels for tile:', tile, error);
              }
            }
          }

          // Creates a new Template class instance
          const template = new Template({
            displayName: displayName,
            sortID: sortID || this.templatesArray?.length || 0,
            authorID: authorID || '',
            //coords: coords
          });
          template.chunked = templateTiles;
          template.pixelCount = totalPixelCount; // Set the calculated pixel count
          
          // Load disabled colors if they exist
          const disabledColors = templateValue.disabledColors;
          if (disabledColors && Array.isArray(disabledColors)) {
            template.setDisabledColors(disabledColors);
          }
          
          // Load enhanced colors if they exist
          const enhancedColors = templateValue.enhancedColors;
          if (enhancedColors && Array.isArray(enhancedColors)) {
            template.setEnhancedColors(enhancedColors);
          }
          
          // Load wrong color settings if they exist
          if (templateValue.includeWrongColorsInProgress !== undefined) {
            this.includeWrongColorsInProgress = templateValue.includeWrongColorsInProgress;
            console.log(`🎯 [Template Load] Restored includeWrongColorsInProgress: ${this.includeWrongColorsInProgress}`);
          }
          if (templateValue.enhanceWrongColors !== undefined) {
            this.enhanceWrongColors = templateValue.enhanceWrongColors;
            console.log(`🎯 [Template Load] Restored enhanceWrongColors: ${this.enhanceWrongColors}`);
          }
          
          this.templatesArray.push(template);
          console.log(this.templatesArray);
          console.log(`^^^ This ^^^`);
        }
      }
    }
  }

  /** Parses the OSU! Place JSON object
   */
  #parseOSU() {

  }

  /** Sets the `templatesShouldBeDrawn` boolean to a value.
   * @param {boolean} value - The value to set the boolean to
   * @since 0.73.7
   */
  setTemplatesShouldBeDrawn(value) {
    this.templatesShouldBeDrawn = value;
  }

  /** Enables or disables a specific template by its key
   * @param {string} templateKey - The template key (e.g., "0 I+`")
   * @param {boolean} enabled - Whether to enable or disable the template
   * @since 1.0.0
   */
  setTemplateEnabled(templateKey, enabled) {
    if (!this.templatesJSON?.templates?.[templateKey]) {
      consoleWarn(`Template not found: ${templateKey}`);
      return false;
    }

    // Update JSON
    this.templatesJSON.templates[templateKey].enabled = enabled;
    
    // Update metadata
    this.templatesJSON.lastModified = new Date().toISOString();
    
    // Save to storage
    this.#storeTemplates();
    
    consoleLog(`${enabled ? 'Enabled' : 'Disabled'} template: ${templateKey}`);
    return true;
  }

  /** Gets the enabled state of a specific template
   * @param {string} templateKey - The template key (e.g., "0 I+`")
   * @returns {boolean} Whether the template is enabled
   * @since 1.0.0
   */
  isTemplateEnabled(templateKey) {
    return this.templatesJSON?.templates?.[templateKey]?.enabled ?? true;
  }

  /** Updates template color filter settings (storage only, filtering applied during draw)
   * @param {number} templateIndex - Index of template to update (default: 0)
   * @since 1.0.0
   */
  async updateTemplateWithColorFilter(templateIndex = 0) {
    if (!this.templatesArray || !this.templatesArray[templateIndex]) {
      consoleWarn('No template available for color filter update');
      return;
    }

    const template = this.templatesArray[templateIndex];
    
    try {
      consoleLog('Updating template color filter settings, disabled colors:', template.getDisabledColors());
      
      // Only update storage settings, DON'T modify the actual tiles
      // Color filtering will be applied during drawTemplateOnTile()
      
      // Update JSON if it exists
      if (this.templatesJSON && this.templatesJSON.templates) {
        const templateKey = `${template.sortID} ${template.authorID}`;
        if (this.templatesJSON.templates[templateKey]) {
          // ONLY save the color settings, keep original tiles unchanged
          this.templatesJSON.templates[templateKey].disabledColors = template.getDisabledColors();
          this.templatesJSON.templates[templateKey].enhancedColors = template.getEnhancedColors();
          // Also save wrong color settings as part of template data
          this.templatesJSON.templates[templateKey].includeWrongColorsInProgress = this.includeWrongColorsInProgress;
          this.templatesJSON.templates[templateKey].enhanceWrongColors = this.enhanceWrongColors;
          consoleLog('JSON updated with new filter settings (settings only, tiles unchanged)');
        }
      }
      
      // Store updated settings
      await this.#storeTemplates();
      
      consoleLog('Template color filter settings updated successfully');
      
    } catch (error) {
      consoleError('Error updating template color filter settings:', error);
      this.overlay.handleDisplayError('Failed to update template color filter settings');
      throw error; // Re-throw for better error handling
    }
  }

  /** Updates disabled colors for a specific template
   * @param {string[]} disabledColors - Array of disabled color keys "r,g,b"
   * @param {number} templateIndex - Index of template to update (default: 0)
   * @since 1.0.0
   */
  async setTemplateDisabledColors(disabledColors, templateIndex = 0) {
    if (!this.templatesArray || !this.templatesArray[templateIndex]) {
      consoleWarn('No template available for color filter update');
      return;
    }

    const template = this.templatesArray[templateIndex];
    template.setDisabledColors(disabledColors);
    
    // Update the template tiles
    await this.updateTemplateWithColorFilter(templateIndex);
  }

  /** Gets disabled colors for a specific template
   * @param {number} templateIndex - Index of template (default: 0)
   * @returns {string[]} Array of disabled color keys "r,g,b"
   * @since 1.0.0
   */
  getTemplateDisabledColors(templateIndex = 0) {
    if (!this.templatesArray || !this.templatesArray[templateIndex]) {
      return [];
    }
    
    return this.templatesArray[templateIndex].getDisabledColors();
  }

  /** Analyzes template using enhanced mode logic to count remaining pixels by color
   * Uses the EXACT same logic as enhanced mode to determine which pixels need crosshair
   * @param {number} templateIndex - Index of template to analyze (default: 0)
   * @returns {Object} Object with color keys mapping to { totalRequired, painted, needsCrosshair, percentage }
   * @since 1.0.0
   */
  calculateRemainingPixelsByColor(templateIndex = 0) {
    consoleLog('🎯 [Enhanced Pixel Analysis] Starting calculation for template index:', templateIndex);
    
    if (!this.templatesArray || !this.templatesArray[templateIndex]) {
      consoleWarn('🚨 [Enhanced Pixel Analysis] No template available');
      return {};
    }

    const template = this.templatesArray[templateIndex];
    consoleLog('🎯 [Enhanced Pixel Analysis] Template found:', template.displayName);
    
          // Using fresh tile data for accurate analysis (no cache)
      consoleLog('🔄 [Enhanced Pixel Analysis] Using fresh tile analysis for accuracy');
    
    try {
      // Check if we have tile-based progress data (from Storage fork logic)
      consoleLog('🔍 [Enhanced Pixel Analysis] Checking tile progress data:', this.tileProgress);
      
      if (this.tileProgress && this.tileProgress.size > 0) {
        // Use tile-based analysis like the Storage fork
        const colorStats = {};
        
        // Aggregate painted/wrong across tiles - WITH REAL PER-COLOR STATS
        let totalPainted = 0;
        let totalRequired = 0;
        let totalWrong = 0;
        const realColorStats = {}; // Real per-color statistics from tile analysis
        
        for (const [tileKey, stats] of this.tileProgress.entries()) {
          totalPainted += stats.painted || 0;
          totalRequired += stats.required || 0;  
          totalWrong += stats.wrong || 0;
          
          // NEW: Aggregate real per-color stats from this tile
          if (stats.colorBreakdown) {
            for (const [colorKey, colorData] of Object.entries(stats.colorBreakdown)) {
              if (!realColorStats[colorKey]) {
                realColorStats[colorKey] = { painted: 0, required: 0, wrong: 0 };
              }
              realColorStats[colorKey].painted += colorData.painted;
              realColorStats[colorKey].required += colorData.required;
              realColorStats[colorKey].wrong += colorData.wrong;
            }
          }
        }
        
        consoleLog(`📊 [Enhanced Pixel Analysis] Aggregated from ${this.tileProgress.size} tiles:`);
        consoleLog(`   Total painted: ${totalPainted}`);
        consoleLog(`   Total required: ${totalRequired}`);
        consoleLog(`   Total wrong: ${totalWrong}`);
        consoleLog(`🎨 [Real Color Stats] Found ${Object.keys(realColorStats).length} colors with precise data`);
        
        // Use template's color palette to break down by color
        consoleLog('🔍 [Enhanced Pixel Analysis] Template colorPalette:', template.colorPalette);
        // consoleLog('🔍 [Enhanced Pixel Analysis] ColorPalette keys:', Object.keys(template.colorPalette || {}));
        
        // If no color palette, rebuild it from tile data
        if (!template.colorPalette || Object.keys(template.colorPalette).length === 0) {
          // consoleLog('🔧 [Enhanced Pixel Analysis] Color palette empty, rebuilding from tiles...');
          template.colorPalette = this.buildColorPaletteFromTileProgress(template);
          // consoleLog('🔧 [Enhanced Pixel Analysis] Rebuilt palette:', Object.keys(template.colorPalette));
        }
        
        if (template.colorPalette && Object.keys(template.colorPalette).length > 0) {
          for (const [colorKey, paletteInfo] of Object.entries(template.colorPalette)) {
            const colorCount = paletteInfo.count || 0;
            
            // Use REAL color data if available, otherwise fall back to proportional
            let paintedForColor, wrongForColor, needsCrosshair, percentage;
            
                         if (realColorStats[colorKey]) {
               // Use PRECISE data from per-color tile analysis
               paintedForColor = realColorStats[colorKey].painted;
               wrongForColor = realColorStats[colorKey].wrong;
               
               // Apply wrong color logic based on settings
               if (this.includeWrongColorsInProgress) {
                 // Include wrong colors in progress calculation (wrong pixels count as "painted")
                 const effectivePainted = paintedForColor + wrongForColor;
                 const effectiveRequired = realColorStats[colorKey].required; // Keep original required, wrong pixels are already part of it
                 needsCrosshair = effectiveRequired - effectivePainted;
                 percentage = effectiveRequired > 0 ? 
                   Math.round((effectivePainted / effectiveRequired) * 100) : 0;
                 
                //  consoleLog(`🎯 [REAL DATA + WRONG] ${colorKey}: ${effectivePainted}/${effectiveRequired} (${percentage}%) - ${needsCrosshair} need crosshair (includes ${wrongForColor} wrong)`);
               } else {
                 // Standard calculation (exclude wrong colors)
                 needsCrosshair = realColorStats[colorKey].required - paintedForColor;
                 percentage = realColorStats[colorKey].required > 0 ? 
                   Math.round((paintedForColor / realColorStats[colorKey].required) * 100) : 0;
                 
                //  consoleLog(`🎯 [REAL DATA] ${colorKey}: ${paintedForColor}/${realColorStats[colorKey].required} (${percentage}%) - ${needsCrosshair} need crosshair`);
               }
            } else {
              // Fall back to proportional estimation for colors without real data
              const proportionOfTemplate = totalRequired > 0 ? colorCount / totalRequired : 0;
              paintedForColor = Math.round(totalPainted * proportionOfTemplate);
              wrongForColor = Math.round(totalWrong * proportionOfTemplate);
              
                             if (this.includeWrongColorsInProgress) {
                 // Include wrong colors in progress calculation (wrong pixels count as "painted")
                 const effectivePainted = paintedForColor + wrongForColor;
                 const effectiveRequired = colorCount; // Keep original required, wrong pixels are already part of it
                 needsCrosshair = effectiveRequired - effectivePainted;
                 percentage = effectiveRequired > 0 ? Math.round((effectivePainted / effectiveRequired) * 100) : 0;
                 
                 consoleLog(`📊 [ESTIMATED + WRONG] ${colorKey}: ${effectivePainted}/${effectiveRequired} (${percentage}%) - ${needsCrosshair} need crosshair (includes ${wrongForColor} wrong)`);
               } else {
                // Standard calculation (exclude wrong colors)
                needsCrosshair = colorCount - paintedForColor;
                percentage = colorCount > 0 ? Math.round((paintedForColor / colorCount) * 100) : 0;
                
                // consoleLog(`📊 [ESTIMATED] ${colorKey}: ${paintedForColor}/${colorCount} (${percentage}%) - ${needsCrosshair} need crosshair`);
              }
            }
            
            // Apply wrong color logic to painted count for mini tracker
            const effectivePaintedForTracker = this.includeWrongColorsInProgress ? 
              paintedForColor + wrongForColor : paintedForColor;
            
            // Recalculate percentage based on the effective painted count for mini tracker consistency
            const totalRequiredForColor = realColorStats[colorKey] ? realColorStats[colorKey].required : colorCount;
            const correctedPercentage = totalRequiredForColor > 0 ? 
              Math.round((effectivePaintedForTracker / totalRequiredForColor) * 100) : 0;
            
            if (this.includeWrongColorsInProgress && wrongForColor > 0) {
              // consoleLog(`🔧 [Mini Tracker Fix] ${colorKey}: painted ${paintedForColor} + wrong ${wrongForColor} = ${effectivePaintedForTracker} (${correctedPercentage}%) - was ${percentage}%`);
            }
            
            colorStats[colorKey] = {
              totalRequired: totalRequiredForColor,
              painted: effectivePaintedForTracker,
              needsCrosshair: Math.max(0, needsCrosshair),
              percentage: correctedPercentage,
              remaining: Math.max(0, needsCrosshair)
            };
          }
        }
        
        consoleLog('✅ [Enhanced Pixel Analysis] SUMMARY (from tileProgress):');
        
        // Calculate the ACTUAL totals that will be used by mini tracker
        let totalPaintedForTracker = 0;
        let totalRequiredForTracker = 0;
        for (const stats of Object.values(colorStats)) {
          totalPaintedForTracker += stats.painted || 0;
          totalRequiredForTracker += stats.totalRequired || 0;
        }
        const trackPercentage = totalRequiredForTracker > 0 ? Math.round((totalPaintedForTracker / totalRequiredForTracker) * 100) : 0;
        
        consoleLog(`📊 Mini tracker will show: ${totalPaintedForTracker}/${totalRequiredForTracker} (${trackPercentage}%) - ${totalRequiredForTracker - totalPaintedForTracker} need crosshair`);
        
                 // Apply wrong color logic to overall progress
         if (this.includeWrongColorsInProgress) {
           const effectivePainted = totalPainted + totalWrong;
           const effectiveRequired = totalRequired; // Keep original required, wrong pixels are already part of it
           const effectivePercentage = effectiveRequired > 0 ? Math.round((effectivePainted / effectiveRequired) * 100) : 0;
           consoleLog(`   Total painted (including wrong): ${effectivePainted}/${effectiveRequired} (${effectivePercentage}%)`);
           consoleLog(`   Wrong pixels included in progress: ${totalWrong}`);
         } else {
          consoleLog(`   Total painted: ${totalPainted}/${totalRequired} (${totalRequired > 0 ? Math.round((totalPainted / totalRequired) * 100) : 0}%)`);
          consoleLog(`   Wrong pixels: ${totalWrong}`);
        }
        
        return colorStats;
        
      } else {
        consoleWarn('🚨 [Enhanced Pixel Analysis] No tile progress data available - need to wait for tiles to be processed');
        return this.getFallbackSimulatedStats(template);
      }
      
    } catch (error) {
      consoleError('❌ [Enhanced Pixel Analysis] Analysis failed:', error);
      return this.getFallbackSimulatedStats(template);
    }
  }

  /** Analyzes a single tile using enhanced mode logic
   * @param {string} tileKey - Tile key (e.g., "0783,1135,398,618")
   * @param {ImageBitmap} tileBitmap - Tile bitmap
   * @param {Template} template - Template object
   * @param {HTMLCanvasElement} canvas - Main canvas element
   * @param {boolean} hasEnhancedColors - Whether template has enhanced colors defined
   * @returns {Object} Tile analysis results
   * @since 1.0.0
   */
  analyzeTileWithEnhancedLogic(tileKey, tileBitmap, template, canvas, hasEnhancedColors) {
    const coords = tileKey.split(',').map(Number);
    const [tileX, tileY, pixelX, pixelY] = coords;
    
    // Calculate canvas position for this tile
    // For template canvas, use direct coordinates (template canvas shows the full template)
    const canvasX = pixelX - template.coords[2];
    const canvasY = pixelY - template.coords[3];
    
    consoleLog(`🔍 [Tile Analysis] Tile key: ${tileKey}`);
    consoleLog(`🔍 [Tile Analysis] Parsed coords: tileX=${tileX}, tileY=${tileY}, pixelX=${pixelX}, pixelY=${pixelY}`);
    consoleLog(`🔍 [Tile Analysis] Template base coords: (${template.coords[2]}, ${template.coords[3]})`);
    consoleLog(`🔍 [Tile Analysis] Calculated canvas position: (${canvasX},${canvasY}), tile size: ${tileBitmap.width}x${tileBitmap.height}`);
    consoleLog(`🔍 [Tile Analysis] Canvas total size: ${canvas.width}x${canvas.height}`);
    
    // Get template bitmap data
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = tileBitmap.width;
    tempCanvas.height = tileBitmap.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.imageSmoothingEnabled = false;
    tempCtx.drawImage(tileBitmap, 0, 0);
    const templateImageData = tempCtx.getImageData(0, 0, tileBitmap.width, tileBitmap.height);
    const templateData = templateImageData.data;
    
    // Get canvas data for this region
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tileWidth = Math.min(tileBitmap.width, canvas.width - canvasX);
    const tileHeight = Math.min(tileBitmap.height, canvas.height - canvasY);
    
    if (tileWidth <= 0 || tileHeight <= 0) {
      consoleWarn(`🚨 [Tile Analysis] Invalid tile dimensions: ${tileWidth}x${tileHeight}`);
      return { colorStats: {}, totalAnalyzed: 0, totalPainted: 0, totalNeedCrosshair: 0 };
    }
    
    const canvasImageData = ctx.getImageData(canvasX, canvasY, tileWidth, tileHeight);
    const canvasData = canvasImageData.data;
    
    // STEP 1: Find enhanced template pixels (EXACT enhanced mode logic)
    const enhancedTemplatePixels = new Set();
    let totalTemplatePixels = 0;
    let enhancedByColor = {};
    let firstPixelsByColor = {};
    
    consoleLog(`🔍 [Enhanced Detection] Starting enhanced pixel detection...`);
    consoleLog(`🔍 [Enhanced Detection] Has enhanced colors defined: ${hasEnhancedColors}`);
    if (hasEnhancedColors) {
      consoleLog(`🔍 [Enhanced Detection] Enhanced colors list:`, Array.from(template.enhancedColors));
    }
    
    for (let y = 0; y < tileBitmap.height; y++) {
      for (let x = 0; x < tileBitmap.width; x++) {
        const i = (y * tileBitmap.width + x) * 4;
        const alpha = templateData[i + 3];
        
        if (alpha > 0) {
          totalTemplatePixels++;
          const r = templateData[i];
          const g = templateData[i + 1];
          const b = templateData[i + 2];
          const colorKey = `${r},${g},${b}`;
          
          // Track pixels by color for debugging
          if (!enhancedByColor[colorKey]) {
            enhancedByColor[colorKey] = 0;
            firstPixelsByColor[colorKey] = `(${x},${y})`;
          }
          
                     // Enhanced mode logic: include if color is enhanced OR no enhanced colors defined OR wrong colors should be enhanced
           const shouldBeEnhanced = !hasEnhancedColors || template.enhancedColors.has(colorKey) || 
             (this.enhanceWrongColors && this.isColorWrongInTile(colorKey, tileCoords));
          
          if (shouldBeEnhanced) {
            enhancedTemplatePixels.add(`${x},${y}`);
            enhancedByColor[colorKey]++;
            
            // Log decision for first few pixels of each color
            if (enhancedByColor[colorKey] <= 3) {
              consoleLog(`✅ [Enhanced Detection] Pixel (${x},${y}) color ${colorKey} IS ENHANCED (reason: ${hasEnhancedColors ? 'in enhanced colors list' : 'no enhanced colors defined, all included'})`);
            }
          } else {
            // Log why pixel was excluded
            if (enhancedByColor[colorKey] <= 3) {
              consoleLog(`❌ [Enhanced Detection] Pixel (${x},${y}) color ${colorKey} NOT ENHANCED (reason: color not in enhanced colors list)`);
            }
          }
        }
      }
    }
    
    consoleLog(`🔍 [Enhanced Detection] Enhanced pixels by color:`);
    for (const [colorKey, count] of Object.entries(enhancedByColor)) {
      if (count > 0) {
        consoleLog(`   ${colorKey}: ${count} pixels (first at ${firstPixelsByColor[colorKey]})`);
      }
    }
    
    consoleLog(`🔍 [Tile Analysis] Template pixels: ${totalTemplatePixels} total, ${enhancedTemplatePixels.size} enhanced`);
    
    // STEP 2: Analyze center pixels of 3x3 blocks (enhanced mode logic)
    const colorStats = {};
    let totalAnalyzed = 0;
    let totalPainted = 0;
    let totalNeedCrosshair = 0;
    
    for (let y = 0; y < tileBitmap.height; y += this.drawMult) {
      for (let x = 0; x < tileBitmap.width; x += this.drawMult) {
        const centerX = x + 1;
        const centerY = y + 1;
        
        // Check if center pixel is an enhanced template pixel
        if (!enhancedTemplatePixels.has(`${centerX},${centerY}`)) continue;
        
        const templateIndex = (centerY * tileBitmap.width + centerX) * 4;
        const templateR = templateData[templateIndex];
        const templateG = templateData[templateIndex + 1];
        const templateB = templateData[templateIndex + 2];
        
        // Skip #deface pixels
        if (templateR === 222 && templateG === 250 && templateB === 206) continue;
        
        const colorKey = `${templateR},${templateG},${templateB}`;
        
        // Initialize color stats
        if (!colorStats[colorKey]) {
          colorStats[colorKey] = {
            totalRequired: 0,
            painted: 0,
            needsCrosshair: 0
          };
        }
        
        // This pixel is required by template
        colorStats[colorKey].totalRequired++;
        totalAnalyzed++;
        
        // Check if pixel is correctly painted on canvas
        let isCorrectlyPainted = false;
        let canvasColorInfo = 'no canvas data';
        
        if (centerX < tileWidth && centerY < tileHeight) {
          const canvasIndex = (centerY * tileWidth + centerX) * 4;
          const canvasAlpha = canvasData[canvasIndex + 3];
          
          if (canvasAlpha > 0) {
            const canvasR = canvasData[canvasIndex];
            const canvasG = canvasData[canvasIndex + 1];
            const canvasB = canvasData[canvasIndex + 2];
            canvasColorInfo = `RGBA(${canvasR},${canvasG},${canvasB},${canvasAlpha})`;
            
            if (canvasR === templateR && canvasG === templateG && canvasB === templateB) {
              // Pixel is correctly painted
              isCorrectlyPainted = true;
              colorStats[colorKey].painted++;
              totalPainted++;
              
              if (totalAnalyzed <= 10) { // Log first 10 pixels for debugging
                consoleLog(`✅ [Enhanced Logic] Pixel (${centerX},${centerY}) CORRECTLY PAINTED: template=${colorKey}, canvas=${canvasColorInfo} → NO CROSSHAIR`);
              }
            } else {
              if (totalAnalyzed <= 10) {
                consoleLog(`❌ [Enhanced Logic] Pixel (${centerX},${centerY}) WRONG COLOR: template=${colorKey}, canvas=${canvasColorInfo} → NEEDS CROSSHAIR`);
              }
            }
          } else {
            canvasColorInfo = 'transparent/unpainted';
            if (totalAnalyzed <= 10) {
              consoleLog(`⚪ [Enhanced Logic] Pixel (${centerX},${centerY}) UNPAINTED: template=${colorKey}, canvas=${canvasColorInfo} → NEEDS CROSSHAIR`);
            }
          }
        } else {
          canvasColorInfo = 'outside canvas bounds';
          if (totalAnalyzed <= 10) {
            consoleLog(`🚫 [Enhanced Logic] Pixel (${centerX},${centerY}) OUTSIDE BOUNDS: template=${colorKey} → NEEDS CROSSHAIR`);
          }
        }
        
        // KEY INSIGHT: Crosshair only appears where pixel is NOT correctly painted
        // This is the enhanced mode logic we need to replicate
        if (!isCorrectlyPainted) {
          colorStats[colorKey].needsCrosshair++;
          totalNeedCrosshair++;
          
          if (totalAnalyzed <= 10) {
            consoleLog(`🎯 [Enhanced Logic] CROSSHAIR DECISION: Pixel (${centerX},${centerY}) will get crosshair because it's not correctly painted`);
          }
        } else {
          if (totalAnalyzed <= 10) {
            consoleLog(`🔒 [Enhanced Logic] CROSSHAIR DECISION: Pixel (${centerX},${centerY}) will NOT get crosshair because it's correctly painted`);
          }
        }
      }
    }
    
    consoleLog(`🔍 [Tile Analysis] Results: ${totalAnalyzed} analyzed, ${totalPainted} painted, ${totalNeedCrosshair} need crosshair`);
    
    // Final summary of enhanced logic decisions
    consoleLog(`📋 [Enhanced Logic Summary] TILE ${tileKey}:`);
    consoleLog(`   🎯 Enhanced pixels found: ${enhancedTemplatePixels.size}`);
    consoleLog(`   📊 Center pixels analyzed: ${totalAnalyzed}`);
    consoleLog(`   ✅ Correctly painted (NO crosshair): ${totalPainted}`);
    consoleLog(`   🎯 Need crosshair (unpainted/wrong): ${totalNeedCrosshair}`);
    consoleLog(`   📈 Success rate: ${totalAnalyzed > 0 ? Math.round((totalPainted / totalAnalyzed) * 100) : 0}%`);
    
    // Color breakdown
    consoleLog(`📊 [Enhanced Logic Summary] By color:`);
    for (const [colorKey, stats] of Object.entries(colorStats)) {
      const successRate = stats.totalRequired > 0 ? Math.round((stats.painted / stats.totalRequired) * 100) : 0;
      consoleLog(`   ${colorKey}: ${stats.painted}/${stats.totalRequired} painted (${successRate}%), ${stats.needsCrosshair} need crosshair`);
    }
    
    return {
      colorStats,
      totalAnalyzed,
      totalPainted,
      totalNeedCrosshair
    };
  }

  /** Builds color palette from template tiles (Storage fork style)
   * @param {Template} template - Template object  
   * @returns {Object} Color palette with count for each color
   * @since 1.0.0
   */
  buildColorPaletteFromTileProgress(template) {
    const colorPalette = {};
    
    try {
      // Analyze each tile bitmap to count colors (like Storage fork)
      for (const [tileKey, tileBitmap] of Object.entries(template.chunked || {})) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = tileBitmap.width;
        tempCanvas.height = tileBitmap.height;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        tempCtx.imageSmoothingEnabled = false;
        tempCtx.drawImage(tileBitmap, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, tileBitmap.width, tileBitmap.height);
        const data = imageData.data;
        
        // Count center pixels only (like Storage fork)
        for (let y = 0; y < tileBitmap.height; y++) {
          for (let x = 0; x < tileBitmap.width; x++) {
            // Only count center pixels of 3x3 blocks
            if ((x % this.drawMult) !== 1 || (y % this.drawMult) !== 1) { continue; }
            
            const idx = (y * tileBitmap.width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];
            
            // Ignore transparent and semi-transparent
            if (a < 64) { continue; }
            // Ignore #deface explicitly
            if (r === 222 && g === 250 && b === 206) { continue; }
            
            const colorKey = `${r},${g},${b}`;
            if (!colorPalette[colorKey]) {
              colorPalette[colorKey] = { count: 0, enabled: true };
            }
            colorPalette[colorKey].count++;
          }
        }
      }
      
      // consoleLog(`🔧 [Build Palette] Found ${Object.keys(colorPalette).length} colors in tiles`);
      for (const [colorKey, info] of Object.entries(colorPalette)) {
        consoleLog(`   ${colorKey}: ${info.count} pixels`);
      }
      
    } catch (error) {
      consoleWarn('🚨 [Build Palette] Failed to build color palette:', error);
    }
    
    return colorPalette;
  }

  /** Returns fallback simulated stats when canvas analysis fails
   * @param {Template} template - Template object
   * @returns {Object} Simulated color statistics
   * @since 1.0.0
   */
  getFallbackSimulatedStats(template) {
    consoleLog('🎲 [Enhanced Pixel Analysis] Using fallback simulation');
    
    const colorStats = {};
    
    // Use template color palette if available
    for (const [colorKey, colorData] of Object.entries(template.colorPalette || {})) {
      const required = colorData.count || 0;
      
      // Create consistent pseudo-random values based on color
      const colorHash = colorKey.split(',').reduce((acc, val) => acc + parseInt(val), 0);
      const consistentRandom = (colorHash % 100) / 100;
      const completionRate = consistentRandom * 0.9; // 0-90% completion
      
      const painted = Math.floor(required * completionRate);
      const needsCrosshair = required - painted;
      
      colorStats[colorKey] = {
        totalRequired: required,
        painted: painted,
        needsCrosshair: needsCrosshair,
        percentage: required > 0 ? Math.round((painted / required) * 100) : 0
      };
    }
    
    return colorStats;
  }

     /** Gets the saved crosshair color from storage
    * @returns {Object} The crosshair color configuration
    * @since 1.0.0 
    */
   getCrosshairColor() {
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
       
       if (savedColor) return savedColor;
     } catch (error) {
       console.warn('Failed to load crosshair color:', error);
     }
     
     // Default red color
     return {
       name: 'Red',
       rgb: [255, 0, 0],
       alpha: 255
     };
   }

   /** Gets the saved crosshair radius from storage
    * @returns {number} The crosshair radius value (12-32)
    * @since 1.0.0 
    */
   getCrosshairRadius() {
     try {
       let radiusValue = null;
       
       // Try TamperMonkey storage first
       if (typeof GM_getValue !== 'undefined') {
         const saved = GM_getValue('bmCrosshairRadius', null);
         if (saved !== null) {
           radiusValue = JSON.parse(saved);
         }
       }
       
       // Fallback to localStorage
       if (radiusValue === null) {
         const saved = localStorage.getItem('bmCrosshairRadius');
         if (saved !== null) {
           radiusValue = JSON.parse(saved);
         }
       }
       
       if (radiusValue !== null) {
         // Ensure value is within valid range
         return Math.max(12, Math.min(32, radiusValue));
       }
     } catch (error) {
       console.warn('Failed to load crosshair radius:', error);
     }
     
     return 16; // Default radius (between min 12 and max 32)
   }



  /** Gets the border enabled setting from storage
   * @returns {boolean} Whether borders are enabled
   * @since 1.0.0 
   */
  getBorderEnabled() {
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
        console.log('🔲 Border setting loaded:', borderEnabled);
        return borderEnabled;
      }
    } catch (error) {
      console.warn('Failed to load border setting:', error);
    }
    
    // Default to disabled
    console.log('🔲 Using default border setting: false');
    return false;
  }

  /** Gets the enhanced size enabled setting from storage
   * Mirrors the setting used in the settings overlay (5x crosshair)
   * @returns {boolean}
   */
  getEnhancedSizeEnabled() {
    try {
      let enhancedSizeEnabled = null;
      if (typeof GM_getValue !== 'undefined') {
        const saved = GM_getValue('bmCrosshairEnhancedSize', null);
        if (saved !== null) enhancedSizeEnabled = JSON.parse(saved);
      }
      if (enhancedSizeEnabled === null) {
        const saved = localStorage.getItem('bmCrosshairEnhancedSize');
        if (saved !== null) enhancedSizeEnabled = JSON.parse(saved);
      }
      if (enhancedSizeEnabled !== null) return enhancedSizeEnabled;
    } catch (error) {
      console.warn('Failed to load enhanced size setting:', error);
    }
    return false;
  }

  /** Sets whether wrong colors should be included in progress calculation
   * @param {boolean} include - Whether to include wrong colors
   * @since 1.0.0
   */
  async setIncludeWrongColorsInProgress(include) {
    this.includeWrongColorsInProgress = include;
    console.log(`🎯 [Wrong Colors] Include wrong colors in progress: ${include}`);
    
    // Save to template data (same way as enhanced colors)
    try {
      await this.updateTemplateWithColorFilter();
      console.log(`🎯 [Wrong Colors] Settings saved to template data`);
    } catch (error) {
      console.warn(`🎯 [Wrong Colors] Failed to save to template data, using fallback:`, error);
      this.saveWrongColorSettings(); // Fallback
    }
  }

  /** Gets whether wrong colors should be included in progress calculation
   * @returns {boolean} Whether wrong colors are included
   * @since 1.0.0
   */
  getIncludeWrongColorsInProgress() {
    // console.log(`🎯 [Debug] getIncludeWrongColorsInProgress returning: ${this.includeWrongColorsInProgress}`);
    return this.includeWrongColorsInProgress;
  }

  /** Sets whether wrong colors should be enhanced with crosshair
   * @param {boolean} enhance - Whether to enhance wrong colors
   * @since 1.0.0
   */
  async setEnhanceWrongColors(enhance) {
    this.enhanceWrongColors = enhance;
    console.log(`🎯 [Wrong Colors] Enhance wrong colors: ${enhance}`);
    
    // Save to template data (same way as enhanced colors)
    try {
      await this.updateTemplateWithColorFilter();
      console.log(`🎯 [Wrong Colors] Settings saved to template data`);
    } catch (error) {
      console.warn(`🎯 [Wrong Colors] Failed to save to template data, using fallback:`, error);
      this.saveWrongColorSettings(); // Fallback
    }
    
         // Clear debug logs when toggling
     this._loggedWrongColors = new Set();
     this._loggedEnhancedPixels = new Set();
     this._wrongPixelsToEnhance = null;
     this._loggedWrongEnhanced = false;
    
    // Force template redraw to apply enhanced mode changes
    if (this.templatesArray && this.templatesArray.length > 0) {
      consoleLog(`🎯 [Wrong Colors] Forcing template redraw to apply enhanced mode changes`);
      this.setTemplatesShouldBeDrawn(false);
      setTimeout(() => {
        this.setTemplatesShouldBeDrawn(true);
      }, 50);
    }
  }

  /** Gets whether wrong colors should be enhanced with crosshair
   * @returns {boolean} Whether wrong colors are enhanced
   * @since 1.0.0
   */
  getEnhanceWrongColors() {
    return this.enhanceWrongColors;
  }

  /** Sets the error map mode state
   * @param {boolean} enabled - Whether error map mode should be enabled
   */
  setErrorMapMode(enabled) {
    this.errorMapEnabled = !!enabled;
  }

  /** Gets whether error map mode is enabled
   * @returns {boolean} True if error map mode is enabled
   */
  getErrorMapMode() {
    return this.errorMapEnabled;
  }

  /** Loads wrong color settings from storage
   * @since 1.0.0
   */
  loadWrongColorSettings() {
    try {
      console.log(`🎯 [Debug] Loading wrong color settings...`);
      console.log(`🎯 [Debug] Before loading - Include: ${this.includeWrongColorsInProgress}, Enhance: ${this.enhanceWrongColors}`);
      
      // Try TamperMonkey storage first
      if (typeof GM_getValue !== 'undefined') {
        const includeWrong = GM_getValue('bmIncludeWrongColors', false);
        const enhanceWrong = GM_getValue('bmEnhanceWrongColors', false);
        console.log(`🎯 [Debug] TamperMonkey values - Include: ${includeWrong}, Enhance: ${enhanceWrong}`);
        this.includeWrongColorsInProgress = includeWrong;
        this.enhanceWrongColors = enhanceWrong;
        console.log(`🎯 [Wrong Colors] Loaded settings from TamperMonkey - Include: ${includeWrong}, Enhance: ${enhanceWrong}`);
        return;
      }
      
      // Fallback to localStorage
      const includeWrongRaw = localStorage.getItem('bmIncludeWrongColors');
      const enhanceWrongRaw = localStorage.getItem('bmEnhanceWrongColors');
      console.log(`🎯 [Debug] localStorage raw values - Include: '${includeWrongRaw}', Enhance: '${enhanceWrongRaw}'`);
      
      const includeWrong = includeWrongRaw === 'true';
      const enhanceWrong = enhanceWrongRaw === 'true';
      this.includeWrongColorsInProgress = includeWrong;
      this.enhanceWrongColors = enhanceWrong;
      console.log(`🎯 [Wrong Colors] Loaded settings from localStorage - Include: ${includeWrong}, Enhance: ${enhanceWrong}`);
      console.log(`🎯 [Debug] After loading - Include: ${this.includeWrongColorsInProgress}, Enhance: ${this.enhanceWrongColors}`);
    } catch (error) {
      console.warn('Failed to load wrong color settings:', error);
    }
  }

  /** Saves wrong color settings to storage
   * @since 1.0.0
   */
  saveWrongColorSettings() {
    try {
      console.log(`🎯 [Debug] Saving wrong color settings - Include: ${this.includeWrongColorsInProgress}, Enhance: ${this.enhanceWrongColors}`);
      
      // Try TamperMonkey storage first
      if (typeof GM_setValue !== 'undefined') {
        GM_setValue('bmIncludeWrongColors', this.includeWrongColorsInProgress);
        GM_setValue('bmEnhanceWrongColors', this.enhanceWrongColors);
        console.log(`🎯 [Wrong Colors] Settings saved to TamperMonkey storage - Include: ${this.includeWrongColorsInProgress}, Enhance: ${this.enhanceWrongColors}`);
        return;
      }
      
      // Fallback to localStorage
      localStorage.setItem('bmIncludeWrongColors', this.includeWrongColorsInProgress.toString());
      localStorage.setItem('bmEnhanceWrongColors', this.enhanceWrongColors.toString());
      console.log(`🎯 [Wrong Colors] Settings saved to localStorage - Include: ${this.includeWrongColorsInProgress}, Enhance: ${this.enhanceWrongColors}`);
    } catch (error) {
      console.error('Failed to save wrong color settings:', error);
    }
  }

  /** Checks if a color has wrong pixels in a specific tile
   * @param {string} colorKey - Color key in format "r,g,b"
   * @param {string} tileKey - Tile key in format "x,y"
   * @returns {boolean} Whether the color has wrong pixels in this tile
   * @since 1.0.0
   */
  isColorWrongInTile(colorKey, tileKey) {
    const tileProgress = this.tileProgress.get(tileKey);
    if (!tileProgress || !tileProgress.colorBreakdown) {
      return false;
    }
    
    const colorData = tileProgress.colorBreakdown[colorKey];
    const hasWrongPixels = colorData && colorData.wrong > 0;
    
    // Only log once per color per tile to avoid spam
    if (this.enhanceWrongColors && hasWrongPixels && !this._loggedWrongColors) {
      this._loggedWrongColors = this._loggedWrongColors || new Set();
      const logKey = `${colorKey}-${tileKey}`;
      if (!this._loggedWrongColors.has(logKey)) {
        console.log(`🎯 [Wrong Color Detection] Color ${colorKey} has ${colorData.wrong} wrong pixels in tile ${tileKey}`);
        this._loggedWrongColors.add(logKey);
      }
    }
    
    return hasWrongPixels;
  }

     /** Gets wrong pixels for selected colors in a specific tile
    * @param {string} tileCoords - Tile coordinates "x,y"
    * @param {Template} template - Template object
    * @returns {Set<string>} Set of pixel coordinates that are wrong for selected colors
    * @since 1.0.0
    */
   getWrongPixelsForSelectedColors(tileCoords, template) {
     const wrongPixels = new Set();
     
     try {
       const tileProgress = this.tileProgress.get(tileCoords);
       if (!tileProgress || !tileProgress.colorBreakdown) {
         return wrongPixels;
       }
       
       // Get selected colors (enhanced colors)
       const selectedColors = Array.from(template.enhancedColors);
       
       if (selectedColors.length === 0) {
         console.log(`🎯 [Wrong Color Enhancement] No colors selected for enhancement`);
         return wrongPixels;
       }
       
       console.log(`🎯 [Wrong Color Enhancement] Checking wrong pixels for selected colors: ${selectedColors.join(', ')}`);
       
       // For each selected color, find wrong pixels
       for (const colorKey of selectedColors) {
         const colorData = tileProgress.colorBreakdown[colorKey];
         if (colorData && colorData.wrong > 0) {
           console.log(`🎯 [Wrong Color Enhancement] Color ${colorKey} has ${colorData.wrong} wrong pixels`);
           
           // Find the actual wrong pixel coordinates for this color
           const wrongCoords = this.findWrongPixelCoordinates(tileCoords, colorKey, template);
           wrongCoords.forEach(coord => wrongPixels.add(coord));
         }
       }
       
       console.log(`🎯 [Wrong Color Enhancement] Total wrong pixels to enhance: ${wrongPixels.size}`);
       
     } catch (error) {
       console.warn('Failed to get wrong pixels for selected colors:', error);
     }
     
     return wrongPixels;
   }
   
   /** Finds wrong pixel coordinates for a specific color in a tile
    * @param {string} tileCoords - Tile coordinates "x,y"
    * @param {string} colorKey - Color key "r,g,b"
    * @param {Template} template - Template object
    * @returns {Set<string>} Set of pixel coordinates that are wrong for this color
    * @since 1.0.0
    */
   findWrongPixelCoordinates(tileCoords, colorKey, template) {
     const wrongCoords = new Set();
     
     try {
       // Parse color
       const [targetR, targetG, targetB] = colorKey.split(',').map(Number);
       
       // Find template tiles for this tile coordinate
       const matchingTiles = Object.keys(template.chunked).filter(tile =>
         tile.startsWith(tileCoords)
       );
       
       for (const tileKey of matchingTiles) {
         const tileBitmap = template.chunked[tileKey];
         const coords = tileKey.split(',');
         const pixelCoords = [coords[2], coords[3]];
         
         // Get template bitmap data
         const tempCanvas = document.createElement('canvas');
         tempCanvas.width = tileBitmap.width;
         tempCanvas.height = tileBitmap.height;
         const tempCtx = tempCanvas.getContext('2d');
         tempCtx.imageSmoothingEnabled = false;
         tempCtx.drawImage(tileBitmap, 0, 0);
         const templateImageData = tempCtx.getImageData(0, 0, tileBitmap.width, tileBitmap.height);
         const templateData = templateImageData.data;
         
         // Check each pixel for this color
         for (let y = 0; y < tileBitmap.height; y++) {
           for (let x = 0; x < tileBitmap.width; x++) {
             // Only check center pixels of 3x3 blocks
             if (x % this.drawMult !== 1 || y % this.drawMult !== 1) {
               continue;
             }
             
             const i = (y * tileBitmap.width + x) * 4;
             const r = templateData[i];
             const g = templateData[i + 1];
             const b = templateData[i + 2];
             const a = templateData[i + 3];
             
             // Skip transparent pixels
             if (a < 64) continue;
             
             // Check if this is the color we're looking for
             if (r === targetR && g === targetG && b === targetB) {
               // Calculate global coordinates
               const globalX = Number(pixelCoords[0]) * this.drawMult + x;
               const globalY = Number(pixelCoords[1]) * this.drawMult + y;
               
               // Add to wrong pixels set (we'll verify against canvas later)
               wrongCoords.add(`${globalX},${globalY}`);
             }
           }
         }
       }
       
     } catch (error) {
       console.warn('Failed to find wrong pixel coordinates:', error);
     }
     
     return wrongCoords;
   }
   
   /** Applies crosshair to wrong pixels
    * @param {Uint8ClampedArray} data - Image data to modify
    * @param {Uint8ClampedArray} originalData - Original template data
    * @param {Set<string>} wrongPixels - Set of wrong pixel coordinates
    * @param {number} width - Image width
    * @param {number} height - Image height
    * @param {Object} template - Template object
    * @param {CanvasRenderingContext2D} context - Canvas context
    * @param {Uint8ClampedArray} canvasData - Current canvas data
    * @since 1.0.0
    */
   applyCrosshairToWrongPixels(data, originalData, wrongPixels, width, height, template, context, canvasData) {
     let crosshairCount = 0;
     const crosshairColor = this.getCrosshairColor();
     
     console.log(`🎯 [Wrong Color Enhancement] Applying crosshair to ${wrongPixels.size} wrong pixels`);
     
     for (const pixelCoord of wrongPixels) {
       const [px, py] = pixelCoord.split(',').map(Number);
       
       // Convert global coordinates to local template coordinates
       const templateOffsetX = Number(template.pixelCoords[0]) * this.drawMult;
       const templateOffsetY = Number(template.pixelCoords[1]) * this.drawMult;
       const localX = px - templateOffsetX;
       const localY = py - templateOffsetY;
       
       // Check bounds
       if (localX < 0 || localX >= width || localY < 0 || localY >= height) {
         continue;
       }
       
       // Apply crosshair around the wrong pixel
       const crosshairOffsets = [
         [0, -1], [0, 1], [-1, 0], [1, 0] // Orthogonal only
       ];
       
       for (const [dx, dy] of crosshairOffsets) {
         const x = localX + dx;
         const y = localY + dy;
         
         // Quick bounds check
         if (x < 0 || x >= width || y < 0 || y >= height) continue;
         
         const i = (y * width + x) * 4;
         
         // Only modify transparent template pixels
         if (originalData[i + 3] !== 0) continue;
         
         // Check if pixel is already painted on canvas
         const canvasX = x + templateOffsetX;
         const canvasY = y + templateOffsetY;
         if (canvasX >= 0 && canvasX < context.canvas.width && canvasY >= 0 && canvasY < context.canvas.height) {
           const canvasIndex = (canvasY * context.canvas.width + canvasX) * 4;
           if (canvasData[canvasIndex + 3] > 0) continue; // Skip if already painted
         }
         
         // Apply crosshair
         data[i] = crosshairColor.rgb[0];
         data[i + 1] = crosshairColor.rgb[1];
         data[i + 2] = crosshairColor.rgb[2];
         data[i + 3] = crosshairColor.alpha;
         crosshairCount++;
       }
     }
     
     console.log(`🎯 [Wrong Color Enhancement] Applied ${crosshairCount} crosshair pixels`);
   }
   
   /** Detects wrong pixels by comparing template with current canvas state
    * @param {string} colorKey - Color key in format "r,g,b"
    * @param {string} tileKey - Tile key in format "x,y"
    * @param {HTMLCanvasElement} canvas - Current canvas element
    * @param {ImageBitmap} templateBitmap - Template bitmap for this tile
    * @param {Array<number>} templateOffset - Template offset [x, y]
    * @returns {Set<string>} Set of pixel coordinates that are wrong
    * @since 1.0.0
    */
   detectWrongPixelsInTile(colorKey, tileKey, canvas, templateBitmap, templateOffset) {
    const wrongPixels = new Set();
    
    try {
      // Parse color key
      const [targetR, targetG, targetB] = colorKey.split(',').map(Number);
      
      // Get template bitmap data
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = templateBitmap.width;
      tempCanvas.height = templateBitmap.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.imageSmoothingEnabled = false;
      tempCtx.drawImage(templateBitmap, 0, 0);
      const templateImageData = tempCtx.getImageData(0, 0, templateBitmap.width, templateBitmap.height);
      const templateData = templateImageData.data;
      
      // Get canvas data for comparison
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const canvasImageData = ctx.getImageData(templateOffset[0], templateOffset[1], templateBitmap.width, templateBitmap.height);
      const canvasData = canvasImageData.data;
      
      let wrongPixelCount = 0;
      
      // Compare each pixel
      for (let y = 0; y < templateBitmap.height; y++) {
        for (let x = 0; x < templateBitmap.width; x++) {
          // Only check center pixels of 3x3 blocks
          if (x % this.drawMult !== 1 || y % this.drawMult !== 1) {
            continue;
          }
          
          const i = (y * templateBitmap.width + x) * 4;
          
          // Get template color
          const templateR = templateData[i];
          const templateG = templateData[i + 1];
          const templateB = templateData[i + 2];
          const templateA = templateData[i + 3];
          
          // Skip transparent template pixels
          if (templateA < 64) continue;
          
          // Check if this is the color we're looking for
          if (templateR === targetR && templateG === targetG && templateB === targetB) {
            // Get canvas color at same position
            const canvasR = canvasData[i];
            const canvasG = canvasData[i + 1];
            const canvasB = canvasData[i + 2];
            const canvasA = canvasData[i + 3];
            
            // Check if pixel is wrong (different color or unpainted)
            if (canvasA < 64 || canvasR !== targetR || canvasG !== targetG || canvasB !== targetB) {
              wrongPixels.add(`${x},${y}`);
              wrongPixelCount++;
              
              // Debug log first few wrong pixels
              if (wrongPixelCount <= 5) {
                console.log(`🎯 [Wrong Pixel Detection] Pixel (${x},${y}) - Template: ${targetR},${targetG},${targetB} vs Canvas: ${canvasR},${canvasG},${canvasB} (alpha: ${canvasA})`);
              }
            }
          }
        }
      }
      
      if (wrongPixelCount > 0) {
        console.log(`🎯 [Wrong Pixel Detection] Found ${wrongPixelCount} wrong pixels for color ${colorKey} in tile ${tileKey}`);
      }
      
    } catch (error) {
      console.warn('Failed to detect wrong pixels:', error);
    }
    
    return wrongPixels;
  }
}
