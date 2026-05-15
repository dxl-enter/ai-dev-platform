class P4_Develop implements StageHandler {
  
  async execute(input: StageInput): Promise<StageResult> {
    const { featureName, context, taskId } = input;
    
    // 读取任务列表
    const tasks = await this.loadTasks(featureName);
    
    // 构建依赖图（不是简单的 >87 就并行）
    const dependencyGraph = this.buildDependencyGraph(tasks);
    const executionOrder = this.topologicalSort(dependencyGraph);
    
    console.log(`📊 任务依赖图: ${executionOrder.length} 个任务`);
    console.log(`   可并行批次: ${this.countParallelBatches(dependencyGraph)}`);
    
    const results: TaskResult[] = [];
    
    // 按依赖关系执行，同一批次的可并行
    for (const batch of executionOrder) {
      const batchResults = await Promise.all(
        batch.map(async (task) => {
          return await this.executeTaskWithReviewer({
            task,
            featureName,
            context
          });
        })
      );
      results.push(...batchResults.flat());
      
      // 检查是否有任务发现spec问题
      const specIssues = batchResults.filter(r => r.specIssue);
      if (specIssues.length > 0) {
        return {
          stage: 'P4',
          status: 'needs_refinement',
          output: results,
          nextAction: 'rollback',
          rollbackTo: specIssues[0].affectsStage,
          rollbackReason: specIssues[0].description
        };
      }
    }
    
    return {
      stage: 'P4',
      status: 'completed',
      output: results,
      nextAction: 'proceed'
    };
  }

  // 双人模式：Agent写码 + Reviewer实时审查
  private async executeTaskWithReviewer(opts: {
    task: Task;
    featureName: string;
    context: any;
  }): Promise<TaskResult[]> {
    const { task } = opts;
    
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      // 1. Agent写代码
      console.log(`  ✍️  [Agent] 正在实现 ${task.id}: ${task.title}`);
      const code = await this.callAI('claude-code', {
        task: task,
        context: opts.context,
        instruction: '编写完整实现，包含测试'
      });
      
      // 2. Reviewer实时审查
      console.log(`  🔍 [Reviewer] 审查 ${task.id}`);
      const review = await this.callAI('claude-sonnet', {
        code: code,
        task: task,
        instruction: `审查代码：
          1. 是否符合需求？
          2. 是否有bug？
          3. 是否有安全隐患？
          4. spec是否需要调整？（如果发现spec有歧义或矛盾，标记specIssue）`
      });
      
      // 3. 如果发现spec问题，立即回溯
      if (review.specIssue) {
        console.log(`  ⚠️  发现spec问题，触发回溯`);
        return [{
          taskId: task.id,
          status: 'spec_issue',
          specIssue: true,
          affectsStage: review.affectsStage,
          description: review.specIssueDescription
        }];
      }
      
      // 4. 如果有代码问题，Agent修复后重试
      if (review.issues.length > 0) {
        console.log(`  🔧 发现 ${review.issues.length} 个问题，Agent修复中...`);
        const fixedCode = await this.callAI('claude-code', {
          originalCode: code,
          issues: review.issues,
          instruction: '修复审查发现的所有问题'
        });
        
        // 再次审查
        const reReview = await this.callAI('claude-sonnet', {
          code: fixedCode,
          instruction: '确认所有问题已修复'
        });
        
        if (reReview.issues.length === 0) {
          await this.saveCode(task, fixedCode);
          return [{
            taskId: task.id,
            status: 'completed',
            attempts: attempts + 1
          }];
        }
        
        attempts++;
      } else {
        // 一次通过
        await this.saveCode(task, code);
        return [{
          taskId: task.id,
          status: 'completed',
          attempts: attempts + 1
        }];
      }
    }
    
    // 超过最大尝试次数
    throw new Error(`Task ${task.id} failed after ${maxAttempts} attempts`);
  }

  // 构建依赖图（替代 Task > 87 的简单判断）
  private buildDependencyGraph(tasks: Task[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    
    for (const task of tasks) {
      const deps = task.dependencies || [];
      // 添加隐式依赖：同文件不能并行
      const sameFileTasks = tasks.filter(t => 
        t.id !== task.id && this.shareFiles(t, task)
      );
      const allDeps = [...new Set([...deps, ...sameFileTasks.map(t => t.id)])];
      graph.set(task.id, allDeps);
    }
    
    return graph;
  }

  // 拓扑排序：找出可并行的批次
  private topologicalSort(graph: Map<string, string[]>): string[][] {
    const batches: string[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(graph.keys());
    
    while (remaining.size > 0) {
      const batch: string[] = [];
      
      for (const taskId of remaining) {
        const deps = graph.get(taskId) || [];
        if (deps.every(d => completed.has(d))) {
          batch.push(taskId);
        }
      }
      
      if (batch.length === 0) {
        throw new Error('Circular dependency detected');
      }
      
      batches.push(batch);
      batch.forEach(id => {
        completed.add(id);
        remaining.delete(id);
      });
    }
    
    return batches;
  }
}
