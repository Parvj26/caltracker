import { MAX_PRINTOUT_BYTES, PRINTOUT_ERROR } from './scan-form';

export type Printout = { blob: Blob; ext: 'webp' | 'jpg' | 'pdf'; contentType: string };

const LONG_EDGE = 1600;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** True when the file really starts with the PDF signature, not just a .pdf name or a PDF content type. */
async function looksLikePdf(file: Blob): Promise<boolean> {
  return (await file.slice(0, 5).text()) === '%PDF-';
}

/**
 * Gets a chosen file ready to upload: an image is shrunk on this device (long edge at most 1600 px) and saved as
 * WebP, or as JPEG at quality 0.85 when the browser cannot encode WebP; a PDF is kept as it is. Throws an Error with
 * the message to show (`error`) when the file is not an image or a real PDF, or is over 5 MB. Documents use it too.
 */
export async function preparePrintout(file: File, error: string = PRINTOUT_ERROR): Promise<Printout> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PRINTOUT_BYTES || !(await looksLikePdf(file))) throw new Error(error);
    return { blob: file, ext: 'pdf', contentType: 'application/pdf' };
  }
  if (!file.type.startsWith('image/')) throw new Error(error);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(error);
  }
  try {
    const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const webp = await toBlob(canvas, 'image/webp', 0.8);
    // A browser that cannot encode WebP quietly returns a PNG, so check the type that came back.
    const out =
      webp?.type === 'image/webp'
        ? ({ blob: webp, ext: 'webp', contentType: 'image/webp' } as const)
        : await toBlob(canvas, 'image/jpeg', 0.85).then((b) => (b ? ({ blob: b, ext: 'jpg', contentType: 'image/jpeg' } as const) : null));
    if (!out || out.blob.size > MAX_PRINTOUT_BYTES) throw new Error(error);
    return out;
  } finally {
    bitmap.close();
  }
}
