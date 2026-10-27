import { HttpErrorResponse } from '@angular/common/http';

export function apiError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0 || error.status === 502 || error.status === 504)
      return 'The Eco-evo API is unavailable. Check the model server and network connection.';
    let body = error.error;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    const message =
      typeof body?.message === 'string'
        ? body.message.slice(0, 600)
        : `The API request failed (HTTP ${error.status}).`;
    if (body?.error === 'MODEL_CHECKPOINT_MISMATCH')
      return `This model is incompatible with the server's current project. Choose another model in the Model list and run again. ${message}`;
    if (body?.error === 'MISSING_FILE' && /(?:noise|trawling)-\d+\.png/.test(message))
      return 'Eco-evo could not read the impact masks. Start the model server with the Symphony impact configuration, then retry this calculation.';
    return message;
  }
  if (error instanceof Error && error.name === 'TimeoutError')
    return 'The API timed out. It may still be computing; this request was not retried.';
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
