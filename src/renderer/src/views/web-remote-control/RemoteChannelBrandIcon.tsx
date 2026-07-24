import weixinIcon from '../../assets/remote-channels/weixin.png'
import feishuIcon from '../../assets/remote-channels/feishu.png'
import larkIcon from '../../assets/remote-channels/lark.png'
import telegramIcon from '../../assets/remote-channels/telegram.png'
import type { RemoteChannelProviderId } from './WebRemoteChannelPanel'

const CHANNEL_ICONS: Record<RemoteChannelProviderId, string> = {
  weixin: weixinIcon,
  feishu: feishuIcon,
  lark: larkIcon,
  telegram: telegramIcon
}

export function RemoteChannelBrandIcon({
  provider,
  className,
  size = 22
}: {
  provider: RemoteChannelProviderId
  className?: string
  size?: number
}) {
  return (
    <img
      src={CHANNEL_ICONS[provider]}
      alt=""
      aria-hidden="true"
      className={className ?? 'wrc-brand-img'}
      width={size}
      height={size}
      draggable={false}
    />
  )
}
