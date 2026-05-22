(function () {
  if (window.BrgyMessageBox) return;

  const COLORS = {
    success: '#2f7d4f',
    error: '#b5293e',
    warning: '#c9a84c',
    info: '#2f7d4f',
    question: '#2f7d4f'
  };

  function injectStyles() {
    if (document.getElementById('brgy-messagebox-style')) return;
    const style = document.createElement('style');
    style.id = 'brgy-messagebox-style';
    style.textContent = `
      .brgy-msg-overlay{
        position:fixed; inset:0; z-index:999999; display:flex; align-items:center; justify-content:center;
        background:rgba(15,23,42,.55); backdrop-filter:blur(5px); padding:18px; animation:brgyFadeIn .16s ease-out;
      }
      .brgy-msg-card{
        width:min(430px,100%); background:#fff; color:#1f2937; border-radius:18px; overflow:hidden;
        box-shadow:0 24px 70px rgba(15,23,42,.28); transform:translateY(0) scale(1);
        animation:brgyPopIn .18s ease-out; border:1px solid rgba(226,232,240,.95);
        font-family:var(--font-sans, 'DM Sans', Segoe UI, Roboto, Arial, sans-serif);
      }
      .brgy-msg-top{height:6px; background:var(--brgy-msg-color,#2f7d4f);}
      .brgy-msg-body{padding:26px 26px 20px; text-align:center;}
      .brgy-msg-icon{
        width:58px; height:58px; margin:0 auto 14px; border-radius:50%; display:flex; align-items:center; justify-content:center;
        background:color-mix(in srgb, var(--brgy-msg-color,#2f7d4f) 12%, white); color:var(--brgy-msg-color,#2f7d4f);
        font-size:28px; font-weight:800;
      }
      .brgy-msg-title{font-size:20px; font-weight:800; margin:0 0 9px; color:#111827;}
      .brgy-msg-text{font-size:14px; line-height:1.55; margin:0; color:#4b5563; white-space:pre-line; overflow-wrap:anywhere;}
      .brgy-msg-input{
        width:100%; margin-top:16px; padding:12px 13px; border:1px solid #d1d5db; border-radius:12px;
        font-size:14px; outline:none; box-sizing:border-box;
      }
      .brgy-msg-input:focus{border-color:var(--brgy-msg-color,#2f7d4f); box-shadow:0 0 0 3px color-mix(in srgb, var(--brgy-msg-color,#2f7d4f) 17%, white);}
      .brgy-msg-actions{display:flex; gap:10px; justify-content:center; padding:0 26px 24px;}
      .brgy-msg-btn{border:0; border-radius:12px; padding:11px 20px; min-width:96px; cursor:pointer; font-weight:800; font-size:14px; transition:.16s ease;}
      .brgy-msg-btn-primary{background:var(--brgy-msg-color,#2f7d4f); color:#fff; box-shadow:0 10px 22px color-mix(in srgb, var(--brgy-msg-color,#2f7d4f) 28%, transparent);}
      .brgy-msg-btn-primary:hover{filter:brightness(.95); transform:translateY(-1px);}
      .brgy-msg-btn-secondary{background:#f3f4f6; color:#374151; border:1px solid #e5e7eb;}
      .brgy-msg-btn-secondary:hover{background:#e5e7eb;}

      body.dark .brgy-msg-card{background:#111d15; color:#e4ede7; border-color:#28392c;}
      body.dark .brgy-msg-title{color:#e4ede7;}
      body.dark .brgy-msg-text{color:#95aa9d;}
      body.dark .brgy-msg-btn-secondary{background:#1a2b1f; color:#c2d4c8; border-color:#28392c;}
      body.dark .brgy-msg-btn-secondary:hover{background:#243222;}
      body.dark .brgy-msg-input{background:#1a2b1f; color:#e4ede7; border-color:#28392c;}
    
      @keyframes brgyFadeIn{from{opacity:0}to{opacity:1}}
      @keyframes brgyPopIn{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
    `;
    document.head.appendChild(style);
  }

  function parseType(message, fallback) {
    const text = String(message || '').trim();
    if (fallback) return fallback;
    if (/^(✓|success|saved|created|updated|deleted|approved)/i.test(text)) return 'success';
    if (/^(✗|error|failed|invalid|cannot)/i.test(text)) return 'error';
    if (/warning|are you sure|restore|delete|replace all|cannot be undone/i.test(text)) return 'warning';
    return 'info';
  }

  function cleanMessage(message) {
    return String(message || '').replace(/^[✓✗⚠️\s]+/, '').trim();
  }

  function titleFor(type, customTitle) {
    if (customTitle) return customTitle;
    if (type === 'success') return 'Success';
    if (type === 'error') return 'Error';
    if (type === 'warning') return 'Please Confirm';
    if (type === 'question') return 'Confirmation';
    return 'Notice';
  }

  function iconFor(type) {
    if (type === 'success') return '✓';
    if (type === 'error') return '!';
    if (type === 'warning') return '⚠';
    if (type === 'question') return '?';
    return 'i';
  }

  function open(options) {
    injectStyles();
    const type = options.type || parseType(options.message);
    const overlay = document.createElement('div');
    overlay.className = 'brgy-msg-overlay';
    overlay.style.setProperty('--brgy-msg-color', COLORS[type] || COLORS.info);

    const card = document.createElement('div');
    card.className = 'brgy-msg-card';
    const body = document.createElement('div');
    body.className = 'brgy-msg-body';

    const icon = document.createElement('div');
    icon.className = 'brgy-msg-icon';
    icon.textContent = iconFor(type);

    const title = document.createElement('h3');
    title.className = 'brgy-msg-title';
    title.textContent = titleFor(type, options.title);

    const text = document.createElement('p');
    text.className = 'brgy-msg-text';
    text.textContent = cleanMessage(options.message);

    body.append(icon, title, text);

    let input = null;
    if (options.input) {
      input = document.createElement('input');
      input.className = 'brgy-msg-input';
      input.value = options.defaultValue || '';
      input.placeholder = options.placeholder || '';
      body.appendChild(input);
    }

    const actions = document.createElement('div');
    actions.className = 'brgy-msg-actions';

    return new Promise((resolve) => {
      function close(value) {
        overlay.remove();
        resolve(value);
      }

      if (options.cancelText) {
        const cancel = document.createElement('button');
        cancel.className = 'brgy-msg-btn brgy-msg-btn-secondary';
        cancel.textContent = options.cancelText;
        cancel.onclick = () => close(options.input ? null : false);
        actions.appendChild(cancel);
      }

      const ok = document.createElement('button');
      ok.className = 'brgy-msg-btn brgy-msg-btn-primary';
      ok.textContent = options.okText || 'OK';
      ok.onclick = () => close(options.input ? input.value : true);
      actions.appendChild(ok);

      card.appendChild(document.createElement('div')).className = 'brgy-msg-top';
      card.append(body, actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      setTimeout(() => {
        ok.focus();
        if (input) input.focus();
      }, 40);

      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ok.click();
        if (e.key === 'Escape') close(options.cancelText ? (options.input ? null : false) : true);
      });
      overlay.tabIndex = -1;
      overlay.focus();
    });
  }

  window.BrgyMessageBox = {
    alert(message, type, title) {
      return open({ message, type: parseType(message, type), title, okText: 'OK' });
    },
    confirm(message, title) {
      return open({ message, type: 'warning', title: title || 'Please Confirm', okText: 'Yes', cancelText: 'Cancel' });
    },
    prompt(message, defaultValue, title) {
      return open({ message, type: 'question', title: title || 'Input Required', okText: 'Save', cancelText: 'Cancel', input: true, defaultValue: defaultValue || '' });
    }
  };

  window.showStyledAlert = window.showStyledAlert || ((message, type, title) => window.BrgyMessageBox.alert(message, type, title));
  window.showStyledConfirm = window.showStyledConfirm || ((message, title) => window.BrgyMessageBox.confirm(message, title));
  window.showStyledPrompt = window.showStyledPrompt || ((message, defaultValue, title) => window.BrgyMessageBox.prompt(message, defaultValue, title));

  const nativeAlert = window.alert;
  window.alert = function (message) {
    if (document.body) return window.BrgyMessageBox.alert(message);
    return nativeAlert(message);
  };
})();
