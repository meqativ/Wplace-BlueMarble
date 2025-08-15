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
    
    // Pixel progress tracking
    this.globalColorStats = new Map(); // Global statistics across all tiles: colorKey -> {required, painted, correct}
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
      "templates": {} // The templates
    };
    
    console.log('🔍 Debug - createJSON result:');
    console.log('  - this.name:', this.name);
    console.log('  - whoami:', json.whoami);
    console.log('  - JSON:', json);
    
    return json;
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

    // Reset progress statistics when creating new template
    this.resetProgressStats();

    this.overlay.handleDisplayStatus(`Creating template at ${coords.join(', ')}...`);

    // Creates a new template instance
    const template = new Template({
      displayName: name,
      sortID: 0, // Object.keys(this.templatesJSON.templates).length || 0, // Uncomment this to enable multiple templates (1/2)
      authorID: numberToEncoded(this.userID || 0, this.encodingBase),
      file: blob,
      coords: coords
    });
    //template.chunked = await template.createTemplateTiles(this.tileSize); // Chunks the tiles
    const { templateTiles, templateTilesBuffers } = await template.createTemplateTiles(this.tileSize); // Chunks the tiles
    template.chunked = templateTiles; // Stores the chunked tile bitmaps

    // Appends a child into the templates object
    // The child's name is the number of templates already in the list (sort order) plus the encoded player ID
    this.templatesJSON.templates[`${template.sortID} ${template.authorID}`] = {
      "name": template.displayName, // Display name of template
      "coords": coords.join(', '), // The coords of the template
      "enabled": true,
      "disabledColors": template.getDisabledColors(), // Store disabled colors
      "enhancedColors": template.getEnhancedColors(), // Store enhanced colors
      "tiles": templateTilesBuffers // Stores the chunked tile buffers
    };

    this.templatesArray = []; // Remove this to enable multiple templates (2/2)
    this.templatesArray.push(template); // Pushes the Template object instance to the Template Array

    // ==================== PIXEL COUNT DISPLAY SYSTEM ====================
    // Display pixel count statistics with internationalized number formatting
    // This provides immediate feedback to users about template complexity and size
    const pixelCountFormatted = new Intl.NumberFormat().format(template.pixelCount);
    this.overlay.handleDisplayStatus(`Template created at ${coords.join(', ')}! Total pixels: ${pixelCountFormatted}`);

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
   */
  deleteTemplate() {

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
    for (const template of templatesToDraw) {
      console.log(`Template:`);
      console.log(template);

      // Get the current template instance to check for disabled colors
      const currentTemplate = this.templatesArray?.[0]; // Assuming single template for now
      const hasDisabledColors = currentTemplate && currentTemplate.getDisabledColors().length > 0;
      
      // Check if any colors have enhanced mode enabled
      const hasEnhancedColors = currentTemplate && currentTemplate.enhancedColors.size > 0;
      
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
        
        // Count pixels by color for progress tracking (fast path)
        this.#analyzePixelProgress(tileBitmap, template, tileCoords);
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
                
                if (currentTemplate.isColorEnhanced([r, g, b])) {
                  enhancedPixels.add(`${x},${y}`);
                  enhancedPixelCount++;
                }
              }
            }
          }
          
          console.log(`🎯 [Enhanced Debug] Found ${enhancedPixelCount} enhanced template pixels`);
        }
        
        // Second pass: Apply enhanced mode crosshair effect if enabled
        if (hasEnhancedColors && enhancedPixels) {
          console.log(`✨ [Enhanced Debug] Applying crosshair effects to ${enhancedPixels.size} enhanced pixels...`);
          let crosshairCenterCount = 0;
          let crosshairCornerCount = 0;
          
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const i = (y * width + x) * 4;
              const alpha = originalData[i + 3];
              
              // Only modify transparent pixels (leave template pixels with original colors)
              if (alpha === 0) {
                
                // Check for red center positions (orthogonal neighbors)
                const centerPositions = [
                  [x, y-1], // top
                  [x, y+1], // bottom  
                  [x-1, y], // left
                  [x+1, y]  // right
                ];
                
                let isCenter = false;
                for (const [cx, cy] of centerPositions) {
                  // Skip if out of bounds
                  if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
                  
                  // Only apply enhanced mode if the neighboring pixel is a template center pixel (not a painted pixel)
                  // Template center pixels are at positions where cx % drawMult === 1 && cy % drawMult === 1
                  if (cx % this.drawMult === 1 && cy % this.drawMult === 1 && enhancedPixels.has(`${cx},${cy}`)) {
                    isCenter = true;
                    break;
                  }
                }
                
                // Check for blue corner positions (diagonal neighbors)
                const cornerPositions = [
                  [x+1, y+1], // bottom-right corner
                  [x-1, y+1], // bottom-left corner  
                  [x+1, y-1], // top-right corner
                  [x-1, y-1]  // top-left corner
                ];
                
                let isCorner = false;
                for (const [cx, cy] of cornerPositions) {
                  // Skip if out of bounds
                  if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
                  
                  // Only apply enhanced mode if the neighboring pixel is a template center pixel (not a painted pixel)
                  // Template center pixels are at positions where cx % drawMult === 1 && cy % drawMult === 1
                  if (cx % this.drawMult === 1 && cy % this.drawMult === 1 && enhancedPixels.has(`${cx},${cy}`)) {
                    isCorner = true;
                    break;
                  }
                }
                
                if (isCenter) {
                  // Make orthogonal neighbors red (crosshair center)
                  data[i] = 255;     // Full red
                  data[i + 1] = 0;   // No green  
                  data[i + 2] = 0;   // No blue
                  data[i + 3] = 255; // Full opacity
                  crosshairCenterCount++;
                } else if (isCorner) {
                  // Make diagonal neighbors blue (crosshair corners)
                  data[i] = 0;       // No red
                  data[i + 1] = 0;   // No green
                  data[i + 2] = 255; // Full blue
                  data[i + 3] = 255; // Full opacity
                  crosshairCornerCount++;
                }
              }
            }
          }
          
          console.log(`✨ [Enhanced Debug] Applied ${crosshairCenterCount} red centers and ${crosshairCornerCount} blue corners`);
        }
        
        // Put the processed image data back
        tempCtx.putImageData(imageData, 0, 0);
        
        // Draw the processed template
        context.drawImage(tempCanvas, Number(template.pixelCoords[0]) * this.drawMult, Number(template.pixelCoords[1]) * this.drawMult);
        
        // Count pixels by color for progress tracking
        this.#analyzePixelProgress(tileBitmap, template, tileCoords);
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

  /** Analyzes pixel progress by comparing template colors with painted pixels
   * @param {ImageBitmap} tileBitmap - The current painted tile
   * @param {Object} template - The template being analyzed
   * @param {string} tileCoords - Tile coordinates for logging
   * @private
   * @since 1.0.0
   */
  #analyzePixelProgress(tileBitmap, template, tileCoords) {
    try {
      console.log(`📊 [Pixel Analysis] Analyzing tile ${tileCoords}...`);
      
      // Create canvas to analyze the painted tile
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = tileBitmap.width;
      tileCanvas.height = tileBitmap.height;
      const tileCtx = tileCanvas.getContext('2d');
      tileCtx.imageSmoothingEnabled = false;
      tileCtx.drawImage(tileBitmap, 0, 0);
      
      // Create canvas for template
      const templateCanvas = document.createElement('canvas');
      templateCanvas.width = template.bitmap.width;
      templateCanvas.height = template.bitmap.height;
      const templateCtx = templateCanvas.getContext('2d');
      templateCtx.imageSmoothingEnabled = false;
      templateCtx.drawImage(template.bitmap, 0, 0);
      
      // Get image data
      const tileData = tileCtx.getImageData(0, 0, tileCanvas.width, tileCanvas.height);
      const templateData = templateCtx.getImageData(0, 0, templateCanvas.width, templateCanvas.height);
      
      // Initialize counters
      const colorStats = new Map(); // colorKey -> {required: number, painted: number, correct: number}
      
      // Calculate template offset within the tile
      const offsetX = Number(template.pixelCoords[0]) * this.drawMult;
      const offsetY = Number(template.pixelCoords[1]) * this.drawMult;
      
      // Analyze template pixels (center pixels only)
      for (let y = 0; y < templateCanvas.height; y += this.drawMult) {
        for (let x = 0; x < templateCanvas.width; x += this.drawMult) {
          // Check center pixel of 3x3 block
          const centerX = x + 1;
          const centerY = y + 1;
          
          if (centerX >= templateCanvas.width || centerY >= templateCanvas.height) continue;
          
          const templateIndex = (centerY * templateCanvas.width + centerX) * 4;
          const templateAlpha = templateData.data[templateIndex + 3];
          
          // Skip transparent template pixels
          if (templateAlpha === 0) continue;
          
          const templateR = templateData.data[templateIndex];
          const templateG = templateData.data[templateIndex + 1];
          const templateB = templateData.data[templateIndex + 2];
          const templateColorKey = `${templateR},${templateG},${templateB}`;
          
          // Initialize color stats if not exists
          if (!colorStats.has(templateColorKey)) {
            colorStats.set(templateColorKey, {
              required: 0,
              painted: 0,
              correct: 0,
              color: [templateR, templateG, templateB]
            });
          }
          
          const stats = colorStats.get(templateColorKey);
          stats.required++;
          
          // Check corresponding pixel in painted tile
          const tileX = centerX + offsetX;
          const tileY = centerY + offsetY;
          
          if (tileX >= 0 && tileX < tileCanvas.width && tileY >= 0 && tileY < tileCanvas.height) {
            const tileIndex = (tileY * tileCanvas.width + tileX) * 4;
            const tileAlpha = tileData.data[tileIndex + 3];
            
            if (tileAlpha > 0) {
              stats.painted++;
              
              const tileR = tileData.data[tileIndex];
              const tileG = tileData.data[tileIndex + 1];
              const tileB = tileData.data[tileIndex + 2];
              
              // Check if painted color matches template color
              if (tileR === templateR && tileG === templateG && tileB === templateB) {
                stats.correct++;
              }
            }
          }
        }
      }
      
      // Update global statistics
      for (const [colorKey, stats] of colorStats) {
        if (!this.globalColorStats.has(colorKey)) {
          this.globalColorStats.set(colorKey, {
            required: 0,
            painted: 0,
            correct: 0,
            color: stats.color
          });
        }
        
        const globalStats = this.globalColorStats.get(colorKey);
        globalStats.required += stats.required;
        globalStats.painted += stats.painted;
        globalStats.correct += stats.correct;
      }
      
      // Log tile results
      console.log(`📊 [Pixel Analysis] Results for tile ${tileCoords}:`);
      for (const [colorKey, stats] of colorStats) {
        const remaining = stats.required - stats.correct;
        const progress = stats.required > 0 ? ((stats.correct / stats.required) * 100).toFixed(1) : '0.0';
        
        console.log(`📊 [Color ${colorKey}] Required: ${stats.required}, Painted: ${stats.painted}, Correct: ${stats.correct}, Remaining: ${remaining}, Progress: ${progress}%`);
      }
      
      // Update overlay with global progress
      this.#updateProgressDisplay();
      
    } catch (error) {
      console.warn('❌ [Pixel Analysis] Failed to analyze pixel progress:', error);
    }
  }

  /** Updates the overlay display with current pixel progress
   * @private
   * @since 1.0.0
   */
  #updateProgressDisplay() {
    try {
      // Log global progress
      console.log(`🌍 [Global Progress] Overall template progress:`);
      
      let totalRequired = 0;
      let totalCorrect = 0;
      
      for (const [colorKey, stats] of this.globalColorStats) {
        const remaining = stats.required - stats.correct;
        const progress = stats.required > 0 ? ((stats.correct / stats.required) * 100).toFixed(1) : '0.0';
        
        totalRequired += stats.required;
        totalCorrect += stats.correct;
        
        console.log(`🌍 [Global Color ${colorKey}] Required: ${stats.required}, Painted: ${stats.painted}, Correct: ${stats.correct}, Remaining: ${remaining}, Progress: ${progress}%`);
      }
      
      const overallProgress = totalRequired > 0 ? ((totalCorrect / totalRequired) * 100).toFixed(1) : '0.0';
      const totalRemaining = totalRequired - totalCorrect;
      
      console.log(`🌍 [Global Total] Required: ${totalRequired}, Correct: ${totalCorrect}, Remaining: ${totalRemaining}, Overall Progress: ${overallProgress}%`);
      
      // Update the status display with progress information
      const progressText = `Progress: ${overallProgress}% (${totalCorrect}/${totalRequired} pixels)\n${totalRemaining} pixels remaining`;
      this.overlay.handleDisplayStatus(progressText);
      
    } catch (error) {
      console.warn('❌ [Progress Display] Failed to update progress display:', error);
    }
  }

  /** Resets global pixel statistics
   * @public
   * @since 1.0.0
   */
  resetProgressStats() {
    this.globalColorStats.clear();
    console.log(`🔄 [Progress Reset] Global pixel statistics cleared`);
  }

  /** Imports the JSON object, and appends it to any JSON object already loaded
   * @param {string} json - The JSON string to parse
   */
  importJSON(json) {

    console.log(`Importing JSON...`);
    console.log(json);

    // Reset progress statistics when importing new template
    this.resetProgressStats();

    // Debug logging
    console.log('🔍 Debug - importJSON analysis:');
    console.log('  - Input type:', typeof json);
    console.log('  - Input is null/undefined:', json == null);
    console.log('  - Has whoami property:', json?.hasOwnProperty?.('whoami'));
    console.log('  - whoami value:', JSON.stringify(json?.whoami));
    console.log('  - whoami comparison:', json?.whoami, '==', 'BlueMarble', '→', json?.whoami == 'BlueMarble');
    console.log('  - Has templates:', !!json?.templates);
    console.log('  - Templates count:', json?.templates ? Object.keys(json.templates).length : 'N/A');

    // If the passed in JSON is a Blue Marble template object...
    if (json?.whoami == 'BlueMarble') {
      console.log('✅ Calling #parseBlueMarble...');
      this.#parseBlueMarble(json); // ...parse the template object as Blue Marble
    } else {
      console.warn('❌ Not a valid BlueMarble JSON:', {
        whoami: json?.whoami,
        expected: 'BlueMarble',
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
}
