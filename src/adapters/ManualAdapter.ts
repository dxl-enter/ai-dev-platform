import { InputAdapter } from './InputAdapter';
import { NormalizedInput } from '../types';
import { logger } from '../utils/logger';

export class ManualAdapter implements InputAdapter {
  readonly name = 'manual';

  async normalize(rawInput: any): Promise<NormalizedInput> {
    logger.debug('处理手动输入...');

    // 支持多种手动输入格式

    // 格式1：你的卡片JSON数据
    if (rawInput.card) {
      return this.normalizeFromCard(rawInput);
    }

    // 格式2：纯文本描述
    if (typeof rawInput === 'string') {
      return {
        title: rawInput.substring(0, 100),
        description: rawInput,
        priority: 'medium',
        attachments: [],
        source: 'manual',
        sourceId: `manual-${Date.now()}`,
        author: process.env.USER || 'unknown',
      };
    }

    // 格式3：结构化对象
    if (rawInput.title && rawInput.description) {
      return {
        title: rawInput.title,
        description: rawInput.description,
        priority: rawInput.priority || 'medium',
        attachments: rawInput.attachments || [],
        source: 'manual',
        sourceId: rawInput.id || `manual-${Date.now()}`,
        author: rawInput.author || process.env.USER || 'unknown',
        metadata: rawInput.metadata || {},
      };
    }

    // 兜底
    const inputStr = JSON.stringify(rawInput);
    return {
      title: `手动输入 ${new Date().toISOString()}`,
      description: inputStr,
      priority: 'medium',
      attachments: [],
      source: 'manual',
      sourceId: `manual-${Date.now()}`,
      author: 'unknown',
    };
  }

  /**
   * 从卡片数据标准化
   */
  private normalizeFromCard(cardData: any): NormalizedInput {
    const card = cardData.card;
    const projectRef = cardData.refs || {};

    return {
      title: card.title || '未命名',
      description: card.content || card.title || '',
      priority: this.mapPriority(card.status, card.status_stage),
      attachments: [],
      source: 'manual',
      sourceId: cardData.id || card.seq_num?.toString() || '',
      author: card.create_user || card.last_modify_user || 'unknown',
      metadata: {
        seqNum: card.seq_num,
        type: card.type,
        innerType: card.inner_type,
        status: card.status,
        statusStage: card.status_stage,
        planId: card.plan_id,
        projectId: card.project_id,
        ownerUsers: card.owner_users,
        createTime: card.create_time,
        lastModifyTime: card.last_modify_time,
        estimateWorkload: card.estimate_workload,
        // 关联信息
        planName: projectRef.plans?.[card.plan_id]?.name,
        projectName: projectRef.projects?.[card.project_id]?.name,
      },
    };
  }

  /**
   * 根据状态映射优先级
   */
  private mapPriority(status: string, stage: string): 'high' | 'medium' | 'low' {
    if (stage === 'confirm' || status === 'open') return 'medium';
    if (stage === 'process' || status === 'processing') return 'high';
    return 'medium';
  }

  validate(rawInput: any): boolean {
    // 手动输入总是有效
    return true;
  }
}
