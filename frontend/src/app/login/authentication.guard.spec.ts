import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, UrlTree } from '@angular/router';
import { provideStore, Store } from '@ngrx/store';

import { AuthenticationGuard } from './authentication.guard';
import { provideZonelessChangeDetection } from '@angular/core';
import { userReducer } from '@data/user/user.reducers';
import { UserActions } from '@data/user';

describe('AuthenticationGuard', () => {
  let guard: AuthenticationGuard;
  let router: Router;
  let store: Store;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthenticationGuard,
        provideStore({ user: userReducer }),
        provideRouter([]),
        provideZonelessChangeDetection()
      ]
    });

    guard = TestBed.inject(AuthenticationGuard);
    router = TestBed.inject(Router);
    store = TestBed.inject(Store);
  });

  it('waits for user lookup and rejects the protected route when it fails', () => {
    let result: boolean | UrlTree | undefined;

    guard.checkLogin('/map').subscribe((value) => (result = value));

    expect(result).toBeUndefined();

    store.dispatch(
      UserActions.fetchUserFailure({ error: { status: 401, message: 'Not logged in' } })
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('allows the protected route when user lookup succeeds', () => {
    let result: boolean | UrlTree | undefined;

    guard.checkLogin('/map').subscribe((value) => (result = value));

    expect(result).toBeUndefined();

    store.dispatch(UserActions.fetchUserSuccess({ user: { username: 'symphony', settings: {} } }));

    expect(result).toBeTrue();
  });
});
