/* Interactive dashboard: the morph-loop components, but you drive them.
   Mounts into #dashboard. Geometry runs on real springs (liquid tabs/toggles, rubber-band volume,
   play/pause morph); the player streams CC BY 4.0 tracks with a live WebAudio visualizer. */
(() => {
  const script = document.currentScript;
  const asset = p => new URL(p, script.src).href;
  const mount = document.getElementById('dashboard');
  if (!mount) return;

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mix = (a, b, k) => a + (b - a) * k;
  const fmtTime = s => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgb = c => `rgb(${c.map(Math.round).join(',')})`;
  const mixC = (a, b, k) => a.map((x, i) => mix(x, b[i], k));

  /* ---------- springs ---------- */
  const active = new Set();
  const CFG = {
    snappy: { k: 520, c: 38 },   // ζ≈0.83 — a hair of overshoot
    lead:   { k: 900, c: 46 },   // leading edge
    trail:  { k: 220, c: 27 },   // trailing edge
    soft:   { k: 240, c: 29 },
    band:   { k: 420, c: 28 },   // rubber band snapping back
    reveal: { k: 60,  c: 15.5 },
    count:  { k: 170, c: 26.1 },  // critically damped: numbers never overshoot
  };
  class Spring {
    constructor(x, cfg = CFG.snappy, on = null, eps = 0.01) { this.x = x; this.v = 0; this.t = x; this.cfg = cfg; this.on = on; this.eps = eps; }
    to(t, cfg) { this.t = t; if (cfg) this.cfg = cfg; active.add(this); return this; }
    set(x) { this.x = this.t = x; this.v = 0; active.delete(this); if (this.on) this.on(x); }
    step(dt) { const { k, c } = this.cfg; this.v += (-k * (this.x - this.t) - c * this.v) * dt; this.x += this.v * dt; }
  }

  /* ---------- icons ---------- */
  const I = {
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/>',
    okCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    speaker: '<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path class="w1" d="M15.5 9a4 4 0 0 1 0 6"/><path class="w2" d="M18.5 6.5a8 8 0 0 1 0 11"/><path class="mx" d="m16 9.5 5 5m0-5-5 5"/>',
    note: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    chart: '<path d="M4 19h16M7 15v-4M12 15V6M17 15V8"/>',
    deploy: '<path d="M12 19V7M6.5 12.5 12 7l5.5 5.5M5 4h14"/>',
    bars: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4"/>',
    pulse: '<path d="M3 12h4l2.5-6 5 12L17 12h4"/>',
    click: '<path d="M9 9V4.5M4.5 9H9M6 6 4 4M13 13l7 2.5-3 1.5-1.5 3z"/><path d="M9 9l4 4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  };
  const G = { // filled media glyphs
    prev: '<path d="M6 6h2.2v12H6z"/><path d="M19 6.5v11L9.8 12z"/>',
    next: '<path d="M15.8 6H18v12h-2.2z"/><path d="M5 6.5v11l9.2-5.5z"/>',
    play: '<path d="M8 5.5v13L19 12z"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
  };
  const svg = (p, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;

  /* ---------- data ---------- */
  const TRACKS = [
    { title: 'Ethereal Pulse', artist: 'Surf House Productions', src: asset('audio/ethereal-pulse.mp3'), dur: 192.6, bpm: 128 },
    { title: 'Afterglow Love', artist: '| e s c p |', src: asset('audio/afterglow-love.mp3'), dur: 272.1, bpm: 120 },
    { title: 'Rush Hour', artist: '| e s c p |', src: asset('audio/rush-hour.mp3'), dur: 238.6, bpm: 120 },
  ];
  const money = v => '$' + Math.round(v).toLocaleString('en-US');
  const kilo = v => '$' + (v / 1000).toFixed(1) + 'k';
  const DATASETS = [
    { name: 'Daily', labels: ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'],
      values: [120, 90, 60, 80, 210, 380, 520, 610, 560, 640, 700, 540], fmt: money, chip: '+3.1%' },
    { name: 'Weekly', labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'],
      values: [8200, 9100, 8700, 10400, 9800, 11600, 11100, 12900, 12200, 13800, 13100, 14900], fmt: kilo, chip: '+8.6%' },
    { name: 'Monthly', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      values: [18, 22, 20, 27, 25, 31, 29, 36, 34, 41, 39, 48].map(v => v * 1000), fmt: kilo, chip: '+12.4%' },
  ].map(d => ({ ...d, total: d.values.reduce((a, b) => a + b, 0) }));
  const SETTINGS = { viz: true, pulse: true, sfx: true };

  /* ---------- markup ---------- */
  mount.innerHTML = `
  <div class="db">
    <header class="db-head">
      <div class="db-brand"><div class="db-logo"></div><div><b>Studio</b><span>Everything here is clickable</span></div></div>
      <button class="db-island" id="dbIsland" aria-label="Play music">
        <span class="isl-idle">${svg(I.note)}Not playing</span>
        <span class="isl-live"><span class="isl-art"><span class="db-disc"></span></span><span class="isl-title" id="dbIslTitle"></span><span class="isl-bars"><i></i><i></i><i></i><i></i></span></span>
      </button>
      <div class="db-actions">
        <button class="db-search" id="dbSearch" aria-label="Open command palette">${svg(I.search)}<span>Search or run…</span><kbd>⌘K</kbd></button>
        <button class="db-deploy" id="dbDeploy" data-state="idle">
          <span class="dp-label">Deploy ${svg(I.arrow)}</span>
          <svg class="dp-spin" viewBox="0 0 24 24" aria-hidden="true"><circle class="trk" cx="12" cy="12" r="9"/><circle class="arc" cx="12" cy="12" r="9"/></svg>
          ${svg(I.check, 'ico dp-check')}
        </button>
      </div>
    </header>

    <div class="db-grid">
      <section class="db-card db-player" aria-label="Music player">
        <div class="pl-top">
          <div class="pl-art"><div class="db-disc" id="dbDisc"></div></div>
          <div class="pl-meta" id="dbMeta"><div class="pl-title" id="dbTitle"></div><div class="pl-artist" id="dbArtist"></div></div>
          <span class="pl-count" id="dbCount"></span>
        </div>
        <div class="pl-viz" id="dbViz" aria-hidden="true">${'<i></i>'.repeat(28)}</div>
        <div class="pl-bar" id="dbBar" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100"><div class="pl-fill" id="dbFill"></div><div class="pl-knob" id="dbKnob"></div></div>
        <div class="pl-times"><span id="dbCur">0:00</span><span id="dbRem">-0:00</span></div>
        <div class="pl-ctrls">
          <button class="pl-skip" id="dbPrev" aria-label="Previous track">${svg(G.prev, 'glyph')}</button>
          <button class="pl-play" id="dbPlay" aria-label="Play"><svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path id="dbPP1"/><path id="dbPP2"/></svg></button>
          <button class="pl-skip" id="dbNext" aria-label="Next track">${svg(G.next, 'glyph')}</button>
        </div>
        <div class="pl-vol">
          <button class="pl-mute" id="dbMute" aria-label="Mute">${svg(I.speaker)}</button>
          <div class="vol-wrap" id="dbVol" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100"><div class="vol-track" id="dbVolTrack"><div class="vol-fill" id="dbVolFill"></div></div></div>
          <span class="vol-num" id="dbVolNum"></span>
        </div>
      </section>

      <section class="db-card db-chart" aria-label="Revenue chart">
        <div class="ch-head">
          <div><div class="ch-label">Revenue</div><div class="ch-value"><span id="dbVal">$0</span><span class="ch-chip" id="dbChip"></span></div></div>
          <div class="db-tabs" id="dbTabs" role="tablist"><div class="tab-ind" id="dbInd"></div>
            ${DATASETS.map((d, i) => `<button role="tab" data-i="${i}">${d.name}</button>`).join('')}
          </div>
        </div>
        <div class="ch-plot" id="dbPlot">
          <svg id="dbSvg" aria-hidden="true">
            <defs><clipPath id="dbReveal"><rect id="dbRevealRect" x="-12" y="-40" width="0" height="1000"/></clipPath></defs>
            <g class="ch-grid" id="dbGrid"></g>
            <g clip-path="url(#dbReveal)"><path class="ch-area" id="dbArea"/><path class="ch-line" id="dbLine"/></g>
            <line class="ch-guide" id="dbGuide" y1="0"/>
            <circle class="ch-dot" id="dbDot" r="0"/>
          </svg>
          <div class="ch-x" id="dbX"></div>
          <div class="ch-tip" id="dbTip"><span id="dbTipL"></span><b id="dbTipV"></b></div>
        </div>
      </section>

      <section class="db-card db-settings" aria-label="Settings">
        ${[['viz', 'Visualizer', 'Live frequency bars'], ['pulse', 'Beat pulse', 'Art throbs on the kick'], ['sfx', 'Interface sounds', 'Clicks on every action']]
          .map(([k, t, d]) => `<div class="st-row"><div><b>${t}</b><span>${d}</span></div><button class="tg" role="switch" aria-checked="true" aria-label="${t}" data-k="${k}"><i class="tg-knob"></i></button></div>`).join('')}
      </section>
    </div>

    <p class="db-credits">Music (CC BY 4.0, re-encoded to 128 kbps):
      “Ethereal Pulse” by <a href="https://surf-house-productions.bandcamp.com" target="_blank" rel="noopener">Surf House Productions</a>,
      “Afterglow Love” and “Rush Hour” by <a href="https://www.escp.space" target="_blank" rel="noopener">| e s c p |</a> —
      royalty free music via <a href="https://www.free-stock-music.com" target="_blank" rel="noopener">free-stock-music.com</a>,
      licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.</p>
  </div>`;

  const pal = document.createElement('div');
  pal.className = 'db-pal'; pal.hidden = true;
  pal.innerHTML = `<div class="pal-backdrop"></div>
    <div class="pal-panel" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="pal-input">${svg(I.search)}<input id="dbPalInput" placeholder="Type a command…" autocomplete="off" spellcheck="false" aria-label="Command"><kbd>esc</kbd></div>
      <div class="pal-list" id="dbPalList" role="listbox"></div>
    </div>`;
  const toasts = document.createElement('div');
  toasts.className = 'db-toasts'; toasts.setAttribute('aria-live', 'polite');
  document.body.append(pal, toasts);

  const $ = id => document.getElementById(id);
  const E = {
    island: $('dbIsland'), islTitle: $('dbIslTitle'), islBars: [...mount.querySelectorAll('.isl-bars i')],
    search: $('dbSearch'), deploy: $('dbDeploy'),
    disc: $('dbDisc'), meta: $('dbMeta'), title: $('dbTitle'), artist: $('dbArtist'), count: $('dbCount'),
    viz: [...$('dbViz').children], bar: $('dbBar'), fill: $('dbFill'), knob: $('dbKnob'), cur: $('dbCur'), rem: $('dbRem'),
    prev: $('dbPrev'), play: $('dbPlay'), pp1: $('dbPP1'), pp2: $('dbPP2'), next: $('dbNext'),
    mute: $('dbMute'), vol: $('dbVol'), volTrack: $('dbVolTrack'), volFill: $('dbVolFill'), volNum: $('dbVolNum'),
    val: $('dbVal'), chip: $('dbChip'), tabs: $('dbTabs'), ind: $('dbInd'), tabBtns: [...$('dbTabs').querySelectorAll('button')],
    plot: $('dbPlot'), svg: $('dbSvg'), grid: $('dbGrid'), area: $('dbArea'), line: $('dbLine'), guide: $('dbGuide'), dot: $('dbDot'),
    revealRect: $('dbRevealRect'), x: $('dbX'), tip: $('dbTip'), tipL: $('dbTipL'), tipV: $('dbTipV'),
    toggles: [...mount.querySelectorAll('.tg')], palInput: $('dbPalInput'), palList: $('dbPalList'),
  };

  /* ---------- audio ---------- */
  const audio = new Audio();
  audio.preload = 'metadata';
  let trackIdx = 0, ctx = null, analyser = null, gain = null, freq = null, graphTried = false;
  let volume = 0.7, muted = false;
  const canGraph = location.protocol !== 'file:'; // file:// media is cross-origin → a WebAudio graph would output silence

  function ensureCtx() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function ensureGraph() {
    if (graphTried || !canGraph || !ensureCtx()) return;
    graphTried = true;
    try {
      const src = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.78;
      gain = ctx.createGain();
      src.connect(analyser); src.connect(gain); gain.connect(ctx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
      audio.volume = 1;
    } catch { analyser = gain = null; }
    applyVolume();
  }
  function applyVolume() { const v = muted ? 0 : volume; if (gain) gain.gain.value = v; else audio.volume = v; }
  const duration = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : TRACKS[trackIdx].dur);

  function loadTrack(i, autoplay) {
    trackIdx = (i + TRACKS.length) % TRACKS.length;
    const t = TRACKS[trackIdx];
    audio.src = t.src;
    E.meta.classList.add('swap');
    setTimeout(() => {
      E.title.textContent = t.title; E.artist.textContent = t.artist;
      E.count.textContent = `${trackIdx + 1} / ${TRACKS.length}`;
      E.islTitle.textContent = t.title;
      E.meta.classList.remove('swap');
    }, E.title.textContent ? 150 : 0);
    if ('mediaSession' in navigator && window.MediaMetadata) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: 'UI Motion Lab' });
    if (autoplay) play();
  }
  async function play() {
    ensureGraph();
    try { await audio.play(); } catch (e) { if (e.name !== 'AbortError') toast('Tap play again to start the audio', I.info); }
  }
  const pause = () => audio.pause();
  const togglePlay = () => (audio.paused ? play() : pause());
  const skip = d => { loadTrack(trackIdx + d, !audio.paused || d !== 0); };
  const toggleMute = () => { muted = !muted; applyVolume(); renderVol(); };

  audio.addEventListener('play', syncPlaying);
  audio.addEventListener('pause', syncPlaying);
  audio.addEventListener('ended', () => loadTrack(trackIdx + 1, true));
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', play);
      navigator.mediaSession.setActionHandler('pause', pause);
      navigator.mediaSession.setActionHandler('nexttrack', () => loadTrack(trackIdx + 1, true));
      navigator.mediaSession.setActionHandler('previoustrack', () => loadTrack(trackIdx - 1, true));
    } catch { /* unsupported action */ }
  }

  /* ---------- interface sounds ---------- */
  let noiseBuf = null;
  function sfx(kind = 'click') {
    if (!SETTINGS.sfx || !ensureCtx()) return;
    const t = ctx.currentTime, g = ctx.createGain();
    g.connect(ctx.destination);
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 4);
    }
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    src.buffer = noiseBuf; f.type = 'bandpass';
    const [hz, q, vol] = { click: [2600, 4, 0.32], key: [4200, 4, 0.2], tick: [1800, 4, 0.22], pop: [900, 1.5, 0.3] }[kind];
    f.frequency.value = hz; f.Q.value = q; g.gain.value = vol;
    src.connect(f); f.connect(g); src.start(t);
  }

  /* ---------- toast ---------- */
  function toast(msg, icon = I.okCircle) {
    const el = document.createElement('div');
    el.className = 'db-toast';
    el.innerHTML = svg(icon) + '<span></span>';
    el.lastChild.textContent = msg;
    toasts.appendChild(el);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 320); }, 2400);
  }

  /* ---------- play / pause morph + island ---------- */
  const PLAY = [[[8, 5], [13.5, 8.5], [13.5, 15.5], [8, 19]], [[13.5, 8.5], [19, 12], [19, 12], [13.5, 15.5]]];
  const PAUSE = [[[7, 5], [10.5, 5], [10.5, 19], [7, 19]], [[13.5, 5], [17, 5], [17, 19], [13.5, 19]]];
  const quad = (a, b, m) => 'M' + a.map((p, i) => `${mix(p[0], b[i][0], m).toFixed(2)},${mix(p[1], b[i][1], m).toFixed(2)}`).join('L') + 'Z';
  const playM = new Spring(0, CFG.snappy, m => { E.pp1.setAttribute('d', quad(PLAY[0], PAUSE[0], m)); E.pp2.setAttribute('d', quad(PLAY[1], PAUSE[1], m)); }, 0.001);
  playM.set(0);
  const ISL = { idle: 140, live: 240 };
  const islW = new Spring(ISL.idle, CFG.snappy, w => { E.island.style.width = w + 'px'; });
  function syncPlaying() {
    const on = !audio.paused;
    playM.to(on ? 1 : 0);
    islW.to(on ? ISL.live : ISL.idle);
    E.island.classList.toggle('live', on);
    E.play.setAttribute('aria-label', on ? 'Pause' : 'Play');
    E.island.setAttribute('aria-label', on ? 'Pause music' : 'Play music');
  }
  E.play.addEventListener('click', () => { sfx(); togglePlay(); });
  E.island.addEventListener('click', () => { sfx(); togglePlay(); });
  E.prev.addEventListener('click', () => { sfx(); audio.currentTime > 3 ? (audio.currentTime = 0) : loadTrack(trackIdx - 1, !audio.paused); });
  E.next.addEventListener('click', () => { sfx(); loadTrack(trackIdx + 1, !audio.paused); });

  /* ---------- scrub (direct manipulation) ---------- */
  let scrubbing = false, scrubP = 0;
  function scrubTo(e) {
    const r = E.bar.getBoundingClientRect();
    scrubP = clamp((e.clientX - r.left) / r.width, 0, 1);
    if (audio.readyState >= 1) audio.currentTime = scrubP * duration();
  }
  E.bar.addEventListener('pointerdown', e => { E.bar.setPointerCapture(e.pointerId); scrubbing = true; E.bar.classList.add('drag'); scrubTo(e); });
  E.bar.addEventListener('pointermove', e => { if (scrubbing) scrubTo(e); });
  const endScrub = () => { if (!scrubbing) return; scrubbing = false; E.bar.classList.remove('drag'); audio.currentTime = scrubP * duration(); sfx('tick'); };
  E.bar.addEventListener('pointerup', endScrub);
  E.bar.addEventListener('pointercancel', endScrub);
  E.bar.addEventListener('keydown', e => {
    const d = { ArrowRight: 5, ArrowLeft: -5 }[e.key];
    if (d) { e.preventDefault(); audio.currentTime = clamp(audio.currentTime + d, 0, duration()); }
  });

  /* ---------- volume: drag past the ends and it stretches ---------- */
  const rubber = o => Math.sign(o) * 30 * (1 - 1 / (Math.abs(o) / 60 + 1));
  const volStretch = new Spring(0, CFG.band, () => renderVol());
  let volDrag = false;
  function renderVol() {
    const s = volStretch.x;
    E.volTrack.style.left = (s < 0 ? s : 0) + 'px';
    E.volTrack.style.width = `calc(100% + ${Math.abs(s).toFixed(2)}px)`;
    E.volFill.style.width = (volume * 100).toFixed(2) + '%';
    E.volNum.textContent = muted ? 'Off' : String(Math.round(volume * 100));
    E.vol.setAttribute('aria-valuenow', String(Math.round(volume * 100)));
    E.mute.classList.toggle('muted', muted || volume === 0);
    E.mute.querySelector('.w1').style.opacity = clamp((volume - 0.05) / 0.2, 0, 1);
    E.mute.querySelector('.w2').style.opacity = clamp((volume - 0.5) / 0.2, 0, 1);
    E.mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }
  function volFrom(e) {
    const r = E.vol.getBoundingClientRect();
    const raw = (e.clientX - r.left) / r.width;
    volume = clamp(raw, 0, 1);
    if (muted && volume > 0) muted = false;
    volStretch.set(rubber(raw > 1 ? e.clientX - r.right : raw < 0 ? e.clientX - r.left : 0));
    applyVolume(); renderVol();
  }
  E.vol.addEventListener('pointerdown', e => { E.vol.setPointerCapture(e.pointerId); volDrag = true; E.vol.classList.add('drag'); volFrom(e); });
  E.vol.addEventListener('pointermove', e => { if (volDrag) volFrom(e); });
  const endVol = () => { if (!volDrag) return; volDrag = false; E.vol.classList.remove('drag'); volStretch.to(0, CFG.band); };
  E.vol.addEventListener('pointerup', endVol);
  E.vol.addEventListener('pointercancel', endVol);
  E.vol.addEventListener('keydown', e => {
    const d = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05 }[e.key];
    if (d) { e.preventDefault(); volume = clamp(volume + d, 0, 1); muted = false; applyVolume(); renderVol(); }
  });
  E.mute.addEventListener('click', () => { sfx(); toggleMute(); });

  /* ---------- liquid tabs ---------- */
  const inkMuted = hex('#777777'), white = [255, 255, 255];
  let tabIdx = 2;
  const renderInd = () => {
    const L = indL.x, R = indR.x;
    E.ind.style.transform = `translateX(${L.toFixed(2)}px)`;
    E.ind.style.width = Math.max(0, R - L).toFixed(2) + 'px';
    E.tabBtns.forEach(b => {
      const a = b.offsetLeft, z = a + b.offsetWidth;
      const cover = clamp((Math.min(R, z) - Math.max(L, a)) / (z - a), 0, 1);
      b.style.color = rgb(mixC(inkMuted, white, cover));
    });
  };
  const indL = new Spring(0, CFG.snappy, renderInd), indR = new Spring(0, CFG.snappy, renderInd);
  function selectTab(i, instant = false) {
    const b = E.tabBtns[i], l = b.offsetLeft, r = l + b.offsetWidth;
    if (instant) { indL.set(l); indR.set(r); }
    else {
      const right = i > tabIdx;
      indL.to(l, right ? CFG.trail : CFG.lead);
      indR.to(r, right ? CFG.lead : CFG.trail);
    }
    if (i !== tabIdx || instant) setDataset(i, instant);
    tabIdx = i;
    E.tabBtns.forEach((t, j) => t.setAttribute('aria-selected', String(j === i)));
  }
  E.tabBtns.forEach((b, i) => b.addEventListener('click', () => { sfx(); selectTab(i); }));

  /* ---------- chart: morphs between datasets, tooltip follows the pointer ---------- */
  let W = 0, H = 0, xs = [], fromYs = [], toYs = [], curYs = [], look = [], dsIdx = 2, revealed = false;
  const yFor = ds => {
    const min = Math.min(...ds.values), max = Math.max(...ds.values), pad = (max - min) * 0.18;
    return ds.values.map(v => H - 6 - ((v - (min - pad)) / ((max + pad) - (min - pad))) * (H - 20));
  };
  function pathOf(pts) {
    let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
    look = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
      for (let s = 0; s < 24; s++) {
        const u = s / 24, m = 1 - u;
        look.push([m*m*m*p1[0] + 3*m*m*u*c1[0] + 3*m*u*u*c2[0] + u*u*u*p2[0], m*m*m*p1[1] + 3*m*m*u*c1[1] + 3*m*u*u*c2[1] + u*u*u*p2[1]]);
      }
    }
    look.push(pts[pts.length - 1]);
    return d;
  }
  function yAt(x) {
    if (!look.length) return 0;
    let lo = 0, hi = look.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (look[m][0] < x) lo = m; else hi = m; }
    const [x0, y0] = look[lo], [x1, y1] = look[hi];
    return mix(y0, y1, x1 === x0 ? 0 : clamp((x - x0) / (x1 - x0), 0, 1));
  }
  const morph = new Spring(1, CFG.soft, () => renderChart(), 0.0005);
  function renderChart() {
    if (!W) return;
    const k = morph.x;
    curYs = fromYs.map((y, i) => mix(y, toYs[i], k));
    const d = pathOf(xs.map((x, i) => [x, curYs[i]]));
    E.line.setAttribute('d', d);
    E.area.setAttribute('d', `${d}L${W},${H}L0,${H}Z`);
    renderTip();
  }
  const valS = new Spring(0, CFG.reveal, v => { E.val.textContent = money(v); }, 0.5);
  function setDataset(i, instant) {
    dsIdx = i;
    const ds = DATASETS[i];
    fromYs = curYs.length ? curYs.slice() : yFor(ds);
    toYs = yFor(ds);
    if (instant) morph.set(1); else { morph.set(0); morph.to(1); }
    if (revealed) valS.to(ds.total, CFG.count);
    E.chip.textContent = ds.chip;
    E.x.innerHTML = ds.labels.map((l, j) => (j % 2 ? '' : `<span style="left:${xs[j]?.toFixed(1) ?? 0}px">${l}</span>`)).join('');
  }
  function layoutChart() {
    const r = E.svg.getBoundingClientRect();
    W = r.width; H = r.height;
    if (!W || !H) return;
    xs = DATASETS[0].values.map((_, i) => 8 + i * (W - 16) / 11);
    E.grid.innerHTML = [0, 1, 2, 3].map(j => { const y = (6 + j * (H - 12) / 3).toFixed(1); return `<line x1="0" x2="${W}" y1="${y}" y2="${y}"/>`; }).join('');
    E.guide.setAttribute('y2', H);
    curYs = [];
    setDataset(dsIdx, true);
    if (revealed) reveal.set(W + 24);
  }

  let tipIdx = 11;
  const renderTip = () => {
    const o = clamp(tipO.x, 0, 1), x = tipX.x, y = yAt(x), ds = DATASETS[dsIdx];
    E.dot.setAttribute('cx', x.toFixed(2)); E.dot.setAttribute('cy', y.toFixed(2)); E.dot.setAttribute('r', (5.5 * o).toFixed(2));
    E.guide.setAttribute('x1', x.toFixed(2)); E.guide.setAttribute('x2', x.toFixed(2)); E.guide.style.opacity = o;
    E.tipL.textContent = ds.labels[tipIdx]; E.tipV.textContent = ds.fmt(ds.values[tipIdx]);
    const tw = E.tip.offsetWidth;
    E.tip.style.transform = `translate(${clamp(x - tw / 2, 0, Math.max(0, W - tw)).toFixed(2)}px, ${(y - 44).toFixed(2)}px) scale(${(0.92 + 0.08 * o).toFixed(3)})`;
    E.tip.style.opacity = o;
  };
  const tipX = new Spring(0, CFG.snappy, renderTip), tipO = new Spring(0, CFG.snappy, renderTip, 0.001);
  E.plot.addEventListener('pointermove', e => {
    if (!W) return;
    const x = e.clientX - E.plot.getBoundingClientRect().left;
    const i = clamp(Math.round((x - 8) / (W - 16) * 11), 0, 11);
    if (tipO.x < 0.05) tipX.set(xs[i]);
    if (i !== tipIdx && tipO.t === 1) sfx('key');
    tipIdx = i; tipX.to(xs[i]); tipO.to(1);
  });
  E.plot.addEventListener('pointerleave', () => tipO.to(0));
  const reveal = new Spring(0, CFG.reveal, w => E.revealRect.setAttribute('width', w.toFixed(2)), 0.5);

  /* ---------- liquid toggles ---------- */
  const TG = {};
  E.toggles.forEach(btn => {
    const k = btn.dataset.k, knob = btn.firstElementChild;
    const render = () => { knob.style.transform = `translateX(${L.x.toFixed(2)}px)`; knob.style.width = Math.max(0, R.x - L.x).toFixed(2) + 'px'; };
    const L = new Spring(4, CFG.snappy, render), R = new Spring(28, CFG.snappy, render);
    const rest = on => (on ? [24, 48] : [4, 28]);
    TG[k] = {
      set(on, instant) {
        SETTINGS[k] = on;
        btn.setAttribute('aria-checked', String(on));
        const [l, r] = rest(on);
        if (instant) { L.set(l); R.set(r); return; }
        L.to(l, on ? CFG.trail : CFG.lead);
        R.to(r, on ? CFG.lead : CFG.trail);
      },
    };
    btn.addEventListener('pointerdown', () => { if (SETTINGS[k]) L.to(18); else R.to(34); });
    btn.addEventListener('pointerleave', () => { const [l, r] = rest(SETTINGS[k]); L.to(l); R.to(r); });
    btn.addEventListener('click', () => { TG[k].set(!SETTINGS[k]); sfx(); });
    TG[k].set(SETTINGS[k], true);
  });
  const setSetting = (k, on) => { TG[k].set(on); };

  /* ---------- deploy: button → loader → check ---------- */
  let dpIdle = 124;
  const dpW = new Spring(dpIdle, CFG.snappy, w => { E.deploy.style.width = w + 'px'; });
  function deploy() {
    if (E.deploy.dataset.state !== 'idle') return;
    sfx();
    E.deploy.dataset.state = 'loading';
    E.deploy.setAttribute('aria-label', 'Deploying');
    dpW.to(40);
    setTimeout(() => { E.deploy.dataset.state = 'done'; sfx('pop'); }, 1400);
    setTimeout(() => {
      E.deploy.dataset.state = 'idle'; E.deploy.removeAttribute('aria-label');
      dpW.to(dpIdle);
      toast('Deployed to production');
    }, 2300);
  }
  E.deploy.addEventListener('click', deploy);

  /* ---------- ⌘K command palette ---------- */
  const COMMANDS = [
    { label: () => (audio.paused ? 'Play music' : 'Pause music'), icon: () => svg(audio.paused ? G.play : G.pause, 'glyph'), keys: 'music song audio', run: togglePlay, hint: 'Music' },
    { label: 'Next track', icon: () => svg(G.next, 'glyph'), keys: 'music song skip', run: () => { loadTrack(trackIdx + 1, true); toast(`Now playing · ${TRACKS[trackIdx].title}`, I.note); }, hint: 'Music' },
    { label: 'Previous track', icon: () => svg(G.prev, 'glyph'), keys: 'music song back', run: () => { loadTrack(trackIdx - 1, true); toast(`Now playing · ${TRACKS[trackIdx].title}`, I.note); }, hint: 'Music' },
    { label: () => (muted ? 'Unmute music' : 'Mute music'), icon: () => svg(I.speaker), keys: 'volume sound audio', run: toggleMute, hint: 'Music' },
    { label: 'Show daily revenue', icon: () => svg(I.chart), keys: 'chart tab day', run: () => selectTab(0), hint: 'Chart' },
    { label: 'Show weekly revenue', icon: () => svg(I.chart), keys: 'chart tab week', run: () => selectTab(1), hint: 'Chart' },
    { label: 'Show monthly revenue', icon: () => svg(I.chart), keys: 'chart tab month', run: () => selectTab(2), hint: 'Chart' },
    { label: 'Deploy to production', icon: () => svg(I.deploy), keys: 'ship release publish', run: deploy, hint: 'Action' },
    { label: () => (SETTINGS.viz ? 'Hide visualizer' : 'Show visualizer'), icon: () => svg(I.bars), keys: 'toggle bars settings', run: () => setSetting('viz', !SETTINGS.viz), hint: 'Setting' },
    { label: () => (SETTINGS.pulse ? 'Turn off beat pulse' : 'Turn on beat pulse'), icon: () => svg(I.pulse), keys: 'toggle settings', run: () => setSetting('pulse', !SETTINGS.pulse), hint: 'Setting' },
    { label: () => (SETTINGS.sfx ? 'Mute interface sounds' : 'Enable interface sounds'), icon: () => svg(I.click), keys: 'toggle settings sfx clicks', run: () => setSetting('sfx', !SETTINGS.sfx), hint: 'Setting' },
    { label: 'Show a toast', icon: () => svg(I.okCircle), keys: 'notification test', run: () => toast('Hello from the command palette'), hint: 'Action' },
  ];
  const labelOf = c => (typeof c.label === 'function' ? c.label() : c.label);
  const escapeHTML = s => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  let palItems = [], palSel = 0, lastFocus = null;
  const hl = document.createElement('div'); hl.className = 'pal-hl';
  const hlY = new Spring(8, CFG.snappy, y => { hl.style.transform = `translateY(${y.toFixed(2)}px)`; });

  function renderPalette() {
    const words = E.palInput.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    palItems = COMMANDS.filter(c => {
      const hay = (labelOf(c) + ' ' + c.keys).toLowerCase().split(/\s+/);
      return words.every(w => hay.some(h => h.startsWith(w)));
    });
    palSel = clamp(palSel, 0, Math.max(0, palItems.length - 1));
    E.palList.replaceChildren(hl);
    hl.style.display = palItems.length ? '' : 'none';
    if (!palItems.length) { const e = document.createElement('div'); e.className = 'pal-empty'; e.textContent = 'No commands found'; E.palList.appendChild(e); return; }
    palItems.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'pal-item'; b.setAttribute('role', 'option');
      const label = labelOf(c).split(' ').map(w => {
        const m = words.find(q => w.toLowerCase().startsWith(q));
        return m ? `<b>${escapeHTML(w.slice(0, m.length))}</b>${escapeHTML(w.slice(m.length))}` : escapeHTML(w);
      }).join(' ');
      b.innerHTML = `${c.icon()}<span>${label}</span><span class="pal-hint">${c.hint}</span>`;
      b.addEventListener('pointermove', () => { if (palSel !== i) { palSel = i; hlY.to(8 + i * 46); } });
      b.addEventListener('click', () => runCommand(i));
      E.palList.appendChild(b);
    });
    hlY.to(8 + palSel * 46);
  }
  function openPalette() {
    if (!pal.hidden) return;
    const r = mount.getBoundingClientRect();
    if (r.bottom < 80 || r.top > innerHeight - 80) mount.scrollIntoView({ behavior: 'smooth', block: 'center' });
    lastFocus = document.activeElement;
    pal.hidden = false;
    E.palInput.value = ''; palSel = 0;
    renderPalette(); hlY.set(8);
    requestAnimationFrame(() => pal.classList.add('open'));
    E.palInput.focus();
    sfx('pop');
  }
  function closePalette() {
    if (pal.hidden) return;
    pal.classList.remove('open');
    setTimeout(() => { if (!pal.classList.contains('open')) pal.hidden = true; }, 220);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  function runCommand(i) {
    const c = palItems[i];
    if (!c) return;
    sfx('key');
    closePalette();
    setTimeout(() => c.run(), 90);
  }
  E.palInput.addEventListener('input', () => { palSel = 0; renderPalette(); sfx('key'); });
  E.palInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!palItems.length) return;
      palSel = (palSel + (e.key === 'ArrowDown' ? 1 : -1) + palItems.length) % palItems.length;
      hlY.to(8 + palSel * 46);
      E.palList.children[palSel + 1]?.scrollIntoView({ block: 'nearest' });
      sfx('tick');
    }
    if (e.key === 'Enter') { e.preventDefault(); runCommand(palSel); }
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  pal.querySelector('.pal-backdrop').addEventListener('click', closePalette);
  E.search.addEventListener('click', openPalette);
  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closePalette(); }
    else if (e.key === 'Escape') closePalette();
  });

  /* ---------- per-frame: progress, visualizer, beat pulse ---------- */
  let visible = true, spin = 0, pulseS = 0, clock = 0;
  const levels = new Float32Array(E.viz.length), islLv = new Float32Array(4);
  const binFor = i => Math.round(2 + Math.pow(i / (E.viz.length - 1), 1.6) * 88);
  function tick(dt) {
    clock += dt;
    if (!visible) return;
    const d = duration(), cur = scrubbing ? scrubP * d : audio.currentTime || 0, p = clamp(cur / d, 0, 1);
    E.fill.style.width = (p * 100).toFixed(3) + '%';
    E.knob.style.left = (p * 100).toFixed(3) + '%';
    E.cur.textContent = fmtTime(cur);
    E.rem.textContent = '-' + fmtTime(d - cur);
    E.bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));

    const playing = !audio.paused;
    let bins = null;
    if (analyser && playing) { analyser.getByteFrequencyData(freq); bins = freq; }
    const fake = i => (0.35 + 0.3 * Math.sin(clock * 8 + i * 0.7)) * (0.6 + 0.4 * Math.sin(clock * 3.3 + i * 1.3));
    const ease = 1 - Math.exp(-dt * 16);
    for (let i = 0; i < E.viz.length; i++) {
      const target = !playing || !SETTINGS.viz ? 0 : bins ? Math.pow(clamp((bins[binFor(i)] / 255 - 0.3) / 0.7, 0, 1), 1.6) : fake(i);
      levels[i] = mix(levels[i], target, ease);
      E.viz[i].style.height = (4 + levels[i] * 60).toFixed(1) + 'px';
    }
    for (let i = 0; i < 4; i++) {
      const target = !playing ? 0 : bins ? clamp((bins[4 + i * 9] / 255 - 0.3) / 0.7, 0, 1) : fake(i * 3);
      islLv[i] = mix(islLv[i], target, ease);
      E.islBars[i].style.height = (4 + islLv[i] * 14).toFixed(1) + 'px';
    }

    let bass = 0;
    if (playing && bins) bass = (bins[1] + bins[2] + bins[3] + bins[4]) / 1020;
    else if (playing) bass = 0.5 + 0.5 * Math.pow(1 - ((audio.currentTime * TRACKS[trackIdx].bpm / 60) % 1), 4);
    const kick = SETTINGS.pulse && playing ? clamp((bass - 0.55) / 0.4, 0, 1) : 0;
    pulseS = mix(pulseS, kick, 1 - Math.exp(-dt * (kick > pulseS ? 40 : 10)));
    if (playing) spin += dt * 50;
    E.disc.style.transform = `rotate(${spin.toFixed(1)}deg) scale(${(1 + 0.12 * pulseS).toFixed(4)})`;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const n = Math.max(1, Math.ceil(dt * 240));
    for (const s of active) {
      for (let i = 0; i < n; i++) s.step(dt / n);
      if (Math.abs(s.v) < s.eps * 10 && Math.abs(s.x - s.t) < s.eps) { s.x = s.t; s.v = 0; active.delete(s); }
      if (s.on) s.on(s.x);
    }
    tick(dt);
    requestAnimationFrame(frame);
  }

  /* ---------- init ---------- */
  function relayout() { layoutChart(); selectTab(tabIdx, true); const range = document.createRange(); range.selectNodeContents(E.deploy.querySelector('.dp-label')); dpIdle = Math.ceil(range.getBoundingClientRect().width + 40); if (E.deploy.dataset.state === 'idle') dpW.set(dpIdle); }
  loadTrack(0, false);
  renderVol();
  syncPlaying();
  relayout();
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(relayout);
  new ResizeObserver(() => { layoutChart(); selectTab(tabIdx, true); }).observe(E.plot);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !revealed && W) { revealed = true; reveal.to(W + 24); valS.to(DATASETS[dsIdx].total); }
  }, { threshold: 0.25 }).observe(mount);
  requestAnimationFrame(frame);
})();
