/**
 * 服务子进程的进程级兜底（`--import` 预加载，跑在 adapter-node 之前）。
 *
 * 观看页拖进度条 / 切集时，播放器会中途掐掉正在传的视频代理响应（/api/stream/…），
 * 静态资源也可能在写到一半时被窗口刷新打断 —— 这些纯 I/O 错误要是没人监听，
 * Node 会把它当未捕获异常直接退出，整个客户端就要重启服务。
 * 只放过这几类与单个请求绑定、不影响进程状态的错误；其余照旧退出，由主进程重启。
 */
const SURVIVABLE = new Set(['EPIPE', 'ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE']);
const stamp = () => new Date().toISOString();

process.on('uncaughtException', (err) => {
  const code = err?.code ?? err?.name;
  // ENOENT 只放过读 / 打开静态文件时文件消失（构建产物被换掉）；spawn 等别处的 ENOENT 照常退出
  const staleFile = code === 'ENOENT' && ['open', 'stat', 'read', 'lstat'].includes(err?.syscall);
  if (SURVIVABLE.has(code) || staleFile) {
    console.error(`[${stamp()}] 已兜住 ${code}：${err?.message ?? err}`);
    return;
  }
  console.error(`[${stamp()}] 未捕获异常，服务退出（主进程会重启）\n`, err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[${stamp()}] 未处理的 Promise rejection：`, reason);
});
