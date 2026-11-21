import type { Attachment } from './types';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_EDGE = 1600;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml', 'ini', 'log', 'html', 'htm', 'css', 'scss',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sql',
  'sh', 'bash', 'ps1', 'bat', 'r', 'lua', 'dart', 'vue', 'svelte', 'env', 'gitignore', 'dockerfile', 'tex', 'srt', 'vtt',
]);

export const ACCEPT_ATTR = [
  ...IMAGE_TYPES,
  'application/pdf',
  ...[...TEXT_EXTENSIONS].map((e) => `.${e}`),
].join(',');

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

export function isImageFile(file: File) {
  return IMAGE_TYPES.includes(file.type);
}

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function processImage(file: File): Promise<Attachment> {
  // GIFs are passed through (animation would be lost when re-encoding).
  if (file.type === 'image/gif') {
    if (file.size > 5 * 1024 * 1024) throw new Error(`"${file.name}" is larger than 5 MB.`);
    const url = await readAsDataURL(file);
    return { type: 'image', name: file.name, mediaType: file.type, data: url.split(',')[1] };
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`"${file.name}" could not be read as an image.`);
  });
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const keepPng = file.type === 'image/png' && scale === 1 && file.size < 3 * 1024 * 1024;
  if (!keepPng) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const mediaType = keepPng ? 'image/png' : 'image/jpeg';
  const dataUrl = canvas.toDataURL(mediaType, 0.88);
  return { type: 'image', name: file.name, mediaType, data: dataUrl.split(',')[1] };
}

async function extractPdfText(file: File, maxChars: number): Promise<{ text: string; truncated: boolean }> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    let text = '';
    let truncated = false;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('');
      text += `\n\n--- Page ${i} ---\n${pageText.trim()}`;
      if (text.length > maxChars) {
        truncated = true;
        break;
      }
    }
    return { text: text.trim().slice(0, maxChars), truncated };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'PasswordException') throw new Error(`"${file.name}" is password-protected. Remove the password and try again.`);
    if (name === 'InvalidPDFException') throw new Error(`"${file.name}" isn’t a valid PDF or is damaged.`);
    throw new Error(`Couldn’t read "${file.name}".`);
  } finally {
    // Always release the pdf.js worker, even when the file can't be read.
    void task.destroy();
  }
}

export async function processFile(file: File, maxDocChars: number): Promise<Attachment> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`"${file.name}" is larger than 20 MB.`);
  if (isImageFile(file)) return processImage(file);

  if (file.type === 'application/pdf' || ext(file.name) === 'pdf') {
    const { text, truncated } = await extractPdfText(file, maxDocChars);
    if (!text.replace(/--- Page \d+ ---/g, '').trim()) {
      throw new Error(`"${file.name}" has no extractable text (it may be a scanned PDF). Try uploading page images instead.`);
    }
    return { type: 'document', name: file.name, mediaType: 'application/pdf', text, truncated };
  }

  if (file.type.startsWith('text/') || TEXT_EXTENSIONS.has(ext(file.name)) || file.type === 'application/json') {
    const raw = await file.text();
    if (raw.includes('\u0000')) throw new Error(`"${file.name}" looks like a binary file and can't be analyzed.`);
    const truncated = raw.length > maxDocChars;
    return { type: 'document', name: file.name, mediaType: file.type || 'text/plain', text: raw.slice(0, maxDocChars), truncated };
  }

  throw new Error(`"${file.name}" is not a supported file type. Use images, PDFs, or text/code files.`);
}

export function formatBytes(chars: number) {
  if (chars < 1000) return `${chars} chars`;
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(chars < 10_000 ? 1 : 0)}k chars`;
  return `${(chars / 1_000_000).toFixed(1)}M chars`;
}
