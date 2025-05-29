import winston from 'winston'
import { loadConfig } from './config.js'

const createLogger = () => {
  const config = loadConfig()
  
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]

  if (config.logging.filePath) {
    const fileTransportOptions: winston.transports.FileTransportOptions = {
      filename: config.logging.filePath,
      level: config.logging.level,
      maxFiles: config.logging.maxFiles || 5, // Default to 5 rotated files
      tailable: true,
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.printf(({ timestamp, level, message, service, stack, ...meta }) => {
          let log = `${timestamp} [${service}] ${level}: ${message}`;
          if (stack) {
            log += `\n${stack}`;
          }
          const additionalMeta = Object.keys(meta).length ? JSON.stringify(meta) : '';
          if (additionalMeta) {
            log += ` ${additionalMeta}`;
          }
          return log;
        })
      )
    }

    if (config.logging.maxSizeMB) {
      fileTransportOptions.maxsize = config.logging.maxSizeMB * 1024 * 1024;
    }

    transports.push(new winston.transports.File(fileTransportOptions))
  }
  
  return winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: { service: 'blob-archiver' },
    transports
  })
}

export const logger = createLogger() 