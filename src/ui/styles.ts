/**
 * FyraPlayer UI Shell Styles
 * Modern, responsive player UI with smooth animations
 * Layout: Progress bar on top (full width), controls below
 */
export const UI_SHELL_STYLES = `
  :host { 
    position: absolute; 
    inset: 0; 
    pointer-events: none; 
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    user-select: none;
    -webkit-user-select: none;
  }
  
  /* Fullscreen video centering */
  :host(:fullscreen),
  :host(:-webkit-full-screen),
  :host(:-moz-full-screen),
  :host(:-ms-fullscreen) {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }
  
  .shell { 
    position: absolute; 
    inset: 0; 
    display: flex; 
    flex-direction: column; 
    justify-content: flex-end; 
    pointer-events: none;
    transition: opacity 0.3s ease;
  }
  
  /* Click area for double-click fullscreen */
  .click-area {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    cursor: pointer;
  }
  
  /* Overlay for spinner and big play button */
  .overlay { 
    position: absolute; 
    inset: 0; 
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 10;
  }
  
  /* Loading spinner */
  .spinner { 
    position: absolute;
    top: 50%;
    left: 50%;
    margin-left: -24px;
    margin-top: -24px;
    width: 48px; 
    height: 48px; 
    border-radius: 50%; 
    border: 3px solid rgba(255,255,255,0.2); 
    border-top-color: #fff;
    border-left-color: #fff;
    animation: spin 0.8s cubic-bezier(0.5, 0, 0.5, 1) infinite;
    display: none;
    pointer-events: none;
    box-shadow: 0 0 20px rgba(0,0,0,0.3);
  }
  
  .spinner.show { display: block; }
  
  /* Big play button */
  .big-play { 
    position: absolute;
    top: 50%;
    left: 50%;
    margin-left: -34px;
    margin-top: -34px;
    width: 68px; 
    height: 68px; 
    border-radius: 50%; 
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: none;
    align-items: center; 
    justify-content: center; 
    pointer-events: auto; 
    cursor: pointer; 
    transition: background 0.2s ease, opacity 0.2s ease, transform 0.1s ease;
    border: 2px solid rgba(255,255,255,0.2);
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  }
  
  .big-play.show { display: flex; }
  
  .big-play:hover { 
    background: rgba(0,0,0,0.75);
    border-color: rgba(255,255,255,0.3);
  }
  
  .big-play:active {
    transform: scale(0.95);
  }
  
  .big-play svg { 
    width: 28px; 
    height: 28px; 
    fill: #fff; 
    margin-left: 3px;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
  }
  
  /* Cover/poster image */
  .cover { 
    position: absolute; 
    inset: 0; 
    background-size: cover; 
    background-position: center; 
    background-repeat: no-repeat;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  
  .cover.show { opacity: 1; }
  
  /* Bottom control area */
  .bottom { 
    width: 100%; 
    box-sizing: border-box; 
    pointer-events: none;
    background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.7) 100%);
    opacity: 1;
    transition: opacity 0.3s ease, transform 0.3s ease;
    z-index: 20;
    display: flex;
    flex-direction: column;
  }
  
  .shell.hide-controls .bottom {
    opacity: 0;
    transform: translateY(10px);
  }
  
  /* Progress bar row - FULL WIDTH on top */
  .progress-row { 
    display: flex; 
    align-items: center; 
    width: 100%;
    padding: 8px 0 0 0;
    pointer-events: auto;
  }
  
  /* Progress slider - full width */
  .progress { 
    flex: 1; 
    appearance: none;
    -webkit-appearance: none;
    height: 4px; 
    border-radius: 0; 
    background: rgba(255,255,255,0.3); 
    outline: none; 
    cursor: pointer;
    transition: height 0.15s ease;
    margin: 0;
  }
  
  .progress:hover {
    height: 6px;
  }
  
  .progress::-webkit-slider-thumb { 
    appearance: none;
    -webkit-appearance: none;
    width: 14px; 
    height: 14px; 
    border-radius: 50%; 
    background: #fff;
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    transition: transform 0.15s ease;
  }
  
  .progress:hover::-webkit-slider-thumb {
    transform: scale(1.2);
  }
  
  .progress::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    cursor: pointer;
    border: none;
    box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  }
  
  /* Control buttons bar */
  .bar { 
    display: flex; 
    align-items: center; 
    gap: 4px; 
    padding: 6px 12px 10px;
    pointer-events: auto;
  }
  
  /* Time label in toolbar */
  .time {
    font-size: 12px;
    font-weight: 500;
    color: #fff;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    white-space: nowrap;
    margin-left: 4px;
  }
  
  /* Buttons */
  button {
    pointer-events: auto;
    background: transparent;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 6px;
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
    min-width: 32px;
    height: 32px;
  }
  
  button:hover { 
    background: rgba(255,255,255,0.15);
  }
  
  button:active {
    transform: scale(0.92);
  }
  
  /* Quality selector */
  select {
    pointer-events: auto;
    background: rgba(255,255,255,0.1);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 11px;
    cursor: pointer;
    outline: none;
  }
  
  select:hover {
    background: rgba(255,255,255,0.2);
  }
  
  .icon { 
    width: 20px; 
    height: 20px; 
    fill: #fff;
    filter: drop-shadow(0 1px 1px rgba(0,0,0,0.3));
  }
  
  .spacer { flex: 1; }
  
  /* Volume control */
  .vol-wrap { 
    position: relative; 
    display: flex; 
    align-items: center;
  }
  
  .vol-pop { 
    position: absolute; 
    bottom: 40px; 
    left: 50%; 
    transform: translateX(-50%) scale(0.9);
    padding: 12px 8px;
    background: rgba(28,28,28,0.95);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-radius: 8px;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }
  
  .vol-wrap:hover .vol-pop { 
    opacity: 1;
    visibility: visible;
    transform: translateX(-50%) scale(1);
  }
  
  .vol {
    width: 6px;
    height: 80px;
    writing-mode: vertical-lr;
    direction: rtl;
    appearance: none;
    -webkit-appearance: none;
    background: rgba(255,255,255,0.3);
    border-radius: 3px;
    pointer-events: auto;
    cursor: pointer;
  }
  
  .vol::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  }
  
  .vol::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    cursor: pointer;
    border: none;
  }
  
  /* Log panel */
  .log { 
    position: absolute; 
    right: 12px; 
    top: 12px; 
    max-height: 200px; 
    width: 280px; 
    overflow: auto; 
    background: rgba(0,0,0,0.9);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    color: #e0e0e0; 
    font-size: 10px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    padding: 10px; 
    border-radius: 6px; 
    pointer-events: auto; 
    opacity: 0;
    visibility: hidden;
    transform: translateY(-10px);
    transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    z-index: 100;
  }
  
  .log.show { 
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }
  
  .log div {
    padding: 2px 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  
  .log div:last-child {
    border-bottom: none;
  }
  
  /* Speed menu */
  .speed-menu {
    position: absolute;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%) scale(0.9);
    background: rgba(28,28,28,0.95);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-radius: 8px;
    padding: 4px;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    z-index: 30;
  }
  
  .speed-wrap:hover .speed-menu {
    opacity: 1;
    visibility: visible;
    transform: translateX(-50%) scale(1);
  }
  
  .speed-menu button {
    display: block;
    width: 100%;
    padding: 6px 14px;
    text-align: center;
    font-size: 12px;
  }
  
  .speed-menu button.active {
    background: rgba(255,255,255,0.15);
  }
  
  /* ========== MORE MENU (三个点折叠菜单) ========== */
  .more-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  
  .more-menu {
    position: absolute;
    bottom: 40px;
    right: 0;
    background: rgba(28,28,28,0.95);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-radius: 8px;
    padding: 4px;
    opacity: 0;
    visibility: hidden;
    transform: scale(0.9);
    transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    z-index: 30;
    min-width: 120px;
  }
  
  .more-wrap:hover .more-menu,
  .more-wrap.open .more-menu {
    opacity: 1;
    visibility: visible;
    transform: scale(1);
  }
  
  .more-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    text-align: left;
    font-size: 12px;
    justify-content: flex-start;
  }
  
  .more-menu button .icon {
    width: 16px;
    height: 16px;
  }
  
  /* ========== COLLAPSIBLE BUTTONS ========== */
  .collapsible {
    display: flex;
  }
  
  /* ========== RESPONSIVE: Small player ========== */
  /* 小窗口：宽度 < 400px */
  @container (max-width: 400px) {
    .collapsible { display: none !important; }
    .more-wrap { display: flex !important; }
  }
  
  /* 使用媒体查询作为后备 */
  :host-context(.fyra-small) .collapsible { display: none !important; }
  :host-context(.fyra-small) .more-wrap { display: flex !important; }
  
  /* 默认隐藏 more 按钮 */
  .more-wrap { display: none; }
  
  /* Animations */
  @keyframes spin { 
    from { transform: rotate(0deg); } 
    to { transform: rotate(360deg); } 
  }
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  /* ========== RESPONSIVE: Very small (< 300px) ========== */
  @media (max-width: 300px) {
    .bar { padding: 4px 8px 6px; gap: 2px; }
    button { min-width: 28px; height: 28px; padding: 4px; }
    .icon { width: 16px; height: 16px; }
    .time { font-size: 10px; }
    .big-play { width: 48px; height: 48px; margin-left: -24px; margin-top: -24px; }
    .big-play svg { width: 20px; height: 20px; }
    .spinner { width: 36px; height: 36px; margin-left: -18px; margin-top: -18px; }
  }
`;

