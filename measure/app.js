(() => {
  const $ = (s) => document.querySelector(s);
  const intro = $('#intro');
  const work = $('#work');
  const resetAll = $('#resetAll');
  const cameraInput = $('#cameraInput');
  const fileInput = $('#fileInput');
  const introError = $('#introError');
  const photo = $('#photo');
  const photoStage = $('#photoStage');
  const vectorLayer = $('#vectorLayer');
  const referencePolygon = $('#referencePolygon');
  const measurementLines = $('#measurementLines');
  const markerLayer = $('#markerLayer');
  const labelLayer = $('#labelLayer');
  const stepLabel = $('#stepLabel');
  const stepTitle = $('#stepTitle');
  const stepMeta = $('#stepMeta');
  const rotateRef = $('#rotateRef');
  const recalibrate = $('#recalibrate');
  const undo = $('#undo');
  const readoutLabel = $('#readoutLabel');
  const readoutValue = $('#readoutValue');
  const readoutSub = $('#readoutSub');
  const save = $('#save');
  const saveLabel = $('#saveLabel');
  const workNote = $('#workNote');

  const refs = {
    card: { long: 85.60, short: 53.98, title: '银行卡尺寸' },
    a4: { long: 297, short: 210, title: 'A4 纸' },
  };

  let refKey = 'card';
  let photoUrl = '';
  let naturalWidth = 0;
  let naturalHeight = 0;
  let calibration = [];
  let homography = null;
  let swapped = false;
  let pending = null;
  let measurements = [];

  const ns = 'http://www.w3.org/2000/svg';

  function showIntroError(text) {
    introError.hidden = false;
    introError.textContent = text;
  }

  function clearIntroError() {
    introError.hidden = true;
    introError.textContent = '';
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function sortQuad(points) {
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    const ordered = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    let start = 0;
    let best = Infinity;
    ordered.forEach((p, i) => {
      const score = p.x + p.y;
      if (score < best) { best = score; start = i; }
    });
    return ordered.slice(start).concat(ordered.slice(0, start));
  }

  function solveLinear(matrix, values) {
    const n = values.length;
    const a = matrix.map((row, i) => [...row, values[i]]);
    for (let col = 0; col < n; col += 1) {
      let pivot = col;
      for (let row = col + 1; row < n; row += 1) {
        if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
      }
      if (Math.abs(a[pivot][col]) < 1e-10) return null;
      [a[col], a[pivot]] = [a[pivot], a[col]];
      const divisor = a[col][col];
      for (let j = col; j <= n; j += 1) a[col][j] /= divisor;
      for (let row = 0; row < n; row += 1) {
        if (row === col) continue;
        const factor = a[row][col];
        for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
      }
    }
    return a.map((row) => row[n]);
  }

  function buildHomography(src, dst) {
    const matrix = [];
    const values = [];
    for (let i = 0; i < 4; i += 1) {
      const { x, y } = src[i];
      const { x: u, y: v } = dst[i];
      matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); values.push(u);
      matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]); values.push(v);
    }
    const h = solveLinear(matrix, values);
    return h ? [...h, 1] : null;
  }

  function transformPoint(point) {
    if (!homography) return null;
    const h = homography;
    const d = h[6] * point.x + h[7] * point.y + h[8];
    if (Math.abs(d) < 1e-9) return null;
    return {
      x: (h[0] * point.x + h[1] * point.y + h[2]) / d,
      y: (h[3] * point.x + h[4] * point.y + h[5]) / d,
    };
  }

  function measurementMm(a, b) {
    const pa = transformPoint(a);
    const pb = transformPoint(b);
    return pa && pb ? Math.hypot(pa.x - pb.x, pa.y - pb.y) : NaN;
  }

  function calibrate() {
    if (calibration.length !== 4) return false;
    calibration = sortQuad(calibration);
    const ref = refs[refKey];
    const firstSide = dist(calibration[0], calibration[1]);
    const secondSide = dist(calibration[1], calibration[2]);
    const longFirst = (firstSide >= secondSide) !== swapped;
    const width = longFirst ? ref.long : ref.short;
    const height = longFirst ? ref.short : ref.long;
    homography = buildHomography(calibration, [
      { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height },
    ]);
    if (!homography) return false;
    measurements = measurements.map((m) => ({ ...m, mm: measurementMm(m.a, m.b) }));
    return true;
  }

  function formatDistance(mm) {
    if (!Number.isFinite(mm)) return '—';
    if (mm < 10) return `${mm.toFixed(1)} mm`;
    if (mm < 1000) return `${(mm / 10).toFixed(1)} cm`;
    return `${(mm / 1000).toFixed(2)} m`;
  }

  function mapPointer(event) {
    const rect = photoStage.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    return { x: x / rect.width * naturalWidth, y: y / rect.height * naturalHeight };
  }

  function addMarker(point, extra = '') {
    const node = document.createElement('i');
    node.className = `marker ${extra}`.trim();
    node.style.left = `${point.x / naturalWidth * 100}%`;
    node.style.top = `${point.y / naturalHeight * 100}%`;
    markerLayer.appendChild(node);
  }

  function render() {
    referencePolygon.setAttribute('points', calibration.map((p) => `${p.x},${p.y}`).join(' '));
    measurementLines.replaceChildren();
    markerLayer.replaceChildren();
    labelLayer.replaceChildren();

    calibration.forEach((p) => addMarker(p));
    measurements.forEach((m) => {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', m.a.x); line.setAttribute('y1', m.a.y);
      line.setAttribute('x2', m.b.x); line.setAttribute('y2', m.b.y);
      measurementLines.appendChild(line);
      addMarker(m.a); addMarker(m.b);
      const label = document.createElement('span');
      label.className = 'measure-label';
      label.textContent = formatDistance(m.mm);
      label.style.left = `${((m.a.x + m.b.x) / 2) / naturalWidth * 100}%`;
      label.style.top = `${((m.a.y + m.b.y) / 2) / naturalHeight * 100}%`;
      labelLayer.appendChild(label);
    });
    if (pending) addMarker(pending, 'pending');

    if (!homography) {
      stepLabel.textContent = '校准参考';
      stepTitle.textContent = `点出${refs[refKey].title}的四个角`;
      stepMeta.textContent = `${calibration.length} / 4`;
      readoutLabel.textContent = '参考尚未校准';
      readoutValue.textContent = '—';
      readoutSub.textContent = '四个角不需要按顺序。';
      rotateRef.hidden = true;
      recalibrate.hidden = calibration.length === 0;
    } else {
      stepLabel.textContent = '开始测量';
      stepTitle.textContent = pending ? '再点一下终点' : '点两下，量一段';
      stepMeta.textContent = `${measurements.length} 处测量`;
      const latest = measurements[measurements.length - 1];
      readoutLabel.textContent = latest ? '最近一处' : '参考已校准';
      readoutValue.textContent = latest ? formatDistance(latest.mm) : '可以量了';
      readoutSub.textContent = latest ? `${latest.mm.toFixed(1)} mm` : '继续在照片上点两个位置。';
      rotateRef.hidden = false;
      recalibrate.hidden = false;
    }
    undo.disabled = !pending && measurements.length === 0 && calibration.length === 0;
    save.disabled = measurements.length === 0;
  }

  function resetCalibration() {
    calibration = [];
    homography = null;
    pending = null;
    measurements = [];
    swapped = false;
    render();
  }

  async function openImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    clearIntroError();
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = url;
      naturalWidth = image.naturalWidth;
      naturalHeight = image.naturalHeight;
      photo.src = photoUrl;
      vectorLayer.setAttribute('viewBox', `0 0 ${naturalWidth} ${naturalHeight}`);
      intro.hidden = true;
      work.hidden = false;
      resetAll.hidden = false;
      resetCalibration();
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    image.onerror = () => { URL.revokeObjectURL(url); showIntroError('这张照片没有成功打开。请换一张常见格式的照片。'); };
    image.src = url;
  }

  photoStage.addEventListener('pointerdown', (event) => {
    if (!naturalWidth || !naturalHeight) return;
    const point = mapPointer(event);
    if (!homography) {
      if (calibration.length < 4) calibration.push(point);
      if (calibration.length === 4 && !calibrate()) {
        calibration.pop();
        workNote.textContent = '这四个点没有成功建立参考平面，请重新点最后一个角。';
      } else {
        workNote.textContent = '只需要参考物的外框，卡面内容不参与计算。';
      }
      render();
      return;
    }
    if (!pending) {
      pending = point;
    } else {
      const mm = measurementMm(pending, point);
      if (Number.isFinite(mm)) measurements.push({ a: pending, b: point, mm });
      pending = null;
    }
    render();
  });

  undo.onclick = () => {
    if (pending) pending = null;
    else if (measurements.length) measurements.pop();
    else if (calibration.length) {
      homography = null;
      calibration.pop();
    }
    render();
  };

  recalibrate.onclick = resetCalibration;
  rotateRef.onclick = () => {
    if (!homography) return;
    swapped = !swapped;
    calibrate();
    render();
  };

  document.querySelectorAll('[data-ref]').forEach((button) => {
    button.onclick = () => {
      refKey = button.dataset.ref;
      document.querySelectorAll('[data-ref]').forEach((b) => b.classList.toggle('active', b === button));
      if (!work.hidden) resetCalibration();
    };
  });

  function fileStamp() {
    return `照片量尺-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
  }

  async function deliver(blob) {
    const file = new File([blob], fileStamp(), { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = file.name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1600);
  }

  async function exportAnnotated() {
    if (!measurements.length || !photo.complete) return;
    save.disabled = true;
    try {
      const maxSide = 2600;
      const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
      const width = Math.max(2, Math.round(naturalWidth * scale));
      const height = Math.max(2, Math.round(naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(photo, 0, 0, width, height);
      const lineWidth = Math.max(3, Math.round(Math.max(width, height) / 750));
      const radius = lineWidth * 2;
      const fontSize = Math.max(22, Math.round(Math.max(width, height) / 72));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.font = `700 ${fontSize}px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif`;
      measurements.forEach((m) => {
        const ax = m.a.x * scale, ay = m.a.y * scale, bx = m.b.x * scale, by = m.b.y * scale;
        ctx.strokeStyle = '#ff5a36'; ctx.lineWidth = lineWidth;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.fillStyle = '#ff5a36';
        [ [ax, ay], [bx, by] ].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); });
        const text = formatDistance(m.mm);
        const metrics = ctx.measureText(text);
        const padX = fontSize * .42, padY = fontSize * .28;
        let x = (ax + bx) / 2, y = (ay + by) / 2;
        const boxW = metrics.width + padX * 2, boxH = fontSize + padY * 2;
        x = Math.max(boxW / 2 + 4, Math.min(width - boxW / 2 - 4, x));
        y = Math.max(boxH / 2 + 4, Math.min(height - boxH / 2 - 4, y));
        ctx.fillStyle = '#11120f'; ctx.fillRect(x - boxW / 2, y - boxH / 2, boxW, boxH);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1);
      });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .95));
      if (!blob) throw new Error('blob');
      await deliver(blob);
      save.classList.add('done'); saveLabel.textContent = '已保存';
      setTimeout(() => { save.classList.remove('done'); saveLabel.textContent = '保存标注图'; }, 1400);
    } catch {} finally { save.disabled = false; }
  }

  function resetTool() {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = ''; naturalWidth = 0; naturalHeight = 0;
    calibration = []; homography = null; pending = null; measurements = []; swapped = false;
    photo.removeAttribute('src'); cameraInput.value = ''; fileInput.value = '';
    work.hidden = true; intro.hidden = false; resetAll.hidden = true;
    clearIntroError(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cameraInput.onchange = () => { const file = cameraInput.files?.[0]; if (file) openImage(file); };
  fileInput.onchange = () => { const file = fileInput.files?.[0]; if (file) openImage(file); };
  resetAll.onclick = resetTool;
  save.onclick = exportAnnotated;
})();