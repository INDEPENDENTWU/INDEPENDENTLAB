(() => {
  const $ = (s) => document.querySelector(s);
  const intro = $('#intro');
  const scanner = $('#scanner');
  const result = $('#result');
  const again = $('#again');
  const cameraBtn = $('#cameraBtn');
  const photoInput = $('#photoInput');
  const cancelCamera = $('#cancelCamera');
  const scanState = $('#scanState');
  const video = $('#video');
  const analysis = $('#analysisCanvas');
  const specimen = $('#specimenCanvas');
  const kind = $('#kind');
  const headline = $('#headline');
  const facts = $('#facts');
  const rawValue = $('#rawValue');
  const copyBtn = $('#copyBtn');
  const copyLabel = $('#copyLabel');
  const openBtn = $('#openBtn');
  const error = $('#error');

  let stream = null;
  let raf = 0;
  let lastScan = 0;
  let scanStarted = 0;
  let hintStage = 0;
  let copyValue = '';
  let nativeDetector = null;
  let decoderPromise = null;

  const decoderFn = () =>
    typeof window.jsQR === 'function'
      ? window.jsQR
      : typeof window.jsQR?.default === 'function'
        ? window.jsQR.default
        : null;

  function setBusy(value) {
    document.body.classList.toggle('busy', value);
  }

  function showError(text) {
    error.hidden = false;
    error.textContent = text;
  }

  function clearError() {
    error.hidden = true;
    error.textContent = '';
  }

  function loadScript(src, timeout = 4200) {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (!ok) script.remove();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeout);
      script.src = src;
      script.async = true;
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      document.head.appendChild(script);
    });
  }

  async function ensureDecoder() {
    if (decoderFn() || nativeDetector) return true;
    if (decoderPromise) return decoderPromise;

    decoderPromise = (async () => {
      if ('BarcodeDetector' in window) {
        try {
          nativeDetector = new BarcodeDetector({ formats: ['qr_code'] });
          return true;
        } catch {}
      }

      const sources = [
        'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
        'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
      ];
      for (const src of sources) {
        const loaded = await loadScript(src);
        if (loaded && decoderFn()) return true;
      }
      return false;
    })();

    return decoderPromise;
  }

  function codePoints(code) {
    const l = code?.location;
    if (!l) return null;
    return [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner].filter(Boolean);
  }

  async function decodeCanvas(canvas) {
    const fn = decoderFn();
    if (fn) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = fn(image.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
      return code ? { data: code.data, points: codePoints(code) } : null;
    }

    if (nativeDetector) {
      try {
        const found = await nativeDetector.detect(canvas);
        const code = found?.[0];
        if (code) {
          return {
            data: code.rawValue || '',
            points: (code.cornerPoints || []).map((p) => ({ x: p.x, y: p.y })),
          };
        }
      } catch {}
    }
    return null;
  }

  function stopCamera() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.srcObject = null;
  }

  function leaveCamera() {
    stopCamera();
    scanner.hidden = true;
    document.body.classList.remove('camera-open');
  }

  function resetView() {
    leaveCamera();
    intro.hidden = false;
    result.hidden = true;
    again.hidden = true;
    copyValue = '';
    openBtn.hidden = true;
    copyBtn.classList.remove('done');
    copyLabel.textContent = '复制内容';
    facts.replaceChildren();
    clearError();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function captureFinder() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return false;

    const side = Math.max(2, Math.round(Math.min(vw, vh) * 0.72));
    const sx = Math.round((vw - side) / 2);
    const sy = Math.round((vh - side) / 2);
    const out = Math.min(820, side);

    analysis.width = out;
    analysis.height = out;
    analysis
      .getContext('2d', { willReadFrequently: true })
      .drawImage(video, sx, sy, side, side, 0, 0, out, out);
    return true;
  }

  function updateScanHint(now) {
    const elapsed = now - scanStarted;
    if (elapsed > 7800 && hintStage < 2) {
      hintStage = 2;
      scanState.textContent = '换个角度，让二维码更清楚。';
    } else if (elapsed > 3800 && hintStage < 1) {
      hintStage = 1;
      scanState.textContent = '靠近一点，保持二维码完整。';
    }
  }

  async function scanLoop(ts) {
    if (!stream) return;
    updateScanHint(ts);

    if (ts - lastScan > 135 && captureFinder()) {
      lastScan = ts;
      const code = await decodeCanvas(analysis);
      if (code) {
        await showDecoded(code, analysis);
        return;
      }
    }
    raf = requestAnimationFrame(scanLoop);
  }

  async function startCamera() {
    clearError();
    setBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera');
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1920 },
        },
        audio: false,
      });

      intro.hidden = true;
      result.hidden = true;
      again.hidden = true;
      scanner.hidden = false;
      document.body.classList.add('camera-open');
      video.srcObject = stream;
      await video.play();
      scanState.textContent = '正在准备识别。';

      if (!(await ensureDecoder())) throw new Error('decoder');
      if (!stream) return;
      scanState.textContent = '把二维码完整放进框里。';
      scanStarted = performance.now();
      hintStage = 0;
      lastScan = 0;
      raf = requestAnimationFrame(scanLoop);
    } catch (e) {
      leaveCamera();
      intro.hidden = false;
      if (e?.message === 'decoder') {
        showError('二维码识别组件没有加载成功。换个网络后再试。');
      } else if (e?.name === 'NotAllowedError') {
        showError('没有获得相机权限。也可以直接选择二维码图片。');
      } else {
        showError('相机没有打开。可以直接选择二维码图片。');
      }
    } finally {
      setBusy(false);
    }
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image'));
      };
      img.src = url;
    });
  }

  async function scanImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    clearError();
    setBusy(true);
    leaveCamera();

    try {
      if (!(await ensureDecoder())) throw new Error('decoder');
      const img = await loadImage(file);
      const max = 1800;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      analysis.width = Math.max(2, Math.round(img.naturalWidth * scale));
      analysis.height = Math.max(2, Math.round(img.naturalHeight * scale));
      analysis
        .getContext('2d', { willReadFrequently: true })
        .drawImage(img, 0, 0, analysis.width, analysis.height);

      let code = await decodeCanvas(analysis);
      if (!code && Math.max(analysis.width, analysis.height) > 1050) {
        const tmp = document.createElement('canvas');
        const retryScale = 1050 / Math.max(analysis.width, analysis.height);
        tmp.width = Math.round(analysis.width * retryScale);
        tmp.height = Math.round(analysis.height * retryScale);
        tmp.getContext('2d', { willReadFrequently: true }).drawImage(analysis, 0, 0, tmp.width, tmp.height);
        code = await decodeCanvas(tmp);
        if (code?.points) {
          const back = 1 / retryScale;
          code.points = code.points.map((p) => ({ x: p.x * back, y: p.y * back }));
        }
      }

      if (!code) {
        showError('没有识别到二维码。换一张更清楚、二维码更完整的图片。');
        return;
      }
      await showDecoded(code, analysis);
    } catch (e) {
      showError(e?.message === 'decoder' ? '二维码识别组件没有加载成功。换个网络后再试。' : '这张图片没有成功打开或识别。');
    } finally {
      setBusy(false);
      photoInput.value = '';
    }
  }

  function drawSpecimen(source, pts) {
    const size = 720;
    const ctx = specimen.getContext('2d');
    specimen.width = size;
    specimen.height = size;
    ctx.fillStyle = '#dcdad3';
    ctx.fillRect(0, 0, size, size);

    const scale = Math.min(size / source.width, size / source.height);
    const dw = source.width * scale;
    const dh = source.height * scale;
    const dx = (size - dw) / 2;
    const dy = (size - dh) / 2;
    ctx.drawImage(source, 0, 0, source.width, source.height, dx, dy, dw, dh);

    if (pts?.length >= 4) {
      const p = pts.map((v) => ({ x: dx + v.x * scale, y: dy + v.y * scale }));
      ctx.save();
      ctx.strokeStyle = '#009b86';
      ctx.lineWidth = 7;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = '#009b86';
      for (const q of p) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function addFact(label, value, options = {}) {
    if (value === undefined || value === null || value === '') return;
    const row = document.createElement('div');
    row.className = `fact${options.primary ? ' primary' : ''}`;
    const name = document.createElement('span');
    name.textContent = label;
    const valueNode = document.createElement('strong');
    valueNode.textContent = String(value);
    if (options.warning) valueNode.classList.add('warning');
    row.append(name, valueNode);
    facts.append(row);
  }

  function splitEscaped(text, separator) {
    const out = [];
    let current = '';
    let escaped = false;
    for (const char of text) {
      if (escaped) {
        current += char;
        escaped = false;
      } else if (char === '\\') {
        current += char;
        escaped = true;
      } else if (char === separator) {
        out.push(current);
        current = '';
      } else current += char;
    }
    out.push(current);
    return out;
  }

  const unescapeQR = (text) => text.replace(/\\([\\;,:])/g, '$1');

  function parsePairs(raw, prefix) {
    const out = {};
    const body = raw.replace(prefix, '').replace(/;;$/, '');
    for (const part of splitEscaped(body, ';')) {
      let escaped = false;
      let at = -1;
      for (let i = 0; i < part.length; i++) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (part[i] === '\\') {
          escaped = true;
          continue;
        }
        if (part[i] === ':') {
          at = i;
          break;
        }
      }
      if (at > 0) out[part.slice(0, at).toUpperCase()] = unescapeQR(part.slice(at + 1));
    }
    return out;
  }

  function lineValue(raw, key) {
    const match = raw.match(new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, 'mi'));
    return match ? match[1].trim() : '';
  }

  function classify(raw) {
    const s = raw.trim();

    if (/^https?:\/\//i.test(s)) {
      try {
        const url = new URL(s);
        const paramCount = [...url.searchParams].length;
        return {
          headline: '网址',
          primary: url.hostname,
          copy: s,
          open: { href: s, label: '打开网址' },
          facts: [
            ['协议', url.protocol === 'https:' ? 'HTTPS' : 'HTTP', { warning: url.protocol !== 'https:' }],
            ['路径', `${url.pathname}${url.search}${url.hash}` || '/'],
            ['参数', paramCount ? `${paramCount} 项` : '无'],
          ],
        };
      } catch {}
    }

    if (/^WIFI:/i.test(s)) {
      const wifi = parsePairs(s, /^WIFI:/i);
      const encryption = (wifi.T || '').toUpperCase();
      return {
        headline: 'Wi‑Fi 信息',
        primary: wifi.S || '未命名网络',
        copy: wifi.P || s,
        copyLabel: wifi.P ? '复制密码' : '复制内容',
        facts: [
          ['网络名', wifi.S || ''],
          ['加密', encryption === 'NOPASS' ? '无密码' : encryption || (wifi.P ? '未注明' : '无密码')],
          ['密码', wifi.P || ''],
        ],
      };
    }

    if (/^TEL:/i.test(s)) {
      const number = s.replace(/^TEL:/i, '').trim();
      return { headline: '电话号码', primary: number, copy: number, open: { href: `tel:${number}`, label: '拨号' }, facts: [] };
    }

    if (/^MAILTO:/i.test(s)) {
      try {
        const url = new URL(s);
        const address = decodeURIComponent(url.pathname);
        return {
          headline: '邮件地址',
          primary: address,
          copy: address,
          open: { href: s, label: '写邮件' },
          facts: [['主题', url.searchParams.get('subject') || ''], ['正文', url.searchParams.get('body') || '']],
        };
      } catch {}
    }

    if (/^(SMSTO:|SMS:)/i.test(s)) {
      const body = s.replace(/^(SMSTO:|SMS:)/i, '');
      const parts = body.split(':');
      const number = parts.shift() || '';
      return { headline: '短信', primary: number, copy: s, open: { href: s, label: '发短信' }, facts: [['内容', parts.join(':')]] };
    }

    if (/^GEO:/i.test(s)) {
      const coordinate = s.replace(/^GEO:/i, '').split('?')[0];
      return { headline: '地理坐标', primary: coordinate, copy: coordinate, facts: [] };
    }

    if (/^MECARD:/i.test(s)) {
      const card = parsePairs(s, /^MECARD:/i);
      return {
        headline: '联系人',
        primary: card.N || '联系人信息',
        copy: s,
        facts: [['电话', card.TEL || ''], ['邮箱', card.EMAIL || ''], ['地址', card.ADR || '']],
      };
    }

    if (/^BEGIN:VCARD/i.test(s)) {
      return {
        headline: '联系人',
        primary: lineValue(s, 'FN') || lineValue(s, 'N') || '联系人信息',
        copy: s,
        facts: [['电话', lineValue(s, 'TEL')], ['邮箱', lineValue(s, 'EMAIL')], ['组织', lineValue(s, 'ORG')]],
      };
    }

    if (/^BEGIN:VEVENT/i.test(s)) {
      return {
        headline: '日历事件',
        primary: lineValue(s, 'SUMMARY') || '日历事件',
        copy: s,
        facts: [['时间', lineValue(s, 'DTSTART')], ['地点', lineValue(s, 'LOCATION')], ['说明', lineValue(s, 'DESCRIPTION')]],
      };
    }

    if (/^OTPAUTH:\/\//i.test(s)) {
      try {
        const url = new URL(s);
        return {
          headline: '一次性验证码配置',
          primary: decodeURIComponent(url.pathname.replace(/^\//, '')) || '账户',
          copy: s,
          facts: [['服务', url.searchParams.get('issuer') || ''], ['算法', url.searchParams.get('algorithm') || '默认'], ['位数', url.searchParams.get('digits') || '默认']],
        };
      } catch {}
    }

    return {
      headline: '普通文本',
      primary: s.length <= 54 ? s : '文本内容',
      copy: s,
      facts: s.length <= 54 ? [] : [['内容', s]],
    };
  }

  async function showDecoded(code, source) {
    const raw = (code.data || '').trim();
    if (!raw) {
      showError('二维码里没有读到可以显示的内容。');
      return;
    }

    const info = classify(raw);
    leaveCamera();
    intro.hidden = true;
    result.hidden = false;
    again.hidden = false;
    clearError();
    drawSpecimen(source, code.points);

    kind.textContent = '06 / 已识别';
    headline.textContent = info.headline;
    facts.replaceChildren();
    addFact('', info.primary, { primary: true });
    for (const fact of info.facts || []) addFact(fact[0], fact[1], fact[2] || {});
    rawValue.textContent = raw;
    copyValue = info.copy || raw;
    copyLabel.textContent = info.copyLabel || '复制内容';
    copyBtn.classList.remove('done');

    if (info.open) {
      openBtn.hidden = false;
      openBtn.href = info.open.href;
      openBtn.textContent = info.open.label;
    } else {
      openBtn.hidden = true;
      openBtn.removeAttribute('href');
    }

    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async function copyCurrent() {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
    } catch {
      const t = document.createElement('textarea');
      t.value = copyValue;
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.append(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    const old = copyLabel.textContent;
    copyBtn.classList.add('done');
    copyLabel.textContent = '已复制';
    setTimeout(() => {
      copyBtn.classList.remove('done');
      copyLabel.textContent = old;
    }, 1400);
  }

  cameraBtn.onclick = startCamera;
  cancelCamera.onclick = () => {
    leaveCamera();
    intro.hidden = false;
  };
  photoInput.onchange = () => photoInput.files?.[0] && scanImage(photoInput.files[0]);
  again.onclick = resetView;
  copyBtn.onclick = copyCurrent;

  document.addEventListener('paste', (event) => {
    const file = [...(event.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) scanImage(file);
  });
  window.addEventListener('pagehide', leaveCamera);
})();