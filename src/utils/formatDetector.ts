/**
 * Format Detection Utilities
 * 
 * Provides URL-based and content-based format detection for automatic
 * tech selection and playback strategy.
 */

import { Source, TechName } from '../types.js';

/** Detected format information */
export interface FormatInfo {
  /** Detected container format */
  container: 'hls' | 'dash' | 'fmp4' | 'mp4' | 'ts' | 'flv' | 'webm' | 'mkv' | 'unknown';
  /** Recommended tech for this format */
  recommendedTech: TechName | 'fmp4';
  /** Whether this is likely a live stream */
  isLive: boolean;
  /** Confidence level of detection */
  confidence: 'high' | 'medium' | 'low';
  /** Detected transport method */
  transport?: 'http' | 'ws' | 'wss';
}

/** URL extension to format mapping */
const EXTENSION_MAP: Record<string, FormatInfo> = {
  // HLS
  '.m3u8': { container: 'hls', recommendedTech: 'hls', isLive: true, confidence: 'high' },
  '.m3u': { container: 'hls', recommendedTech: 'hls', isLive: true, confidence: 'medium' },
  
  // DASH
  '.mpd': { container: 'dash', recommendedTech: 'dash', isLive: true, confidence: 'high' },
  
  // MP4 variants
  '.mp4': { container: 'mp4', recommendedTech: 'file', isLive: false, confidence: 'high' },
  '.m4v': { container: 'mp4', recommendedTech: 'file', isLive: false, confidence: 'high' },
  '.m4s': { container: 'fmp4', recommendedTech: 'fmp4', isLive: true, confidence: 'high' },
  '.cmfv': { container: 'fmp4', recommendedTech: 'fmp4', isLive: true, confidence: 'high' },
  '.cmfa': { container: 'fmp4', recommendedTech: 'fmp4', isLive: true, confidence: 'high' },
  
  // TS
  '.ts': { container: 'ts', recommendedTech: 'file', isLive: false, confidence: 'high' },
  '.mts': { container: 'ts', recommendedTech: 'file', isLive: false, confidence: 'high' },
  '.m2ts': { container: 'ts', recommendedTech: 'file', isLive: false, confidence: 'high' },
  
  // FLV
  '.flv': { container: 'flv', recommendedTech: 'ws-raw', isLive: true, confidence: 'high' },
  
  // WebM
  '.webm': { container: 'webm', recommendedTech: 'file', isLive: false, confidence: 'high' },
  
  // MKV
  '.mkv': { container: 'mkv', recommendedTech: 'file', isLive: false, confidence: 'high' },
};

/** Content-Type to format mapping */
const CONTENT_TYPE_MAP: Record<string, FormatInfo> = {
  'application/vnd.apple.mpegurl': { container: 'hls', recommendedTech: 'hls', isLive: true, confidence: 'high' },
  'application/x-mpegurl': { container: 'hls', recommendedTech: 'hls', isLive: true, confidence: 'high' },
  'audio/mpegurl': { container: 'hls', recommendedTech: 'hls', isLive: true, confidence: 'high' },
  'application/dash+xml': { container: 'dash', recommendedTech: 'dash', isLive: true, confidence: 'high' },
  'video/mp4': { container: 'mp4', recommendedTech: 'file', isLive: false, confidence: 'medium' },
  'video/mp2t': { container: 'ts', recommendedTech: 'file', isLive: false, confidence: 'high' },
  'video/x-flv': { container: 'flv', recommendedTech: 'ws-raw', isLive: true, confidence: 'high' },
  'video/webm': { container: 'webm', recommendedTech: 'file', isLive: false, confidence: 'high' },
  'video/x-matroska': { container: 'mkv', recommendedTech: 'file', isLive: false, confidence: 'high' },
};

/**
 * Detect format from URL
 */
export function detectFormatFromUrl(url: string): FormatInfo {
  const lowerUrl = url.toLowerCase();
  
  // Check transport
  let transport: 'http' | 'ws' | 'wss' | undefined;
  if (lowerUrl.startsWith('ws://')) {
    transport = 'ws';
  } else if (lowerUrl.startsWith('wss://')) {
    transport = 'wss';
  } else if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
    transport = 'http';
  }
  
  // WebSocket URLs are typically live streams
  if (transport === 'ws' || transport === 'wss') {
    // Check for FLV/TS hints in URL
    if (lowerUrl.includes('.flv') || lowerUrl.includes('/flv/') || lowerUrl.includes('flv=')) {
      return { container: 'flv', recommendedTech: 'ws-raw', isLive: true, confidence: 'high', transport };
    }
    if (lowerUrl.includes('.ts') || lowerUrl.includes('/ts/') || lowerUrl.includes('ts=')) {
      return { container: 'ts', recommendedTech: 'ws-raw', isLive: true, confidence: 'high', transport };
    }
    if (lowerUrl.includes('.mp4') || lowerUrl.includes('/fmp4/') || lowerUrl.includes('fmp4=')) {
      return { container: 'fmp4', recommendedTech: 'fmp4', isLive: true, confidence: 'medium', transport };
    }
    // Default WS to FLV (most common)
    return { container: 'flv', recommendedTech: 'ws-raw', isLive: true, confidence: 'low', transport };
  }
  
  // Parse URL to get extension
  try {
    const urlObj = new URL(url, 'http://localhost');
    const pathname = urlObj.pathname;
    
    // Check extension
    for (const [ext, info] of Object.entries(EXTENSION_MAP)) {
      if (pathname.endsWith(ext)) {
        return { ...info, transport };
      }
    }
    
    // Check for common streaming patterns in path
    if (pathname.includes('/live/') || pathname.includes('/stream/')) {
      return { container: 'unknown', recommendedTech: 'hls', isLive: true, confidence: 'low', transport };
    }
  } catch {
    // Invalid URL, try simple extension check
    for (const [ext, info] of Object.entries(EXTENSION_MAP)) {
      if (lowerUrl.endsWith(ext)) {
        return { ...info, transport };
      }
    }
  }
  
  return { container: 'unknown', recommendedTech: 'file', isLive: false, confidence: 'low', transport };
}

