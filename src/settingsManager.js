/** @file Settings Manager for handling persistent storage and configuration
 * Contains all storage/settings functions that were previously in main.js
 * @since 1.0.0
 */

import { consoleLog, consoleWarn, consoleError } from './utils.js';

/** Gets the saved crosshair color from storage
 * @returns {Object} The crosshair color configuration
 * @since 1.0.0 
 */
export function getCrosshairColor() {
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
export function saveCrosshairColor(colorConfig) {
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
export function getBorderEnabled() {
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
export function saveBorderEnabled(enabled) {
  try {
    const enabledString = JSON.stringify(enabled);
    
    // Save to TamperMonkey storage
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue('bmCrosshairBorder', enabledString);
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bmCrosshairBorder', enabledString);
    
    consoleLog('🔲 Border setting saved:', enabled);
  } catch (error) {
    consoleError('Failed to save border setting:', error);
  }
}

/** Gets the enhanced size enabled setting from storage
 * @returns {boolean} Whether enhanced size is enabled
 * @since 1.0.0 
 */
export function getEnhancedSizeEnabled() {
  try {
    let enhancedSizeEnabled = null;
    
    // Try TamperMonkey storage first
    if (typeof GM_getValue !== 'undefined') {
      const saved = GM_getValue('bmCrosshairEnhancedSize', null);
      if (saved !== null) enhancedSizeEnabled = JSON.parse(saved);
    }
    
    // Fallback to localStorage
    if (enhancedSizeEnabled === null) {
      const saved = localStorage.getItem('bmCrosshairEnhancedSize');
      if (saved !== null) enhancedSizeEnabled = JSON.parse(saved);
    }
    
    if (enhancedSizeEnabled !== null) {
      consoleLog('📏 Enhanced size setting loaded:', enhancedSizeEnabled);
      return enhancedSizeEnabled;
    }
  } catch (error) {
    consoleWarn('Failed to load enhanced size setting:', error);
  }
  
  // Default to disabled
  consoleLog('📏 Using default enhanced size setting: false');
  return false;
}

/** Saves the enhanced size enabled setting to storage
 * @param {boolean} enabled - Whether enhanced size should be enabled
 * @since 1.0.0
 */
export function saveEnhancedSizeEnabled(enabled) {
  try {
    const enabledString = JSON.stringify(enabled);
    
    // Save to TamperMonkey storage
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue('bmCrosshairEnhancedSize', enabledString);
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bmCrosshairEnhancedSize', enabledString);
    
    consoleLog('📏 Enhanced size setting saved:', enabled);
  } catch (error) {
    consoleError('Failed to save enhanced size setting:', error);
  }
}

/** Gets the mini tracker enabled setting from storage
 * @returns {boolean} Whether mini tracker is enabled
 * @since 1.0.0 
 */
export function getMiniTrackerEnabled() {
  try {
    let miniTrackerEnabled = null;
    
    // Try TamperMonkey storage first
    if (typeof GM_getValue !== 'undefined') {
      const saved = GM_getValue('bmMiniTrackerEnabled', null);
      if (saved !== null) miniTrackerEnabled = JSON.parse(saved);
    }
    
    // Fallback to localStorage
    if (miniTrackerEnabled === null) {
      const saved = localStorage.getItem('bmMiniTrackerEnabled');
      if (saved !== null) miniTrackerEnabled = JSON.parse(saved);
    }
    
    if (miniTrackerEnabled !== null) {
      consoleLog('📊 Mini tracker setting loaded:', miniTrackerEnabled);
      return miniTrackerEnabled;
    }
  } catch (error) {
    consoleWarn('Failed to load mini tracker setting:', error);
  }
  
  // Default to enabled
  consoleLog('📊 Using default mini tracker setting: true');
  return true;
}

/** Saves the mini tracker enabled setting to storage
 * @param {boolean} enabled - Whether mini tracker should be enabled
 * @since 1.0.0
 */
export function saveMiniTrackerEnabled(enabled) {
  try {
    const enabledString = JSON.stringify(enabled);
    
    // Save to TamperMonkey storage
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue('bmMiniTrackerEnabled', enabledString);
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bmMiniTrackerEnabled', enabledString);
    
    consoleLog('📊 Mini tracker setting saved:', enabled);
  } catch (error) {
    consoleError('Failed to save mini tracker setting:', error);
  }
}

/** Gets the collapse min enabled setting from storage
 * @returns {boolean} Whether collapse min is enabled
 * @since 1.0.0 
 */
export function getCollapseMinEnabled() {
  try {
    let collapseMinEnabled = null;
    
    // Try TamperMonkey storage first
    if (typeof GM_getValue !== 'undefined') {
      const saved = GM_getValue('bmCollapseMinEnabled', null);
      if (saved !== null) collapseMinEnabled = JSON.parse(saved);
    }
    
    // Fallback to localStorage
    if (collapseMinEnabled === null) {
      const saved = localStorage.getItem('bmCollapseMinEnabled');
      if (saved !== null) collapseMinEnabled = JSON.parse(saved);
    }
    
    if (collapseMinEnabled !== null) {
      consoleLog('📦 Collapse min setting loaded:', collapseMinEnabled);
      return collapseMinEnabled;
    }
  } catch (error) {
    consoleWarn('Failed to load collapse min setting:', error);
  }
  
  // Default to disabled
  consoleLog('📦 Using default collapse min setting: false');
  return false;
}

/** Saves the collapse min enabled setting to storage
 * @param {boolean} enabled - Whether collapse min should be enabled
 * @since 1.0.0
 */
export function saveCollapseMinEnabled(enabled) {
  try {
    const enabledString = JSON.stringify(enabled);
    
    // Save to TamperMonkey storage
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue('bmCollapseMinEnabled', enabledString);
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bmCollapseMinEnabled', enabledString);
    
    consoleLog('📦 Collapse min setting saved:', enabled);
  } catch (error) {
    consoleError('Failed to save collapse min setting:', error);
  }
}

/** Gets the mobile mode setting from storage
 * @returns {boolean} Whether mobile mode is enabled
 * @since 1.0.0 
 */
export function getMobileMode() {
  try {
    const saved = localStorage.getItem('bmMobileMode');
    if (saved !== null) {
      return JSON.parse(saved);
    }
  } catch (error) {
    consoleWarn('Failed to load mobile mode setting:', error);
  }
  return false; // Default to disabled
}

/** Saves the mobile mode setting to storage
 * @param {boolean} enabled - Whether mobile mode should be enabled
 * @since 1.0.0
 */
export function saveMobileMode(enabled) {
  try {
    localStorage.setItem('bmMobileMode', JSON.stringify(enabled));
    consoleLog('📱 Mobile mode setting saved:', enabled);
  } catch (error) {
    consoleError('Failed to save mobile mode setting:', error);
  }
}

/** Gets the tile refresh pause setting from storage
 * @returns {boolean} Whether tile refresh is paused
 * @since 1.0.0
 */
export function getTileRefreshPaused() {
  try {
    let pausedState = null;
    
    // Try TamperMonkey storage first
    if (typeof GM_getValue !== 'undefined') {
      const saved = GM_getValue('bmTileRefreshPaused', null);
      if (saved !== null) pausedState = JSON.parse(saved);
    }
    
    // Fallback to localStorage
    if (pausedState === null) {
      const saved = localStorage.getItem('bmTileRefreshPaused');
      if (saved !== null) pausedState = JSON.parse(saved);
    }
    
    if (pausedState !== null) {
      consoleLog('⏸️ Tile refresh pause setting loaded:', pausedState);
      return pausedState;
    }
  } catch (error) {
    consoleWarn('Failed to load tile refresh pause setting:', error);
  }
  
  // Default to not paused
  consoleLog('⏸️ Using default tile refresh pause setting: false');
  return false;
}

/** Saves the tile refresh pause setting to storage
 * @param {boolean} paused - Whether tile refresh should be paused
 * @since 1.0.0
 */
export function saveTileRefreshPaused(paused) {
  try {
    const pausedString = JSON.stringify(paused);
    
    // Save to TamperMonkey storage
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue('bmTileRefreshPaused', pausedString);
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bmTileRefreshPaused', pausedString);
    
    consoleLog('⏸️ Tile refresh pause setting saved:', paused);
  } catch (error) {
    consoleError('Failed to save tile refresh pause setting:', error);
  }
}

/** Gets the smart template detection setting from storage
 * @returns {boolean} Whether smart detection is enabled
 * @since 1.0.0
 */
export function getSmartDetectionEnabled() {
  try {
    let smartDetectionEnabled = null;
    
    // Try TamperMonkey storage first
    if (typeof GM_getValue !== 'undefined') {
      const saved = GM_getValue('bmSmartDetectionEnabled', null);
      if (saved !== null) smartDetectionEnabled = JSON.parse(saved);
    }
    
    // Fallback to localStorage
    if (smartDetectionEnabled === null) {
      const saved = localStorage.getItem('bmSmartDetectionEnabled');
      if (saved !== null) smartDetectionEnabled = JSON.parse(saved);
    }
    
    if (smartDetectionEnabled !== null) {
      consoleLog('🧠 Smart detection setting loaded:', smartDetectionEnabled);
      return smartDetectionEnabled;
    }
  } catch (error) {
    consoleWarn('Failed to load smart detection setting:', error);
  }
  
  // Default to enabled
  consoleLog('🧠 Using default smart detection setting: true');
  return true;
}

/** Saves the smart template detection setting to storage
 * @param {boolean} enabled - Whether smart detection should be enabled
 * @since 1.0.0
 */
export function saveSmartDetectionEnabled(enabled) {
  try {
    const enabledString = JSON.stringify(enabled);
    
    // Save to TamperMonkey storage
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue('bmSmartDetectionEnabled', enabledString);
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bmSmartDetectionEnabled', enabledString);
    
    consoleLog('🧠 Smart detection setting saved:', enabled);
  } catch (error) {
    consoleError('Failed to save smart detection setting:', error);
  }
}

/** Gets the navigation method setting from storage
 * @returns {string} Navigation method ('flyto' or 'openurl')
 * @since 1.0.0
 */
export function getNavigationMethod() {
  try {
    let navigationMethod = null;
    
    // Try TamperMonkey storage first
    if (typeof GM_getValue !== 'undefined') {
      const saved = GM_getValue('bmNavigationMethod', null);
      if (saved !== null) navigationMethod = JSON.parse(saved);
    }
    
    // Fallback to localStorage
    if (navigationMethod === null) {
      const saved = localStorage.getItem('bmNavigationMethod');
      if (saved !== null) navigationMethod = JSON.parse(saved);
    }
    
    if (navigationMethod !== null) {
      consoleLog('🧭 Navigation method setting loaded:', navigationMethod);
      return navigationMethod;
    }
  } catch (error) {
    consoleWarn('Failed to load navigation method setting:', error);
  }
  
  // Default to flyto
  consoleLog('🧭 Using default navigation method setting: flyto');
  return 'flyto';
}

/** Saves the navigation method setting to storage
 * @param {string} method - Navigation method ('flyto' or 'openurl')
 * @since 1.0.0
 */
export function saveNavigationMethod(method) {
  try {
    const methodString = JSON.stringify(method);
    
    // Save to TamperMonkey storage
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue('bmNavigationMethod', methodString);
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bmNavigationMethod', methodString);
    
    consoleLog('🧭 Navigation method setting saved:', method);
  } catch (error) {
    consoleError('Failed to save navigation method setting:', error);
  }
}