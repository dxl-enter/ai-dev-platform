import { StageHandler } from './StageHandler';
import { StageContext, StageResult } from '../types';
import { llmClient } from '../llm/LLMClient';
import { Prompts } from '../llm/prompts';
import { FileManager } from '../utils/fs';
import { logger } from '../utils/logger';
import * as path from 'path';

export class P1_RequirementsGen implements StageHandler {
  readonly name = 'P1_RequirementsGen';

  async execute(context: StageContext): Promise<StageResult> {
    logger.info('📋 生成需求文档...');

    const { featureName, featurePath, input, assembledContext } = context;

    try {
      // 调用AI生成需求
      const userPrompt = Prompts.P1_USER(
        input.description || input.title,
        assembledContext.projectContext
      );

      const rawRequirements = await llmClient.architect({
        systemPrompt: Prompts.P1_SYSTEM,
        userPrompt,
      });

      // 提取不确定的部分
      const uncertainParts = this.extractUncertainParts(rawRequirements);

      // 格式化需求文档
      const formattedRequirements = this.formatRequirements(
        rawRequirements,
        input,
        uncertainParts
      );

      // 保存到文件
      const outputPath = path.join(featurePath, 'requirements.md');
      await FileManager.writeFile(outputPath, formattedRequirements);

      logger.info(`✅ 需求文档已生成: ${outputPath}`);
      logger.info(`   不确定项: ${uncertainParts.length} 个`);

      return {
        stage: 'P1',
        status: 'completed',
        output: {
          path: outputPath,
          content: formattedRequirements,
          uncertainParts,
          wordCount: formattedRequirements.length,
        },
        nextAction: 'proceed',
        artifacts: [outputPath],
      };

    } catch (error: any) {
      logger.error(`P1 失败: ${error.message}`);
      return {
        stage: 'P1',
        status: 'failed',
        output: null,
        nextAction: 'retry',
        errors: [error.message],
      };
    }
  }

  /**
   * 提取AI标记的不确定部分
   */
  private extractUncertainParts(content: string): Array<{
    location: string;
    question: string;
    confidence: number;
  }> {
    const uncertainParts: Array<{
      location: string;
      question: string;
      confidence: number;
    }> = [];

    // 匹配 [待确认: ...] 格式
    const regex = /\[待确认:\s*(.+?)\]/g;
    let match;
    let index = 0;

    while ((match = regex.exec(content)) !== null) {
      // 找到该标记所在的章节
      const beforeMatch = content.substring(0, match.index);
      const lastHeader = beforeMatch.lastIndexOf('\n## ');
      const section = lastHeader >= 0 
        ? beforeMatch.substring(lastHeader + 1).split('\n')[0]
        : '未知章节';

      uncertainParts.push({
        location: section,
        question: match[1],
        confidence: 0.5, // AI不确定的默认置信度
      });
      index++;
    }

    return uncertainParts;
  }

  /**
   * 格式化需求文档
   */
  private formatRequirements(
    rawContent: string,
    input: any,
    uncertainParts: any[]
  ): string {
    const metadata = [
      `# ${input.title || '新需求'}`,
      '',
      '## 元数据',
      `- **来源**: ${input.source || 'manual'} (${input.sourceId || 'N/A'})`,
      `- **优先级**: ${input.priority || 'medium'}`,
      `- **作者**: ${input.author || 'unknown'}`,
      `- **创建时间**: ${new Date().toISOString()}`,
    ];

    if (input.metadata) {
      for (const [key, value] of Object.entries(input.metadata)) {
        metadata.push(`- **${key}**: ${value}`);
      }
    }

    const uncertainSection = uncertainParts.length > 0
      ? [
          '',
          '## ⚠️ 待确认事项',
          ...uncertainParts.map((p: any, i: number) => 
            `${i + 1}. **${p.location}**: ${p.question}`
          ),
        ]
      : [];

    return [
      ...metadata,
      '',
      '---',
      '',
      rawContent,
      ...uncertainSection,
    ].join('\n');
  }
}
