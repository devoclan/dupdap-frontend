/**
 * Tests for /dashboard/layout.tsx auth guards
 * Issue #401: the layout must not render a blank (null) frame while the
 * client-side redirect is pending — it should render an explicit loading
 * state instead, and still redirect unauthenticated users to /auth/login.
 *
 * Combinations of token × merchant state:
 *   - token + merchant   → renders dashboard UI
 *   - token only         → renders loading state (no blank flash), no redirect
 *   - merchant only      → redirects to /auth/login (token missing)
 *   - neither            → redirects to /auth/login
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { useAuthStore } from '@/lib/store';
import DashboardLayout from '@/app/dashboard/layout';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/dashboard',
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// We control useAuthStore by mocking the whole store module
jest.mock('@/lib/store');

const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MOCK_MERCHANT = {
  id: 'merchant-1',
  email: 'test@example.com',
  businessName: 'Acme Corp',
  status: 'active',
};

function stubAuth(overrides: { token?: string | null; merchant?: typeof MOCK_MERCHANT | null }) {
  const state = {
    token: overrides.token ?? null,
    merchant: overrides.merchant ?? null,
    logout: jest.fn(),
    setAuth: jest.fn(),
  };
  // useAuthStore is called with a selector fn: useAuthStore(state => state.foo)
  mockUseAuthStore.mockImplementation((selector?: (s: typeof state) => unknown) => {
    if (selector) return selector(state) as ReturnType<typeof useAuthStore>;
    return state as unknown as ReturnType<typeof useAuthStore>;
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('DashboardLayout — auth guards', () => {
  it('[token + merchant] renders the dashboard shell and children', async () => {
    stubAuth({ token: 'valid-token', merchant: MOCK_MERCHANT });

    render(
      <DashboardLayout>
        <div data-testid="child-content">Dashboard Content</div>
      </DashboardLayout>,
    );

    // Children should be visible
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    // Merchant business name should appear in sidebar
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    // Should NOT redirect
    await act(async () => { jest.runAllTimers(); });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('[token only, no merchant] renders an explicit loading state — no blank flash, no redirect', async () => {
    stubAuth({ token: 'valid-token', merchant: null });

    const { container } = render(
      <DashboardLayout>
        <div data-testid="child-content">Dashboard Content</div>
      </DashboardLayout>,
    );

    // Issue #401: the layout must NOT render null while merchant is missing.
    expect(container.firstChild).not.toBeNull();
    // An explicit loading indicator should be shown instead of blank content.
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Children should NOT be rendered
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    // Should NOT redirect (token is present)
    await act(async () => { jest.runAllTimers(); });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('[no token, merchant present] redirects to /auth/login', async () => {
    stubAuth({ token: null, merchant: MOCK_MERCHANT });

    render(
      <DashboardLayout>
        <div data-testid="child-content">Dashboard Content</div>
      </DashboardLayout>,
    );

    // The redirect is triggered in a useEffect — flush it
    await act(async () => { jest.runAllTimers(); });

    expect(mockPush).toHaveBeenCalledWith('/auth/login');
  });

  it('[no token, no merchant] redirects to /auth/login', async () => {
    stubAuth({ token: null, merchant: null });

    render(
      <DashboardLayout>
        <div data-testid="child-content">Dashboard Content</div>
      </DashboardLayout>,
    );

    await act(async () => { jest.runAllTimers(); });

    expect(mockPush).toHaveBeenCalledWith('/auth/login');
  });
});
