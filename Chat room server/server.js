const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { WebSocket, WebSocketServer } = require('ws');
const config = require('./config');
const { createAttachmentService } = require('./attachment-service');
const { createConversationService } = require('./conversation-service');
const { createIdentityService } = require('./identity-service');
const { createImageStorage } = require('./image-storage');

/**
 * ============================== 基础配置 ==============================
 * 可编辑配置统一放在 config.js，服务代码只负责读取和校验。
 */
const PUBLIC_DIR = path.resolve(config.publicDir);
const DATABASE_FILE = path.resolve(config.databaseFile);
const IMAGE_DIR = path.resolve(config.imageDir);
const FILE_DIR = path.resolve(config.fileDir);
const VIDEO_DIR = path.resolve(config.videoDir);
const UPLOAD_DIR = path.resolve(config.uploadDir);
const HOST = String(config.host);
const PORT = Number(config.port);
const DEFAULT_AVATAR = String(config.defaultAvatar);
const HISTORY_LIMIT = Number(config.historyLimit);
const MAX_NAME_LENGTH = Number(config.maxNameLength);
const MAX_TEXT_LENGTH = Number(config.maxTextLength);
const MAX_AVATAR_BYTES = Number(config.maxAvatarBytes);
const MAX_IMAGE_BYTES = Number(config.maxImageBytes);
const UPLOAD_CHUNK_BYTES = Number(config.uploadChunkBytes);
const MAX_FILE_BYTES = Number(config.maxFileBytes);
const MAX_VIDEO_BYTES = Number(config.maxVideoBytes);
const UPLOAD_TTL_MS = Number(config.uploadTtlMs);
const MAX_WEBSOCKET_PAYLOAD = MAX_IMAGE_BYTES * 2;

function log(level, message, fields = {}) {
  const details = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
  console.log(`[${new Date().toISOString()}] [${level}] ${message}${details ? ` ${details}` : ''}`);
}

