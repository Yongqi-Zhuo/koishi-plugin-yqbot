import { Session } from 'koishi';

export const getChannelKey = (session: Session) => {
  const { platform, selfId, guildId, channelId } = session;
  return `${platform}.${selfId}.${guildId}.${channelId}`;
};

export const getNickname = async (session: Session, userId: string) => {
  try {
    const member = await session.bot.getGuildMember(session.guildId, userId);
    const nick = member.nick;
    if (nick) return nick;
    return member.user!.name!;
  } catch (e) {
    // If this is not a guild member, we have to get the user.
  }
  try {
    const user = await session.bot.getUser(userId);
    return user.nick || user.name || userId;
  } catch (e) {
    return userId;
  }
};

export const formatDate = (date: Date) => {
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export const formatTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  return formatDate(date);
};
