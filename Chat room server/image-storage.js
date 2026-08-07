const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp'
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 创建本地图片存储器。文件名由 SHA-256 内容哈希生成，
 * 相同图片只会保留一份，返回值可直接用于 SQLite 索引和消息 payload。
 */
function createImageStorage({ directory, maxBytes }) {
  const imageDirectory = path.resolve(directory);
  fs.mkdirSync(imageDirectory, { recursive: true });

  function prepare(payload) {
    const dataUrl = String(payload && payload.dataUrl ? payload.dataUrl : '');
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('仅支持 PNG、JPEG、GIF 或 WebP 图片');

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length < 1) throw new Error('图片内容为空');
    if (buffer.length > maxBytes) throw new Error(`图片不能超过 ${formatBytes(maxBytes)}`);

    const mimeType = match[1];
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const storageName = `${hash}${IMAGE_EXTENSIONS[mimeType]}`;

    // wx 避免覆盖已有文件；EEXIST 表示内容已经按哈希去重。
    try {
      fs.writeFileSync(path.join(imageDirectory, storageName), buffer, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    const fileName = String(payload.fileName || 'image').slice(0, 120);
    return {
      hash,
      storageName,
      fileName,
      mimeType,
      size: buffer.length,
      createdAt: new Date().toISOString(),
      payload: {
        hash,
        url: `/media/images/${storageName}`,
        mimeType,
        fileName,
        size: buffer.length
      }
    };
  }

  return { prepare };
}

module.exports = { createImageStorage };
