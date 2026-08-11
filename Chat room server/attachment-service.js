const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { once } = require('events');

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UPLOAD_ID_PATTERN = /^upl_[a-f0-9]{32}$/;
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg']);

/** 将用户文件名裁剪为仅用于展示的安全文本。 */
function normalizeFileName(value) {
  const name = path.basename(String(value || 'file')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (name || 'file').slice(0, 180);
}

/** 从展示文件名提取短扩展名，扩展名只参与内容类型展示。 */
function normalizeExtension(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
}

/** 把外部数值收敛为非负安全整数。 */
function normalizeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

/** 为上传会话创建不可预测的标识。 */
function createUploadId() {
  return `upl_${crypto.randomBytes(16).toString('hex')}`;
}

/** 为受保护下载创建短期随机票据。 */
function createTicketId() {
  return crypto.randomBytes(24).toString('base64url');
}

/** 计算内存分块的 SHA-256。 */
function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** 判断目标路径是否仍位于预期根目录内。 */
function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** 校验首期支持视频格式的文件头，避免只信任客户端 MIME。 */
function hasValidVideoSignature(filePath, mimeType) {
  const descriptor = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(16);
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (mimeType === 'video/mp4') return header.subarray(4, 8).toString('ascii') === 'ftyp';
  if (mimeType === 'video/webm') return header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mimeType === 'video/ogg') return header.subarray(0, 4).toString('ascii') === 'OggS';
  return false;
}

