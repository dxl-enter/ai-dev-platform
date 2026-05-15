import { StageHandler } from './StageHandler';
import { StageContext, StageResult, Task } from '../types';
import { llmClient } from '../llm/LLMClient';
import { Prompts } from '../llm/prompts';
import { DependencyGraph } from '../core/DependencyGraph';
import { FileManager } from '../utils/fs';
import { logger } from '../utils/logger';
import * as path from 'path';

export class P3_TaskGen implements StageHandler {
  readonly name = 'P3_TaskGen';

  async execute(context: StageContext): Promise<StageResult> {
    logger.info('📋 拆解任务...');

    const { featureName, featurePath } = context;

    try {
      // 读取需求和设计文档
      const requirements = await FileManager.readFileSafe(
        path.join(featurePath, 'requirements.md')
      );
      const design = await FileManager.readFileSafe(
        path.join(featurePath, 'design.md')
      );

      if (!requirements || !design) {
        return {
          stage: 'P3',
          status: 'failed',
          output: null,
          nextAction: 'rollback',
          rollbackTo: !requirements ? 'P1' : 'P2',
          rollbackReason: '缺少前置文档',
          errors: ['requirements.md or design.md not found'],
        };
      }

      // 调用AI拆解任务
      const userPrompt = Prompts.P3_USER(requirements, design);
      const rawTasks = await llmClient.architect({
        systemPrompt: Prompts.P3_SYSTEM,
        userPrompt,
      });

      // 解析任务
      const tasks = this.parseTasks(rawTasks);

      // 构建依赖图
      const depGraph = new DependencyGraph();
      depGraph.buildFromTasks(tasks);

      // 验证依赖图
      this.validateDependencies(depGraph);

      // 计算并行度
      const batches = depGraph.topologicalSort();
      const maxParallelism = depGraph.getMaxParallelism();

      // 格式化任务文档
      const formattedTasks = this.formatTasks(
        tasks,
        depGraph,
        batches,
        maxParallelism
      );

      // 保存
      const outputPath = path.join(featurePath, 'tasks.md');
      await FileManager.writeFile(outputPath, formattedTasks);

      logger.info(`✅ 任务拆解完成: ${outputPath}`);
      logger.info(`   总任务数: ${tasks.length}`);
      logger.info(`   批次: ${batches.length}`);
      logger.info(`   最大并行度: ${maxParallelism}`);

      return {
        stage: 'P3',
        status: 'completed',
        output: {
          path: outputPath,
          tasks,
          totalTasks: tasks.length,
          batches: batches.length,
          maxParallelism,
          mermaidGraph: depGraph.toMermaid(),
          dependencyJSON: depGraph.toJSON(),
        },
        nextAction: 'proceed',
        artifacts: [outputPath],
      };

    } catch (error: any) {
      logger.error(`P3 失败: ${error.message}`);
      return {
        stage: 'P3',
        status: 'failed',
        output: null,
        nextAction: 'retry',
        errors: [error.message],
      };
    }
  }

