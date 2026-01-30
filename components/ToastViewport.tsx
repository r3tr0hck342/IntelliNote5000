import React, { useEffect, useState } from 'react';
import { ToastMessage, dismissToast, subscribeToToasts } from '../utils/toastStore';
import { XIcon } from './icons';

const variantStyles: Record<NonNullable<ToastMessage['variant']>, string> = {
  info: 'border-blue-500 bg-blue-50 text-blue-900',
  success: 'border-green-500 bg-green-50 text-green-900',
  warning: 'border-yellow-500 bg-yellow-50 text-yellow-900',
  error: 'border-red-500 bg-red-50 text-red-900',
};

const ToastViewport: React.FC = () => {
  const [items, setItems] = useState<ToastMessage[]>([]);

  useEffect(() => subscribeToToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-3 max-w-sm">
      {items.map(item => (
        <div
          key={item.id}
          className={`rounded-lg border-l-4 shadow-lg p-4 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 ${item.variant ? variantStyles[item.variant] : 'border-gray-300'}`}
        >
          <div className="flex justify-between gap-3">
            <div>
              <p className="font-semibold">{item.title}</p>
              {item.description && (
                <p className="text-sm mt-1 text-gray-600 dark:text-gray-300">{item.description}</p>
              )}
            </div>
            <button
              onClick={() => dismissToast(item.id)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="Dismiss notification"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
          {item.action && (
            <div className="mt-3">
              <button
                onClick={async () => {
                  await item.action?.onAction();
                  dismissToast(item.id);
                }}
                className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 hover:underline"
              >
                {item.action.label}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default ToastViewport;
