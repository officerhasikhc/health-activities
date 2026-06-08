(function(){
  var bridgeUrl = window.ATHAR_BRIDGE_URL;
  var bridgeFrame = null;
  var bridgeWindow = null;
  var bridgeOrigin = null;
  var ready = false;
  var seq = 1;
  var pending = {};
  var queue = [];

  function trustedOrigin(origin){
    return origin === 'https://script.google.com' ||
      origin === 'https://script.googleusercontent.com' ||
      /\.googleusercontent\.com$/.test(origin);
  }

  function ensureFrame(){
    if (bridgeFrame || !bridgeUrl) return;
    bridgeFrame = document.createElement('iframe');
    bridgeFrame.src = bridgeUrl;
    bridgeFrame.title = 'Athar server bridge';
    bridgeFrame.setAttribute('aria-hidden', 'true');
    bridgeFrame.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:-9999px;top:-9999px';
    document.body.appendChild(bridgeFrame);
  }

  function flush(){
    while (ready && bridgeWindow && queue.length) post(queue.shift());
  }

  function post(message){
    if (!ready || !bridgeWindow) {
      queue.push(message);
      ensureFrame();
      return;
    }
    bridgeWindow.postMessage(message, bridgeOrigin || '*');
  }

  window.addEventListener('message', function(event){
    var msg = event.data || {};
    if (msg.source !== 'athar-bridge') return;
    if (!trustedOrigin(event.origin)) return;
    bridgeWindow = event.source;
    bridgeOrigin = event.origin;
    if (msg.ready) {
      ready = true;
      flush();
      return;
    }
    if (!msg.id || !pending[msg.id]) return;
    var slot = pending[msg.id];
    delete pending[msg.id];
    if (msg.ok) slot.resolve(msg.data);
    else slot.reject(new Error(msg.error || 'تعذّر الاتصال بالخادم.'));
  });

  window.AtharServer = {
    run: function(fn, args){
      ensureFrame();
      var id = 'req_' + (seq++);
      return new Promise(function(resolve, reject){
        pending[id] = { resolve: resolve, reject: reject };
        post({ source: 'athar', id: id, fn: fn, args: args || [] });
        setTimeout(function(){
          if (!pending[id]) return;
          delete pending[id];
          reject(new Error('انتهت مهلة الاتصال بالخادم.'));
        }, 90000);
      });
    }
  };

  ensureFrame();
})();
