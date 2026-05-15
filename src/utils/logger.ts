import winston from 'winston';
import chalk from 'chalk';

const customFormat = winston.format.printf(({ level, message, timestamp }) => {
  const colorMap: Record<string, (msg: string) => string> = {
    error: chalk.red,
    warn: chalk.yellow,
    info: chalk.cyan,
    debug: chalk.gray,
    success: chalk.green,
  };
  
  const color = colorMap[level] || chalk.white;
  return `${chalk.gray(timestamp)} ${color(`[${level.toUpperCase()}]`)} ${message}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    customFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      dirname: process.cwd()
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      dirname: process.cwd()
    })
  ]
});

// 扩展日志级别
logger.levels = {
  ...winston.config.syslog.levels,
  success: 0
};

// 添加success方法
(logger as any).success = (message: string) => {
  logger.log('success', message);
};
