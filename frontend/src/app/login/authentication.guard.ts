import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Store } from '@ngrx/store';
import { State } from '../app-reducer';
import { UserSelectors, UserActions } from '@data/user';
import { combineLatest, Observable, of } from 'rxjs';
import { filter, map, take, switchMap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AuthenticationGuard {
  private readonly store = inject<Store<State>>(Store);
  private readonly router = inject(Router);

  getFromStoreOrAPI(): Observable<boolean | UrlTree> {
    return this.store.select(UserSelectors.selectIsLoggedIn).pipe(
      take(1),
      switchMap((isLoggedIn) => {
        if (isLoggedIn) {
          return of(true);
        }

        this.store.dispatch(UserActions.fetchUser());

        return combineLatest([
          this.store.select(UserSelectors.selectIsLoggedIn),
          this.store.select(UserSelectors.selectIsUserLoading)
        ]).pipe(
          filter(([, isLoading]) => !isLoading),
          take(1),
          map(([authenticated]) => (authenticated ? true : this.router.createUrlTree(['/login'])))
        );
      })
    );
  }

  canActivate = (
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> => this.checkLogin(state.url);

  checkLogin = (url: string): Observable<boolean | UrlTree> => {
    this.store.dispatch(UserActions.updateRedirectUrl({ url }));
    return this.getFromStoreOrAPI();
  };
}
