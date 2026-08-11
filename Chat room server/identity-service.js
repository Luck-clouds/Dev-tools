const crypto = require('crypto');

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{6,80}$/;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createIdentityService(database, { defaultAvatar, maxNameLength }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )
  `);

  // 当前不实现好友申请，但保留关系表与 isFriend 返回字段。
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_relations (
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'none' CHECK(status IN ('none', 'friend', 'blocked')),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_user_id, target_user_id)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at)');

  const findUser = database.prepare('SELECT id, name, avatar, created_at, updated_at FROM users WHERE id = ?');
  const countSessions = database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?');
  const insertUser = database.prepare(`
    INSERT INTO users (id, name, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
  `);
  const insertSession = database.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const findSession = database.prepare(`
    SELECT u.id, u.name, u.avatar, u.created_at, u.updated_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `);
  const touchSession = database.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?');
  const updateUser = database.prepare('UPDATE users SET name = ?, avatar = ?, updated_at = ? WHERE id = ?');
  const insertLegacyUser = database.prepare(`
    INSERT INTO users (id, name, avatar, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const searchUsersStatement = database.prepare(`
    SELECT u.id, u.name, u.avatar, u.created_at,
      CASE WHEN r.status = 'friend' THEN 1 ELSE 0 END AS is_friend
    FROM users u
    LEFT JOIN user_relations r
      ON r.owner_user_id = ? AND r.target_user_id = u.id
    WHERE u.id != ? AND (u.id LIKE ? COLLATE NOCASE OR u.name LIKE ? COLLATE NOCASE)
    ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, u.updated_at DESC
    LIMIT 30
  `);

  function publicUser(row) {
    return {
      userId: row.id,
      name: row.name,
      avatar: row.avatar,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function normalizeName(value) {
    const name = String(value || '访客').trim() || '访客';
    return name.slice(0, maxNameLength);
  }

  function createUserId() {
    return `usr_${crypto.randomBytes(12).toString('hex')}`;
  }

  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
    insertSession.run(`ses_${crypto.randomBytes(12).toString('hex')}`, userId, hashToken(token), now.toISOString(), expiresAt, now.toISOString());
    return token;
  }

  function authenticate(token) {
    const rawToken = String(token || '');
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    const row = findSession.get(tokenHash, new Date().toISOString());
    if (!row) return null;
    touchSession.run(new Date().toISOString(), tokenHash);
    return publicUser(row);
  }

  /**
   * 页面初始化时先尝试恢复 token。旧 user_id 只有在尚未签发任何 token 时可领取，
   * 一旦已有会话就不允许其他设备仅凭公开 user_id 冒充。
   */
  function initialize({ userId, token, name, avatar }) {
    const authenticated = authenticate(token);
    if (authenticated) return { user: authenticated, token };

    const requestedId = USER_ID_PATTERN.test(String(userId || '')) ? String(userId) : '';
    const existing = requestedId ? findUser.get(requestedId) : null;
    const canClaimExisting = existing && Number(countSessions.get(requestedId).count) === 0;
    const resolvedId = !existing || canClaimExisting ? (requestedId || createUserId()) : createUserId();
    const now = new Date().toISOString();

    if (!findUser.get(resolvedId)) {
      insertUser.run(resolvedId, normalizeName(name), String(avatar || defaultAvatar), now, now);
    }
    const issuedToken = createSession(resolvedId);
    return { user: publicUser(findUser.get(resolvedId)), token: issuedToken };
  }

  function updateProfile(userId, { name, avatar }) {
    updateUser.run(normalizeName(name), String(avatar || defaultAvatar), new Date().toISOString(), userId);
    return publicUser(findUser.get(userId));
  }

  function ensureLegacyUser({ id, name, avatar, createdAt }) {
    if (!USER_ID_PATTERN.test(String(id || ''))) return;
    const timestamp = createdAt || new Date().toISOString();
    insertLegacyUser.run(id, normalizeName(name), String(avatar || defaultAvatar), timestamp, timestamp);
  }

  function searchUsers(currentUserId, query) {
    const keyword = String(query || '').trim().slice(0, 100);
    if (!keyword) return [];
    const pattern = `%${keyword}%`;
    return searchUsersStatement.all(currentUserId, currentUserId, pattern, pattern, keyword).map((row) => ({
      userId: row.id,
      name: row.name,
      avatar: row.avatar,
      createdAt: row.created_at,
      isFriend: Boolean(row.is_friend)
    }));
  }

  return { authenticate, ensureLegacyUser, initialize, searchUsers, updateProfile };
}

module.exports = { createIdentityService };
