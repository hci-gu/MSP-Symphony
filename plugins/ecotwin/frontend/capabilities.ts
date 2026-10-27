import { PROFILE } from './profile';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { ECOTWIN_CONFIG } from './config';
export interface Capabilities {
  installed: boolean;
  mode: 'enabled' | 'reporting-only' | 'absent' | 'unavailable';
  reporting: boolean;
  execution: boolean;
  discovery: boolean;
  profile?: string;
}
@Injectable({ providedIn: 'root' })
export class EcoTwinCapabilities {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ECOTWIN_CONFIG);
  readonly value = signal<Capabilities>({
    installed: true,
    mode: 'unavailable',
    reporting: false,
    execution: false,
    discovery: false
  });
  readonly execution = computed(() => this.value().execution);
  readonly message = signal('Checking EcoTwin capabilities…');
  private pending?: Promise<Capabilities>;
  load(): Promise<Capabilities> {
    return (this.pending ??= firstValueFrom(
      this.http
        .get<Capabilities>(`${this.config.apiBaseUrl}/extensions/ecotwin/capabilities`)
        .pipe(timeout(15000))
    )
      .then((value) => {
        if (
          value.installed !== true ||
          typeof value.reporting !== 'boolean' ||
          typeof value.execution !== 'boolean'
        )
          throw new Error('Unsupported EcoTwin capability response.');
        if (value.execution && value.profile !== PROFILE.id) {
          const unsupported: Capabilities = {
            ...value,
            mode: 'reporting-only',
            execution: false,
            discovery: false
          };
          this.value.set(unsupported);
          this.message.set(
            'This installation uses an unsupported EcoTwin input profile. Saved artifacts remain available.'
          );
          return unsupported;
        }
        this.value.set(value);
        this.message.set(
          value.execution
            ? ''
            : 'EcoTwin is in reporting-only mode. Saved simulations remain available; execution is disabled.'
        );
        return value;
      })
      .catch((error) => {
        const absent = error instanceof HttpErrorResponse && error.status === 404;
        const value: Capabilities = {
          installed: !absent,
          mode: absent ? 'absent' : 'unavailable',
          reporting: false,
          execution: false,
          discovery: false
        };
        this.value.set(value);
        this.message.set(
          absent
            ? 'EcoTwin is not installed on this server.'
            : error instanceof HttpErrorResponse && [401, 403].includes(error.status)
              ? 'You do not have access to EcoTwin. Sign in with an authorized account.'
              : 'EcoTwin capabilities are unavailable. Retry after restoring server access.'
        );
        return value;
      }));
  }
  refresh(): Promise<Capabilities> {
    this.pending = undefined;
    return this.load();
  }
}
