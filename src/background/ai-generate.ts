import { openaiCreate } from "../utils/openai";

export async function execGptPrompt(
  operation: string,
  content: string,
): Promise<string> {
  let messageData = [
    {
      "role": "system",
      "content":
        '你是一个 twitter 内容回复者，我需要你按照用户的回复要求，结合待回复的原文，生成一条回复内容，用英文输出，JSON 格式输出，输出格式： {"result": ""}',
    },
    {
      "role": "user",
      "content": `Replies to tweet: '${content}', Reply style: '${operation}'`,
    },
  ];

  const res = await openaiCreate(messageData);
  const result_json = JSON.parse(res);
  return Promise.resolve(result_json.choices[0].message.content);
}