function clientAddress(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (forwarded || request.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

function requestPath(request) {
  try {
    return new URL(request.url, 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function networkAddresses() {
  const addresses = [];
  for (const [name, interfaces] of Object.entries(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push({ name, address: item.address });
    }
  }
  return addresses;
}

function printServerInformation() {
  const lanAddresses = networkAddresses();
  console.log('');
  console.log('============================================================');
  console.log(' Chat Room Server');
  console.log('============================================================');
  console.log(` Node.js       : ${process.version}`);
  console.log(` Process ID    : ${process.pid}`);
  console.log(` Listen        : ${HOST}:${PORT}`);
  console.log(` Local HTTP    : http://127.0.0.1:${PORT}`);
  console.log(` Local WS      : ws://127.0.0.1:${PORT}/ws`);
  if (HOST === '0.0.0.0') {
    for (const item of lanAddresses) {
      console.log(` LAN HTTP      : http://${item.address}:${PORT} (${item.name})`);
      console.log(` LAN WS        : ws://${item.address}:${PORT}/ws (${item.name})`);
    }
  }
  console.log(` Static files  : ${PUBLIC_DIR}`);
  console.log(` Database      : ${DATABASE_FILE}`);
  console.log(` Image storage : ${IMAGE_DIR}`);
  console.log(` File storage  : ${FILE_DIR}`);
  console.log(` Video storage : ${VIDEO_DIR}`);
  console.log(` Upload temp   : ${UPLOAD_DIR}`);
  console.log('============================================================');
  console.log(' Runtime logs');
  console.log('============================================================');
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`config.port 不是有效端口: ${config.port}`);
}

if (!Number.isInteger(HISTORY_LIMIT) || HISTORY_LIMIT < 1 || HISTORY_LIMIT > 500) {
  throw new Error('config.historyLimit 必须是 1 到 500 之间的整数');
}

if (!Number.isInteger(MAX_NAME_LENGTH) || MAX_NAME_LENGTH < 1) {
  throw new Error('config.maxNameLength 必须是正整数');
}

if (!Number.isInteger(MAX_TEXT_LENGTH) || MAX_TEXT_LENGTH < 1) {
  throw new Error('config.maxTextLength 必须是正整数');
}

if (!Number.isInteger(MAX_AVATAR_BYTES) || MAX_AVATAR_BYTES < 1) {
  throw new Error('config.maxAvatarBytes 必须是正整数');
}

if (!Number.isInteger(MAX_IMAGE_BYTES) || MAX_IMAGE_BYTES < 1) {
  throw new Error('config.maxImageBytes 必须是正整数');
}

if (!Number.isInteger(UPLOAD_CHUNK_BYTES) || UPLOAD_CHUNK_BYTES < 1024 * 1024 || UPLOAD_CHUNK_BYTES > 32 * 1024 * 1024) {
  throw new Error('config.uploadChunkBytes 必须是 1 MiB 到 32 MiB 之间的整数');
}

if (!Number.isSafeInteger(MAX_FILE_BYTES) || MAX_FILE_BYTES < 1 || !Number.isSafeInteger(MAX_VIDEO_BYTES) || MAX_VIDEO_BYTES < 1) {
  throw new Error('文件和视频大小限制必须是正安全整数');
}

if (!Number.isSafeInteger(UPLOAD_TTL_MS) || UPLOAD_TTL_MS < 60 * 1000) {
  throw new Error('config.uploadTtlMs 不能小于一分钟');
}

/**
 * ============================== SQLite ==============================
 * SQLite 负责保存消息。即使服务关闭或电脑重启，历史消息仍会保留。
 */
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DATABASE_FILE), { recursive: true });
fs.mkdirSync(IMAGE_DIR, { recursive: true });
const imageStorage = createImageStorage({ directory: IMAGE_DIR, maxBytes: MAX_IMAGE_BYTES });

const database = new DatabaseSync(DATABASE_FILE);
database.exec('PRAGMA journal_mode = WAL');
database.exec('PRAGMA foreign_keys = ON');
const identityService = createIdentityService(database, {
  defaultAvatar: DEFAULT_AVATAR,
  maxNameLength: MAX_NAME_LENGTH
});

// type 与 payload_json 是可扩展设计的核心：新增消息类型时不用修改公共字段。
database.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL DEFAULT 1,
    type TEXT NOT NULL,
    sender_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    avatar TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  )
`);

// 图片原始字节保存在本地文件；SQLite 只保存可检索的哈希与元数据。
database.exec(`
  CREATE TABLE IF NOT EXISTS images (
    hash TEXT PRIMARY KEY,
    storage_name TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )
`);

// 显式的关联表让消息通过图片哈希连接到本地文件索引。
database.exec(`
  CREATE TABLE IF NOT EXISTS message_images (
    message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    image_hash TEXT NOT NULL REFERENCES images(hash)
  )
`);
database.exec(`
  CREATE INDEX IF NOT EXISTS idx_message_images_image_hash
  ON message_images(image_hash)
`);

// 兼容旧版数据库：自动补齐发送者和会话字段。
const messageColumns = database.prepare('PRAGMA table_info(messages)').all();
if (!messageColumns.some((column) => column.name === 'sender_id')) {
  database.exec("ALTER TABLE messages ADD COLUMN sender_id TEXT NOT NULL DEFAULT ''");
}
if (!messageColumns.some((column) => column.name === 'conversation_id')) {
  database.exec('ALTER TABLE messages ADD COLUMN conversation_id INTEGER NOT NULL DEFAULT 1');
}

// 历史消息中的 sender_id 作为旧账号迁移；首次使用时可领取对应 token。
for (const row of database.prepare(`
  SELECT sender_id AS id, name, avatar, MIN(created_at) AS created_at
  FROM messages WHERE sender_id != '' GROUP BY sender_id
`).all()) {
  identityService.ensureLegacyUser({ id: row.id, name: row.name, avatar: row.avatar, createdAt: row.created_at });
}

const conversationService = createConversationService(database, { historyLimit: HISTORY_LIMIT });
for (const row of database.prepare('SELECT id FROM users').all()) conversationService.ensurePublicMember(row.id);
const attachmentService = createAttachmentService(database, {
  assertMember: conversationService.assertMember,
  fileDirectory: FILE_DIR,
  videoDirectory: VIDEO_DIR,
  uploadDirectory: UPLOAD_DIR,
  chunkSize: UPLOAD_CHUNK_BYTES,
  maxFileBytes: MAX_FILE_BYTES,
  maxVideoBytes: MAX_VIDEO_BYTES,
  uploadTtlMs: UPLOAD_TTL_MS
});
// 定时移除过期上传分块与媒体票据，避免长期运行积累临时文件。
const attachmentCleanupTimer = setInterval(() => attachmentService.cleanupExpired(), 30 * 60 * 1000);
attachmentCleanupTimer.unref();
database.exec(`
  UPDATE conversations SET last_message_id = (SELECT MAX(id) FROM messages WHERE conversation_id = 1)
  WHERE id = 1 AND last_message_id IS NULL
`);
database.exec('PRAGMA optimize');

const insertMessageStatement = database.prepare(`
  INSERT INTO messages (id, conversation_id, type, sender_id, name, avatar, created_at, payload_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertImageStatement = database.prepare(`
  INSERT INTO images (hash, storage_name, file_name, mime_type, size, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(hash) DO NOTHING
`);

const insertMessageImageStatement = database.prepare(`
  INSERT INTO message_images (message_id, image_hash)
  VALUES (?, ?)
  ON CONFLICT(message_id) DO UPDATE SET image_hash = excluded.image_hash
`);

const updateMessagePayloadStatement = database.prepare(`
  UPDATE messages SET payload_json = ? WHERE id = ?
`);

const legacyImageMessagesStatement = database.prepare(`
  SELECT id, payload_json FROM messages WHERE type = 'image'
`);

const newestIdRow = database.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM messages').get();
let lastMessageId = Number(newestIdRow.id);

/**
 * 使用创建时间的毫秒时间戳作为唯一 ID。
 * 如果同一毫秒收到多条消息，就在上一个 ID 基础上加 1，避免主键冲突。
 */
function createTimestampId() {
  lastMessageId = Math.max(Date.now(), lastMessageId + 1);
  return lastMessageId;
}

/**
 * ============================== 消息协议 ==============================
 * 客户端发送：
 *   { action: "message.send", data: { conversationId, type, payload } }
 *
 * 服务端广播：
 *   { event: "message", data: { id, type, name, avatar, createdAt, payload } }
 *
 * 当前实现 text/image/video/file，后续仍可通过验证分支扩展 audio 等类型。
 */
function normalizeName(value) {
  const name = String(value || '').trim();
  if (!name) throw new Error('请输入名字');
  if (name.length > MAX_NAME_LENGTH) throw new Error(`名字不能超过 ${MAX_NAME_LENGTH} 个字符`);
  return name;
}

function normalizeAvatar(value) {
  const avatar = String(value || DEFAULT_AVATAR).trim() || DEFAULT_AVATAR;
  if (avatar.length > MAX_AVATAR_BYTES * 2) throw new Error('头像数据过大');

  if (avatar.startsWith('data:')) {
    const match = avatar.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('头像仅支持 PNG、JPEG、GIF 或 WebP');
    if (Buffer.byteLength(match[2], 'base64') > MAX_AVATAR_BYTES) {
      throw new Error(`头像不能超过 ${formatBytes(MAX_AVATAR_BYTES)}`);
    }
    return avatar;
  }

  const isImageAddress = /^(?:\.\/|\/|https?:\/\/).+\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(avatar);
  if (!isImageAddress) throw new Error('头像只支持 PNG、JPEG、GIF 或 WebP 图片');
  return avatar;
}

function validateTextPayload(payload) {
  const text = String(payload && payload.text ? payload.text : '').trim();
  if (!text) throw new Error('文字消息不能为空');
  if (text.length > MAX_TEXT_LENGTH) throw new Error(`文字不能超过 ${MAX_TEXT_LENGTH} 个字符`);
  return { text };
}

const messageTypeHandlers = {
  text: validateTextPayload,
  image: imageStorage.prepare
};

function createMessage(input, authenticatedUser) {
  if (!input || typeof input !== 'object') throw new Error('消息格式无效');

  const conversationId = Number(input.conversationId || 1);
  conversationService.assertMember(conversationId, authenticatedUser.userId);
  const type = String(input.type || '').trim();
  const validatePayload = messageTypeHandlers[type];
  if (!validatePayload && type !== 'file' && type !== 'video') throw new Error(`暂不支持消息类型: ${type || '空'}`);

  const attachment = type === 'file' || type === 'video'
    ? attachmentService.validateMessageAttachment(authenticatedUser.userId, type, input.payload)
    : null;
  const validatedPayload = attachment ? attachment.payload : validatePayload(input.payload);
  const storedImage = type === 'image' ? validatedPayload : null;
  const clientId = /^msg_[a-f0-9-]{12,80}$/i.test(String(input.clientId || '')) ? String(input.clientId) : '';
  const id = createTimestampId();
  const message = {
    id,
    conversationId,
    type,
    senderId: authenticatedUser.userId,
    name: authenticatedUser.name,
    avatar: authenticatedUser.avatar,
    createdAt: new Date(id).toISOString(),
    payload: storedImage ? storedImage.payload : validatedPayload,
    ...(clientId ? { clientId } : {})
  };

  database.exec('BEGIN IMMEDIATE');
  try {
    if (storedImage) {
      insertImageStatement.run(
        storedImage.hash,
        storedImage.storageName,
        storedImage.fileName,
        storedImage.mimeType,
        storedImage.size,
        storedImage.createdAt
      );
    }
    insertMessageStatement.run(
      message.id,
      message.conversationId,
      message.type,
      message.senderId,
      message.name,
      message.avatar,
      message.createdAt,
      JSON.stringify(message.payload)
    );
    if (storedImage) insertMessageImageStatement.run(message.id, storedImage.hash);
    if (attachment) attachmentService.linkMessage(message.id, attachment.row.hash);
    conversationService.updateLastMessage(message.conversationId, message.id);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return message;
}

// 首次启动新版时，将旧消息中的 Data URL 图片迁移到本地文件和哈希索引表。
function migrateLegacyImageMessages() {
  for (const row of legacyImageMessagesStatement.all()) {
    let payload;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      continue;
    }

    if (!payload || !payload.dataUrl) continue;
    try {
      const storedImage = imageStorage.prepare(payload);
      database.exec('BEGIN IMMEDIATE');
      try {
        insertImageStatement.run(
          storedImage.hash,
          storedImage.storageName,
          storedImage.fileName,
          storedImage.mimeType,
          storedImage.size,
          storedImage.createdAt
        );
        updateMessagePayloadStatement.run(JSON.stringify(storedImage.payload), Number(row.id));
        insertMessageImageStatement.run(Number(row.id), storedImage.hash);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    } catch {
      // 损坏或超限的旧数据保持原样，避免启动因历史记录失败。
    }
  }
}

migrateLegacyImageMessages();

/**
 * ============================== HTTP 服务 ==============================
 * HTTP 只负责页面、配置和历史消息；实时收发由同一端口上的 WebSocket 完成。
 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(data));
}

function sendStaticFile(response, filePath, cacheControl = 'no-store') {
  const extension = path.extname(filePath).toLowerCase();
  const stream = fs.createReadStream(filePath);

  stream.on('error', (error) => {
    if (!response.headersSent) sendJson(response, 500, { ok: false, message: error.message });
    else response.destroy(error);
  });

  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Cache-Control': cacheControl
  });
  stream.pipe(response);
}

/** 为文件名生成兼容 ASCII 与 UTF-8 的 Content-Disposition。 */
function contentDisposition(fileName, inline = false) {
  const fallback = String(fileName || 'download').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'download';
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName || 'download')}`;
}

/** 根据标准单段 Range 请求流式返回视频或文件。 */
function sendAttachmentFile(request, response, attachment) {
  const stat = fs.statSync(attachment.filePath);
  const size = stat.size;
  const range = String(request.headers.range || '');
  let start = 0;
  let end = size - 1;
  let statusCode = 200;

  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` });
      response.end();
      return;
    }
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : end;
    } else {
      const suffixLength = Number(match[2]);
      start = Math.max(0, size - suffixLength);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` });
      response.end();
      return;
    }
    end = Math.min(end, size - 1);
    statusCode = 206;
  }

  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': contentDisposition(attachment.payload.fileName, attachment.row.kind === 'video'),
    'Content-Length': end - start + 1,
    'Content-Type': attachment.row.mime_type || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    ETag: `"sha256-${attachment.row.hash}"`,
    'X-Content-SHA256': attachment.row.hash
  };
  if (statusCode === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  response.writeHead(statusCode, headers);
  const stream = fs.createReadStream(attachment.filePath, { start, end });
  stream.on('error', (error) => {
    logError('attachment stream failed', error, { hash: attachment.row.hash });
    if (!response.headersSent) sendJson(response, 500, { ok: false, message: '附件读取失败' });
    else response.destroy(error);
  });
  stream.pipe(response);
}

/**
 * 将 URL 路径安全地解析到 publicDir 内部。
 * 头像等静态资源可以使用 ./avatar.png 这样的相对地址，同时阻止 ../ 路径越界。
 */
function resolvePublicFile(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  const relativeFromPublic = path.relative(PUBLIC_DIR, filePath);
  if (relativeFromPublic.startsWith('..') || path.isAbsolute(relativeFromPublic)) return null;
  return filePath;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('请求体过大'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('JSON 格式无效'));
      }
    });
    request.on('error', reject);
  });
}

/** 读取一个受大小限制的二进制上传分块。 */
function readBinaryBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('上传分块过大'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function authenticateRequest(request) {
  const authorization = String(request.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  return identityService.authenticate(token);
}

function requireAuthenticatedUser(request, response) {
  const user = authenticateRequest(request);
  if (!user) sendJson(response, 401, { ok: false, message: '账号令牌无效或已过期' });
  return user;
}

async function handleHttpRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  const pathname = requestUrl.pathname;

  if (request.method === 'GET' && pathname === '/api/config') {
    sendJson(response, 200, {
      ok: true,
      data: {
        avatar: DEFAULT_AVATAR,
        historyLimit: HISTORY_LIMIT,
        maxNameLength: MAX_NAME_LENGTH,
        maxTextLength: MAX_TEXT_LENGTH,
        maxAvatarBytes: MAX_AVATAR_BYTES,
        maxImageBytes: MAX_IMAGE_BYTES,
        uploadChunkBytes: UPLOAD_CHUNK_BYTES,
        maxFileBytes: MAX_FILE_BYTES,
        maxVideoBytes: MAX_VIDEO_BYTES
      }
    });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/session') {
    const body = await readJsonBody(request);
    let avatar = DEFAULT_AVATAR;
    try { avatar = normalizeAvatar(body.avatar); } catch {}
    const session = identityService.initialize({
      userId: body.userId,
      token: body.token,
      name: normalizeName(body.name || '访客'),
      avatar
    });
    conversationService.ensurePublicMember(session.user.userId);
    sendJson(response, 200, { ok: true, data: { ...session, conversations: conversationService.list(session.user.userId) } });
    return;
  }

  if (request.method === 'PATCH' && pathname === '/api/me') {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const body = await readJsonBody(request);
    const updatedUser = identityService.updateProfile(user.userId, {
      name: normalizeName(body.name),
      avatar: normalizeAvatar(body.avatar)
    });
    sendJson(response, 200, { ok: true, data: updatedUser });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/users') {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    sendJson(response, 200, { ok: true, data: identityService.searchUsers(user.userId, requestUrl.searchParams.get('q')) });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/conversations') {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    sendJson(response, 200, { ok: true, data: conversationService.list(user.userId) });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/conversations/direct') {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const body = await readJsonBody(request);
    const conversationId = conversationService.createDirect(user.userId, String(body.targetUserId || ''));
    const memberIds = conversationService.memberIds(conversationId);
    sendToUserIds(memberIds, 'conversation.updated', { conversationId });
    sendJson(response, 200, { ok: true, data: { conversationId, conversations: conversationService.list(user.userId) } });
    return;
  }

  const messagesMatch = pathname.match(/^\/api\/conversations\/(\d+)\/messages$/);
  if (request.method === 'GET' && messagesMatch) {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const beforeId = Number(requestUrl.searchParams.get('beforeId') || Number.MAX_SAFE_INTEGER);
    sendJson(response, 200, { ok: true, data: conversationService.messages(user.userId, Number(messagesMatch[1]), beforeId) });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/messages') {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    sendJson(response, 200, { ok: true, data: conversationService.messages(user.userId, 1) });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/search') {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    sendJson(response, 200, { ok: true, data: conversationService.search(user.userId, requestUrl.searchParams.get('q')) });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/uploads') {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const body = await readJsonBody(request);
    const state = attachmentService.createUpload(user.userId, body);
    log('UPLOAD', state.completed ? 'attachment deduplicated' : 'upload created or resumed', {
      userId: user.userId,
      conversationId: body.conversationId,
      kind: body.kind,
      uploadId: state.uploadId,
      size: body.size
    });
    sendJson(response, 200, { ok: true, data: state });
    return;
  }

  const uploadStatusMatch = pathname.match(/^\/api\/uploads\/(upl_[a-f0-9]{32})$/);
  if (request.method === 'GET' && uploadStatusMatch) {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    sendJson(response, 200, { ok: true, data: attachmentService.getUpload(user.userId, uploadStatusMatch[1]) });
    return;
  }

  if (request.method === 'DELETE' && uploadStatusMatch) {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const state = await attachmentService.cancelUpload(user.userId, uploadStatusMatch[1]);
    log('UPLOAD', 'upload cancelled', { userId: user.userId, uploadId: uploadStatusMatch[1] });
    sendJson(response, 200, { ok: true, data: state });
    return;
  }

  const uploadPartMatch = pathname.match(/^\/api\/uploads\/(upl_[a-f0-9]{32})\/chunks\/(\d+)$/);
  if (request.method === 'PUT' && uploadPartMatch) {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const chunk = await readBinaryBody(request, UPLOAD_CHUNK_BYTES);
    const state = await attachmentService.writePart(
      user.userId,
      uploadPartMatch[1],
      Number(uploadPartMatch[2]),
      chunk,
      request.headers['x-chunk-sha256'],
      request.headers['content-range']
    );
    sendJson(response, 200, { ok: true, data: state });
    return;
  }

  const uploadCompleteMatch = pathname.match(/^\/api\/uploads\/(upl_[a-f0-9]{32})\/complete$/);
  if (request.method === 'POST' && uploadCompleteMatch) {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const attachment = await attachmentService.completeUpload(user.userId, uploadCompleteMatch[1]);
    log('UPLOAD', 'upload completed', {
      userId: user.userId,
      uploadId: uploadCompleteMatch[1],
      hash: attachment.hash,
      size: attachment.size
    });
    sendJson(response, 200, { ok: true, data: attachment });
    return;
  }

  const attachmentTicketMatch = pathname.match(/^\/api\/attachments\/([a-f0-9]{64})\/ticket$/);
  if (request.method === 'POST' && attachmentTicketMatch) {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const body = await readJsonBody(request);
    const ticket = attachmentService.createDownloadTicket(user.userId, attachmentTicketMatch[1], body.fileName);
    sendJson(response, 200, { ok: true, data: ticket });
    return;
  }

  const attachmentMediaMatch = pathname.match(/^\/media\/attachments\/([a-f0-9]{64})$/);
  if (request.method === 'GET' && attachmentMediaMatch) {
    const attachment = attachmentService.resolveDownload(attachmentMediaMatch[1], requestUrl.searchParams.get('ticket'));
    if (!attachment) {
      sendJson(response, 403, { ok: false, message: '附件访问票据无效或已过期' });
      return;
    }
    sendAttachmentFile(request, response, attachment);
    return;
  }

  if (request.method === 'GET' && pathname.startsWith('/media/images/')) {
    const storageName = pathname.slice('/media/images/'.length);
    if (!/^[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/.test(storageName)) {
      sendJson(response, 404, { ok: false, message: 'Image not found' });
      return;
    }
    const imageFile = path.join(IMAGE_DIR, storageName);
    try {
      if (fs.statSync(imageFile).isFile()) {
        sendStaticFile(response, imageFile, 'public, max-age=31536000, immutable');
        return;
      }
    } catch {
      // 图片文件不存在时返回标准 404。
    }
    sendJson(response, 404, { ok: false, message: 'Image not found' });
    return;
  }

  if (request.method === 'GET') {
    const publicFile = resolvePublicFile(pathname === '/' ? '/index.html' : pathname);
    if (!publicFile) {
      sendJson(response, 403, { ok: false, message: 'Forbidden path' });
      return;
    }

    try {
      if (fs.statSync(publicFile).isFile()) {
        sendStaticFile(response, publicFile);
        return;
      }
    } catch {
      // 文件不存在时继续返回标准 404。
    }
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { ok: false, message: 'Method not allowed' });
    return;
  }

  sendJson(response, 404, { ok: false, message: 'Not found' });
}

const httpServer = http.createServer((request, response) => {
  const startedAt = Date.now();
  response.once('finish', () => {
    log('HTTP', 'request', {
      method: request.method,
      path: requestPath(request),
      status: response.statusCode,
      durationMs: Date.now() - startedAt,
      ip: clientAddress(request)
    });
  });
  handleHttpRequest(request, response).catch((error) => {
    log('ERROR', 'HTTP request failed', { method: request.method, path: requestPath(request), error: error.message });
    if (!response.headersSent) sendJson(response, 400, { ok: false, message: error.message || '服务器内部错误' });
    else response.destroy(error);
  });
});

/**
 * ============================== WebSocket ==============================
 * 所有客户端连接到 /ws。新消息保存成功后才广播，保证页面显示与数据库一致。
 */
const webSocketServer = new WebSocketServer({
  server: httpServer,
  path: '/ws',
  maxPayload: MAX_WEBSOCKET_PAYLOAD
});

function sendSocket(socket, event, data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ event, data }));
  }
}

function broadcast(event, data) {
  for (const client of webSocketServer.clients) sendSocket(client, event, data);
}

const userSockets = new Map();

function sendToUserIds(userIds, event, data) {
  for (const userId of userIds) {
    for (const socket of userSockets.get(userId) || []) sendSocket(socket, event, data);
  }
}

webSocketServer.on('connection', (socket, request) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const token = requestUrl.searchParams.get('token') || '';
  const authenticatedUser = identityService.authenticate(token);
  if (!authenticatedUser) {
    log('WARN', 'WebSocket rejected', { ip: clientAddress(request), reason: 'unauthorized' });
    socket.close(4401, 'Unauthorized');
    return;
  }

  socket.userId = authenticatedUser.userId;
  if (!userSockets.has(socket.userId)) userSockets.set(socket.userId, new Set());
  userSockets.get(socket.userId).add(socket);
  log('WS', 'connected', { userId: socket.userId, ip: clientAddress(request) });
  sendSocket(socket, 'ready', {
    avatar: DEFAULT_AVATAR,
    user: authenticatedUser,
    conversations: conversationService.list(authenticatedUser.userId),
    limits: {
      maxNameLength: MAX_NAME_LENGTH,
      maxTextLength: MAX_TEXT_LENGTH,
      maxAvatarBytes: MAX_AVATAR_BYTES,
      maxImageBytes: MAX_IMAGE_BYTES,
      uploadChunkBytes: UPLOAD_CHUNK_BYTES,
      maxFileBytes: MAX_FILE_BYTES,
      maxVideoBytes: MAX_VIDEO_BYTES
    }
  });

  socket.on('message', (rawData, isBinary) => {
    if (isBinary) {
      sendSocket(socket, 'error', { message: '请使用 JSON 消息协议' });
      return;
    }

    let packet;
    try {
      packet = JSON.parse(rawData.toString('utf8'));

      const currentUser = identityService.authenticate(token);
      if (!currentUser) throw new Error('账号令牌已失效');

      if (packet.action === 'message.revoke') {
        const revokedMessage = conversationService.revoke(
          currentUser,
          Number(packet.data?.conversationId),
          Number(packet.data?.messageId)
        );
        sendToUserIds(conversationService.memberIds(revokedMessage.conversationId), 'message.revoked', revokedMessage);
        log('WS', 'message revoked', {
          messageId: revokedMessage.id,
          conversationId: revokedMessage.conversationId,
          userId: currentUser.userId
        });
        return;
      }

      // action 作为命令扩展点，兼容旧 message 命名。
      if (packet.action !== 'message.send' && packet.action !== 'message') {
        throw new Error(`暂不支持操作: ${packet.action || '空'}`);
      }
      const message = createMessage(packet.data || packet.message, currentUser);
      sendToUserIds(conversationService.memberIds(message.conversationId), 'message', message);
      log('WS', 'message stored and delivered', {
        messageId: message.id,
        conversationId: message.conversationId,
        type: message.type,
        userId: currentUser.userId
      });
    } catch (error) {
      log('WARN', 'WebSocket command failed', { userId: socket.userId, error: error.message });
      sendSocket(socket, 'error', {
        message: error.message,
        clientId: String(packet?.data?.clientId || packet?.message?.clientId || '')
      });
    }
  });

  socket.on('error', (error) => {
    log('ERROR', 'WebSocket error', { userId: socket.userId, error: error.message });
  });

  broadcast('presence', { online: webSocketServer.clients.size });
  socket.on('close', (code) => {
    const sockets = userSockets.get(socket.userId);
    sockets?.delete(socket);
    if (sockets?.size === 0) userSockets.delete(socket.userId);
    broadcast('presence', { online: webSocketServer.clients.size });
    log('WS', 'disconnected', { userId: socket.userId, code, online: webSocketServer.clients.size });
  });
});

httpServer.listen(PORT, HOST, () => {
  printServerInformation();
  log('INFO', 'server ready', { host: HOST, port: PORT });
});

httpServer.on('error', (error) => {
  log('ERROR', 'server startup failed', { code: error.code, error: error.message });
  process.exit(1);
});

// 关闭服务时先断开实时连接，再停止 HTTP 并安全关闭 SQLite。
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(attachmentCleanupTimer);
  log('INFO', 'server shutdown started');
  for (const client of webSocketServer.clients) client.close(1001, 'Server shutdown');
  webSocketServer.close();
  httpServer.close(() => {
    database.close();
    log('INFO', 'server shutdown complete');
    process.exit(0);
  });

  // 调试请求可能保留 HTTP keep-alive 连接；主动关闭，避免 CMD 无法退出。
  httpServer.closeAllConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
