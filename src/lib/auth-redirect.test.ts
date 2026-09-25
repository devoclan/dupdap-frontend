import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redirectToLogin, setAuthRedirectHandler } from './auth-redirect';

describe('redirectToLogin', () => {
  beforeEach(() => {
    setAuthRedirectHandler(null);
  });

  it('uses the registered client-side handler with the current path', () => {
    const handler = vi.fn();
    setAuthRedirectHandler(handler);

    Object.defineProperty(window, 'location', {
      value: { pathname: '/dashboard/webhooks', search: '?tab=1', assign: vi.fn() },
      writable: true,
    });

    redirectToLogin();

    expect(handler).toHaveBeenCalledWith('/dashboard/webhooks?tab=1');
  });

  it('falls back to a login URL with next when no handler is registered', () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { pathname: '/dashboard/payments', search: '', assign },
      writable: true,
    });

    redirectToLogin('/dashboard/payments');

    expect(assign).toHaveBeenCalledWith('/auth/login?next=%2Fdashboard%2Fpayments');
  });

  it('falls back to window.location.assign when the handler is unregistered mid-flight', () => {
    const handler = vi.fn();
    setAuthRedirectHandler(handler);

    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { pathname: '/dashboard/settings', search: '', assign },
      writable: true,
    });

    // Simulate AuthRedirectSetup's effect cleanup on unmount, which nulls the
    // handler between request initiation and the 401-triggered redirect.
    setAuthRedirectHandler(null);

    expect(() => redirectToLogin()).not.toThrow();

    expect(handler).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/auth/login?next=%2Fdashboard%2Fsettings');
  });
});
