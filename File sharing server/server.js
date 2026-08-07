const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

/**
 * ==============================
 * 基础路径与运行配置
 * ==============================
 * ROOT: 项目根目录（即 server.js 所在目录）
 * PUBLIC_FILE: 前端主页面
 * BG_FILE: 背景图（前端 CSS 使用 /bg.png）
 * UPLOAD_DIR: 上传文件保存目录
 * LOG_DIR / LOG_FILE: 日志目录与日志文件
 */
const ROOT = __dirname;
const PUBLIC_FILE = path.join(ROOT, 'index.html');
const BG_FILE = path.join(ROOT, 'bg.png');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const LOG_DIR = path.join(ROOT, 'log');
const LOG_FILE = path.join(LOG_DIR, 'server.log');

/**
 * 运行参数支持环境变量覆盖：
 * HOST: 监听地址，默认 0.0.0.0（允许局域网访问）
 * PORT: 监听端口，默认 8090
 * MAX_UPLOAD_SIZE: 单文件最大上传体积，默认 200MB
 */
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8090);
const MAX_UPLOAD_SIZE = Number(process.env.MAX_UPLOAD_SIZE || 200 * 1024 * 1024); // 200MB

/**
 * 启动时确保关键目录存在。
 * recursive: true 可以在目录已存在时静默通过。
 */
function ensureDirs() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 统一时间格式（ISO），便于日志排序和跨时区查看。
 */
function now() {
  return new Date().toISOString();
}

/**
 * 统一日志输出：
 * 1) 输出到控制台
 * 2) 追加写入 log/server.log
 * extra 为可选结构化字段，便于检索问题。
 */
function log(level, message, extra = null) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  const line = `[${now()}] [${level}] ${message}${payload}`;
  console.log(line);
  fs.appendFile(LOG_FILE, line + '\n', () => {});
}

/**
 * 返回标准 JSON 响应。
 */
function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

/**
 * 通用文件响应（流式输出），避免大文件一次性加载进内存。
 */
function sendFile(res, filePath, contentType) {
  fs.createReadStream(filePath)
    .on('error', (err) => {
      log('ERROR', 'Failed to read file', { filePath, error: err.message });
      sendJson(res, 500, { ok: false, message: 'Read file failed' });
    })
    .pipe(
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
      })
    );
}

/**
 * 静态资源响应（按扩展名推断 MIME）。
 * 当前用于 bg.png 等页面素材。
 */
function sendAsset(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  };
  sendFile(res, filePath, mimeMap[ext] || 'application/octet-stream');
}

/**
 * 字节数转人类可读文本，用于前端展示和错误提示。
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 文件名安全清洗：
 * - 去掉路径信息（仅保留 basename）
 * - 替换非法字符
 * - 避免空名
 */
function sanitizeFileName(name) {
  const base = path.basename(name || '').trim();
  const cleaned = base.replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ');
  return cleaned || 'file.bin';
}

/**
 * 将相对路径标准化为安全的 uploads 子路径：
 * - 统一分隔符
 * - 去掉 ., .. 等路径穿越片段
 * - 对每个片段做文件名清洗
 * 返回值使用 / 作为 API 传输格式，落盘前再转换为平台分隔符。
 */
function sanitizeRelativeUploadPath(relativePath) {
  const raw = String(relativePath || '').trim().replace(/\\/g, '/');
  if (!raw) return '';

  const parts = raw
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== '.' && part !== '..')
    .map((part) => sanitizeFileName(part));

  return parts.join('/');
}

/**
 * 将 API 层的相对路径转换为 uploads 下的绝对路径，并做目录边界校验。
 */
function resolveUploadPath(relativePath) {
  const safeRelativePath = sanitizeRelativeUploadPath(relativePath);
  if (!safeRelativePath) return null;

  const normalizedRelative = safeRelativePath.split('/').join(path.sep);
  const absolutePath = path.join(UPLOAD_DIR, normalizedRelative);
  const relativeFromUploadDir = path.relative(UPLOAD_DIR, absolutePath);

  if (
    relativeFromUploadDir.startsWith('..') ||
    path.isAbsolute(relativeFromUploadDir)
  ) {
    return null;
  }

  return {
    safeRelativePath,
    absolutePath
  };
}

/**
 * 生成落盘文件名：原名 + 时间戳 + 随机串。
 * 这样可以避免同名覆盖，仍保留可读性。
 */
