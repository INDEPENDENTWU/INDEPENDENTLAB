(() => {
  const $ = (s) => document.querySelector(s);
  const intro = $('#intro');
  const referenceInput = $('#referenceInput');
  const error = $('#error');
  const camera = $('#camera');
  const cameraWork = $('.camera-work');
  const captureFrame = $('#captureFrame');
  const video = $('#video');
  const referenceOverlay = $('#referenceOverlay');
  const referenceOutline = $('#referenceOutline');
  const closeCamera = $('#closeCamera');
  const flipCamera = $('#flipCamera');
  const referenceBtn = $('#referenceBtn');
  const referenceModeValue = $('#referenceModeValue');
  const zoomBtn = $('#zoomBtn');
  const zoomValue = $('#zoomValue');
  const shutter = $('#shutter');
  const review = $('#review');
  const retake = $('#retake');
  const changeReference = $('#changeReference');
  const compare = $('#compare');
  const beforeImage = $('#beforeImage');
  const afterWrap = $('#afterWrap');
  const afterImage = $('#afterImage');
  const divider = $('#divider');
  const compareSlider = $('#compareSlider');
  const savePhoto = $('#savePhoto');
  const saveLabel = $('#saveLabel');
  const saveCompare = $('#saveCompare');
  const saveCompareLabel = $('#saveCompareLabel');
  const captureCanvas = $('#captureCanvas');

  let refUrl = '';
  let refRatio = 4 / 3;
  let stream = null;
  let facing = 'environment';
  let referenceModeIndex = 0;
  let capturedBlob = null;
  let capturedUrl = '';
  let capturedFacing = 'environment';
  let zoomStops = [];
  let zoomIndex = 0;

  const referenceModes = [
    { type: 'ghost', opacity: 0.45, label: '45%' },
    { type: 'outline', opacity: 1, label: '轮廓' },
    { type: 'ghost', opacity: 0.65, label: '65%' },
    { type: 'ghost', opacity: 0.28, label: '28%' },
  ];

  function showError(text) {
    error.hidden = false;
    error.textContent = text;
  }

  function clearError() {
    error.hidden = true;
    error.textContent = '';
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.srcObject = null;
    zoomBtn.hidden = true;
    zoomStops = [];
    zoomIndex = 0;
  }

  function safeRevoke(url) {
    if (!url) return;
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }

  function fitBox(maxW, maxH, ratio) {
    let width = maxW;
    let height = width / ratio;
    if (height > maxH) {
      height = maxH;
      width = height * ratio;
    }
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }

  function layoutFrame() {
    if (camera.hidden) return;
    const maxW = Math.max(120, cameraWork.clientWidth - 36);
    const maxH = Math.max(120, cameraWork.clientHeight - 54);
    const box = fitBox(maxW, maxH, refRatio);
    captureFrame.style.width = `${Math.floor(box.width)}px`;
    captureFrame.style.height = `${Math.floor(box.height)}px`;
  }

  function layoutCompare() {
    if (review.hidden) return;
    const body = $('.review-body');
    const maxW = Math.max(160, Math.min(900, body.clientWidth - 8));
    const maxH = Math.max(160, body.clientHeight - 70);
    const box = fitBox(maxW, maxH, refRatio);
    compare.style.width = `${Math.floor(box.width)}px`;
    compare.style.height = `${Math.floor(box.height)}px`;
    afterImage.style.width = `${Math.floor(box.width)}px`;
    afterImage.style.height = `${Math.floor(box.height)}px`;
    updateCompare();
  }

  function updateCompare() {
    const value = Number(compareSlider.value) || 50;
    afterWrap.style.width = `${value}%`;
    divider.style.left = `${value}%`;
  }

  function applyReferenceMode() {
    const mode = referenceModes[referenceModeIndex];
    captureFrame.classList.toggle('outline-mode', mode.type === 'outline');
    captureFrame.style.setProperty('--ghost', String(mode.opacity));
    referenceModeValue.textContent = mode.label;
  }

  function clearSession() {
    stopCamera();
    capturedBlob = null;
    safeRevoke(capturedUrl);
    capturedUrl = '';
    safeRevoke(refUrl);
    refUrl = '';
    referenceOverlay.removeAttribute('src');
    beforeImage.removeAttribute('src');
    afterImage.removeAttribute('src');
    referenceOutline.width = 1;
    referenceOutline.height = 1;
    compare.classList.remove('front');
  }

  function loadReference(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        reject(new Error('type'));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ url, img });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image'));
      };
      img.src = url;
    });
  }

  function buildOutline(img) {
    const maxSide = 900;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(4, Math.round(img.naturalWidth * scale));
    const height = Math.max(4, Math.round(img.naturalHeight * scale));
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const sctx = source.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, width, height);
    const src = sctx.getImageData(0, 0, width, height);
    const lum = new Uint16Array(width * height);
    for (let i = 0, p = 0; i < src.data.length; i += 4, p++) {
      lum[p] = Math.round(src.data[i] * 0.299 + src.data[i + 1] * 0.587 + src.data[i + 2] * 0.114);
    }
    const out = new ImageData(width, height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p = y * width + x;
        const gx = Math.abs(lum[p + 1] - lum[p - 1]);
        const gy = Math.abs(lum[p + width] - lum[p - width]);
        const diagonal = Math.abs(lum[p + width + 1] - lum[p - width - 1]) * 0.35;
        const strength = gx + gy + diagonal;
        if (strength < 52) continue;
        const o = p * 4;
        out.data[o] = 0;
        out.data[o + 1] = 196;
        out.data[o + 2] = 168;
        out.data[o + 3] = Math.min(235, Math.max(95, Math.round((strength - 40) * 2.1)));
      }
    }
    referenceOutline.width = width;
    referenceOutline.height = height;
    referenceOutline.getContext('2d').putImageData(out, 0, 0);
  }

  async function chooseReference(file) {
    clearError();
    stopCamera();
    try {
      const data = await loadReference(file);
      safeRevoke(refUrl);
      refUrl = data.url;
      refRatio = data.img.naturalWidth / Math.max(1, data.img.naturalHeight);
      referenceOverlay.src = refUrl;
      beforeImage.src = refUrl;
      buildOutline(data.img);
      facing = 'environment';
      referenceModeIndex = 0;
      applyReferenceMode();
      await startCamera();
    } catch {
      showError('这张照片没有成功打开。请换一张常见格式的照片。');
    } finally {
      referenceInput.value = '';
    }
  }

  function makeZoomStops(min, max, step) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 0.05) return [];
    const raw = [min, min + (max - min) * 0.25, min + (max - min) * 0.5, min + (max - min) * 0.75, max];
    const snap = (v) => {
      if (!Number.isFinite(step) || step <= 0) return v;
      return Math.round((v - min) / step) * step + min;
    };
    return [...new Set(raw.map((v) => Math.min(max, Math.max(min, snap(v))).toFixed(3)))].map(Number);
  }

  function formatZoom(value) {
    return `${Number(value).toFixed(value < 2 ? 1 : 0).replace(/\.0$/, '')}×`;
  }

  async function setupZoom(track) {
    zoomBtn.hidden = true;
    zoomStops = [];
    zoomIndex = 0;
    try {
      const caps = track.getCapabilities?.();
      const zoom = caps?.zoom;
      if (!zoom || !Number.isFinite(zoom.min) || !Number.isFinite(zoom.max)) return;
      zoomStops = makeZoomStops(zoom.min, zoom.max, zoom.step);
      if (zoomStops.length < 2) return;
      const current = track.getSettings?.().zoom;
      if (Number.isFinite(current)) {
        let best = 0;
        for (let i = 1; i < zoomStops.length; i++) {
          if (Math.abs(zoomStops[i] - current) < Math.abs(zoomStops[best] - current)) best = i;
        }
        zoomIndex = best;
      }
      zoomValue.textContent = formatZoom(zoomStops[zoomIndex]);
      zoomBtn.hidden = false;
    } catch {}
  }

  async function cycleZoom() {
    if (!stream || zoomStops.length < 2) return;
    const track = stream.getVideoTracks()[0];
    zoomIndex = (zoomIndex + 1) % zoomStops.length;
    const value = zoomStops[zoomIndex];
    try {
      await track.applyConstraints({ advanced: [{ zoom: value }] });
      zoomValue.textContent = formatZoom(value);
    } catch {
      zoomBtn.hidden = true;
    }
  }

  async function startCamera() {
    if (!refUrl) return;
    clearError();
    stopCamera();
    camera.hidden = false;
    review.hidden = true;
    document.body.style.overflow = 'hidden';
    captureFrame.classList.toggle('front', facing === 'user');
    layoutFrame();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      layoutFrame();
      await setupZoom(stream.getVideoTracks()[0]);
    } catch (e) {
      camera.hidden = true;
      document.body.style.overflow = '';
      showError(e?.name === 'NotAllowedError' ? '没有获得相机权限。请允许相机后再试。' : '相机没有打开。可以检查浏览器相机权限后再试。');
    }
  }

  async function flip() {
    facing = facing === 'environment' ? 'user' : 'environment';
    captureFrame.classList.toggle('front', facing === 'user');
    await startCamera();
  }

  function sourceCrop(vw, vh, ratio) {
    if (vw / vh > ratio) {
      const sh = vh;
      const sw = sh * ratio;
      return { sx: (vw - sw) / 2, sy: 0, sw, sh };
    }
    const sw = vw;
    const sh = sw / ratio;
    return { sx: 0, sy: (vh - sh) / 2, sw, sh };
  }

  async function takePhoto() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || !stream) return;
    shutter.disabled = true;
    try {
      const crop = sourceCrop(vw, vh, refRatio);
      const max = 2400;
      const scale = Math.min(1, max / Math.max(crop.sw, crop.sh));
      const tw = Math.max(2, Math.round(crop.sw * scale));
      const th = Math.max(2, Math.round(crop.sh * scale));
      captureCanvas.width = tw;
      captureCanvas.height = th;
      const ctx = captureCanvas.getContext('2d');
      ctx.save();
      if (facing === 'user') {
        ctx.translate(tw, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, tw, th);
      ctx.restore();
      const blob = await new Promise((resolve) => captureCanvas.toBlob(resolve, 'image/jpeg', 0.95));
      if (!blob) throw new Error('blob');
      capturedBlob = blob;
      capturedFacing = facing;
      safeRevoke(capturedUrl);
      capturedUrl = URL.createObjectURL(blob);
      afterImage.src = capturedUrl;
      compare.classList.toggle('front', capturedFacing === 'user');
      stopCamera();
      camera.hidden = true;
      review.hidden = false;
      document.body.style.overflow = 'hidden';
      compareSlider.value = '50';
      savePhoto.classList.remove('done');
      saveCompare.classList.remove('done');
      saveLabel.textContent = '保存新照片';
      saveCompareLabel.textContent = '保存对比图';
      requestAnimationFrame(layoutCompare);
    } catch {
      showError('这次拍摄没有成功，请重拍。');
    } finally {
      shutter.disabled = false;
    }
  }

  async function deliver(blob, filename) {
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function filename(prefix) {
    return `${prefix}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
  }

  async function saveNewPhoto() {
    if (!capturedBlob) return;
    try {
      await deliver(capturedBlob, filename('同角度拍'));
      savePhoto.classList.add('done');
      saveLabel.textContent = '已保存';
      setTimeout(() => {
        savePhoto.classList.remove('done');
        saveLabel.textContent = '保存新照片';
      }, 1400);
    } catch {}
  }

  function loadUrlImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async function makeCompareBlob() {
    const [before, after] = await Promise.all([loadUrlImage(refUrl), loadUrlImage(capturedUrl)]);
    const eachMax = 1400;
    const scale = Math.min(1, eachMax / Math.max(before.naturalWidth, before.naturalHeight));
    const w = Math.max(2, Math.round(before.naturalWidth * scale));
    const h = Math.max(2, Math.round(before.naturalHeight * scale));
    const gap = Math.max(4, Math.round(Math.min(w, h) * 0.006));
    const out = document.createElement('canvas');
    out.width = w * 2 + gap;
    out.height = h;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#f1efe7';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.save();
    if (capturedFacing === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(before, 0, 0, before.naturalWidth, before.naturalHeight, 0, 0, w, h);
    ctx.restore();
    ctx.drawImage(after, 0, 0, after.naturalWidth, after.naturalHeight, w + gap, 0, w, h);
    return new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.94));
  }

  async function saveComparison() {
    if (!capturedBlob || !refUrl || !capturedUrl) return;
    saveCompare.disabled = true;
    try {
      const blob = await makeCompareBlob();
      if (!blob) return;
      await deliver(blob, filename('同角度对比'));
      saveCompare.classList.add('done');
      saveCompareLabel.textContent = '已保存';
      setTimeout(() => {
        saveCompare.classList.remove('done');
        saveCompareLabel.textContent = '保存对比图';
      }, 1400);
    } catch {}
    finally {
      saveCompare.disabled = false;
    }
  }

  function cancel() {
    clearSession();
    camera.hidden = true;
    review.hidden = true;
    document.body.style.overflow = '';
    intro.hidden = false;
  }

  function resetReference() {
    stopCamera();
    camera.hidden = true;
    review.hidden = true;
    document.body.style.overflow = '';
    capturedBlob = null;
    safeRevoke(capturedUrl);
    capturedUrl = '';
    referenceInput.click();
  }

  referenceInput.onchange = () => referenceInput.files?.[0] && chooseReference(referenceInput.files[0]);
  closeCamera.onclick = cancel;
  flipCamera.onclick = flip;
  referenceBtn.onclick = () => {
    referenceModeIndex = (referenceModeIndex + 1) % referenceModes.length;
    applyReferenceMode();
  };
  zoomBtn.onclick = cycleZoom;
  captureFrame.addEventListener('pointerdown', (e) => {
    captureFrame.classList.add('hold');
    try {
      captureFrame.setPointerCapture(e.pointerId);
    } catch {}
  });
  ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave'].forEach((type) => captureFrame.addEventListener(type, () => captureFrame.classList.remove('hold')));
  shutter.onclick = takePhoto;
  retake.onclick = startCamera;
  changeReference.onclick = resetReference;
  compareSlider.oninput = updateCompare;
  savePhoto.onclick = saveNewPhoto;
  saveCompare.onclick = saveComparison;
  window.addEventListener('resize', () => { layoutFrame(); layoutCompare(); });
  window.visualViewport?.addEventListener('resize', () => { layoutFrame(); layoutCompare(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { layoutFrame(); layoutCompare(); }, 120));
  window.addEventListener('pagehide', stopCamera);
  applyReferenceMode();
})();