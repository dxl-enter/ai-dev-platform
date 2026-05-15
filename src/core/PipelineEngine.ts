// src/core/PipelineEngine.ts

import { EventBus } from './EventBus';
import { ContextAssembler } from './ContextAssembler';
import { SpecVersionControl } from './SpecVersionControl';
import { DependencyGraph } from './DependencyGraph';
import { HumanGate } from '../gates/HumanGate';
import { 
  FeatureRequest, StageResult, StageContext, 
  NormalizedInput, Task 
} from '../types';
import { configManager } from '../config';
import { FileManager } from '../utils/fs';
import { GitManager } from '../utils/git';
import { logger } from '../utils/logger';
import * as path from 'path';

// Stage处理器映射
import { P1_RequirementsGen } from '../stages/P1_RequirementsGen';
import { P2_DesignGen } from '../stages/P2_DesignGen';
import { P3_TaskGen } from '../stages/P3_TaskGen';
import { P4_Develop } from '../stages/P4_Develop';
import { P5_Review } from '../stages/P5_Review';
import { P6_Test } from '../stages/P6_Test';
import { StageHandler } from '../stages/StageHandler';

export class PipelineEngine {
  private eventBus: EventBus;
  private contextAssembler: ContextAssembler;
  private specVersionControl: SpecVersionControl;
  private humanGate: HumanGate;
  private stages: Map<string, StageHandler> = new Map();
  private gitManager: GitManager;
  private maxRetries: number;
  private maxTotalRetries: number;
  private totalRetries: number = 0;

  constructor() {
    this.eventBus = new EventBus();
    this.contextAssembler = new ContextAssembler();
    this.specVersionControl = new SpecVersionControl(
      configManager.getSpecsConfig().base_dir
    );
    this.humanGate = new HumanGate();
    this.gitManager = new GitManager();

    const pipelineConfig = configManager.getPipelineConfig();
    this.maxRetries = pipelineConfig.rollback.max_retries;
    this.maxTotalRetries = pipelineConfig.rollback.max_total_retries;

    // 注册所有Stage处理器
    this.registerStage('P1_RequirementsGen', new P1_RequirementsGen());
    this.registerStage('P2_DesignGen', new P2_DesignGen());
    this.registerStage('P3_TaskGen', new P3_TaskGen());
    this.registerStage('P4_Develop', new P4_Develop());
    this.registerStage('P5_Review', new P5_Review());
    this.registerStage('P6_Test', new P6_Test());

    // 监听回溯事件
    this.eventBus.on('pipeline.rollback', this.handleRollback.bind(this));
    this.eventBus.on('task.failed', this.handleTaskFailure.bind(this));
  }

  /**
   * 注册Stage处理器
   */
  private registerStage(name: string, handler: StageHandler): void {
    this.stages.set(name, handler);
  }

