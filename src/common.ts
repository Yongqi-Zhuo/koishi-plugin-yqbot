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
