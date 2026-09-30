import { type BinaryData, toBinaryBlob } from '../../utils/binaryData';
import { inferMimeTypeFromFilename } from '../../utils/history';

interface DownloadScannerResult {
  kind: 'file' | 'note';
  filename: string;
  data: BinaryData;
  mimeType?: string;
}

export function downloadScannerResult(result: DownloadScannerResult): void {
  const mimeType =
    (result.kind === 'note' ? 'text/plain;charset=utf-8' : result.mimeType) ||
    inferMimeTypeFromFilename(result.filename) ||
    'application/octet-stream';
  const blob = toBinaryBlob(result.data, mimeType);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
