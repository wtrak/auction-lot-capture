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

let currentLocator = null;
let photos = [];
let stream = null;

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
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    camera.srcObject = stream;
    statusEl.textContent = 'Camera ready';
  } catch (error) {
    statusEl.textContent = 'Use file picker if camera is blocked';
  }
}

function render() {
  locatorEl.textContent = currentLocator || '—';
  photoCountEl.textContent = photos.length;
  undoBtn.disabled = photos.length === 0;
  submitBtn.disabled = photos.length === 0;
  preview.innerHTML = '';

  photos.forEach((photo, index) => {
    const img = document.createElement('img');
    img.src = photo.url;
    img.alt = `${currentLocator}-${index + 1}`;
    preview.appendChild(img);
  });
}

function addPhoto(blob) {
  photos.push({ blob, url: URL.createObjectURL(blob) });
  statusEl.textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'} ready`;
  render();
}

captureBtn.addEventListener('click', async () => {
  if (!camera.videoWidth) {
    statusEl.textContent = 'Camera is not ready yet';
    return;
  }

  canvas.width = camera.videoWidth;
  canvas.height = camera.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(camera, 0, 0, canvas.width, canvas.height);

  canvas.toBlob((blob) => {
    if (blob) addPhoto(blob);
  }, 'image/jpeg', 0.9);
});

fileInput.addEventListener('change', async (event) => {
  for (const file of event.target.files) {
    addPhoto(file);
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

  submitBtn.disabled = true;
  captureBtn.disabled = true;
  undoBtn.disabled = true;
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
    submitBtn.disabled = photos.length === 0;
    captureBtn.disabled = false;
    undoBtn.disabled = photos.length === 0;
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
