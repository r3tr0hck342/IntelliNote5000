import React from 'react';
import { XIcon, BrainIcon } from './icons';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectKey: () => void;
  isApiKeyReady: boolean;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSelectKey, isApiKeyReady }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center">
            <BrainIcon className="w-6 h-6 mr-3 text-indigo-500" />
            AI Service Configuration
          </h2>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
            <XIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-4">
            <p className="text-gray-600 dark:text-gray-300">
                To enable AI-powered features, connect your own Google AI account. This allows you to use your personal API key for all generative tasks within IntelliNote. Connecting your own key also unlocks <strong className="text-indigo-500 dark:text-indigo-400">Intelligence Mode</strong>, which uses more powerful AI models for the highest quality results.
            </p>
            <div className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg flex items-center justify-between">
                <span className="font-medium text-gray-800 dark:text-gray-200">Account Status:</span>
                {isApiKeyReady ? (
                    <span className="text-green-600 dark:text-green-400 font-semibold px-2 py-1 bg-green-100 dark:bg-green-900 rounded-md">Connected</span>
                ) : (
                    <span className="text-yellow-600 dark:text-yellow-400 font-semibold px-2 py-1 bg-yellow-100 dark:bg-yellow-900 rounded-md">Not Connected</span>
                )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
                By connecting your account, you agree to Google's Generative AI terms and are responsible for any associated usage costs. For more information, please review the <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">billing documentation</a>.
            </p>
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600">
            Close
          </button>
          <button
            onClick={onSelectKey}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
          >
            {isApiKeyReady ? 'Change API Key' : 'Select API Key'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;