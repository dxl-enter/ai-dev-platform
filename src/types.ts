// ========== 核心类型定义 ==========

export interface PlatformConfig {
  platform: {
    version: string;
    llm: LLMConfig;
    pipeline: PipelineConfig;
    specs: SpecsConfig;
  };
  projects: ProjectConfig[];
}

export interface LLMConfig {
  provider: 'anthropic' | 'openai';
  models: {
    architect: string;
    developer: string;
    reviewer: string;
  };
  defaults: {
    max_tokens: number;
    temperature: {
      creative: number;
      precise: number;
    };
    context_window: number;
  };
}

export interface PipelineConfig {
  stages: string[];
  human_gates: Record<string, 'always' | 'never' | 'conditional'>;
  rollback: {
    max_retries: number;
    max_total_retries: number;
  };
}

export interface SpecsConfig {
  base_dir: string;
  templates_dir: string;
  freeze_on_gate_pass: boolean;
}

export interface ProjectConfig {
  id: string;
  name: string;
  repo: string;
  tech_stack: TechStack;
}

export interface TechStack {
  frontend: 'react' | 'vue' | 'angular';
  backend: 'java' | 'go' | 'python' | 'nodejs';
  ui_lib: 'antd' | 'element' | 'material';
  state_mgmt?: string;
}

// ========== 事件类型 ==========

export type EventType =
  | 'feature.requested'
  | 'spec.created'
  | 'spec.updated'
  | 'spec.frozen'
  | 'spec.approved'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.review_failed'
  | 'stage.completed'
  | 'stage.failed'
  | 'pipeline.rollback'
  | 'pipeline.completed'
  | 'human_gate.requested'
  | 'human_gate.approved'
  | 'human_gate.rejected';

export interface PipelineEvent {
  id: string;
  type: EventType;
  projectId: string;
  featureName: string;
  payload: Record<string, any>;
  timestamp: number;
  triggerChain: EventType[];
}

export type EventHandler = (event: PipelineEvent) => Promise<void>;

// ========== Feature相关 ==========

export interface FeatureRequest {
  projectId: string;
  featureName: string;
  source: 'telegram' | 'jira' | 'github' | 'manual';
  rawInput: any;
  metadata?: Record<string, any>;
}

export interface NormalizedInput {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  attachments: string[];
  source: string;
  sourceId: string;
  author: string;
  metadata?: Record<string, any>;
}

// ========== Pipeline相关 ==========

export interface StageContext {
  projectConfig: ProjectConfig;
  featureName: string;
  featurePath: string;
  input: NormalizedInput;
  assembledContext: AssembledContext;
  previousResults: StageResult[];
  env: Record<string, string>;
}

export interface StageResult {
  stage: string;
  status: 'completed' | 'needs_refinement' | 'failed';
  output: any;
  nextAction: 'proceed' | 'rollback' | 'human_gate' | 'retry';
  rollbackTo?: string;
  rollbackReason?: string;
  artifacts?: string[];
  errors?: string[];
}

export interface AssembledContext {
  systemPrompt: string;
  featureContext: string;
  projectContext: string;
  taskContext?: string;
  totalTokens: number;
}

// ========== Task相关 ==========

export interface Task {
  id: string;
  title: string;
  type: 'frontend' | 'backend' | 'test' | 'config';
  dependencies: string[];
  estimatedHours: number;
  acceptanceCriteria: string[];
  files?: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  assignee?: string;
  result?: TaskResult;
}

export interface TaskResult {
  taskId: string;
  status: 'completed' | 'failed' | 'spec_issue';
  attempts: number;
  generatedFiles?: string[];
  testResults?: TestResult[];
  specIssue?: boolean;
  affectsStage?: string;
  description?: string;
  error?: string;
}

// ========== Spec版本控制 ==========

export interface SpecVersion {
  id: string;
  featureName: string;
  stage: string;
  version: number;
  content: string;
  diff?: string;           // 与上一版本的diff
  timestamp: number;
  frozen: boolean;
  parentVersion?: number;
  rollbackFrom?: string;
  rollbackReason?: string;
  approvedBy?: string;
}

// ========== Human Gate ==========

export interface ApprovalRequest {
  featureName: string;
  stage: string;
  title: string;
  content: string;
  uncertainParts: UncertainPart[];
  metadata: Record<string, any>;
}

export interface UncertainPart {
  location: string;
  question: string;
  suggestedAnswer?: string;
  confidence: number;  // 0-1
}

// ========== 测试相关 ==========

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  type: 'unit' | 'e2e' | 'integration';
}

// ========== Review相关 ==========

export interface ReviewResult {
  passed: boolean;
  issues: ReviewIssue[];
  securityIssues: SecurityIssue[];
  specIssues: SpecIssue[];
  score: number;  // 0-100
}

export interface ReviewIssue {
  file: string;
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

export interface SecurityIssue {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  location: string;
}

export interface SpecIssue {
  location: string;
  description: string;
  affectsStage: string;
  suggestion: string;
}