  /**
   * 解析AI生成的任务列表
   */
  private parseTasks(rawContent: string): Task[] {
    const tasks: Task[] = [];
    
    // 匹配任务块：### T-XXX: 标题
    const taskRegex = /###\s+(T-\d+):\s+(.+?)(?=\n###|\n##|\n*$)/gs;
    let match;

    while ((match = taskRegex.exec(rawContent)) !== null) {
      const taskId = match[1];
      const taskContent = match[2];

      // 提取任务详情
      const title = taskContent.split('\n')[0].trim();
      const type = this.extractField(taskContent, '类型|type', 'frontend');
      const deps = this.extractDependencies(taskContent);
      const estimate = this.extractEstimate(taskContent);
      const acceptance = this.extractAcceptanceCriteria(taskContent);
      const files = this.extractFiles(taskContent);

      tasks.push({
        id: taskId,
        title,
        type: type as Task['type'],
        dependencies: deps,
        estimatedHours: estimate,
        acceptanceCriteria: acceptance,
        files,
        status: 'pending',
      });
    }

    // 如果没有匹配到，尝试手动解析
    if (tasks.length === 0) {
      const lines = rawContent.split('\n');
      let currentTask: Partial<Task> | null = null;

      for (const line of lines) {
        const taskMatch = line.match(/^###?\s+(T-\d+):?\s*(.+)/);
        if (taskMatch) {
          if (currentTask && currentTask.id) {
            tasks.push(currentTask as Task);
          }
          currentTask = {
            id: taskMatch[1],
            title: taskMatch[2].trim(),
            type: 'frontend',
            dependencies: [],
            estimatedHours: 1,
            acceptanceCriteria: [],
            files: [],
            status: 'pending',
          };
        }
      }

      if (currentTask && currentTask.id) {
        tasks.push(currentTask as Task);
      }
    }

    return tasks;
  }

  private extractField(content: string, pattern: string, defaultValue: string): string {
    const regex = new RegExp(`(?:${pattern})\\s*[:：]\\s*(\\S+)`, 'i');
    const match = content.match(regex);
    return match ? match[1].toLowerCase() : defaultValue;
  }

  private extractDependencies(content: string): string[] {
    const depMatch = content.match(/(?:依赖|dependencies?)\s*[:：]\s*(.+)/i);
    if (!depMatch) return [];
    
    const depStr = depMatch[1];
    if (depStr.toLowerCase().includes('无') || depStr.toLowerCase().includes('none')) {
      return [];
    }
    
    return depStr.split(/[,，、]/).map(d => d.trim()).filter(d => d);
  }

  private extractEstimate(content: string): number {
    const match = content.match(/(?:预估|工时|estimate)\s*[:：]\s*(\d+\.?\d*)\s*(?:h|小时)?/i);
    return match ? parseFloat(match[1]) : 1;
  }

  private extractAcceptanceCriteria(content: string): string[] {
    const criteria: string[] = [];
    const lines = content.split('\n');
    let inCriteria = false;

    for (const line of lines) {
      if (line.match(/验收标准|acceptance criteria/i)) {
        inCriteria = true;
        continue;
      }
      if (inCriteria && line.match(/^[-*]\s+\[/)) {
        criteria.push(line.replace(/^[-*]\s+/, '').trim());
      }
      if (inCriteria && line.match(/^$/)) {
        inCriteria = false;
      }
    }

    return criteria;
  }

  private extractFiles(content: string): string[] {
    const match = content.match(/(?:文件|files?)\s*[:：]\s*(.+)/i);
    if (!match) return [];
    return match[1].split(/[,，、]/).map(f => f.trim()).filter(f => f);
  }

  /**
   * 验证依赖图的合理性
   */
  private validateDependencies(depGraph: DependencyGraph): void {
    // 检查循环依赖
    const batches = depGraph.topologicalSort();
    
    // 检查是否有孤立任务（既无依赖也不被依赖）
    const rootTasks = depGraph.getRootTasks();
    const allTasks = (depGraph as any).allTasks;
    
    if (rootTasks.length === 0 && allTasks.size > 1) {
      logger.warn('所有任务都有依赖，可能存在循环依赖');
    }
  }

  /**
   * 格式化任务文档
   */
  private formatTasks(
    tasks: Task[],
    depGraph: DependencyGraph,
    batches: string[][],
    maxParallelism: number
  ): string {
    const sections = [
      `# 任务列表`,
      '',
      '## 任务统计',
      `- 总计: ${tasks.length}`,
      `- 前端: ${tasks.filter(t => t.type === 'frontend').length}`,
      `- 后端: ${tasks.filter(t => t.type === 'backend').length}`,
      `- 测试: ${tasks.filter(t => t.type === 'test').length}`,
      `- 配置: ${tasks.filter(t => t.type === 'config').length}`,
      `- 执行批次: ${batches.length}`,
      `- 最大并行度: ${maxParallelism}`,
      '',
      '## 依赖关系图',
      '```mermaid',
      depGraph.toMermaid(),
      '```',
      '',
      '## 执行计划',
    ];

    // 按批次展示
    batches.forEach((batch, batchIndex) => {
      sections.push(`### 批次 ${batchIndex + 1}（并行执行）`);
      for (const taskId of batch) {
        const task = tasks.find(t => t.id === taskId);
        if (task) {
          sections.push(`- **${task.id}**: ${task.title} [${task.type}] (${task.estimatedHours}h)`);
        }
      }
      sections.push('');
    });

    // 详细任务列表
    sections.push('---');
    sections.push('');
    sections.push('## 详细任务');

    for (const task of tasks) {
      sections.push(`### ${task.id}: ${task.title}`);
      sections.push('');
      sections.push(`- **类型**: ${task.type}`);
      sections.push(`- **依赖**: ${task.dependencies.length > 0 ? task.dependencies.join(', ') : '无'}`);
      sections.push(`- **预估工时**: ${task.estimatedHours}h`);
      sections.push(`- **状态**: ${task.status}`);
      
      if (task.files && task.files.length > 0) {
        sections.push(`- **涉及文件**: ${task.files.join(', ')}`);
      }
      
      if (task.acceptanceCriteria.length > 0) {
        sections.push(`- **验收标准**:`);
        task.acceptanceCriteria.forEach(c => {
          sections.push(`  - ${c}`);
        });
      }
      
      sections.push('');
    }

    return sections.join('\n');
  }
}
