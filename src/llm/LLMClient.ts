import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';
import { configManager } from '../config';

export class LLMClient {
  private client: Anthropic;
  private config: ReturnType<typeof configManager.getLLMConfig>;

  constructor() {
    this.config = configManager.getLLMConfig();
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    });
  }

  /**
   * 调用AI（用于设计思考阶段：P1/P2/P3）
   */
  async architect(opts: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
  }): Promise<string> {
    return this.call({
      model: this.config.models.architect,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.userPrompt }],
      max_tokens: opts.maxTokens || this.config.defaults.max_tokens,
      temperature: this.config.defaults.temperature.creative,
    });
  }

  /**
   * 调用AI生成代码（用于P4）
   */
  async developer(opts: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
  }): Promise<string> {
    return this.call({
      model: this.config.models.developer,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.userPrompt }],
      max_tokens: opts.maxTokens || this.config.defaults.max_tokens * 2,
      temperature: this.config.defaults.temperature.precise,
    });
  }

  /**
   * 调用AI审查代码（用于P5）
   */
  async reviewer(opts: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
  }): Promise<string> {
    return this.call({
      model: this.config.models.reviewer,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.userPrompt }],
      max_tokens: opts.maxTokens || this.config.defaults.max_tokens,
      temperature: this.config.defaults.temperature.precise,
    });
  }

  /**
   * 通用调用方法
   */
  private async call(params: {
    model: string;
    system: string;
    messages: Anthropic.MessageParam[];
    max_tokens: number;
    temperature: number;
  }): Promise<string> {
    logger.debug(`调用LLM: ${params.model}`);
    logger.debug(`System prompt长度: ${params.system.length} 字符`);
    logger.debug(`User prompt长度: ${params.messages[0].content.toString().length} 字符`);

    const startTime = Date.now();
    
    const response = await this.client.messages.create({
      model: params.model,
      system: params.system,
      messages: params.messages,
      max_tokens: params.max_tokens,
      temperature: params.temperature,
    });

    const elapsed = Date.now() - startTime;
    logger.debug(`LLM响应时间: ${elapsed}ms`);

    // 提取文本内容
    const textContent = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as Anthropic.TextBlock).text)
      .join('\n');

    // 统计token使用
    logger.debug(`输入tokens: ${response.usage?.input_tokens}, 输出tokens: ${response.usage?.output_tokens}`);

    return textContent;
  }

  /**
   * 估算token数量（简单估算：英文1token≈4字符，中文1token≈1字符）
   */
  estimateTokens(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 1 + otherChars * 0.25);
  }

  /**
   * 检查是否超过上下文窗口
   */
  checkContextWindow(text: string): boolean {
    const tokens = this.estimateTokens(text);
    return tokens <= this.config.defaults.context_window;
  }

  /**
   * 压缩上下文（当超过窗口时）
   */
  compressContext(text: string, maxTokens: number): string {
    const currentTokens = this.estimateTokens(text);
    if (currentTokens <= maxTokens) return text;

    // 简单截断策略（实际应使用更智能的摘要）
    const ratio = maxTokens / currentTokens;
    const lines = text.split('\n');
    const keepLines = Math.floor(lines.length * ratio);
    
    logger.warn(`上下文压缩: ${currentTokens} → ${maxTokens} tokens (保留${keepLines}/${lines.length}行)`);
    
    return [
      lines.slice(0, Math.floor(keepLines * 0.3)).join('\n'),  // 开头保留30%
      '\n... (内容已压缩) ...\n',
      lines.slice(-Math.floor(keepLines * 0.7)).join('\n'),    // 结尾保留70%
    ].join('\n');
  }
}

export const llmClient = new LLMClient();
