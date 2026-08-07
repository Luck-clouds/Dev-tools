const path = require('path');

/**
 * 聊天室统一配置。
 * 修改后重新启动 start-chat.cmd 即可生效。
 */
module.exports = {
  // 0.0.0.0 允许同一局域网中的其他设备访问。
  host: '0.0.0.0',

  // HTTP 页面与 WebSocket 共用此端口。
  port: 8091,

  // 用户未设置个人头像时使用的默认图片。
  // Vite 会将 frontend/src/assets/柴郡.png 输出为下面的稳定路径。
  defaultAvatar: '/柴郡.png',

  // 新客户端连接时加载的最近消息数量，允许范围为 1～500。
  historyLimit: 100,

  // 用户名字和文字消息长度限制。
  maxNameLength: 24,
  maxTextLength: 20000,

  // 个人头像上传后会在浏览器压缩，服务端仍执行最终体积校验。
  maxAvatarBytes: 256 * 1024,

  // 单张图片最大字节数，当前为 2 MB。
  maxImageBytes: 2 * 1024 * 1024,

  // 静态页面目录、SQLite 数据库和本地图片文件目录。
  publicDir: path.join(__dirname, 'frontend', 'dist'),
  databaseFile: path.join(__dirname, 'data', 'chat.db'),
  imageDir: path.join(__dirname, 'data', 'images')
};