/**
 * Detect format from Content-Type header
 */
export function detectFormatFromContentType(contentType: string): FormatInfo | null {
  const normalized = contentType.toLowerCase().split(';')[0].trim();
  return CONTENT_TYPE_MAP[normalized] ?? null;
}

/**
 * Detect format from initial bytes (magic numbers)
 */
export function detectFormatFromBytes(bytes: Uint8Array): FormatInfo | null {
  if (bytes.length < 8) return null;
  
  // FLV: 'FLV' (0x46 0x4C 0x56)
  if (bytes[0] === 0x46 && bytes[1] === 0x4C && bytes[2] === 0x56) {
    return { container: 'flv', recommendedTech: 'ws-raw', isLive: true, confidence: 'high' };
  }
  
  // MPEG-TS: 0x47 sync byte
  if (bytes[0] === 0x47) {
    // Check for multiple sync bytes at 188-byte intervals
    if (bytes.length >= 376 && bytes[188] === 0x47) {
      return { container: 'ts', recommendedTech: 'file', isLive: false, confidence: 'high' };
    }
    return { container: 'ts', recommendedTech: 'file', isLive: false, confidence: 'medium' };
  }
  
  // MP4/fMP4: 'ftyp' box
  if (bytes.length >= 8) {
    const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (boxType === 'ftyp') {
      // Check brand for fMP4 vs regular MP4
      if (bytes.length >= 12) {
        const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
        // Common fMP4 brands: iso5, iso6, cmfc, dash
        if (['iso5', 'iso6', 'cmfc', 'dash', 'msdh', 'msix'].includes(brand)) {
          return { container: 'fmp4', recommendedTech: 'fmp4', isLive: true, confidence: 'high' };
        }
      }
      return { container: 'mp4', recommendedTech: 'file', isLive: false, confidence: 'high' };
    }
    // 'moov' or 'moof' box (fMP4 segment)
    if (boxType === 'moof' || boxType === 'styp') {
      return { container: 'fmp4', recommendedTech: 'fmp4', isLive: true, confidence: 'high' };
    }
  }
  
  // WebM/MKV: EBML header (0x1A 0x45 0xDF 0xA3)
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
    // Need to check DocType to distinguish WebM from MKV
    return { container: 'webm', recommendedTech: 'file', isLive: false, confidence: 'medium' };
  }
  
  return null;
}

/**
 * Get recommended tech order based on source type and format
 */
export function getRecommendedTechOrder(source: Source): TechName[] {
  switch (source.type) {
    case 'webrtc':
      return ['webrtc', 'ws-raw', 'hls'];
    case 'hls':
      return ['hls', 'file'];
    case 'dash':
      return ['dash', 'file'];
    case 'ws-raw':
      return ['ws-raw', 'hls'];
    case 'gb28181':
      return ['gb28181', 'ws-raw'];
    case 'file':
      return ['file', 'hls'];
    case 'fmp4' as any:
      return ['fmp4' as TechName, 'dash', 'hls'];
    case 'auto':
      // For auto, try to detect from URL
      const format = detectFormatFromUrl(source.url);
      if (format.recommendedTech === 'fmp4') {
        return ['fmp4' as TechName, 'dash', 'hls', 'ws-raw', 'file'];
      }
      return [format.recommendedTech, 'hls', 'dash', 'ws-raw', 'file'];
    default:
      return ['hls', 'dash', 'ws-raw', 'file'];
  }
}

/**
 * Auto-detect source type from URL
 */
export function autoDetectSourceType(url: string): Source['type'] {
  const format = detectFormatFromUrl(url);
  
  switch (format.container) {
    case 'hls':
      return 'hls';
    case 'dash':
      return 'dash';
    case 'flv':
    case 'ts':
      if (format.transport === 'ws' || format.transport === 'wss') {
        return 'ws-raw';
      }
      return 'file';
    case 'fmp4':
      return 'fmp4' as Source['type'];
    case 'mp4':
    case 'webm':
    case 'mkv':
      return 'file';
    default:
      return 'auto';
  }
}
