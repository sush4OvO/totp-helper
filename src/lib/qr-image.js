const MAX_DIMENSION = 1400;

async function loadImage(blob) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取图片'));
    };
    image.src = url;
  });
}

export async function decodeQrFromBlob(blob) {
  if (typeof globalThis.jsQR !== 'function') {
    throw new Error('二维码解码组件未加载');
  }

  let image;
  try {
    image = await loadImage(blob);
  } catch {
    throw new Error('无法读取这张图片');
  }

  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  if (!width || !height) {
    throw new Error('图片尺寸无效');
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('无法读取图片');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  if (typeof image.close === 'function') {
    image.close();
  }

  const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  const result = globalThis.jsQR(imageData.data, targetWidth, targetHeight, {
    inversionAttempts: 'attemptBoth',
  });

  if (!result?.data) {
    throw new Error('未识别到二维码，请换一张更清晰的图片');
  }

  return result.data;
}
