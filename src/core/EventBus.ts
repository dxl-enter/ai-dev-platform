type EventType = 
  | 'feature.requested'      // 任何渠道的新需求
  | 'spec.updated'           // spec被修改
  | 'spec.approved'          // 人确认spec
  | 'task.completed'         // 单个task完成
  | 'task.failed'            // task失败需要回溯
  | 'review.failed'          // 审查不通过
  | 'pipeline.stage.complete'
  | 'pipeline.stage.rollback'; // 回溯事件

interface PipelineEvent {
  type: EventType;
  projectId: string;
  featureName: string;
  payload: Record<string, any>;
  timestamp: number;
  // 回溯链：记录这个事件是从哪个事件触发的
  triggerChain: string[];
}

class EventBus {
  private handlers: Map<EventType, Set<(event: PipelineEvent) => Promise<void>>> = new Map();
  private eventLog: PipelineEvent[] = []; // 完整事件日志，用于回溯

  on(type: EventType, handler: (event: PipelineEvent) => Promise<void>) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  async emit(type: EventType, payload: Record<string, any>, triggerChain: string[] = []) {
    const event: PipelineEvent = {
      type,
      projectId: payload.projectId,
      featureName: payload.featureName,
      payload,
      timestamp: Date.now(),
      triggerChain: [...triggerChain, type]
    };
    
    this.eventLog.push(event);
    console.log(`📡 [EventBus] ${type} (chain: ${event.triggerChain.join(' → ')})`);
    
    const handlers = this.handlers.get(type);
    if (handlers) {
      await Promise.all([...handlers].map(h => h(event)));
    }
  }

  // 获取某个feature的完整事件历史
  getFeatureHistory(featureName: string): PipelineEvent[] {
    return this.eventLog.filter(e => e.featureName === featureName);
  }

  // 回溯到上一个阶段
  async rollback(featureName: string, fromStage: string, reason: string) {
    console.log(`⏪ [Rollback] ${fromStage} → 上一阶段，原因: ${reason}`);
    const previousStage = this.getPreviousStage(fromStage);
    await this.emit('pipeline.stage.rollback', {
      featureName,
      fromStage,
      toStage: previousStage,
      reason
    });
  }

  private getPreviousStage(stage: string): string {
    const stages = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    const idx = stages.indexOf(stage);
    return idx > 0 ? stages[idx - 1] : stages[0];
  }
}
