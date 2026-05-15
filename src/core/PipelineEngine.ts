interface StageResult {
  stage: string;
  status: 'completed' | 'needs_refinement' | 'failed';
  output: any;
  nextAction: 'proceed' | 'rollback' | 'human_gate' | 'retry';
  rollbackReason?: string;
  rollbackTo?: string;
}

class PipelineEngine {
  private eventBus: EventBus;
  private contextAssembler: ContextAssembler;
  private specVersionControl: SpecVersionControl;
  private humanGate: HumanGate;
  
  private stages: Map<string, StageHandler> = new Map();
  private maxRetries = 3;

  constructor() {
    this.eventBus = new EventBus();
    this.contextAssembler = new ContextAssembler();
    this.specVersionControl = new SpecVersionControl();
    this.humanGate = new HumanGate();
    
    // 注册阶段处理器
    this.registerStage('P1', new P1_RequirementsGen());
    this.registerStage('P2', new P2_DesignGen());
    this.registerStage('P3', new P3_TaskGen());
    this.registerStage('P4', new P4_Develop());
    this.registerStage('P5', new P5_Review());
    this.registerStage('P6', new P6_Test());
    
    // 注册回溯事件处理
    this.eventBus.on('pipeline.stage.rollback', this.handleRollback.bind(this));
    this.eventBus.on('task.failed', this.handleTaskFailure.bind(this));
  }

  async execute(featureRequest: FeatureRequest): Promise<PipelineResult> {
    const { projectId, featureName } = featureRequest;
    let currentStage = 'P1';
    let stageResults: StageResult[] = [];
    let retryCount = 0;
    
    // 初始化spec版本控制
    await this.specVersionControl.init(featureName);
    
    while (currentStage) {
      console.log(`\n━━━ ${currentStage} 开始 ━━━`);
      
      // 组装上下文（分层加载，不是全量）
      const context = await this.contextAssembler.assemble({
        projectId,
        featureName,
        stage: currentStage
      });
      
      // 执行阶段
      const handler = this.stages.get(currentStage)!;
      const result = await handler.execute({
        ...featureRequest,
        context,
        previousResults: stageResults
      });
      
      stageResults.push(result);
      
      // 决定下一步
      switch (result.nextAction) {
        case 'proceed':
          currentStage = this.getNextStage(currentStage);
          retryCount = 0;
          break;
          
        case 'rollback':
          // 回溯到指定阶段
          await this.eventBus.emit('pipeline.stage.rollback', {
            projectId,
            featureName,
            fromStage: currentStage,
            toStage: result.rollbackTo!,
            reason: result.rollbackReason
          });
          currentStage = result.rollbackTo!;
          retryCount++;
          break;
          
        case 'human_gate':
          // 人在回路确认
          const approved = await this.humanGate.requestApproval({
            featureName,
            stage: currentStage,
            content: result.output
          });
          
          if (approved) {
            // 冻结当前版本
            await this.specVersionControl.freeze(featureName, currentStage);
            currentStage = this.getNextStage(currentStage);
          } else {
            // 回到当前阶段重新来
            retryCount++;
          }
          break;
          
        case 'retry':
          retryCount++;
          if (retryCount > this.maxRetries) {
            // 超过最大重试，强制回溯
            currentStage = this.getPreviousStage(currentStage);
            retryCount = 0;
          }
          // 否则保持currentStage不变，重试
          break;
      }
      
      // 死循环保护
      if (retryCount > this.maxRetries * 2) {
        throw new Error(`Pipeline stuck at ${currentStage} after ${retryCount} retries`);
      }
    }
    
    return { featureName, stages: stageResults };
  }

  private async handleRollback(event: PipelineEvent) {
    const { featureName, fromStage, toStage, reason } = event.payload;
    
    console.log(`⏪ 回溯: ${fromStage} → ${toStage}`);
    console.log(`   原因: ${reason}`);
    
    // 更新spec版本（回溯也记录）
    await this.specVersionControl.recordRollback(featureName, fromStage, toStage, reason);
    
    // 失效后续阶段的产物
    await this.invalidateDownstreamArtifacts(featureName, fromStage);
  }

  private async handleTaskFailure(event: PipelineEvent) {
    const { featureName, taskId, error, suggestedFix } = event.payload;
    
    console.log(`❌ Task ${taskId} 失败: ${error}`);
    
    // 判断是需要修改spec还是重试
    if (suggestedFix?.type === 'spec_change') {
      // 代码实现时发现spec有问题，回溯到spec阶段
      await this.eventBus.emit('pipeline.stage.rollback', {
        featureName,
        fromStage: 'P4',
        toStage: suggestedFix.affectsStage, // P1/P2/P3
        reason: `Task ${taskId}: ${error}`
      });
    }
  }
}
