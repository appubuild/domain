import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from './App';
import i18n, { resources, setLanguage } from '../../../packages/localization/src';

afterEach(async () => { cleanup(); localStorage.clear(); await setLanguage('en'); });
describe('foundation', () => {
  it('has matching translation keys in both locales', () => { expect(Object.keys(resources.bn.common).sort()).toEqual(Object.keys(resources.en.common).sort()); });
  it('warns that the publicly accessible workspace is experimental in both languages', async () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(screen.getByText('Experimental preview.')).toBeInTheDocument();
    expect(screen.getByText(/Not for legal or cadastral decisions/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'bn');
    expect(await screen.findByText('পরীক্ষামূলক সংস্করণ।')).toBeInTheDocument();
  });
  it('changes language immediately and persists it', async () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'bn');
    expect(await screen.findByRole('heading', { name: 'নির্ভুলতায় দৃঢ় ভিত্তি।' })).toBeInTheDocument();
    expect(localStorage.getItem('land-expert.language')).toBe('bn');
    expect(document.documentElement.lang).toBe('bn');
  });
  it('navigates to settings and changes the shared language', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><App /></MemoryRouter>);
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    await user.selectOptions(screen.getByLabelText('Display language'), 'bn');
    expect(await screen.findByRole('heading', { name: 'সেটিংস' })).toBeInTheDocument();
    expect(localStorage.getItem('land-expert.language')).toBe('bn');
  });
  it('reports when the language preference cannot be saved', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      render(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>);
      await userEvent.selectOptions(screen.getByLabelText('Display language'), 'bn');
      expect(await screen.findByRole('status')).toHaveTextContent('সংরক্ষণ করা যায়নি');
    } finally { spy.mockRestore(); }
  });
  it('collapses and expands the desktop navigation without losing accessible link names', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><App /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true');
  });
  it('falls back to English for an unsupported locale', async () => {
    await i18n.changeLanguage('fr');
    expect(i18n.t('home')).toBe('Home');
  });
  it('provides a useful missing-route page', () => {
    render(<MemoryRouter initialEntries={['/missing']}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Return home/ })).toHaveAttribute('href', '/');
  });
});
