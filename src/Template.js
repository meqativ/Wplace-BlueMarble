import { uint8ToBase64 } from "./utils";

/** An instance of a template.
 * Handles all mathematics, manipulation, and analysis regarding a single template.
 * @class Template
 * @since 0.65.2
 */
export default class Template {

  /** The constructor for the {@link Template} class with enhanced pixel tracking.
   * @param {Object} [params={}] - Object containing all optional parameters
   * @param {string} [params.displayName='My template'] - The display name of the template
   * @param {number} [params.sortID=0] - The sort number of the template for rendering priority
   * @param {string} [params.authorID=''] - The user ID of the person who exported the template (prevents sort ID collisions)
   * @param {string} [params.url=''] - The URL to the source image
   * @param {File} [params.file=null] - The template file (pre-processed File or processed bitmap)
   * @param {Array<number>} [params.coords=null] - The coordinates of the top left corner as (tileX, tileY, pixelX, pixelY)
   * @param {Object} [params.chunked=null] - The affected chunks of the template, and their template for each chunk
   * @param {number} [params.tileSize=1000] - The size of a tile in pixels (assumes square tiles)
   * @param {number} [params.pixelCount=0] - Total number of pixels in the template (calculated automatically during processing)
   * @since 0.65.2
   */
  constructor({
    displayName = 'My template',
    sortID = 0,
    authorID = '',
    url = '',
    file = null,
    coords = null,
    chunked = null,
    tileSize = 1000,
  } = {}) {
    this.displayName = displayName;
    this.sortID = sortID;
    this.authorID = authorID;
    this.url = url;
    this.file = file;
    this.coords = coords;
    this.chunked = chunked;
    this.tileSize = tileSize;
    this.pixelCount = 0; // Total pixel count in template
    this.disabledColors = new Set(); // Set of disabled color RGB values as strings "r,g,b"
    this.enhancedColors = new Set(); // Set of enhanced color RGB values as strings "r,g,b"
    
    // Performance optimization: Cache enhanced tiles
    this.enhancedTilesCache = new Map(); // key: tileKey, value: ImageBitmap with crosshair effect
    this.enhancedCacheValid = false; // Track if cache needs to be regenerated
  }

