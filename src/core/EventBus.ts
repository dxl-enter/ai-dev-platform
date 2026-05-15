import { v4 as uuidv4 } from 'uuid';
import { EventType, PipelineEvent, EventHandler } from '../types';
import { logger } from '../utils/logger';

export class EventBus {
  private handlers: Map<EventType, Set<EventHandler>> = new Map();
  private eventLog: PipelineEvent[] = [];
  private featureEventMap: Map<string, PipelineEvent[]> = new Map();

  /**
   * 注册事件处理器
   */
  on(type: EventType, handler: EventHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    logger.debug(`注册事件处理器: ${type}`);
  }

  /**
   * 移除事件处理器
   */
  off(type: EventType, handler: EventHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * 触发事件
   */
  async emit(
    type: EventType,
    payload: Record<string, any> = {},
    triggerChain: EventType[] = []
  ): Promise<void> {
    const event: PipelineEvent = {
      id: uuidv4(),
      type,
      projectId: payload.projectId || 'unknown',
      featureName: payload.featureName || 'unknown',
      payload,
      timestamp: Date.now(),
      triggerChain: [...triggerChain, type],
    };

    // 记录事件
    this.eventLog.push(event);
    
    // 按feature分组
    if (!this.featureEventMap.has(event.featureName)) {
      this.featureEventMap.set(event.featureName, []);
    }
    this.featureEventMap.get(event.featureName)!.push(event);

    // 日志输出
    const chainStr = event.triggerChain.length > 1 
      ? ` (chain: ${event.triggerChain.join(' → ')})`
      : '';
    logger.info(`📡 ${type}${chainStr}`);

    // 触发所有处理器
    const handlers = this.handlers.get(type);
    if (handlers && handlers.size > 0) {
      const promises = [...handlers].map(handler => 
        handler(event).catch(err => {
          logger.error(`事件处理器错误 [${type}]: ${err.message}`);
        })
      );
      await Promise.all(promises);
    }
  }

  /**
   * 获取feature的完整事件历史
   */
  getFeatureHistory(featureName: string): PipelineEvent[] {
    return this.featureEventMap.get(featureName) || [];
  }

  /**
   * 获取feature的最后N个事件
   */
  getRecentEvents(featureName: string, count: number = 10): PipelineEvent[] {
    const history = this.getFeatureHistory(featureName);
    return history.slice(-count);
  }

  /**
   * 查找特定类型的事件
   */
  findEvents(featureName: string, type: EventType): PipelineEvent[] {
    return this.getFeatureHistory(featureName)
      .filter(e => e.type === type);
  }

  /**
   * 检查是否已经发生过某个事件
   */
  hasEvent(featureName: string, type: EventType): boolean {
    return this.getFeatureHistory(featureName)
      .some(e => e.type === type);
  }

  /**
   * 获取事件统计
   */
  getStats(featureName: string): Record<string, number> {
    const events = this.getFeatureHistory(featureName);
    const stats: Record<string, number> = {};
    
    for (const event of events) {
      stats[event.type] = (stats[event.type] || 0) + 1;
    }
    
    return stats;
  }

  /**
   * 获取回溯链（用于调试）
   */
  getTriggerChain(lastEvent: PipelineEvent): string {
    return lastEvent.triggerChain.join(' → ');
  }

  /**
   * 清理feature的事件记录
   */
  clearFeature(featureName: string): void {
    this.featureEventMap.delete(featureName);
    this.eventLog = this.eventLog.filter(e => e.featureName !== featureName);
    logger.debug(`清理事件记录: ${featureName}`);
  }

  /**
   * 获取全局事件总数
   */
  getTotalEventCount(): number {
    return this.eventLog.length;
  }
}
