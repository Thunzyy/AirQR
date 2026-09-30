/**
 * Formatting utility functions
 */

/**
 * Format bytes to human-readable size
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format duration in seconds to human-readable time
 * @param seconds - Duration in seconds
 * @returns Formatted string (e.g., "1m 30s")
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds.toFixed(0)}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}

/**
 * Format date to relative time string
 * @param date - Date object or ISO string
 * @returns Category string ('today', 'yesterday', or 'older')
 */
export function formatDateCategory(date: Date | string): 'today' | 'yesterday' | 'older' {
  const inputDate = date instanceof Date ? date : new Date(date);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = inputDate.toDateString() === today.toDateString();
  const isYesterday = inputDate.toDateString() === yesterday.toDateString();

  if (isToday) return 'today';
  if (isYesterday) return 'yesterday';
  return 'older';
}

/**
 * Format time to 12-hour format
 * @param date - Date object
 * @returns Formatted time string (e.g., "10:30 AM")
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format percentage with fixed decimal places
 * @param value - Value between 0 and 100
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string (e.g., "75.5%")
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Truncate string with ellipsis
 * @param str - String to truncate
 * @param maxLength - Maximum length before truncation
 * @returns Truncated string with ellipsis if needed
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 3)}...`;
}

/**
 * Format frame count with total
 * @param current - Current frame number
 * @param total - Total number of frames
 * @returns Formatted string (e.g., "1 / 100")
 */
export function formatFrameCount(current: number, total: number): string {
  return `${current} / ${total}`;
}

/**
 * Get file extension from filename
 * @param filename - Name of the file
 * @returns File extension without dot (e.g., "pdf")
 */
export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Get icon name for file type
 * @param filename - Name of the file
 * @returns Material icon name
 */
export function getFileIcon(filename: string): string {
  const ext = getFileExtension(filename);

  switch (ext) {
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return 'folder_zip';
    case 'pdf':
      return 'picture_as_pdf';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
      return 'image';
    case 'mp4':
    case 'avi':
    case 'mov':
    case 'webm':
      return 'movie';
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'flac':
      return 'audio_file';
    case 'doc':
    case 'docx':
    case 'txt':
    case 'md':
      return 'description';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'table_chart';
    default:
      return 'description';
  }
}

/**
 * Format scanner stats display
 * @param received - Number of received packets
 * @param min - Minimum required packets
 * @param total - Total packets (optional)
 * @returns Formatted string for display
 */
export function formatScanStats(received: number, min: number, total?: number): string {
  if (total) {
    return `${received}/${total} (min: ${min})`;
  }
  return `${received}/${min}`;
}

/**
 * Format date to relative or absolute time
 * @param dateString - ISO date string
 * @returns Formatted date string
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  // Just now
  if (diffSeconds < 60) {
    return 'Just now';
  }

  // Minutes ago
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  // Hours ago
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  // Days ago
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  // Format as date
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  const year = date.getFullYear();
  const currentYear = now.getFullYear();

  if (year === currentYear) {
    return `${month} ${day}`;
  }

  return `${month} ${day}, ${year}`;
}

/**
 * Format scan session ID for display
 * Extracts timestamp from session IDs like "scan_1768934204423"
 * @param sessionId - Session ID to format
 * @returns Formatted display name (e.g., "Scan 1768934204423")
 */
export function formatScanDisplayName(sessionId: string): string {
  // Handle format: "scan_TIMESTAMP" (e.g., "scan_1768934204423")
  if (sessionId.startsWith('scan_') && sessionId.length > 5) {
    const timestampPart = sessionId.substring(5);
    // Take first 13 chars of timestamp for readability
    const displayPart = timestampPart.length > 13
      ? timestampPart.substring(0, 13)
      : timestampPart;
    return `Scan ${displayPart}`;
  }
  // For other formats, just show as-is with "Scan" prefix
  return `Scan ${sessionId}`;
}

export function normalizeScanFilename(filename?: string): string | null {
  if (!filename) return null;
  const trimmed = filename.trim();
  if (!trimmed) return null;
  if (trimmed === 'Unknown File' || trimmed === 'Scanning...') {
    return null;
  }
  if (trimmed.startsWith('DBG:')) {
    return null;
  }
  return trimmed;
}

export function resolveIncompleteScanName(
  filename: string | undefined,
  sessionId: string | undefined
): string {
  const normalized = normalizeScanFilename(filename);
  if (normalized) return normalized;
  if (sessionId) return formatScanDisplayName(sessionId);
  return 'Scanning...';
}
