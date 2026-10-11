/**
 * User-facing reasons for controls that are visible but not connected yet.
 * Every "not connected yet" reason comes from here; state-dependent reasons
 * (such as an unavailable model) stay with the logic that decides them.
 */
export const UNAVAILABLE = {
  dictation: '语音听写尚未接通',
  voiceMode: '实时语音对话尚未开发',
  avatarUpload: '头像上传在 PR-02D 接通',
  permissionEdit: '权限变更在 M2 接入 Claw Policy 后开放',
  darkTheme: '深色主题在 M1 之后提供',
  otherLanguages: '其他语言在 M1 之后提供',
  notifications: '通知在 M2 接入 Bot 运行状态后提供',
  connectorAuth: '连接器授权尚未接通',
} as const
