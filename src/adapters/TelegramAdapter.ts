import { InputAdapter } from './InputAdapter';
import { NormalizedInput } from '../types';
import { logger } from '../utils/logger';

export class TelegramAdapter implements InputAdapter {
  readonly name = 'telegram';

  async normalize(rawInput: any): Promise<NormalizedInput> {
    logger.debug('处理Telegram输入...');

    // Telegram消息格式
    const message = rawInput.message || rawInput;

    return {
      title: this.extractTitle(message.text || message.caption || ''),
      description: message.text || message.caption || '',
      priority: this.detectPriority(message.text || ''),
      attachments: this.extractAttachments(message),
      source: 'telegram',
      sourceId: `${message.message_id || message.chat?.id || Date.now()}`,
      author: message.from?.username || message.from?.first_name || 'unknown',
      metadata: {
        chatId: message.chat?.id,
        chatType: message.chat?.type,
        messageId: message.message_id,
        date: message.date,
        hasPhoto: !!message.photo,
        hasDocument: !!message.document,
      },
    };
  }

  /**
   * 从消息文本提取标题
   */
  private extractTitle(text: string): string {
    if (!text) return 'Telegram消息';

    // 取第一行作为标题
    const lines = text.split('\n');
    const firstLine = lines[0].trim();
    
    // 如果第一行太长，截断
    if (firstLine.length > 100) {
      return firstLine.substring(0, 97) + '...';
    }
    
    return firstLine || 'Telegram消息';
  }

  /**
   * 检测优先级关键词
   */
  private detectPriority(text: string): 'high' | 'medium' | 'low' {
    if (!text) return 'medium';
    
    const highKeywords = ['紧急', 'urgent', 'critical', 'asap', '重要', 'priority'];
    const lowKeywords = ['nice to have', '低优先级', 'low priority', 'minor'];
    
    const lower = text.toLowerCase();
    
    if (highKeywords.some(kw => lower.includes(kw))) return 'high';
    if (lowKeywords.some(kw => lower.includes(kw))) return 'low';
    
    return 'medium';
  }

  /**
   * 提取附件
   */
  private extractAttachments(message: any): string[] {
    const attachments: string[] = [];

    if (message.photo) {
      // Telegram photo是数组，取最后一个（最大尺寸）
      const photo = Array.isArray(message.photo) 
        ? message.photo[message.photo.length - 1] 
        : message.photo;
      attachments.push(`photo:${photo.file_id}`);
    }

    if (message.document) {
      attachments.push(`document:${message.document.file_name || message.document.file_id}`);
    }

    if (message.voice) {
      attachments.push(`voice:${message.voice.file_id}`);
    }

    return attachments;
  }

  validate(rawInput: any): boolean {
    const message = rawInput.message || rawInput;
    return !!(message.text || message.caption || message.photo || message.document);
  }
}
