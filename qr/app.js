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
  let copyValue = '';
  let nativeDetector = null;
  let decoderPromise = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
      let finished = false;
      const done = (ok) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (!ok) script.remove();
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), timeout);
      script.src = src;
      script.async = true;
      script.onload = () => done(true);
      script.onerror = () => done(false);
      document.head.appendChild(script);
    });
  }

  async function ensureDecoder() {
    if (decoderFn()) return true;
    if (decoderPromise) return decoderPromise;

    decoderPromise = (async () => {
      const sources = [
        'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
        'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
      ];

      for (const src of sources) {
        const loaded = await loadScript(src);
        if (loaded && decoderFn()) return true;
      }

      if ('BarcodeDetector' in window) {
        try {
          nativeDetector = new BarcodeDetector({ formats: ['qr_code'] });
          return true;
        } catch {}
      }
      return false;
    })();

    return decoderPromise;
  }

  function pointsFrom(code) {
    const loc = code?.location;
    if (!loc) return null;
    return [
      loc.topLeftCorner,
      loc.topRightCorner,
      loc.bottomRightCorner,
      loc.bottomLeftCorner,
    ].filter(Boolean);
  }

  async function decodeCanvas(canvas) {
    const fn = decoderFn();
    if (fn) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = fn(image.data, canvas.width, canvas.height, {
        inversionAttempts: 'attemptBoth',
      });
      return code ? { data: code.data, points: pointsFrom(code) } : null;
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

  function resetView() {
    stopCamera();
    intro.hidden = false;
    scanner.hidden = true;
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

  function fitCanvasFromVideo() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return false;

    const max = 760;
    const scale = Math.min(1, max / Math.max(vw, vh));
    analysis.width = Math.max(2, Math.round(vw * scale));
    analysis.height = Math.max(2, Math.round(vh * scale));
    analysis
      .getContext('2d', { willReadFrequently: true })
      .drawImage(video, 0, 0, analysis.width, analysis.height);
    return true;
  }

  async function scanLoop(ts) {
    if (!stream) return;

    if (ts - lastScan > 125 && fitCanvasFromVideo()) {
      lastScan = ts;
      const code = await decodeCanvas(analysis);
      if (code) {
        stopCamera();
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
      if (!(await ensureDecoder())) throw new Error('decoder');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera');

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      });

      intro.hidden = true;
      result.hidden = true;
      scanner.hidden = false;
      again.hidden = true;
      video.srcObject = stream;
      await video.play();
      scanState.textContent = '把二维码放进框里。';
      lastScan = 0;
      raf = requestAnimationFrame(scanLoop);
    } catch (e) {
      stopCamera();
      if (e?.message === 'decoder') {
        showError('二维码识别组件没有加载成功。换个网络后再试，或者稍后重新打开。');
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
    stopCamera();

    try {
      if (!(await ensureDecoder())) throw new Error('decoder');

      const img = await loadImage(file);
      const max = 1800;
      const scale = Math.min(
        1,
        max / Math.max(img.naturalWidth, img.naturalHeight),
      );

      analysis.width = Math.max(2, Math.round(img.naturalWidth * scale));
      analysis.height = Math.max(2, Math.round(img.naturalHeight * scale));
      const ctx = analysis.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, analysis.width, analysis.height);

      let code = await decodeCanvas(analysis);

      if (!code && Math.max(analysis.width, analysis.height) > 1050) {
        const tmp = document.createElement('canvas');
        const retryScale = 1050 / Math.max(analysis.width, analysis.height);
        tmp.width = Math.round(analysis.width * retryScale);
        tmp.height = Math.round(analysis.height * retryScale);
        tmp
          .getContext('2d', { willReadFrequently: true })
          .drawImage(analysis, 0, 0, tmp.width, tmp.height);

        code = await decodeCanvas(tmp);
        if (code?.points) {
          const back = 1 / retryScale;
          code.points = code.points.map((p) => ({
            x: p.x * back,
            y: p.y * back,
          }));
        }
      }

      if (!code) {
        showError('没有识别到二维码。换一张更清楚、二维码更完整的图片。');
        return;
      }

      await showDecoded(code, analysis);
    } catch (e) {
      if (e?.message === 'decoder') {
        showError('二维码识别组件没有加载成功。换个网络后再试，或者稍后重新打开。');
      } else {
        showError('这张图片没有成功打开或识别。');
      }
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
      const p = pts.map((v) => ({
        x: dx + v.x * scale,
        y: dy + v.y * scale,
      }));
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
    const valueNode = document.createElement(options.href ? 'a' : 'strong');
    valueNode.textContent = String(value);
    if (options.href) valueNode.href = options.href;
    if (options.warning) valueNode.classList.add('warning');
    row.append(name, valueNode);
    facts.append(row);
  }

  function splitEscaped(text, sep) {
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
      } else if (char === sep) {
        out.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    out.push(current);
    return out;
  }

  const unescapeQR = (text) => text.replace(/\\([\\;,:])/g, '$1');

  function parseWifi(raw) {
    const body = raw.slice(5);
    const out = {};

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
      if (at > 0) {
        out[part.slice(0, at)] = unescapeQR(part.slice(at + 1));
      }
    }
    return out;
  }

  function lineValue(raw, key) {
    const re = new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, 'mi');
    const match = raw.match(re);
    return match ? match[1].trim() : '';
  }

  function parseMecard(raw) {
    const out = {};
    const body = raw.replace(/^MECARD:/i, '').replace(/;;$/, '');
    for (const part of splitEscaped(body, ';')) {
      const at = part.indexOf(':');
      if (at > 0) out[part.slice(0, at).toUpperCase()] = unescapeQR(part.slice(at + 1));
    }
    return out;
  }

  function classify(raw) {
    const s = raw.trim();

    if (/^https?:\/\//i.test(s)) {
      try {
        const url = new URL(s);
        const params = [...url.searchParams.keys()];
        return {
          headline: '网址',
          primary: url.hostname,
          copy: s,
          open: { href: s, label: '打开网址' },
          facts: [
            ['协议', url.protocol === 'https:' ? 'HTTPS' : 'HTTP', { warning: url.protocol !== 'https:' }],
            ['路径', `${url.pathname}${url.search}${url.hash}` || '/'],
            ['参数', params.length ? `${params.length} 项` : '无'],
          ],
        };
      } catch {}
    }

    if (/^WIFI:/i.test(s)) {
      const wifi = parseWifi(s);
      const encryption = (wifi.T || '').toUpperCase();
      const encryptionLabel = encryption
        ? encryption === 'NOPASS'
          ? '无密码'
          : encryption
        : wifi.P
          ? '未注明'
          : '无密码';

      return {
        headline: 'Wi‑Fi 信息',
        primary: wifi.S || '未命名网络',
        copy: wifi.P || s,
        copyLabel: wifi.P ? '复制密码' : '复制内容',
        facts: [
          ['网络名', wifi.S || ''],
          ['加密', encryptionLabel],
          ['密码', wifi.P || ''],
        ],
      };
    }

    if (/^TEL:/i.test(s)) {
      const number = s.replace(/^TEL:/i, '').trim();
      return {
        headline: '电话号码',
        primary: number,
        copy: number,
        open: { href: `tel:${number}`, label: '拨号' },
        facts: [],
      };
    }

    if (/^MAILTO:/i.test(s)) {
      try {
        const url = new URL(s);
        const mail = decodeURIComponent(url.pathname);
        return {
          headline: '邮件地址',
          primary: mail,
          copy: mail,
          open: { href: s, label: '写邮件' },
          facts: [
            ['主题', url.searchParams.get('subject') || ''],
            ['正文', url.searchParams.get('body') || ''],
          ],
        };
      } catch {}
    }

    if (/^MATMSG:/i.test(s)) {
      return {
        headline: '邮件信息',
        primary: lineValue(s.replace(/^MATMSG:/i, ''), 'TO') || '邮件',
        copy: s,
        facts: [
          ['主题', lineValue(s, 'SUB')],
          ['正文', lineValue(s, 'BODY')],
        ],
      };
    }

    if (/^(SMSTO:|SMS:)/i.test(s)) {
      const body = s.replace(/^(SMSTO:|SMS:)/i, '');
      const parts = body.split(':');
      return {
        headline: '短信',
        primary: parts.shift() || '',
        copy: s,
        open: { href: s, label: '发短信' },
        facts: [['内容', parts.join(':')]],
      };
    }

    if (/^GEO:/i.test(s)) {
      const coord = s.replace(/^GEO:/i, '').split('?')[0];
      return {
        headline: '地理坐标',
        primary: coord,
        copy: coord,
        facts: [],
      };
    }

    if (/^BEGIN:VCARD/i.test(s)) {
      const name = lineValue(s, 'FN') || lineValue(s, 'N');
      return {
        headline: '联系人',
        primary: name || '联系人信息',
        copy: s,
        facts: [
          ['电话', lineValue(s, 'TEL')],
          ['邮箱', lineValue(s, 'EMAIL')],
          ['组织', lineValue(s, 'ORG')],
        ],
      };
    }

    if (/^MECARD:/i.test(s)) {
      const card = parseMecard(s);
      return {
        headline: '联系人',
        primary: card.N || '联系人信息',
        copy: s,
        facts: [
          ['电话', card.TEL || ''],
          ['邮箱', card.EMAIL || ''],
          ['网址', card.URL || ''],
        ],
      };
    }

    if (/^BEGIN:VEVENT/i.test(s)) {
      return {
        headline: '日历事件',
        primary: lineValue(s, 'SUMMARY') || '日历事件',
        copy: s,
        facts: [
          ['时间', lineValue(s, 'DTSTART')],
          ['地点', lineValue(s, 'LOCATION')],
          ['说明', lineValue(s, 'DESCRIPTION')],
        ],
      };
    }

    if (/^OTPAUTH:\/\//i.test(s)) {
      try {
        const url = new URL(s);
        return {
          headline: '一次性验证码配置',
          primary: decodeURIComponent(url.pathname.replace(/^\//, '')) || '账户',
          copy: s,
          facts: [
            ['服务', url.searchParams.get('issuer') || ''],
            ['算法', url.searchParams.get('algorithm') || '默认'],
            ['位数', url.searchParams.get('digits') || '默认'],
          ],
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
    stopCamera();
    const raw = (code.data || '').trim();
    if (!raw) {
      showError('二维码里没有读到可显示的内容。');
      return;
    }

    const info = classify(raw);
    intro.hidden = true;
    scanner.hidden = true;
    result.hidden = false;
    again.hidden = false;
    clearError();

    drawSpecimen(source, code.points);
    kind.textContent = '06 / 已识别';
    headline.textContent = info.headline;
    facts.replaceChildren();
    addFact('', info.primary, { primary: true });
    for (const fact of info.facts || []) {
      addFact(fact[0], fact[1], fact[2] || {});
    }

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

    await sleep(10);
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function copyCurrent() {
    if (!copyValue) return;

    try {
      await navigator.clipboard.writeText(copyValue);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = copyValue;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }

    copyBtn.classList.add('done');
    const old = copyLabel.textContent;
    copyLabel.textContent = '已复制';
    setTimeout(() => {
      copyBtn.classList.remove('done');
      copyLabel.textContent = old;
    }, 1400);
  }

  cameraBtn.onclick = startCamera;
  cancelCamera.onclick = () => {
    stopCamera();
    scanner.hidden = true;
    intro.hidden = false;
  };
  photoInput.onchange = () =>
    photoInput.files?.[0] && scanImage(photoInput.files[0]);
  again.onclick = resetView;
  copyBtn.onclick = copyCurrent;

  document.addEventListener('paste', (event) => {
    const file = [...(event.clipboardData?.files || [])].find((item) =>
      item.type.startsWith('image/'),
    );
    if (file) scanImage(file);
  });

  window.addEventListener('pagehide', stopCamera);
})();