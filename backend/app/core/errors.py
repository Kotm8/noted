class ApplicationError(Exception):
    status_code = 400

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class NotFoundError(ApplicationError):
    status_code = 404


class AuthenticationError(ApplicationError):
    status_code = 401


class ForbiddenError(ApplicationError):
    status_code = 403


class ValidationError(ApplicationError):
    status_code = 422


class RateLimitError(ApplicationError):
    status_code = 429


class ContentTooLargeError(ApplicationError):
    status_code = 413


class ConflictError(ApplicationError):
    status_code = 409


class ServiceUnavailableError(ApplicationError):
    status_code = 503
