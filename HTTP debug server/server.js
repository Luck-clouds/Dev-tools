const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

function envFlag(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const ENABLE_HTTPS = envFlag('DEBUG_SERVER_HTTPS');
const ROOT = path.resolve(process.env.DEBUG_SERVER_ROOT || path.join(__dirname, 'public'));
const HOST = process.env.DEBUG_SERVER_HOST || '127.0.0.1';
const PORT = Number(process.env.DEBUG_SERVER_PORT || (ENABLE_HTTPS ? 8443 : 5050));
const LOG_BODY_LIMIT = Number(process.env.DEBUG_LOG_BODY_LIMIT || 2048);
const ENABLE_CORS = process.env.DEBUG_SERVER_CORS !== 'false';
const PROXY_PREFIX = process.env.DEBUG_PROXY_PREFIX || '/api/';
const PROXY_TARGET = process.env.DEBUG_PROXY_TARGET || '';
const HTTPS_KEY_PATH = path.resolve(
  process.env.DEBUG_SERVER_HTTPS_KEY || path.join(__dirname, 'cert', 'server-key.pem')
);
const HTTPS_CERT_PATH = path.resolve(
  process.env.DEBUG_SERVER_HTTPS_CERT || path.join(__dirname, 'cert', 'server-cert.pem')
);
const HTTPS_PASSPHRASE = process.env.DEBUG_SERVER_HTTPS_PASSPHRASE || '';
const PROTOCOL = ENABLE_HTTPS ? 'https' : 'http';

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`DEBUG_SERVER_PORT 不是有效端口: ${process.env.DEBUG_SERVER_PORT || PORT}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8'
};

function ts() {
  return new Date().toISOString();
}

function log(title, payload) {
  const line = `[${ts()}] ${title}`;
  if (payload === undefined) console.log(line);
  else console.log(line, payload);
  console.log('------------------------------------------------------------');
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data, null, 2));
}

function applyCors(res) {
  if (!ENABLE_CORS) return;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function previewBody(buffer) {
  if (!buffer || buffer.length === 0) return '';
  const text = buffer.toString('utf8');
  if (text.length <= LOG_BODY_LIMIT) return text;
  return `${text.slice(0, LOG_BODY_LIMIT)} ...(truncated)`;
}

function underRoot(fullPath) {
  const relativePath = path.relative(ROOT, fullPath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

function resolveFile(urlPath) {
  const requestedPath = decodeURIComponent(urlPath.split('?')[0]);
  const safeRelativePath = path.normalize(requestedPath.replace(/^\/+/, '') || 'index.html');
  const fullPath = path.resolve(ROOT, safeRelativePath);
  return underRoot(fullPath) ? fullPath : null;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function scanRootFiles(rootDir) {
  let fileCount = 0;
  let totalBytes = 0;
  const samples = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        fileCount += 1;
        totalBytes += stat.size;
        if (samples.length < 12) samples.push(path.relative(rootDir, fullPath));
      }
    }
  }

  walk(rootDir);
  return { fileCount, totalBytes, humanSize: formatBytes(totalBytes), samples };
}

function ensureRootReady() {
  if (!fs.existsSync(ROOT)) {
    fs.mkdirSync(ROOT, { recursive: true });
    log('已创建静态目录', { root: ROOT });
  }

  const indexPath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      [
        '<!doctype html>',
        '<html lang="zh-CN">',
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>HTTP 调试服务器</title></head>',
        '<body><h1>HTTP 调试服务器已启动</h1>',
        '<p>请将前端 dist 内部的文件复制到 public 目录后刷新页面。</p>',
        '</body></html>'
      ].join(''),
      'utf8'
    );
  }
}

function createProxyRequest(req, res, bodyBuffer) {
  let targetBase;
  try {
    targetBase = new URL(PROXY_TARGET);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: 'Invalid proxy target',
      message: error.message,
      target: PROXY_TARGET
    });
    return;
  }

  if (!['http:', 'https:'].includes(targetBase.protocol)) {
    sendJson(res, 500, {
      ok: false,
      error: 'Unsupported proxy protocol',
      target: PROXY_TARGET
    });
    return;
  }

  const requestUrl = new URL(req.url, `${PROTOCOL}://${req.headers.host || `${HOST}:${PORT}`}`);
  const upstreamUrl = new URL(requestUrl.pathname + requestUrl.search, targetBase);
  const isHttps = upstreamUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const proxyRequest = transport.request(
    {
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || (isHttps ? 443 : 80),
      method: req.method,
      path: upstreamUrl.pathname + upstreamUrl.search,
      headers: {
        ...req.headers,
        host: upstreamUrl.host,
        connection: 'close'
      }
    },
    (proxyResponse) => {
      res.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
      proxyResponse.pipe(res);
    }
  );

  proxyRequest.on('error', (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    sendJson(res, 502, {
      ok: false,
      error: 'Proxy failed',
      message: error.message,
      target: upstreamUrl.toString()
    });
  });

  if (bodyBuffer.length > 0) proxyRequest.write(bodyBuffer);
  proxyRequest.end();
}

