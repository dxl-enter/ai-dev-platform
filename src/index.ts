import { Command } from 'commander';
import { PipelineEngine } from './core/PipelineEngine';
import { EventBus } from './core/EventBus';
import { configManager } from './config';
import { logger } from './utils/logger';
import { FileManager } from './utils/fs';
import * as path from 'path';

const program = new Command();
const eventBus = new EventBus();
const pipelineEngine = new PipelineEngine();

program
  .name('ai-dev')
  .description('AI驱动的开发工作流平台 - 从需求到代码全自动化')
  .version('2.0.0');

// ========== 配置命令 ==========

program
  .command('config')
  .description('配置管理')
  .argument('<action>', '操作: show|set|list-projects')
  .argument('[key]', '配置键')
  .argument('[value]', '配置值')
  .action(async (action: string, key?: string, value?: string) => {
    switch (action) {
      case 'show':
        const config = await configManager.load();
        console.log(JSON.stringify(config, null, 2));
        break;
      case 'set':
        if (key && value) {
          // 简化版，实际需要深度设置
          console.log(`设置 ${key} = ${value}`);
          // config[key] = value;
          // await configManager.save();
        }
        break;
      case 'list-projects':
        const cfg = await configManager.load();
        cfg.projects.forEach(p => {
          console.log(`  ${p.id}: ${p.name} [${p.tech_stack.frontend}+${p.tech_stack.backend}]`);
        });
        break;
    }
  });

// ========== Feature命令 ==========

program
  .command('feature')
  .description('Feature管理')
  .argument('<action>', '操作: create|start|status|list|submit|import')
  .option('-t, --title <title>', '标题')
  .option('-d, --description <desc>', '描述')
  .option('-p, --project <id>', '项目ID', 'default')
  .option('--feature <name>', 'Feature名称')
  .option('--from-clipboard', '从剪贴板读取')
  .option('--from-jira <key>', '从JIRA导入')
  .option('--from-github <issue>', '从GitHub导入')
  .action(async (action: string, options: any) => {
    const projectId = options.project || 'default';

    switch (action) {
      case 'create':
      case 'import': {
        let input: any;
        
        if (options.fromClipboard) {
          const clipboard = await import('clipboardy');
          const text = clipboard.default.readSync();
          try {
            input = JSON.parse(text);
          } catch {
            input = { title: options.title || '剪贴板内容', description: text };
          }
        } else if (options.fromJira) {
          input = { key: options.fromJira };
        } else if (options.fromGithub) {
          input = { number: parseInt(options.fromGithub) };
        } else {
          input = {
            title: options.title,
            description: options.description,
          };
        }

        const featureName = (options.title || 'new-feature')
          .replace(/\s+/g, '-')
          .toLowerCase();

        console.log(`\n📋 创建Feature: ${featureName}`);
        console.log(`   项目: ${projectId}`);
        console.log(`   来源: ${options.fromClipboard ? 'clipboard' : options.fromJira ? 'jira' : 'manual'}`);

        // 启动流水线
        await pipelineEngine.execute({
          projectId,
          featureName,
          source: options.fromJira ? 'jira' : options.fromGithub ? 'github' : 'manual',
          rawInput: input,
        });
        break;
      }

      case 'start': {
        const featureName = options.feature;
        if (!featureName) {
          console.log('请指定 --feature <name>');
          return;
        }

        console.log(`🚀 启动开发: ${featureName}`);
        await pipelineEngine.execute({
          projectId,
          featureName,
          source: 'manual',
          rawInput: { title: featureName },
        });
        break;
      }

      case 'status': {
        const featureName = options.feature;
        if (!featureName) {
          console.log('请指定 --feature <name>');
          return;
        }

        const history = eventBus.getFeatureHistory(featureName);
        const stats = eventBus.getStats(featureName);

        console.log(`\n📊 ${featureName} 状态:`);
        console.log('─'.repeat(40));
        
        if (history.length === 0) {
          console.log('  暂无事件记录');
        } else {
          // 显示最近10个事件
          const recent = history.slice(-10);
          recent.forEach(e => {
            const time = new Date(e.timestamp).toLocaleTimeString();
            console.log(`  [${time}] ${e.type}`);
          });
        }

        console.log('\n📈 统计:');
        Object.entries(stats).forEach(([type, count]) => {
          console.log(`  ${type}: ${count}`);
        });
        break;
      }

      case 'list': {
        const specsDir = path.join(process.cwd(), 'specs', projectId);
        const features = await FileManager.listSpecFiles(specsDir)
          .catch(() => []);
        
        console.log(`\n📁 ${projectId} 的Features:`);
        if (features.length === 0) {
          console.log('  暂无');
        } else {
          features.forEach(f => console.log(`  - ${f}`));
        }
        break;
      }

      case 'submit': {
        const featureName = options.feature;
        if (!featureName) {
          console.log('请指定 --feature <name>');
          return;
        }

        const { GitManager } = require('./utils/git');
        const git = new GitManager();
        
        const branch = await git.getCurrentBranch();
        const changedFiles = await git.getChangedFiles();

        console.log(`📤 提交Feature: ${featureName}`);
        console.log(`   分支: ${branch}`);
        console.log(`   变更文件: ${changedFiles.length}`);

        if (changedFiles.length > 0) {
          await git.commit(`feat: ${featureName} - AI generated`);
          await git.push(branch);
          
          // 创建PR
          const specsPath = path.join('specs', projectId, featureName);
          const requirements = await FileManager.readFileSafe(
            path.join(specsPath, 'requirements.md')
          );

          const prBody = [
            `## AI Generated Feature: ${featureName}`,
            '',
            '### Specs',
            `- [requirements.md](${specsPath}/requirements.md)`,
            `- [design.md](${specsPath}/design.md)`,
            `- [tasks.md](${specsPath}/tasks.md)`,
            '',
            '### Changes',
            ...changedFiles.map(f => `- ${f}`),
          ].join('\n');

          await git.createPR({
            title: `feat: ${featureName}`,
            body: prBody,
            head: branch,
          });
        }
        break;
      }
    }
  });