  /** Creates chunks of the template for each tile.
   * 
   * @returns {Object} Collection of template bitmaps & buffers organized by tile coordinates
   * @since 0.65.4
   */
  async createTemplateTiles() {
    // // console.log('Template coordinates:', this.coords);

    const shreadSize = 3; // Scale image factor for pixel art enhancement (must be odd)
    
    // Create bitmap using a more compatible approach
    let bitmap;
    try {
      bitmap = await createImageBitmap(this.file);
    } catch (error) {
      // // console.log('createImageBitmap failed, using fallback method');
      // Fallback: create image element and canvas
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      await new Promise((resolve, reject) => {
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          resolve();
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(this.file);
      });
      
      bitmap = { width: canvas.width, height: canvas.height, canvas, ctx };
    }
    const imageWidth = bitmap.width;
    const imageHeight = bitmap.height;
    
    // Calculate total pixel count using standard width × height formula
    // TODO: Use non-transparent pixels instead of basic width times height
    const totalPixels = imageWidth * imageHeight;
    // console.log(`Template pixel analysis - Dimensions: ${imageWidth}×${imageHeight} = ${totalPixels.toLocaleString()} pixels`);
    
    // Store pixel count in instance property for access by template manager and UI components
    this.pixelCount = totalPixels;

    const templateTiles = {}; // Holds the template tiles
    const templateTilesBuffers = {}; // Holds the buffers of the template tiles

    const canvas = document.createElement('canvas');
    canvas.width = this.tileSize;
    canvas.height = this.tileSize;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    // For every tile...
    for (let pixelY = this.coords[3]; pixelY < imageHeight + this.coords[3]; ) {

      // Draws the partial tile first, if any
      // This calculates the size based on which is smaller:
      // A. The top left corner of the current tile to the bottom right corner of the current tile
      // B. The top left corner of the current tile to the bottom right corner of the image
      const drawSizeY = Math.min(this.tileSize - (pixelY % this.tileSize), imageHeight - (pixelY - this.coords[3]));

      // console.log(`Math.min(${this.tileSize} - (${pixelY} % ${this.tileSize}), ${imageHeight} - (${pixelY - this.coords[3]}))`);

      for (let pixelX = this.coords[2]; pixelX < imageWidth + this.coords[2];) {

        // console.log(`Pixel X: ${pixelX}\nPixel Y: ${pixelY}`);

        // Draws the partial tile first, if any
        // This calculates the size based on which is smaller:
        // A. The top left corner of the current tile to the bottom right corner of the current tile
        // B. The top left corner of the current tile to the bottom right corner of the image
        const drawSizeX = Math.min(this.tileSize - (pixelX % this.tileSize), imageWidth - (pixelX - this.coords[2]));

        // console.log(`Math.min(${this.tileSize} - (${pixelX} % ${this.tileSize}), ${imageWidth} - (${pixelX - this.coords[2]}))`);

        // console.log(`Draw Size X: ${drawSizeX}\nDraw Size Y: ${drawSizeY}`);

        // Change the canvas size and wipe the canvas
        const canvasWidth = drawSizeX * shreadSize;// + (pixelX % this.tileSize) * shreadSize;
        const canvasHeight = drawSizeY * shreadSize;// + (pixelY % this.tileSize) * shreadSize;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        // console.log(`Draw X: ${drawSizeX}\nDraw Y: ${drawSizeY}\nCanvas Width: ${canvasWidth}\nCanvas Height: ${canvasHeight}`);

        context.imageSmoothingEnabled = false; // Nearest neighbor

        // console.log(`Getting X ${pixelX}-${pixelX + drawSizeX}\nGetting Y ${pixelY}-${pixelY + drawSizeY}`);

        // Draws the template segment on this tile segment
        context.clearRect(0, 0, canvasWidth, canvasHeight); // Clear any previous drawing (only runs when canvas size does not change)
        
        // Use different drawing method based on bitmap type
        if (bitmap.canvas) {
          // Fallback method using canvas
          context.drawImage(
            bitmap.canvas, // Canvas to draw from
            pixelX - this.coords[2], // Coordinate X to draw from
            pixelY - this.coords[3], // Coordinate Y to draw from
            drawSizeX, // X width to draw from
            drawSizeY, // Y height to draw from
            0, // Coordinate X to draw at
            0, // Coordinate Y to draw at
            drawSizeX * shreadSize, // X width to draw at
            drawSizeY * shreadSize // Y height to draw at
          );
        } else {
          // Standard method using ImageBitmap
          context.drawImage(
            bitmap, // Bitmap image to draw
            pixelX - this.coords[2], // Coordinate X to draw from
            pixelY - this.coords[3], // Coordinate Y to draw from
            drawSizeX, // X width to draw from
            drawSizeY, // Y height to draw from
            0, // Coordinate X to draw at
            0, // Coordinate Y to draw at
            drawSizeX * shreadSize, // X width to draw at
            drawSizeY * shreadSize // Y height to draw at
          );
        }

        // const final = await canvas.convertToBlob({ type: 'image/png' });
        // const url = URL.createObjectURL(final); // Creates a blob URL
        // window.open(url, '_blank'); // Opens a new tab with blob
        // setTimeout(() => URL.revokeObjectURL(url), 60000); // Destroys the blob 1 minute later

        const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight); // Data of the image on the canvas

        for (let y = 0; y < canvasHeight; y++) {
          for (let x = 0; x < canvasWidth; x++) {
            // For every pixel...
            const pixelIndex = (y * canvasWidth + x) * 4; // Find the pixel index in an array where every 4 indexes are 1 pixel
            
            // Get current pixel RGB values
            const r = imageData.data[pixelIndex];
            const g = imageData.data[pixelIndex + 1];
            const b = imageData.data[pixelIndex + 2];
            
            // Check if this color is disabled
            const isDisabled = this.isColorDisabled([r, g, b]);
            
            // Debug: log disabled colors being processed
            if (isDisabled && x % 10 === 0 && y % 10 === 0) {
              // console.log(`Filtering disabled color [${r}, ${g}, ${b}] at pixel [${x}, ${y}]`);
            }
            
            // If the pixel is the color #deface, draw a translucent gray checkerboard pattern
            if (r === 222 && g === 250 && b === 206) {
              if ((x + y) % 2 === 0) { // Formula for checkerboard pattern
                imageData.data[pixelIndex] = 0;
                imageData.data[pixelIndex + 1] = 0;
                imageData.data[pixelIndex + 2] = 0;
                imageData.data[pixelIndex + 3] = 32; // Translucent black
              } else { // Transparent negative space
                imageData.data[pixelIndex + 3] = 0;
              }
            } else if (isDisabled) {
              // Make disabled colors transparent
              imageData.data[pixelIndex + 3] = 0;
            } else if (x % shreadSize !== 1 || y % shreadSize !== 1) { // Otherwise only draw the middle pixel
              imageData.data[pixelIndex + 3] = 0; // Make the pixel transparent on the alpha channel
            }
          }
        }

        // console.log(`Shreaded pixels for ${pixelX}, ${pixelY}`, imageData);

        context.putImageData(imageData, 0, 0);

        // Creates the "0000,0000,000,000" key name
        const templateTileName = `${(this.coords[0] + Math.floor(pixelX / 1000))
          .toString()
          .padStart(4, '0')},${(this.coords[1] + Math.floor(pixelY / 1000))
          .toString()
          .padStart(4, '0')},${(pixelX % 1000)
          .toString()
          .padStart(3, '0')},${(pixelY % 1000).toString().padStart(3, '0')}`;

        // Create bitmap using compatible method
        try {
          templateTiles[templateTileName] = await createImageBitmap(canvas);
        } catch (error) {
          // console.log('createImageBitmap failed for tile, using canvas directly');
          templateTiles[templateTileName] = canvas.cloneNode(true);
        }
        
        // Convert canvas to buffer using compatible method
        try {
          const canvasBlob = await new Promise((resolve, reject) => {
            if (canvas.convertToBlob) {
              canvas.convertToBlob().then(resolve).catch(reject);
            } else {
              // Fallback for browsers that don't support convertToBlob
              canvas.toBlob(resolve, 'image/png');
            }
          });
          const canvasBuffer = await canvasBlob.arrayBuffer();
          const canvasBufferBytes = Array.from(new Uint8Array(canvasBuffer));
          templateTilesBuffers[templateTileName] = uint8ToBase64(canvasBufferBytes);
        } catch (error) {
          // console.log('Canvas blob conversion failed, using data URL fallback');
          const dataURL = canvas.toDataURL('image/png');
          const base64 = dataURL.split(',')[1];
          templateTilesBuffers[templateTileName] = base64;
        }

        // console.log(templateTiles);

        pixelX += drawSizeX;
      }

      pixelY += drawSizeY;
    }

