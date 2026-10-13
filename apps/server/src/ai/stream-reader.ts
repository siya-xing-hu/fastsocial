type Usage = Record<string, unknown>;
interface Payload {
  choices?: Array<{ index?: number; finish_reason?: string | null; delta?: { content?: string | null }; message?: { content?: string | null } }>;
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string | null;
  usage?: Usage;
  message?: { usage?: Usage };
  type?: string;
  content_block?: { type?: string; text?: string };
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  error?: { message?: string } | string;
}
export interface AIStreamResult { content: string; truncated: boolean; usage: Usage }

/** Both buffered business calls and live chat use the same stream validation. */
export async function readAIResponse(response: Response, format: 'openai' | 'anthropic', onChunk?: (text: string) => void | Promise<void>): Promise<AIStreamResult> {
  const result: AIStreamResult = { content: '', truncated: false, usage: {} };
  let finished = false;
  const payload = (raw: string): Payload => {
    let value: Payload;
    try { value = JSON.parse(raw); } catch { throw new Error('AI 流式响应包含无效 JSON，未采用不完整结果'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI 响应格式无效');
    if (value.error) throw new Error(typeof value.error === 'string' ? value.error : value.error.message || 'AI 流返回错误');
    result.usage = { ...result.usage, ...value.message?.usage, ...value.usage };
    return value;
  };
  const append = async (text: unknown) => {
    if (text === undefined || text === null || text === '') return;
    if (typeof text !== 'string' || finished) throw new Error('AI 流式响应内容顺序或格式无效');
    result.content += text;
    await onChunk?.(text);
  };
  const finish = (reason: string | null | undefined) => {
    if (!reason) return;
    if (reason === 'length' || reason === 'max_tokens') result.truncated = true;
    else if (!['stop', 'end_turn', 'stop_sequence'].includes(reason)) throw new Error(`AI 输出未正常结束（${reason}），未采用不完整结果`);
    finished = true;
  };
  // Some compatible gateways ignore stream:true and return a complete JSON body.
  // Consume that same response; never resend using stream:false.
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    const value = payload(await response.text());
    if (format === 'anthropic') {
      for (const block of value.content ?? []) if (!block.type || block.type === 'text') await append(block.text);
      finish(value.stop_reason);
    } else {
      await append(value.choices?.[0]?.message?.content);
      finish(value.choices?.[0]?.finish_reason);
    }
    return result;
  }
  if (!response.body) throw new Error('AI 服务没有返回数据流');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', data: string[] = [], ended = false, consumed = false;
  const dispatch = async () => {
    if (!data.length) return;
    const raw = data.join('\n').trim(); data = [];
    if (raw === '[DONE]' && format === 'openai') { ended = true; return; }
    if (ended) throw new Error('AI 流式响应在结束标记后仍包含数据');
    const value = payload(raw);
    if (format === 'anthropic') {
      if (value.type === 'content_block_start' && value.content_block?.type === 'text') await append(value.content_block.text);
      if (value.type === 'content_block_delta' && (!value.delta?.type || value.delta.type === 'text_delta')) await append(value.delta?.text);
      if (value.type === 'message_delta') finish(value.delta?.stop_reason);
      if (value.type === 'message_stop') ended = true;
    } else {
      const choice = value.choices?.find(item => item.index === undefined || item.index === 0);
      await append(choice?.delta?.content);
      finish(choice?.finish_reason);
    }
  };
  const line = async (value: string) => {
    if (!value) await dispatch();
    else if (value === 'data') data.push('');
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
    // SSE comments, event names, IDs and retry fields contain no answer text.
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let offset: number;
      while ((offset = buffer.search(/[\r\n]/)) >= 0) {
        // A CRLF delimiter can itself be split across network chunks.
        if (!done && buffer[offset] === '\r' && offset === buffer.length - 1) break;
        const width = buffer[offset] === '\r' && buffer[offset + 1] === '\n' ? 2 : 1;
        const next = buffer.slice(0, offset); buffer = buffer.slice(offset + width);
        await line(next);
      }
      if (done) { consumed = true; break; }
    }
    if (buffer) await line(buffer);
    await dispatch();
    if (!ended && !finished) throw new Error('AI 流式响应未完整结束，未采用不完整结果');
    return result;
  } finally {
    // Parser errors and consumer cancellation must close the underlying HTTP read.
    if (!consumed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