function buildStoredName(originalName) {
  const ext = path.extname(originalName);
  const stem = path.basename(originalName, ext);
  const ts = new Date().toISOString().replace(/[\-:.TZ]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stem}_${ts}_${rand}${ext}`;
}

/**
 * 获取客户端 IP（优先 x-forwarded-for）。
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '-';
}

/**
 * 枚举 uploads 目录文件并生成前端列表结构。
 */
function listFiles() {
  const files = [];

  function walk(currentDir, prefix = '') {
    const items = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const item of items) {
      const currentPath = path.join(currentDir, item.name);
      const relativePath = prefix ? `${prefix}/${item.name}` : item.name;

      if (item.isDirectory()) {
        walk(currentPath, relativePath);
        continue;
      }

      if (!item.isFile()) continue;

      const st = fs.statSync(currentPath);
      files.push({
        name: relativePath,
        size: st.size,
        sizeText: formatSize(st.size),
        updatedAt: st.mtime.toISOString(),
        downloadUrl: `/api/download?name=${encodeURIComponent(relativePath)}`
      });
    }
  }

  walk(UPLOAD_DIR);

  // 新文件优先显示
  files.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  return files;
}

/**
 * 处理上传请求（POST /api/upload）。
 * 客户端通过 x-file-name 传原文件名，请求体即文件二进制流。
 */

/**
 * 服务启动时扫描 uploads 目录，提前确认历史文件可用。
 * 扫描结果写入日志，便于快速核对共享目录状态。
 */
function scanUploadsOnStartup() {
  const files = listFiles();
  log('INFO', 'Startup uploads scan completed', {
    count: files.length,
    names: files.slice(0, 50).map((f) => f.name)
  });
  return files;
}
function handleUpload(req, res, reqId) {
  const rawName = req.headers['x-file-name'];
  const rawRelativePath = req.headers['x-file-relative-path'];
  const decodedRelativePath = decodeURIComponent(
    Array.isArray(rawRelativePath) ? rawRelativePath[0] : rawRelativePath || ''
  );
  const decodedName = decodeURIComponent(Array.isArray(rawName) ? rawName[0] : rawName || '');
  const safeOriginalName = sanitizeFileName(decodedName);
  const requestedRelativePath = decodedRelativePath || decodedName;
  const safeRequestedRelativePath = sanitizeRelativeUploadPath(requestedRelativePath);
  const preserveFolderStructure = safeRequestedRelativePath.includes('/');
  const storedRelativePath = preserveFolderStructure
    ? safeRequestedRelativePath
    : buildStoredName(safeOriginalName);
  const resolvedPath = resolveUploadPath(storedRelativePath);

  if (!resolvedPath) {
    sendJson(res, 400, { ok: false, message: 'Invalid file path' });
    return;
  }

  const targetPath = resolvedPath.absolutePath;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  let bytes = 0;
  let aborted = false;
  const writeStream = fs.createWriteStream(targetPath);

  // 上传中做体积限制判断，超过则中断并删除临时文件
  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_UPLOAD_SIZE) {
      aborted = true;
      req.destroy(new Error('File too large'));
      writeStream.destroy();
      fs.unlink(targetPath, () => {});
    }
  });

  req.on('error', (err) => {
    log('ERROR', 'Upload request stream error', { reqId, error: err.message });
  });

  writeStream.on('error', (err) => {
    log('ERROR', 'Upload write stream error', { reqId, error: err.message });
    sendJson(res, 500, { ok: false, message: 'Write file failed' });
  });

  writeStream.on('finish', () => {
    if (aborted) {
      sendJson(res, 413, { ok: false, message: `File too large. Limit ${formatSize(MAX_UPLOAD_SIZE)}` });
      return;
    }

    log('INFO', 'Upload completed', {
      reqId,
      originalName: safeOriginalName,
      storedPath: resolvedPath.safeRelativePath,
      size: bytes,
      ip: getClientIp(req)
    });

    sendJson(res, 200, {
      ok: true,
      message: 'Upload successful',
      file: {
        originalName: safeOriginalName,
        storedPath: resolvedPath.safeRelativePath,
        size: bytes,
        sizeText: formatSize(bytes),
        downloadUrl: `/api/download?name=${encodeURIComponent(resolvedPath.safeRelativePath)}`
      }
    });
  });

  req.pipe(writeStream);
}

/**
 * 处理下载请求（GET /api/download?name=xxx）。
 */
function handleDownload(req, res, reqId, urlObj) {
  const resolvedPath = resolveUploadPath(urlObj.searchParams.get('name') || '');
  if (!resolvedPath) {
    sendJson(res, 400, { ok: false, message: 'Missing file name' });
    return;
  }

  const name = resolvedPath.safeRelativePath;
  const filePath = resolvedPath.absolutePath;

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      sendJson(res, 404, { ok: false, message: 'File not found' });
      return;
    }

    log('INFO', 'Download started', { reqId, file: name, ip: getClientIp(req) });

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': st.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`
    });

    fs.createReadStream(filePath)
      .on('error', (readErr) => {
        log('ERROR', 'Download stream error', { reqId, file: name, error: readErr.message });
        if (!res.headersSent) sendJson(res, 500, { ok: false, message: 'Download failed' });
      })
      .pipe(res);
  });
}

