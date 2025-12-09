import { vi, type MockInstance } from 'vitest';

type ConsoleSpy = MockInstance<(...args: unknown[]) => void>;

export type ConsoleSpies = {
  info: ConsoleSpy;
  warn: ConsoleSpy;
  error: ConsoleSpy;
  debug: ConsoleSpy;
};

export const createConsoleSpies = (): ConsoleSpies => ({
  info: vi.spyOn(console, 'info').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  debug: vi.spyOn(console, 'debug').mockImplementation(() => {})
});

export const restoreConsoleSpies = (spies?: ConsoleSpies): void => {
  Object.values(spies || {}).forEach((spy) => spy.mockRestore());
};
