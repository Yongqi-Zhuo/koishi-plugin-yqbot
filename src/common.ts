import { Session } from 'koishi';

export const getChannelKey = (session: Session) => {
  const { platform, selfId, guildId, channelId } = session;
  return `${platform}.${selfId}.${guildId}.${channelId}`;
};