export const UI_SHELL_HTML = `
  <div class="shell">
    <div class="cover" data-role="cover"></div>
    <div class="click-area" data-role="click-area"></div>
    <div class="overlay">
      <div class="spinner" data-role="spinner"></div>
      <div class="big-play" data-act="toggle-play">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </div>
    </div>
    <div class="bottom">
      <!-- Progress bar on top, full width -->
      <div class="progress-row">
        <input type="range" class="progress" min="0" max="100" value="0" step="0.1" />
      </div>
      <!-- Control bar below -->
      <div class="bar">
        <button class="btn-play" data-act="toggle-play" title="播放/暂停">
          <svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <span class="time" data-role="time">00:00 / --:--</span>
        <div class="spacer"></div>
        <select class="quality collapsible" data-act="quality" style="display:none;"></select>
        <div class="speed-wrap collapsible" style="position:relative;">
          <button data-act="speed" title="播放速度">1x</button>
          <div class="speed-menu">
            <button data-speed="0.5">0.5x</button>
            <button data-speed="0.75">0.75x</button>
            <button data-speed="1" class="active">1x</button>
            <button data-speed="1.25">1.25x</button>
            <button data-speed="1.5">1.5x</button>
            <button data-speed="2">2x</button>
          </div>
        </div>
        <button class="collapsible" data-act="shot" title="截图">
          <svg class="icon" viewBox="0 0 24 24"><path d="M4 4h4l2-2h4l2 2h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>
        </button>
        <button class="collapsible" data-act="pip" title="画中画">
          <svg class="icon" viewBox="0 0 24 24"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/></svg>
        </button>
        <div class="vol-wrap">
          <button data-act="mute" title="静音">
            <svg class="icon vol-icon" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          </button>
          <div class="vol-pop">
            <input type="range" class="vol" min="0" max="1" step="0.01" value="1" />
          </div>
        </div>
        <button data-act="fs" title="全屏">
          <svg class="icon fs-icon" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
        </button>
        <!-- More menu for collapsed items -->
        <div class="more-wrap">
          <button data-act="more" title="更多">
            <svg class="icon" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
          </button>
          <div class="more-menu">
            <button data-act="speed-more" title="播放速度">
              <svg class="icon" viewBox="0 0 24 24"><path d="M10 8v8l6-4-6-4z"/></svg>
              <span>倍速</span>
            </button>
            <button data-act="shot" title="截图">
              <svg class="icon" viewBox="0 0 24 24"><path d="M4 4h4l2-2h4l2 2h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>
              <span>截图</span>
            </button>
            <button data-act="pip" title="画中画">
              <svg class="icon" viewBox="0 0 24 24"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/></svg>
              <span>画中画</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="log" data-role="log"></div>
  </div>
`;
