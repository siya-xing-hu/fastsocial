import type { ManagedAccountProfile } from '@fast-social/contracts';

export function profileInstructions(profile: ManagedAccountProfile, fixedLanguage = false): string {
  return [
    '账号 Profile：这是当前执行账号持续使用的身份、受众、表达习惯和边界。',
    `账号主语言：${profile.primaryLanguage}。${fixedLanguage ? '本次监听回复必须使用该语言；任务回复要素和原帖内容均不能改变主语言。' : '默认使用主语言；当前用户明确指定其他语言时遵循用户要求。'}`,
    '本次任务的回复要素优先于 Profile 中的默认话题、语气、篇幅等偏好；未填写要素时，结合原帖与 Profile 决定回复重点。',
    'Profile 中的身份事实和表达边界始终保留；不捏造经历、立场或承诺，不因任务要素放宽发布能力限制。',
    profile.description || '尚未补充个人背景与表达习惯：采用自然、简洁的表达，不虚构个人背景。',
  ].join('\n\n');
}
