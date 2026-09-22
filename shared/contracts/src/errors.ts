export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
