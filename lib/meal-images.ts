// Keep the entire base64 request below the API's body limit, even with 12 photos.
export const MAX_MEAL_IMAGES = 12;
export const MAX_MEAL_IMAGES_LENGTH = 3_500_000;
export const MAX_MEAL_BODY_BYTES = 4_000_000;

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
    for (let size = 1400; size >= 500; size = Math.floor(size * .8)) {
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [.82, .68, .55]) {
        const result = canvas.toDataURL('image/jpeg', quality);
        if (result.startsWith('data:image/jpeg;base64,') && result.length <= budget) return result;
      }
    }
    throw new Error('写真を小さくできませんでした。別の写真を選んでください');
  } finally {
    URL.revokeObjectURL(url);
  }
}