/**
 * 处理删除请求（DELETE /api/file?name=xxx）。
 */
function handleDelete(req, res, reqId, urlObj) {
  const resolvedPath = resolveUploadPath(urlObj.searchParams.get('name') || '');
  if (!resolvedPath) {
    sendJson(res, 400, { ok: false, message: 'Missing file name' });
    return;
  }

  const name = resolvedPath.safeRelativePath;
  const filePath = resolvedPath.absolutePath;

  fs.unlink(filePath, (err) => {
    if (err) {
      sendJson(res, 404, { ok: false, message: 'File not found or already deleted' });
      return;
    }

    // 删除后尝试清理 uploads 下已经空掉的子目录
    let currentDir = path.dirname(filePath);
    while (currentDir !== UPLOAD_DIR) {
      try {
        fs.rmdirSync(currentDir);
      } catch {
        break;
      }
      currentDir = path.dirname(currentDir);
    }

    log('INFO', 'File deleted', { reqId, file: name, ip: getClientIp(req) });
    sendJson(res, 200, { ok: true, message: 'File deleted' });
  });
}

/**
 * 路由总入口：
 * - 页面与静态资源
 * - 文件 API（列表/上传/下载/删除）
 * 同时记录请求入站、出站耗时。
 */
function handleRequest(req, res) {
  const reqId = Math.random().toString(36).slice(2, 10);
  const requestUrl = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  const pathname = requestUrl.pathname;

  const startAt = Date.now();
  log('INFO', 'Request in', {
    reqId,
    method: req.method,
    pathname,
    ip: getClientIp(req)
  });

  res.on('finish', () => {
    log('INFO', 'Request out', {
      reqId,
      status: res.statusCode,
      elapsedMs: Date.now() - startAt
    });
  });

  // 前端主页
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    sendFile(res, PUBLIC_FILE, 'text/html; charset=utf-8');
    return;
  }

  // 背景图片
  if (req.method === 'GET' && pathname === '/bg.png') {
    fs.stat(BG_FILE, (err, st) => {
      if (err || !st.isFile()) {
        sendJson(res, 404, { ok: false, message: 'bg.png not found in root directory' });
        return;
      }
      sendAsset(res, BG_FILE);
    });
    return;
  }

  // 文件列表
  if (req.method === 'GET' && pathname === '/api/files') {
    const files = listFiles();
    sendJson(res, 200, { ok: true, files });
    return;
  }

  // 上传
  if (req.method === 'POST' && pathname === '/api/upload') {
    handleUpload(req, res, reqId);
    return;
  }

  // 下载
  if (req.method === 'GET' && pathname === '/api/download') {
    handleDownload(req, res, reqId, requestUrl);
    return;
  }

  // 删除
  if (req.method === 'DELETE' && pathname === '/api/file') {
    handleDelete(req, res, reqId, requestUrl);
    return;
  }

  sendJson(res, 404, { ok: false, message: 'Not found' });
}

/**
 * 主启动函数：
 * 1) 准备目录与必要文件
 * 2) 创建 HTTP 服务
 * 3) 监听端口并输出启动日志
 */
function main() {
  ensureDirs();

  // 启动即扫描 uploads，确保已有文件可立即在前端列表展示
  scanUploadsOnStartup();

  // 如果页面不存在，写入一个占位页，避免根路由 500
  if (!fs.existsSync(PUBLIC_FILE)) {
    fs.writeFileSync(PUBLIC_FILE, '<h1>index.html not found</h1>', 'utf8');
  }

  const server = http.createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch (err) {
      log('ERROR', 'Unhandled exception', { error: err.message, stack: err.stack });
      sendJson(res, 500, { ok: false, message: 'Internal server error' });
    }
  });

  server.listen(PORT, HOST, () => {
    log('INFO', 'File sharing server started', {
      host: HOST,
      port: PORT,
      url: `http://127.0.0.1:${PORT}`,
      uploadDir: UPLOAD_DIR,
      logFile: LOG_FILE,
      maxUploadSize: formatSize(MAX_UPLOAD_SIZE)
    });
  });

  server.on('error', (err) => {
    log('ERROR', 'Server startup failed', { code: err.code, message: err.message });
    process.exit(1);
  });
}

main();

