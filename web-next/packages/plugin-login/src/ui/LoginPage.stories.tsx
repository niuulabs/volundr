import type { Meta, StoryObj } from '@storybook/react';
import { LoginPage } from './LoginPage';

const meta: Meta<typeof LoginPage> = {
  title: 'Login / LoginPage',
  component: LoginPage,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    onLogin: { action: 'onLogin' },
    loading: { control: 'boolean' },
    error: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof LoginPage>;

/** Default signed-out state — ambient background, logo, "Sign in" button. */
export const SignedOut: Story = {
  name: 'Signed out',
  args: {
    onLogin: () => {},
    loading: false,
    error: null,
  },
};

/** Loading state — shown while the OIDC redirect is in flight. */
export const Loading: Story = {
  name: 'Loading (redirect in flight)',
  args: {
    onLogin: () => {},
    loading: true,
    error: null,
  },
};

/** Error state — OIDC provider returned an error or is unreachable. */
export const OidcError: Story = {
  name: 'Error (OIDC failure)',
  args: {
    onLogin: () => {},
    loading: false,
    error: 'Authentication failed. Please try again or contact your administrator.',
  },
};
