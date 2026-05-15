import { Task } from '../types';
import { logger } from '../utils/logger';

export class DependencyGraph {
  private graph: Map<string, string[]> = new Map();
  private allTasks: Map<string, Task> = new Map();

  /**
   * 从任务列表构建依赖图
   */
  buildFromTasks(tasks: Task[]): void {
    this.graph.clear();
    this.allTasks.clear();

    for (const task of tasks) {
      this.allTasks.set(task.id, task);
      
      // 显式依赖
      const deps = [...(task.dependencies || [])];
      
      // 隐式依赖：同文件的任务必须串行
      const sameFileTasks = tasks.filter(t =>
        t.id !== task.id &&
        this.shareFiles(t, task)
      );
      
      for (const t of sameFileTasks) {
        if (!deps.includes(t.id)) {
          deps.push(t.id);
          logger.debug(`添加隐式依赖: ${task.id} → ${t.id} (同文件)`);
        }
      }

      this.graph.set(task.id, deps);
    }

    logger.info(`依赖图已构建: ${tasks.length} 个节点, ${this.countEdges()} 条边`);
  }

  /**
   * 拓扑排序：返回可并行的批次
   */
  topologicalSort(): string[][] {
    const batches: string[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(this.graph.keys());

    let iterations = 0;
    const maxIterations = this.graph.size * 2; // 防止死循环

    while (remaining.size > 0 && iterations < maxIterations) {
      iterations++;
      const batch: string[] = [];

      for (const taskId of remaining) {
        const deps = this.graph.get(taskId) || [];
        
        // 所有依赖都已完成
        if (deps.every(d => completed.has(d))) {
          batch.push(taskId);
        }
      }

      if (batch.length === 0) {
        // 检查是否有循环依赖
        const cycle = this.detectCycle();
        if (cycle) {
          throw new Error(`检测到循环依赖: ${cycle.join(' → ')}`);
        }
        throw new Error('依赖图排序失败：无法找到可执行任务');
      }

      batches.push(batch);
      
      for (const id of batch) {
        completed.add(id);
        remaining.delete(id);
      }
    }

    logger.info(`拓扑排序完成: ${batches.length} 个批次`);
    batches.forEach((batch, i) => {
      logger.debug(`  批次${i + 1}: [${batch.join(', ')}]`);
    });

    return batches;
  }

  /**
   * 获取任务的依赖链
   */
  getDependencyChain(taskId: string): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();
    
    const traverse = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      
      const deps = this.graph.get(id) || [];
      for (const dep of deps) {
        traverse(dep);
      }
      chain.push(id);
    };
    
    traverse(taskId);
    return chain;
  }

  /**
   * 获取被依赖的任务（反向依赖）
   */
  getDependents(taskId: string): string[] {
    const dependents: string[] = [];
    
    for (const [id, deps] of this.graph) {
      if (deps.includes(taskId)) {
        dependents.push(id);
      }
    }
    
    return dependents;
  }

  /**
   * 获取无依赖的根任务
   */
  getRootTasks(): string[] {
    const roots: string[] = [];
    
    for (const [id, deps] of this.graph) {
      if (deps.length === 0) {
        roots.push(id);
      }
    }
    
    return roots;
  }

  /**
   * 计算最大并行度
   */
  getMaxParallelism(): number {
    const batches = this.topologicalSort();
    return Math.max(...batches.map(b => b.length));
  }

  /**
   * 检查两个任务是否操作相同文件
   */
  private shareFiles(taskA: Task, taskB: Task): boolean {
    const filesA = taskA.files || [];
    const filesB = taskB.files || [];
    return filesA.some(f => filesB.includes(f));
  }

  /**
   * 检测循环依赖
   */
  private detectCycle(): string[] | null {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const deps = this.graph.get(nodeId) || [];
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (dfs(dep)) return true;
        } else if (recursionStack.has(dep)) {
          // 找到循环
          path.push(dep);
          return true;
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.graph.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) {
          return path;
        }
      }
    }

    return null;
  }

  /**
   * 统计边数
   */
  private countEdges(): number {
    let count = 0;
    for (const deps of this.graph.values()) {
      count += deps.length;
    }
    return count;
  }

  /**
   * 导出为Mermaid格式（用于可视化）
   */
  toMermaid(): string {
    let mermaid = 'graph TD\n';
    
    for (const [id, deps] of this.graph) {
      const task = this.allTasks.get(id);
      const label = task ? task.title : id;
      
      if (deps.length === 0) {
        mermaid += `    ${id}["${label}"]\n`;
      }
      
      for (const dep of deps) {
        mermaid += `    ${dep}["${this.allTasks.get(dep)?.title || dep}"] --> ${id}["${label}"]\n`;
      }
    }
    
    return mermaid;
  }

  /**
   * 导出为JSON
   */
  toJSON(): object {
    const nodes = [...this.allTasks.entries()].map(([id, task]) => ({
      id,
      title: task.title,
      type: task.type,
      estimatedHours: task.estimatedHours,
      status: task.status,
    }));

    const edges: { from: string; to: string }[] = [];
    for (const [id, deps] of this.graph) {
      for (const dep of deps) {
        edges.push({ from: dep, to: id });
      }
    }

    return { nodes, edges };
  }
}
