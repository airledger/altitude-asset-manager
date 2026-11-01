import jsQR from "jsqr";

/** Reads a QR code from a photo, trying a few sizes because phone photos vary a lot. */
export async function decodePhoto(file: Blob): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  for (const max of [1200, 800, 1800]) {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const cx = canvas.getContext("2d");
    if (!cx) return null;
    cx.drawImage(bmp, 0, 0, w, h);
    const code = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
    if (code) return code.data;
  }
  return null;
}