    // console.log('Template Tiles: ', templateTiles);
    // console.log('Template Tiles Buffers: ', templateTilesBuffers);
    return { templateTiles, templateTilesBuffers };
  }

  /** Disables a specific color in the template
   * @param {number[]} rgbColor - RGB color array [r, g, b]
   * @since 1.0.0
   */
  disableColor(rgbColor) {
    const colorKey = rgbColor.join(',');
    this.disabledColors.add(colorKey);
  }

  /** Enables a specific color in the template
   * @param {number[]} rgbColor - RGB color array [r, g, b]
   * @since 1.0.0
   */
  enableColor(rgbColor) {
    const colorKey = rgbColor.join(',');
    this.disabledColors.delete(colorKey);
  }

  /** Checks if a color is disabled
   * @param {number[]} rgbColor - RGB color array [r, g, b]
   * @returns {boolean} True if color is disabled
   * @since 1.0.0
   */
  isColorDisabled(rgbColor) {
    const colorKey = rgbColor.join(',');
    return this.disabledColors.has(colorKey);
  }

  /** Gets all disabled colors
   * @returns {string[]} Array of disabled color keys "r,g,b"
   * @since 1.0.0
   */
  getDisabledColors() {
    return Array.from(this.disabledColors);
  }

  /** Sets disabled colors from an array
   * @param {string[]} colorKeys - Array of color keys "r,g,b"
   * @since 1.0.0
   */
  setDisabledColors(colorKeys) {
    this.disabledColors = new Set(colorKeys);
  }

  /** Enables enhanced mode for a specific color
   * @param {number[]} rgbColor - RGB color array [r, g, b]
   * @since 1.0.0
   */
  enableColorEnhanced(rgbColor) {
    const colorKey = `${rgbColor[0]},${rgbColor[1]},${rgbColor[2]}`;
    this.enhancedColors.add(colorKey);
    this.invalidateEnhancedCache(); // Regenerate cache when enhanced colors change
  }

  /** Disables enhanced mode for a specific color
   * @param {number[]} rgbColor - RGB color array [r, g, b]
   * @since 1.0.0
   */
  disableColorEnhanced(rgbColor) {
    const colorKey = `${rgbColor[0]},${rgbColor[1]},${rgbColor[2]}`;
    this.enhancedColors.delete(colorKey);
    this.invalidateEnhancedCache(); // Regenerate cache when enhanced colors change
  }

  /** Checks if a specific color has enhanced mode enabled
   * @param {number[]} rgbColor - RGB color array [r, g, b]
   * @returns {boolean} True if color is enhanced
   * @since 1.0.0
   */
  isColorEnhanced(rgbColor) {
    const colorKey = `${rgbColor[0]},${rgbColor[1]},${rgbColor[2]}`;
    return this.enhancedColors.has(colorKey);
  }

  /** Gets the set of enhanced colors as an array
   * @returns {Array<string>} Array of enhanced color strings "r,g,b"
   * @since 1.0.0
   */
  getEnhancedColors() {
    return Array.from(this.enhancedColors);
  }

  /** Sets enhanced colors from an array
   * @param {Array<string>} enhancedColorsArray - Array of color strings "r,g,b"
   * @since 1.0.0
   */
  setEnhancedColors(enhancedColorsArray) {
    this.enhancedColors = new Set(enhancedColorsArray || []);
    this.invalidateEnhancedCache();
  }

  /** Applies color filter to existing chunked tiles without requiring original file
   * This method is used when templates are loaded from storage and don't have the original file
   * @returns {Object} Updated chunked tiles with color filter applied
   * @since 1.0.0
   */
  async applyColorFilterToExistingTiles() {
    if (!this.chunked) {
      throw new Error('No chunked tiles available to apply color filter');
    }

    const shreadSize = 3; // Must match the value used in createTemplateTiles
    const updatedChunked = {};

    for (const [tileName, bitmap] of Object.entries(this.chunked)) {
      // Create a canvas to work with the existing tile
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });

      // Get dimensions from the bitmap
      let width, height;
      if (bitmap.width !== undefined) {
        width = bitmap.width;
        height = bitmap.height;
      } else {
        // For canvas elements
        width = bitmap.width || 300; // fallback
        height = bitmap.height || 300;
      }

      canvas.width = width;
      canvas.height = height;
      context.imageSmoothingEnabled = false;

      // Draw the existing bitmap to canvas
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0);

      // Get image data to process pixels
      const imageData = context.getImageData(0, 0, width, height);

      // Process each pixel to apply color filter
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const pixelIndex = (y * width + x) * 4;
          
          // Only process center pixels of the 3x3 shread blocks (same logic as createTemplateTiles)
          if (x % shreadSize !== 1 || y % shreadSize !== 1) {
            continue; // Skip non-center pixels
          }
          
          // Get current pixel RGB values
          const r = imageData.data[pixelIndex];
          const g = imageData.data[pixelIndex + 1];
          const b = imageData.data[pixelIndex + 2];
          const alpha = imageData.data[pixelIndex + 3];
          
          // Skip transparent pixels
          if (alpha === 0) continue;
          
          // Check if this color is disabled
          const isDisabled = this.isColorDisabled([r, g, b]);
          
          if (isDisabled) {
            // Make disabled colors transparent (same as createTemplateTiles logic)
            imageData.data[pixelIndex + 3] = 0;
          }
        }
      }

      // Put the processed image data back to canvas
      context.putImageData(imageData, 0, 0);

      // Create new bitmap from processed canvas
      try {
        updatedChunked[tileName] = await createImageBitmap(canvas);
      } catch (error) {
        console.warn('createImageBitmap failed for tile, using canvas directly');
        updatedChunked[tileName] = canvas.cloneNode(true);
      }
    }

    return updatedChunked;
  }

  /** Creates enhanced tiles with crosshair effect pre-processed for performance.
   * This avoids real-time pixel processing during drawing.
   * @param {Object} originalTiles - The original template tiles
   * @returns {Promise<Map>} Map of enhanced tiles
   * @since 1.0.0
   */
  async createEnhancedTiles(originalTiles) {
    const enhancedTiles = new Map();
    
    for (const [tileKey, originalBitmap] of Object.entries(originalTiles)) {
      try {
        // Create canvas for processing
        const canvas = document.createElement('canvas');
        canvas.width = originalBitmap.width;
        canvas.height = originalBitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        
        // Draw original bitmap
        ctx.drawImage(originalBitmap, 0, 0);
        
        // Get image data for processing
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const width = canvas.width;
        const height = canvas.height;
        
        // Create copy of original data for reference
        const originalData = new Uint8ClampedArray(data);
        
        // Find template pixels that are enhanced (non-transparent AND color is in enhanced set)
        const enhancedTemplatePixels = new Set();
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const alpha = originalData[i + 3];
            
            if (alpha > 0) {
              const r = originalData[i];
              const g = originalData[i + 1];
              const b = originalData[i + 2];
              const colorKey = `${r},${g},${b}`;
              
              // Only add to enhanced pixels if this color is marked as enhanced
              if (this.enhancedColors.has(colorKey)) {
                enhancedTemplatePixels.add(`${x},${y}`);
              }
            }
          }
        }
        
        // Apply crosshair effect to transparent neighbors
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const alpha = originalData[i + 3];
            
            // Skip if pixel is not transparent
            if (alpha > 0) continue;
            
            // Check if this transparent pixel is adjacent to an enhanced template pixel
            const hasEnhancedNeighbor = (
              enhancedTemplatePixels.has(`${x},${y-1}`) || // Top
              enhancedTemplatePixels.has(`${x},${y+1}`) || // Bottom
              enhancedTemplatePixels.has(`${x-1},${y}`) || // Left
              enhancedTemplatePixels.has(`${x+1},${y}`)    // Right
            );
            
            const hasEnhancedDiagonal = (
              enhancedTemplatePixels.has(`${x-1},${y-1}`) || // Top-left
              enhancedTemplatePixels.has(`${x+1},${y-1}`) || // Top-right
              enhancedTemplatePixels.has(`${x-1},${y+1}`) || // Bottom-left
              enhancedTemplatePixels.has(`${x+1},${y+1}`)    // Bottom-right
            );
            
            if (hasEnhancedNeighbor) {
              // Orthogonal neighbors: Red crosshair center
              data[i] = 255;     // Red
              data[i + 1] = 0;   // Green
              data[i + 2] = 0;   // Blue
              data[i + 3] = 180; // Semi-transparent
            } else if (hasEnhancedDiagonal) {
              // Diagonal neighbors: Blue crosshair corners
              data[i] = 0;       // Red
              data[i + 1] = 0;   // Green
              data[i + 2] = 255; // Blue
              data[i + 3] = 120; // More transparent
            }
          }
        }
        
        // Put processed data back
        ctx.putImageData(imageData, 0, 0);
        
        // Create bitmap from processed canvas
        const enhancedBitmap = await createImageBitmap(canvas);
        enhancedTiles.set(tileKey, enhancedBitmap);
        
      } catch (error) {
        console.warn(`Failed to create enhanced tile for ${tileKey}:`, error);
        // Fallback to original tile
        enhancedTiles.set(tileKey, originalTiles[tileKey]);
      }
    }
    
    return enhancedTiles;
  }

  /** Invalidates enhanced tiles cache when color filter changes
   * @since 1.0.0
   */
  invalidateEnhancedCache() {
    this.enhancedCacheValid = false;
    this.enhancedTilesCache.clear();
  }
}