function sendStaticFile(res, filePath, contentType) {
  const stream = fs.createReadStream(filePath);
  stream.on('error', (error) => {
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: error.message });
    else res.destroy(error);
  });
  stream.pipe(res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }));
}

async function handle(req, res) {
  const start = Date.now();
  applyCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `${PROTOCOL}://${req.headers.host || `${HOST}:${PORT}`}`);
  const pathname = requestUrl.pathname;
  const query = Object.fromEntries(requestUrl.searchParams.entries());
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-';
  const body = await readBody(req);

  log(`REQ ${req.method} ${pathname}`, {
    ip,
    query,
    headers: req.headers,
    bodyBytes: body.length,
    bodyPreview: previewBody(body)
  });

  const originalWriteHead = res.writeHead.bind(res);
  let responseLogged = false;
  res.writeHead = (statusCode, ...args) => {
    if (!responseLogged) {
      responseLogged = true;
      log(`RES ${req.method} ${pathname}`, {
        status: statusCode,
        elapsedMs: Date.now() - start
      });
    }
    return originalWriteHead(statusCode, ...args);
  };

  if (pathname === '/__debug/health') {
    sendJson(res, 200, {
      ok: true,
      time: ts(),
      protocol: PROTOCOL,
      https: ENABLE_HTTPS,
      root: ROOT,
      node: process.version,
      pid: process.pid,
      proxyTarget: PROXY_TARGET || null
    });
    return;
  }

  if (pathname === '/__debug/echo') {
    sendJson(res, 200, {
      ok: true,
      method: req.method,
      path: pathname,
      query,
      headers: req.headers,
      body: body.toString('utf8')
    });
    return;
  }

  if (PROXY_TARGET && pathname.startsWith(PROXY_PREFIX)) {
    createProxyRequest(req, res, body);
    return;
  }

  const filePath = resolveFile(pathname === '/' ? '/index.html' : pathname);
  if (!filePath) {
    sendJson(res, 403, { ok: false, error: 'Forbidden path' });
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (!error && stat.isFile()) {
      const extension = path.extname(filePath).toLowerCase();
      sendStaticFile(res, filePath, MIME[extension] || 'application/octet-stream');
      return;
    }

    const fallbackPath = path.join(ROOT, 'index.html');
    fs.stat(fallbackPath, (fallbackError, fallbackStat) => {
      if (fallbackError || !fallbackStat.isFile()) {
        sendJson(res, 404, { ok: false, error: 'File not found', path: pathname });
        return;
      }
      sendStaticFile(res, fallbackPath, 'text/html; charset=utf-8');
    });
  });
}

function readHttpsOptions() {
  const missingFiles = [HTTPS_KEY_PATH, HTTPS_CERT_PATH].filter((filePath) => !fs.existsSync(filePath));
  if (missingFiles.length > 0) {
    throw new Error(
      `HTTPS 已开启，但证书文件不存在: ${missingFiles.join(', ')}。` +
      '请放入证书文件，或设置 DEBUG_SERVER_HTTPS_KEY / DEBUG_SERVER_HTTPS_CERT。'
    );
  }

  const options = {
    key: fs.readFileSync(HTTPS_KEY_PATH),
    cert: fs.readFileSync(HTTPS_CERT_PATH)
  };
  if (HTTPS_PASSPHRASE) options.passphrase = HTTPS_PASSPHRASE;
  return options;
}

function requestListener(req, res) {
  handle(req, res).catch((error) => {
    log('ERR unhandled', { message: error.message, stack: error.stack });
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: 'Internal error', message: error.message });
    } else {
      res.destroy(error);
    }
  });
}

ensureRootReady();
const scanned = scanRootFiles(ROOT);

log('静态目录扫描完成', {
  root: ROOT,
  fileCount: scanned.fileCount,
  totalSize: scanned.humanSize
});

if (scanned.fileCount <= 1) {
  log('提示', '请将前端 dist 内部文件复制到 public 目录，不要再嵌套一层 dist');
} else {
  log('静态文件样例', scanned.samples);
}

let server;
try {
  server = ENABLE_HTTPS
    ? https.createServer(readHttpsOptions(), requestListener)
    : http.createServer(requestListener);
} catch (error) {
  log('ERR HTTPS config', { message: error.message });
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  const baseUrl = `${PROTOCOL}://${HOST}:${PORT}`;
  log('调试服务器启动成功', {
    url: baseUrl,
    protocol: PROTOCOL,
    root: ROOT,
    cors: ENABLE_CORS,
    proxyPrefix: PROXY_PREFIX,
    proxyTarget: PROXY_TARGET || null,
    certificate: ENABLE_HTTPS ? HTTPS_CERT_PATH : null
  });
  log('调试接口', {
    health: `${baseUrl}/__debug/health`,
    echo: `${baseUrl}/__debug/echo`
  });
});

server.on('error', (error) => {
  log('ERR startup', { code: error.code, message: error.message });
  process.exit(1);
});
