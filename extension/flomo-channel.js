(() => {
  'use strict';
  let port = null, sequence = 0;
  const pending = new Map();
  const disconnected = 'flomo 后台连接已断开。请在扩展管理页重新加载本扩展，再刷新页面；当前未保存的内容仍留在输入框，请先复制保存。';
  function connect() {
    if (port) return port;
    const connection = chrome.runtime.connect({ name: 'inner-garden-flomo' });
    port = connection;
    connection.onMessage.addListener(message => {
      const task = pending.get(message.requestId);
      if (!task) return;
      pending.delete(message.requestId); clearTimeout(task.timer);
      if (message.ok) task.resolve(message.result);
      else task.reject(new Error(message.error || '操作未完成，内容未清空'));
    });
    connection.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port !== connection) return;
      port = null;
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error(disconnected)); }
      pending.clear();
    });
    return connection;
  }
  globalThis.InnerGardenFlomoChannel = {
    request(message) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('后台尚未确认操作结果，请保留输入并重新连接查看记录，避免重复提交。')); }, message.method === 'sync' ? 180000 : 30000);
        pending.set(id, { resolve, reject, timer });
        try { connect().postMessage({ ...message, requestId: id }); }
        catch (_) { clearTimeout(timer); pending.delete(id); reject(new Error(disconnected)); }
      });
    }
  };
})();
