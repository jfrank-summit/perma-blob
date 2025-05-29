export type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T, E = Error>(value: T): Result<T, E> => ({ ok: true, value });

export const Err = <T, E = Error>(error: E): Result<T, E> => ({ ok: false, error }); 