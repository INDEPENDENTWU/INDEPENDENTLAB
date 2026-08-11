(() => {
  const $ = (s) => document.querySelector(s);
  const camera = $('#camera');
  const review = $('#review');
  const captureFrame = $('#captureFrame');
  const referenceBtn = $('#referenceBtn');
  const referenceModeValue = $('#referenceModeValue');
  const mirrorRefBtn = $('#mirrorRefBtn');
  const mirrorRefValue = $('#mirrorRefValue');
  const timerBtn = $('#timerBtn');
  const zoomBtn = $('#zoomBtn');
  const zoomValue = $('#zoomValue');
  const flipCamera = $('#flipCamera');
  const shutter = $('#shutter');
  const compare = $('#compare');
  const beforeImage = $('#beforeImage');
  const afterImage = $('#afterImage');
  const saveCompare = $('#saveCompare');
  const saveCompareLabel = $('#saveCompareLabel');
  const rememberRef = $('#rememberRef');
  const useSavedRef = $('#useSavedRef');
  const forgetSavedRef = $('#forgetSavedRef');
  const referenceInput = $('#referenceInput');

  const PRESET_KEY = 'same-angle-preset-v3';
  const modes = [
    { kind: 'opacity', alpha: 0.45, label: '45%' },
    { kind: 'outline', label: '轮廓' },
    { kind: 'difference', label: '差值' },
    { kind: 'opacity', alpha: 0.65, label: '65%' },
    { kind: 'opacity', alpha: 0.28, label: '28%' },
  ];

  let modeIndex = 0;
  let refMirrored = false;
  let capturedRefMirrored = false;
  let wakeLock = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function applyMode() {
    const mode = modes[modeIndex] || modes[0];
    captureFrame.classList.toggle('outline-mode', mode.kind === 'outline');
    captureFrame.classList.toggle('difference-mode', mode.kind === 'difference');
    captureFrame.style.setProperty('--ghost', String(mode.alpha ?? 0.45));
    referenceModeValue.textContent = mode.label;
  }

  function applyMirror() {
    captureFrame.classList.toggle('ref-mirrored', refMirrored);
    mirrorRefBtn?.setAttribute('aria-pressed', refMirrored ? 'true' : 'false');
    if (mirrorRefValue) mirrorRefValue.textContent = refMirrored ? '开' : '关';
  }

  function syncReviewMirror() {
    compare.classList.toggle('ref-mirrored', capturedRefMirrored);
  }

  referenceBtn.onclick = () => {
    if (shutter.disabled) return;
    modeIndex = (modeIndex + 1) % modes.length;
    applyMode();
  };

  if (mirrorRefBtn) {
    mirrorRefBtn.onclick = () => {
      if (shutter.disabled) return;
      refMirrored = !refMirrored;
      applyMirror();
    };
  }

  shutter.addEventListener('click', () => {
    capturedRefMirrored = refMirrored;
  }, true);

  const reviewObserver = new MutationObserver(() => {
    if (!review.hidden) syncReviewMirror();
  });
  reviewObserver.observe(review, { attributes: true, attributeFilter: ['hidden'] });

  referenceInput.addEventListener('change', () => {
    modeIndex = 0;
    refMirrored = false;
    applyMode();
    applyMirror();
  }, true);

  function readPreset() {
    try {
      return JSON.parse(localStorage.getItem(PRESET_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function writePreset() {
    const preset = {
      facing: captureFrame.classList.contains('front') ? 'user' : 'environment',
      referenceMirrored: refMirrored,
      modeIndex,
      timer: timerBtn?.getAttribute('aria-pressed') === 'true',
      zoom: !zoomBtn?.hidden ? zoomValue?.textContent || '' : '',
    };
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(preset)); } catch {}
  }

  async function restorePreset() {
    const preset = readPreset();
    if (!preset || camera.hidden) return;

    modeIndex = Number.isInteger(preset.modeIndex)
      ? Math.max(0, Math.min(modes.length - 1, preset.modeIndex))
      : 0;
    refMirrored = Boolean(preset.referenceMirrored);
    applyMode();
    applyMirror();

    const wantsFront = preset.facing === 'user';
    const isFront = captureFrame.classList.contains('front');
    if (wantsFront !== isFront && typeof flipCamera.onclick === 'function') {
      try { await flipCamera.onclick.call(flipCamera); } catch {}
      await sleep(80);
    }

    const timerOn = timerBtn?.getAttribute('aria-pressed') === 'true';
    if (Boolean(preset.timer) !== timerOn) timerBtn?.click();

    if (preset.zoom) {
      for (let i = 0; i < 8; i += 1) {
        if (zoomBtn?.hidden || zoomValue?.textContent === preset.zoom) break;
        if (typeof zoomBtn.onclick !== 'function') break;
        try { await zoomBtn.onclick.call(zoomBtn); } catch { break; }
        await sleep(40);
      }
    }
  }

  if (rememberRef) {
    const originalRemember = rememberRef.onclick;
    rememberRef.onclick = async function (event) {
      if (typeof originalRemember === 'function') {
        await originalRemember.call(this, event);
      }
      writePreset();
    };
  }

  if (useSavedRef) {
    const originalUse = useSavedRef.onclick;
    useSavedRef.onclick = async function (event) {
      if (typeof originalUse === 'function') {
        await originalUse.call(this, event);
      }
      await sleep(50);
      await restorePreset();
    };
  }

  if (forgetSavedRef) {
    const originalForget = forgetSavedRef.onclick;
    forgetSavedRef.onclick = async function (event) {
      if (typeof originalForget === 'function') {
        await originalForget.call(this, event);
      }
      try { localStorage.removeItem(PRESET_KEY); } catch {}
    };
  }

  function imageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  }

  async function deliver(blob, name) {
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

  async function makeCorrectedCompare() {
    if (!beforeImage.src || !afterImage.src) return null;
    const [before, after] = await Promise.all([
      imageFromUrl(beforeImage.src),
      imageFromUrl(afterImage.src),
    ]);
    const ratio = before.naturalWidth / Math.max(1, before.naturalHeight);
    const longSide = 1200;
    let panelWidth;
    let panelHeight;
    if (ratio >= 1) {
      panelWidth = longSide;
      panelHeight = Math.max(2, Math.round(longSide / ratio));
    } else {
      panelHeight = longSide;
      panelWidth = Math.max(2, Math.round(longSide * ratio));
    }
    const canvas = document.createElement('canvas');
    canvas.width = panelWidth * 2 + 2;
    canvas.height = panelHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f1efe7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (capturedRefMirrored) {
      ctx.translate(panelWidth, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(before, 0, 0, panelWidth, panelHeight);
    ctx.restore();
    ctx.drawImage(after, panelWidth + 2, 0, panelWidth, panelHeight);
    ctx.fillStyle = '#f1efe7';
    ctx.fillRect(panelWidth, 0, 2, panelHeight);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  }

  if (saveCompare) {
    saveCompare.onclick = async () => {
      saveCompare.disabled = true;
      try {
        const blob = await makeCorrectedCompare();
        if (!blob) return;
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        await deliver(blob, `同角度对比-${stamp}.jpg`);
        saveCompare.classList.add('done');
        saveCompareLabel.textContent = '已保存';
        setTimeout(() => {
          saveCompare.classList.remove('done');
          saveCompareLabel.textContent = '保存对比图';
        }, 1400);
      } catch {} finally {
        saveCompare.disabled = false;
      }
    };
  }

  async function requestWake() {
    if (camera.hidden || document.hidden || !navigator.wakeLock?.request || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => { wakeLock = null; }, { once: true });
    } catch {}
  }

  async function releaseWake() {
    const lock = wakeLock;
    wakeLock = null;
    if (!lock) return;
    try { await lock.release(); } catch {}
  }

  async function syncWake() {
    if (!camera.hidden && !document.hidden) await requestWake();
    else await releaseWake();
  }

  const cameraObserver = new MutationObserver(syncWake);
  cameraObserver.observe(camera, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', syncWake);
  window.addEventListener('pagehide', releaseWake);

  applyMode();
  applyMirror();
  syncWake();
})();