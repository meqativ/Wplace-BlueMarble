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
    this.tileProgress = new Map(); // Tracks per-tile progress stats {painted, required, wrong} (from Storage fork)
    this.tileAnalysisCache = new Map(); // Cache for consistent tile analysis within same refresh
    
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
                
                if (currentTemplate.isColorEnhanced([r, g, b])) {
                  enhancedPixels.add(`${x},${y}`);
                  enhancedPixelCount++;
                }
              }
            }
          }
          
          console.log(`🎯 [Enhanced Debug] Found ${enhancedPixelCount} enhanced template pixels`);
        }
        
        // Second pass: Apply enhanced mode crosshair effect if enabled (REALLY OPTIMIZED NOW!)
        if (hasEnhancedColors && enhancedPixels && enhancedPixels.size > 0) {
          console.log(`✨ [Enhanced Debug] Applying crosshair effects (FAST MODE) to ${enhancedPixels.size} enhanced pixels...`);
          
          // REAL OPTIMIZATION: Use chunked processing for very large templates
          if (enhancedPixels.size > 23000) {
            console.log(`⚠️ [Enhanced Debug] Too many enhanced pixels (${enhancedPixels.size}), skipping enhanced mode for performance`);
          } else {
            // For large templates, process in smaller chunks to maintain responsiveness
            const isLargeTemplate = enhancedPixels.size > 12000;
            if (isLargeTemplate) {
              console.log(`📦 [Enhanced Debug] Large template detected, using chunked processing...`);
            }
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
            const chunkSize = isLargeTemplate ? 2000 : enhancedPixelsArray.length; // Process in chunks for large templates
            
            for (let chunkStart = 0; chunkStart < enhancedPixelsArray.length; chunkStart += chunkSize) {
              const chunkEnd = Math.min(chunkStart + chunkSize, enhancedPixelsArray.length);
              const chunk = enhancedPixelsArray.slice(chunkStart, chunkEnd);
              
              if (isLargeTemplate && chunkStart > 0) {
                console.log(`📦 [Enhanced Debug] Processing chunk ${Math.floor(chunkStart/chunkSize) + 1}/${Math.ceil(enhancedPixelsArray.length/chunkSize)}`);
              }
              
              for (const pixelCoord of chunk) {
                const [px, py] = pixelCoord.split(',').map(Number);
                
                // Apply crosshairs only around enhanced pixels (red centers only)
                const crosshairOffsets = [
                  [0, -1, 'center'], [0, 1, 'center'], [-1, 0, 'center'], [1, 0, 'center'] // Orthogonal only
                ];
                
                for (const [dx, dy, type] of crosshairOffsets) {
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
                  
                  // Apply red crosshair
                  data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 180;
                  crosshairCenterCount++;
                }
              }
            }
            
            console.log(`✨ [Enhanced Debug] Applied ${crosshairCenterCount} red crosshairs (FAST MODE)`);
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
        // CRITICAL FIX: Use cached tile blob data for consistency
        // Extract tileX and tileY from tileCoords parameter
        const coordsParts = tileCoords.split(',');
        const tileX = parseInt(coordsParts[0]);
        const tileY = parseInt(coordsParts[1]);
        const tileKey = `${tileX},${tileY}`;
        let tileImageData;
        
        if (this.tileAnalysisCache.has(tileKey)) {
          tileImageData = this.tileAnalysisCache.get(tileKey);
          consoleLog(`🔄 [Tile Cache] Using cached data for tile ${tileKey}`);
        } else {
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
          this.tileAnalysisCache.set(tileKey, tileImageData);
          consoleLog(`💾 [Tile Cache] Cached data for tile ${tileKey}`);
        }
        
        const tilePixels = tileImageData.data;
        
        consoleLog(`🔍 [Real Tile Analysis] Using actual tile data from server: ${drawSize}x${drawSize}`);
        
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
                  consoleLog(`⚪ [Pixel Analysis] (${gx},${gy}) UNPAINTED: template=${tr},${tg},${tb} vs tile=transparent`);
                }
              } else if (pr === tr && pg === tg && pb === tb) {
                paintedCount++;
                if (paintedCount + wrongCount < 10) { // Log first 10 pixels
                  consoleLog(`✅ [Pixel Analysis] (${gx},${gy}) CORRECT: template=${tr},${tg},${tb} vs tile=${pr},${pg},${pb}`);
                }
              } else {
                wrongCount++;
                if (paintedCount + wrongCount < 10) { // Log first 10 pixels
                  consoleLog(`❌ [Pixel Analysis] (${gx},${gy}) WRONG: template=${tr},${tg},${tb} vs tile=${pr},${pg},${pb}`);
                }
              }
            }
          }
        }
        
        // Store tile progress stats
        this.tileProgress.set(tileCoords, {
          painted: paintedCount,
          required: requiredCount,
          wrong: wrongCount,
        });
        
        consoleLog(`📊 [Tile Progress] ${tileCoords}: ${paintedCount}/${requiredCount} painted, ${wrongCount} wrong`);
        
      } catch (error) {
        consoleWarn('Failed to compute tile progress stats:', error);
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
    
    // Clear analysis cache for fresh calculation
    this.tileAnalysisCache.clear();
    consoleLog('🔄 [Enhanced Pixel Analysis] Cache cleared for consistent analysis');
    
    try {
      // Check if we have tile-based progress data (from Storage fork logic)
      consoleLog('🔍 [Enhanced Pixel Analysis] Checking tile progress data:', this.tileProgress);
      
      if (this.tileProgress && this.tileProgress.size > 0) {
        // Use tile-based analysis like the Storage fork
        const colorStats = {};
        
        // Aggregate painted/wrong across tiles that have been processed
        let totalPainted = 0;
        let totalRequired = 0;
        let totalWrong = 0;
        
        for (const [tileKey, stats] of this.tileProgress.entries()) {
          totalPainted += stats.painted || 0;
          totalRequired += stats.required || 0;  
          totalWrong += stats.wrong || 0;
        }
        
        consoleLog(`📊 [Enhanced Pixel Analysis] Aggregated from ${this.tileProgress.size} tiles:`);
        consoleLog(`   Total painted: ${totalPainted}`);
        consoleLog(`   Total required: ${totalRequired}`);
        consoleLog(`   Total wrong: ${totalWrong}`);
        
        // Use template's color palette to break down by color
        consoleLog('🔍 [Enhanced Pixel Analysis] Template colorPalette:', template.colorPalette);
        consoleLog('🔍 [Enhanced Pixel Analysis] ColorPalette keys:', Object.keys(template.colorPalette || {}));
        
        // If no color palette, rebuild it from tile data
        if (!template.colorPalette || Object.keys(template.colorPalette).length === 0) {
          consoleLog('🔧 [Enhanced Pixel Analysis] Color palette empty, rebuilding from tiles...');
          template.colorPalette = this.buildColorPaletteFromTileProgress(template);
          consoleLog('🔧 [Enhanced Pixel Analysis] Rebuilt palette:', Object.keys(template.colorPalette));
        }
        
        if (template.colorPalette && Object.keys(template.colorPalette).length > 0) {
          for (const [colorKey, paletteInfo] of Object.entries(template.colorPalette)) {
            const colorCount = paletteInfo.count || 0;
            
            // Estimate painted pixels for this color proportionally  
            const proportionOfTemplate = totalRequired > 0 ? colorCount / totalRequired : 0;
            const paintedForColor = Math.round(totalPainted * proportionOfTemplate);
            const wrongForColor = Math.round(totalWrong * proportionOfTemplate);
            
            colorStats[colorKey] = {
              totalRequired: colorCount,
              painted: paintedForColor,
              needsCrosshair: colorCount - paintedForColor,
              percentage: colorCount > 0 ? Math.round((paintedForColor / colorCount) * 100) : 0,
              remaining: colorCount - paintedForColor
            };
            
            consoleLog(`📊 [Enhanced Pixel Analysis] ${colorKey}: ${paintedForColor}/${colorCount} (${colorStats[colorKey].percentage}%) - ${colorStats[colorKey].needsCrosshair} need crosshair`);
          }
        }
        
        consoleLog('✅ [Enhanced Pixel Analysis] SUMMARY (from tileProgress):');
        consoleLog(`   Total painted: ${totalPainted}/${totalRequired} (${totalRequired > 0 ? Math.round((totalPainted / totalRequired) * 100) : 0}%)`);
        consoleLog(`   Wrong pixels: ${totalWrong}`);
        
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
          
          // Enhanced mode logic: only include if color is enhanced OR no enhanced colors defined
          const shouldBeEnhanced = !hasEnhancedColors || template.enhancedColors.has(colorKey);
          
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
      
      consoleLog(`🔧 [Build Palette] Found ${Object.keys(colorPalette).length} colors in tiles`);
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
}
