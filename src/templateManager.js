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
    return {
      "whoami": this.name.replace(' ', ''), // Name of userscript without spaces
      "scriptVersion": this.version, // Version of userscript
      "schemaVersion": this.templatesVersion, // Version of JSON schema
      "templates": {} // The templates
    };
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

  /** Stores the JSON object of the loaded templates into TamperMonkey (GreaseMonkey) storage.
   * @since 0.72.7
   */
  async #storeTemplates() {
    GM.setValue('bmTemplates', JSON.stringify(this.templatesJSON));
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

      // Check if enhanced mode is enabled
      const isEnhanced = window.bmEnhancedMode || false;
      
      if (!isEnhanced) {
        // Normal drawing without enhancement
        context.drawImage(template.bitmap, Number(template.pixelCoords[0]) * this.drawMult, Number(template.pixelCoords[1]) * this.drawMult);
      } else {
        // Enhanced mode: add red borders to template pixels
        const enhancedCanvas = document.createElement('canvas');
        enhancedCanvas.width = template.bitmap.width;
        enhancedCanvas.height = template.bitmap.height;
        const enhancedCtx = enhancedCanvas.getContext('2d');
        enhancedCtx.imageSmoothingEnabled = false;
        
        // Draw original template
        enhancedCtx.drawImage(template.bitmap, 0, 0);
        
        // Get image data to process pixels
        const imageData = enhancedCtx.getImageData(0, 0, enhancedCanvas.width, enhancedCanvas.height);
        const data = imageData.data;
        const width = enhancedCanvas.width;
        const height = enhancedCanvas.height;
        
        // Create a copy for border detection
        const originalData = new Uint8ClampedArray(data);
        
        // First pass: identify all template pixels (non-transparent)
        const templatePixels = new Set();
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const alpha = originalData[i + 3];
            
            if (alpha > 0) { // If pixel is not transparent
              templatePixels.add(`${x},${y}`);
            }
          }
        }
        
        // Second pass: create crosshair effect on template pixels
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const alpha = originalData[i + 3];
            
            // Only modify template pixels (non-transparent)
            if (alpha > 0) {
              // Create crosshair pattern: center red, corners blue
              // Check if pixel is at center or corner of template pixel
              const isCenter = true; // Every template pixel gets center treatment
              const isCorner = false; // We'll modify corners separately
              
              if (isCenter) {
                // Make center red (like a crosshair center)
                data[i] = 255;     // Full red
                data[i + 1] = 0;   // No green  
                data[i + 2] = 0;   // No blue
                data[i + 3] = 255; // Full opacity
              }
            }
          }
        }
        
        // Third pass: add blue corners around template pixels
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const alpha = originalData[i + 3];
            
            // Only consider transparent pixels for corner placement
            if (alpha === 0) {
              // Check if this transparent pixel is at a corner of a template pixel
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
                
                // If there's a template pixel at this corner position
                if (templatePixels.has(`${cx},${cy}`)) {
                  isCorner = true;
                  break;
                }
              }
              
              if (isCorner) {
                // Make corner blue
                data[i] = 0;       // No red
                data[i + 1] = 0;   // No green
                data[i + 2] = 255; // Full blue
                data[i + 3] = 255; // Full opacity
              }
            }
          }
        }
        
        // Put the modified image data back
        enhancedCtx.putImageData(imageData, 0, 0);
        
        // Draw the enhanced template
        context.drawImage(enhancedCanvas, Number(template.pixelCoords[0]) * this.drawMult, Number(template.pixelCoords[1]) * this.drawMult);
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

    // If the passed in JSON is a Blue Marble template object...
    if (json?.whoami == 'BlueMarble') {
      this.#parseBlueMarble(json); // ...parse the template object as Blue Marble
    }
  }

  /** Parses the Blue Marble JSON object
   * @param {string} json - The JSON string to parse
   * @since 0.72.13
   */
  async #parseBlueMarble(json) {

    console.log(`Parsing BlueMarble...`);

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

          for (const tile in tilesbase64) {
            console.log(tile);
            if (tilesbase64.hasOwnProperty(tile)) {
              const encodedTemplateBase64 = tilesbase64[tile];
              const templateUint8Array = base64ToUint8(encodedTemplateBase64); // Base 64 -> Uint8Array

              const templateBlob = new Blob([templateUint8Array], { type: "image/png" }); // Uint8Array -> Blob
              const templateBitmap = await createImageBitmap(templateBlob) // Blob -> Bitmap
              templateTiles[tile] = templateBitmap;
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
          
          // Load disabled colors if they exist
          const disabledColors = templateValue.disabledColors;
          if (disabledColors && Array.isArray(disabledColors)) {
            template.setDisabledColors(disabledColors);
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

  /** Recreates template tiles with current color filter settings
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
      consoleLog('Updating template with color filter, disabled colors:', template.getDisabledColors());
      
      let templateTiles, templateTilesBuffers;
      
      // Check if template has original file for full recreation
      if (template.file) {
        consoleLog('Template has original file, recreating tiles from source...');
        
        // Clear existing chunked data to force complete recreation
        template.chunked = null;
        
        // Recreate template tiles with current filter settings from original file
        const result = await template.createTemplateTiles();
        templateTiles = result.templateTiles;
        templateTilesBuffers = result.templateTilesBuffers;
        
        // Assign the new chunked data
        template.chunked = templateTiles;
        
      } else {
        consoleLog('Template loaded from storage, applying color filter to existing tiles...');
        
        // Template was loaded from storage, apply filter to existing tiles
        templateTiles = await template.applyColorFilterToExistingTiles();
        
        // Generate new buffers from the updated tiles
        templateTilesBuffers = {};
        for (const [tileName, bitmap] of Object.entries(templateTiles)) {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width || 300;
          canvas.height = bitmap.height || 300;
          const context = canvas.getContext('2d');
          context.imageSmoothingEnabled = false;
          context.drawImage(bitmap, 0, 0);
          
          try {
            const canvasBlob = await new Promise((resolve, reject) => {
              if (canvas.convertToBlob) {
                canvas.convertToBlob().then(resolve).catch(reject);
              } else {
                canvas.toBlob(resolve, 'image/png');
              }
            });
            const canvasBuffer = await canvasBlob.arrayBuffer();
            const canvasBufferBytes = Array.from(new Uint8Array(canvasBuffer));
            templateTilesBuffers[tileName] = uint8ToBase64(canvasBufferBytes);
          } catch (error) {
            consoleWarn('Canvas blob conversion failed, using data URL fallback');
            const dataURL = canvas.toDataURL('image/png');
            const base64 = dataURL.split(',')[1];
            templateTilesBuffers[tileName] = base64;
          }
        }
        
        // Update chunked data with filtered tiles
        template.chunked = templateTiles;
      }
      
      consoleLog('Template tiles updated with filter applied, total tiles:', Object.keys(templateTiles).length);
      
      // Update JSON if it exists
      if (this.templatesJSON && this.templatesJSON.templates) {
        const templateKey = `${template.sortID} ${template.authorID}`;
        if (this.templatesJSON.templates[templateKey]) {
          this.templatesJSON.templates[templateKey].tiles = templateTilesBuffers;
          this.templatesJSON.templates[templateKey].disabledColors = template.getDisabledColors();
          consoleLog('JSON updated with new filter settings');
        }
      }
      
      // Store updated templates
      await this.#storeTemplates();
      
      consoleLog('Template updated with color filter successfully');
      
    } catch (error) {
      consoleError('Error updating template with color filter:', error);
      this.overlay.handleDisplayError('Failed to update template with color filter');
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
