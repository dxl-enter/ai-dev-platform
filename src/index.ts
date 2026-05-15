// src/index.ts

#!/usr/bin/env node

import { Command } from 'commander';
import { PipelineEngine } from './core/PipelineEngine';
import { EventBus } from './core/EventBus';

const program = new Command();
const engine = new PipelineEngine();
const eventBus = new EventBus();

program
  .name('ai-dev')
  .description('AI驱动的开发工作流平台')
  .version('1.0.0');

// 从卡片数据创建feature
program
  .command('feature create')
  .description('创建新feature（支持粘贴JSON、JIRA链接、直接描述）')
  .option('-t, --title <title>', 'feature标题')
  .option('-d, --description <desc>', '描述')
  .option('--from-clipboard', '从剪贴板读取卡片JSON')
  .option('--from-jira <issue-key>', '从JIRA导入')
  .action(async (options) => {
    let input;
    
    if (options.fromClipboard) {
      const clipboard = await import('clipboardy');
      input = JSON.parse(clipboard.default.readSync());
    }
    
    // 触发EventBus
    await eventBus.emit('feature.requested', {
      projectId: config.currentProject,
      featureName: options.title?.replace(/\s+/g, '-').toLowerCase(),
      input
    });
    
    console.log('✅ Feature创建成功，流水线已启动');
  });

// 启动开发
program
  .command('feature start')
  .description('启动完整流水线')
  .requiredOption('--feature <name>', 'feature名称')
  .option('--from <stage>', '从指定阶段开始', 'P1')
  .action(async (options) => {
    console.log(`🚀 启动流水线: ${options.feature}`);
    
    const result = await engine.execute({
      projectId: config.currentProject,
      featureName: options.feature,
      startFrom: options.from
    });
    
    console.log('\n✅ 流水线完成');
    console.log(JSON.stringify(result, null, 2));
  });

// 查看进度
program
  .command('status')
  .description('查看feature进度')
  .option('--feature <name>', 'feature名称')
  .action(async (options) => {
    const history = eventBus.getFeatureHistory(options.feature);
    
    console.log(`\n📊 ${options.feature} 事件历史:`);
    history.forEach(e => {
      console.log(`   [${new Date(e.timestamp).toISOString()}] ${e.type}`);
    });
  });

// 查看spec
program
  .command('spec view')
  .description('查看生成的spec')
  .requiredOption('--feature <name>', 'feature名称')
  .option('--stage <stage>', '阶段', 'requirements')
  .action(async (options) => {
    const specFile = `specs/${options.feature}/${options.stage}.md`;
    const content = await fs.readFile(specFile, 'utf-8');
    console.log(content);
  });

program.parse();
