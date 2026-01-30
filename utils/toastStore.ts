export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onAction: () => void | Promise<void>;
}

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  action?: ToastAction;
  durationMs?: number;
}

const DEFAULT_DURATION_MS = 7000;
const toasts: ToastMessage[] = [];
const listeners = new Set<(items: ToastMessage[]) => void>();

const notify = () => {
  const snapshot = [...toasts];
  listeners.forEach(listener => listener(snapshot));
};

const removeToast = (id: string) => {
  const index = toasts.findIndex(item => item.id === id);
  if (index >= 0) {
    toasts.splice(index, 1);
    notify();
  }
};

export const subscribeToToasts = (listener: (items: ToastMessage[]) => void) => {
  listeners.add(listener);
  listener([...toasts]);
  return () => listeners.delete(listener);
};

export const pushToast = (message: Omit<ToastMessage, 'id'>) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const toast: ToastMessage = {
    ...message,
    id,
    durationMs: message.durationMs ?? DEFAULT_DURATION_MS,
  };
  toasts.push(toast);
  notify();
  if (toast.durationMs && toast.durationMs > 0) {
    window.setTimeout(() => removeToast(id), toast.durationMs);
  }
};

export const dismissToast = (id: string) => removeToast(id);

export const clearToasts = () => {
  toasts.splice(0, toasts.length);
  notify();
};
