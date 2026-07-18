export class AppError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const badRequest = (message, details) => new AppError(400, message, details)
export const forbidden = (message = '无权执行该操作') => new AppError(403, message)
export const notFound = (message = '记录不存在') => new AppError(404, message)

export const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
