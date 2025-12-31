/**
 * Private Data Stream Processing
 * Handles KLV, SMPTE, and other private data extraction from MPEG-TS
 */

/**
 * Get human-readable name for private data stream type
 */
export function getPrivateDataTypeName(streamType: number): string {
  switch (streamType) {
    case 0x06:
      return 'PES Private Data';
    case 0x15:
      return 'MISB KLV Metadata';
    default:
      return 'Unknown Private Data';
  }
}

/**
 * Check if a stream type is a private data stream
 */
export function isPrivateDataStream(streamType: number): boolean {
  return streamType === 0x06 || streamType === 0x15;
}
