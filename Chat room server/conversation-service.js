function createConversationService(database, { historyLimit }) {
  const messageColumns = database.prepare('PRAGMA table_info(messages)').all();
  if (!messageColumns.some((column) => column.name === 'revoked_at')) {
    database.exec('ALTER TABLE messages ADD COLUMN revoked_at TEXT');
  }
  if (!messageColumns.some((column) => column.name === 'revoked_by')) {
    database.exec('ALTER TABLE messages ADD COLUMN revoked_by TEXT');
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('public', 'direct')),
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_message_id INTEGER
    )
  `);
  database.exec(`
    INSERT INTO conversations (id, type, title, created_at)
    VALUES (1, 'public', '公共客厅', datetime('now'))
    ON CONFLICT(id) DO NOTHING
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_message_id INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, user_id)
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS direct_conversations (
      conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      user_low_id TEXT NOT NULL REFERENCES users(id),
      user_high_id TEXT NOT NULL REFERENCES users(id),
      UNIQUE (user_low_id, user_high_id),
      CHECK (user_low_id < user_high_id)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members(user_id, conversation_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id, id DESC)');

  const addMember = database.prepare(`
    INSERT INTO conversation_members (conversation_id, user_id, joined_at)
    VALUES (?, ?, ?)
    ON CONFLICT(conversation_id, user_id) DO NOTHING
  `);
  const findUser = database.prepare('SELECT id FROM users WHERE id = ?');
  const findDirect = database.prepare(`
    SELECT conversation_id FROM direct_conversations WHERE user_low_id = ? AND user_high_id = ?
  `);
  const insertConversation = database.prepare(`
    INSERT INTO conversations (id, type, title, created_at) VALUES (?, 'direct', '', ?)
  `);
  const insertDirect = database.prepare(`
    INSERT INTO direct_conversations (conversation_id, user_low_id, user_high_id) VALUES (?, ?, ?)
  `);
  const memberCheck = database.prepare(`
    SELECT 1 AS allowed FROM conversation_members WHERE conversation_id = ? AND user_id = ?
  `);
  const memberIdsStatement = database.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?');
  const updateLastMessage = database.prepare('UPDATE conversations SET last_message_id = ? WHERE id = ?');
  const markReadStatement = database.prepare(`
    UPDATE conversation_members
    SET last_read_message_id = MAX(last_read_message_id, ?)
    WHERE conversation_id = ? AND user_id = ?
  `);
  const messagesStatement = database.prepare(`
    SELECT id, conversation_id, type, sender_id, name, avatar, created_at, payload_json
    FROM messages
    WHERE conversation_id = ? AND id < ?
    ORDER BY id DESC LIMIT ?
  `);
  const conversationsStatement = database.prepare(`
    SELECT c.id, c.type, c.title, c.created_at, c.last_message_id,
      m.type AS last_type, m.name AS last_name, m.payload_json AS last_payload, m.created_at AS last_created_at,
      peer.id AS peer_id, peer.name AS peer_name, peer.avatar AS peer_avatar,
      (SELECT COUNT(*) FROM messages unread
       WHERE unread.conversation_id = c.id
         AND unread.id > cm.last_read_message_id
         AND unread.sender_id != cm.user_id) AS unread_count
    FROM conversation_members cm
    JOIN conversations c ON c.id = cm.conversation_id
    LEFT JOIN messages m ON m.id = c.last_message_id
    LEFT JOIN conversation_members peer_member
      ON peer_member.conversation_id = c.id AND peer_member.user_id != cm.user_id AND c.type = 'direct'
    LEFT JOIN users peer ON peer.id = peer_member.user_id
    WHERE cm.user_id = ?
    ORDER BY COALESCE(c.last_message_id, c.id) DESC
  `);
  const searchMessagesStatement = database.prepare(`
    SELECT m.id, m.conversation_id, m.type, m.sender_id, m.name, m.avatar, m.created_at, m.payload_json
    FROM messages m
    JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
    WHERE cm.user_id = ?
      AND (m.name LIKE ? COLLATE NOCASE OR m.payload_json LIKE ? COLLATE NOCASE)
    ORDER BY m.id DESC LIMIT 60
  `);
  const findMessageStatement = database.prepare(`
    SELECT id, conversation_id, type, sender_id, name, avatar, created_at, payload_json
    FROM messages WHERE id = ? AND conversation_id = ?
  `);
  const revokeMessageStatement = database.prepare(`
    UPDATE messages
    SET type = 'notice', payload_json = ?, revoked_at = ?, revoked_by = ?
    WHERE id = ? AND conversation_id = ? AND sender_id = ? AND type != 'notice'
  `);

  let lastConversationId = Number(database.prepare('SELECT COALESCE(MAX(id), 1) AS id FROM conversations').get().id);
  const nextConversationId = () => {
    lastConversationId = Math.max(Date.now(), lastConversationId + 1);
    return lastConversationId;
  };

  function rowToMessage(row) {
    return {
      id: Number(row.id),
      conversationId: Number(row.conversation_id),
      type: row.type,
      senderId: row.sender_id,
      name: row.name,
      avatar: row.avatar,
      createdAt: row.created_at,
      payload: JSON.parse(row.payload_json)
    };
  }

  function ensurePublicMember(userId) {
    addMember.run(1, userId, new Date().toISOString());
  }

  function isMember(conversationId, userId) {
    return Boolean(memberCheck.get(Number(conversationId), userId));
  }

  function assertMember(conversationId, userId) {
    if (!isMember(conversationId, userId)) throw new Error('无权访问该会话');
  }

  function createDirect(userId, targetUserId) {
    if (userId === targetUserId) throw new Error('不能邀请自己单聊');
    if (!findUser.get(targetUserId)) throw new Error('用户不存在');
    const [lowId, highId] = [userId, targetUserId].sort();
    const existing = findDirect.get(lowId, highId);
    if (existing) return Number(existing.conversation_id);

    const conversationId = nextConversationId();
    const now = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
      // 再次查询配合 UNIQUE 约束，避免两端同时邀请创建重复单聊。
      const raced = findDirect.get(lowId, highId);
      if (raced) {
        database.exec('COMMIT');
        return Number(raced.conversation_id);
      }
      insertConversation.run(conversationId, now);
      insertDirect.run(conversationId, lowId, highId);
      addMember.run(conversationId, lowId, now);
      addMember.run(conversationId, highId, now);
      database.exec('COMMIT');
      return conversationId;
    } catch (error) {
      database.exec('ROLLBACK');
      const resolved = findDirect.get(lowId, highId);
      if (resolved) return Number(resolved.conversation_id);
      throw error;
    }
  }

  function list(userId) {
    return conversationsStatement.all(userId).map((row) => ({
      id: Number(row.id),
      type: row.type,
      title: row.type === 'direct' ? (row.peer_name || '未知用户') : row.title,
      avatar: row.type === 'direct' ? row.peer_avatar : '',
      peerUserId: row.peer_id || null,
      isFriend: false,
      unreadCount: Number(row.unread_count),
      lastMessage: row.last_message_id ? {
        id: Number(row.last_message_id),
        type: row.last_type,
        name: row.last_name,
        payload: JSON.parse(row.last_payload),
        createdAt: row.last_created_at
      } : null
    }));
  }

  function messages(userId, conversationId, beforeId = Number.MAX_SAFE_INTEGER) {
    assertMember(conversationId, userId);
    const rows = messagesStatement.all(Number(conversationId), Number(beforeId), historyLimit).reverse();
    if (rows.length) markReadStatement.run(Number(rows.at(-1).id), Number(conversationId), userId);
    return rows.map(rowToMessage);
  }

  function search(userId, query) {
    const keyword = String(query || '').trim().slice(0, 100);
    if (!keyword) return [];
    const pattern = `%${keyword}%`;
    return searchMessagesStatement.all(userId, pattern, pattern).map(rowToMessage);
  }

  function revoke(user, conversationId, messageId) {
    assertMember(conversationId, user.userId);
    const original = findMessageStatement.get(Number(messageId), Number(conversationId));
    if (!original) throw new Error('消息不存在');
    if (original.sender_id !== user.userId) throw new Error('只能撤回自己发送的消息');
    if (original.type === 'notice') throw new Error('该消息已经撤回');

    const payload = {
      noticeType: 'message.recalled',
      text: `${user.name}撤回了一条消息`,
      actorUserId: user.userId,
      originalType: original.type
    };
    const changed = revokeMessageStatement.run(
      JSON.stringify(payload),
      new Date().toISOString(),
      user.userId,
      Number(messageId),
      Number(conversationId),
      user.userId
    );
    if (Number(changed.changes) !== 1) throw new Error('消息撤回失败');
    return rowToMessage(findMessageStatement.get(Number(messageId), Number(conversationId)));
  }

  return {
    assertMember,
    createDirect,
    ensurePublicMember,
    isMember,
    list,
    markRead: (userId, conversationId, messageId) => {
      assertMember(conversationId, userId);
      markReadStatement.run(Number(messageId), Number(conversationId), userId);
    },
    memberIds: (conversationId) => memberIdsStatement.all(Number(conversationId)).map((row) => row.user_id),
    messages,
    revoke,
    search,
    updateLastMessage: (conversationId, messageId) => updateLastMessage.run(Number(messageId), Number(conversationId))
  };
}

module.exports = { createConversationService };