/** 创建视频和文件共用的分块上传、索引与下载服务。 */
function createAttachmentService(database, options) {
  const {
    assertMember,
    fileDirectory,
    videoDirectory,
    uploadDirectory,
    chunkSize,
    maxFileBytes,
    maxVideoBytes,
    uploadTtlMs,
    downloadTicketTtlMs = 30 * 60 * 1000
  } = options;

  const roots = {
    file: path.resolve(fileDirectory),
    video: path.resolve(videoDirectory)
  };
  const tempRoot = path.resolve(uploadDirectory);
  for (const directory of [...Object.values(roots), tempRoot]) fs.mkdirSync(directory, { recursive: true });

  database.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      hash TEXT PRIMARY KEY,
      storage_name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('file', 'video')),
      file_name TEXT NOT NULL,
      extension TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      duration_ms INTEGER,
      width INTEGER,
      height INTEGER,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS attachment_owners (
      attachment_hash TEXT NOT NULL REFERENCES attachments(hash) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (attachment_hash, user_id)
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS message_attachments (
      message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      attachment_hash TEXT NOT NULL REFERENCES attachments(hash)
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('file', 'video')),
      expected_hash TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      total_size INTEGER NOT NULL,
      chunk_size INTEGER NOT NULL,
      total_chunks INTEGER NOT NULL,
      duration_ms INTEGER,
      width INTEGER,
      height INTEGER,
      status TEXT NOT NULL CHECK(status IN ('uploading', 'assembling', 'completed', 'failed', 'cancelled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS upload_parts (
      upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      part_index INTEGER NOT NULL,
      size INTEGER NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (upload_id, part_index)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_message_attachments_hash ON message_attachments(attachment_hash)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_uploads_resume ON uploads(user_id, conversation_id, expected_hash, status)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_uploads_expires_at ON uploads(expires_at)');
  database.exec("UPDATE uploads SET status = 'uploading' WHERE status = 'assembling'");

  const findAttachment = database.prepare('SELECT * FROM attachments WHERE hash = ?');
  const findOwnedAttachment = database.prepare(`
    SELECT a.* FROM attachments a
    JOIN attachment_owners owner ON owner.attachment_hash = a.hash
    WHERE a.hash = ? AND owner.user_id = ?
  `);
  const insertOwner = database.prepare(`
    INSERT INTO attachment_owners (attachment_hash, user_id, created_at)
    VALUES (?, ?, ?) ON CONFLICT(attachment_hash, user_id) DO NOTHING
  `);
  const findResumableUpload = database.prepare(`
    SELECT * FROM uploads
    WHERE user_id = ? AND conversation_id = ? AND expected_hash = ? AND kind = ?
      AND status IN ('uploading', 'assembling') AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `);
  const insertUpload = database.prepare(`
    INSERT INTO uploads (
      id, user_id, conversation_id, kind, expected_hash, file_name, mime_type,
      total_size, chunk_size, total_chunks, duration_ms, width, height,
      status, created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?)
  `);
  const findUpload = database.prepare('SELECT * FROM uploads WHERE id = ?');
  const listParts = database.prepare('SELECT part_index, size, hash FROM upload_parts WHERE upload_id = ? ORDER BY part_index');
  const upsertPart = database.prepare(`
    INSERT INTO upload_parts (upload_id, part_index, size, hash, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(upload_id, part_index) DO UPDATE SET size = excluded.size, hash = excluded.hash, created_at = excluded.created_at
  `);
  const updateUploadStatus = database.prepare('UPDATE uploads SET status = ?, updated_at = ? WHERE id = ?');
  const insertAttachment = database.prepare(`
    INSERT INTO attachments (
      hash, storage_name, kind, file_name, extension, mime_type, size,
      duration_ms, width, height, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(hash) DO NOTHING
  `);
  const linkMessageStatement = database.prepare(`
    INSERT INTO message_attachments (message_id, attachment_hash) VALUES (?, ?)
    ON CONFLICT(message_id) DO UPDATE SET attachment_hash = excluded.attachment_hash
  `);
  const canAccessStatement = database.prepare(`
    SELECT 1 AS allowed
    FROM message_attachments ma
    JOIN messages m ON m.id = ma.message_id
    JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
    WHERE ma.attachment_hash = ? AND cm.user_id = ?
    UNION ALL
    SELECT 1 AS allowed FROM attachment_owners WHERE attachment_hash = ? AND user_id = ?
    LIMIT 1
  `);
  const expiredUploads = database.prepare(`
    SELECT id FROM uploads WHERE status IN ('uploading', 'failed', 'cancelled') AND expires_at <= ?
  `);
  const deleteUpload = database.prepare('DELETE FROM uploads WHERE id = ?');
  const downloadTickets = new Map();

  /** 返回附件对客户端公开的可信消息字段。 */
  function publicAttachment(row, displayName = row.file_name) {
    return {
      hash: row.hash,
      url: `/media/${row.kind === 'video' ? 'videos' : 'files'}/${row.hash}`,
      fileName: normalizeFileName(displayName),
      extension: row.extension.replace(/^\./, ''),
      mimeType: row.mime_type,
      size: Number(row.size),
      durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
      width: row.width == null ? null : Number(row.width),
      height: row.height == null ? null : Number(row.height)
    };
  }

  /** 返回上传进度和已完成分块，供客户端恢复断点。 */
  function uploadState(row) {
    const parts = listParts.all(row.id);
    return {
      uploadId: row.id,
      kind: row.kind,
      chunkSize: Number(row.chunk_size),
      totalChunks: Number(row.total_chunks),
      uploadedChunks: parts.map((part) => Number(part.part_index)),
      uploadedBytes: parts.reduce((total, part) => total + Number(part.size), 0),
      status: row.status,
      expiresAt: row.expires_at
    };
  }

  /** 校验上传声明并创建或恢复上传会话。 */
  function createUpload(userId, input) {
    const conversationId = Number(input.conversationId);
    assertMember(conversationId, userId);
    const kind = input.kind === 'video' ? 'video' : 'file';
    const expectedHash = String(input.sha256 || '').toLowerCase();
    if (!HASH_PATTERN.test(expectedHash)) throw new Error('文件 SHA-256 无效');

    const fileName = normalizeFileName(input.fileName);
    const mimeType = String(input.mimeType || 'application/octet-stream').slice(0, 120);
    const totalSize = normalizeInteger(input.size, -1);
    const maxBytes = kind === 'video' ? maxVideoBytes : maxFileBytes;
    if (totalSize < 1 || totalSize > maxBytes) throw new Error(`${kind === 'video' ? '视频' : '文件'}大小超出限制`);
    if (kind === 'video' && !VIDEO_MIME_TYPES.has(mimeType)) throw new Error('视频仅支持 MP4、WebM 或 Ogg');

    const existing = findAttachment.get(expectedHash);
    if (existing && fs.existsSync(path.join(roots[existing.kind], existing.storage_name))) {
      if (existing.kind !== kind) throw new Error('相同内容已以其他附件类型保存');
      insertOwner.run(existing.hash, userId, new Date().toISOString());
      return { completed: true, attachment: publicAttachment(existing, fileName) };
    }

    const now = new Date();
    const resumable = findResumableUpload.get(userId, conversationId, expectedHash, kind, now.toISOString());
    if (resumable) return { completed: false, ...uploadState(resumable) };

    const uploadId = createUploadId();
    const totalChunks = Math.ceil(totalSize / chunkSize);
    const expiresAt = new Date(now.getTime() + uploadTtlMs).toISOString();
    insertUpload.run(
      uploadId,
      userId,
      conversationId,
      kind,
      expectedHash,
      fileName,
      mimeType,
      totalSize,
      chunkSize,
      totalChunks,
      normalizeInteger(input.durationMs, 0) || null,
      normalizeInteger(input.width, 0) || null,
      normalizeInteger(input.height, 0) || null,
      now.toISOString(),
      now.toISOString(),
      expiresAt
    );
    fs.mkdirSync(path.join(tempRoot, uploadId), { recursive: true });
    return { completed: false, ...uploadState(findUpload.get(uploadId)) };
  }

  /** 查询属于当前用户的上传会话。 */
  function getUpload(userId, uploadId) {
    if (!UPLOAD_ID_PATTERN.test(String(uploadId || ''))) throw new Error('上传 ID 无效');
    const row = findUpload.get(uploadId);
    if (!row || row.user_id !== userId) throw new Error('上传任务不存在');
    return uploadState(row);
  }

  /** 校验并原子保存一个上传分块。 */
  async function writePart(userId, uploadId, partIndex, buffer, chunkHash, contentRange) {
    const row = findUpload.get(uploadId);
    if (!row || row.user_id !== userId) throw new Error('上传任务不存在');
    if (row.status !== 'uploading') throw new Error('上传任务当前不可写入');
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error('上传任务已过期');

    const index = Number(partIndex);
    if (!Number.isInteger(index) || index < 0 || index >= Number(row.total_chunks)) throw new Error('分块索引无效');
    const expectedSize = index === Number(row.total_chunks) - 1
      ? Number(row.total_size) - index * Number(row.chunk_size)
      : Number(row.chunk_size);
    if (buffer.length !== expectedSize) throw new Error('分块字节数不正确');
    const rangeMatch = String(contentRange || '').match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    const expectedStart = index * Number(row.chunk_size);
    if (!rangeMatch
      || Number(rangeMatch[1]) !== expectedStart
      || Number(rangeMatch[2]) !== expectedStart + expectedSize - 1
      || Number(rangeMatch[3]) !== Number(row.total_size)) {
      throw new Error('Content-Range 与分块不匹配');
    }

    const actualHash = hashBuffer(buffer);
    if (!HASH_PATTERN.test(String(chunkHash || '')) || actualHash !== String(chunkHash).toLowerCase()) {
      throw new Error('分块哈希校验失败');
    }

    const uploadPath = path.join(tempRoot, uploadId);
    const finalPartPath = path.join(uploadPath, `${index}.part`);
    const temporaryPartPath = path.join(uploadPath, `${index}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    if (!isInside(tempRoot, finalPartPath)) throw new Error('分块路径无效');
    await fs.promises.mkdir(uploadPath, { recursive: true });
    await fs.promises.writeFile(temporaryPartPath, buffer, { flag: 'wx' });
    await fs.promises.rm(finalPartPath, { force: true });
    await fs.promises.rename(temporaryPartPath, finalPartPath);
    upsertPart.run(uploadId, index, buffer.length, actualHash, new Date().toISOString());
    return uploadState(findUpload.get(uploadId));
  }

  /** 将全部分块流式合并为正式内容寻址文件。 */
  async function assembleUpload(row, assembledPath) {
    const output = fs.createWriteStream(assembledPath, { flags: 'wx' });
    const hasher = crypto.createHash('sha256');
    let writtenBytes = 0;

    try {
      for (let index = 0; index < Number(row.total_chunks); index += 1) {
        const partPath = path.join(tempRoot, row.id, `${index}.part`);
        for await (const chunk of fs.createReadStream(partPath)) {
          hasher.update(chunk);
          writtenBytes += chunk.length;
          if (!output.write(chunk)) await once(output, 'drain');
        }
      }
      output.end();
      await once(output, 'finish');
      return { hash: hasher.digest('hex'), size: writtenBytes };
    } catch (error) {
      output.destroy();
      throw error;
    }
  }

  /** 完成上传、校验完整哈希并写入正式附件索引。 */
  async function completeUpload(userId, uploadId) {
    const row = findUpload.get(uploadId);
    if (!row || row.user_id !== userId) throw new Error('上传任务不存在');
    if (row.status === 'completed') {
      const completed = findAttachment.get(row.expected_hash);
      if (!completed) throw new Error('附件索引不存在');
      return publicAttachment(completed, row.file_name);
    }
    if (row.status !== 'uploading') throw new Error('上传任务当前无法完成');

    const parts = listParts.all(uploadId);
    if (parts.length !== Number(row.total_chunks)) throw new Error('仍有分块尚未上传');
    updateUploadStatus.run('assembling', new Date().toISOString(), uploadId);

    const uploadPath = path.join(tempRoot, uploadId);
    const assembledPath = path.join(uploadPath, 'assembled.tmp');
    await fs.promises.rm(assembledPath, { force: true });
    try {
      const assembled = await assembleUpload(row, assembledPath);
      if (assembled.hash !== row.expected_hash || assembled.size !== Number(row.total_size)) {
        throw new Error('完整文件哈希或大小校验失败');
      }
      if (row.kind === 'video' && !hasValidVideoSignature(assembledPath, row.mime_type)) {
        throw new Error('视频文件头与声明格式不匹配');
      }

      const extension = normalizeExtension(row.file_name);
      const storageName = `${assembled.hash}${extension}`;
      const finalPath = path.join(roots[row.kind], storageName);
      if (!isInside(roots[row.kind], finalPath)) throw new Error('附件路径无效');
      if (fs.existsSync(finalPath)) await fs.promises.rm(assembledPath, { force: true });
      else await fs.promises.rename(assembledPath, finalPath);

      const now = new Date().toISOString();
      database.exec('BEGIN IMMEDIATE');
      try {
        insertAttachment.run(
          assembled.hash,
          storageName,
          row.kind,
          row.file_name,
          extension,
          row.mime_type,
          row.total_size,
          row.duration_ms,
          row.width,
          row.height,
          userId,
          now
        );
        insertOwner.run(assembled.hash, userId, now);
        updateUploadStatus.run('completed', now, uploadId);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }

      await fs.promises.rm(uploadPath, { recursive: true, force: true });
      return publicAttachment(findAttachment.get(assembled.hash), row.file_name);
    } catch (error) {
      updateUploadStatus.run('failed', new Date().toISOString(), uploadId);
      await fs.promises.rm(assembledPath, { force: true });
      throw error;
    }
  }

  /** 取消当前用户的上传任务并清理临时分块。 */
  async function cancelUpload(userId, uploadId) {
    const row = findUpload.get(uploadId);
    if (!row || row.user_id !== userId) throw new Error('上传任务不存在');
    if (row.status === 'completed') throw new Error('已完成的上传不能取消');
    updateUploadStatus.run('cancelled', new Date().toISOString(), uploadId);
    const uploadPath = path.join(tempRoot, uploadId);
    if (isInside(tempRoot, uploadPath)) await fs.promises.rm(uploadPath, { recursive: true, force: true });
    return { uploadId, status: 'cancelled' };
  }

  /** 校验附件所有权并生成可信的视频或文件消息 payload。 */
  function validateMessageAttachment(userId, type, payload) {
    const hash = String(payload?.hash || '').toLowerCase();
    if (!HASH_PATTERN.test(hash)) throw new Error('附件哈希无效');
    const row = findOwnedAttachment.get(hash, userId);
    if (!row || row.kind !== type) throw new Error('附件不存在或尚未上传完成');
    const finalPath = path.join(roots[row.kind], row.storage_name);
    if (!fs.existsSync(finalPath)) throw new Error('附件文件不存在');
    return { row, payload: publicAttachment(row, payload?.fileName || row.file_name) };
  }

  /** 在消息事务中建立消息到附件哈希的索引。 */
  function linkMessage(messageId, attachmentHash) {
    linkMessageStatement.run(Number(messageId), attachmentHash);
  }

  /** 检查用户是否上传过或能通过会话消息访问附件。 */
  function canAccess(userId, hash) {
    return Boolean(canAccessStatement.get(hash, userId, hash, userId));
  }

  /** 为原生 video/download URL 创建有限期访问票据。 */
  function createDownloadTicket(userId, hash, fileName) {
    const normalizedHash = String(hash || '').toLowerCase();
    if (!HASH_PATTERN.test(normalizedHash) || !canAccess(userId, normalizedHash)) throw new Error('无权访问该附件');
    const ticket = createTicketId();
    downloadTickets.set(ticket, {
      hash: normalizedHash,
      fileName: fileName ? normalizeFileName(fileName) : '',
      expiresAt: Date.now() + downloadTicketTtlMs
    });
    return { ticket, url: `/media/attachments/${normalizedHash}?ticket=${encodeURIComponent(ticket)}` };
  }

  /** 使用短期票据解析可供 Range 响应读取的附件。 */
  function resolveDownload(hash, ticket) {
    const normalizedHash = String(hash || '').toLowerCase();
    const grant = downloadTickets.get(String(ticket || ''));
    if (!grant || grant.hash !== normalizedHash || grant.expiresAt <= Date.now()) {
      if (grant) downloadTickets.delete(String(ticket || ''));
      return null;
    }
    const row = findAttachment.get(normalizedHash);
    if (!row) return null;
    const filePath = path.join(roots[row.kind], row.storage_name);
    if (!isInside(roots[row.kind], filePath) || !fs.existsSync(filePath)) return null;
    return { row, filePath, payload: publicAttachment(row, grant.fileName || row.file_name) };
  }

  /** 清理过期上传记录、临时分块和下载票据。 */
  function cleanupExpired() {
    const now = new Date().toISOString();
    for (const row of expiredUploads.all(now)) {
      const uploadPath = path.join(tempRoot, row.id);
      if (isInside(tempRoot, uploadPath)) fs.rmSync(uploadPath, { recursive: true, force: true });
      deleteUpload.run(row.id);
    }
    for (const [ticket, grant] of downloadTickets) {
      if (grant.expiresAt <= Date.now()) downloadTickets.delete(ticket);
    }
  }

  cleanupExpired();
  return {
    chunkSize,
    cancelUpload,
    cleanupExpired,
    completeUpload,
    createDownloadTicket,
    createUpload,
    getUpload,
    linkMessage,
    resolveDownload,
    validateMessageAttachment,
    writePart
  };
}

module.exports = { createAttachmentService };
