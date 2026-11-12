export const ENCODER_LINKSITE_PATH = '/linksites/airqr-encoder-linksite.html';
export const PORTABLE_SINGLEFILE_PATH = '/airqr-portable.html';
export const ENCODER_LINKSITE_CONSOLE_SNIPPET = `const dataUrl = prompt('Paste the copied AirQR linksite URL');
if (dataUrl) {
  const base64Data = dataUrl.replace(/^data:text\\/html;charset=utf-8;base64,/, '');
  const decodedCode = atob(base64Data);
  const blob = new Blob([decodedCode], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'AirQR_Encoder.html';
  a.click();
}`;

const DATA_URL_PREFIX = 'data:text/html;charset=utf-8;base64,';
const BASE64_CHUNK_SIZE = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }

  return btoa(binary);
}

export function htmlToDataUrl(html: string): string {
  return `${DATA_URL_PREFIX}${bytesToBase64(new TextEncoder().encode(html))}`;
}

export async function buildEncoderLinksiteDataUrl(
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(ENCODER_LINKSITE_PATH, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to load encoder linksite (${response.status})`);
  }

  return htmlToDataUrl(await response.text());
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const didCopy = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!didCopy) {
    throw new Error('Clipboard copy failed');
  }
}
