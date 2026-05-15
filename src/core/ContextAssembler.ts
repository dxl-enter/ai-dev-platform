interface AssembledContext {
  systemPrompt: string;
  featureContext: string;      // 当前feature的specs摘要
  projectContext: string;      // 项目级上下文（RAG检索的）
  taskContext?: string;        // 具体task的上下文
  totalTokens: number;         // 估算的token数
}

class ContextAssembler {
  private projectCodebaseIndex: Map<string, string> = new Map(); // RAG索引

  async assemble(opts: {
    projectId: string;
    featureName: string;
    stage: string;
    taskId?: string;
  }): Promise<AssembledContext> {
    
    // 1. 分层加载上下文（不是一股脑全塞进去）
    const featureSpec = await this.loadFeatureSpec(opts.featureName, 'summary'); // 只加载摘要
    const projectContext = await this.ragRetrieve(opts.projectId, featureSpec.keywords);
    
    // 2. 根据stage决定加载哪些spec文件
    const stageContext = this.getStageSpecificContext(opts);
    
    // 3. 硬件限制检查
    const totalTokens = this.estimateTokens(featureSpec.summary + projectContext + stageContext);
    
    if (totalTokens > 800_000) { // 留20%余量
      console.warn(`⚠️ 上下文过大 (${totalTokens} tokens)，进行压缩`);
      return this.compressContext(featureSpec, projectContext, stageContext);
    }
    
    return {
      systemPrompt: this.buildSystemPrompt(opts.projectId),
      featureContext: featureSpec.summary,
      projectContext,
      taskContext: stageContext,
      totalTokens
    };
  }

  // RAG检索：从项目代码库中检索相关上下文
  private async ragRetrieve(projectId: string, keywords: string[]): Promise<string> {
    // 实际实现：向量检索项目中的相关代码、文档、规范
    // 这里简化，返回项目配置和规范
    const config = this.projectCodebaseIndex.get(projectId) || '';
    return `
## 项目技术栈
${config}

## 相关代码片段（RAG检索）
- 类似feature的实现参考
- 项目公共组件
- API规范
`;
  }

  private getStageSpecificContext(opts: any): string {
    switch (opts.stage) {
      case 'P1':
        return '只需要原始需求输入';
      case 'P2':
        return '需要 requirements.md 全文';
      case 'P3':
        return '需要 requirements.md + design.md 摘要';
      case 'P4':
        // 只加载当前task需要的specs，不是全部
        return `需要 tasks.md 中 task[${opts.taskId}] 的详细描述`;
      default:
        return '';
    }
  }
}
