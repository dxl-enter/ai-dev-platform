interface ApprovalRequest {
  featureName: string;
  stage: string;
  content: string;
  // 高亮AI不确定的部分
  uncertainParts: { location: string; question: string }[];
}

class HumanGate {
  
  // 判断该阶段是否需要人工确认
  shouldGate(stage: string, content: any): boolean {
    const gates: Record<string, (content: any) => boolean> = {
      'P1': () => true,  // 需求必须人确认
      'P2': () => true,  // 设计必须人确认
      'P3': (c) => c.totalTasks > 20, // 大feature才需要确认任务拆解
      'P4': (c) => c.hasSecurityCode,  // 有安全敏感代码才需要
      'P5': () => false, // 自动审查
      'P6': (c) => c.failureRate > 0.1, // 测试失败率高才需要
    };
    
    return gates[stage]?.(content) ?? false;
  }

  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    console.log(`\n🛑 [Human Gate] ${request.stage} 阶段需要确认`);
    console.log(`   Feature: ${request.featureName}`);
    
    if (request.uncertainParts.length > 0) {
      console.log(`   ⚠️ AI不确定的部分:`);
      request.uncertainParts.forEach(p => {
        console.log(`      - ${p.location}: ${p.question}`);
      });
    }
    
    // CLI 交互式确认
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise((resolve) => {
      readline.question('   是否通过？ [Y/n/specs] ', (answer: string) => {
        readline.close();
        
        if (answer.toLowerCase() === 'specs') {
          // 打开spec文件让人查看
          const specPath = `specs/${request.featureName}/${this.getSpecFile(request.stage)}`;
          console.log(`   📄 查看完整spec: ${specPath}`);
          // 递归再问
          resolve(this.requestApproval(request));
        } else {
          resolve(answer.toLowerCase() !== 'n');
        }
      });
    });
  }
}
