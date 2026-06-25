const locatorEl = document.getElementById('locator');
const photoCountEl = document.getElementById('photoCount');
const statusEl = document.getElementById('status');
const camera = document.getElementById('camera');
const canvas = document.getElementById('canvas');
const captureBtn = document.getElementById('captureBtn');
const undoBtn = document.getElementById('undoBtn');
const submitBtn = document.getElementById('submitBtn');
const preview = document.getElementById('preview');
const fileInput = document.getElementById('fileInput');
const overrideInput = document.getElementById('overrideInput');
const overrideBtn = document.getElementById('overrideBtn');

const JPEG_QUALITY = 0.96;
const MAX_OUTPUT_WIDTH = 2560;
const LANDSCAPE_RATIO = 16 / 9;

let currentLocator = null;
let photos = [];
let stream = null;
let uploading = false;

async function init() {
  await loadState();
  await startCamera();
  render();
}

async function loadState() {
  const res = await fetch('/api/state');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load app state.');
  currentLocator = data.nextLocator;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    statusEl.textContent = 'Camera not available. Use More options.';
    return;
  }

  try {
    if (stream) stream.getTracks().forEach((track) => track.stop());

    const preferredConstraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 2560 },
        height: { ideal: 1440 },
        aspectRatio: { ideal: LANDSCAPE_RATIO },
      },
      audio: false,
    };

    const fallbackConstraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(preferredConstraints);
    } catch {
      stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
    }

    camera.srcObject = stream;
    await camera.play().catch(() => {});

    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings ? track.getSettings() : {};
    const width = settings.width || camera.videoWidth;
    const height = settings.height || camera.videoHeight;
    statusEl.textContent = width && height ? `Ready ${width}×${height}` : 'Camera ready';
  } catch (error) {
    statusEl.textContent = 'Use More options if camera is blocked';
  }
}

function render() {
  locatorEl.textContent = currentLocator || '—';
  photoCountEl.textContent = photos.length;

  captureBtn.disabled = uploading;
  undoBtn.disabled = uploading || photos.length === 0;
  submitBtn.disabled = uploading || photos.length === 0;

  preview.innerHTML = '';

  photos.forEach((photo, index) => {
    const item = document.createElement('div');
    item.className = 'preview-item';

    const img = document.createElement('img');
    img.src = photo.url;
    img.alt = `${currentLocator}-${index + 1}`;

    const label = document.createElement('span');
    label.textContent = `${index + 1}`;

    item.appendChild(img);
    item.appendChild(label);
    preview.appendChild(item);
  });
}

function setStatusForPhotos() {
  statusEl.textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'} ready`;
}

function addPhoto(blob) {
  photos.push({ blob, url: URL.createObjectURL(blob) });
  setStatusForPhotos();
  render();
}

function getLandscapeCrop(width, height) {
  let sx = 0;
  let sy = 0;
  let sw = width;
  let sh = height;
  const ratio = width / height;

  if (ratio > LANDSCAPE_RATIO) {
    sw = Math.round(height * LANDSCAPE_RATIO);
    sx = Math.round((width - sw) / 2);
  } else if (ratio < LANDSCAPE_RATIO) {
    sh = Math.round(width / LANDSCAPE_RATIO);
    sy = Math.round((height - sh) / 2);
  }

  return { sx, sy, sw, sh };
}

function getOutputSize(sourceWidth, sourceHeight) {
  const outputWidth = Math.min(sourceWidth, MAX_OUTPUT_WIDTH);
  const scale = outputWidth / sourceWidth;
  return {
    width: Math.round(outputWidth),
    height: Math.round(sourceHeight * scale),
  };
}

function canvasToJpegBlob(targetCanvas = canvas) {
  return new Promise((resolve, reject) => {
    targetCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not create photo.'));
    }, 'image/jpeg', JPEG_QUALITY);
  });
}

async function captureCameraPhoto() {
  if (!camera.videoWidth || !camera.videoHeight) {
    statusEl.textContent = 'Camera is not ready yet';
    return;
  }

  const { sx, sy, sw, sh } = getLandscapeCrop(camera.videoWidth, camera.videoHeight);
  const output = getOutputSize(sw, sh);

  canvas.width = output.width;
  canvas.height = output.height;

  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(camera, sx, sy, sw, sh, 0, 0, output.width, output.height);

  const blob = await canvasToJpegBlob(canvas);
  addPhoto(blob);
}

async function normalizeImageFileToLandscape(file) {
  if (!file.type.startsWith('image/')) return file;

  const bitmap = await createImageBitmap(file);
  const { sx, sy, sw, sh } = getLandscapeCrop(bitmap.width, bitmap.height);
  const output = getOutputSize(sw, sh);

  const workCanvas = document.createElement('canvas');
  workCanvas.width = output.width;
  workCanvas.height = output.height;

  const ctx = workCanvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, output.width, output.height);

  if (bitmap.close) bitmap.close();
  return canvasToJpegBlob(workCanvas);
}

captureBtn.addEventListener('click', async () => {
  try {
    await captureCameraPhoto();
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

fileInput.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  statusEl.textContent = `Processing ${files.length} photo${files.length === 1 ? '' : 's'}...`;

  for (const file of files) {
    try {
      const landscapeBlob = await normalizeImageFileToLandscape(file);
      addPhoto(landscapeBlob);
    } catch {
      addPhoto(file);
    }
  }

  fileInput.value = '';
});

undoBtn.addEventListener('click', () => {
  const removed = photos.pop();
  if (removed) URL.revokeObjectURL(removed.url);
  statusEl.textContent = photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'} ready` : 'Last photo removed';
  render();
});

submitBtn.addEventListener('click', async () => {
  if (!photos.length) return;

  uploading = true;
  render();
  statusEl.textContent = `Uploading ${currentLocator}...`;

  try {
    const form = new FormData();
    form.append('locator', currentLocator);
    photos.forEach((photo, index) => {
      form.append('photos', photo.blob, `${currentLocator}-${index + 1}.jpg`);
    });

    const res = await fetch('/api/lots', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed.');

    photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    photos = [];
    currentLocator = data.nextLocator;
    statusEl.textContent = `Saved ${data.locator}. Next: ${data.nextLocator}`;
    render();
  } catch (error) {
    statusEl.textContent = error.message;
    render();
  } finally {
    uploading = false;
    render();
  }
});

overrideBtn.addEventListener('click', async () => {
  const nextLocator = overrideInput.value.trim().toUpperCase();
  if (!nextLocator) return;

  statusEl.textContent = 'Updating locator...';
  const res = await fetch('/api/state/next-locator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nextLocator }),
  });
  const data = await res.json();

  if (!res.ok) {
    statusEl.textContent = data.error || 'Could not update locator.';
    return;
  }

  currentLocator = data.nextLocator;
  overrideInput.value = '';
  photos.forEach((photo) => URL.revokeObjectURL(photo.url));
  photos = [];
  statusEl.textContent = `Next locator set to ${currentLocator}`;
  render();
});

init().catch((error) => {
  statusEl.textContent = error.message;
});
