(() => {
  const $ = (s) => document.querySelector(s);
  const intro = $('#intro');
  const referenceInput = $('#referenceInput');
  const savedReference = $('#savedReference');
  const useSavedRef = $('#useSavedRef');
  const forgetSavedRef = $('#forgetSavedRef');
  const error = $('#error');
  const camera = $('#camera');
  const cameraWork = $('.camera-work');
  const captureFrame = $('#captureFrame');
  const video = $('#video');
  const referenceOverlay = $('#referenceOverlay');
  const referenceOutline = $('#referenceOutline');
  const countdown = $('#countdown');
  const closeCamera = $('#closeCamera');
  const flipCamera = $('#flipCamera');
  const referenceBtn = $('#referenceBtn');
  const referenceModeValue = $('#referenceModeValue');
  const zoomBtn = $('#zoomBtn');
  const zoomValue = $('#zoomValue');
  const timerBtn = $('#timerBtn');
  const timerValue = $('#timerValue');
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
  const blinkBtn = $('#blinkBtn');
  const rememberRef = $('#rememberRef');
  const savePhoto = $('#savePhoto');
  const saveLabel = $('#saveLabel');
  const saveCompare = $('#saveCompare');
  const saveCompareLabel = $('#saveCompareLabel');
  const captureCanvas = $('#captureCanvas');

  const DB_NAME = 'same-angle-local-v1';
  const DB_STORE = 'refs';
  const DB_KEY = 'common';
  const referenceModes = [
    { kind: 'opacity', alpha: 0.45, label: '45%' },
    { kind: 'outline', label: '轮廓' },
    { kind: 'opacity', alpha: 0.65, label: '65%' },
    { kind: 'opacity', alpha: 0.28, label: '28%' },
  ];

  let refUrl = '';
  let refBlob = null;
  let refName = '';
  let refRatio = 4 / 3;
  let refFromSaved = false;
  let stream = null;
  let facing = 'environment';
  let captureFacing = 'environment';
  let cameraOrigin = 'intro';
  let referenceModeIndex = 0;
  let capturedBlob = null;
  let capturedUrl = '';
  let zoomSteps = [];
  let zoomIndex = 0;
  let timerEnabled = false;
  let timerRunning = false;
  let countdownToken = 0;
  let blinkTimer = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function showError(text) {
    error.hidden = false;
    error.textContent = text;
  }

  function clearError() {
    error.hidden = true;
    error.textContent = '';
  }

  function safeRevoke(url) {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch {}
  }

  function stopCamera() {
    countdownToken += 1;
    timerRunning = false;
    countdown.hidden = true;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.srcObject = null;
    zoomBtn.hidden = true;
    zoomSteps = [];
  }

  function stopBlink() {
    clearInterval(blinkTimer);
    blinkTimer = 0;
    compare.classList.remove('blink-mode', 'show-after');
    blinkBtn.setAttribute('aria-pressed', 'false');
    blinkBtn.textContent = '闪看';
    updateCompare();
  }

  function clearCapture() {
    capturedBlob = null;
    safeRevoke(capturedUrl);
    capturedUrl = '';
    afterImage.removeAttribute('src');
  }

  function clearSession() {
    stopCamera();
    stopBlink();
    clearCapture();
    safeRevoke(refUrl);
    refUrl = '';
    refBlob = null;
    refName = '';
    refFromSaved = false;
    referenceOverlay.removeAttribute('src');
    beforeImage.removeAttribute('src');
    referenceOutline.width = 1;
    referenceOutline.height = 1;
    compare.classList.remove('front');
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
    const maxH = Math.max(160, body.clientHeight - 105);
    const box = fitBox(maxW, maxH, refRatio);
    compare.style.width = `${Math.floor(box.width)}px`;
    compare.style.height = `${Math.floor(box.height)}px`;
    afterImage.style.width = `${Math.floor(box.width)}px`;
    afterImage.style.height = `${Math.floor(box.height)}px`;
    updateCompare();
  }

  function updateCompare() {
    if (compare.classList.contains('blink-mode')) return;
    const value = Number(compareSlider.value) || 50;
    afterWrap.style.width = `${value}%`;
    divider.style.left = `${value}%`;
  }

  function applyReferenceMode() {
    const mode = referenceModes[referenceModeIndex];
    captureFrame.classList.toggle('outline-mode', mode.kind === 'outline');
    captureFrame.style.setProperty('--ghost', String(mode.alpha ?? 0.45));
    referenceModeValue.textContent = mode.label;
  }

  function setTimer(value) {
    timerEnabled = value;
    timerBtn.setAttribute('aria-pressed', value ? 'true' : 'false');
    timerValue.textContent = value ? '3 秒' : '关';
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('unsupported'));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('db'));
    });
  }

  async function dbGet() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const request = tx.objectStore(DB_STORE).get(DB_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('read'));
      tx.oncomplete = () => db.close();
    });
  }

  async function dbPut(value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, DB_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('write')); };
    });
  }

  async function dbDelete() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(DB_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('delete')); };
    });
  }

  async function refreshSavedReference() {
    try {
      const saved = await dbGet();
      savedReference.hidden = !saved?.blob;
    } catch {
      savedReference.hidden = true;
    }
  }

  function loadImageSource(blob) {
    return new Promise((resolve, reject) => {
      if (!(blob instanceof Blob) || !blob.type.startsWith('image/')) return reject(new Error('type'));
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => resolve({ url, image });
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
      image.src = url;
    });
  }

  function generateOutline(image) {
    const maxSide = 760;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(2, Math.round(image.naturalWidth * scale));
    const height = Math.max(2, Math.round(image.naturalHeight * scale));
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const sourceCtx = source.getContext('2d', { willReadFrequently: true });
    sourceCtx.drawImage(image, 0, 0, width, height);
    const pixels = sourceCtx.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
      gray[p] = Math.round(pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
    }
    referenceOutline.width = width;
    referenceOutline.height = height;
    const ctx = referenceOutline.getContext('2d');
    const out = ctx.createImageData(width, height);
    const data = out.data;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const at = y * width + x;
        const gx = Math.abs(gray[at + 1] - gray[at - 1]);
        const gy = Math.abs(gray[at + width] - gray[at - width]);
        const strength = gx + gy;
        if (strength < 58) continue;
        const i = at * 4;
        data[i] = 0;
        data[i + 1] = 205;
        data[i + 2] = 175;
        data[i + 3] = Math.min(235, 70 + (strength - 58) * 3);
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  async function chooseReference(blob, name = '参考照片', fromSaved = false) {
    clearError();
    stopCamera();
    stopBlink();
    clearCapture();
    try {
      const data = await loadImageSource(blob);
      safeRevoke(refUrl);
      refUrl = data.url;
      refBlob = blob;
      refName = name;
      refFromSaved = fromSaved;
      refRatio = data.image.naturalWidth / Math.max(1, data.image.naturalHeight);
      referenceOverlay.src = refUrl;
      beforeImage.src = refUrl;
      generateOutline(data.image);
      facing = 'environment';
      compare.classList.remove('front');
      rememberRef.classList.toggle('done', refFromSaved);
      rememberRef.textContent = refFromSaved ? '已是常用参考' : '保存为常用参考';
      await startCamera('intro');
    } catch {
      showError('这张照片没有成功打开。请换一张常见格式的照片。');
    } finally {
      referenceInput.value = '';
    }
  }

  function configureZoom(track) {
    zoomBtn.hidden = true;
    zoomSteps = [];
    try {
      const capability = track.getCapabilities?.().zoom;
      if (!capability || !Number.isFinite(capability.min) || !Number.isFinite(capability.max) || capability.max - capability.min < 0.08) return;
      const candidates = [capability.min, 1, 1.5, 2, 3, 5, capability.max]
        .filter((value) => value >= capability.min - 0.001 && value <= capability.max + 0.001)
        .map((value) => Math.round(value * 10) / 10)
        .sort((a, b) => a - b);
      zoomSteps = [...new Set(candidates)];
      if (zoomSteps.length < 2) return;
      const current = track.getSettings?.().zoom ?? zoomSteps[0];
      zoomIndex = zoomSteps.reduce((best, value, index) => Math.abs(value - current) < Math.abs(zoomSteps[best] - current) ? index : best, 0);
      zoomValue.textContent = `${zoomSteps[zoomIndex]}×`;
      zoomBtn.hidden = false;
    } catch {}
  }

  async function startCamera(origin = cameraOrigin) {
    if (!refUrl) return;
    clearError();
    stopCamera();
    cameraOrigin = origin;
    camera.hidden = false;
    review.hidden = true;
    intro.hidden = true;
    document.body.style.overflow = 'hidden';
    captureFrame.classList.toggle('front', facing === 'user');
    layoutFrame();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      const track = stream.getVideoTracks()[0];
      if (track) configureZoom(track);
      layoutFrame();
    } catch (e) {
      stopCamera();
      camera.hidden = true;
      document.body.style.overflow = cameraOrigin === 'review' ? 'hidden' : '';
      if (cameraOrigin === 'review' && capturedUrl) {
        review.hidden = false;
        requestAnimationFrame(layoutCompare);
      } else {
        intro.hidden = false;
      }
      showError(e?.name === 'NotAllowedError' ? '没有获得相机权限。请允许相机后再试。' : '相机没有打开。可以检查浏览器相机权限后再试。');
    }
  }

  async function flip() {
    if (timerRunning) return;
    facing = facing === 'environment' ? 'user' : 'environment';
    await startCamera(cameraOrigin);
  }

  async function cycleZoom() {
    if (!stream || zoomSteps.length < 2 || timerRunning) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    zoomIndex = (zoomIndex + 1) % zoomSteps.length;
    const value = zoomSteps[zoomIndex];
    try {
      await track.applyConstraints({ advanced: [{ zoom: value }] });
      zoomValue.textContent = `${value}×`;
    } catch {
      zoomBtn.hidden = true;
    }
  }

  function sourceCrop(videoWidth, videoHeight, ratio) {
    if (videoWidth / videoHeight > ratio) {
      const sh = videoHeight;
      const sw = sh * ratio;
      return { sx: (videoWidth - sw) / 2, sy: 0, sw, sh };
    }
    const sw = videoWidth;
    const sh = sw / ratio;
    return { sx: 0, sy: (videoHeight - sh) / 2, sw, sh };
  }

  async function runCountdown() {
    const token = ++countdownToken;
    timerRunning = true;
    shutter.disabled = true;
    try {
      for (const value of [3, 2, 1]) {
        if (token !== countdownToken || camera.hidden) return false;
        countdown.textContent = String(value);
        countdown.hidden = false;
        await sleep(760);
      }
      if (token !== countdownToken || camera.hidden) return false;
      countdown.hidden = true;
      await sleep(120);
      return token === countdownToken && !camera.hidden;
    } finally {
      countdown.hidden = true;
      timerRunning = false;
      shutter.disabled = false;
    }
  }

  async function captureNow() {
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (!videoWidth || !videoHeight || !stream) return;
    shutter.disabled = true;
    try {
      const crop = sourceCrop(videoWidth, videoHeight, refRatio);
      const maxSide = 2400;
      const scale = Math.min(1, maxSide / Math.max(crop.sw, crop.sh));
      const width = Math.max(2, Math.round(crop.sw * scale));
      const height = Math.max(2, Math.round(crop.sh * scale));
      captureCanvas.width = width;
      captureCanvas.height = height;
      const ctx = captureCanvas.getContext('2d');
      ctx.save();
      if (facing === 'user') {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
      ctx.restore();
      const blob = await new Promise((resolve) => captureCanvas.toBlob(resolve, 'image/jpeg', 0.95));
      if (!blob) throw new Error('blob');
      capturedBlob = blob;
      safeRevoke(capturedUrl);
      capturedUrl = URL.createObjectURL(blob);
      afterImage.src = capturedUrl;
      captureFacing = facing;
      compare.classList.toggle('front', captureFacing === 'user');
      stopCamera();
      camera.hidden = true;
      review.hidden = false;
      intro.hidden = true;
      document.body.style.overflow = 'hidden';
      compareSlider.value = '50';
      savePhoto.classList.remove('done');
      saveCompare.classList.remove('done');
      saveLabel.textContent = '保存新照片';
      saveCompareLabel.textContent = '保存对比图';
      stopBlink();
      requestAnimationFrame(layoutCompare);
    } catch {
      showError('这次拍摄没有成功，请重拍。');
    } finally {
      shutter.disabled = false;
    }
  }

  async function takePhoto() {
    if (timerRunning) return;
    if (timerEnabled) {
      const ready = await runCountdown();
      if (!ready) return;
    }
    await captureNow();
  }

  function startBlink() {
    if (!capturedUrl) return;
    if (blinkTimer) {
      stopBlink();
      return;
    }
    compare.classList.add('blink-mode');
    compare.classList.remove('show-after');
    blinkBtn.setAttribute('aria-pressed', 'true');
    blinkBtn.textContent = '停止闪看';
    let showAfter = false;
    blinkTimer = setInterval(() => {
      showAfter = !showAfter;
      compare.classList.toggle('show-after', showAfter);
    }, 430);
  }

  function imageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image'));
      image.src = url;
    });
  }

  async function deliverBlob(blob, name) {
    const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function fileStamp(prefix) {
    return `${prefix}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
  }

  async function saveNewPhoto() {
    if (!capturedBlob) return;
    try {
      await deliverBlob(capturedBlob, fileStamp('同角度拍'));
      savePhoto.classList.add('done');
      saveLabel.textContent = '已保存';
      setTimeout(() => {
        savePhoto.classList.remove('done');
        saveLabel.textContent = '保存新照片';
      }, 1400);
    } catch {}
  }

  async function makeCompareBlob() {
    if (!refUrl || !capturedUrl) return null;
    const [before, after] = await Promise.all([imageFromUrl(refUrl), imageFromUrl(capturedUrl)]);
    const longSide = 1200;
    let panelWidth;
    let panelHeight;
    if (refRatio >= 1) {
      panelWidth = longSide;
      panelHeight = Math.max(2, Math.round(longSide / refRatio));
    } else {
      panelHeight = longSide;
      panelWidth = Math.max(2, Math.round(longSide * refRatio));
    }
    const canvas = document.createElement('canvas');
    canvas.width = panelWidth * 2 + 2;
    canvas.height = panelHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f1efe7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (captureFacing === 'user') {
      ctx.translate(panelWidth, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(before, 0, 0, panelWidth, panelHeight);
    } else {
      ctx.drawImage(before, 0, 0, panelWidth, panelHeight);
    }
    ctx.restore();
    ctx.drawImage(after, panelWidth + 2, 0, panelWidth, panelHeight);
    ctx.fillStyle = '#f1efe7';
    ctx.fillRect(panelWidth, 0, 2, panelHeight);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  }

  async function saveCompareImage() {
    if (!capturedBlob) return;
    saveCompare.disabled = true;
    try {
      const blob = await makeCompareBlob();
      if (!blob) return;
      await deliverBlob(blob, fileStamp('同角度对比'));
      saveCompare.classList.add('done');
      saveCompareLabel.textContent = '已保存';
      setTimeout(() => {
        saveCompare.classList.remove('done');
        saveCompareLabel.textContent = '保存对比图';
      }, 1400);
    } catch {} finally {
      saveCompare.disabled = false;
    }
  }

  async function rememberCurrentReference() {
    if (!refBlob) return;
    try {
      await dbPut({ blob: refBlob, name: refName || '参考照片', savedAt: Date.now() });
      refFromSaved = true;
      rememberRef.classList.add('done');
      rememberRef.textContent = '已保存为常用参考';
      await refreshSavedReference();
    } catch {
      rememberRef.textContent = '这个浏览器没有保存成功';
      setTimeout(() => { rememberRef.textContent = '保存为常用参考'; }, 1700);
    }
  }

  async function useStoredReference() {
    try {
      const saved = await dbGet();
      if (!saved?.blob) {
        await refreshSavedReference();
        return;
      }
      await chooseReference(saved.blob, saved.name || '常用参考', true);
    } catch {
      showError('常用参考没有读取成功，可以重新选择照片。');
    }
  }

  async function forgetStoredReference() {
    try { await dbDelete(); } catch {}
    savedReference.hidden = true;
    if (refFromSaved) {
      refFromSaved = false;
      rememberRef.classList.remove('done');
      rememberRef.textContent = '保存为常用参考';
    }
  }

  function cancelCameraView() {
    if (cameraOrigin === 'review' && capturedUrl) {
      stopCamera();
      camera.hidden = true;
      review.hidden = false;
      intro.hidden = true;
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(layoutCompare);
      return;
    }
    clearSession();
    camera.hidden = true;
    review.hidden = true;
    intro.hidden = false;
    document.body.style.overflow = '';
  }

  referenceInput.onchange = () => {
    const file = referenceInput.files?.[0];
    if (file) chooseReference(file, file.name || '参考照片', false);
  };
  useSavedRef.onclick = useStoredReference;
  forgetSavedRef.onclick = forgetStoredReference;
  closeCamera.onclick = cancelCameraView;
  flipCamera.onclick = flip;
  referenceBtn.onclick = () => {
    if (timerRunning) return;
    referenceModeIndex = (referenceModeIndex + 1) % referenceModes.length;
    applyReferenceMode();
  };
  zoomBtn.onclick = cycleZoom;
  timerBtn.onclick = () => {
    if (!timerRunning) setTimer(!timerEnabled);
  };
  captureFrame.addEventListener('pointerdown', (event) => {
    if (timerRunning) return;
    captureFrame.classList.add('hold');
    try { captureFrame.setPointerCapture(event.pointerId); } catch {}
  });
  ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave'].forEach((type) => {
    captureFrame.addEventListener(type, () => captureFrame.classList.remove('hold'));
  });
  shutter.onclick = takePhoto;
  retake.onclick = () => { stopBlink(); startCamera('review'); };
  changeReference.onclick = () => { stopBlink(); referenceInput.click(); };
  compareSlider.oninput = updateCompare;
  blinkBtn.onclick = startBlink;
  rememberRef.onclick = rememberCurrentReference;
  savePhoto.onclick = saveNewPhoto;
  saveCompare.onclick = saveCompareImage;

  window.addEventListener('resize', () => { layoutFrame(); layoutCompare(); });
  window.visualViewport?.addEventListener('resize', () => { layoutFrame(); layoutCompare(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { layoutFrame(); layoutCompare(); }, 120));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopBlink();
  });
  window.addEventListener('pagehide', () => { stopCamera(); stopBlink(); });

  applyReferenceMode();
  setTimer(false);
  refreshSavedReference();
})();