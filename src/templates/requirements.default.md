# {{title}}

## 元数据
- **来源**: {{source}} ({{sourceId}})
- **优先级**: {{priority}}
- **作者**: {{author}}
- **创建时间**: {{createTime}}
{{#each metadata}}
- **{{@key}}**: {{this}}
{{/each}}

## 故事概述
**作为** {{role}}
**我想要** {{goal}}
**以便** {{benefit}}

## 功能需求

### 1. {{module1_name}}
#### （1）{{feature1_name}}
- **触发条件**: {{condition}}
- **操作流程**: {{flow}}
- **预期结果**: {{expected}}

## 验收标准
{{#each acceptanceCriteria}}
- [ ] {{this}}
{{/each}}

## 技术约束
- 前端框架: {{frontend}}
- UI组件库: {{uiLib}}
- 后端技术: {{backend}}

## 风险提示
{{#each risks}}
- {{this}}
{{/each}}

## 待确认事项
{{#each uncertainParts}}
- **{{location}}**: {{question}}
{{/each}}
