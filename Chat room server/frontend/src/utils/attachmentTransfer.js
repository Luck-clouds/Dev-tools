import { createSHA256, sha256 } from 'hash-wasm'

const HASH_CHUNK_BYTES = 8 * 1024 * 1024
const UPLOAD_WORKERS = 3

/** 将字节数格式化为适合消息卡片的短文本。 */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`
  return `${(value / 1024 ** 3).toFixed(2)} GiB`
}

/** 将毫秒时长格式化为 mm:ss 或 hh:mm:ss。 */
export function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round((Number(durationMs) || 0) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** 根据浏览器 MIME 判断附件应发布为视频还是普通文件。 */
export function attachmentKind(file) {
  return /^video\/(?:mp4|webm|ogg)$/i.test(file?.type || '') ? 'video' : 'file'
}

/** 发送带 Bearer token 的 JSON 请求并统一处理错误响应。 */
async function requestJson(path, token, options = {}) {
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` }
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  const response = await fetch(path, { ...options, headers })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || '附件请求失败')
  return body.data
}

/** 以固定切片增量计算大文件 SHA-256，避免将完整文件读入内存。 */
export async function hashFile(file, onProgress = () => {}, signal) {
  const hasher = await createSHA256()
  hasher.init()
  let offset = 0
  while (offset < file.size) {
    if (signal?.aborted) throw new DOMException('附件处理已取消', 'AbortError')
    const end = Math.min(file.size, offset + HASH_CHUNK_BYTES)
    const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer())
    hasher.update(bytes)
    offset = end
    onProgress(offset, file.size)
  }
  return hasher.digest('hex')
}

/** 读取浏览器可识别的视频时长和分辨率。 */
export function readVideoMetadata(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')

    /** 释放临时 URL 并返回可用的视频元数据。 */
    function finish(metadata) {
      URL.revokeObjectURL(url)
      resolve(metadata)
    }

    video.preload = 'metadata'
    video.onloadedmetadata = () => finish({
      durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0,
      width: video.videoWidth || 0,
      height: video.videoHeight || 0,
    })
    video.onerror = () => finish({ durationMs: 0, width: 0, height: 0 })
    video.src = url
  })
}

/** 上传单个缺失分块并让服务端校验分块哈希。 */
async function uploadPart({ uploadId, index, file, chunkSize, token, signal }) {
  const start = index * chunkSize
  const end = Math.min(file.size, start + chunkSize)
  const chunk = file.slice(start, end)
  const bytes = new Uint8Array(await chunk.arrayBuffer())
  const chunkHash = await sha256(bytes)
  const response = await fetch(`/api/uploads/${uploadId}/chunks/${index}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end - 1}/${file.size}`,
      'X-Chunk-SHA256': chunkHash,
    },
    body: bytes,
    signal,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || `分块 ${index + 1} 上传失败`)
  return end - start
}

/** 计算上传或哈希阶段的整数百分比。 */
function percent(done, total) {
  return Math.max(0, Math.min(100, Math.round((done / Math.max(1, total)) * 100)))
}

/** 使用单个 HTTP 请求上传附件；服务端仍负责最终哈希和索引。 */
function uploadSimpleAttachment({ file, kind, conversationId, token, videoMetadata, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({
      conversationId: String(conversationId),
      kind,
      fileName: file.name,
      size: String(file.size),
      durationMs: String(videoMetadata.durationMs || 0),
      width: String(videoMetadata.width || 0),
      height: String(videoMetadata.height || 0),
    })
    const request = new XMLHttpRequest()
    const abort = () => request.abort()

    if (signal?.aborted) {
      reject(new DOMException('附件处理已取消', 'AbortError'))
      return
    }

    request.open('POST', `/api/attachments/simple?${query}`)
    request.setRequestHeader('Authorization', `Bearer ${token}`)
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    request.upload.onprogress = (event) => {
      const transferredBytes = event.lengthComputable ? event.loaded : 0
      onProgress({
        stage: 'uploading',
        percent: event.lengthComputable ? percent(event.loaded, event.total) : 0,
        transferredBytes,
        totalBytes: file.size,
      })
    }
    request.onerror = () => reject(new Error('附件上传失败'))
    request.onabort = () => reject(new DOMException('附件处理已取消', 'AbortError'))
    request.onload = () => {
      const body = (() => {
        try { return JSON.parse(request.responseText || '{}') } catch { return {} }
      })()
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(body.message || '附件上传失败'))
        return
      }
      onProgress({ stage: 'completed', percent: 100, transferredBytes: file.size, totalBytes: file.size, hash: body.data?.hash })
      resolve(body.data)
    }
    signal?.addEventListener('abort', abort, { once: true })
    request.addEventListener('loadend', () => signal?.removeEventListener('abort', abort), { once: true })
    onProgress({ stage: 'uploading', percent: 0, transferredBytes: 0, totalBytes: file.size })
    request.send(file)
  })
}

/** 根据服务端开关选择单请求或可恢复分块上传，并返回可信消息 payload。 */
export async function uploadAttachment({ file, kind, conversationId, token, chunked = true, onProgress = () => {}, signal }) {
  const videoMetadata = kind === 'video' ? await readVideoMetadata(file) : {}
  if (!chunked) {
    return uploadSimpleAttachment({ file, kind, conversationId, token, videoMetadata, onProgress, signal })
  }

  onProgress({ stage: 'hashing', percent: 0, transferredBytes: 0, totalBytes: file.size })
  const fileHash = await hashFile(file, (done, total) => {
    onProgress({ stage: 'hashing', percent: percent(done, total), transferredBytes: done, totalBytes: total })
  }, signal)
  const upload = await requestJson('/api/uploads', token, {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      kind,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      sha256: fileHash,
      ...videoMetadata,
    }),
    signal,
  })
  if (upload.completed) {
    onProgress({ stage: 'completed', percent: 100, transferredBytes: file.size, totalBytes: file.size, hash: fileHash })
    return upload.attachment
  }

  const uploaded = new Set(upload.uploadedChunks || [])
  const missing = Array.from({ length: upload.totalChunks }, (_, index) => index).filter((index) => !uploaded.has(index))
  let uploadedBytes = Number(upload.uploadedBytes) || 0
  let cursor = 0

  /** 每个上传工作器顺序领取分块，多个工作器并发提升吞吐。 */
  async function worker() {
    while (cursor < missing.length) {
      const current = cursor
      cursor += 1
      const index = missing[current]
      const written = await uploadPart({
        uploadId: upload.uploadId,
        index,
        file,
        chunkSize: upload.chunkSize,
        token,
        signal,
      })
      uploadedBytes += written
      onProgress({
        stage: 'uploading',
        percent: percent(uploadedBytes, file.size),
        transferredBytes: uploadedBytes,
        totalBytes: file.size,
        uploadId: upload.uploadId,
        hash: fileHash,
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(UPLOAD_WORKERS, Math.max(1, missing.length)) }, () => worker()))
  onProgress({ stage: 'verifying', percent: 100, transferredBytes: file.size, totalBytes: file.size, uploadId: upload.uploadId, hash: fileHash })
  const attachment = await requestJson(`/api/uploads/${upload.uploadId}/complete`, token, { method: 'POST', signal })
  onProgress({ stage: 'completed', percent: 100, transferredBytes: file.size, totalBytes: file.size, hash: fileHash })
  return attachment
}

/** 请求附件的短期媒体票据。 */
export function requestAttachmentTicket(hash, token, fileName = '') {
  return requestJson(`/api/attachments/${encodeURIComponent(hash)}/ticket`, token, {
    method: 'POST',
    body: JSON.stringify({ fileName }),
  })
}
