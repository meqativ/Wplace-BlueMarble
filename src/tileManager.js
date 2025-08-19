/** @file Tile Management for handling tile refresh pausing and performance
 * Contains logic for managing tile updates and refresh behavior
 * @since 1.0.0
 */

import { consoleLog, consoleWarn, consoleError } from './utils.js';
import { getTileRefreshPaused, saveTileRefreshPaused } from './settingsManager.js';

/** Global state for tile refresh pausing */
let tileRefreshPaused = false;
let originalDrawTemplateOnTile = null;
let frozenTileCache = new Map(); // Cache de tiles com templates aplicados
let isCapturingState = false; // Flag para evitar recursão durante captura

/** Initializes the tile refresh pause system
 * @param {Object} templateManager - The template manager instance
 * @since 1.0.0
 */
export function initializeTileRefreshPause(templateManager) {
  // Load the saved pause state
  tileRefreshPaused = getTileRefreshPaused();
  
  // Store reference to original function and wrap it to capture tiles
  if (!originalDrawTemplateOnTile) {
    originalDrawTemplateOnTile = templateManager.drawTemplateOnTile.bind(templateManager);
    
    // Wrap the original function to automatically cache tiles when they're processed
    templateManager.drawTemplateOnTile = async function(tileBlob, tileCoords) {
      const result = await originalDrawTemplateOnTile(tileBlob, tileCoords);
      
      // If we're not paused and not in capturing state, cache this processed tile
      if (!tileRefreshPaused && !isCapturingState) {
        const tileKey = Array.isArray(tileCoords) ? `${tileCoords[0]},${tileCoords[1]}` : tileCoords.toString();
        frozenTileCache.set(tileKey, result);
        
        // Limit cache size to prevent memory issues
        if (frozenTileCache.size > 100) {
          const firstKey = frozenTileCache.keys().next().value;
          frozenTileCache.delete(firstKey);
        }
      }
      
      return result;
    };
  }
  
  // Apply the pause state
  applyTileRefreshPause(templateManager);
  
  consoleLog('🎮 Tile refresh pause system initialized. Paused:', tileRefreshPaused);
}

/** Applies the tile refresh pause setting to the template manager
 * @param {Object} templateManager - The template manager instance
 * @since 1.0.0
 */
function applyTileRefreshPause(templateManager) {
  if (tileRefreshPaused) {
    // Replace the drawTemplateOnTile function with a paused version that uses frozen cache
    templateManager.drawTemplateOnTile = function(tileBlob, tileCoords) {
      const tileKey = Array.isArray(tileCoords) ? `${tileCoords[0]},${tileCoords[1]}` : tileCoords.toString();
      
      // Check if we have a cached version with templates applied
      if (frozenTileCache.has(tileKey)) {
        consoleLog('🧊 [Tile Refresh Paused] Using frozen tile cache for:', tileKey);
        return frozenTileCache.get(tileKey);
      }
      
      // If no cache, return original blob (fallback)
      consoleLog('⏸️ [Tile Refresh Paused] No cache for tile:', tileKey, '- returning original');
      return tileBlob;
    };
  } else {
    // When resuming, restore the wrapped function that continues caching
    if (originalDrawTemplateOnTile) {
      templateManager.drawTemplateOnTile = async function(tileBlob, tileCoords) {
        const result = await originalDrawTemplateOnTile(tileBlob, tileCoords);
        
        // Continue caching tiles when they're processed
        if (!tileRefreshPaused && !isCapturingState) {
          const tileKey = Array.isArray(tileCoords) ? `${tileCoords[0]},${tileCoords[1]}` : tileCoords.toString();
          frozenTileCache.set(tileKey, result);
          
          // Limit cache size to prevent memory issues
          if (frozenTileCache.size > 100) {
            const firstKey = frozenTileCache.keys().next().value;
            frozenTileCache.delete(firstKey);
          }
        }
        
        return result;
      };
    }
  }
}

/** Logs the current state of the tile cache for debugging
 * @since 1.0.0
 */
function logCacheState() {
  consoleLog(`🧊 [Tile Cache] Currently cached tiles: ${frozenTileCache.size}`);
  if (frozenTileCache.size > 0) {
    const keys = Array.from(frozenTileCache.keys()).slice(0, 5); // Show first 5 keys
    consoleLog(`🧊 [Tile Cache] Sample cached tiles: ${keys.join(', ')}${frozenTileCache.size > 5 ? '...' : ''}`);
  }
}

/** Toggles the tile refresh pause state
 * @param {Object} templateManager - The template manager instance
 * @returns {boolean} The new pause state
 * @since 1.0.0
 */
export function toggleTileRefreshPause(templateManager) {
  if (!tileRefreshPaused) {
    // We're about to pause - log current cache state
    logCacheState();
    consoleLog('🧊 [Freeze Tiles] Freezing current template view with cached tiles');
  } else {
    // We're about to resume - the cache will be used for new tiles
    consoleLog('▶️ [Resume Tiles] Resuming live tile processing');
  }
  
  tileRefreshPaused = !tileRefreshPaused;
  
  // Save the new state
  saveTileRefreshPaused(tileRefreshPaused);
  
  // Apply the new state
  applyTileRefreshPause(templateManager);
  
  consoleLog('⏸️ Tile refresh pause toggled. Now paused:', tileRefreshPaused);
  
  return tileRefreshPaused;
}

/** Gets the current tile refresh pause state
 * @returns {boolean} Whether tile refresh is currently paused
 * @since 1.0.0
 */
export function isTileRefreshPaused() {
  return tileRefreshPaused;
}

/** Forces a single tile refresh even when paused (for testing)
 * @param {Object} templateManager - The template manager instance
 * @param {File} tileBlob - The tile blob data
 * @param {Array<number>} tileCoords - The tile coordinates
 * @returns {Promise<File>} The processed tile blob
 * @since 1.0.0
 */
export async function forceRefreshSingleTile(templateManager, tileBlob, tileCoords) {
  if (originalDrawTemplateOnTile) {
    consoleLog('🔄 [Force Refresh] Processing single tile:', tileCoords);
    return await originalDrawTemplateOnTile(tileBlob, tileCoords);
  }
  return tileBlob;
}

/** Gets performance statistics for tile processing
 * @returns {Object} Performance stats including processed tiles count
 * @since 1.0.0
 */
export function getTilePerformanceStats() {
  return {
    paused: tileRefreshPaused,
    cachedTiles: frozenTileCache.size,
    message: tileRefreshPaused ? 
      `Tile processing is paused. ${frozenTileCache.size} tiles cached.` : 
      'Tile processing is active'
  };
}

/** Gets the number of tiles currently in the frozen cache
 * @returns {number} Number of cached tiles
 * @since 1.0.0
 */
export function getCachedTileCount() {
  return frozenTileCache.size;
}
