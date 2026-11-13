// Keep the entire base64 request below the API's body limit, even with 12 photos.
export const MAX_MEAL_IMAGES = 12;
export const MAX_MEAL_IMAGES_LENGTH = 3_500_000;
export const MAX_MEAL_BODY_BYTES = 4_000_000;

function jpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('写真を変換できませんでした')), 'image/jpeg', quality));
}
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('写真を読み込めませんでした'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareMealPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('写真を読み込めません。JPEG・PNG形式をお試しください'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('写真を読み込めません');
    const budget = Math.floor(MAX_MEAL_IMAGES_LENGTH / MAX_MEAL_IMAGES);
    // Async encoding lets the phone keep drawing the UI. Two sizes and two
    // quality levels bound the work instead of repeatedly encoding large images.
    for (const size of [1024, 768]) {
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [.75, .55]) {
        const blob = await jpegBlob(canvas, quality);
        if (blob.type === 'image/jpeg' && 23 + 4 * Math.ceil(blob.size / 3) <= budget) return dataUrl(blob);
      }
    }
    throw new Error('写真を小さくできませんでした。別の写真を選んでください');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareMealPhotos(files: File[], onProgress?: (completed: number, total: number) => void): Promise<string[]> {
  if (files.length > MAX_MEAL_IMAGES) throw new Error(`写真は${MAX_MEAL_IMAGES}枚まで選べます`);
  const results = new Array<string>(files.length);
  let next = 0, completed = 0, failed = false;
  let failure: unknown;
  async function worker() {
    while (!failed && next < files.length) {
      const index = next++;
      try {
        results[index] = await prepareMealPhoto(files[index]);
        onProgress?.(++completed, files.length);
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  }
  // Bound decoding memory on phones; avoid decoding all 12 full-size photos at once.
  await Promise.all(Array.from({length: Math.min(2, files.length)}, () => worker()));
  if (failed) throw failure;
  return results;
}