  /**
   * 执行完整流水线
   */
  async execute(request: FeatureRequest): Promise<{
    featureName: string;
    stages: StageResult[];
    success: boolean;
    artifacts: string[];
  }> {
    const { projectId, featureName } = request;
    const projectConfig = configManager.getProject(projectId);
    const featurePath = path.join(
      configManager.getSpecsConfig().base_dir,
      projectId,
      featureName
    );

    logger.info(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(`🚀 流水线启动: ${featureName}`);
    logger.info(`   项目: ${projectConfig.name}`);
    logger.info(`   技术栈: ${projectConfig.tech_stack.frontend} + ${projectConfig.tech_stack.backend}`);
    logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // 触发事件
    await this.eventBus.emit('feature.requested', {
      projectId,
      featureName,
      source: request.source,
    });

    // 创建feature目录
    await FileManager.createFeatureStructure(featurePath);
    await this.specVersionControl.init(featureName);

    // 创建Git分支
    if (await this.gitManager.isRepo()) {
      await this.gitManager.createFeatureBranch(featureName);
    }

    // 标准化输入
    const adapter = this.getAdapter(request.source);
    const normalizedInput = await adapter.normalize(request.rawInput);

    // 流水线执行
    const stageNames = configManager.getPipelineConfig().stages;
    let currentStageIndex = 0;
    const stageResults: StageResult[] = [];
    const artifacts: string[] = [];
    let retryCount = 0;

    while (currentStageIndex < stageNames.length) {
      const stageName = stageNames[currentStageIndex];
      const stageNumber = stageName.split('_')[0]; // P1, P2, ...

      logger.info(`\n━━━ ${stageName} 开始 ━━━`);

      // 组装上下文
      const assembledContext = await this.contextAssembler.assemble({
        projectId,
        featureName,
        stage: stageNumber,
        taskId: (request as any).taskId,
        previousResults: stageResults,
      });

      // 构建Stage上下文
      const stageContext: StageContext = {
        projectConfig,
        featureName,
        featurePath,
        input: normalizedInput,
        assembledContext,
        previousResults: stageResults,
        env: process.env as Record<string, string>,
      };

      // 执行Stage
      const handler = this.stages.get(stageName);
      if (!handler) {
        throw new Error(`未找到Stage处理器: ${stageName}`);
      }

      const result = await handler.execute(stageContext);
      stageResults.push(result);

      await this.eventBus.emit('stage.completed', {
        projectId,
        featureName,
        stage: stageName,
        result,
      });

      // 收集产物
      if (result.artifacts) {
        artifacts.push(...result.artifacts);
      }

      // 决定下一步
      switch (result.nextAction) {
        case 'proceed':
          // Human Gate检查
          if (this.shouldTriggerHumanGate(stageNumber, result)) {
            const approved = await this.humanGate.requestApproval({
              featureName,
              stage: stageNumber,
              title: `${stageName} 完成`,
              content: JSON.stringify(result.output, null, 2).substring(0, 2000),
              uncertainParts: result.output?.uncertainParts || [],
              metadata: { stage: stageNumber },
            });

            if (approved) {
              await this.specVersionControl.freeze(featureName, stageNumber, 'human');
              await this.eventBus.emit('human_gate.approved', {
                projectId,
                featureName,
                stage: stageNumber,
              });
              currentStageIndex++;
              retryCount = 0;
            } else {
              await this.eventBus.emit('human_gate.rejected', {
                projectId,
                featureName,
                stage: stageNumber,
              });
              // 重新执行当前阶段
              retryCount++;
            }
          } else {
            currentStageIndex++;
            retryCount = 0;
          }
          break;

        case 'rollback':
          // 回溯
          const rollbackTo = result.rollbackTo || 'P1';
          const rollbackIndex = stageNames.findIndex(s => s.startsWith(rollbackTo));
          
          await this.eventBus.emit('pipeline.rollback', {
            projectId,
            featureName,
            fromStage: stageNumber,
            toStage: rollbackTo,
            reason: result.rollbackReason,
          });

          if (rollbackIndex >= 0) {
            currentStageIndex = rollbackIndex;
          }
          retryCount++;
          this.totalRetries++;
          break;

        case 'retry':
          retryCount++;
          break;

        case 'human_gate':
          // 等待人工确认
          const gateApproved = await this.humanGate.requestApproval({
            featureName,
            stage: stageNumber,
            title: `${stageName} 需要确认`,
            content: result.output?.summary || '请查看详情',
            uncertainParts: result.output?.uncertainParts || [],
            metadata: {},
          });

          if (gateApproved) {
            currentStageIndex++;
            retryCount = 0;
          } else {
            retryCount++;
          }
          break;
      }

      // 检查重试上限
      if (retryCount > this.maxRetries) {
        logger.error(`阶段 ${stageName} 重试次数超过上限 (${this.maxRetries})`);
        throw new Error(`Pipeline stuck at ${stageName}`);
      }

      if (this.totalRetries > this.maxTotalRetries) {
        logger.error(`总回溯次数超过上限 (${this.maxTotalRetries})`);
        throw new Error('Pipeline total retries exceeded');
      }
    }

    // 完成
    await this.eventBus.emit('pipeline.completed', {
      projectId,
      featureName,
      stages: stageResults,
    });

    logger.info(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(`✅ 流水线完成: ${featureName}`);
    logger.info(`   阶段数:
