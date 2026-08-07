/**
 * 通知工具职责：
 * 1. 统一处理浏览器 Notification API 能力检查。
 * 2. 统一处理通知权限读取与权限申请。
 * 3. 在权限允许时，统一发送系统通知。
 *
 * 适用场景：
 * - 来电提醒
 * - 坐席状态变化提醒
 * - 后台任务完成提醒
 * - 设备测试页通知联调
 *
 * 调用示例 1：只申请通知权限，不立刻发送通知
 * const result = await requestNotificationPermission()
 *
 * if (result.permission === 'granted') {
 *   console.log('通知权限已授权')
 * }
 *
 * 调用示例 2：申请权限并发送一条系统通知
 * const result = await notifyWithPermission({
 *   title: 'Customer Service System',
 *   body: '检测到新的来电事件',
 *   image: '',
 *   icon: '',
 *   tag: 'incoming-call',
 *   onClick: (notification) => {
 *     window.focus()
 *     notification.close()
 *   },
 * })
 *
 * if (result.notification) {
 *   console.log('通知已经发出')
 * }
 */

/**
 * @desc 获取当前网页通知权限状态
 * @returns {'granted' | 'denied' | 'default' | 'unsupported'}
 * 说明：
 * - granted: 已授权，可以直接发送系统通知
 * - denied: 用户明确拒绝，当前页面无法直接弹通知
 * - default: 用户还没做出选择，可以继续申请权限
 * - unsupported: 当前浏览器环境不支持 Notification API
 */
export function getNotificationPermissionStatus() {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }

  const type = {
    granted: "允许",
    denied: "拒绝",
    default: "询问",
    unsupported: "不支持",
  };

  return Notification.permission;
  // return type[Notification.permission];
}


/**
 * @desc 主动申请通知权限
 * @returns {Promise<{
 *   supported: boolean
 *   permission: 'granted' | 'denied' | 'default' | 'unsupported'
 * }>}
 *
 * 说明：
 * - 这个方法只应该在“用户主动点击按钮”之类的交互中调用。
 * - 浏览器通常要求 Notification.requestPermission() 由用户手势触发，
 *   否则可能静默拦截，不弹授权框。
 */
export async function requestNotificationPermission() {
  if (typeof Notification === "undefined") {
    console.warn("[Notification] 当前浏览器不支持 Notification API");
    return {
      supported: false,
      permission: "unsupported",
    };
  }

  let permission = Notification.permission;

  if (permission === "default") {
    permission = await Notification.requestPermission();
  }

  return {
    supported: true,
    permission,
  };
}

/**
 * @desc 统一处理通知权限检查与系统通知发送
 * @param {{
 *   title?: string             // 通知标题
 *   body?: string              // 通知正文内容
 *   image?: string             // 通知大图，可选，默认无
 *   icon?: string              // 通知图标，可选，默认无
 *   tag?: string               // 通知唯一标识，用于合并同类通知
 *   renotify?: boolean         // 同 tag 通知是否重复提醒
 *   onClick?: ((notification: Notification) => void) | null // 点击通知后的回调
 * }} options
 * @returns {Promise<{
 *   supported: boolean         // 当前环境是否支持 Notification API
 *   permission: 'granted' | 'denied' | 'default' | 'unsupported' // 最终权限状态
 *   notification: Notification | null // 成功发送后返回通知实例，否则为 null
 * }>}
 *
 * 工作流程：
 * 1. 先检测浏览器是否支持 Notification API。
 * 2. 读取当前权限状态。
 * 3. 只有在最终权限为 granted 时，才创建 Notification 实例并返回。
 *
 * 说明：
 * - 这个方法不会主动申请权限。
 * - 如果权限还是 default / denied，只返回当前状态，不触发浏览器授权弹窗。
 */
export async function notifyWithPermission(options = {}) {
  if (typeof Notification === "undefined") {
    console.warn("[Notification] 当前浏览器不支持 Notification API");
    return {
      supported: false,
      permission: "unsupported",
      notification: null,
    };
  }

  let permission = Notification.permission;

  if (permission !== "granted") {
    if (permission !== "granted") {
      console.warn(
        `[Notification] 通知权限状态为 ${permission}，不会发送系统通知`,
      );
    }

    return {
      supported: true,
      permission,
      notification: null,
    };
  }

  // 统一构造系统通知实例。
  // image 和 icon 默认不传，保持“可选”而不是强制依赖资源文件。
  const notification = new Notification(options.title || "系统通知", {
    body: options.body || "",
    image: options.image || undefined,
    icon: options.icon || undefined,
    tag: options.tag || "customer-service-system-notification",
    renotify: options.renotify ?? true,
  });

  // 通知点击事件通常用于：
  // - 聚焦当前窗口
  // - 打开某个业务页面
  // - 关闭通知实例
  if (typeof options.onClick === "function") {
    notification.onclick = () => {
      options.onClick(notification);
    };
  }

  return {
    supported: true,
    permission,
    notification,
  };
}
