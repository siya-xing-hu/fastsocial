import type { InteractionPrompt } from "@fast-social/contracts";

export const DEFAULT_INTERACTION_PROMPTS: InteractionPrompt[] = [
  {
    id: "builtin-post-polish-en",
    name: "英文润色",
    scene: "post",
    enabled: true,
    prompt: `你是 X（Twitter）英文写作助手。请将下面草稿改写为自然、简洁、像真人写的英文帖子；保留原意、事实和语气，不添加未提供的信息，不使用标签或 emoji（除非草稿已有），最多 280 个字符。只输出可直接发布的正文。

草稿：
{userContent}`,
  },
  {
    id: "builtin-post-opinion-en",
    name: "观点表达",
    scene: "post",
    enabled: true,
    prompt: `根据下面的想法写一条有明确观点的英文 X 帖子。用一句自然开场，再清晰表达核心判断；避免营销腔和空话，不虚构事实，最多 280 个字符。只输出正文。

想法：
{userContent}`,
  },
  {
    id: "builtin-post-concise-en",
    name: "精简表达",
    scene: "post",
    enabled: true,
    prompt: `将下面内容压缩为更清晰有力的英文 X 帖子，删掉重复和铺垫，保留关键信息与原有立场，最多 240 个字符。只输出正文。

内容：
{userContent}`,
  },
  {
    id: "builtin-reply-natural-en",
    name: "自然回复",
    scene: "reply",
    enabled: true,
    prompt: `你是 X 英文互动助手。根据原帖和我的补充想法，写一条自然、具体、有信息量的英文回复。不要复述原帖，不要空泛夸赞，不虚构事实；1–2 句，最多 240 个字符。只输出回复正文。

原帖：
{replyContent}

我的想法（可能为空）：
{userContent}`,
  },
  {
    id: "builtin-reply-question-en",
    name: "追问细节",
    scene: "reply",
    enabled: true,
    prompt: `阅读原帖，写一个具体、有价值的英文追问，聚焦最值得澄清的实现细节、依据或时间安排。避免泛泛地问 “Can you elaborate?”；只问一个问题，最多 180 个字符。若我的补充不为空，将其作为追问方向。只输出问题。

原帖：
{replyContent}

我的补充：
{userContent}`,
  },
  {
    id: "builtin-reply-agree-en",
    name: "赞同补充",
    scene: "reply",
    enabled: true,
    prompt: `根据原帖写一条英文回复：先具体回应其中一个观点，再补充一个由原帖或我的提示可以合理推出的观察。不要谄媚，不要编造数据；1–2 句，最多 240 个字符。只输出正文。

原帖：
{replyContent}

我的补充：
{userContent}`,
  },
  {
    id: "builtin-reply-disagree-en",
    name: "礼貌反驳",
    scene: "reply",
    enabled: true,
    prompt: `根据原帖写一条克制、尊重的英文回复，指出一个具体的不同看法并简要说明原因。不要攻击作者，不要虚构证据；1–2 句，最多 240 个字符。只输出正文。

原帖：
{replyContent}

我的观点：
{userContent}`,
  },
];
