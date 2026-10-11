/**
 * User-facing reasons for controls that are visible but not connected yet.
 * Every "not connected yet" reason comes from here; state-dependent reasons
 * (such as an unavailable model) stay with the logic that decides them.
 */
export const UNAVAILABLE = {
  dictation: '语音听写尚未接通',
  voiceMode: '实时语音对话尚未开发',
  avatarUpload: '头像上传在 M2 接通',
  permissionEdit: '权限变更在 M2 接入 Claw Policy 后开放',
  darkTheme: '深色主题在 M1 之后提供',
  otherLanguages: '其他语言在 M1 之后提供',
  notifications: '通知在 M2 接入 Bot 运行状态后提供',
  connectorAuth: '连接器授权尚未接通',
  clawBinding: 'Claw 绑定信息在 M2 接入真实绑定后显示',
  botWorkspace: '工作区在 M2 接入真实绑定后显示',
  routines: '例行任务在 M6 接通',
  identityDocuments: '行为与身份设定在 M2 经 Claw Identity 接通后可查看',
  skills: '技能列表在 M2 从已验证的技能目录读取后开放',
  artifacts: '资料索引、受控打开与预览在 M7 接通',
  memory: '记忆在 M2 接入当前 Bot 的受控只读查询后显示',
  permissionRecords: '这个 Bot 的权限记录在 M2 接入 Claw Policy 后读取',
  computerControl: '本机操作在 M3 接通，届时从这里打开独立的操作视图',
} as const