// ========== Spec命令 ==========

program
  .command('spec')
  .description('Spec管理')
  .argument('<action>', '操作: view|edit|history|diff')
  .requiredOption('--feature <name>', 'Feature名称')
  .option('--stage <stage>', '阶段: P1/P2/P3', 'P1')
  .action(async (action: string, options: any) => {
    const featurePath = path.join(
      process.cwd(),
      'specs',
      'default',
      options.feature
    );

    switch (action) {
      case 'view': {
        const specFile = FileManager.getSpecPath(featurePath, options.stage);
        const content = await FileManager.readFileSafe(specFile);
        if (content) {
          console.log(content);
        } else {
          console.log(`Spec不存在: ${specFile}`);
        }
        break;
      }

      case 'history': {
        const specVC = pipelineEngine.getSpecVersionControl();
        const history = specVC.getHistory(options.feature, options.stage);
        
        console.log(`\n📜 ${options.feature} ${options.stage} 版本历史:`);
        history.forEach(v => {
          const time = new Date(v.timestamp).toISOString();
          const status = v.frozen ? '🔒' : '📝';
          console.log(`  ${status} v${v.version} - ${time}`);
          if (v.rollbackReason) {
            console.log(`     ⏪ 回溯: ${v.rollbackReason}`);
          }
        });
        break;
      }

      case 'diff': {
        const specVC = pipelineEngine.getSpecVersionControl();
        const history = specVC.getHistory(options.feature, options.stage);
        
        if (history.length >= 2) {
          const latest = history[history.length - 1];
          const previous = history[history.length - 2];
          
          if (latest.diff) {
            console.log(`\nDiff v${previous.version} → v${latest.version}:`);
            console.log(latest.diff);
          } else {
            console.log('无diff信息');
          }
        } else {
          console.log('版本不足，无法对比');
        }
        break;
      }
    }
  });

// ========== 全局选项 ==========

program
  .option('--verbose', '详细日志')
  .option('--dry-run', '模拟运行，不实际执行')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      process.env.LOG_LEVEL = 'debug';
    }
  });

// ========== 错误处理 ==========

process.on('unhandledRejection', (error: Error) => {
  logger.error(`未处理的错误: ${error.message}`);
  logger.debug(error.stack || '');
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n\n👋 已中断');
  process.exit(0);
});

// ========== 启动 ==========

async function main() {
  // 加载配置
  await configManager.load();
  
  // 解析命令行
  await program.parseAsync(process.argv);
}

main().catch(error => {
  logger.error(`启动失败: ${error.message}`);
  process.exit(1);
});
